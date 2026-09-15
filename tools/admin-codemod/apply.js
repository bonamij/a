// One-time codemod: switches imm_academy_system.html to the v2 per-record sync.
// Every replacement asserts its match count so a drifted file fails loudly instead of half-applying.
const fs = require('fs');
const path = require('path');

const file = process.argv[2];
const dir = __dirname;
let src = fs.readFileSync(file, 'utf8');
const crlf = src.includes('\r\n');
if (crlf) src = src.replace(/\r\n/g, '\n');
const block = name => fs.readFileSync(path.join(dir, name), 'utf8').replace(/\r\n/g, '\n');
const markup = block('markup.txt');
const part = (a, b) => markup.slice(markup.indexOf(a) + a.length + 1, markup.indexOf(b));

function count(sub) { let n = 0, i = 0; while ((i = src.indexOf(sub, i)) !== -1) { n++; i += sub.length; } return n; }
function rep(oldS, newS, expected = 1) {
  const n = count(oldS);
  if (n !== expected) throw new Error(`rep: found ${n}, expected ${expected}: ${oldS.slice(0, 90)}`);
  src = src.split(oldS).join(newS);
}
function between(start, end, newS) {
  const n = count(start);
  if (n !== 1) throw new Error(`between start: found ${n}: ${start.slice(0, 90)}`);
  const a = src.indexOf(start);
  const b = src.indexOf(end, a);
  if (b < 0) throw new Error(`between end not found: ${end.slice(0, 90)}`);
  src = src.slice(0, a) + newS + src.slice(b + end.length);
}

/* ---- markup ---- */
rep('</style>', part('@@CSS@@', '@@LOCK@@') + '</style>');
rep('<div class="sidebar-overlay" id="sidebarOverlay" onclick="closeSidebar()"></div>',
  '<div class="sidebar-overlay" id="sidebarOverlay" onclick="closeSidebar()"></div>\n' + part('@@LOCK@@', '@@CARD@@'));
rep('        <div class="today mono" id="todayLabel"></div>',
  '        <div class="today mono" id="todayLabel"></div>\n        <button type="button" class="save-indicator pending" id="saveIndicator" onclick="syncNow()" title="누르면 바로 저장·새로고침">⏳ 불러오는 중</button>');
between('<h3>☁️ 구글시트 연동</h3>', '구글시트 연동이 꺼져 있어요.</div>', part('@@CARD@@', '@@END@@').replace(/\n$/, ''));
rep('<div class="sub">저장해둔 백업 파일(.json)을 선택하면 지금 화면의 데이터가 그 파일 내용으로 교체돼요.</div>',
  '<div class="sub">저장해둔 백업 파일(.json)을 선택하면 지금 데이터가 그 파일 내용으로 교체되고 서버에도 저장돼요. 구글 드라이브 "아임수학학원_백업" 폴더의 파일도 받아서 넣을 수 있어요.</div>');
rep('<div class="sub">모든 데이터를 지우고 처음 상태로 되돌려요. 되돌릴 수 없으니 꼭 먼저 백업해주세요.</div>',
  '<div class="sub">모든 데이터를 지우고 처음 상태로 되돌려요. "초기화"라고 입력해야 실행되고, 지우기 직전 상태는 서버에 자동으로 백업돼요.</div>');

/* ---- sync core ---- */
between('// 구글시트에서 불러온 데이터가 정상인지 확인', 'let syncRetryTimer = null;', block('core1.js.txt').replace(/\n$/, ''));
between('function saveSheetSyncUrl(){', "setSyncStatus('❌ 저장에 실패했어요. 인터넷 연결과 URL을 확인해주세요.');\n  }\n}", block('core2.js.txt').replace(/\n$/, ''));
between('function handleRestoreFile(e){', "document.getElementById('backupStatus').textContent = '🗑️ 전체 데이터를 초기화했어요.';\n  scheduleSync();\n}", block('restore-reset.js.txt').replace(/\n$/, ''));

/* ---- init ---- */
rep("  switchTab('dashboard');\n  renderDashboard();\n  renderStudents();",
  "  switchTab('dashboard');\n  renderAll_();\n  startSync_();\n}\n\n// 모든 탭 화면 다시 그리기 (처음 시작 · 다른 기기 변경 반영 때)\nfunction renderAll_(){\n  renderDashboard();\n  renderStudents();");
