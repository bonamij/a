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

  if (body.action === 'generateLearningReport') {
    return handleGenerateLearningReport(body);
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
// 2026-08-19 수정: 사진분석(시험지)이랑 텍스트전용 작업(개념문제 생성, AI 학습 리포트)이
// 그동안 전부 'gemini-flash-latest' 모델 하나로만 호출돼서, 무료 등급 쿼터(모델별로 따로
// 배정됨)를 전부 같이 나눠 쓰고 있었어요. 그래서 개념문제 생성을 많이 돌리면 AI 리포트도
// 같이 막히고, 그 반대도 마찬가지였어요.
// 이제 model 파라미터를 추가해서, 텍스트전용 작업은 'gemini-flash-lite-latest'라는 다른
// 모델(무료 등급에서 분당/일일 요청 한도가 더 넉넉한 편)로 보내서 별도의 쿼터를 쓰게 했어요.
// 사진분석(handleAnalyzeExam)은 기존처럼 model 인자를 안 넘기면 그대로 'gemini-flash-latest'를 써요.
function callGeminiWithRetry(payload, maxAttempts, model) {
  maxAttempts = maxAttempts || 4;
  model = model || 'gemini-flash-latest';
  let response;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    response = UrlFetchApp.fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + GEMINI_API_KEY,
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

    // 2026-08-19 수정: 429여도 "하루 한도(RPD) 자체가 소진"된 경우엔 아무리 기다렸다
    // 재시도해도 절대 성공하지 않아요(자정 리셋 전까지). 그런데도 예전 로직은 이 경우에도
    // 매번 더 길게 기다리며 최대 4번씩 재시도해서, 스크립트 실행시간만 낭비하고 있었어요.
    // 응답 본문에 "PerDay"가 들어있으면(하루 한도 초과 표시) 바로 포기해서 시간을 아껴요.
    if (code === 429) {
      let bodyText = '';
      try { bodyText = response.getContentText(); } catch (e) {}
      if (bodyText.indexOf('PerDay') !== -1) {
        return response; // 하루 한도 소진 - 재시도 없이 바로 반환
      }
    }

    if ((code === 503 || code === 429) && attempt < maxAttempts) {
      Utilities.sleep(attempt * 8000); // 429(쿼터 초과) 때 더 넉넉하게 기다리도록 늘림
      continue;
    }

    return response;
  }

  return response;
}

