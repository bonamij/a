// One-time codemod: switches parent_portal.html to the v2 parent API (server-filtered data, token login).
// Every replacement asserts its match count so a drifted file fails loudly instead of half-applying.
const fs = require('fs');
const path = require('path');

const file = process.argv[2];
let src = fs.readFileSync(file, 'utf8');
const crlf = src.includes('\r\n');
if (crlf) src = src.replace(/\r\n/g, '\n');
const block = name => fs.readFileSync(path.join(__dirname, name), 'utf8').replace(/\r\n/g, '\n').replace(/\n$/, '');

function count(sub) { let n = 0, i = 0; while ((i = src.indexOf(sub, i)) !== -1) { n++; i += sub.length; } return n; }
function rep(oldS, newS, expected = 1) {
  const n = count(oldS);
  if (n !== expected) throw new Error('rep: found ' + n + ', expected ' + expected + ': ' + oldS.slice(0, 90));
  src = src.split(oldS).join(newS);
}
function between(start, end, newS) {
  const n = count(start);
  if (n !== 1) throw new Error('between start: found ' + n + ': ' + start.slice(0, 90));
  const a = src.indexOf(start);
  const b = src.indexOf(end, a);
  if (b < 0) throw new Error('between end not found: ' + end.slice(0, 90));
  src = src.slice(0, a) + newS + src.slice(b + end.length);
}

/* ---- server address (+ local-only test override) ---- */
between("/* ⚙️ 학원 선생님만: 구글 Apps Script 웹 앱 URL", "const SHEET_URL = 'https://script.google.com/macros/s/AKfycby248HXB7pvkzJ1gBjmLux0myAH2otNNt2A4Vp0edu0HAW49W42-8-uJzN_aKnbP6Uf/exec';",
  "/* ⚙️ 서버(구글 Apps Script 웹 앱) 주소 — 관리자 앱과 같은 주소예요 */\n" +
  "const DEFAULT_API_URL = 'https://script.google.com/macros/s/AKfycby248HXB7pvkzJ1gBjmLux0myAH2otNNt2A4Vp0edu0HAW49W42-8-uJzN_aKnbP6Uf/exec';\n" +
  "let API_URL = DEFAULT_API_URL;\n" +
  "(function(){\n" +
  "  // 테스트용: 내 컴퓨터(localhost)에서 열었을 때만 ?api= 로 서버 주소를 바꿀 수 있어요 (다른 사이트 링크로는 못 바꿔요)\n" +
  "  const isLocal = /^(localhost|127\\.0\\.0\\.1)$/.test(location.hostname);\n" +
  "  const override = new URLSearchParams(location.search).get('api');\n" +
  "  if(isLocal && override){\n" +
  "    API_URL = override;\n" +
  "    document.addEventListener('DOMContentLoaded', () => document.body.insertAdjacentHTML('afterbegin', '<div style=\"position:fixed;top:0;left:50%;transform:translateX(-50%);background:#B8391F;color:#fff;font-size:12px;font-weight:800;padding:4px 14px;border-radius:0 0 10px 10px;z-index:10000;\">🧪 테스트 서버</div>'));\n" +
  "  }\n" +
  "})();\n" +
  "const PORTAL_CLIENT_VERSION = 2;\n" +
  "const PORTAL_SESSION_KEY = 'academyParentSession|' + API_URL;");

/* ---- login / load ---- */
between('async function fetchData(){', '  renderReport(currentData, student);\n}', block('session.js.txt'));

/* ---- group average now comes precomputed from the server ---- */
rep('function computeGroupAvgScore(studentId, data){\n',
  'function computeGroupAvgScore(studentId, data){\n  if(data && data.groupAvgScore !== undefined) return data.groupAvgScore; // 서버가 계산해서 보내줘요\n');
rep('  const count = (student.pushTokens || []).length;',
  '  const count = student.pushTokenCount !== undefined ? student.pushTokenCount : (student.pushTokens || []).length;');

/* ---- parent writes: one small action each ---- */
between("    const freshRes = await fetch(SHEET_URL, { method:'GET' });\n    const freshData = await freshRes.json();\n    const student = (freshData.students || []).find(s => s.id === studentId);\n    if(student){",
  '    updateStudentPushButtonState(student);',
  "    const res = await portalApi_('parentRegisterPushToken', { token: parentToken, studentId, pushToken: token });\n" +
  "    const student = (currentData.students || []).find(s => s.id === studentId);\n" +
  "    if(student) student.pushTokenCount = res.pushTokenCount;\n" +
  "    if(statusEl) statusEl.textContent = '✅ 알림이 켜졌어요! 숙제·개념빈칸 알림을 이 기기로 받을 수 있어요.';\n" +
  "    if(btn){ btn.disabled = false; }\n" +
  "    updateStudentPushButtonState(student);");

