// Local simulator for the Apps Script backend: mocks Google services in memory,
// loads gas/*.js as separate scripts in one realm (like Apps Script V8), runs scenarios
// with synthetic data only.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const GAS_DIR = process.argv[2];
const ORDER = process.argv[3] || 'alpha';

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('FAIL:', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); }
}

/* ---------- byte helpers ---------- */
const signed = buf => Array.from(buf).map(b => (b > 127 ? b - 256 : b));
const toBuf = v => (typeof v === 'string' ? Buffer.from(v, 'utf8') : Buffer.from(v.map(b => (b < 0 ? b + 256 : b))));
const colToNum = s => [...s].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);
const iter = list => { let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; };

/* ---------- Sheets mock ---------- */
class Range {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
  getValues() { const out = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(this.sheet.get(this.r + i, this.c + j)); out.push(row); } return out; }
  setValues(v) {
    if (v.length !== this.nr || v.some(row => row.length !== this.nc)) throw new Error(`setValues size mismatch ${v.length}x${v[0] && v[0].length} vs ${this.nr}x${this.nc}`);
    v.forEach((row, i) => row.forEach((val, j) => this.sheet.set(this.r + i, this.c + j, val)));
    return this;
  }
  getValue() { return this.sheet.get(this.r, this.c); }
  setValue(v) { this.sheet.set(this.r, this.c, v); return this; }
  clearContent() { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sheet.set(this.r + i, this.c + j, ''); return this; }
  setNumberFormat() { return this; } setFontWeight() { return this; } setBackground() { return this; } setFontColor() { return this; }
}
class Sheet {
  constructor(name) { this.name = name; this.rows = []; this.writes = 0; }
  get(r, c) { const row = this.rows[r - 1]; const v = row ? row[c - 1] : undefined; return v === undefined ? '' : v; }
  set(r, c, v) {
    if (typeof v === 'string' && v.length > 50000) throw new Error('Your input contains more than the maximum of 50000 characters in a single cell.');
    while (this.rows.length < r) this.rows.push([]);
    this.rows[r - 1][c - 1] = v; this.writes++;
  }
  getLastRow() { for (let i = this.rows.length; i > 0; i--) if ((this.rows[i - 1] || []).some(v => v !== '' && v !== undefined)) return i; return 0; }
  getRange(a, b, c, d) {
    if (typeof a === 'string') {
      let m = a.match(/^([A-Z]+)(\d+)$/); if (m) return new Range(this, +m[2], colToNum(m[1]), 1, 1);
      m = a.match(/^([A-Z]+):([A-Z]+)$/); if (m) return new Range(this, 1, colToNum(m[1]), Math.max(this.rows.length, 1), colToNum(m[2]) - colToNum(m[1]) + 1);
      throw new Error('unsupported range ' + a);
    }
    if (a < 1 || b < 1 || (c !== undefined && c < 1)) throw new Error(`bad range ${a},${b},${c},${d}`);
    return new Range(this, a, b, c || 1, d || 1);
  }
  appendRow(vals) { const r = this.getLastRow() + 1; vals.forEach((v, j) => this.set(r, j + 1, v)); }
  deleteRow(r) { this.rows.splice(r - 1, 1); }
  clear() { this.rows = []; }
  setFrozenRows() {} setFrozenColumns() {}
}

function kstParts(date, tz) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const p = Object.fromEntries(f.formatToParts(date).map(x => [x.type, x.value]));
  return { yyyy: p.year, MM: p.month, dd: p.day, HH: p.hour === '24' ? '00' : p.hour, mm: p.minute };
}

