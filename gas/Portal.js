/**
 * ============================================================================
 * 👨‍👩‍👧 학부모 포털 서버 기능 — 2026-09-15
 * ============================================================================
 * 예전: 포털이 전체 데이터(모든 학생·PIN 포함)를 받아서 브라우저에서 걸렀어요.
 * 지금: 로그인한 자녀(와 형제자매)의 데이터만 서버에서 골라서 내려줘요.
 *       학부모 쪽 저장(숙제 체크·퀴즈·메시지·알림 등록)도 그 한 가지만 바꿔요.
 * ============================================================================
 */

function newServerId_() {
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}

function kstToday_() {
  return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
}

function studentSummary_(s) {
  return { id: s.id, name: s.name, grade: s.grade };
}

function targetsStudent_(item, student) {
  const t = item && item.target;
  if (!t) return false;
  if (t.type === 'class') return !!student.className && t.className === student.className;
  if (t.type === 'individual') return (t.studentIds || []).map(String).indexOf(String(student.id)) !== -1;
  return false;
}

function pickKey_(map, key) {
  const out = {};
  if (map && key !== undefined && key !== null && Object.prototype.hasOwnProperty.call(map, String(key))) {
    out[String(key)] = map[String(key)];
  }
  return out;
}

function levelOfGrade_(grade) {
  if (!grade) return '';
  return String(grade).indexOf('초') === 0 ? '초등부' : String(grade).indexOf('중') === 0 ? '중등부' : '';
}

// 같은 학부(초등부/중등부) 데일리 테스트 평균 — 다른 학생 기록은 내려주지 않고 숫자만 계산
function groupAvgScore_(student, arrays) {
  const level = levelOfGrade_(student.grade);
  const byId = {};
  arrays.students.forEach(function (s) { byId[String(s.id)] = s; });
  const tests = arrays.dailyTests.filter(function (t) {
    const s = byId[String(t.studentId)];
    return s && levelOfGrade_(s.grade) === level;
  });
  if (tests.length === 0) return null;
  return Math.round(tests.reduce(function (sum, t) { return sum + (Number(t.score) || 0); }, 0) / tests.length);
}

function buildParentData_(snap, student) {
  const a = snap.arrays;
  const m = snap.maps;
  const sid = String(student.id);
  function mine(list) { return (list || []).filter(function (x) { return String(x.studentId) === sid; }); }

  const safeStudent = Object.assign({}, student);
  delete safeStudent.pin;
  delete safeStudent.pushTokens;
  delete safeStudent.familyCode;
  safeStudent.pushTokenCount = (student.pushTokens || []).length;

  return {
    academyName: m.settings.academyName || '',
    students: [safeStudent],
    attendanceRecords: mine(a.attendanceRecords),
    dailyTests: mine(a.dailyTests).map(function (t) {
      if (!('analysis' in t) && !('parentReport' in t)) return t;
      const copy = Object.assign({}, t);
      delete copy.analysis; // 선생님용 분석 메모
      if (!copy.notifyParent) delete copy.parentReport; // '기록만 저장'한 문자는 학부모에게 안 보여요
      return copy;
    }),
    mistakeRecords: mine(a.mistakeRecords),
    conceptTestRecords: mine(a.conceptTestRecords),
    parentMessages: mine(a.parentMessages),
    homeworkAssignments: a.homeworkAssignments
      .filter(function (h) { return targetsStudent_(h, student); })
      .map(function (h) {
        const copy = Object.assign({}, h);
        copy.doneBy = (h.doneBy || []).filter(function (id) { return String(id) === sid; });
        copy.doneAt = pickKey_(h.doneAt, sid);
        if (copy.target && copy.target.type === 'individual') copy.target = { type: 'individual', studentIds: [student.id] };
        return copy;
      }),
    schoolInfos: a.schoolInfos.filter(function (si) { return student.school && si.school === student.school; }),
    teacherComments: pickKey_(m.teacherComments, sid),
    aiLearningReports: mine(a.aiLearningReports).map(function (r) {
      const copy = Object.assign({}, r);
      if (copy.report) {
        copy.report = Object.assign({}, copy.report);
        delete copy.report.internalScript; // 원장님 상담용 내부 메모는 학부모에게 보내지 않아요
      }
      return copy;
    }),
    conceptBankItems: a.conceptBankItems.filter(function (i) { return student.className && i.className === student.className; }),
    conceptDailyCounts: pickKey_(m.conceptDailyCounts, student.className),
    conceptActiveDays: pickKey_(m.conceptActiveDays, student.className),
    groupAvgScore: groupAvgScore_(student, a),
    todayKst: kstToday_()
  };
}

/* ------------------------------ 로그인 · 불러오기 ------------------------------ */

function parentLogin_(body) {
  const name = String(body.name || '').trim();
  const pin = String(body.pin || '').trim();
  if (!name || !pin) throw storeError_('BAD_INPUT', '이름과 비밀번호를 모두 입력해주세요.');
  checkLoginLimits_(name);

  const snap = snapshot_();
  const students = snap.arrays.students.filter(function (s) { return !s.withdrawDate; });
  const nameKey = normalizeName_(name);
  const student = students.find(function (s) { return normalizeName_(s.name) === nameKey && String(s.pin || '') === pin; });

  if (!student) {
    recordLoginFailure_(name);
    throw storeError_('LOGIN_FAILED', '일치하는 학생을 찾을 수 없어요. 이름과 비밀번호를 다시 확인해주시거나 학원에 문의해주세요.');
  }
  if (isWeakPin_(student.pin)) {
    throw storeError_('PIN_NOT_SET', '아직 학원에서 비밀번호를 정하지 않았어요. 학원에 문의해주세요.');
  }
  clearLoginLock_(name);

  const family = familyOf_(student, students);
  return {
    ok: true,
    token: makeParentToken_(student),
    studentId: student.id,
    students: family.map(studentSummary_)
  };
}