between("  try {\n    const freshRes = await fetch(SHEET_URL, { method:'GET' });\n    const freshData = await freshRes.json();\n\n    // 2026-08-21 수정",
  "  } catch(err){\n    // 저장에 실패해도 학생에게는 결과를 보여주고, 다음 접속 때 다시 시도할 수 있게 안내\n  }",
  "  let saveFailed = false;\n" +
  "  try {\n" +
  "    await portalApi_('parentSubmitQuiz', { token: parentToken, studentId: s.student.id, correct: correctCount, total: s.questions.length, wrongItemIds, correctItemIds });\n" +
  "    delete studentDataCache[s.student.id]; // 리포트로 돌아가면 새 기록이 반영돼요\n" +
  "  } catch(err){\n" +
  "    saveFailed = true;\n" +
  "  }");
rep("      <div class=\"cq-week-row\">\n        <div class=\"cq-week-count\">${correctCount}<span> / ${s.questions.length} 정답</span></div>\n      </div>\n      ${summaryRows.join('')}",
  "      <div class=\"cq-week-row\">\n        <div class=\"cq-week-count\">${correctCount}<span> / ${s.questions.length} 정답</span></div>\n      </div>\n      ${saveFailed ? '<div class=\"cq-status pending\">⚠️ 결과를 저장하지 못했어요. 인터넷 연결을 확인하고 다시 풀어주세요.</div>' : ''}\n      ${summaryRows.join('')}");

between("  try {\n    const freshRes = await fetch(SHEET_URL, { method:'GET' });\n    const freshData = await freshRes.json();\n\n    freshData.homeworkAssignments",
  "    showStudentReport(studentId);\n  } catch(err){\n    if(statusEl) statusEl.textContent = '❌ 저장에 실패했어요. 잠시 후 다시 시도해주세요.';\n  }",
  "  try {\n" +
  "    await portalApi_('parentToggleHomework', { token: parentToken, studentId, assignmentId, done: !!checked });\n" +
  "    await showStudentReport(studentId, true);\n" +
  "  } catch(err){\n" +
  "    alert('❌ ' + err.message);\n" +
  "    showStudentReport(studentId, true).catch(() => {}); // 체크 표시를 서버 상태로 되돌려요\n" +
  "  }");

between("  try {\n    const freshRes = await fetch(SHEET_URL, { method:'GET' });\n    const freshData = await freshRes.json();\n    const student = (freshData.students || []).find(s => s.id === studentId);\n\n    freshData.parentMessages",
  "    statusEl.textContent = '✅ 선생님께 전달했어요!';\n    showStudentReport(studentId);\n  } catch(err){\n    statusEl.textContent = '❌ 전송에 실패했어요. 잠시 후 다시 시도해주세요.';\n  }",
  "  try {\n" +
  "    await portalApi_('parentSendMessage', { token: parentToken, studentId, message: text });\n" +
  "    await showStudentReport(studentId, true);\n" +
  "    const doneEl = document.getElementById('parentMsgStatus');\n" +
  "    if(doneEl) doneEl.textContent = '✅ 선생님께 전달했어요!';\n" +
  "  } catch(err){\n" +
  "    statusEl.textContent = '❌ ' + err.message;\n" +
  "  }");

/* ---- report view: async student switching + logout ---- */
rep('onclick="showStudentReport(${s.id})"', 'onclick="showStudentReport(${s.id}).catch(err => alert(err.message))"');
rep('onclick="showStudentReport(${studentIdForClose})"', 'onclick="showStudentReport(${studentIdForClose}).catch(err => alert(err.message))"');
rep("  wrap.innerHTML = `\n    ${alertBannerHtml}\n    ${siblingTabsHtml}",
  "  wrap.innerHTML = `\n    <div style=\"display:flex; justify-content:flex-end; margin-bottom:8px;\"><button type=\"button\" class=\"btn ghost\" style=\"width:auto; padding:6px 12px; font-size:12.5px;\" onclick=\"parentLogout()\">로그아웃</button></div>\n    ${alertBannerHtml}\n    ${siblingTabsHtml}");

/* ---- nothing old may remain ---- */
[/SHEET_URL/, /fetchData\(/, /freshData/].forEach(re => { if (re.test(src)) throw new Error('leftover: ' + re); });

if (crlf) src = src.replace(/\n/g, '\r\n');
fs.writeFileSync(file, src);
console.log('portal codemod ok, lines:', src.split('\n').length);
