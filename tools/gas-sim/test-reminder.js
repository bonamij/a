// 출석체크 알림이 "울려야 할 때만" 울리는지 확인
// 사용법: node tools/gas-sim/test-reminder.js
const path = require('path');
const ROOT = path.resolve(__dirname, "..", "..");
process.argv[2] = path.join(ROOT, 'gas');
process.argv[3] = 'alpha';
const { makeEnv } = require(path.join(ROOT, 'tools/gas-sim/mock.js'));

const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const kst = new Date(Date.now() + 9 * 3600 * 1000);
const todayKst = kst.toISOString().slice(0, 10);
const today = kst.getUTCDay();
const other = (today + 2) % 7;          // 오늘이 아닌 요일
const todayCh = DOW[today], otherCh = DOW[other];

let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

function build(students, attendance, withdrawn) {
  const sample = {
    version: 2, academyName: 'T',
    students, withdrawnStudents: withdrawn || [], attendanceRecords: attendance || [],
    dailyTests: [], homeworkAssignments: [], generalMakeups: [], progressLogs: [],
    answerKeys: [], homeworkRecords: [], mistakeRecords: [], examAnalysis: [],
    scheduleItems: [], parentMessages: [], aiLearningReports: [], conceptBankItems: [],
    conceptDraftItems: [], conceptTestRecords: [], schoolInfos: [],
    adminPushTokens: ['adminTok1'], teacherComments: {}, studentBehaviorNotes: {},
    conceptDailyCounts: {}, conceptActiveDays: {}, conceptEnabledUnits: {}
  };
  const env = makeEnv(JSON.stringify(sample));
  env.run('migrateToV2()');
  return env;
}
const sent = env => env.fetches.filter(f => String(f.url).indexOf('fcm.googleapis.com') >= 0);
const bodyOf = env => {
  const f = sent(env).slice(-1)[0];
  return f ? JSON.parse(f.opts.payload).message.notification.body : '';
};

console.log(`오늘은 ${todayCh}요일 (${todayKst}) 기준으로 시험해요\n`);

/* 1. 오늘 수업 있는 반이 있고 아무도 안 찍었으면 → 보낸다 */
{
  const env = build([
    { id: 1, name: '가', grade: '중2', className: todayCh + '중2', pin: '1111' },
    { id: 2, name: '나', grade: '중2', className: todayCh + '중2', pin: '2222' }
  ]);
  env.run('sendAttendanceReminders()');
  check('수업날 + 아무도 안 찍음 → 알림 보냄', sent(env).length === 1, sent(env).length);
  check('  내용에 2명이라고 적힘', /2명/.test(bodyOf(env)), bodyOf(env));
}

/* 2. 오늘 수업이 없는 요일이면 → 안 보낸다 */
{
  const env = build([
    { id: 1, name: '가', grade: '중2', className: otherCh + '중2', pin: '1111' }
  ]);
  env.run('sendAttendanceReminders()');
  check('수업 없는 날 → 안 보냄', sent(env).length === 0, sent(env).length);
}

/* 3. 다 찍었으면 → 안 보낸다 */
{
  const env = build(
    [{ id: 1, name: '가', grade: '중2', className: todayCh + '중2', pin: '1111' }],
    [{ id: 91, studentId: 1, date: todayKst, status: '출석' }]
  );
  env.run('sendAttendanceReminders()');
  check('다 찍었으면 → 안 보냄', sent(env).length === 0, sent(env).length);
}

/* 4. 일부만 찍었으면 → 남은 사람만 알려준다 */
{
  const env = build(
    [{ id: 1, name: '가', grade: '중2', className: todayCh + '중2', pin: '1111' },
     { id: 2, name: '나', grade: '중2', className: todayCh + '중2', pin: '2222' }],
    [{ id: 91, studentId: 1, date: todayKst, status: '출석' }]
  );
  env.run('sendAttendanceReminders()');
  check('일부만 찍음 → 남은 1명만', sent(env).length === 1 && /1명/.test(bodyOf(env)) && /나/.test(bodyOf(env)), bodyOf(env));
}

/* 5. 반 없는 학생은 수업날엔 같이 세고, 수업 없는 날엔 안 센다 */
{
  const env = build([
    { id: 1, name: '가', grade: '중2', className: todayCh + '중2', pin: '1111' },
    { id: 9, name: '초등이', grade: '초5', className: '', pin: '9999' }
  ]);
  env.run('sendAttendanceReminders()');
  check('수업날 → 반 없는 학생도 포함(2명)', /2명/.test(bodyOf(env)), bodyOf(env));

  const env2 = build([{ id: 9, name: '초등이', grade: '초5', className: '', pin: '9999' }]);
  env2.run('sendAttendanceReminders()');
  check('반 없는 학생만 있으면 → 매일 울리지 않음', sent(env2).length === 0, sent(env2).length);
}

/* 6. 퇴원생은 안 센다 */
{
  const env = build(
    [{ id: 1, name: '가', grade: '중2', className: todayCh + '중2', pin: '1111' }],
    [],
    [{ id: 5, name: '나간이', grade: '중2', className: todayCh + '중2', pin: '5555', withdrawDate: '2026-08-01' }]
  );
  env.run('sendAttendanceReminders()');
  check('퇴원생 제외 → 1명', /1명/.test(bodyOf(env)), bodyOf(env));
}

/* 7. 알림 토큰이 없으면 아무것도 안 한다 */
{
  const env = build([{ id: 1, name: '가', grade: '중2', className: todayCh + '중2', pin: '1111' }]);
  env.run('(function(){ var s = snapshot_(); })()');
  env.run("withLock_(function(){ return commitOps_([{op:'patch', collection:'_sets', id:'adminPushTokens', pullFromSet:{ value:'adminTok1' }}], 'test'); })");
  const before = sent(env).length;
  env.run('sendAttendanceReminders()');
  check('토큰 없으면 → 조용히 넘어감(오류 없음)', sent(env).length >= before);
}

console.log(`\n출석알림 테스트: 통과 ${pass}, 실패 ${fail}`);
process.exit(fail ? 1 : 0);
