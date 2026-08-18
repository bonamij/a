const GEMINI_API_KEY = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');

function doGet(e) {
  const sheet = getDataSheet();
  const json = sheet.getRange('A1').getValue() || '{}';
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const body = JSON.parse(e.postData.contents);

  if (body.action === 'analyzeExam') {
    return handleAnalyzeExam(body);
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dataSheet = getDataSheet();

  // 🔔 덮어쓰기 전에, 알림 비교용으로 기존 데이터를 먼저 읽어둬요
  const oldJson = dataSheet.getRange('A1').getValue() || '{}';
  let oldData = {};
  try { oldData = JSON.parse(oldJson); } catch (e2) { oldData = {}; }

  dataSheet.getRange('A1').setValue(e.postData.contents);

let data = {};
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    Logger.log('JSON 파싱 오류: ' + err.message);
  }

  try {
    updateAttendanceSheets(ss, data);
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
  return ContentService.createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}
function callGeminiWithRetry(payload, maxAttempts) {
  maxAttempts = maxAttempts || 4;
  let response;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    response = UrlFetchApp.fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=' + GEMINI_API_KEY,
      {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      }
    );

    const code = response.getResponseCode();

    if (code === 200) {
      return response;
    }

    if ((code === 503 || code === 429) && attempt < maxAttempts) {
      Utilities.sleep(attempt * 3000);
      continue;
    }

    return response;
  }

  return response;
}

