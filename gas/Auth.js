/**
 * ============================================================================
 * 🔐 인증 (2026-09-15)
 * ============================================================================
 *  - 관리자: 스크립트 속성의 비밀번호 해시(ADMIN_KEY_HASH)와 비교해요.
 *    처음 설정: 스크립트 속성에 ADMIN_KEY_PLAIN = (원하는 비밀번호) 추가
 *               → 편집기에서 hashAdminKey 실행 → 원문은 자동으로 지워져요.
 *  - 학부모: 이름 + PIN으로 로그인하면 30일짜리 "로그인 증표(token)"를 받아요.
 *    PIN을 바꾸면 기존 증표는 자동으로 무효가 돼요.
 *  - PIN을 5번 틀리면 그 이름은 15분 잠금, 전체적으로 10분에 50번 넘게 틀리면 10분 잠금.
 * ============================================================================
 */

const AUTH = {
  PARENT_TOKEN_DAYS: 30,
  PIN_FAIL_LIMIT: 5,
  PIN_LOCK_SECONDS: 900,
  GLOBAL_FAIL_LIMIT: 50,
  GLOBAL_WINDOW_SECONDS: 600,
  ADMIN_FAIL_LIMIT: 10,
  ADMIN_LOCK_SECONDS: 600,
  ADMIN_KEY_MIN_LENGTH: 8
};

function props_() {
  return PropertiesService.getScriptProperties();
}

function sha256Hex_(text) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

/* ------------------------------ 관리자 ------------------------------ */

/** 편집기에서 실행: 스크립트 속성 ADMIN_KEY_PLAIN 을 해시로 바꿔 저장하고 원문은 지워요 */
function hashAdminKey() {
  const p = props_();
  const plain = p.getProperty('ADMIN_KEY_PLAIN');
  if (!plain) {
    Logger.log('❌ 먼저 프로젝트 설정 → 스크립트 속성에 ADMIN_KEY_PLAIN (관리자 비밀번호)을 추가해주세요.');
    return;
  }
  if (plain.length < AUTH.ADMIN_KEY_MIN_LENGTH) {
    Logger.log('❌ 비밀번호는 ' + AUTH.ADMIN_KEY_MIN_LENGTH + '자 이상으로 해주세요.');
    return;
  }
  const salt = Utilities.getUuid();
  p.setProperties({ ADMIN_KEY_SALT: salt, ADMIN_KEY_HASH: sha256Hex_(salt + plain) });
  p.deleteProperty('ADMIN_KEY_PLAIN');
  Logger.log('✅ 관리자 비밀번호를 저장했어요. (원문 ADMIN_KEY_PLAIN 은 지웠어요)');
}

function requireAdmin_(auth) {
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('adminfail') || 0);
  if (fails >= AUTH.ADMIN_FAIL_LIMIT) {
    throw storeError_('LOCKED', '관리자 비밀번호를 여러 번 틀려서 10분 동안 잠겼어요.');
  }
  const p = props_();
  const hash = p.getProperty('ADMIN_KEY_HASH');
  const salt = p.getProperty('ADMIN_KEY_SALT');
  if (!hash || !salt) {
    throw storeError_('ADMIN_KEY_NOT_SET', '관리자 비밀번호가 아직 설정되지 않았어요. (Apps Script 편집기에서 hashAdminKey 실행)');
  }
  const key = auth && auth.adminKey;
  if (!key) throw storeError_('AUTH_REQUIRED', '관리자 비밀번호가 필요해요.');
  if (sha256Hex_(salt + String(key)) !== hash) {
    cache.put('adminfail', String(fails + 1), AUTH.ADMIN_LOCK_SECONDS);
    throw storeError_('AUTH_FAILED', '관리자 비밀번호가 틀렸어요.');
  }
}

/* ------------------------------ 학부모 로그인 증표 ------------------------------ */

function sessionSecret_() {
  const p = props_();
  let secret = p.getProperty('SESSION_SECRET');
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid();
    p.setProperty('SESSION_SECRET', secret);
  }
  return secret;
}

function b64url_(value) {
  return Utilities.base64EncodeWebSafe(value).replace(/=+$/, '');
}

