/**
 * ============================================================================
 * 💾 백업 · 이전(migration) · 되돌리기 — 2026-09-15 새 저장 구조 대응
 * ============================================================================
 * 편집기에서 직접 실행하는 함수 (위쪽 함수 선택 → 실행):
 *  - authorizeOnce        : 새로 필요한 권한(드라이브·메일·트리거)을 한 번 승인해요. 배포 전에 꼭!
 *  - migrateToV2          : A1 한 칸 → Items 시트(한 줄 = 레코드)로 옮겨요. A1은 그대로 남겨둬요.
 *  - verifyMigration      : 옮긴 데이터가 A1과 같은지 비교해서 로그로 보여줘요.
 *  - installTriggers      : 매일 새벽 3시 자동 백업 트리거를 만들어요 (이미 있으면 그대로).
 *  - backupDataSnapshot   : 지금 바로 백업 (매일 트리거가 실행하는 함수, 기존 이름 그대로)
 *  - listBackups          : 백업 파일 목록 보기
 *  - restoreFromBackup    : 아래 targetDate 날짜의 백업으로 되돌리기 (정말 필요할 때만)
 *  - rollbackToA1         : 새 구조를 멈추고 예전 A1 방식으로 되돌리기 (문제가 생겼을 때)
 *
 * 매일 자동 백업은 "아임수학학원_백업" 드라이브 폴더에 backup_2026-09-15.json 처럼 저장되고,
 * 관리자앱 "데이터 복원"에 그대로 넣을 수 있는 형식이에요.
 * 30일 지난 백업은 지우되, 매달 1일 백업은 1년 넘게 남겨요.
 * ============================================================================
 */

const BACKUP_CONFIG = {
  FOLDER_NAME: '아임수학학원_백업',
  RETENTION_DAYS: 30,
  MONTHLY_RETENTION_DAYS: 400,
  TOMBSTONE_DAYS: 90,
  TIMEZONE: 'Asia/Seoul'
};

/* ------------------------------ 백업 ------------------------------ */

function currentFullData_() {
  if (isMigrated_()) return assembleLegacy_();
  return parseJsonSafe_(getDataSheet().getRange('A1').getValue(), null);
}

function getOrCreateBackupFolder_() {
  // 테스트 사본은 스크립트 속성 BACKUP_FOLDER_NAME 으로 다른 폴더를 써요 (실제 백업과 안 섞이게)
  const name = props_().getProperty('BACKUP_FOLDER_NAME') || BACKUP_CONFIG.FOLDER_NAME;
  const folders = DriveApp.getFoldersByName(name);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(name);
}

/** 백업 파일을 만들고 파일 이름을 돌려줘요. reason: daily / manual / before-restore 등 */
function backupNow_(reason) {
  const data = currentFullData_();
  // ⚠️ 텅 빈 데이터를 "백업"으로 저장하면 나중에 그걸로 복원했다가 다 날릴 수 있어서 막아요
  if (!data || !Array.isArray(data.students) || data.students.length === 0) {
    throw storeError_('BACKUP_SKIPPED', '학생 데이터가 비어 보여서 백업을 건너뛰었어요.');
  }
  const folder = getOrCreateBackupFolder_();
  const stamp = Utilities.formatDate(new Date(), BACKUP_CONFIG.TIMEZONE, 'yyyy-MM-dd_HHmm');
  let fileName;
  if (reason === 'daily') {
    fileName = 'backup_' + stamp.slice(0, 10) + '.json';
    const existing = folder.getFilesByName(fileName);
    while (existing.hasNext()) existing.next().setTrashed(true);
  } else {
    fileName = 'backup_' + stamp + '_' + String(reason || 'manual').replace(/[^\w-]/g, '') + '.json';
  }
  folder.createFile(fileName, JSON.stringify(data), MimeType.PLAIN_TEXT);
  return fileName;
}

function listBackupFiles_() {
  const files = getOrCreateBackupFolder_().getFiles();
  const list = [];
  while (files.hasNext()) {
    const f = files.next();
    list.push({ name: f.getName(), createdAt: f.getDateCreated().toISOString(), size: f.getSize() });
  }
  list.sort(function (a, b) { return b.name.localeCompare(a.name); });
  return list;
}