function handleAnalyzeExam(body) {
  const prompt = '다음은 학생의 수학 시험 결과지 사진이야 (여러 장이면 같은 시험의 연속된 페이지야). 사진들을 모두 보고 아래 JSON 형식으로만 답변해줘. 다른 설명이나 인사말, 코드블록 표시(```) 없이 순수 JSON만 출력해줘.\n' +
    '{\n' +
    '  "examName": "시험명 (사진에서 유추, 모르면 빈 문자열)",\n' +
    '  "totalQuestions": 전체문항수(숫자),\n' +
    '  "correctCount": 맞은개수(숫자),\n' +
    '  "score": 100점 만점 기준 점수(숫자),\n' +
    '  "wrongNumbers": [틀린 문항 번호들의 배열],\n' +
    '  "unit": "가장 많이 틀린 단원이나 유형을 간단히 요약 (문제 문장을 그대로 베끼지 말 것)",\n' +
    '  "causeGuess": "예상 오답 원인, 다음 중 하나로: 단순 계산실수 / 개념 이해 부족 / 응용력 부족 / 시간 부족",\n' +
    '  "teacherComment": "학부모님께 전달할 수 있는 자연스러운 한국어 문장 3~4문장. 오늘 다룬 단원/내용, 잘한 점과 부족했던 점(기초는 이해했으나 응용에서 아쉬웠다는 식), 앞으로의 보완 계획을 순서대로 포함. 따뜻한 선생님 말투로 작성."\n' +
    '}';

  const images = body.images || (body.image ? [{ data: body.image, mimeType: body.mimeType }] : []);

  if (images.length === 0) {
    return ContentService.createTextOutput(JSON.stringify({ error: '사진이 전달되지 않았어요.' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const parts = [{ text: prompt }];
  images.forEach(img => {
    parts.push({ inline_data: { mime_type: img.mimeType, data: img.data } });
  });

  const payload = {
    contents: [{ parts: parts }],
    generationConfig: {
      maxOutputTokens: 2048,
      thinkingConfig: { thinkingBudget: 0 }
    }
  };

  const response = callGeminiWithRetry(payload, 4);
  const responseCode = response.getResponseCode();
  const rawText = response.getContentText();

  if (responseCode !== 200) {
    return ContentService.createTextOutput(JSON.stringify({ error: 'AI 서버 오류 (코드 ' + responseCode + '): ' + rawText.slice(0, 400) }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  let analysisText = '';
  try {
    const result = JSON.parse(rawText);
    analysisText = result.candidates[0].content.parts[0].text;
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: 'AI 응답을 읽는 데 실패했어요. 원문: ' + rawText.slice(0, 400) }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return ContentService.createTextOutput(JSON.stringify({ error: 'AI 응답에서 JSON을 못 찾았어요. AI 원문: ' + analysisText.slice(0, 400) }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  try {
    JSON.parse(jsonMatch[0]);
  } catch (parseErr) {
    return ContentService.createTextOutput(JSON.stringify({ error: 'JSON 해석 실패. AI 원문 일부: ' + jsonMatch[0].slice(0, 400) }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService.createTextOutput(jsonMatch[0])
    .setMimeType(ContentService.MimeType.JSON);
}

function getDataSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Data');
  if (!sheet) sheet = ss.insertSheet('Data');
  return sheet;
}

function updateAttendanceSheets(ss, data) {
  const students = data.students || [];
  const records = data.attendanceRecords || [];
  if (students.length === 0) return;

  const months = {};
  records.forEach(r => {
    const month = r.date.slice(0, 7);
    if (!months[month]) months[month] = {};
    if (!months[month][r.studentId]) months[month][r.studentId] = {};

    let cellValue = r.status;
    if (r.status === '결석' && r.makeupDate) {
      const mk = r.makeupDate.split('-');
      const mkLabel = Number(mk[1]) + '/' + Number(mk[2]);
      cellValue = r.makeupDone ? ('결석(보강완료 ' + mkLabel + ')') : ('결석(보강예정 ' + mkLabel + ')');
    } else if (r.status === '결석') {
      cellValue = '결석(보강필요)';
    }

    months[month][r.studentId][r.date] = cellValue;
  });

  Object.keys(months).sort().forEach(month => {
    const sheetName = '출결_' + month;
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) sheet = ss.insertSheet(sheetName);
    sheet.clear();

    const parts = month.split('-').map(Number);
    const year = parts[0], mon = parts[1];
    const daysInMonth = new Date(year, mon, 0).getDate();

    const header = ['이름'];
    for (let d = 1; d <= daysInMonth; d++) header.push(d);
    sheet.getRange(1, 1, 1, header.length).setValues([header]);
    sheet.getRange(1, 1, 1, header.length).setFontWeight('bold').setBackground('#F2701C').setFontColor('#FFFFFF');

    const rows = students.map(s => {
      const row = [s.name];
      const rec = months[month][s.id] || {};
      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = year + '-' + String(mon).padStart(2, '0') + '-' + String(d).padStart(2, '0');
        row.push(rec[dateStr] || '');
      }
      return row;
    });

    if (rows.length) {
      sheet.getRange(2, 1, rows.length, header.length).setValues(rows);
    }

    sheet.setFrozenRows(1);
    sheet.setFrozenColumns(1);
  });
}

/* =========================================================
   ① 서비스 계정 키 (아래 중괄호 안에 다운받은 JSON 파일 내용을 통째로 붙여넣으세요)
========================================================= */
const SERVICE_ACCOUNT_KEY_JSON = JSON.parse(PropertiesService.getScriptProperties().getProperty('SERVICE_ACCOUNT_KEY_JSON'));

const FIREBASE_PROJECT_ID = 'im-math';

function getFcmAccessToken_() {
  const service = OAuth2.createService('FCM')
    .setTokenUrl('https://oauth2.googleapis.com/token')
    .setPrivateKey(SERVICE_ACCOUNT_KEY_JSON.private_key)
    .setIssuer(SERVICE_ACCOUNT_KEY_JSON.client_email)
    .setPropertyStore(PropertiesService.getScriptProperties())
    .setScope('https://www.googleapis.com/auth/firebase.messaging');
  if (!service.hasAccess()) throw new Error('FCM 인증 실패: ' + service.getLastError());
  return service.getAccessToken();
}

function sendPushToTokens(tokens, title, body, url) {
  if (!tokens || tokens.length === 0) return;
  const accessToken = getFcmAccessToken_();
  tokens.forEach(function (token) {
    const payload = {
      message: {
        token: token,
        notification: { title: title, body: body },
        data: { url: url || './' },
        webpush: { fcm_options: { link: url || './' } }
      }
    };
    const res = UrlFetchApp.fetch(
      'https://fcm.googleapis.com/v1/projects/' + FIREBASE_PROJECT_ID + '/messages:send',
      {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + accessToken },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      }
    );
    console.log('FCM 응답:', res.getResponseCode(), res.getContentText());
  });
}

/* =========================================================
   ② 테스트 발송용 함수 — 이것만 실행하면 돼요
   (구글시트에 저장된 첫 번째 알림 토큰을 자동으로 찾아서 테스트 알림을 보내요)
========================================================= */
function testSendPush() {
  const sheet = getDataSheet();
  const json = sheet.getRange('A1').getValue() || '{}';
  const data = JSON.parse(json);

 let tokens = [...(data.adminPushTokens || [])];
(data.students || []).forEach(function (s) {
  if (s.pushTokens && s.pushTokens.length) tokens = tokens.concat(s.pushTokens);
});
tokens = [...new Set(tokens)];

if (tokens.length === 0) {
  console.log('❌ 저장된 알림 토큰이 없어요. 먼저 관리자 앱이나 학부모 포털에서 "알림 받기"를 눌러주세요.');
  return;
}

console.log('찾은 토큰들:', tokens);
sendPushToTokens(tokens, '🔔 테스트 알림', '이 알림이 보이면 성공이에요!', './');
  console.log('✅ 발송 시도 완료! 핸드폰/브라우저를 확인해보세요.');
}
function notifyNewHomework_(oldData, newData) {
  const oldIds = new Set((oldData.homeworkAssignments || []).map(function (a) { return a.id; }));
  const list = newData.homeworkAssignments || [];
  Logger.log('[숙제알림] 기존 ' + oldIds.size + '개, 지금 ' + list.length + '개');

  list.forEach(function (a) {
    if (oldIds.has(a.id)) return;
    Logger.log('[숙제알림] 새 숙제 발견: id=' + a.id + ' text=' + a.text);

    let targets = [];
    if (a.target && a.target.type === 'class') {
      targets = (newData.students || []).filter(function (s) { return s.className === a.target.className; });
    } else if (a.target && a.target.type === 'individual') {
      targets = (newData.students || []).filter(function (s) { return a.target.studentIds.indexOf(s.id) !== -1; });
    }
    Logger.log('[숙제알림] 대상 학생 ' + targets.length + '명: ' + targets.map(function (s) { return s.name; }).join(','));

    targets.forEach(function (s) {
      Logger.log('[숙제알림] ' + s.name + ' 토큰 개수: ' + ((s.pushTokens || []).length));
      sendPushToTokens(s.pushTokens, '📔 새 숙제가 도착했어요', a.text, './parent_portal.html');
    });
  });
}

function notifyNewGeneralMakeup_(oldData, newData) {
  const oldIds = new Set((oldData.generalMakeups || []).map(function (r) { return r.id; }));
  const list = newData.generalMakeups || [];
  Logger.log('[보강알림] 기존 ' + oldIds.size + '개, 지금 ' + list.length + '개');

  list.forEach(function (r) {
    if (oldIds.has(r.id)) return;
    Logger.log('[보강알림] 새 보강 발견: id=' + r.id);

    let targets = [];
    if (r.target && r.target.type === 'class') {
      targets = (newData.students || []).filter(function (s) { return s.className === r.target.className; });
    } else if (r.target && r.target.type === 'individual') {
      targets = (newData.students || []).filter(function (s) { return r.target.studentIds.indexOf(s.id) !== -1; });
    }
    Logger.log('[보강알림] 대상 학생 ' + targets.length + '명');

    targets.forEach(function (s) {
      sendPushToTokens(s.pushTokens, '🗓️ 보강 일정이 등록됐어요', r.date + (r.reason ? ' · ' + r.reason : ''), './parent_portal.html');
    });
  });
}

function notifyNewParentMessage_(oldData, newData) {
  const oldCount = (oldData.parentMessages || []).length;
  const newMessages = (newData.parentMessages || []).slice(oldCount);
  Logger.log('[메시지알림] 기존 ' + oldCount + '개, 새 메시지 ' + newMessages.length + '개');
  if (newMessages.length === 0) return;

  Logger.log('[메시지알림] 원장님 토큰 개수: ' + ((newData.adminPushTokens || []).length));
  sendPushToTokens(
    newData.adminPushTokens,
    '💬 학부모 메시지가 도착했어요',
    newMessages.map(function (m) { return m.studentName + ': ' + m.message; }).join(' / '),
    './imm_academy_system.html'
  );
}