function parentLoad_(body) {
  const snap = snapshot_();
  const family = verifyParentToken_(body.token, snap.arrays.students);
  const student = requireStudentAccess_(family, body.studentId);
  return {
    ok: true,
    rev: snap.rev,
    students: family.map(studentSummary_),
    data: buildParentData_(snap, student)
  };
}

/* ------------------------------ 학부모 쪽 저장 ------------------------------ */

// 증표 확인 → (잠금 안에서) 변경 한 가지만 저장 → 거절됐으면 오류로 알려줘요
function parentWrite_(body, buildOps) {
  const snap = snapshot_();
  const family = verifyParentToken_(body.token, snap.arrays.students);
  const student = requireStudentAccess_(family, body.studentId);
  const ops = buildOps(student, snap);
  const result = withLock_(function () { return commitOps_(ops, 'parent:' + student.id); });
  if (result.rejected.length) {
    const r = result.rejected[0];
    throw storeError_(r.reason, r.reason === 'DELETED' || r.reason === 'NOT_FOUND' ? '선생님이 이미 삭제한 항목이에요. 새로고침해주세요.' : r.message);
  }
  afterCommit_(result);
  return { student: student, result: result };
}

function parentToggleHomework_(body) {
  const out = parentWrite_(body, function (student, snap) {
    const a = snap.arrays.homeworkAssignments.find(function (x) { return String(x.id) === String(body.assignmentId); });
    if (!a) throw storeError_('NOT_FOUND', '선생님이 이미 삭제한 숙제예요. 새로고침해주세요.');
    if (!targetsStudent_(a, student)) throw storeError_('FORBIDDEN', '이 학생에게 배정된 숙제가 아니에요.');
    const op = { op: 'patch', c: 'homeworkAssignments', id: String(a.id) };
    const sidKey = String(student.id);
    if (body.done) {
      op.addToSet = { doneBy: [student.id] };
      op.mapSet = { doneAt: {} };
      op.mapSet.doneAt[sidKey] = kstToday_(); // 체크한 날 — 다음날부터 학생 화면에서 숨겨요
    } else {
      op.pullFromSet = { doneBy: [student.id] };
      op.mapUnset = { doneAt: [sidKey] };
    }
    return [op];
  });
  return { ok: true, rev: out.result.rev };
}

function parentSubmitQuiz_(body) {
  function idList(v) {
    return (Array.isArray(v) ? v : []).slice(0, 100).filter(function (x) { return typeof x === 'number' || typeof x === 'string'; });
  }
  const total = Math.max(0, Math.min(100, Number(body.total) || 0));
  const correct = Math.max(0, Math.min(total, Number(body.correct) || 0));
  if (total === 0) throw storeError_('BAD_INPUT', '푼 문제가 없어요.');

  const out = parentWrite_(body, function (student) {
    const record = {
      id: newServerId_(),
      studentId: student.id,
      date: kstToday_(),
      correct: correct,
      total: total,
      wrongItemIds: idList(body.wrongItemIds),
      correctItemIds: idList(body.correctItemIds)
    };
    return [{ op: 'put', c: 'conceptTestRecords', id: String(record.id), data: record }];
  });
  return { ok: true, rev: out.result.rev };
}

function parentSendMessage_(body) {
  const message = String(body.message || '').trim();
  if (!message) throw storeError_('BAD_INPUT', '메시지를 입력해주세요.');
  if (message.length > 1000) throw storeError_('BAD_INPUT', '메시지는 1000자까지 보낼 수 있어요.');

  const out = parentWrite_(body, function (student) {
    const cache = CacheService.getScriptCache();
    const key = 'msgcount:' + student.id;
    const count = Number(cache.get(key) || 0);
    if (count >= 10) throw storeError_('RATE_LIMITED', '메시지를 너무 자주 보내셨어요. 잠시 후 다시 보내주세요.');
    cache.put(key, String(count + 1), 600);

    const msg = {
      id: newServerId_(),
      studentId: student.id,
      studentName: student.name,
      date: new Date().toISOString(),
      message: message,
      from: 'parent'
    };
    return [{ op: 'put', c: 'parentMessages', id: String(msg.id), data: msg }];
  });
  return { ok: true, rev: out.result.rev };
}

function parentRegisterPushToken_(body) {
  const token = String(body.pushToken || '').trim();
  if (!token || token.length > 1000) throw storeError_('BAD_INPUT', '알림 등록 정보가 이상해요.');
  const out = parentWrite_(body, function (student) {
    return [{ op: 'patch', c: 'students', id: String(student.id), addToSet: { pushTokens: [token] } }];
  });
  const tokens = (out.student.pushTokens || []).slice();
  if (tokens.indexOf(token) === -1) tokens.push(token);
  return { ok: true, rev: out.result.rev, pushTokenCount: tokens.length };
}
