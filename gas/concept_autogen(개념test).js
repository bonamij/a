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
  // ↓ 아래부터는 선행 학생용(화금중1 민창 등). 반마다 "자동 출제 대상 소단원"에서 골라 쓰세요.

  // ===== [중1] =====
  // 중1 1단원 소인수분해
  "중1 1-1 소인수분해": "소수는 1과 자기 자신만을 약수로 갖는 1보다 큰 자연수이고, 합성수는 약수가 3개 이상인 수. 1은 소수도 합성수도 아니다. 거듭제곱 aⁿ에서 a를 밑, n을 지수라 한다. 소인수분해는 자연수를 소인수만의 곱으로 나타내는 것이고 그 결과는 하나뿐이다. 소인수분해가 aᵐ×bⁿ이면 약수의 개수는 (m+1)×(n+1)개.",
  "중1 1-2 최대공약수와 최소공배수": "최대공약수는 공약수 중 가장 큰 수이고, 모든 공약수는 최대공약수의 약수다. 최대공약수가 1인 두 수를 서로소라 한다. 최소공배수는 공배수 중 가장 작은 수이고, 모든 공배수는 최소공배수의 배수다. 소인수분해를 이용할 때 최대공약수는 공통인 소인수를 지수가 작은 것끼리, 최소공배수는 모든 소인수를 지수가 큰 것끼리 곱한다. 두 수 A, B의 최대공약수가 G, 최소공배수가 L이면 A×B=G×L.",
  // 중1 2단원 정수와 유리수
  "중1 2-1 정수와 유리수": "양의 정수(자연수), 0, 음의 정수를 통틀어 정수라 하고, 분모가 0이 아닌 분수 꼴로 나타낼 수 있는 수를 유리수라 한다. 수직선에서 원점으로부터의 거리를 절댓값이라 하고 |a|로 쓴다. |0|=0이고, 절댓값이 같고 부호가 다른 두 수는 원점에서 같은 거리에 있다.",
  "중1 2-2 정수와 유리수의 대소 관계": "수직선에서 오른쪽에 있는 수가 더 크다. (양수)>0>(음수)이고, 양수끼리는 절댓값이 큰 수가 크지만 음수끼리는 절댓값이 큰 수가 더 작다. a<b는 \"a는 b보다 작다\", a≤b는 \"a는 b보다 작거나 같다(이하)\"를 뜻한다.",
  "중1 2-3 정수와 유리수의 덧셈과 뺄셈": "부호가 같은 두 수의 덧셈은 절댓값의 합에 공통인 부호를 붙이고, 부호가 다른 두 수의 덧셈은 절댓값의 차에 절댓값이 큰 쪽의 부호를 붙인다. 덧셈에서는 교환법칙과 결합법칙이 성립한다. 뺄셈은 빼는 수의 부호를 바꾸어 더한다.",
  "중1 2-4 정수와 유리수의 곱셈과 나눗셈": "부호가 같은 두 수의 곱은 양수, 부호가 다른 두 수의 곱은 음수다. 음수가 짝수 개 곱해지면 결과는 양수, 홀수 개면 음수. 곱셈에서는 교환·결합·분배법칙이 성립한다. 나눗셈은 역수를 곱해서 계산하고 0으로는 나눌 수 없다. (-2)²=4이지만 -2²=-4로 서로 다르다.",
  // 중1 3단원 문자와 식
  "중1 3-1 문자의 사용과 식의 값": "곱셈 기호는 생략하고 수를 문자 앞에, 문자는 알파벳 순으로 쓴다. 1×a=a, (-1)×a=-a로 쓰고 나눗셈은 분수 꼴로 나타낸다. 식의 값은 문자에 수를 대입해 계산한 값이고, 음수를 대입할 때는 괄호를 쓴다.",
  "중1 3-2 일차식과 그 계산": "다항식에서 항, 계수, 상수항, 차수를 구분한다. 차수가 1인 다항식을 일차식이라 한다. 문자와 차수가 모두 같은 항을 동류항이라 하고, 동류항끼리만 계수를 더하거나 빼서 간단히 할 수 있다. 괄호 앞에 -가 있으면 괄호를 풀 때 안의 모든 항의 부호가 바뀐다.",
  // 중1 4단원 일차방정식
  "중1 4-1 방정식과 그 해": "등호로 나타낸 식이 등식이고, 미지수의 값에 따라 참이 되기도 거짓이 되기도 하는 등식이 방정식이다. 방정식을 참이 되게 하는 값을 해(근)라 하고, 어떤 값을 넣어도 항상 참인 등식은 항등식이다. 등식의 양변에 같은 수를 더하거나 빼거나 곱해도, 0이 아닌 같은 수로 나누어도 등식은 성립한다.",
  "중1 4-2 일차방정식의 풀이": "등식의 한 변에 있는 항을 부호를 바꾸어 다른 변으로 옮기는 것을 이항이라 한다. 정리했을 때 (일차식)=0 꼴이 되면 일차방정식이다. 괄호를 먼저 풀고, 계수가 소수면 10의 거듭제곱을, 분수면 분모의 최소공배수를 양변에 곱해 정수로 고친 뒤 푼다.",
  "중1 4-3 일차방정식의 활용": "구하려는 것을 x로 놓고 식을 세워 푼 다음, 그 답이 문제 상황에 맞는지 확인한다. (거리)=(속력)×(시간), (소금의 양)=(농도)/100×(소금물의 양), (정가)=(원가)+(이익)을 자주 쓴다.",
  // 중1 5단원 좌표평면과 그래프
  "중1 5-1 순서쌍과 좌표": "좌표평면 위의 점 P의 위치는 순서쌍 (a, b)로 나타내고 a를 x좌표, b를 y좌표라 한다. x축 위의 점은 (a, 0), y축 위의 점은 (0, b), 원점은 (0, 0)이다. 부호는 제1사분면 (+,+), 제2사분면 (-,+), 제3사분면 (-,-), 제4사분면 (+,-)이고, 좌표축 위의 점은 어느 사분면에도 속하지 않는다.",
  "중1 5-2 그래프와 그 해석": "두 양 사이의 관계를 좌표평면에 나타낸 것이 그래프다. 그래프가 오른쪽 위로 향하면 증가, 오른쪽 아래로 향하면 감소, 수평이면 변화가 없음을 뜻한다.",
  "중1 5-3 정비례와 반비례": "y가 x에 정비례하면 y=ax (a≠0)이고, x가 2배, 3배가 되면 y도 2배, 3배가 되며 y/x=a로 일정하다. 그래프는 원점을 지나는 직선이다. y가 x에 반비례하면 y=a/x (a≠0)이고, x가 2배가 되면 y는 1/2배가 되며 xy=a로 일정하다. 그래프는 좌표축에 한없이 가까워지는 한 쌍의 매끄러운 곡선이다.",
  // 중1 6단원 기본 도형
  "중1 6-1 점, 선, 면, 각": "선과 선이 만나는 점이 교점, 면과 면이 만나는 선이 교선이다. 직선 AB, 반직선 AB, 선분 AB를 구분하고, 두 점 사이의 거리는 선분의 길이다. 선분을 이등분하는 점이 중점이다. 평각은 180°, 직각은 90°, 예각은 0°보다 크고 90°보다 작은 각, 둔각은 90°보다 크고 180°보다 작은 각이다. 맞꼭지각의 크기는 서로 같다.",
  "중1 6-2 위치 관계": "평면에서 두 직선은 한 점에서 만나거나, 평행하거나, 일치한다. 공간에서 두 직선은 한 점에서 만나거나, 평행하거나, 만나지도 평행하지도 않은 꼬인 위치에 있다. 직선과 평면은 직선이 평면에 포함되거나, 한 점에서 만나거나, 평행한 세 경우가 있다.",
  "중1 6-3 평행선의 성질": "두 직선이 한 직선과 만날 때 같은 쪽에 있는 각을 동위각, 엇갈린 위치에 있는 각을 엇각이라 한다. 두 직선이 평행하면 동위각의 크기가 같고 엇각의 크기도 같다. 거꾸로 동위각이나 엇각의 크기가 같으면 두 직선은 평행하다.",
  // 중1 7단원 작도와 합동
  "중1 7-1 삼각형의 작도": "눈금 없는 자와 컴퍼스만을 써서 도형을 그리는 것을 작도라 한다. 삼각형이 만들어지려면 가장 긴 변의 길이가 나머지 두 변의 길이의 합보다 작아야 한다. 세 변의 길이를 알 때, 두 변의 길이와 그 끼인각의 크기를 알 때, 한 변의 길이와 그 양 끝 각의 크기를 알 때 삼각형은 하나로 정해진다.",
  "중1 7-2 삼각형의 합동 조건": "모양과 크기가 같아 완전히 포개어지는 두 도형을 합동이라 하고 기호 ≡로 나타낸다. 세 변의 길이가 각각 같으면 SSS 합동, 두 변의 길이와 그 끼인각의 크기가 각각 같으면 SAS 합동, 한 변의 길이와 그 양 끝 각의 크기가 각각 같으면 ASA 합동이다.",
  // 중1 8단원 평면도형의 성질
  "중1 8-1 다각형": "n각형의 내각의 크기의 합은 180°×(n-2)이고, 외각의 크기의 합은 n에 관계없이 항상 360°다. 정n각형의 한 내각의 크기는 180°×(n-2)/n, 한 외각의 크기는 360°/n이다. n각형의 대각선의 총 개수는 n(n-3)/2개다.",
  "중1 8-2 원과 부채꼴": "한 원에서 부채꼴의 호의 길이와 넓이는 중심각의 크기에 정비례하지만 현의 길이는 정비례하지 않는다. 반지름이 r인 원의 둘레는 2πr, 넓이는 πr²이다. 중심각이 x°인 부채꼴의 호의 길이는 2πr×(x/360), 넓이는 πr²×(x/360)이고, 호의 길이를 l이라 하면 넓이는 (1/2)rl로도 구한다.",
  // 중1 9단원 입체도형의 성질
  "중1 9-1 다면체": "다각형인 면으로만 둘러싸인 입체도형을 다면체라 하고 면의 개수에 따라 사면체, 오면체처럼 부른다. 각기둥, 각뿔, 각뿔대가 다면체다. 모든 면이 합동인 정다각형이고 각 꼭짓점에 모인 면의 개수가 같은 정다면체는 정사면체, 정육면체, 정팔면체, 정십이면체, 정이십면체의 다섯 가지뿐이다.",
  "중1 9-2 회전체": "평면도형을 한 직선을 축으로 1회전시켜 생기는 입체도형이 회전체이고 원기둥, 원뿔, 원뿔대, 구가 있다. 회전축에 수직인 평면으로 자른 단면은 항상 원이고, 회전축을 포함하는 평면으로 자른 단면은 회전축에 대칭인 도형이다. 구는 어느 방향으로 잘라도 단면이 원이다.",
  "중1 9-3 기둥과 뿔의 겉넓이와 부피": "기둥의 겉넓이는 (밑넓이)×2+(옆넓이)이고 부피는 (밑넓이)×(높이)다. 뿔의 부피는 밑면과 높이가 같은 기둥 부피의 1/3, 즉 (1/3)×(밑넓이)×(높이)다. 밑면의 반지름이 r이고 모선의 길이가 l인 원뿔의 옆넓이는 πrl이다.",
  "중1 9-4 구의 겉넓이와 부피": "반지름이 r인 구의 겉넓이는 4πr²이고 부피는 (4/3)πr³이다. 반구의 겉넓이는 구의 겉넓이의 절반인 2πr²에 단면인 원의 넓이 πr²를 더한 3πr²다.",
  // 중1 10단원 자료의 정리와 해석
  "중1 10-1 대푯값": "자료 전체를 대표하는 값이 대푯값이다. 평균은 자료의 총합을 자료의 개수로 나눈 값, 중앙값은 크기순으로 늘어놓았을 때 가운데 있는 값(자료가 짝수 개면 가운데 두 값의 평균), 최빈값은 가장 많이 나타나는 값이고 여러 개일 수도 있다. 지나치게 크거나 작은 값이 섞여 있으면 평균보다 중앙값이 대푯값으로 더 알맞다.",
  "중1 10-2 줄기와 잎 그림, 도수분포표": "줄기와 잎 그림은 자료를 줄기와 잎으로 나누어 적어 원래 값을 그대로 알 수 있다. 자료를 나눈 구간을 계급, 구간의 너비를 계급의 크기, 각 계급에 속하는 자료의 개수를 도수라 한다. 도수분포표로 만들면 분포를 한눈에 볼 수 있지만 원래의 자료 값은 알 수 없다.",
  "중1 10-3 히스토그램과 도수분포다각형": "가로축에 계급, 세로축에 도수를 잡아 직사각형으로 나타낸 그래프가 히스토그램이고, 각 직사각형의 넓이는 그 계급의 도수에 정비례한다. 직사각형 윗변의 중점을 차례로 이어 만든 것이 도수분포다각형이며, 히스토그램의 직사각형 넓이의 합과 도수분포다각형으로 둘러싸인 부분의 넓이는 서로 같다.",
  "중1 10-4 상대도수와 그 그래프": "상대도수는 그 계급의 도수를 도수의 총합으로 나눈 값이고, 상대도수의 총합은 항상 1이다. 각 계급의 상대도수는 그 계급의 도수에 정비례한다. 도수의 총합이 서로 다른 두 집단을 비교할 때는 도수보다 상대도수로 비교해야 한다.",

  // ===== [중2-1] =====
  // 중2-1 1단원 유리수와 순환소수
  "중2-1 1-1 유리수와 소수": "소수점 아래에 0이 아닌 숫자가 유한 번 나타나는 소수가 유한소수, 무한히 나타나는 소수가 무한소수다. 일정한 숫자가 되풀이되는 무한소수를 순환소수라 하고 되풀이되는 부분을 순환마디라 하며 양 끝 숫자 위에 점을 찍어 나타낸다. 기약분수로 고쳤을 때 분모의 소인수가 2나 5뿐이면 유한소수로 나타낼 수 있고, 2와 5 이외의 소인수가 있으면 순환소수가 된다.",
  "중2-1 1-2 순환소수를 분수로 나타내기": "순환소수를 x로 놓고 10의 거듭제곱을 곱해 소수 부분이 같은 두 식을 만든 뒤 빼면 분수로 고칠 수 있다. 공식으로는 분자가 (전체의 수)-(순환하지 않는 부분의 수)이고, 분모는 순환마디의 자릿수만큼 9를 쓴 뒤 순환하지 않는 소수 부분의 자릿수만큼 0을 붙인 수다. 모든 순환소수는 분수로 나타낼 수 있으므로 유리수다.",
  // 중2-1 2단원 식의 계산
  "중2-1 2-1 지수법칙": "aᵐ×aⁿ=aᵐ⁺ⁿ, (aᵐ)ⁿ=aᵐⁿ, (ab)ⁿ=aⁿbⁿ, (a/b)ⁿ=aⁿ/bⁿ이다. aᵐ÷aⁿ은 m>n이면 aᵐ⁻ⁿ, m=n이면 1, m<n이면 1/aⁿ⁻ᵐ이다.",
  "중2-1 2-2 단항식의 곱셈과 나눗셈": "단항식끼리의 곱셈은 계수는 계수끼리, 문자는 문자끼리 지수법칙을 써서 계산한다. 나눗셈은 분수 꼴로 바꾸거나 나누는 식의 역수를 곱한다. 거듭제곱이 있으면 지수법칙으로 먼저 푼 다음 계산하고 부호에 주의한다.",
  "중2-1 2-3 다항식의 덧셈과 뺄셈": "괄호를 풀고 동류항끼리 모아 계산한다. 괄호 앞에 -가 있으면 괄호 안의 모든 항의 부호가 바뀐다. 괄호가 여러 겹이면 (소괄호) → {중괄호} → [대괄호] 순으로 푼다.",
  "중2-1 2-4 단항식과 다항식의 혼합 계산": "(단항식)×(다항식)은 분배법칙을 써서 전개한다. (다항식)÷(단항식)은 각 항을 단항식으로 나누거나 나누는 식의 역수를 곱한다. 사칙계산이 섞여 있으면 거듭제곱 → 괄호 → 곱셈·나눗셈 → 덧셈·뺄셈 순서로 계산한다.",
  // 중2-1 3단원 일차부등식
  "중2-1 3-1 부등식의 해와 성질": "부등호로 나타낸 식이 부등식이고 부등식을 참이 되게 하는 미지수의 값이 해다. 부등식의 양변에 같은 수를 더하거나 빼도 부등호의 방향은 바뀌지 않고, 양수를 곱하거나 나누어도 바뀌지 않지만, 음수를 곱하거나 나누면 부등호의 방향이 바뀐다.",
  "중2-1 3-2 일차부등식의 풀이": "이항해서 정리했을 때 (일차식)>0, (일차식)<0 같은 꼴이 되면 일차부등식이다. x항은 좌변으로, 상수항은 우변으로 이항해 ax>b 꼴로 만든 뒤 양변을 a로 나누는데, a가 음수면 부등호의 방향이 바뀐다. 계수가 소수면 10의 거듭제곱을, 분수면 분모의 최소공배수를 양변에 곱해 정수로 고친다.",
  "중2-1 3-3 일차부등식의 활용": "구하려는 것을 x로 놓고 부등식을 세워 풀며, 사람 수나 개수처럼 자연수여야 하는 답은 조건에 맞게 고른다. (거리)=(속력)×(시간), (예금액)=(원금)+(매달 넣는 금액)×(개월 수) 같은 관계를 자주 쓴다.",
  // 중2-1 4단원 연립일차방정식
  "중2-1 4-1 연립방정식과 그 해": "미지수가 2개이고 차수가 1인 방정식을 미지수가 2개인 일차방정식이라 하고, 이를 두 개 짝지어 놓은 것이 연립일차방정식이다. 두 방정식을 모두 참이 되게 하는 x, y의 순서쌍이 연립방정식의 해다.",
  "중2-1 4-2 연립방정식의 풀이": "가감법은 없애려는 미지수의 계수의 절댓값을 같게 맞춘 뒤 두 식을 더하거나 빼서 그 미지수를 없애는 방법이다. 대입법은 한 식을 한 미지수에 대해 정리한 뒤 다른 식에 대입해 미지수를 없애는 방법이다.",
  "중2-1 4-3 여러 가지 연립방정식": "괄호가 있으면 풀어서 정리하고, 계수가 소수면 10의 거듭제곱을, 분수면 분모의 최소공배수를 곱해 정수로 고친다. A=B=C 꼴은 두 개의 연립방정식으로 나누어 푼다. 두 식이 완전히 같으면 해가 무수히 많고, x와 y의 계수는 같은데 상수항만 다르면 해가 없다.",
  "중2-1 4-4 연립방정식의 활용": "구하려는 두 가지를 x, y로 놓고 주어진 조건 두 개로 식을 세운다. 십의 자리 숫자가 x, 일의 자리 숫자가 y인 두 자리 자연수는 10x+y이고 자리를 바꾼 수는 10y+x다. 거리·속력·시간, 농도, 일의 양 문제에 자주 쓰인다.",
  // 중2-1 5단원 일차함수와 그 그래프
  "중2-1 5-1 함수와 함숫값": "x의 값이 하나 정해질 때 y의 값이 오직 하나로 정해지면 y는 x의 함수라 하고 y=f(x)로 나타낸다. x=a일 때 정해지는 y의 값 f(a)를 x=a에서의 함숫값이라 한다.",
  "중2-1 5-2 일차함수와 그 그래프": "y=ax+b (a≠0)처럼 y가 x에 대한 일차식으로 나타나는 함수를 일차함수라 한다. y=ax+b의 그래프는 y=ax의 그래프를 y축 방향으로 b만큼 평행이동한 직선이다.",
  "중2-1 5-3 일차함수 그래프의 절편과 기울기": "x절편은 그래프가 x축과 만나는 점의 x좌표로 y=0일 때의 x값이고, y절편은 y축과 만나는 점의 y좌표로 x=0일 때의 y값이다. 기울기는 (y의 증가량)÷(x의 증가량)이며, y=ax+b에서 기울기는 a이고 y절편은 b다.",
  "중2-1 5-4 일차함수 그래프의 성질": "y=ax+b에서 a>0이면 오른쪽 위로 향하는 증가하는 직선이고 a<0이면 오른쪽 아래로 향하는 감소하는 직선이다. |a|가 클수록 그래프는 y축에 가깝게 가파르다. 기울기가 같고 y절편이 다른 두 그래프는 평행하고, 기울기와 y절편이 모두 같으면 두 그래프는 일치한다.",
  "중2-1 5-5 일차함수의 활용": "두 변수 사이의 관계를 y=ax+b로 놓되, 일정하게 변하는 양을 기울기 a로, 처음의 값을 y절편 b로 잡아 식을 세운다. 물의 양, 온도, 길이처럼 일정한 비율로 변하는 상황에 쓰인다.",
  // 중2-1 6단원 일차함수와 일차방정식의 관계
  "중2-1 6-1 일차함수와 일차방정식": "일차방정식 ax+by+c=0 (a≠0, b≠0)의 그래프는 일차함수 y=-(a/b)x-(c/b)의 그래프와 같은 직선이다. y=k의 그래프는 x축에 평행한 직선이고, x=h의 그래프는 y축에 평행한 직선이다.",
  "중2-1 6-2 연립방정식의 해와 그래프": "연립방정식의 해는 두 일차방정식의 그래프가 만나는 점의 좌표와 같다. 두 그래프가 한 점에서 만나면 해가 하나, 평행해서 만나지 않으면 해가 없고, 두 그래프가 일치하면 해가 무수히 많다.",

  "7-2 확률의 계산": "또는(동시에 안 일어남)=덧셈 p+q, 동시에(독립)=곱셈 p×q, 비복원추출=종속시행.",
};

