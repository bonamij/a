/**자동
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
 *
 * ── 2026-09-01 갱신 ──────────────────────────────────────
 *  중2-2 개념노트 답지(한눈에 개념정리) 원본 PDF와 대조해서 빠진 내용을 보강했습니다.
 *  ⚠️ 기존 18개 단원 이름은 하나도 안 바꿨습니다 (이미 반별로 체크해두신 설정이
 *  깨지지 않도록). 빠졌던 내용은 새 소단원 11개를 "추가"하는 방식으로 채웠어요.
 *  새 소단원은 관리자 앱 "커리큘럼 단원 관리"에서 반별로 새로 체크(활성화)해주셔야
 *  실제 출제에 반영됩니다. (자동으로 켜지지 않음 — 의도적으로 그렇게 했어요)
 * ============================================================================
 */

const CONCEPT_AUTOGEN_CONFIG = {
 SHEET_URL: 'https://script.google.com/macros/s/AKfycby248HXB7pvkzJ1gBjmLux0myAH2otNNt2A4Vp0edu0HAW49W42-8-uJzN_aKnbP6Uf/exec',
  QUESTIONS_PER_CLASS: 5,
};

/**
 * 반별 개념 요약 — 이제 관리자 앱의 "커리큘럼 단원 관리"에서 반마다 단원을 체크해두면
 * 그걸 우선 사용해요. 이건 아직 설정을 안 한 반이 있을 때 쓰이는 "기본값"이에요.
 * 여기 없는 반(className)은 자동으로 건너뜁니다.
 * 학년/교재가 바뀌면 이 부분만 갱신하면 돼요.
 */