function notifyOwnerByMail_(subject, body) {
  try {
    MailApp.sendEmail(Session.getEffectiveUser().getEmail(), subject, body);
  } catch (e) {
    Logger.log('메일 발송 실패: ' + e.message);
  }
}

/** 매일 트리거가 실행해요 (기존 트리거 이름 그대로) */
function backupDataSnapshot() {
  try {
    const name = backupNow_('daily');
    Logger.log('✅ 백업 완료: ' + name);
  } catch (e) {
    Logger.log('❌ 백업 실패: ' + e.message);
    notifyOwnerByMail_('[아임수학학원] 자동 백업 실패', '오늘 자동 백업이 실패했어요.\n\n' + e.message);
  }
  try {
    cleanupOldBackups_(getOrCreateBackupFolder_());
  } catch (e) {
    Logger.log('오래된 백업 정리 실패: ' + e.message);
  }
  if (!isMigrated_()) return;
  try {
    const purged = withLock_(function () { return purgeTombstones_(BACKUP_CONFIG.TOMBSTONE_DAYS); });
    if (purged) Logger.log('🧹 ' + BACKUP_CONFIG.TOMBSTONE_DAYS + '일 지난 삭제 기록 ' + purged + '줄 정리');
  } catch (e) {
    Logger.log('삭제 기록 정리 실패: ' + e.message);
  }
  try {
    rebuildAttendanceSheets_(snapshot_(), null);
  } catch (e) {
    Logger.log('출결 시트 전체 재생성 실패: ' + e.message);
  }
}

function cleanupOldBackups_(folder) {
  const now = Date.now();
  const files = folder.getFiles();
  let deleted = 0;
  while (files.hasNext()) {
    const file = files.next();
    const name = file.getName();
    if (name.indexOf('premigration_') === 0 || name.indexOf('rollback_') === 0) continue; // 이전·되돌리기 백업은 계속 보관
    const ageDays = (now - file.getDateCreated().getTime()) / 86400000;
    const isMonthly = /^backup_\d{4}-\d{2}-01/.test(name);
    const limit = isMonthly ? BACKUP_CONFIG.MONTHLY_RETENTION_DAYS : BACKUP_CONFIG.RETENTION_DAYS;
    if (ageDays > limit) {
      file.setTrashed(true);
      deleted++;
    }
  }
  if (deleted > 0) Logger.log('🗑️ 오래된 백업 ' + deleted + '개를 정리했어요.');
}

// 오래된 삭제 기록(tombstone) 줄을 지워요. 아래쪽 줄부터 하나씩 지워서 안전하게.
function purgeTombstones_(days) {
  const meta = getMeta_();
  assertMigrated_(meta);
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const store = readItems_();
  const targets = store.rows
    .filter(function (row) { return row.deletedAt && row.deletedAt < cutoff; })
    .sort(function (a, b) { return b.r - a.r; });
  if (targets.length === 0) return 0;
  targets.forEach(function (row) { store.sheet.deleteRow(row.r); });
  setMeta_({ purgedRev: meta.rev });
  return targets.length;
}

function listBackups() {
  const list = listBackupFiles_();
  Logger.log(list.length ? list.map(function (f) { return f.name; }).join('\n') : '아직 백업이 없어요.');
}

/**
 * ⚠️ 복원 — 정말 필요할 때만 사용하세요.
 * targetDate에 날짜(YYYY-MM-DD)를 넣고 실행하면 그 날짜 백업으로 되돌려요.
 * 되돌리기 직전 상태도 자동으로 백업해둬요(before-restore).
 */