function makeEnv(initialA1) {
  const sheets = {}, props = {}, cache = {}, folders = {}, logs = [], fetches = [], mails = [], triggers = [];
  const ss = { getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = new Sheet(n)), getName: () => 'TEST' };
  if (initialA1 !== undefined) { ss.insertSheet('Data').set(1, 1, initialA1); }

  function makeFolder(name) {
    const files = [];
    return {
      name, files,
      createFile(fname, content) { const f = { fname, content: String(content), created: new Date(), trashed: false, getName() { return this.fname; }, getDateCreated() { return this.created; }, getSize() { return this.content.length; }, setTrashed(t) { this.trashed = t; }, getBlob() { const c = this.content; return { getDataAsString: () => c }; } }; files.push(f); return f; },
      getFiles() { return iter(files.filter(f => !f.trashed)); },
      getFilesByName(n) { return iter(files.filter(f => !f.trashed && f.fname === n)); }
    };
  }

  const ctx = {
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, flush() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, setProperties: o => Object.keys(o).forEach(k => { props[k] = String(o[k]); }), deleteProperty: k => { delete props[k]; } }) },
    CacheService: { getScriptCache: () => ({ get: k => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = String(v); }, remove: k => { delete cache[k]; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, text) => signed(crypto.createHash('sha256').update(toBuf(text)).digest()),
      computeHmacSha256Signature: (value, key) => signed(crypto.createHmac('sha256', toBuf(key)).update(toBuf(value)).digest()),
      base64EncodeWebSafe: v => toBuf(v).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      base64DecodeWebSafe: s => signed(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
      newBlob: v => ({ getBytes: () => signed(toBuf(v)), getDataAsString: () => toBuf(v).toString('utf8') }),
      getUuid: () => crypto.randomUUID(),
      formatDate: (date, tz, fmt) => { const p = kstParts(date, tz); return fmt.replace('yyyy', p.yyyy).replace('MM', p.MM).replace('dd', p.dd).replace('HH', p.HH).replace('mm', p.mm); },
      sleep() {}
    },
    ContentService: { createTextOutput: t => ({ text: t, setMimeType() { return this; }, getContent() { return this.text; } }), MimeType: { JSON: 'json' } },
    MimeType: { PLAIN_TEXT: 'text/plain' },
    Logger: { log: m => logs.push(String(m)) },
    DriveApp: {
      getFoldersByName: n => iter(folders[n] ? [folders[n]] : []),
      createFolder: n => (folders[n] = makeFolder(n)),
      getRootFolder: () => ({})
    },
    MailApp: { sendEmail: (to, s, b) => mails.push({ to, s, b }), getRemainingDailyQuota: () => 100 },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }), getScriptTimeZone: () => 'Asia/Seoul' },
    ScriptApp: {
      getProjectTriggers: () => triggers.map(h => ({ getHandlerFunction: () => h })),
      newTrigger: h => { const chain = { timeBased: () => chain, everyDays: () => chain, atHour: () => chain, inTimezone: () => chain, create: () => { triggers.push(h); return {}; } }; return chain; }
    },
    UrlFetchApp: { fetch: (url, opts) => { fetches.push({ url, opts }); return { getResponseCode: () => 200, getContentText: () => '{}' }; }, getRequest: () => ({}) },
    OAuth2: { createService: () => { const s = { setTokenUrl: () => s, setPrivateKey: () => s, setIssuer: () => s, setPropertyStore: () => s, setScope: () => s, hasAccess: () => true, getAccessToken: () => 'tok', getLastError: () => '' }; return s; } }
  };
  vm.createContext(ctx);

  let files = fs.readdirSync(GAS_DIR).filter(f => f.endsWith('.js')).sort();
  if (ORDER === 'reverse') files = files.reverse();
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(GAS_DIR, f), 'utf8'), ctx, { filename: f });

  const env = { ctx, sheets, props, cache, folders, logs, fetches, mails, triggers };
  env.run = code => vm.runInContext(code, ctx);
  env.post = body => JSON.parse(ctx.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).getContent());
  env.get = () => JSON.parse(ctx.doGet({}).getContent());
  env.v2 = (action, extra) => env.post(Object.assign({ v: 2, clientVersion: 2, action }, extra || {}));
  env.admin = (action, extra) => env.v2(action, Object.assign({ auth: { adminKey: 'test-admin-key-123' } }, extra || {}));
  env.itemRow = (c, id) => env.sheets.Items.rows.find(r => r[0] === c && r[1] === String(id));
  return env;
}

