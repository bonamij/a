/**
 * ============================================================================
 * 🧩 개념빈칸 문제 매일 자동 생성 스크립트 (제미나이 버전, 안전장치 포함)
 * ============================================================================
 * 하는 일:
 *  1) 지금 앱 데이터를 불러와서
 *  2) 이미 앱에 있는 GEMINI_API_KEY / callGeminiWithRetry()를 그대로 재사용해서
 *     반마다 새 개념빈칸 문제를 만들고
 *  3) 문제은행(conceptBankItems)에 바로 넣지 않고, "검토 대기함"(conceptDraftItems)에
 *     넣어둡니다. 원장님이 관리자 앱에서 승인해야 학생한테 나가요.
 *  4) 다 되면 원장님 폰으로 푸시 알림을 보내드려요 (이미 만들어둔 알림 기능 재사용).
 *
 * 별도 API 키나 결제가 필요 없어요 — 이미 있는 GEMINI_API_KEY를 그대로 써요.
 *
 * ── 설치 방법 ──────────────────────────────────────────
 *  1. Apps Script 프로젝트에 새 스크립트 파일로 추가 (Code.gs 옆에 별도 파일로)
 *  2. 아래 CONFIG의 SHEET_URL을 실제 웹앱 주소로 교체
 *     (parent_portal.html/imm_academy_system.html 안의 SHEET_URL과 동일한 값)
 *  3. 별도 설정 필요 없음 — GEMINI_API_KEY, callGeminiWithRetry는 기존 Code.gs 걸 그대로 써요.
 *  4. 왼쪽 메뉴 "트리거"(시계 아이콘) → 트리거 추가
 *     - 실행할 함수: generateDailyConceptQuestions
 *     - 이벤트 소스: 시간 기반 → 일 타이머 → 원하는 시간대 (예: 새벽 4시~5시)
 *  5. 저장 전에 "지금 실행" 버튼으로 한 번 테스트해보세요.
 *    실행 로그(보기 → 실행 기록)에서 성공/실패를 확인할 수 있어요.
 * ============================================================================
 */

const CONCEPT_AUTOGEN_CONFIG = {
  SHEET_URL: 'https://script.google.com/macros/s/여기에_실제_URL_붙여넣기/exec',
  QUESTIONS_PER_CLASS: 3,
};

/**
 * 반별 개념 요약 (중2-2 개념노트 기반)
 * 여기 없는 반(className)은 자동으로 건너뜁니다.
 * 학년/교재가 바뀌면 이 부분만 갱신하면 돼요.
 */
const CONCEPT_CURRICULUM_BY_UNIT = {
  "1-1 이등변삼각형": "이등변삼각형: 두 변의 길이가 같은 삼각형. 꼭지각(길이가 같은 두 변이 이루는 각)/밑변(꼭지각의 대변)/밑각. 두 밑각의 크기는 같다. 꼭지각의 이등분선은 밑변을 수직이등분한다. 두 내각이 같으면 이등변삼각형(역).",
  "1-2 직각삼각형의 합동조건": "직각삼각형에서 직각의 대변=빗변. RHA합동(빗변+한 예각), RHS합동(빗변+다른 한 변). 각의 이등분선 위의 점은 그 각을 이루는 두 변까지 거리가 같다(역도 성립).",
  "1-3 삼각형의 외심과 내심": "외심=외접원 중심=세 변의 수직이등분선의 교점, OA=OB=OC. 직각삼각형의 외심=빗변의 중점. 내심=내접원 중심=세 내각의 이등분선의 교점, ID=IE=IF, 항상 내부에 위치.",
  "2-1 평행사변형": "두 쌍의 대변이 각각 평행. 대변 길이 같음/대각 크기 같음/두 대각선이 서로를 이등분. 되는 조건 5가지 중 하나만 만족해도 평행사변형.",
  "2-2 여러 가지 사각형": "직사각형(네 내각 90도, 대각선 길이 같고 이등분), 마름모(네 변 길이 같음, 대각선 수직이등분), 정사각형(둘 다), 사다리꼴/등변사다리꼴.",
  "2-3 평행선과 넓이": "밑변 공통+평행선 사이=넓이 같음. 높이가 같으면 넓이비=밑변비. 등적변형.",
  "3-1 닮음의 뜻과 성질": "닮음비, 둘레의 비=닮음비, 넓이의 비=닮음비의 제곱, 부피의 비=닮음비의 세제곱.",
  "3-2 삼각형의 닮음조건": "SSS닮음(세 변의 비), SAS닮음(두 변의 비+끼인각), AA닮음(두 각). 직각삼각형에서 한 예각이 같으면 AA닮음.",
  "4-1 삼각형과 평행선": "BC∥DE이면 AB:AD=AC:AE=BC:DE (역도 성립). 내각/외각의 이등분선과 변의 비.",
  "4-2 중점연결정리": "두 변의 중점을 이은 선분은 나머지 변과 평행, 길이는 1/2. 사다리꼴에서 MN=(AD+BC)/2.",
  "4-3 평행선 사이의 선분의 길이의 비": "l∥m∥n이면 a:b=a′:b′ (역은 성립하지 않음).",
  "4-4 삼각형의 무게중심": "세 중선의 교점=무게중심, 2:1로 나눔, 중선은 넓이를 이등분, 6개 삼각형 넓이 모두 같음(1/6씩).",
  "5-1 피타고라스 정리": "a²+b²=c² (직각삼각형). c²=a²+b²이면 직각, c²>a²+b²이면 둔각, c²<a²+b²이면 예각삼각형.",
  "5-2 피타고라스 정리의 활용": "두 대각선이 직교하는 사각형: AB²+CD²=AD²+BC². 반원 넓이: S1+S2=S3.",
  "6-1 경우의 수": "동시에 일어나지 않음(또는)=덧셈법칙 a+b, 동시에 일어남(그리고)=곱셈법칙 a×b.",
  "6-2 여러 가지 경우의 수": "한 줄 세우기 n!, 대표뽑기(자격 다름=n(n-1), 자격 같음=n(n-1)/2), 자연수 만들기(맨 앞 0 불가).",
  "7-1 확률의 뜻과 성질": "확률=해당 경우의 수/전체 경우의 수, 0≤p≤1, 여사건 확률=1-p.",
  "7-2 확률의 계산": "또는(동시에 안 일어남)=덧셈 p+q, 동시에(독립)=곱셈 p×q, 비복원추출=종속시행.",
};