function restoreFromBackup() {
  const targetDate = '여기에_되돌릴_날짜_입력_예:2026-08-31'; // ⚠️ 실행 전 반드시 날짜로 바꿔주세요

  if (targetDate.indexOf('여기에') === 0) {
    Logger.log('❌ 위 targetDate 값을 실제 날짜(예: "2026-08-31")로 바꾼 다음 다시 실행해주세요.');
    return;
  }
  const files = getOrCreateBackupFolder_().getFilesByName('backup_' + targetDate + '.json');
  if (!files.hasNext()) {
    Logger.log('❌ backup_' + targetDate + '.json 파일을 찾을 수 없어요. listBackups로 날짜를 확인해주세요.');
    return;
  }
  const backupData = parseJsonSafe_(files.next().getBlob().getDataAsString(), null);
  if (!backupData || !Array.isArray(backupData.students)) {
    Logger.log('❌ 백업 파일 내용이 이상해서 안전하게 복원을 중단했어요.');
    return;
  }
  try {
    Logger.log('되돌리기 전 현재 상태 백업: ' + backupNow_('before-restore'));
  } catch (e) {
    Logger.log('⚠️ 현재 상태 백업은 건너뜀: ' + e.message);
  }
  if (!isMigrated_()) {
    withLock_(function () { getDataSheet().getRange('A1').setValue(JSON.stringify(backupData)); });
    Logger.log('✅ 복원 완료 (A1): 학생 ' + backupData.students.length + '명');
    return;
  }
  const result = withLock_(function () { return commitOps_(restoreOpsFromLegacy_(backupData), 'restore', { unlimited: true }); });
  Logger.log('✅ 복원 완료: 변경 ' + result.applied.length + '건, 거절 ' + result.rejected.length + '건 (학생 ' + backupData.students.length + '명)');
}

// 백업 데이터와 똑같아지도록: 백업에 있는 건 넣고(삭제된 것도 되살림), 백업에 없는 건 삭제
function restoreOpsFromLegacy_(backupData) {
  const built = buildRowsFromLegacy_(backupData);
  if (built.errors.length) throw new Error('백업 파일에 문제가 있어요: ' + built.errors.join(' / '));
  const meta = getMeta_();
  const store = readItems_();
  const ops = [];
  const wanted = {};
  built.rows.forEach(function (x) {
    const key = x.c + '' + x.id;
    wanted[key] = true;
    const row = store.index[key];
    if (row && !row.deletedAt && row.json === x.json) return;
    ops.push({ op: 'put', c: x.c, id: x.id, data: JSON.parse(x.json), undelete: true });
  });
  store.rows.forEach(function (row) {
    if (row.deletedAt || wanted[row.c + '' + row.id]) return;
    if (!collectionKind_(row.c, meta)) return;
    ops.push({ op: 'del', c: row.c, id: row.id });
  });
  return ops;
}

/* ------------------------------ 이전 (A1 → Items) ------------------------------ */