/* ---------- synthetic data ---------- */
const sample = {
  version: 2, academyName: '테스트학원',
  students: [
    { id: 1, name: '가학생', grade: '중2', school: '가중학교', className: '월목중2', pin: '1111', familyCode: 'F1', pushTokens: ['tokA'] },
    { id: 2, name: '나 학생', grade: '중2', school: '나중학교', className: '월목중2', pin: '2222' },
    { id: 3, name: '다학생', grade: '초5', school: '다초', className: '', pin: '0000' },
    { id: 4, name: '라학생', grade: '중1', school: '가중학교', className: '화금중1', pin: '4444', familyCode: 'F1' },
    { id: 5, name: '마학생', grade: '중2', className: '월목중2', pin: '5555' }
  ],
  nextStudentId: 7,
  withdrawnStudents: [
    { id: 6, name: '바학생', grade: '중3', pin: '6666', withdrawDate: '2026-08-01' },
    { id: 5, name: '마학생', grade: '중2', className: '월목중2', pin: '5555', withdrawDate: '2026-09-01' }
  ],
  attendanceRecords: [{ id: 1, studentId: 1, date: '2026-09-01', status: '출석' }, { id: 2, studentId: 2, date: '2026-09-01', status: '결석' }],
  nextAttendanceId: 3,
  dailyTests: [
    { id: 1, studentId: 1, date: '2026-09-02', unit: 'u1', score: 80 },
    { id: 2, studentId: 2, date: '2026-09-02', unit: 'u1', score: 60 },
    { id: 3, studentId: 3, date: '2026-09-02', unit: 'u', score: 100 }
  ],
  homeworkAssignments: [
    { id: 1, text: '쎈 10쪽', date: '2026-09-03', target: { type: 'class', className: '월목중2' }, doneBy: [2] },
    { id: 2, text: '개별', date: '2026-09-03', target: { type: 'individual', studentIds: [2] }, doneBy: [] }
  ],
  parentMessages: [{ id: 1, studentId: 2, studentName: '나 학생', date: '2026-09-04T00:00:00Z', message: '안녕하세요' }],
  aiLearningReports: [{ id: 1, studentId: 1, createdAt: '2026-09-05', report: { profile: [], internalScript: '내부메모' } }],
  conceptBankItems: [
    { id: 1, className: '월목중2', question: 'q', choices: ['a', 'b'], correctIndex: 0 },
    { id: 2, className: '화금중1', question: 'q2', choices: ['a', 'b'], correctIndex: 1 }
  ],
  conceptDraftItems: [], conceptTestRecords: [],
  teacherComments: { 1: '잘함', 2: '보통' },
  conceptDailyCounts: { '월목중2': 5, '화금중1': 3 }, conceptActiveDays: { '월목중2': [1, 4] }, conceptEnabledUnits: {},
  studentBehaviorNotes: {},
  schoolInfos: [{ id: 1, school: '가중학교', examName: '중간' }, { id: 2, school: '나중학교', examName: '중간' }],
  adminPushTokens: ['adminTok1'],
  mistakeRecords: [], progressLogs: [], generalMakeups: [], answerKeys: [], homeworkRecords: [], examAnalysis: [], scheduleItems: [],
  conceptCurriculumUnits: [{ id: 'u1', unitName: 'x', active: true, target: { type: 'class', className: '월목중2' } }]
};

/* ---------- scenarios ---------- */
const env = makeEnv(JSON.stringify(sample));
const A1 = () => env.sheets.Data.get(1, 1);

