// Local end-to-end test server: serves the repo's HTML files and a fake Apps Script web app at /exec,
// backed by the real gas/*.js code running on mock Google services with synthetic (fake) students.
// Usage: node tools/gas-sim/server.js [port]   → http://localhost:5510/imm_academy_system.html
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
process.argv[2] = path.join(ROOT, 'gas');
process.argv[3] = 'alpha';
const { makeEnv } = require('./mock.js');

const PORT = Number(process.env.PORT || process.argv[4] || 5510);
const TEST_ADMIN_KEY = 'local-test-key';

const today = new Date();
const iso = d => d.toISOString().slice(0, 10);
const daysAgo = n => { const d = new Date(today); d.setDate(d.getDate() - n); return iso(d); };

const sample = {
  version: 2, academyName: '테스트학원',
  students: [
    { id: 1, name: '가학생', grade: '중2', school: '가중학교', className: '월목중2', pin: '1111', familyCode: 'F1', enrollDate: '2026-03-02', bookProgress: {} },
    { id: 2, name: '나학생', grade: '중2', school: '나중학교', className: '월목중2', pin: '2222', enrollDate: '2026-03-02', bookProgress: {} },
    { id: 3, name: '다학생', grade: '초5', school: '다초등학교', className: '', pin: '0000', enrollDate: '2026-04-01' },
    { id: 4, name: '라학생', grade: '중1', school: '가중학교', className: '화금중1', pin: '4444', familyCode: 'F1', enrollDate: '2026-03-02', bookProgress: {} }
  ],
  withdrawnStudents: [{ id: 6, name: '바학생', grade: '중3', pin: '6666', withdrawDate: '2026-08-01' }],
  attendanceRecords: [
    { id: 1, studentId: 1, date: daysAgo(1), status: '출석' },
    { id: 2, studentId: 2, date: daysAgo(1), status: '결석' }
  ],
  dailyTests: [
    { id: 1, studentId: 1, date: daysAgo(2), unit: '삼각형의 성질', mode: 'count', total: 10, correct: 8, score: 80, wrongNumbers: [3, 7] },
    { id: 2, studentId: 2, date: daysAgo(2), unit: '삼각형의 성질', mode: 'count', total: 10, correct: 6, score: 60, wrongNumbers: [1, 2, 3, 4] }
  ],
  homeworkAssignments: [
    { id: 1, text: '쎈 10~12쪽', date: daysAgo(1), target: { type: 'class', className: '월목중2' }, doneBy: [2] }
  ],
  generalMakeups: [], progressLogs: [], answerKeys: [], homeworkRecords: [], mistakeRecords: [], examAnalysis: [], scheduleItems: [],
  parentMessages: [{ id: 1, studentId: 2, studentName: '나학생', date: new Date().toISOString(), message: '테스트 메시지예요' }],
  aiLearningReports: [],
  conceptBankItems: [
    { id: 1, className: '월목중2', unit: '1-1 이등변삼각형', question: '이등변삼각형의 두 ___의 크기는 같다.', choices: ['밑각', '꼭지각', '외각'], correctIndex: 0 }
  ],
  conceptDraftItems: [
    { id: 1, target: { type: 'class', className: '월목중2' }, unit: '1-2', question: '초안 문제 1 ___', choices: ['a', 'b', 'c'], correctIndex: 1, createdAt: new Date().toISOString() },
    { id: 2, target: { type: 'class', className: '월목중2' }, unit: '1-2', question: '초안 문제 2 ___', choices: ['a', 'b', 'c'], correctIndex: 2, createdAt: new Date().toISOString() }
  ],
  conceptTestRecords: [],
  teacherComments: { 1: '집중력이 좋아요' },
  conceptDailyCounts: { '월목중2': 5 }, conceptActiveDays: {}, conceptEnabledUnits: {}, studentBehaviorNotes: {},
  schoolInfos: [{ id: 1, school: '가중학교', examName: '2학기 중간고사', examDate: daysAgo(-20), examRange: '1~2단원', note: '' }],
  adminPushTokens: []
};

sample.students[0].pushTokens = ['fake-token-1'];

const env = makeEnv(JSON.stringify(sample));
env.props.PUSH_DISABLED = 'true';

// 가짜 Gemini: 사진 분석(analyzeExam)을 실제 AI 없이 화면 테스트할 수 있게 고정 응답을 돌려줘요
const fakeExamAnalysis = {
  examName: '데일리 테스트', range: '중2 일차함수 - 기울기와 y절편', unit: '일차함수', totalQuestions: 20, correctCount: 17, score: 85,
  wrongNumbers: [12, 15, 18], uncertainNumbers: [9], strengths: '기울기 구하기는 모두 정확',
  weakTypes: [{ numbers: [12, 15], type: 'y절편으로 식 세우기' }, { numbers: [18], type: '그래프 평행이동' }],
  causeGuess: '단순 계산실수',
  analysis: '기울기 구하기는 안정적이었지만, y절편을 이용해 식을 세우는 문제(12·15번)에서 부호 실수가 있었습니다.',
  supplement: '틀린 문제는 수업 중 오답 풀이로 부호 처리 과정을 다시 짚었고, 같은 유형 3문제를 더 풀며 확인했습니다.',
  teacherComment: '오늘은 일차함수의 기울기와 y절편을 다뤘습니다. 기울기 계산은 정확했고, 식 세우기에서 부호 실수가 있어 오답 풀이로 보완했습니다.'
};
const realFetch = env.ctx.UrlFetchApp.fetch;
env.ctx.UrlFetchApp.fetch = (u, opts) => String(u).includes('generativelanguage')
  ? { getResponseCode: () => 200, getContentText: () => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(fakeExamAnalysis) }] } }] }) }
  : realFetch(u, opts);
env.run('migrateToV2()');
env.props.ADMIN_KEY_PLAIN = TEST_ADMIN_KEY;
env.run('hashAdminKey()');
console.log(env.logs.filter(l => /✅|⚠️|❌/.test(l)).join('\n'));

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  if (parsed.pathname === '/exec') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    if (req.method === 'GET') {
      const out = env.ctx.doGet({ parameter: parsed.query });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(out.getContent());
    }
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let out;
      try { out = env.ctx.doPost({ postData: { contents: body } }).getContent(); }
      catch (e) { out = JSON.stringify({ ok: false, error: 'MOCK_CRASH', message: e.message }); console.error(e); }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(out);
    });
    return;
  }
  if (parsed.pathname === '/__state') {
    // test helper: current store contents (synthetic data only)
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ legacy: env.run('assembleLegacy_()'), rev: env.run('getMeta_().rev'), logs: env.logs.slice(-30) }));
  }
  const rel = decodeURIComponent(parsed.pathname === '/' ? '/imm_academy_system.html' : parsed.pathname);
  const filePath = path.join(ROOT, rel);
  if (!filePath.startsWith(ROOT) || rel.includes('..') || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404); return res.end('not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}).listen(PORT, () => console.log(`gas mock server: http://localhost:${PORT}/  (API: /exec)`));