// 예전 전체 데이터(A1 또는 백업 파일)를 Items 줄 목록으로 바꿔요
function buildRowsFromLegacy_(data) {
  const rows = [];
  const errors = [];
  const log = [];
  const extra = {};
  const seen = {};

  function add(c, id, value) {
    const key = c + '' + id;
    if (seen[key]) { log.push('⚠️ 같은 id가 두 번 있어서 뒤의 것은 건너뜀: ' + c + ' #' + id); return; }
    seen[key] = true;
    const json = JSON.stringify(value);
    if (json.length > STORE.MAX_ROW_CHARS) { errors.push(c + ' #' + id + ' 항목이 너무 커요(' + json.length + '자)'); return; }
    rows.push({ c: c, id: String(id), json: json });
  }

  // 퇴원생을 먼저 넣어요: 재원/퇴원 목록에 같은 학생이 둘 다 있으면(예전 되살아남 버그) 퇴원으로 처리
  const activeIds = {};
  (data.students || []).forEach(function (s) { if (s && s.id !== undefined) activeIds[String(s.id)] = s.name; });
  (data.withdrawnStudents || []).forEach(function (s) {
    if (!s || s.id === undefined || s.id === null) { errors.push('퇴원생 목록에 id 없는 항목이 있어요'); return; }
    if (activeIds[String(s.id)] !== undefined) log.push('⚠️ 재원/퇴원 목록에 둘 다 있어서 퇴원으로 처리: ' + s.name + ' (#' + s.id + ') — 확인해주세요');
    const item = Object.assign({}, s);
    if (!item.withdrawDate) item.withdrawDate = 'unknown';
    add('students', s.id, item);
  });
  (data.students || []).forEach(function (s) {
    if (!s || s.id === undefined || s.id === null) { errors.push('학생 목록에 id 없는 항목이 있어요'); return; }
    const item = Object.assign({}, s);
    delete item.withdrawDate;
    add('students', s.id, item);
  });

  Object.keys(data).forEach(function (key) {
    const v = data[key];
    if (key === 'students' || key === 'withdrawnStudents') return;
    if (/^next\w*Id$/.test(key) || ['version', 'savedAt', 'exportedAt', 'storeRev'].indexOf(key) >= 0) return;
    if (v === null || v === undefined) return;

    if (key === 'academyName') { if (v) add('settings', 'academyName', v); return; }

    if (SET_COLLECTIONS.indexOf(key) >= 0) {
      (Array.isArray(v) ? v : []).forEach(function (t) { if (t !== null && t !== undefined && t !== '') add(key, String(t), true); });
      return;
    }

    if (Array.isArray(v)) {
      const known = ARRAY_COLLECTIONS.indexOf(key) >= 0;
      const allObjects = v.every(function (x) { return x && typeof x === 'object' && !Array.isArray(x); });
      if (!allObjects) { errors.push(key + ' 목록에 형식이 이상한 항목이 있어요'); return; }
      if (!known) { extra[key] = 'array'; log.push('ℹ️ 새 목록 발견: ' + key + ' (' + v.length + '개)'); }

      // 예전 버전 앱이 id 없이 저장한 항목(예: 초기 학부모 메시지)에는 겹치지 않는 id를 붙여요.
      // 날짜 + 순서로 만들어서, 같은 데이터로 다시 실행해도 같은 id가 나와요.
      const used = {};
      v.forEach(function (x) { if (x.id !== undefined && x.id !== null) used[String(x.id)] = true; });
      let assigned = 0;
      v.forEach(function (x, i) {
        let item = x;
        if (x.id === undefined || x.id === null) {
          const t = Date.parse(x.date || x.createdAt || '');
          let id = (isFinite(t) ? t * 1000 : 900000000000000) + i;
          while (used[String(id)]) id++;
          used[String(id)] = true;
          item = Object.assign({ id: id }, x);
          assigned++;
        }
        add(key, item.id, item);
      });
      if (assigned) log.push('ℹ️ ' + key + ': id 없던 항목 ' + assigned + '개에 id를 붙였어요');
      return;
    }

    if (typeof v === 'object') {
      if (MAP_COLLECTIONS.indexOf(key) < 0) { extra[key] = 'map'; log.push('ℹ️ 새 맵 발견: ' + key); }
      Object.keys(v).forEach(function (k) { add(key, k, v[k]); });
      return;
    }

    add('settings', key, v);
  });

  return { rows: rows, errors: errors, log: log, extra: extra };
}

function migrateToV2() {
  if (isMigrated_()) {
    Logger.log('이미 새 구조로 옮겨져 있어요. (verifyMigration으로 확인할 수 있어요)');
    return;
  }
  const built = withLock_(function () {
    const raw = getDataSheet().getRange('A1').getValue();
    const data = parseJsonSafe_(raw, null);
    if (!data || !Array.isArray(data.students)) throw new Error('A1 데이터를 읽지 못해서 중단했어요.');

    const b = buildRowsFromLegacy_(data);
    if (b.errors.length) throw new Error('이전을 중단했어요: ' + b.errors.join(' / '));

    const sh = itemsSheet_();
    if (sh.getLastRow() > 1) throw new Error('Items 시트에 이미 내용이 있어요. 확인 후 비워주세요.');

    const stamp = Utilities.formatDate(new Date(), BACKUP_CONFIG.TIMEZONE, 'yyyy-MM-dd_HHmm');
    getOrCreateBackupFolder_().createFile('premigration_' + stamp + '.json', String(raw), MimeType.PLAIN_TEXT);

    const now = new Date().toISOString();
    const values = b.rows.map(function (x) { return [x.c, x.id, '1', now, '', 'migration', x.json]; });
    if (values.length) {
      sh.getRange(2, 1, values.length, 7).setNumberFormat('@');
      sh.getRange(2, 1, values.length, 7).setValues(values);
    }
    setMeta_({ schemaVersion: 2, rev: 1, purgedRev: 0, migratedAt: now, extraCollections: JSON.stringify(b.extra) });
    return b;
  });
  Logger.log('✅ 이전 완료: ' + built.rows.length + '줄');
  if (built.log.length) Logger.log(built.log.join('\n'));
  verifyMigration();
}

