/**
 * ============================================================================
 * 🗄️ 데이터 저장소 (2026-09-15 새 구조)
 * ============================================================================
 * 예전: Data!A1 한 칸에 전체 JSON을 통째로 저장
 *   → 셀 5만 자 한도, 저장할 때마다 전체 덮어쓰기, 지운 항목이 다른 기기 저장 때 되살아남
 *
 * 지금: Items 시트 한 줄 = 레코드 하나
 *   collection | id | rev | updatedAt | deletedAt | updatedBy | json
 *   - 삭제는 줄을 지우지 않고 deletedAt만 표시해요(tombstone).
 *     → 이미 삭제된 id는 다른 기기가 옛 데이터로 저장해도 절대 되살아나지 않아요.
 *   - 저장(commit)할 때마다 Meta 시트의 rev가 1씩 오르고, 바뀐 줄에도 그 rev가 찍혀요.
 *     → "마지막으로 받은 rev 이후에 바뀐 것만" 가져올 수 있어요.
 *   - A1은 이전(migrateToV2) 때 그대로 남겨둬서 언제든 되돌릴 수 있어요.
 * ============================================================================
 */

const STORE = {
  ITEMS: 'Items',
  META: 'Meta',
  LEGACY_LOG: 'LegacyLog',
  MAX_ROW_CHARS: 45000,
  MAX_OPS: 500,
  HEADER: ['collection', 'id', 'rev', 'updatedAt', 'deletedAt', 'updatedBy', 'json']
};

// 배열 컬렉션 — 항목마다 id가 있어요. (퇴원생은 students 안에서 withdrawDate로 구분)
const ARRAY_COLLECTIONS = [
  'students', 'progressLogs', 'attendanceRecords', 'generalMakeups',
  'conceptBankItems', 'conceptDraftItems', 'conceptTestRecords',
  'dailyTests', 'homeworkAssignments', 'answerKeys', 'homeworkRecords', 'mistakeRecords',
  'schoolInfos', 'examAnalysis', 'parentMessages', 'scheduleItems', 'aiLearningReports'
];
// 키-값 맵 컬렉션 — id = 키 (예: teacherComments의 학생 id)
const MAP_COLLECTIONS = [
  'teacherComments', 'conceptDailyCounts', 'conceptActiveDays', 'conceptEnabledUnits', 'studentBehaviorNotes',
  'settings'
];
// 값 목록 컬렉션 — id = 값 자체 (예: 관리자 알림 토큰)
const SET_COLLECTIONS = ['adminPushTokens'];
// 레코드 안의 "목록 필드" — 통째로 덮어쓰지 않고 추가/제거로만 합쳐요
// (학부모가 숙제 체크한 게 관리자 저장 때 지워지던 문제 방지)
const SET_FIELDS = {
  homeworkAssignments: ['doneBy'],
  generalMakeups: ['doneBy'],
  students: ['pushTokens']
};
// 예전 버전 앱이 쓰던 id 카운터 → 어느 컬렉션의 최대 id로 계산할지
const LEGACY_COUNTERS = [
  ['nextStudentId', ['students']], ['nextProgressId', ['progressLogs']],
  ['nextAttendanceId', ['attendanceRecords']], ['nextGeneralMakeupId', ['generalMakeups']],
  ['nextConceptItemId', ['conceptBankItems']], ['nextConceptDraftId', ['conceptDraftItems']],
  ['nextConceptRecordId', ['conceptTestRecords']], ['nextDailyId', ['dailyTests']],
  ['nextHomeworkAssignmentId', ['homeworkAssignments']], ['nextAnswerKeyId', ['answerKeys']],
  ['nextHomeworkId', ['homeworkRecords']], ['nextMistakeId', ['mistakeRecords']],
  ['nextSchoolInfoId', ['schoolInfos']], ['nextExamId', ['examAnalysis']],
  ['nextScheduleId', ['scheduleItems']], ['nextAiReportId', ['aiLearningReports']]
];