const CONCEPT_CURRICULUM_BY_UNIT = {
  // ===== 8. 삼각형의 성질 =====
  "1-1 이등변삼각형": "이등변삼각형: 두 변의 길이가 같은 삼각형. 꼭지각(길이가 같은 두 변이 이루는 각)/밑변(꼭지각의 대변)/밑각. 두 밑각의 크기는 같다. 꼭지각의 이등분선은 밑변을 수직이등분한다. 두 내각이 같으면 이등변삼각형(역).",
  "1-1-2 이등변삼각형의 성질의 활용": "여러 개의 이등변삼각형이 이웃하거나 각의 이등분선이 주어질 때 각의 크기 구하기: 이등변삼각형의 두 밑각은 같다, 평각은 180°, 삼각형의 세 내각의 합은 180°, 삼각형의 한 외각은 이웃하지 않는 두 내각의 합과 같다. 직사각형 모양 종이 접기에서: 접은 각과 엇각이 같아서 생기는 삼각형은 이등변삼각형이 된다. 여러 가지 도형에서 각의 크기: 평행선에서 동위각·엇각의 크기는 각각 같다, 정n각형의 한 내각의 크기는 180×(n-2)/n (단, n≥3).",
  "1-2 직각삼각형의 합동조건": "직각삼각형에서 직각의 대변=빗변. RHA합동(빗변+한 예각), RHS합동(빗변+다른 한 변). 각의 이등분선 위의 점은 그 각을 이루는 두 변까지 거리가 같다(역도 성립).",
  "1-3 삼각형의 외심과 내심": "외심=외접원 중심=세 변의 수직이등분선의 교점, OA=OB=OC. 직각삼각형의 외심=빗변의 중점. 내심=내접원 중심=세 내각의 이등분선의 교점, ID=IE=IF, 항상 내부에 위치.",
  "1-3-2 외심과 내심의 응용": "외심 O에 대해 ∠x+∠y+∠z=90°, ∠BOC=2∠A. 내심 I에 대해 ∠x+∠y+∠z=90°, ∠BIC=90°+½∠A. 삼각형의 내접원(반지름 r)의 넓이=½×r×(a+b+c), 접선의 길이 AD=AF, BD=BE, CE=CF. 내심 I를 지나 BC에 평행한 선분 DE를 그으면 △DBI, △EIC는 이등변삼각형이고 △ADE의 둘레의 길이=AB+AC. 외심과 내심: 이등변삼각형은 외심·내심이 모두 꼭지각의 이등분선 위에 있고, 정삼각형은 외심과 내심이 일치한다.",

  // ===== 9. 사각형의 성질 =====
  "2-1 평행사변형": "두 쌍의 대변이 각각 평행. 대변 길이 같음/대각 크기 같음/두 대각선이 서로를 이등분. 되는 조건 5가지 중 하나만 만족해도 평행사변형.",
  "2-1-2 평행사변형과 넓이": "평행사변형 ABCD의 두 대각선의 교점을 O라 하면 △ABC=△BCD=△CDA=△DAB=(평행사변형 넓이의 ½), △OAB=△OBC=△OCD=△ODA=(평행사변형 넓이의 ¼). 내부의 한 점 P에 대해 △PAB+△PCD=△PDA+△PBC=(평행사변형 넓이의 ½).",
  "2-2 여러 가지 사각형": "직사각형(네 내각 90도, 대각선 길이 같고 이등분), 마름모(네 변 길이 같음, 대각선 수직이등분), 정사각형(둘 다), 사다리꼴/등변사다리꼴.",
  "2-2-2 여러 가지 사각형 사이의 관계": "사다리꼴에 대변 한 쌍이 더 평행해지면 평행사변형, 평행사변형의 한 내각이 직각이면 직사각형, 평행사변형의 이웃하는 두 변의 길이가 같으면 마름모, 직사각형이나 마름모에 나머지 조건까지 더해지면 정사각형이 된다. 대각선 성질 비교: 사다리꼴(서로 다른 것을 이등분하지 않음)→평행사변형(서로 다른 것을 이등분)→직사각형(길이가 같음)·마름모(수직)→정사각형(길이 같고 수직이등분). 사각형의 각 변의 중점을 이어 만든 사각형: 사각형→평행사변형, 평행사변형→평행사변형, 직사각형→마름모, 마름모→직사각형, 정사각형→정사각형, 등변사다리꼴→마름모.",
  "2-3 평행선과 넓이": "밑변 공통+평행선 사이=넓이 같음. 높이가 같으면 넓이비=밑변비. 등적변형.",

  // ===== 10. 도형의 닮음 =====
  "3-1 닮음의 뜻과 성질": "닮은 도형: 한 도형을 일정한 비율로 확대·축소한 것이 다른 도형과 합동일 때 서로 닮음, 기호 ∽, 꼭짓점은 대응하는 순서대로 씀. 닮음비: 대응변의 길이의 비(합동은 닮음비 1:1). 평면도형에서 닮음의 성질: 대응변의 길이의 비는 일정하다, 대응각의 크기는 각각 같다. 입체도형에서 닮음의 성질: 대응하는 모서리의 길이의 비는 일정하다, 대응하는 면은 닮은 도형이다. 항상 닮은 도형: 두 원, 두 직각이등변삼각형, 두 정n각형(n≥3), 중심각의 크기가 같은 두 부채꼴, 두 구, 면의 수가 같은 두 정다면체.",
  "3-2 삼각형의 닮음조건": "SSS닮음(세 변의 비), SAS닮음(두 변의 비+끼인각), AA닮음(두 각). 직각삼각형에서 한 예각이 같으면 AA닮음.",
  "3-2-2 직각삼각형의 닮음": "∠A=90°인 직각삼각형 ABC의 꼭짓점 A에서 빗변 BC에 내린 수선의 발을 H라 하면 △ABC∽△HBA∽△HAC (AA닮음). 이를 이용하면 AB²=BH×BC, AC²=CH×CB, AH²=BH×CH가 성립한다. 또한 넓이가 같음을 이용하면 AB×AC=BC×AH.",

  // ===== 11. 닮음의 활용 =====
  "4-1 삼각형과 평행선": "BC∥DE이면 AB:AD=AC:AE=BC:DE (역도 성립). 내각/외각의 이등분선과 변의 비.",
  "4-1-2 삼각형의 각의 이등분선": "삼각형의 내각의 이등분선의 성질: △ABC에서 ∠A의 이등분선이 BC와 만나는 점을 D라 하면 AB:AC=BD:CD. 삼각형의 외각의 이등분선의 성질: △ABC에서 ∠A의 외각의 이등분선이 BC의 연장선과 만나는 점을 D라 하면 AB:AC=BD:CD.",
  "4-2 중점연결정리": "두 변의 중점을 이은 선분은 나머지 변과 평행, 길이는 1/2. 사다리꼴에서 MN=(AD+BC)/2.",
  "4-2-2 사각형의 중점을 연결한 선분": "사각형 ABCD의 AB, BC, CD, DA의 중점을 각각 E, F, G, H라 하면 AC∥EF∥HG이고 EF=HG=(1/2)AC, BD∥EH∥FG이고 EH=FG=(1/2)BD, 사각형 EFGH의 둘레의 길이=AC+BD. AD∥BC인 사다리꼴 ABCD에서 AB, DC의 중점을 각각 M, N이라 하면 AD∥MN∥BC이고 MN=(1/2)×(AD+BC).",
  "4-3 평행선 사이의 선분의 길이의 비": "l∥m∥n이면 a:b=a′:b′ (역은 성립하지 않음).",
  "4-3-2 평행선과 선분의 길이의 비의 응용": "AD∥BC인 사다리꼴 ABCD에서 EF∥BC이고 AD=a, BC=b, AE=m, BE=n일 때 EF=(bm+an)/(m+n). AC와 BD의 교점을 E라 하고 AB∥EF∥DC, AB=a, CD=b이면 BF:FC=AE:EC=BE:ED=a:b이고 EF=ab/(a+b).",
  "4-4 삼각형의 무게중심": "세 중선의 교점=무게중심, 2:1로 나눔, 중선은 넓이를 이등분, 6개 삼각형 넓이 모두 같음(1/6씩).",
  "4-4-2 삼각형의 중선과 무게중심": "삼각형의 중선: 한 꼭짓점과 그 대변의 중점을 연결한 선분이며, 중선은 그 삼각형의 넓이를 이등분한다. 삼각형의 무게중심: 세 중선의 교점이며, 각 중선의 길이를 꼭짓점으로부터 각각 2:1로 나눈다. 정삼각형은 외심·내심·무게중심이 모두 일치하고, 이등변삼각형은 세 점이 모두 꼭지각의 이등분선 위에 있다.",
  "4-4-3 삼각형의 무게중심과 넓이": "삼각형의 세 중선에 의해 나누어진 6개의 삼각형의 넓이는 모두 같다(전체 넓이의 각각 1/6). △GAB=△GBC=△GCA=(전체 넓이의 1/3). 평행사변형 ABCD의 두 대각선의 교점을 O, 변 BC와 CD의 중점을 각각 M, N이라 하고 AM, AN이 대각선 BD와 만나는 점을 각각 P, Q라 하면 두 점 P, Q는 각각 △ABC, △ACD의 무게중심이고 BP=PQ=QD=(BD의 1/3), PQ:MN=2:3.",
  "4-9 닮은 도형의 넓이와 부피의 비": "닮은 두 평면도형의 닮음비가 m:n일 때 둘레의 길이의 비는 m:n이고, 넓이의 비는 m²:n²이다. 닮은 두 입체도형의 닮음비가 m:n일 때 대응하는 면(닮은 평면도형)의 넓이의 비와 겉넓이의 비는 모두 m²:n²이고, 부피의 비는 m³:n³이다.",

  // ===== 12. 피타고라스 정리 =====
  "5-1 피타고라스 정리": "a²+b²=c² (직각삼각형). c²=a²+b²이면 직각, c²>a²+b²이면 둔각, c²<a²+b²이면 예각삼각형.",
  "5-2 피타고라스 정리의 활용": "직각삼각형이 되는 조건: 세 변 a, b, c에서 a²+b²=c²이면 빗변의 길이가 c인 직각삼각형이다. 삼각형의 변과 각 사이의 관계(c가 가장 긴 변일 때): a²+b²>c²이면 예각삼각형, a²+b²=c²이면 직각삼각형, a²+b²<c²이면 둔각삼각형. 직각삼각형의 세 반원 사이의 관계: 세 변을 각각 지름으로 하는 반원의 넓이를 S1, S2, S3(S3이 빗변 위 반원)라 하면 S3=S1+S2. 히포크라테스의 원의 넓이: 직각삼각형 ABC의 세 변을 지름으로 하는 반원에서 색칠한 부분의 넓이=△ABC=(1/2)×b×c.",
  "5-2-2 피타고라스 정리의 활용(사각형·내부의 점)": "∠A=90°인 직각삼각형 ABC에서 점 D, E가 각각 AB, AC 위에 있을 때 DE²+BC²=BE²+CD²가 성립한다. 사각형 ABCD에서 두 대각선이 직교할 때 AB²+CD²=BC²+AD²가 성립한다. 직사각형 ABCD의 내부에 있는 임의의 점 P에 대해 AP²+CP²=BP²+DP²가 성립한다.",

  // ===== 13. 경우의 수와 확률 =====
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

  const targets = getActiveConceptTargets_(data);
  if(targets.length === 0){
    Logger.log('생성할 대상이 없어요 (커리큘럼 단원 / conceptDailyCounts / students 확인).');
    return;
  }

  let totalGenerated = 0;

  targets.forEach(target => {
    const targetKey = JSON.stringify(target);
    try {
      const existing = [
        ...(data.conceptBankItems || []).filter(i => JSON.stringify(i.target) === targetKey),
        ...(data.conceptDraftItems || []).filter(i => JSON.stringify(i.target) === targetKey)
      ];
      let activeUnitsForTarget = (data.conceptCurriculumUnits || []).filter(u => u.active && JSON.stringify(u.target) === targetKey);
      if(activeUnitsForTarget.length === 0 && target.type === 'class'){
        const enabledNames = (data.conceptEnabledUnits && data.conceptEnabledUnits[target.className]) || [];
        if(enabledNames.length > 0){
          activeUnitsForTarget = enabledNames
            .filter(name => CONCEPT_CURRICULUM_BY_UNIT[name])
            .map(name => ({ unitName: name, summary: CONCEPT_CURRICULUM_BY_UNIT[name] }));
        }
      }
      const questionsPerClass = (target.type === 'class' && data.conceptDailyCounts && data.conceptDailyCounts[target.className]) || CONCEPT_AUTOGEN_CONFIG.QUESTIONS_PER_CLASS;
      const newItems = generateConceptQuestionsForTarget_(target, existing, activeUnitsForTarget, questionsPerClass);

      newItems.forEach(item => {
        data.conceptDraftItems.push({
          id: data.nextConceptDraftId++,
          target: target,
          unit: item.unit || '',
          question: item.question,
          choices: item.choices,
          correctIndex: item.correctIndex,
          createdAt: new Date().toISOString()
        });
        totalGenerated++;
      });

      Logger.log(`[${conceptTargetLabel_(target)}] ${newItems.length}개 초안 생성`);
    } catch(err){
      Logger.log(`[${conceptTargetLabel_(target)}] 생성 실패: ${err.message || err}`);
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

// 2026-09-15: 새 저장 구조(Store.js)로 옮긴 뒤에는 웹앱 주소를 거치지 않고 저장소를 직접 읽고 써요.
// (웹앱 주소는 이제 비밀번호가 있어야 열려서, 예전처럼 주소로 받아오면 막혀요)
function fetchConceptAppData_(){
  if(isMigrated_()){
    try { return assembleLegacy_(); } catch(e){ Logger.log('저장소 읽기 실패: ' + e.message); return null; }
  }
  const res = UrlFetchApp.fetch(CONCEPT_AUTOGEN_CONFIG.SHEET_URL, { method: 'get', muteHttpExceptions: true });
  if(res.getResponseCode() !== 200) return null;
  try {
    return JSON.parse(res.getContentText());
  } catch(e){
    return null;
  }
}

function saveConceptAppData_(data){
  if(isMigrated_()){
    // 전체를 덮어쓰지 않고, 새로 생긴 항목(검토 대기 문제)만 추가돼요
    const result = withLock_(() => commitOps_(legacyOpsFromFullData_(data), 'autogen'));
    Logger.log(`저장소에 반영: 변경 ${result.applied.length}건, 거절 ${result.rejected.length}건`);
    return;
  }
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

function conceptTargetLabel_(target){
  if(target.type === 'class') return target.className;
  return '개별학생(' + (target.studentIds || []).join(',') + ')';
}

// 활성화된 커리큘럼 단원들에서 고유한 대상(반 전체 / 개별 학생) 목록을 뽑아요.
// 아직 단원을 하나도 설정 안 한 반은(예전 방식 그대로) 기본 18개 단원으로 자동 포함시켜요.
function getActiveConceptTargets_(data){
  const activeUnits = (data.conceptCurriculumUnits || []).filter(u => u.active && u.target);
  const seen = new Set();
  const targets = [];
  activeUnits.forEach(u => {
    const key = JSON.stringify(u.target);
    if(!seen.has(key)){ seen.add(key); targets.push(u.target); }
  });

  const classNamesWithUnits = new Set(
    activeUnits.filter(u => u.target.type === 'class').map(u => u.target.className)
  );
  const fromCounts = Object.keys(data.conceptDailyCounts || {});
  const fallbackClassNames = fromCounts.length > 0
    ? fromCounts
    : Array.from(new Set((data.students || []).map(s => s.className).filter(Boolean)));
  fallbackClassNames.forEach(cn => {
    if(!classNamesWithUnits.has(cn)) targets.push({ type:'class', className: cn });
  });

  return targets;
}

/** 기존 callGeminiWithRetry()를 그대로 재사용해서 문제를 생성해요 (텍스트만 필요, 사진 없음) */
function generateConceptQuestionsForTarget_(target, existingItems, activeUnitsForTarget, questionsPerClass){
  if(typeof callGeminiWithRetry !== 'function'){
    throw new Error('callGeminiWithRetry 함수를 찾을 수 없어요. 기존 Code.gs와 같은 프로젝트에 있는지 확인해주세요.');
  }

  const existingQuestionTexts = existingItems.map(i => i.question);

  // 관리자 앱의 "커리큘럼 단원 관리"에서 이 대상에 체크(활성화)해둔 단원이 있으면 그걸 쓰고,
  // 하나도 없으면(아직 설정 안 했으면) 기본 18개 단원으로 대체해요.
  const unitEntries = (activeUnitsForTarget && activeUnitsForTarget.length > 0)
    ? activeUnitsForTarget.map(u => [u.unitName, u.summary])
    : Object.entries(CONCEPT_CURRICULUM_BY_UNIT);

  const curriculumText = unitEntries
    .map(([unit, summary]) => `[${unit}] ${summary}`)
    .join('\n');

  const promptText = `너는 중학교 2학년 2학기 수학 개념 문제를 만드는 출제자야.
아래 "개념 요약"을 바탕으로, 서로 다른 소단원에서 총 ${questionsPerClass}개의 "빈칸채우기 3지선다" 문제를 새로 만들어줘.
[개념 요약]
${curriculumText}

[이미 있는 문제들 - 절대 겹치지 않게, 다른 표현/다른 소단원 위주로 만들어줘]
${existingQuestionTexts.length ? existingQuestionTexts.map(q => '- ' + q).join('\n') : '(아직 없음)'}

[출제 규칙]
- question에는 빈칸을 "___"로 표시
- choices는 정답 1개 + 오답 2개(실제로 헷갈리기 쉬운 개념으로), 총 3개
- correctIndex는 정답이 choices 배열에서 몇 번째 인덱스인지(0부터 시작)
- unit은 위 개념 요약의 소단원 이름 중 하나를 그대로 사용
- 제곱·세제곱 등은 반드시 위첨자 문자(²,³)를 사용해. "^2", "^3" 같은 표기나 "$...$" 같은 LaTeX 기호는 절대 쓰지 마.
  예: "a² + b² = c²" (O), "a^2 + b^2 = c^2" (X), "$a^2+b^2$" (X)
- 문장은 자연스러운 한국어 존댓말/평서문으로, 오타 없이 정확하게 써줘.

다른 설명 없이, 아래 JSON 배열 형식으로만 답해줘:
[{"unit":"...", "question":"...", "choices":["...","...","..."], "correctIndex":0}, ...]`;

  const payload = {
    contents: [{ parts: [{ text: promptText }] }],
    generationConfig: { temperature: 0.5 }
  };

  const rawResponse = callGeminiWithRetry(payload, 4);
  const responseText = extractGeminiResponseText_(rawResponse);
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

  const cleaned = parsed
    .filter(q => q && q.question && Array.isArray(q.choices))
    .map(q => ({
      unit: q.unit,
      question: normalizeMathNotation_(q.question),
      choices: q.choices.map(c => normalizeMathNotation_(c)),
      correctIndex: q.correctIndex
    }));

  return cleaned.filter(q =>
    q.choices.length >= 2 &&
    Number.isInteger(q.correctIndex) && q.correctIndex >= 0 && q.correctIndex < q.choices.length
  );
}

// AI가 가끔 "^2", "$...$" 같은 LaTeX식 표기를 섞어 쓰는 걸 위첨자 문자로 자동 정리해요.
function normalizeMathNotation_(text){
  if(typeof text !== 'string') return text;
  const superscriptMap = { '0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹' };
  let result = text
    .replace(/\$([^$]+)\$/g, '$1')     // $...$ LaTeX 감싸기 제거
    .replace(/\\times/g, '×')
    .replace(/\\div/g, '÷')
    .replace(/\^\{?(-?\d+)\}?/g, (m, digits) =>
      digits.split('').map(ch => (ch === '-' ? '⁻' : (superscriptMap[ch] || ch))).join('')
    );
  return result;
}

// callGeminiWithRetry가 문자열/HTTPResponse/이미 파싱된 객체 중 무엇을 돌려주든
// 안전하게 순수 텍스트로 뽑아내요. (기존 함수 내부 구조를 몰라도 되도록 방어적으로 처리)
function extractGeminiResponseText_(response){
  if(typeof response === 'string') return response;

  // HTTPResponse 객체인 경우 (getContentText 메서드 있음)
  if(response && typeof response.getContentText === 'function'){
    const text = response.getContentText();
    try {
      const parsed = JSON.parse(text);
      const fromCandidates = extractTextFromGeminiJson_(parsed);
      if(fromCandidates) return fromCandidates;
    } catch(e){ /* JSON이 아니면 그냥 원본 텍스트 사용 */ }
    return text;
  }

  // 이미 파싱된 Gemini 응답 객체인 경우
  if(response && typeof response === 'object'){
    const fromCandidates = extractTextFromGeminiJson_(response);
    if(fromCandidates) return fromCandidates;
    return JSON.stringify(response);
  }

  return String(response);
}

function extractTextFromGeminiJson_(obj){
  try {
    if(obj && obj.candidates && obj.candidates[0] && obj.candidates[0].content && obj.candidates[0].content.parts){
      return obj.candidates[0].content.parts.map(p => p.text || '').join('');
    }
  } catch(e){ /* 구조가 다르면 무시 */ }
  return null;
}

/* =========================================================
   🔔 개념빈칸 테스트 리마인더 (오늘 문제 있는데 아직 안 한 학생에게 알림)
   ============================================================
   - 트리거를 새로 하나 더 추가해주세요:
     실행할 함수: sendConceptTestReminders
     이벤트 소스: 시간 기반 → 일 타이머 → 원하는 시간대 (예: 오후 3시~4시, 학원 오기 전)
   - 새벽 자동생성(generateDailyConceptQuestions) 트리거와는 별개로 추가하시면 돼요.
========================================================= */
function sendConceptTestReminders(){
  const data = fetchConceptAppData_();
  if(!data || !Array.isArray(data.students)){
    Logger.log('❌ 데이터를 정상적으로 불러오지 못해서 안전하게 중단했어요.');
    return;
  }

  const todayIso = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const submittedToday = new Set(
    (data.conceptTestRecords || []).filter(r => r.date === todayIso).map(r => r.studentId)
  );

  let remindedCount = 0;
  let skippedNoToken = 0;

  // 2026-09-15: 한국시간 기준 요일·시각 (오후 4시 / 저녁 8시 두 번 실행돼요)
  const kstNow = new Date(Date.now() + 9 * 3600 * 1000);
  const todayDow = kstNow.getUTCDay(); // 0=일 ... 6=토 (포털과 같은 기준)
  const evening = kstNow.getUTCHours() >= 18;

  (data.students || []).forEach(student => {
    if(submittedToday.has(student.id)) return; // 이미 오늘 했으면 건너뜀

    // 관리자 앱에서 출제 요일을 정해둔 반은 그 요일에만 알려요 (포털도 그 요일에만 문제를 내요)
    const activeDays = (data.conceptActiveDays || {})[student.className];
    if(activeDays && activeDays.length > 0 && activeDays.indexOf(todayDow) === -1) return;

    const items = getTodaysConceptItemsForReminder_(student, data.conceptBankItems || [], data.conceptDailyCounts || {});
    if(items.length === 0) return; // 오늘 낼 문제가 없으면 건너뜀

    const tokens = student.pushTokens || [];
    if(tokens.length === 0){ skippedNoToken++; return; }

    try {
      sendPushToTokens(
        tokens,
        '🧩 오늘의 개념빈칸 테스트',
        evening
          ? `🌙 아직 안 풀었어요! 자기 전에 ${items.length}문제만 풀어주세요.`
          : `아직 안 하셨어요! ${items.length}문제만 풀면 끝나요. 지금 확인해보세요.`,
        './parent_portal.html'
      );
      remindedCount++;
    } catch(err){
      Logger.log(`[${student.name}] 알림 발송 실패: ${err.message || err}`);
    }
  });

  Logger.log(`✅ 리마인더 발송 완료: ${remindedCount}명에게 보냈어요. (토큰 없어서 건너뜀: ${skippedNoToken}명)`);
}

function itemMatchesStudentForReminder_(item, student){
  // 2026-09-15 수정: 문제은행(conceptBankItems) 문제는 target 대신 className으로 반을 가리켜요.
  // 예전엔 target만 봐서 "오늘 낼 문제가 없음"으로 판단해 리마인더가 한 번도 안 갔어요.
  if(item.className) return !!student.className && item.className === student.className;
  if(!item.target) return false;
  if(item.target.type === 'individual') return (item.target.studentIds || []).includes(student.id);
  if(item.target.type === 'class') return item.target.className === student.className;
  return false;
}

function getTodaysConceptItemsForReminder_(student, allItems, dailyCounts){
  const relevantItems = (allItems || []).filter(i => itemMatchesStudentForReminder_(i, student)).sort((a,b) => a.id - b.id);
  if(relevantItems.length === 0) return [];
  const perDay = (dailyCounts && dailyCounts[student.className]) || 5;
  const dayIndex = Math.floor((Date.now() + 9 * 3600 * 1000) / 86400000);
    const total = relevantItems.length;
  const startIdx = (dayIndex * perDay) % total;
  const result = [];
  for(let i = 0; i < Math.min(perDay, total); i++){
    result.push(relevantItems[(startIdx + i) % total]);
  }
  return result;
}

/* =========================================================
   🔔 개념빈칸 문제가 "승인"돼서 문제은행에 새로 들어가면 즉시 알림
   ============================================================
   - 이 함수는 doPost가 호출해요. Code.gs의 doPost 안, 기존
     notifyNewHomework_(...) 등이 있는 자리에 아래 한 줄만 추가해주세요:

       notifyNewConceptBankItems_(oldData, data);

   - 별도 트리거 설정 필요 없어요. 승인(저장)되는 순간 자동으로 실행돼요.
========================================================= */
function notifyNewConceptBankItems_(oldData, newData){
  const oldIds = new Set((oldData.conceptBankItems || []).map(function (i) { return i.id; }));
  const newItems = (newData.conceptBankItems || []).filter(function (i) { return !oldIds.has(i.id); });
  if (newItems.length === 0) return;

  // 같은 대상(반 또는 같은 학생 조합)이면 알림 한 번만 보내도록 묶어요.
  const groups = {};
  newItems.forEach(function (item) {
    const key = JSON.stringify(item.target);
    if (!groups[key]) groups[key] = { target: item.target, count: 0 };
    groups[key].count++;
  });

  Object.keys(groups).forEach(function (key) {
    const group = groups[key];
    let targetStudents = [];
    if (group.target && group.target.type === 'class') {
      targetStudents = (newData.students || []).filter(function (s) { return s.className === group.target.className; });
    } else if (group.target && group.target.type === 'individual') {
      targetStudents = (newData.students || []).filter(function (s) { return group.target.studentIds.indexOf(s.id) !== -1; });
    }

    targetStudents.forEach(function (s) {
      try {
        sendPushToTokens(
          s.pushTokens,
          '🧩 오늘의 개념빈칸 테스트가 등록됐어요',
          `${group.count}문제가 새로 나왔어요. 지금 확인해보세요!`,
          './parent_portal.html'
        );
      } catch (err) {
        Logger.log(`[${s.name}] 알림 발송 실패: ` + (err.message || err));
      }
    });
  });
}