/** 옮긴 데이터(Items)가 원래 A1과 같은지 비교해요 */
function verifyMigration() {
  const original = parseJsonSafe_(getDataSheet().getRange('A1').getValue(), {});
  const rebuilt = assembleLegacy_();
  const problems = [];
  const counts = [];

  function byId(list) {
    const m = {};
    (list || []).forEach(function (x) { if (x && x.id !== undefined && m[String(x.id)] === undefined) m[String(x.id)] = x; });
    return m;
  }
  function stripWithdraw(s) {
    const c = Object.assign({}, s);
    delete c.withdrawDate;
    return JSON.stringify(c);
  }

  // 학생: 재원+퇴원을 합쳐서 비교
  const origStudents = byId((original.withdrawnStudents || []).concat(original.students || []));
  const newStudents = byId((rebuilt.withdrawnStudents || []).concat(rebuilt.students || []));
  Object.keys(origStudents).forEach(function (id) {
    if (!newStudents[id]) problems.push('학생 없음: #' + id);
    else if (stripWithdraw(origStudents[id]) !== stripWithdraw(newStudents[id])) problems.push('학생 내용 다름: #' + id);
  });
  counts.push('students ' + Object.keys(origStudents).length + ' → ' + Object.keys(newStudents).length +
    ' (재원 ' + rebuilt.students.length + ', 퇴원 ' + rebuilt.withdrawnStudents.length + ')');

  Object.keys(original).forEach(function (key) {
    if (key === 'students' || key === 'withdrawnStudents') return;
    if (/^next\w*Id$/.test(key) || ['version', 'savedAt', 'exportedAt'].indexOf(key) >= 0) return;
    const a = original[key];
    const b = rebuilt[key];
    if (key === 'academyName') {
      if ((a || '') !== (b || '')) problems.push('학원 이름 다름');
      return;
    }
    if (SET_COLLECTIONS.indexOf(key) >= 0) {
      const setA = Array.from(new Set((a || []).map(String))).sort();
      const setB = (b || []).map(String).sort();
      if (JSON.stringify(setA) !== JSON.stringify(setB)) problems.push(key + ' 목록 다름');
      counts.push(key + ' ' + setA.length + ' → ' + setB.length);
      return;
    }
    if (Array.isArray(a)) {
      const ma = byId(a);
      const mb = byId(b);
      Object.keys(ma).forEach(function (id) {
        if (!mb[id]) problems.push(key + ' #' + id + ' 없음');
        else if (JSON.stringify(ma[id]) !== JSON.stringify(mb[id])) problems.push(key + ' #' + id + ' 내용 다름');
      });
      // id 없던 항목은 새 id가 붙어서 위에서 비교가 안 되니 개수로 확인 (중복 id는 하나만 남아요)
      const noId = a.filter(function (x) { return !x || x.id === undefined || x.id === null; }).length;
      const expected = Object.keys(ma).length + noId;
      if ((b || []).length !== expected) problems.push(key + ' 개수 다름: 예상 ' + expected + ', 실제 ' + (b || []).length);
      counts.push(key + ' ' + a.length + ' → ' + (b || []).length);
      return;
    }
    if (a && typeof a === 'object') {
      Object.keys(a).forEach(function (k) {
        if (!b || JSON.stringify(a[k]) !== JSON.stringify(b[k])) problems.push(key + '[' + k + '] 다름');
      });
      counts.push(key + ' ' + Object.keys(a).length + '개 키');
      return;
    }
    const settingValue = snapshot_().maps.settings[key];
    if (JSON.stringify(settingValue) !== JSON.stringify(a)) problems.push('설정값 ' + key + ' 다름');
  });

  Logger.log('📊 개수 비교\n' + counts.join('\n'));
  if (problems.length) {
    Logger.log('⚠️ 차이 ' + problems.length + '건 (앞 50건):\n' + problems.slice(0, 50).join('\n'));
  } else {
    Logger.log('✅ 검증 통과: 새 구조의 데이터가 A1과 같아요.');
  }
  return problems;
}

