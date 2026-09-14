/**
 * ============================================================================
 * 🚦 웹앱 입구 (doGet / doPost) — 2026-09-15
 * ============================================================================
 * 새 방식 (v2): POST text/plain {v:2, clientVersion, action, auth, ...}
 *   → {ok:true, ...} 또는 {ok:false, error:'코드', message:'안내문'}
 *   (Apps Script는 요청 헤더를 못 읽어서 비밀번호/증표는 본문(auth)에 넣어요)
 *
 * 옛 방식 (예전 버전 앱): GET = 전체 데이터, POST = 전체 데이터 저장
 *   스크립트 속성 LEGACY_MODE 로 전환 기간을 관리해요.
 *     full     : 옛 앱도 읽기/저장 가능 (단, 삭제는 반영 안 되고 지운 항목은 되살리지 않음)
 *     readonly : 옛 앱은 읽기만, 저장 요청은 LegacyLog 시트에 기록만
 *     off      : 옛 방식 완전 차단 (보안은 이 단계가 되어야 완성)
 *   아직 migrateToV2 를 실행하기 전이면 예전 A1 방식 그대로 동작해요.
 * ============================================================================
 */

const MIN_CLIENT_VERSION = 2;

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function errorJson_(err) {
  if (!err.code) Logger.log('서버 오류: ' + (err.stack || err.message));
  return json_({
    ok: false,
    error: err.code || 'SERVER_ERROR',
    message: err.code ? err.message : ('서버에서 오류가 났어요: ' + err.message)
  });
}

function legacyMode_() {
  return String(props_().getProperty('LEGACY_MODE') || 'full').toLowerCase();
}

function upgradeRequiredJson_() {
  return json_({ ok: false, error: 'UPGRADE_REQUIRED', message: '앱이 새 버전으로 바뀌었어요. 화면을 새로고침(또는 앱을 완전히 닫았다 다시 열기)해주세요.' });
}

function doGet(e) {
  if (!isMigrated_()) {
    const json = getDataSheet().getRange('A1').getValue() || '{}';
    return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
  }
  if (legacyMode_() === 'off') return upgradeRequiredJson_();
  return json_(assembleLegacy_());
}

function doPost(e) {
  const raw = (e && e.postData && e.postData.contents) || '';
  let body;
  try {
    body = JSON.parse(raw);
  } catch (err) {
    return json_({ ok: false, error: 'BAD_JSON', message: '요청 내용을 읽지 못했어요.' });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json_({ ok: false, error: 'BAD_JSON', message: '요청 내용을 읽지 못했어요.' });
  }
  if (body.v === 2) return handleV2_(body);
  return handleLegacyPost_(body, raw);
}

/* ------------------------------ 새 방식 (v2) ------------------------------ */

const V2_ACTIONS = {
  adminPing: { admin: true, fn: function () { return { ok: true, migrated: isMigrated_(), legacyMode: legacyMode_() }; } },
  adminLoad: { admin: true, fn: adminLoad_ },
  adminChanges: { admin: true, fn: function (b) { return Object.assign({ ok: true }, changesSince_(b.sinceRev)); } },
  adminCommit: { admin: true, fn: adminCommit_ },
  adminBackupNow: { admin: true, fn: function () { return { ok: true, file: backupNow_('manual') }; } },
  adminListBackups: { admin: true, fn: function () { return { ok: true, files: listBackupFiles_() }; } },
  adminClearLoginLock: { admin: true, fn: function (b) { clearLoginLock_(b.name); return { ok: true }; } },
  analyzeExam: { admin: true, raw: function (b) { return handleAnalyzeExam(b); } },
  generateLearningReport: { admin: true, raw: function (b) { return handleGenerateLearningReport(b); } },
  // 다른 파일(Portal.js)의 함수는 파일 로딩 순서와 상관없도록 호출 시점에 찾아요
  parentLogin: { fn: function (b) { return parentLogin_(b); } },
  parentLoad: { fn: function (b) { return parentLoad_(b); } },
  parentToggleHomework: { fn: function (b) { return parentToggleHomework_(b); } },
  parentSubmitQuiz: { fn: function (b) { return parentSubmitQuiz_(b); } },
  parentSendMessage: { fn: function (b) { return parentSendMessage_(b); } },
  parentRegisterPushToken: { fn: function (b) { return parentRegisterPushToken_(b); } }
};