// 2026-09-18 변경: 검토 대기함을 거치지 않고 만든 문제를 바로 문제은행에 넣어요(선생님 결정).
// 새 문제에는 autoDate(한국 날짜)를 붙이고, 학생 화면은 그날 새로 만든 문제를 먼저 내요.
// 개별학생 대상 문제만 예전처럼 검토 대기함으로 가요 (문제은행은 반 단위라서).
function generateDailyConceptQuestions(){
  const data = fetchConceptAppData_();

  // ⚠️ 핵심 안전장치: students 배열이 정상적으로 안 왔으면 절대 진행하지 않아요.
  if(!data || !Array.isArray(data.students)){
    Logger.log('❌ 데이터를 정상적으로 불러오지 못해서 안전하게 중단했어요. (다음 예약 실행 때 다시 시도돼요)');
    return;
  }

  const kstNow = new Date(Date.now() + 9 * 3600 * 1000);
  const todayKst = kstNow.toISOString().slice(0, 10);
  const todayDow = kstNow.getUTCDay(); // 0=일 ... 6=토

  data.conceptBankItems = data.conceptBankItems || [];
  data.conceptDraftItems = data.conceptDraftItems || [];
  data.nextConceptDraftId = data.nextConceptDraftId || (maxId_(data.conceptDraftItems) + 1);

  const targets = getActiveConceptTargets_(data);
  if(targets.length === 0){
    Logger.log('생성할 대상이 없어요 (커리큘럼 단원 / conceptDailyCounts / students 확인).');
    return;
  }

  const newBankItems = [];
  const newDraftItems = [];
  const done = [];
  const skipped = [];
  const failed = [];
  let idSeed = Date.now() * 1000;

  targets.forEach(target => {
    const label = conceptTargetLabel_(target);
    const isClass = target.type === 'class';
    try {
      if(isClass){
        const activeDays = (data.conceptActiveDays || {})[target.className];
        if(activeDays && activeDays.length > 0 && activeDays.indexOf(todayDow) === -1){
          skipped.push(label + '(오늘 출제 요일 아님)');
          return;
        }
        if(data.conceptBankItems.some(i => i.className === target.className && i.autoDate === todayKst)){
          skipped.push(label + '(오늘 이미 만듦)');
          return;
        }
      }

      const targetKey = JSON.stringify(target);
      const existing = [
        ...data.conceptBankItems.filter(i => isClass ? i.className === target.className : JSON.stringify(i.target) === targetKey),
        ...data.conceptDraftItems.filter(i => JSON.stringify(i.target) === targetKey)
      ].slice(-80); // 프롬프트가 너무 길어지지 않게 최근 문제만 겹침 방지에 써요

      let activeUnitsForTarget = (data.conceptCurriculumUnits || []).filter(u => u.active && JSON.stringify(u.target) === targetKey);
      if(activeUnitsForTarget.length === 0 && isClass){
        const enabledNames = (data.conceptEnabledUnits && data.conceptEnabledUnits[target.className]) || [];
        activeUnitsForTarget = enabledNames
          .filter(name => CONCEPT_CURRICULUM_BY_UNIT[name])
          .map(name => ({ unitName: name, summary: CONCEPT_CURRICULUM_BY_UNIT[name] }));
      }
      const questionsPerClass = (isClass && data.conceptDailyCounts && data.conceptDailyCounts[target.className]) || CONCEPT_AUTOGEN_CONFIG.QUESTIONS_PER_CLASS;
      const newItems = generateConceptQuestionsForTarget_(target, existing, activeUnitsForTarget, questionsPerClass);
      if(newItems.length === 0) throw new Error('AI가 쓸 수 있는 문제를 하나도 돌려주지 않았어요.');

      newItems.forEach(item => {
        if(isClass){
          const bankItem = {
            id: ++idSeed,
            className: target.className,
            unit: item.unit || '',
            question: item.question,
            choices: item.choices,
            correctIndex: item.correctIndex,
            autoDate: todayKst,
            source: 'ai',
            createdAt: new Date().toISOString()
          };
          if(item.example) bankItem.example = item.example;
          newBankItems.push(bankItem);
        } else {
          const draftItem = {
            id: data.nextConceptDraftId++,
            target: target,
            unit: item.unit || '',
            question: item.question,
            choices: item.choices,
            correctIndex: item.correctIndex,
            createdAt: new Date().toISOString()
          };
          if(item.example) draftItem.example = item.example;
          newDraftItems.push(draftItem);
        }
      });
      done.push(`${label} ${newItems.length}개`);
      Logger.log(`[${label}] ${newItems.length}개 ${isClass ? '출제' : '검토 대기함에 추가'}`);
    } catch(err){
      failed.push(`${label}: ${err.message || err}`);
      Logger.log(`❌ [${label}] 생성 실패: ${err.message || err}`);
    }
  });

  if(skipped.length) Logger.log('건너뜀: ' + skipped.join(', '));

  if(newBankItems.length + newDraftItems.length > 0){
    // 문제 생성하는 동안 다른 곳에서 저장된 게 있을 수 있으니, 저장 직전에 최신 데이터에 새 문제만 더해요.
    const latest = fetchConceptAppData_();
    if(!latest || !Array.isArray(latest.students) || latest.students.length === 0){
      Logger.log('🛑 저장 직전 재확인에 실패해서 안전하게 중단했어요. (다음 예약 실행 때 다시 시도돼요)');
      return;
    }
    latest.conceptBankItems = mergeConceptItemsById_(latest.conceptBankItems, (latest.conceptBankItems || []).concat(newBankItems));
    latest.conceptDraftItems = mergeConceptItemsById_(latest.conceptDraftItems, (latest.conceptDraftItems || []).concat(newDraftItems));
    latest.nextConceptDraftId = Math.max(latest.nextConceptDraftId || 1, data.nextConceptDraftId || 1);
    saveConceptAppData_(latest);
    Logger.log(`✅ 문제은행에 ${newBankItems.length}개 바로 출제, 검토 대기함에 ${newDraftItems.length}개`);
  }

  if(done.length === 0 && failed.length === 0) return;

  // 🔔 선생님 폰에 결과 알림 — 실패했으면 이유까지 알려서 조용히 멈추지 않게 해요
  try {
    if(typeof sendPushToTokens === 'function' && data.adminPushTokens && data.adminPushTokens.length){
      sendPushToTokens(
        data.adminPushTokens,
        failed.length ? '⚠️ 개념문제 자동 출제 일부 실패' : '🧩 오늘의 개념문제를 자동 출제했어요',
        (done.length ? '출제: ' + done.join(', ') : '') + (failed.length ? (done.length ? ' / ' : '') + '실패: ' + failed.join(' | ').slice(0, 150) : ''),
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

  const promptText = `너는 중학교 수학 개념 문제를 만드는 출제자야.
아래 "개념 요약"에 적힌 소단원의 학년·학기 범위만 다뤄. 그 범위를 벗어난 내용은 쓰지 마.
아래 "개념 요약"을 바탕으로, 서로 다른 소단원에서 총 ${questionsPerClass}개의 문제를 새로 만들어줘.
문제 하나는 [빈칸채우기 3지선다 개념문제 1개] + [그 개념을 바로 써먹는 아주 기초적인 3지선다 유제 1개] 한 쌍이야.
[개념 요약]
${curriculumText}

[이미 있는 문제들 - 절대 겹치지 않게, 다른 표현/다른 소단원 위주로 만들어줘]
${existingQuestionTexts.length ? existingQuestionTexts.map(q => '- ' + q).join('\n') : '(아직 없음)'}

[출제 규칙]
- question에는 빈칸을 "___"로 표시
- choices는 정답 1개 + 오답 2개(실제로 헷갈리기 쉬운 개념으로), 총 3개
- correctIndex는 정답이 choices 배열에서 몇 번째 인덱스인지(0부터 시작)
- 정답 위치를 0, 1, 2에 고루 섞어줘. 전부 0번이 되지 않게.
- unit은 위 개념 요약의 소단원 이름 중 하나를 그대로 사용
- example(유제)은 그 개념을 알면 한두 줄 계산으로 풀리는 가장 기초적인 문제로 만들어줘.
  숫자는 깔끔하게(정수나 간단한 분수) 떨어지게 하고, 개념을 모르면 못 푸는 문제여야 해.
  example.question에는 빈칸("___")을 쓰지 말고 완전한 물음 문장으로 써줘.
  그림을 봐야만 풀리는 문제는 만들지 마. 필요한 조건은 문장 안에 다 적어줘.
- 제곱·세제곱 등은 반드시 위첨자 문자(²,³)를 사용해. "^2", "^3" 같은 표기나 "$...$" 같은 LaTeX 기호는 절대 쓰지 마.
  예: "a² + b² = c²" (O), "a^2 + b^2 = c^2" (X), "$a^2+b^2$" (X)
- 문장은 자연스러운 한국어 존댓말/평서문으로, 오타 없이 정확하게 써줘.

다른 설명 없이, 아래 JSON 배열 형식으로만 답해줘:
[{"unit":"...", "question":"...", "choices":["...","...","..."], "correctIndex":0,
  "example":{"question":"...", "choices":["...","...","..."], "correctIndex":0}}, ...]`;

  const payload = {
    contents: [{ parts: [{ text: promptText }] }],
    generationConfig: { temperature: 0.5, maxOutputTokens: 8192 }
  };

  // 2026-09-18: 모델을 안 넘겨서 사진분석과 같은 쿼터를 쓰고 있었어요 → 텍스트용 lite 모델로 분리
  const rawResponse = callGeminiWithRetry(payload, 4, 'gemini-flash-lite-latest');
  const code = rawResponse && typeof rawResponse.getResponseCode === 'function' ? rawResponse.getResponseCode() : 200;
  if(code !== 200){
    if(isGeminiDailyQuotaExhausted_(rawResponse)) throw new Error('AI 무료 하루 사용량을 다 썼어요 (내일 다시 시도돼요)');
    let body = '';
    try { body = rawResponse.getContentText(); } catch(e){}
    throw new Error('AI 서버 오류 ' + code + ': ' + body.slice(0, 150));
  }
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

  // 유제는 형식이 맞을 때만 붙여요. 유제가 이상해도 개념문제는 살려요.
  function cleanExample_(ex){
    if(!ex || typeof ex.question !== 'string' || !ex.question.trim() || !Array.isArray(ex.choices)) return null;
    const choices = ex.choices.map(function (c) { return normalizeMathNotation_(String(c)); });
    if(choices.length < 2 || choices.some(function (c) { return !c.trim(); })) return null;
    if(!Number.isInteger(ex.correctIndex) || ex.correctIndex < 0 || ex.correctIndex >= choices.length) return null;
    return { question: normalizeMathNotation_(ex.question), choices: choices, correctIndex: ex.correctIndex };
  }

  const cleaned = parsed
    .filter(q => q && q.question && Array.isArray(q.choices))
    .map(q => {
      const out = {
        unit: q.unit,
        question: normalizeMathNotation_(q.question),
        choices: q.choices.map(c => normalizeMathNotation_(c)),
        correctIndex: q.correctIndex
      };
      const ex = cleanExample_(q.example);
      if(ex) out.example = ex;
      return out;
    });

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
  const relevantItems = (allItems || []).filter(i => itemMatchesStudentForReminder_(i, student));
  const perDay = (dailyCounts && dailyCounts[student.className]) || 5;
  return pickTodaysConceptItems_(relevantItems, perDay, Date.now());
}

// 학생 포털 getTodaysConceptItemsForStudent · 관리자 앱 getTodaysConceptItems 와 같은 규칙이에요 (바꿀 땐 셋 다):
// 오늘(한국 날짜) 자동 출제된 문제를 먼저, 모자라면 나머지 문제를 날짜별로 돌려가며 채워요.
function pickTodaysConceptItems_(items, perDay, nowMs){
  const sorted = (items || []).slice().sort((a,b) => a.id - b.id);
  if(sorted.length === 0) return [];
  const kstToday = new Date(nowMs + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const fresh = sorted.filter(i => i.autoDate === kstToday).slice(0, perDay);
  const rest = sorted.filter(i => i.autoDate !== kstToday);
  const need = Math.min(perDay - fresh.length, rest.length);
  const dayIndex = Math.floor((nowMs + 9 * 3600 * 1000) / 86400000);
  const startIdx = rest.length ? (dayIndex * perDay) % rest.length : 0;
  const result = fresh.slice();
  for(let i = 0; i < need; i++) result.push(rest[(startIdx + i) % rest.length]);
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