// A. 이전 전: 예전 방식 유지 + 안전장치
check('A get returns A1', env.get().students.length === 5);
const probe1 = JSON.parse(env.ctx.doGet({ parameter: { probe: '1' } }).getContent());
check('A probe before migration', probe1.api === 2 && probe1.migrated === false && !probe1.students, probe1);
const beforeA1 = A1();
check('A unknown action rejected', env.post({ action: 'somethingElse', students: [] }).error === 'UNKNOWN_ACTION');
check('A1 untouched after unknown action', A1() === beforeA1);
check('A bad json rejected', env.post('{not json').error === 'BAD_JSON');
check('A non-full data rejected', env.post({ foo: 1 }).error === 'BAD_DATA');
const modified = JSON.parse(beforeA1); modified.academyName = '테스트학원';
check('A legacy full save ok', env.post(modified).ok === true);
check('A v2 before migration -> admin key not set', env.v2('adminLoad', { auth: { adminKey: 'x' } }).error === 'ADMIN_KEY_NOT_SET');

// B. 이전
env.props.PUSH_DISABLED = 'false';
env.run('migrateToV2()');
check('B migrated', env.run('isMigrated_()') === true, env.logs.slice(-5));
check('B premigration backup file', env.folders['아임수학학원_백업'].files.some(f => f.fname.startsWith('premigration_')));
const problems = env.run('verifyMigration()');
check('B verify no problems', problems.length === 0, problems);
check('B dup student logged', env.logs.some(l => l.includes('마학생')));
check('B A1 kept', A1() === JSON.stringify(modified));
check('B migrate twice is no-op', (env.run('migrateToV2()'), env.sheets.Items.getLastRow()) === env.sheets.Items.getLastRow());

// C. 관리자 인증
check('C no key -> ADMIN_KEY_NOT_SET', env.v2('adminPing').error === 'ADMIN_KEY_NOT_SET');
env.props.ADMIN_KEY_PLAIN = 'test-admin-key-123';
env.run('hashAdminKey()');
check('C plain removed', !('ADMIN_KEY_PLAIN' in env.props) && !!env.props.ADMIN_KEY_HASH);
check('C missing auth', env.v2('adminPing').error === 'AUTH_REQUIRED');
check('C wrong key', env.v2('adminPing', { auth: { adminKey: 'nope' } }).error === 'AUTH_FAILED');
check('C ok ping', env.admin('adminPing').ok === true);
check('C old client version', env.post({ v: 2, clientVersion: 1, action: 'adminPing' }).error === 'UPGRADE_REQUIRED');
check('C unknown v2 action', env.admin('dropEverything').error === 'UNKNOWN_ACTION');
check('C prototype action blocked', env.admin('toString').error === 'UNKNOWN_ACTION');
check('C AI action needs admin', env.v2('analyzeExam').error === 'AUTH_REQUIRED');

// D. 불러오기 모양
let load = env.admin('adminLoad');
check('D load ok', load.ok && load.rev === 1);
check('D withdrawn split', load.data.students.length === 4 && load.data.withdrawnStudents.length === 2, load.data.withdrawnStudents);
check('D counters', load.data.nextStudentId === 7 && load.data.nextAttendanceId === 3);
check('D extra collection kept', Array.isArray(load.data.conceptCurriculumUnits) && load.data.conceptCurriculumUnits.length === 1);
check('D maps', load.data.teacherComments['1'] === '잘함' && load.data.conceptDailyCounts['월목중2'] === 5);
check('D admin tokens', load.data.adminPushTokens[0] === 'adminTok1');

// F. 학부모
check('F weak pin refused', env.v2('parentLogin', { name: '다학생', pin: '0000' }).error === 'PIN_NOT_SET');
for (let i = 0; i < 5; i++) env.v2('parentLogin', { name: '나학생', pin: '9999' });
check('F lock after 5 fails', env.v2('parentLogin', { name: '나학생', pin: '2222' }).error === 'LOCKED');
env.admin('adminClearLoginLock', { name: '나 학생' });
check('F unlock by admin + name spacing tolerant', env.v2('parentLogin', { name: '나학생', pin: '2222' }).ok === true);
check('F withdrawn cannot login', env.v2('parentLogin', { name: '바학생', pin: '6666' }).error === 'LOGIN_FAILED');