function handleV2_(body) {
  try {
    if (Number(body.clientVersion || 0) < MIN_CLIENT_VERSION) return upgradeRequiredJson_();
    const action = Object.prototype.hasOwnProperty.call(V2_ACTIONS, body.action) ? V2_ACTIONS[body.action] : null;
    if (!action) return json_({ ok: false, error: 'UNKNOWN_ACTION', message: '알 수 없는 요청이에요.' });
    if (action.admin) requireAdmin_(body.auth);
    if (action.raw) return action.raw(body); // 기존 AI 함수는 자체적으로 JSON 응답을 만들어요
    return json_(action.fn(body));
  } catch (err) {
    return errorJson_(err);
  }
}

function adminLoad_() {
  const snap = snapshot_();
  return { ok: true, rev: snap.rev, purgedRev: snap.purgedRev, data: assembleLegacy_(snap) };
}

function adminCommit_(body) {
  const actor = 'admin:' + String(body.deviceId || '').slice(0, 40);
  const result = withLock_(function () { return commitOps_(body.ops, actor); });
  afterCommit_(result);
  const since = changesSince_(body.baseRev);
  return {
    ok: true,
    rev: result.rev,
    rejected: result.rejected,
    changesRev: since.rev,
    changes: since.changes || null,
    fullReload: !!since.fullReload
  };
}

/* ------------------------------ 옛 방식 ------------------------------ */

function handleLegacyPost_(body, raw) {
  const mode = legacyMode_();
  const migrated = isMigrated_();

  if (body.action === 'analyzeExam' || body.action === 'generateLearningReport') {
    if (migrated && mode === 'off') return upgradeRequiredJson_();
    return body.action === 'analyzeExam' ? handleAnalyzeExam(body) : handleGenerateLearningReport(body);
  }
  // ⚠️ 예전에는 모르는 action도 전부 "전체 데이터 저장"으로 처리돼서 A1이 덮어써질 수 있었어요.
  if (body.action) return json_({ ok: false, error: 'UNKNOWN_ACTION', message: '알 수 없는 요청이에요.' });
  if (!Array.isArray(body.students)) {
    logLegacyRequest_('NOT_FULL_DATA', raw);
    return json_({ ok: false, error: 'BAD_DATA', message: '전체 데이터 형식이 아니라서 저장하지 않았어요.' });
  }

  if (!migrated) return legacyWriteA1_(body, raw);

  if (mode !== 'full') {
    logLegacyRequest_('LEGACY_' + mode.toUpperCase(), raw);
    return upgradeRequiredJson_();
  }
  try {
    const result = withLock_(function () { return commitOps_(legacyOpsFromFullData_(body), 'legacy'); });
    afterCommit_(result);
    return json_({ ok: true, rev: result.rev, rejected: result.rejected.length });
  } catch (err) {
    return errorJson_(err);
  }
}

// migrateToV2 전: 예전과 같은 A1 저장. 단, JSON 확인을 먼저 하고 한 번에 하나씩만 저장해요.
function legacyWriteA1_(data, raw) {
  if (raw.length > 50000) {
    return json_({ ok: false, error: 'TOO_LARGE', message: '데이터가 구글시트 한 칸 한도(5만 자)를 넘었어요.' });
  }
  let oldData = {};
  try {
    withLock_(function () {
      const dataSheet = getDataSheet();
      oldData = parseJsonSafe_(dataSheet.getRange('A1').getValue(), {});
      dataSheet.getRange('A1').setValue(raw);
    });
  } catch (err) {
    return errorJson_(err);
  }
  try {
    updateAttendanceSheets(SpreadsheetApp.getActiveSpreadsheet(), data);
  } catch (err) {
    Logger.log('출결 시트 업데이트 오류: ' + err.message);
  }
  try {
    notifyNewHomework_(oldData, data);
    notifyNewGeneralMakeup_(oldData, data);
    notifyNewParentMessage_(oldData, data);
  } catch (notifyErr) {
    Logger.log('알림 발송 중 오류: ' + notifyErr.message);
  }
  return json_({ ok: true });
}