function generateDailyConceptQuestions(){
  const data = fetchConceptAppData_();

  // ⚠️ 핵심 안전장치: students 배열이 정상적으로 안 왔으면 절대 진행하지 않아요.
  if(!data || !Array.isArray(data.students)){
    Logger.log('❌ 데이터를 정상적으로 불러오지 못해서 안전하게 중단했어요. (다음 예약 실행 때 다시 시도돼요)');
    return;
  }
  const studentCountAtFetch = data.students.length;

  data.conceptDraftItems = data.conceptDraftItems || [];
  data.nextConceptDraftId = data.nextConceptDraftId || (maxId_(data.conceptDraftItems) + 1);

  const classNames = getActiveConceptClassNames_(data);
  if(classNames.length === 0){
    Logger.log('생성할 대상 반이 없어요 (conceptDailyCounts / students 확인).');
    return;
  }

  let totalGenerated = 0;

  classNames.forEach(className => {
    try {
      const existing = [
        ...(data.conceptBankItems || []).filter(i => i.className === className),
        ...(data.conceptDraftItems || []).filter(i => i.className === className)
      ];
      const newItems = generateConceptQuestionsForClass_(className, existing);

      newItems.forEach(item => {
        data.conceptDraftItems.push({
          id: data.nextConceptDraftId++,
          className: className,
          unit: item.unit || '',
          question: item.question,
          choices: item.choices,
          correctIndex: item.correctIndex,
          createdAt: new Date().toISOString()
        });
        totalGenerated++;
      });

      Logger.log(`[${className}] ${newItems.length}개 초안 생성`);
    } catch(err){
      Logger.log(`[${className}] 생성 실패: ${err.message || err}`);
    }
  });

  if(totalGenerated === 0){
    Logger.log('새로 생성된 문제가 없어요.');
    return;
  }

  // ⚠️ 저장 직전 확인: 학생 수가 이상하게 줄어들어 있으면 절대 저장하지 않아요.
  if(!Array.isArray(data.students) || data.students.length < studentCountAtFetch){
    Logger.log(`🛑 저장을 안전하게 중단했어요 (학생 수 이상: ${studentCountAtFetch}명 → ${(data.students||[]).length}명).`);
    return;
  }

  // 문제 생성하는 동안(몇 초~몇십 초) 다른 곳에서 저장된 게 있을 수 있으니,
  // 저장 직전에 한 번 더 최신 데이터를 받아서 conceptDraftItems만 병합해요.
  const latest = fetchConceptAppData_();
  if(!latest || !Array.isArray(latest.students) || latest.students.length === 0){
    Logger.log('🛑 저장 직전 재확인에 실패해서 안전하게 중단했어요. (다음 예약 실행 때 다시 시도돼요)');
    return;
  }
  latest.conceptDraftItems = mergeConceptItemsById_(latest.conceptDraftItems, data.conceptDraftItems);
  latest.nextConceptDraftId = Math.max(latest.nextConceptDraftId || 1, data.nextConceptDraftId || 1);

  saveConceptAppData_(latest);
  Logger.log(`✅ 검토 대기함에 ${totalGenerated}개 문제를 넣었어요.`);

  // 🔔 원장님 폰에 알림 (이미 만들어둔 sendPushToTokens를 재사용해요)
  try {
    if(typeof sendPushToTokens === 'function' && latest.adminPushTokens && latest.adminPushTokens.length){
      sendPushToTokens(
        latest.adminPushTokens,
        '🧩 AI가 새 개념문제를 만들었어요',
        `검토 대기 중: ${totalGenerated}개 (승인해야 학생한테 나가요)`,
        './imm_academy_system.html'
      );
    }
  } catch(e){
    Logger.log('알림 발송 실패(문제 생성/저장 자체는 정상 완료됨): ' + e.message);
  }
}