const login = env.v2('parentLogin', { name: '가학생', pin: '1111' });
check('F login ok with sibling', login.ok && login.students.map(s => s.id).sort().join() === '1,4', login);
const token = login.token;
const pl = env.v2('parentLoad', { token, studentId: 1 });
const plText = JSON.stringify(pl);
check('F load ok', pl.ok === true, pl);
check('F only one student', pl.data.students.length === 1 && pl.data.students[0].id === 1);
check('F no pins leaked', !/"pin"/.test(plText));
check('F no other names', !plText.includes('나 학생') && !plText.includes('다학생') && !plText.includes('바학생'));
check('F no internalScript', !plText.includes('internalScript') && !plText.includes('내부메모'));
check('F no push tokens', !plText.includes('tokA') && pl.data.students[0].pushTokenCount === 1);
check('F homework doneBy reduced', pl.data.homeworkAssignments.length === 1 && pl.data.homeworkAssignments[0].doneBy.length === 0);
check('F school infos filtered', pl.data.schoolInfos.length === 1);
check('F concept items filtered', pl.data.conceptBankItems.length === 1 && Object.keys(pl.data.conceptDailyCounts).join() === '월목중2');
check('F teacher comment filtered', Object.keys(pl.data.teacherComments).join() === '1');
check('F group avg middle school only', pl.data.groupAvgScore === 70, pl.data.groupAvgScore);
check('F sibling access', env.v2('parentLoad', { token, studentId: 4 }).ok === true);
check('F other student forbidden', env.v2('parentLoad', { token, studentId: 2 }).error === 'FORBIDDEN');
const tampered = token.slice(0, -2) + (token.slice(-2) === 'AA' ? 'BB' : 'AA');
check('F tampered token', env.v2('parentLoad', { token: tampered, studentId: 1 }).error === 'AUTH_REQUIRED');
check('F no token', env.v2('parentLoad', { studentId: 1 }).error === 'AUTH_REQUIRED');

// 학부모 쓰기
check('F toggle hw', env.v2('parentToggleHomework', { token, studentId: 1, assignmentId: 1, done: true }).ok === true);
check('F toggle not-assigned hw forbidden', env.v2('parentToggleHomework', { token, studentId: 1, assignmentId: 2, done: true }).error === 'FORBIDDEN');
let hw1 = JSON.parse(env.itemRow('homeworkAssignments', 1)[6]);
check('F doneBy has 1 and keeps 2', hw1.doneBy.includes(1) && hw1.doneBy.includes(2), hw1);
check('F quiz', env.v2('parentSubmitQuiz', { token, studentId: 1, correct: 3, total: 5, wrongItemIds: [1, 2], correctItemIds: [3] }).ok === true);
env.props.PUSH_DISABLED = 'false';
const fetchesBefore = env.fetches.length;
check('F message', env.v2('parentSendMessage', { token, studentId: 1, message: '문의드려요' }).ok === true);
check('F message pushed to admin', env.fetches.length > fetchesBefore);
check('F push token register', env.v2('parentRegisterPushToken', { token, studentId: 1, pushToken: 'tokB' }).pushTokenCount === 2);