rep("  renderExamWeakSummary();\n\n  if(sheetSyncUrl){\n    document.getElementById('sheetSyncUrlInput').value = sheetSyncUrl;\n    setSyncStatus('🔄 구글시트에서 불러오는 중...');\n    syncFromSheet();\n  }\n}",
  "  renderExamWeakSummary();\n}");
rep("  if(tab === 'homework' && sheetSyncUrl) syncFromSheet();", "  if(tab === 'homework' && storeReady) syncNow();");

/* ---- functions that fetched + posted the whole dataset ---- */
between("  if(!sheetSyncUrl){\n    generalMakeups.push(", "alert('보강 등록 중 저장에 실패했어요. 인터넷 연결을 확인해주세요.');\n  }\n}",
  "  generalMakeups.push({ id: newId_(), date, reason, target, doneBy: [] });\n  renderGeneralMakeupList();\n  renderDashboard();\n  syncNow();\n}");
between("  renderConceptUnitPicker(classNames);\n\n  if(!sheetSyncUrl) return;", "setSyncStatus('⚠️ 범위 저장 실패');\n  }\n}",
  "  renderConceptUnitPicker(classNames);\n  scheduleSync();\n}");
between("  renderConceptDailyCountList(classNames);\n\n  if(!sheetSyncUrl) return;", "setSyncStatus('⚠️ 요일 저장 실패');\n  }\n}",
  "  renderConceptDailyCountList(classNames);\n  scheduleSync();\n}");
between("  conceptDailyCounts[className] = n;\n\n  if(!sheetSyncUrl) return;", "setSyncStatus('⚠️ 문제 수 저장 실패');\n  }\n}",
  "  conceptDailyCounts[className] = n;\n  scheduleSync();\n}");
between("  if(!sheetSyncUrl){\n    conceptBankItems = conceptBankItems.filter(i => i.id !== id);", "setSyncStatus('⚠️ 삭제 저장 실패');\n  }\n}",
  "  conceptBankItems = conceptBankItems.filter(i => i.id !== id);\n  renderConceptItemList();\n  scheduleSync();\n}");
between("  if(!sheetSyncUrl){\n    conceptBankItems = conceptBankItems.filter(i => !targetIds.has(i.id));", "setSyncStatus('⚠️ 삭제 저장 실패');\n  }\n}",
  "  conceptBankItems = conceptBankItems.filter(i => !targetIds.has(i.id));\n  renderConceptItemList();\n  allowBulkDelete_ = true;\n  scheduleSync();\n}");
between("  if(!sheetSyncUrl){\n    conceptBankItems.push({\n      id: nextConceptItemId++,", "setSyncStatus('⚠️ 승인 저장 실패');\n  }\n}",
  "  conceptBankItems.push({\n    id: newId_(),\n    className: item.target.className,\n    unit: item.unit || '',\n    question: item.question,\n    choices: item.choices,\n    correctIndex: item.correctIndex\n  });\n  conceptDraftItems = conceptDraftItems.filter(i => i.id !== id);\n  recentlyApprovedConceptDrafts.push({ label: conceptDraftTargetLabel_(item.target), unit: item.unit || '', question: item.question });\n  if(recentlyApprovedConceptDrafts.length > 30) recentlyApprovedConceptDrafts.shift();\n  renderConceptDraftList();\n  renderConceptItemList();\n  scheduleSync();\n}");
between("  if(!sheetSyncUrl){\n    approvable.forEach(item => {", "setSyncStatus('⚠️ 전체 승인 저장 실패');\n  }\n}",
  "  approvable.forEach(item => {\n    conceptBankItems.push({\n      id: newId_(),\n      className: item.target.className,\n      unit: item.unit || '',\n      question: item.question,\n      choices: item.choices,\n      correctIndex: item.correctIndex\n    });\n    recentlyApprovedConceptDrafts.push({ label: conceptDraftTargetLabel_(item.target), unit: item.unit || '', question: item.question });\n  });\n  if(recentlyApprovedConceptDrafts.length > 30) recentlyApprovedConceptDrafts = recentlyApprovedConceptDrafts.slice(-30);\n  conceptDraftItems = conceptDraftItems.filter(i => !approvedIds.has(i.id));\n  renderConceptDraftList();\n  renderConceptItemList();\n  allowBulkDelete_ = true;\n  scheduleSync();\n}");