/**
 * 🔙 새 구조에 문제가 생겼을 때: 지금 데이터를 예전 A1 형식으로 되돌려요.
 * 실행 후에는 옛 방식(A1)으로 동작하니, 관리자앱·포털도 예전 버전으로 되돌려야 해요.
 */
function rollbackToA1() {
  withLock_(function () {
    assertMigrated_();
    const data = assembleLegacy_();
    const json = JSON.stringify(data);
    const stamp = Utilities.formatDate(new Date(), BACKUP_CONFIG.TIMEZONE, 'yyyy-MM-dd_HHmm');
    getOrCreateBackupFolder_().createFile('rollback_' + stamp + '.json', json, MimeType.PLAIN_TEXT);
    if (json.length >= 50000) {
      throw new Error('데이터가 5만 자를 넘어서 A1에 넣을 수 없어요. 드라이브의 rollback_' + stamp + '.json 파일을 관리자앱 "데이터 복원"으로 불러와주세요.');
    }
    getDataSheet().getRange('A1').setValue(json);
    setMeta_({ schemaVersion: 'rolledback-' + stamp });
  });
  Logger.log('✅ A1 방식으로 되돌렸어요. (Items 시트는 참고용으로 남아 있어요)');
}

/* ------------------------------ 설치 도우미 ------------------------------ */

function installTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  Logger.log('현재 트리거:\n' + (triggers.map(function (t) { return '- ' + t.getHandlerFunction(); }).join('\n') || '(없음)'));
  const hasBackup = triggers.some(function (t) { return t.getHandlerFunction() === 'backupDataSnapshot'; });
  if (hasBackup) {
    Logger.log('✅ 자동 백업 트리거(backupDataSnapshot)가 이미 있어요.');
  } else {
    ScriptApp.newTrigger('backupDataSnapshot').timeBased().everyDays(1).atHour(3).inTimezone(BACKUP_CONFIG.TIMEZONE).create();
    Logger.log('✅ 매일 새벽 3시 자동 백업 트리거를 만들었어요.');
  }

  // 개념빈칸 리마인더: 오후 4시 + 저녁 8시 (기존 리마인더 트리거는 지우고 이 두 개로 맞춰요)
  let removed = 0;
  triggers.forEach(function (t) {
    if (t.getHandlerFunction() === 'sendConceptTestReminders') { ScriptApp.deleteTrigger(t); removed++; }
  });
  [16, 20].forEach(function (hour) {
    ScriptApp.newTrigger('sendConceptTestReminders').timeBased().everyDays(1).atHour(hour).inTimezone(BACKUP_CONFIG.TIMEZONE).create();
  });
  Logger.log('✅ 개념빈칸 리마인더: 오후 4시, 저녁 8시 (기존 리마인더 ' + removed + '개 교체)');
}

/** 새로 필요한 권한을 한 번 승인받기 위한 함수 (배포 전에 편집기에서 실행) */
function authorizeOnce() {
  DriveApp.getRootFolder();
  MailApp.getRemainingDailyQuota();
  ScriptApp.getProjectTriggers();
  CacheService.getScriptCache().get('ping');
  LockService.getScriptLock();
  SpreadsheetApp.getActiveSpreadsheet().getName();
  UrlFetchApp.getRequest('https://www.google.com');
  Logger.log('✅ 권한 확인 완료. 이제 배포해도 돼요.');
}