// 관리자 수정 + 옛 앱 저장이 학부모 체크를 지우지 않음
let rev = env.admin('adminLoad').rev;
let res = env.admin('adminCommit', { baseRev: rev, deviceId: 'pc', ops: [{ op: 'patch', c: 'homeworkAssignments', id: '1', set: { text: '쎈 12쪽' } }] });
check('G admin patch ok', res.ok && res.rejected.length === 0, res);
hw1 = JSON.parse(env.itemRow('homeworkAssignments', 1)[6]);
check('G admin edit kept parent check', hw1.text === '쎈 12쪽' && hw1.doneBy.includes(1));
const stale = JSON.parse(JSON.stringify(modified)); // 옛 앱이 가진 오래된 전체 데이터
check('G legacy post ok', env.post(stale).ok === true);
hw1 = JSON.parse(env.itemRow('homeworkAssignments', 1)[6]);
check('G legacy post did not remove parent check', hw1.doneBy.includes(1), hw1);
const st1 = JSON.parse(env.itemRow('students', 1)[6]);
check('G legacy post kept push token', st1.pushTokens.includes('tokB'), st1);
check('G legacy post kept message', env.admin('adminLoad').data.parentMessages.length === 2);

// H. 삭제가 되살아나지 않음
rev = env.admin('adminLoad').rev;
res = env.admin('adminCommit', { baseRev: rev, ops: [{ op: 'del', c: 'students', id: '2' }] });
check('H delete ok', res.ok && res.changes.some(ch => ch.id === '2' && ch.deleted));
check('H legacy post with deleted student', env.post(stale).ok === true);
check('H still deleted after legacy post', !env.admin('adminLoad').data.students.some(s => s.id === 2));
check('H legacy GET excludes deleted', !env.get().students.some(s => s.id === 2));
res = env.admin('adminCommit', { baseRev: rev, ops: [{ op: 'patch', c: 'students', id: '2', set: { school: 'x' } }, { op: 'put', c: 'students', id: '2', data: { id: 2, name: '나 학생' } }] });
check('H patch/put on deleted rejected', res.rejected.length === 2 && res.rejected.every(r => r.reason === 'DELETED'), res.rejected);
res = env.admin('adminCommit', { baseRev: rev, ops: [{ op: 'put', c: 'students', id: '2', data: { id: 2, name: '나 학생', grade: '중2', pin: '2222' }, undelete: true }] });
check('H undelete works', res.rejected.length === 0 && env.admin('adminLoad').data.students.some(s => s.id === 2));

// 퇴원이 되돌아가지 않음
res = env.admin('adminCommit', { baseRev: rev, ops: [{ op: 'patch', c: 'students', id: '4', set: { withdrawDate: '2026-09-15' } }] });
check('H withdraw ok', res.rejected.length === 0);
env.post(stale);
load = env.admin('adminLoad');
check('H withdraw survives legacy post', load.data.withdrawnStudents.some(s => s.id === 4) && !load.data.students.some(s => s.id === 4));
check('H withdrawn sibling no longer accessible', env.v2('parentLoad', { token, studentId: 4 }).error === 'FORBIDDEN');
res = env.admin('adminCommit', { baseRev: load.rev, ops: [{ op: 'patch', c: 'students', id: '4', unset: ['withdrawDate'] }] });
check('H restore from withdrawn', env.admin('adminLoad').data.students.some(s => s.id === 4));

// PIN 변경 → 증표 무효
env.admin('adminCommit', { baseRev: 0, ops: [{ op: 'patch', c: 'students', id: '1', set: { pin: '1234' } }] });
check('H pin change invalidates token', env.v2('parentLoad', { token, studentId: 1 }).error === 'SESSION_EXPIRED');