// 429 응답이 "하루 한도(RPD) 소진"인지 판별하는 헬퍼 (스크립트 여러 곳에서 재사용)
function isGeminiDailyQuotaExhausted_(response) {
  try {
    if (!response || typeof response.getResponseCode !== 'function') return false;
    if (response.getResponseCode() !== 429) return false;
    const text = response.getContentText();
    return text.indexOf('PerDay') !== -1 || text.indexOf('generate_content_free_tier_requests') !== -1;
  } catch (e) {
    return false;
  }
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
      maxOutputTokens: 8192,
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
// 🔐 2026-09-15: 서비스 계정 키를 코드에 직접 두지 않고 스크립트 속성에서 불러와요.
// (스크립트 속성 FCM_SERVICE_ACCOUNT_JSON 에 다운받은 JSON 내용을 통째로 넣어두세요)
const SERVICE_ACCOUNT_KEY_JSON = (function () {
  const raw = PropertiesService.getScriptProperties().getProperty('FCM_SERVICE_ACCOUNT_JSON');
  if (!raw) return { private_key: '', client_email: '' };
  try { return JSON.parse(raw); } catch (e) { return { private_key: '', client_email: '' }; }
})();
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

/* =========================================================
   🧠 AI 학습 성향 분석 리포트 생성
   - 기존 GEMINI_API_KEY / callGeminiWithRetry() 를 그대로 재사용해요.
   - 사진 없이 텍스트만 보내서 리포트 JSON을 받아옵니다.
   - 이 함수는 시트에 아무것도 저장하지 않아요 (읽기 전용 AI 호출).
     생성된 리포트를 실제로 저장하는 건 관리자 앱의 기존 자동 동기화
     (syncToSheet)가 담당해요 — 다른 데이터랑 똑같은 방식.
========================================================= */
function handleGenerateLearningReport(body) {
  const student = body.student || {};
  const auto = body.auto || {};
  const manual = body.manual || {};

  const systemPrompt = '당신은 수학학원의 AI 학습 성향 분석 코치입니다. 주어진 학생 데이터를 바탕으로 학습 성향 코칭 리포트를 작성합니다.\n' +
    '반드시 순수 JSON 객체 하나만 반환하세요. 코드블록 표시(백틱)나 설명 문구 없이 JSON만 출력합니다.\n' +
    'JSON 스키마:\n' +
    '{\n' +
    '  "profile": [ {"type": "성향유형명(2~4자, 예: 반복형/안정추구형/불안형/의존형/감각형/도전형/분석형 등 상황에 맞게)", "percent": 정수} ... 5개, percent 합계는 정확히 100 ],\n' +
    '  "strengths": ["학습 강점 문장", ... 3~4개, 각 60~110자],\n' +
    '  "risks": ["주의/위험 요소 문장", ... 3~5개, 각 60~110자],\n' +
    '  "analysis": "전문가 종합 분석. 3~4개 문단을 \\n\\n으로 구분한 하나의 문자열. 각 문단 2~4문장. 데이터에 근거해 구체적으로.",\n' +
    '  "solutions": {\n' +
    '    "복습방법": "구체적 실행 방법 2~3문장",\n' +
    '    "암기방법": "구체적 실행 방법 2~3문장",\n' +
    '    "학습루틴": "구체적 실행 방법 2~3문장",\n' +
    '    "집중력향상": "구체적 실행 방법 2~3문장"\n' +
    '  },\n' +
    '  "parentGuide": ["학부모용 코칭 팁 문장", ... 정확히 3개, 각 60~120자],\n' +
    '  "internalScript": "학원 원장님/강사가 학부모 상담 시 참고할 톤의 요약 스크립트 문단, 150~250자"\n' +
    '}\n' +
    '어조는 따뜻하지만 전문적이고 구체적으로, 실제 학원 상담 리포트처럼 작성하세요. 반드시 위 스키마의 키 이름을 정확히 지키세요.';

  const userPrompt = '다음은 한 학생의 학습 데이터입니다.\n\n' +
    '[기본 정보]\n' +
    '이름: ' + (student.name || '') + ' / 학년: ' + (student.grade || '') + ' / 학교: ' + (student.school || '') + ' / 반: ' + (student.className || '') + '\n\n' +
    '[개념퀴즈 시스템 자동 연동 데이터]\n' +
    '- 최근 오답률: ' + (auto.wrongRatePct != null ? auto.wrongRatePct + '%' : '기록 없음') + '\n' +
    '- 학습 참여 진도율(최근 30일 제출일 비율): ' + (auto.progressRatePct != null ? auto.progressRatePct + '%' : '기록 없음') + '\n' +
    '- 주간 목표 달성: ' + (auto.weeklyGoal != null ? (auto.weeklyCount + '/' + auto.weeklyGoal) : '기록 없음') + '\n' +
    '- 데일리 테스트 평균(최근 ' + (auto.dailyTestCount || 0) + '회): ' + (auto.dailyTestAvg != null ? auto.dailyTestAvg + '점' : '기록 없음') + '\n' +
    '- 데일리 테스트 추세: ' + (auto.dailyTestTrend || '기록 없음') + '\n' +
    '- 교재 진도: ' + (auto.progressText || '기록 없음') + '\n\n' +
    '[수업 관찰 보완 입력 (선생님 체크)]\n' +
    '- 숙제 제출 속도: ' + (manual.hwSpeed || '입력 없음') + '\n' +
    '- 수업 집중도: ' + (manual.focus || '입력 없음') + '\n' +
    '- 발표·질문 참여도: ' + (manual.participation || '입력 없음') + '\n' +
    '- 실수 후 반응: ' + (manual.mistakeReaction || '입력 없음') + '\n' +
    '- 학습 스트레스 여부: ' + (manual.stress || '입력 없음') + '\n\n' +
    '위 데이터를 바탕으로 스키마에 맞는 JSON 리포트를 작성해주세요.';

  const payload = {
    contents: [{ parts: [{ text: systemPrompt + '\n\n' + userPrompt }] }],
    generationConfig: { temperature: 0.6, maxOutputTokens: 8192 }
  };

  try {
    // 2026-08-19 수정: 개념문제 자동생성 스크립트와 같은 모델('gemini-flash-latest')을 같이
    // 쓰면 그쪽에서 쿼터를 많이 쓸 때 리포트 생성도 같이 막혀요. 그래서 리포트처럼 사진 없는
    // 텍스트 전용 작업은 별도 쿼터를 쓰는 'gemini-flash-lite-latest' 모델로 보내요.
    const rawResponse = callGeminiWithRetry(payload, 4, 'gemini-flash-lite-latest');
    const responseCode = rawResponse.getResponseCode();
    const rawText = rawResponse.getContentText();

    if (responseCode !== 200) {
      const friendlyMsg = isGeminiDailyQuotaExhausted_(rawResponse)
        ? 'AI 무료 사용량(하루 한도)이 오늘 다 소진됐어요. 태평양시간 자정(한국시간 오후 4~5시경) 이후 초기화되니 그때 다시 시도해주세요.'
        : 'AI 서버 오류 (코드 ' + responseCode + '): ' + rawText.slice(0, 400);
      return ContentService.createTextOutput(JSON.stringify({ error: friendlyMsg }))
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
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: 'AI 리포트 생성 중 오류: ' + err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