function fetchConceptAppData_(){
  const res = UrlFetchApp.fetch(CONCEPT_AUTOGEN_CONFIG.SHEET_URL, { method: 'get', muteHttpExceptions: true });
  if(res.getResponseCode() !== 200) return null;
  try {
    return JSON.parse(res.getContentText());
  } catch(e){
    return null;
  }
}

function saveConceptAppData_(data){
  UrlFetchApp.fetch(CONCEPT_AUTOGEN_CONFIG.SHEET_URL, {
    method: 'post',
    contentType: 'text/plain',
    payload: JSON.stringify(data),
    muteHttpExceptions: true
  });
}

function mergeConceptItemsById_(freshItems, localItems){
  const fresh = Array.isArray(freshItems) ? freshItems : [];
  const local = Array.isArray(localItems) ? localItems : [];
  const localIds = new Set(local.map(i => i.id));
  const onlyInFresh = fresh.filter(i => !localIds.has(i.id));
  return [...local, ...onlyInFresh];
}

function maxId_(items){
  return (items || []).reduce((m, i) => Math.max(m, i.id || 0), 0);
}

function getActiveConceptClassNames_(data){
  const fromCounts = Object.keys(data.conceptDailyCounts || {});
  if(fromCounts.length > 0) return fromCounts;
  const set = new Set();
  (data.students || []).forEach(s => { if(s.className) set.add(s.className); });
  return Array.from(set);
}

/** 기존 callGeminiWithRetry()를 그대로 재사용해서 문제를 생성해요 (텍스트만 필요, 사진 없음) */
function generateConceptQuestionsForClass_(className, existingItems){
  if(typeof callGeminiWithRetry !== 'function'){
    throw new Error('callGeminiWithRetry 함수를 찾을 수 없어요. 기존 Code.gs와 같은 프로젝트에 있는지 확인해주세요.');
  }

  const existingQuestionTexts = existingItems.map(i => i.question);
  const curriculumText = Object.entries(CONCEPT_CURRICULUM_BY_UNIT)
    .map(([unit, summary]) => `[${unit}] ${summary}`)
    .join('\n');

  const promptText = `너는 중학교 2학년 2학기 수학 개념 문제를 만드는 출제자야.
아래 "개념 요약"을 바탕으로, 서로 다른 소단원에서 총 ${CONCEPT_AUTOGEN_CONFIG.QUESTIONS_PER_CLASS}개의 "빈칸채우기 3지선다" 문제를 새로 만들어줘.

[개념 요약]
${curriculumText}

[이미 있는 문제들 - 절대 겹치지 않게, 다른 표현/다른 소단원 위주로 만들어줘]
${existingQuestionTexts.length ? existingQuestionTexts.map(q => '- ' + q).join('\n') : '(아직 없음)'}

[출제 규칙]
- question에는 빈칸을 "___"로 표시
- choices는 정답 1개 + 오답 2개(실제로 헷갈리기 쉬운 개념으로), 총 3개
- correctIndex는 정답이 choices 배열에서 몇 번째 인덱스인지(0부터 시작)
- unit은 위 개념 요약의 소단원 이름 중 하나를 그대로 사용

다른 설명 없이, 아래 JSON 배열 형식으로만 답해줘:
[{"unit":"...", "question":"...", "choices":["...","...","..."], "correctIndex":0}, ...]`;

  const payload = {
    contents: [{ parts: [{ text: promptText }] }],
    generationConfig: { temperature: 0.5 }
  };

  const responseText = callGeminiWithRetry(payload, 4);
  const jsonMatch = responseText.match(/\[[\s\S]*\]/);
  if(!jsonMatch){
    throw new Error('AI 응답에서 JSON 배열을 못 찾았어요: ' + responseText.slice(0, 300));
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch(e){
    throw new Error('AI 응답을 JSON으로 해석하지 못했어요: ' + jsonMatch[0].slice(0, 300));
  }

  return parsed.filter(q =>
    q && q.question && Array.isArray(q.choices) && q.choices.length >= 2 &&
    Number.isInteger(q.correctIndex) && q.correctIndex >= 0 && q.correctIndex < q.choices.length
  );
}