// I. 크기 · 대량
res = env.admin('adminCommit', { baseRev: 0, ops: [{ op: 'put', c: 'dailyTests', id: '999', data: { id: 999, note: 'x'.repeat(46000) } }] });
check('I oversized row rejected', res.rejected.length === 1 && res.rejected[0].reason === 'TOO_LARGE');
check('I too many ops', env.admin('adminCommit', { baseRev: 0, ops: new Array(501).fill({ op: 'del', c: 'students', id: '99' }) }).error === 'TOO_MANY_OPS');
for (let batch = 0; batch < 8; batch++) {
  const ops = [];
  for (let i = 0; i < 400; i++) { const id = 10000 + batch * 400 + i; ops.push({ op: 'put', c: 'attendanceRecords', id: String(id), data: { id, studentId: 1, date: '2026-0' + (1 + (i % 8)) + '-1' + (i % 9), status: '출석', memo: '메모메모메모' } }); }
  env.admin('adminCommit', { baseRev: 0, ops });
}
load = env.admin('adminLoad');
check('I 3200 records stored', load.data.attendanceRecords.length >= 3200);
check('I total data beyond 50k', JSON.stringify(load.data).length > 200000, JSON.stringify(load.data).length);
check('I attendance sheets built', Object.keys(env.sheets).some(n => n.startsWith('출결_2026-0')));
check('I unknown collection rejected', env.admin('adminCommit', { baseRev: 0, ops: [{ op: 'put', c: 'evil', id: '1', data: { id: 1 } }] }).rejected[0].reason === 'UNKNOWN_COLLECTION');
check('I id mismatch rejected', env.admin('adminCommit', { baseRev: 0, ops: [{ op: 'put', c: 'dailyTests', id: '5', data: { id: 6 } }] }).rejected[0].reason === 'BAD_ID');

// J. 변경분 · 정리
rev = env.admin('adminLoad').rev;
env.admin('adminCommit', { baseRev: rev, ops: [{ op: 'put', c: 'teacherComments', id: '4', data: '열심히' }, { op: 'del', c: 'teacherComments', id: '2' }] });
let ch = env.admin('adminChanges', { sinceRev: rev });
check('J changes since', ch.ok && ch.changes.length === 2 && ch.rev === rev + 1, ch);
check('J map delete visible', env.admin('adminLoad').data.teacherComments['2'] === undefined);
check('J no changes', env.admin('adminChanges', { sinceRev: rev + 1 }).changes.length === 0);
const tomb = env.sheets.Items.rows.find(r => r[0] === 'teacherComments' && r[1] === '2');
tomb[4] = '2020-01-01T00:00:00.000Z';
const purged = env.run('purgeTombstones_(90)');
check('J purge removed tombstone', purged === 1 && !env.sheets.Items.rows.some(r => r[0] === 'teacherComments' && r[1] === '2'));
check('J purge forces full reload', env.admin('adminChanges', { sinceRev: rev }).fullReload === true);
check('J items index consistent after purge', env.admin('adminCommit', { baseRev: 0, ops: [{ op: 'patch', c: 'homeworkAssignments', id: '1', set: { text: '쎈 13쪽' } }] }).rejected.length === 0);
hw1 = JSON.parse(env.itemRow('homeworkAssignments', 1)[6]);
check('J patch hit right row after purge', hw1.text === '쎈 13쪽');

// K. 백업 · 복원 왕복
env.run('backupDataSnapshot()');
const daily = env.folders['아임수학학원_백업'].files.find(f => /^backup_\d{4}-\d{2}-\d{2}\.json$/.test(f.fname));
check('K daily backup created', !!daily);
check('K restore ops empty for identical backup', env.run(`restoreOpsFromLegacy_(JSON.parse(${JSON.stringify(daily.content)})).length`) === 0);
check('K backup via admin action', /^backup_.*manual\.json$/.test(env.admin('adminBackupNow').file));
check('K list backups', env.admin('adminListBackups').files.length >= 3);
env.run('installTriggers()'); env.run('installTriggers()');
check('K trigger installed once', env.triggers.filter(t => t === 'backupDataSnapshot').length === 1);

// 자동생성(autogen) 저장 경로
const latest = env.run('fetchConceptAppData_()');
latest.conceptDraftItems.push({ id: 1, target: { type: 'class', className: '월목중2' }, question: '새문제', choices: ['a', 'b', 'c'], correctIndex: 0 });
env.ctx.__latest = latest;
env.run('saveConceptAppData_(__latest)');
load = env.admin('adminLoad');
check('K autogen added draft', load.data.conceptDraftItems.length === 1);
check('K autogen did not resurrect deleted comment', load.data.teacherComments['2'] === undefined);