/* ------------------------------ 저장 후 처리 ------------------------------ */

// 저장이 끝난 뒤(잠금 해제 후) 알림 발송 + 바뀐 달의 출결 시트만 다시 만들기
function afterCommit_(result) {
  if (!result || !result.applied || result.applied.length === 0) return;
  let snap = null;
  function getSnap() { return snap || (snap = snapshot_()); }

  try {
    notifyFromApplied_(result.applied, getSnap);
  } catch (e) {
    Logger.log('알림 발송 중 오류: ' + e.message);
  }

  try {
    const months = {};
    result.applied.forEach(function (a) {
      if (a.c === 'attendanceRecords') {
        const rec = a.data || a.before || {};
        if (rec.date) months[String(rec.date).slice(0, 7)] = true;
      }
      if (a.c === 'students') {
        months[Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM')] = true;
      }
    });
    if (Object.keys(months).length) rebuildAttendanceSheets_(getSnap(), months);
  } catch (e) {
    Logger.log('출결 시트 업데이트 오류: ' + e.message);
  }
}

// months 가 없으면 전체 달, 있으면 그 달만 다시 만들어요 (기존 updateAttendanceSheets 재사용)
function rebuildAttendanceSheets_(snap, months) {
  const legacy = assembleLegacy_(snap);
  const records = months
    ? (legacy.attendanceRecords || []).filter(function (r) { return r.date && months[String(r.date).slice(0, 7)]; })
    : legacy.attendanceRecords;
  updateAttendanceSheets(SpreadsheetApp.getActiveSpreadsheet(), { students: legacy.students, attendanceRecords: records });
}

function targetStudents_(target, students) {
  if (!target) return [];
  if (target.type === 'class') return students.filter(function (s) { return s.className === target.className; });
  if (target.type === 'individual') {
    const ids = (target.studentIds || []).map(String);
    return students.filter(function (s) { return ids.indexOf(String(s.id)) !== -1; });
  }
  return [];
}

function notifyFromApplied_(applied, getSnap) {
  const fresh = applied.filter(function (a) {
    return a.op === 'put' && a.isNew && ['homeworkAssignments', 'generalMakeups', 'parentMessages'].indexOf(a.c) >= 0;
  });
  if (fresh.length === 0) return;
  const snap = getSnap();
  const students = snap.arrays.students.filter(function (s) { return !s.withdrawDate; });

  fresh.forEach(function (a) {
    const d = a.data || {};
    if (a.c === 'homeworkAssignments') {
      targetStudents_(d.target, students).forEach(function (s) {
        sendPushToTokens(s.pushTokens, '📔 새 숙제가 도착했어요', d.text, './parent_portal.html');
      });
    } else if (a.c === 'generalMakeups') {
      targetStudents_(d.target, students).forEach(function (s) {
        sendPushToTokens(s.pushTokens, '🗓️ 보강 일정이 등록됐어요', d.date + (d.reason ? ' · ' + d.reason : ''), './parent_portal.html');
      });
    } else if (a.c === 'parentMessages') {
      if (d.from === 'admin') {
        const s = students.find(function (x) { return String(x.id) === String(d.studentId); });
        if (s) sendPushToTokens(s.pushTokens, '💬 선생님 답장이 도착했어요', d.message, './parent_portal.html');
      } else {
        sendPushToTokens(snap.sets.adminPushTokens, '💬 학부모 메시지가 도착했어요', (d.studentName || '') + ': ' + d.message, './imm_academy_system.html');
      }
    }
  });
}