between("async function rejectConceptDraft(id){\n  if(!sheetSyncUrl){", "setSyncStatus('⚠️ 거절 저장 실패');\n  }\n}",
  "async function rejectConceptDraft(id){\n  conceptDraftItems = conceptDraftItems.filter(i => i.id !== id);\n  renderConceptDraftList();\n  scheduleSync();\n}");
between("  if(!sheetSyncUrl){\n    conceptDraftItems = [];", "setSyncStatus('⚠️ 전체 거절 저장 실패');\n  }\n}",
  "  conceptDraftItems = conceptDraftItems.filter(i => !rejectedIds.has(i.id));\n  renderConceptDraftList();\n  allowBulkDelete_ = true;\n  scheduleSync();\n}");
between("  if(!sheetSyncUrl){\n    homeworkAssignments.push(", "alert('숙제 배정 중 저장에 실패했어요. 인터넷 연결을 확인해주세요.');\n  }\n}",
  "  homeworkAssignments.push({ id: newId_(), text, date, target, doneBy: [] });\n  renderHomeworkAssignments();\n  renderDashboard();\n  syncNow();\n}");

rep("  if(!sheetSyncUrl){ alert('먼저 구글시트 연동을 설정해주세요.'); return; }",
  "  if(!storeReady){ alert('아직 데이터를 불러오는 중이에요. 잠시 후 다시 시도해주세요.'); return; }");
between("    const freshRes = await fetch(sheetSyncUrl, { method:'GET' });\n    const freshData = await freshRes.json();\n    assertDataLooksSane_(freshData);\n    freshData.adminPushTokens", "    adminPushTokens = freshData.adminPushTokens;",
  "    if(!adminPushTokens.includes(token)) adminPushTokens.push(token);\n    await syncNow();\n    if(syncErrorMessage) throw new Error(syncErrorMessage);");

/* ---- AI calls now need the admin password ---- */
rep("  if(!sheetSyncUrl){\n    alert('구글시트 연동이 꺼져 있어요. \"데이터 관리\" 탭에서 먼저 연동해주세요.');\n    return;\n  }",
  "  if(!storeReady){\n    alert('아직 데이터를 불러오는 중이에요. 잠시 후 다시 시도해주세요.');\n    return;\n  }");
rep("body: JSON.stringify({ action: 'analyzeExam', images })", "body: JSON.stringify(apiBody_('analyzeExam', { images }))");
rep("  if(!sheetSyncUrl){\n    errBox.textContent = '구글 시트 연동 URL이 설정되어 있지 않아요. \"데이터 관리\" 탭에서 먼저 설정해주세요.';",
  "  if(!storeReady){\n    errBox.textContent = '아직 데이터를 불러오는 중이에요. 잠시 후 다시 시도해주세요.';");
rep("body: JSON.stringify({\n          action: 'generateLearningReport',", "body: JSON.stringify(apiBody_('generateLearningReport', {");
rep("          auto, manual\n        })\n      });", "          auto, manual\n        }))\n      });");
rep("const result = await res.json();",
  "const result = await res.json();\n    if(result && result.ok === false){\n      if(AUTH_ERRORS.includes(result.error)) showAdminLock_(result.message);\n      result.error = result.message || result.error;\n    }", 2);

/* ---- ids that can't collide across devices ---- */
[['nextScheduleId++', 1], ['nextStudentId++', 2], ['nextProgressId++', 2], ['nextAttendanceId++', 1], ['nextDailyId++', 1],
 ['nextAnswerKeyId++', 1], ['nextMistakeId++', 1], ['nextSchoolInfoId++', 1], ['nextExamId++', 1], ['nextAiReportId++', 1]]
  .forEach(([s, n]) => rep(s, 'newId_()', n));

/* ---- small fix: attendance tooltip escaping ---- */
rep('title="${title}"', 'title="${escapeHtml(title)}"');

/* ---- nothing old may remain ---- */
const leftovers = [/next\w+Id\+\+/, /assertDataLooksSane_\(/, /fetch\(sheetSyncUrl, \{ method:'GET' \}\)/, /mergeArrays_\(/, /if\(!sheetSyncUrl\)/];
leftovers.forEach(re => { if (re.test(src)) throw new Error('leftover: ' + re); });

if (crlf) src = src.replace(/\n/g, '\r\n');
fs.writeFileSync(file, src);
console.log('codemod ok, lines:', src.split('\n').length);