function b64urlDecodeToString_(text) {
  let s = String(text);
  while (s.length % 4) s += '=';
  return Utilities.newBlob(Utilities.base64DecodeWebSafe(s)).getDataAsString('UTF-8');
}

// PIN 자체는 증표에 넣지 않고, PIN이 바뀌었는지만 알 수 있는 짧은 지문을 넣어요
function pinFingerprint_(student) {
  return sha256Hex_('pin:' + String(student.pin || '') + ':' + String(student.id)).slice(0, 16);
}

function signParent_(payload) {
  return b64url_(Utilities.computeHmacSha256Signature(payload, sessionSecret_()));
}

function makeParentToken_(student) {
  const exp = Date.now() + AUTH.PARENT_TOKEN_DAYS * 86400000;
  const payload = String(student.id) + '|' + exp + '|' + pinFingerprint_(student);
  return b64url_(Utilities.newBlob(payload).getBytes()) + '.' + signParent_(payload);
}

// 형제자매: 가족 연결 코드(familyCode)가 명시적으로 같은 재원생끼리만
function familyOf_(student, students) {
  if (!student.familyCode) return [student];
  return students.filter(function (s) { return !s.withdrawDate && s.familyCode && s.familyCode === student.familyCode; });
}

/** 증표를 확인하고, 이 증표로 볼 수 있는 학생 목록(본인+형제자매)을 돌려줘요 */
function verifyParentToken_(token, students) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) throw storeError_('AUTH_REQUIRED', '다시 로그인해주세요.');
  let payload;
  try { payload = b64urlDecodeToString_(parts[0]); } catch (e) { throw storeError_('AUTH_REQUIRED', '다시 로그인해주세요.'); }
  if (signParent_(payload) !== parts[1]) throw storeError_('AUTH_REQUIRED', '다시 로그인해주세요.');
  const fields = payload.split('|');
  if (Number(fields[1]) < Date.now()) throw storeError_('SESSION_EXPIRED', '로그인 기간(30일)이 지났어요. 다시 로그인해주세요.');
  const main = students.find(function (s) { return String(s.id) === fields[0] && !s.withdrawDate; });
  if (!main || pinFingerprint_(main) !== fields[2]) {
    throw storeError_('SESSION_EXPIRED', '비밀번호가 바뀌었거나 등록 정보가 달라져서 다시 로그인이 필요해요.');
  }
  return familyOf_(main, students);
}

function requireStudentAccess_(allowedStudents, studentId) {
  const s = allowedStudents.find(function (x) { return String(x.id) === String(studentId); });
  if (!s) throw storeError_('FORBIDDEN', '이 학생의 정보는 볼 수 없어요.');
  return s;
}

/* ------------------------------ 로그인 시도 제한 ------------------------------ */

function normalizeName_(name) {
  return String(name || '').replace(/\s+/g, '');
}

function loginFailKey_(name) {
  return 'pinfail:' + sha256Hex_(normalizeName_(name)).slice(0, 32);
}

function checkLoginLimits_(name) {
  const cache = CacheService.getScriptCache();
  if (Number(cache.get('pinglobal') || 0) >= AUTH.GLOBAL_FAIL_LIMIT) {
    throw storeError_('LOCKED', '로그인 시도가 너무 많아 잠시 멈췄어요. 10분 후 다시 시도해주세요.');
  }
  if (Number(cache.get(loginFailKey_(name)) || 0) >= AUTH.PIN_FAIL_LIMIT) {
    throw storeError_('LOCKED', '비밀번호를 ' + AUTH.PIN_FAIL_LIMIT + '번 틀려서 15분 동안 잠겼어요. 급하시면 학원에 문의해주세요.');
  }
}

function recordLoginFailure_(name) {
  const cache = CacheService.getScriptCache();
  const key = loginFailKey_(name);
  cache.put(key, String(Number(cache.get(key) || 0) + 1), AUTH.PIN_LOCK_SECONDS);
  cache.put('pinglobal', String(Number(cache.get('pinglobal') || 0) + 1), AUTH.GLOBAL_WINDOW_SECONDS);
}

function clearLoginLock_(name) {
  CacheService.getScriptCache().remove(loginFailKey_(name));
}

function isWeakPin_(pin) {
  return !pin || String(pin) === '0000';
}