/* ------------------------------ 공통 도우미 ------------------------------ */

function storeError_(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

function parseJsonSafe_(text, fallback) {
  if (text === null || text === undefined || text === '') return fallback;
  try { return JSON.parse(text); } catch (e) { return fallback; }
}

// 저장은 한 번에 하나씩만 (동시에 두 기기가 저장해도 서로 덮어쓰지 않게)
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    throw storeError_('LOCK_TIMEOUT', '다른 저장이 진행 중이에요. 잠시 후 다시 시도해주세요.');
  }
  try {
    const result = fn();
    SpreadsheetApp.flush();
    return result;
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------ Meta 시트 ------------------------------ */

function metaSheet_(create) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(STORE.META);
  if (!sh && create) {
    sh = ss.insertSheet(STORE.META);
    sh.getRange('A:B').setNumberFormat('@');
    sh.getRange(1, 1, 1, 2).setValues([['key', 'value']]).setFontWeight('bold');
  }
  return sh;
}

function getMeta_() {
  const sh = metaSheet_(false);
  const meta = {};
  if (!sh) return meta;
  const last = sh.getLastRow();
  if (last < 2) return meta;
  sh.getRange(2, 1, last - 1, 2).getValues().forEach(function (r) {
    if (r[0] !== '') meta[String(r[0])] = String(r[1]);
  });
  return meta;
}

function setMeta_(patch) {
  const sh = metaSheet_(true);
  const last = sh.getLastRow();
  const keys = last >= 2 ? sh.getRange(2, 1, last - 1, 1).getValues().map(function (r) { return String(r[0]); }) : [];
  Object.keys(patch).forEach(function (k) {
    const v = String(patch[k]);
    const i = keys.indexOf(k);
    if (i >= 0) {
      sh.getRange(i + 2, 2).setValue(v);
    } else {
      sh.getRange(keys.length + 2, 1, 1, 2).setValues([[k, v]]);
      keys.push(k);
    }
  });
}

function isMigrated_() {
  return getMeta_().schemaVersion === '2';
}

function assertMigrated_(meta) {
  if ((meta || getMeta_()).schemaVersion !== '2') {
    throw storeError_('NOT_MIGRATED', '아직 새 저장 구조로 옮기지 않았어요. (편집기에서 migrateToV2 실행 필요)');
  }
}

function collectionKind_(c, meta) {
  if (ARRAY_COLLECTIONS.indexOf(c) >= 0) return 'array';
  if (MAP_COLLECTIONS.indexOf(c) >= 0) return 'map';
  if (SET_COLLECTIONS.indexOf(c) >= 0) return 'set';
  const extra = parseJsonSafe_(meta && meta.extraCollections, {});
  return extra[c] || null;
}

/* ------------------------------ Items 시트 ------------------------------ */

function itemsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(STORE.ITEMS);
  if (!sh) {
    sh = ss.insertSheet(STORE.ITEMS);
    // 모든 칸을 "텍스트" 서식으로 — id나 날짜가 숫자/날짜로 멋대로 바뀌지 않게
    sh.getRange('A:G').setNumberFormat('@');
    sh.getRange(1, 1, 1, STORE.HEADER.length).setValues([STORE.HEADER]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function readItems_() {
  const sh = itemsSheet_();
  const last = sh.getLastRow();
  const values = last >= 2 ? sh.getRange(2, 1, last - 1, 7).getValues() : [];
  const rows = values.map(function (v, i) {
    return {
      r: i + 2,
      c: String(v[0]),
      id: String(v[1]),
      rev: Number(v[2]) || 0,
      updatedAt: String(v[3]),
      deletedAt: String(v[4]),
      updatedBy: String(v[5]),
      json: String(v[6])
    };
  });
  const index = {};
  rows.forEach(function (row) { index[row.c + '' + row.id] = row; });
  return { sheet: sh, rows: rows, index: index };
}

function rowValues_(row) {
  return [row.c, row.id, String(row.rev), row.updatedAt, row.deletedAt, row.updatedBy, row.json];
}

function writeRows_(store, touched) {
  const sh = store.sheet;
  const existing = touched.filter(function (row) { return row.r; });
  if (existing.length > 40) {
    // 많이 바뀌었으면 호출 횟수를 줄이려고 기존 줄 전체를 한 번에 다시 써요
    const all = store.rows.filter(function (row) { return row.r; });
    if (all.length) sh.getRange(2, 1, all.length, 7).setValues(all.map(rowValues_));
  } else {
    existing.forEach(function (row) { sh.getRange(row.r, 1, 1, 7).setValues([rowValues_(row)]); });
  }
  const fresh = store.rows.filter(function (row) { return !row.r; });
  if (fresh.length) {
    const start = Math.max(sh.getLastRow(), 1) + 1;
    sh.getRange(start, 1, fresh.length, 7).setNumberFormat('@');
    sh.getRange(start, 1, fresh.length, 7).setValues(fresh.map(rowValues_));
    fresh.forEach(function (row, i) { row.r = start + i; });
  }
}

function checkRowSize_(json, c, id) {
  if (json.length > STORE.MAX_ROW_CHARS) {
    throw storeError_('TOO_LARGE', c + ' #' + id + ' 항목이 너무 커요 (' + json.length + '자). 사진 등 큰 내용은 줄여주세요.');
  }
}

/* ------------------------------ 변경 적용 ------------------------------ */

function applyPatch_(data, op) {
  const set = op.set || {};
  Object.keys(set).forEach(function (k) { if (k !== 'id') data[k] = set[k]; });
  (op.unset || []).forEach(function (k) { if (k !== 'id') delete data[k]; });
  const add = op.addToSet || {};
  Object.keys(add).forEach(function (k) {
    const arr = Array.isArray(data[k]) ? data[k].slice() : [];
    (add[k] || []).forEach(function (v) { if (arr.indexOf(v) === -1) arr.push(v); });
    data[k] = arr;
  });
  const pull = op.pullFromSet || {};
  Object.keys(pull).forEach(function (k) {
    if (!Array.isArray(data[k])) return;
    const remove = pull[k] || [];
    data[k] = data[k].filter(function (v) { return remove.indexOf(v) === -1; });
  });
  // 맵 필드 안의 키 하나만 바꾸기 (예: doneAt[학생id] = 체크한 날) — 다른 학생 기록을 덮어쓰지 않게
  const mapSet = op.mapSet || {};
  Object.keys(mapSet).forEach(function (k) {
    const obj = (data[k] && typeof data[k] === 'object' && !Array.isArray(data[k])) ? Object.assign({}, data[k]) : {};
    Object.keys(mapSet[k] || {}).forEach(function (kk) { obj[kk] = mapSet[k][kk]; });
    data[k] = obj;
  });
  const mapUnset = op.mapUnset || {};
  Object.keys(mapUnset).forEach(function (k) {
    if (!data[k] || typeof data[k] !== 'object' || Array.isArray(data[k])) return;
    const obj = Object.assign({}, data[k]);
    (mapUnset[k] || []).forEach(function (kk) { delete obj[kk]; });
    data[k] = obj;
  });
}

function applyOp_(store, op, meta, rev, now, actor) {
  if (!op || typeof op !== 'object') throw storeError_('BAD_OP', '잘못된 변경 요청이에요.');
  const c = String(op.c || '');
  const kind = collectionKind_(c, meta);
  if (!kind) throw storeError_('UNKNOWN_COLLECTION', '알 수 없는 데이터 종류: ' + c);
  const id = (op.id === undefined || op.id === null) ? '' : String(op.id);
  if (!id || id.length > 300) throw storeError_('BAD_ID', '잘못된 id');
  const key = c + '' + id;
  let row = store.index[key];

  if (op.op === 'put') {
    if (row && row.deletedAt && !op.undelete) {
      throw storeError_('DELETED', '이미 삭제된 항목이에요.');
    }
    let data = op.data;
    if (kind === 'array') {
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw storeError_('BAD_DATA', '항목 내용이 이상해요.');
      if (String(data.id) !== id) throw storeError_('BAD_ID', 'id가 서로 달라요.');
    }
    if (kind === 'set') data = true;
    const json = JSON.stringify(data === undefined ? null : data);
    checkRowSize_(json, c, id);
    const wasLive = !!(row && !row.deletedAt);
    if (wasLive && row.json === json) return null; // 바뀐 게 없음
    if (!row) {
      row = { c: c, id: id };
      store.index[key] = row;
      store.rows.push(row);
    }
    row.rev = rev; row.updatedAt = now; row.deletedAt = ''; row.updatedBy = actor; row.json = json;
    return { row: row, summary: { op: 'put', c: c, id: id, isNew: !wasLive, data: data } };
  }

  if (op.op === 'patch') {
    if (kind !== 'array') throw storeError_('BAD_OP', '이 데이터 종류는 patch를 쓸 수 없어요.');
    if (!row) throw storeError_('NOT_FOUND', '항목을 찾을 수 없어요.');
    if (row.deletedAt) throw storeError_('DELETED', '이미 삭제된 항목이에요.');
    const before = parseJsonSafe_(row.json, {});
    const data = parseJsonSafe_(row.json, {});
    applyPatch_(data, op);
    data.id = before.id;
    const json = JSON.stringify(data);
    if (json === row.json) return null;
    checkRowSize_(json, c, id);
    row.rev = rev; row.updatedAt = now; row.updatedBy = actor; row.json = json;
    return { row: row, summary: { op: 'patch', c: c, id: id, isNew: false, data: data, before: before } };
  }

  if (op.op === 'del') {
    if (!row || row.deletedAt) return null;
    row.rev = rev; row.updatedAt = now; row.deletedAt = now; row.updatedBy = actor;
    return { row: row, summary: { op: 'del', c: c, id: id, before: parseJsonSafe_(row.json, null) } };
  }

  throw storeError_('BAD_OP', '알 수 없는 변경 종류: ' + op.op);
}

/**
 * 여러 변경을 한 번에 저장해요. (반드시 withLock_ 안에서 호출)
 * 일부가 거절돼도 나머지는 저장되고, 거절된 목록을 돌려줘요.
 */
function commitOps_(ops, actor, opts) {
  opts = opts || {};
  if (!Array.isArray(ops)) throw storeError_('BAD_OPS', '변경 목록이 이상해요.');
  if (!opts.unlimited && ops.length > STORE.MAX_OPS) throw storeError_('TOO_MANY_OPS', '한 번에 너무 많이 바꾸려고 했어요 (' + ops.length + '개).');
  const meta = getMeta_();
  assertMigrated_(meta);
  const store = readItems_();
  const currentRev = Number(meta.rev) || 0;
  const nextRev = currentRev + 1;
  const now = new Date().toISOString();
  const applied = [];
  const rejected = [];
  const touched = [];

  ops.forEach(function (op, i) {
    try {
      const res = applyOp_(store, op, meta, nextRev, now, actor);
      if (!res) return;
      applied.push(res.summary);
      touched.push(res.row);
    } catch (e) {
      rejected.push({ i: i, c: op && op.c, id: op && op.id, reason: e.code || 'ERROR', message: e.message });
    }
  });

  if (applied.length === 0) return { rev: currentRev, applied: applied, rejected: rejected };
  writeRows_(store, touched);
  setMeta_({ rev: nextRev });
  return { rev: nextRev, applied: applied, rejected: rejected };
}

/* ------------------------------ 읽기 ------------------------------ */

function changesSince_(sinceRev) {
  const meta = getMeta_();
  assertMigrated_(meta);
  const rev = Number(meta.rev) || 0;
  const purgedRev = Number(meta.purgedRev) || 0;
  sinceRev = Number(sinceRev) || 0;
  if (sinceRev < purgedRev) return { rev: rev, fullReload: true };
  if (sinceRev >= rev) return { rev: rev, changes: [] };
  const store = readItems_();
  const changes = store.rows
    .filter(function (row) { return row.rev > sinceRev; })
    .map(function (row) {
      return {
        c: row.c, id: row.id, rev: row.rev,
        deleted: !!row.deletedAt,
        data: row.deletedAt ? null : parseJsonSafe_(row.json, null)
      };
    });
  return { rev: rev, changes: changes };
}

// 살아있는 데이터 전체를 종류별로 모아요 (삭제된 항목 제외)
function snapshot_() {
  const meta = getMeta_();
  assertMigrated_(meta);
  const store = readItems_();
  const arrays = {}, maps = {}, sets = {};
  ARRAY_COLLECTIONS.forEach(function (c) { arrays[c] = []; });
  MAP_COLLECTIONS.forEach(function (c) { maps[c] = {}; });
  SET_COLLECTIONS.forEach(function (c) { sets[c] = []; });

  store.rows.forEach(function (row) {
    if (row.deletedAt) return;
    const kind = collectionKind_(row.c, meta);
    const v = parseJsonSafe_(row.json, undefined);
    if (v === undefined) return;
    if (kind === 'array') (arrays[row.c] = arrays[row.c] || []).push(v);
    else if (kind === 'map') (maps[row.c] = maps[row.c] || {})[row.id] = v;
    else if (kind === 'set') (sets[row.c] = sets[row.c] || []).push(row.id);
  });
  return { meta: meta, rev: Number(meta.rev) || 0, purgedRev: Number(meta.purgedRev) || 0, arrays: arrays, maps: maps, sets: sets };
}

function maxNumericId_(list) {
  return (list || []).reduce(function (m, x) {
    const n = Number(x && x.id);
    return isFinite(n) ? Math.max(m, n) : m;
  }, 0);
}

// 예전 A1과 같은 모양의 전체 데이터로 조립해요 (관리자앱·백업 파일·옛 버전 앱 호환용)
function assembleLegacy_(snap) {
  snap = snap || snapshot_();
  const out = {
    version: 2,
    savedAt: new Date().toISOString(),
    academyName: snap.maps.settings.academyName || ''
  };
  Object.keys(snap.arrays).forEach(function (c) { out[c] = snap.arrays[c]; });
  const allStudents = out.students || [];
  out.students = allStudents.filter(function (s) { return !s.withdrawDate; });
  out.withdrawnStudents = allStudents.filter(function (s) { return !!s.withdrawDate; });
  Object.keys(snap.maps).forEach(function (c) { if (c !== 'settings') out[c] = snap.maps[c]; });
  Object.keys(snap.sets).forEach(function (c) { out[c] = snap.sets[c]; });
  LEGACY_COUNTERS.forEach(function (pair) {
    const lists = pair[1].map(function (c) { return snap.arrays[c] || []; });
    out[pair[0]] = Math.max.apply(null, lists.map(maxNumericId_).concat([0])) + 1;
  });
  out.storeRev = snap.rev;
  return out;
}

/* ------------------------------ 옛 버전 앱 저장 처리 ------------------------------ */

/**
 * 옛 버전 앱이 보낸 "전체 데이터"를 안전한 변경 목록으로 바꿔요.
 *  - 없는 항목은 새로 추가
 *  - 있는 항목은 바뀐 필드만 반영 (필드를 지우거나 퇴원을 되돌리는 건 무시)
 *  - 목록 필드(doneBy 등)는 추가만 반영
 *  - 삭제된 항목(tombstone)은 절대 되살리지 않음
 *  - 옛 앱이 빠뜨린 항목은 지우지 않음 (옛 앱의 삭제는 전환 기간 동안 반영 안 됨)
 */
function legacyOpsFromFullData_(incoming) {
  const meta = getMeta_();
  assertMigrated_(meta);
  const store = readItems_();
  const ops = [];

  function liveRow(c, id) {
    const row = store.index[c + '' + id];
    if (row && row.deletedAt) return 'deleted';
    return row || null;
  }

  function arrayItems(c) {
    if (c === 'students') return (incoming.students || []).concat(incoming.withdrawnStudents || []);
    return incoming[c] || [];
  }

  const arrayNames = ARRAY_COLLECTIONS.concat(
    Object.keys(parseJsonSafe_(meta.extraCollections, {})).filter(function (c) { return collectionKind_(c, meta) === 'array'; })
  );
  arrayNames.forEach(function (c) {
    const items = arrayItems(c);
    if (!Array.isArray(items)) return;
    items.forEach(function (item) {
      if (!item || typeof item !== 'object' || item.id === undefined || item.id === null) return;
      const id = String(item.id);
      const row = liveRow(c, id);
      if (row === 'deleted') return;
      if (!row) { ops.push({ op: 'put', c: c, id: id, data: item }); return; }
      const existing = parseJsonSafe_(row.json, {});
      const setFields = SET_FIELDS[c] || [];
      const patch = { op: 'patch', c: c, id: id, set: {}, addToSet: {} };
      let changed = false;
      Object.keys(item).forEach(function (k) {
        if (k === 'id') return;
        if (setFields.indexOf(k) >= 0) {
          const have = Array.isArray(existing[k]) ? existing[k] : [];
          const add = (Array.isArray(item[k]) ? item[k] : []).filter(function (v) { return have.indexOf(v) === -1; });
          if (add.length) { patch.addToSet[k] = add; changed = true; }
          return;
        }
        if (JSON.stringify(existing[k]) !== JSON.stringify(item[k])) { patch.set[k] = item[k]; changed = true; }
      });
      if (changed) ops.push(patch);
    });
  });

  MAP_COLLECTIONS.concat(
    Object.keys(parseJsonSafe_(meta.extraCollections, {})).filter(function (c) { return collectionKind_(c, meta) === 'map'; })
  ).forEach(function (c) {
    if (c === 'settings') return;
    const obj = incoming[c];
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
    Object.keys(obj).forEach(function (k) {
      const row = liveRow(c, k);
      if (row === 'deleted') return;
      const json = JSON.stringify(obj[k]);
      if (row && row.json === json) return;
      ops.push({ op: 'put', c: c, id: k, data: obj[k] });
    });
  });

  SET_COLLECTIONS.forEach(function (c) {
    (Array.isArray(incoming[c]) ? incoming[c] : []).forEach(function (v) {
      const id = String(v);
      if (!id) return;
      const row = liveRow(c, id);
      if (row) return; // 이미 있거나 삭제됨
      ops.push({ op: 'put', c: c, id: id, data: true });
    });
  });

  if (incoming.academyName) {
    const row = liveRow('settings', 'academyName');
    if (row !== 'deleted' && (!row || row.json !== JSON.stringify(incoming.academyName))) {
      ops.push({ op: 'put', c: 'settings', id: 'academyName', data: incoming.academyName });
    }
  }
  return ops;
}

function logLegacyRequest_(reason, body) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sh = ss.getSheetByName(STORE.LEGACY_LOG);
    if (!sh) {
      sh = ss.insertSheet(STORE.LEGACY_LOG);
      sh.getRange('A:C').setNumberFormat('@');
      sh.getRange(1, 1, 1, 3).setValues([['time', 'reason', 'body (앞부분)']]).setFontWeight('bold');
    }
    sh.appendRow([new Date().toISOString(), reason, String(body || '').slice(0, 40000)]);
  } catch (e) {
    Logger.log('LegacyLog 기록 실패: ' + e.message);
  }
}