// L. 옛 방식 단계별 차단
env.props.LEGACY_MODE = 'readonly';
check('L readonly get ok', Array.isArray(env.get().students));
check('L readonly post blocked', env.post(stale).error === 'UPGRADE_REQUIRED');
check('L legacy log written', env.sheets.LegacyLog && env.sheets.LegacyLog.getLastRow() >= 2);
env.props.LEGACY_MODE = 'off';
check('L off get blocked', env.get().error === 'UPGRADE_REQUIRED');
check('L off legacy AI blocked', env.post({ action: 'analyzeExam' }).error === 'UPGRADE_REQUIRED');
check('L v2 still works', env.admin('adminPing').ok === true);

// 알림 끄기
env.props.PUSH_DISABLED = 'true';
const fb = env.fetches.length;
env.admin('adminCommit', { baseRev: 0, ops: [{ op: 'put', c: 'homeworkAssignments', id: '77', data: { id: 77, text: '새숙제', date: '2026-09-15', target: { type: 'class', className: '월목중2' }, doneBy: [] } }] });
check('L push disabled', env.fetches.length === fb && env.logs.some(l => l.includes('[알림 꺼짐]')));

// M. A1로 되돌리기
let rollbackErr = null;
try { env.run('rollbackToA1()'); } catch (e) { rollbackErr = e; }
check('M big data rollback refused', rollbackErr && /5만 자/.test(rollbackErr.message));
check('M big data stays migrated', env.run('isMigrated_()') === true);
check('M rollback file saved anyway', env.folders['아임수학학원_백업'].files.some(f => f.fname.startsWith('rollback_')));

// N. 예전 앱이 id 없이 저장한 항목
const noIdData = {
  students: [{ id: 1, name: '가학생', pin: '1234' }],
  parentMessages: [
    { studentId: 1, studentName: '가학생', date: '2026-07-01T01:00:00.000Z', message: '첫 메시지' },
    { studentId: 1, studentName: '가학생', date: '2026-07-01T01:00:00.000Z', message: '같은 시각 메시지' },
    { id: 5, studentId: 1, studentName: '가학생', date: '2026-08-01T01:00:00.000Z', message: 'id 있음' },
    { studentId: 1, studentName: '가학생', message: '날짜 없음' }
  ]
};
const noId = makeEnv(JSON.stringify(noIdData));
noId.run('migrateToV2()');
check('N migrated with id-less items', noId.run('isMigrated_()') === true, noId.logs.slice(-6));
const noIdMsgs = noId.run('assembleLegacy_()').parentMessages;
check('N all messages kept with unique ids', noIdMsgs.length === 4 && new Set(noIdMsgs.map(m => String(m.id))).size === 4, noIdMsgs);
check('N verify passes', noId.run('verifyMigration()').length === 0);
check('N restore of old id-less backup is a no-op', noId.run(`restoreOpsFromLegacy_(${JSON.stringify(noIdData)}).length`) === 0);

const small = makeEnv(JSON.stringify(sample));
small.run('migrateToV2()');
small.props.ADMIN_KEY_PLAIN = 'test-admin-key-123';
small.run('hashAdminKey()');
small.admin('adminCommit', { baseRev: 1, ops: [{ op: 'del', c: 'students', id: '2' }, { op: 'put', c: 'teacherComments', id: '4', data: '열심히' }] });
small.run('rollbackToA1()');
check('M rolled back', small.run('isMigrated_()') === false);
const a1after = JSON.parse(small.sheets.Data.get(1, 1));
check('M A1 has current data', !a1after.students.some(s => s.id === 2) && a1after.teacherComments['4'] === '열심히', a1after.teacherComments);
check('M get uses A1 again', small.get().students.length === a1after.students.length);
check('M legacy save works after rollback', small.post(a1after).ok === true);

console.log(`\n[${ORDER}] pass ${pass}, fail ${fail}`);
process.exit(fail ? 1 : 0);
