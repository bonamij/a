  /**
 * ============================================================================
 * 💾 매일 자동 백업 스크립트
 * ============================================================================
 * 하는 일:
 *  1) 매일 밤(트리거로 설정한 시간에) 지금 데이터 전체를 통째로 받아와서
 *  2) 구글 드라이브의 "아임수학학원_백업" 폴더 안에
 *     backup_2026-09-01.json 같은 이름으로 저장해요.
 *  3) 30일보다 오래된 백업 파일은 자동으로 지워서, 드라이브 용량을 안 잡아먹어요.
 *
 * 왜 필요한가:
 *  구글시트 A1 셀에 모든 데이터가 통째로 들어있는 구조라, 코드 실수나
 *  저장 충돌로 데이터가 잘못되면 되돌릴 방법이 없었어요. 이 백업이 있으면
 *  "어제 밤 데이터로 돌아가기"가 언제든 가능해요.
 *
 * ── 설치 방법 ──────────────────────────────────────────
 *  1. Apps Script 프로젝트에 새 스크립트 파일로 추가 (이름 예: backup_system.gs)
 *  2. 아래 CONFIG의 SHEET_URL을 실제 웹앱 주소로 교체
 *     (다른 파일들과 똑같은 주소예요)
 *  3. 왼쪽 메뉴 "트리거"(시계 아이콘) → 트리거 추가
 *     - 실행할 함수: backupDataSnapshot
 *     - 이벤트 소스: 시간 기반 → 일 타이머 → 원하는 시간대 (예: 새벽 2시~3시)
 *     - 다른 트리거들(개념빈칸 자동생성 등)과 시간대가 겹치지 않게 해주세요
 *  4. 저장 전에 "지금 실행" 버튼으로 한 번 테스트해보세요.
 *
 * ── 복원(되돌리기) 방법 ──────────────────────────────────
 *  1. 이 스크립트 파일 안 restoreFromBackup 함수의 targetDate를
 *     되돌리고 싶은 날짜로 바꾸기 (예: '2026-08-31')
 *  2. Apps Script 에디터에서 restoreFromBackup 함수를 선택하고 "지금 실행"
 *  3. 실행 로그에 "✅ 복원 완료"가 뜨면 끝. 그 날짜의 데이터로 완전히
 *     되돌아가요 (지금 데이터는 덮어써지니, 정말 필요할 때만 쓰세요!)
 * ============================================================================
 */

const BACKUP_CONFIG = {
  SHEET_URL: 'https://script.google.com/macros/s/AKfycby248HXB7pvkzJ1gBjmLux0myAH2otNNt2A4Vp0edu0HAW49W42-8-uJzN_aKnbP6Uf/exec',
  FOLDER_NAME: '아임수학학원_백업',
  RETENTION_DAYS: 30,
};

function backupDataSnapshot(){
  const res = UrlFetchApp.fetch(BACKUP_CONFIG.SHEET_URL, { method: 'get', muteHttpExceptions: true });
  if(res.getResponseCode() !== 200){
    Logger.log('❌ 데이터를 불러오지 못해서 백업을 건너뛰었어요. (응답 코드: ' + res.getResponseCode() + ')');
    return;
  }

  let data;
  try {
    data = JSON.parse(res.getContentText());
  } catch(e){
    Logger.log('❌ 데이터를 해석하지 못해서 백업을 건너뛰었어요.');
    return;
  }

  // ⚠️ 안전장치: 학생 데이터가 비정상적으로 비어있으면 백업하지 않아요.
  // (텅 빈 데이터를 "백업"이라고 저장해버리면, 나중에 그게 진짜 백업인 줄
  //  알고 복원했다가 오히려 데이터를 다 날릴 수 있어서요.)
  if(!data || !Array.isArray(data.students) || data.students.length === 0){
    Logger.log('❌ 학생 데이터가 비어있는 것처럼 보여서 안전하게 백업을 건너뛰었어요.');
    return;
  }

  const folder = getOrCreateBackupFolder_();
  const dateStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const fileName = `backup_${dateStr}.json`;

  // 같은 날짜 백업이 이미 있으면 덮어쓰기 (하루에 여러 번 실행돼도 안전)
  const existing = folder.getFilesByName(fileName);
  while(existing.hasNext()) existing.next().setTrashed(true);

  folder.createFile(fileName, JSON.stringify(data), MimeType.PLAIN_TEXT);
  Logger.log(`✅ 백업 완료: ${fileName} (학생 ${data.students.length}명 데이터)`);

  cleanupOldBackups_(folder);
}

function getOrCreateBackupFolder_(){
  const folders = DriveApp.getFoldersByName(BACKUP_CONFIG.FOLDER_NAME);
  if(folders.hasNext()) return folders.next();
  return DriveApp.createFolder(BACKUP_CONFIG.FOLDER_NAME);
}

function cleanupOldBackups_(folder){
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - BACKUP_CONFIG.RETENTION_DAYS);

  const files = folder.getFiles();
  let deletedCount = 0;
  while(files.hasNext()){
    const file = files.next();
    if(file.getDateCreated() < cutoff){
      file.setTrashed(true);
      deletedCount++;
    }
  }
  if(deletedCount > 0){
    Logger.log(`🗑️ ${BACKUP_CONFIG.RETENTION_DAYS}일보다 오래된 백업 ${deletedCount}개를 정리했어요.`);
  }
}

/**
 * ⚠️ 복원 함수 — 정말 필요할 때만 신중하게 사용하세요.
 * targetDate에 원하는 날짜(YYYY-MM-DD)를 넣고 이 함수를 "지금 실행"하면,
 * 그 날짜의 백업으로 현재 데이터를 완전히 덮어씁니다.
 */
function restoreFromBackup(){
  const targetDate = '여기에_되돌릴_날짜_입력_예:2026-08-31'; // ⚠️ 실행 전 반드시 날짜로 바꿔주세요

  if(targetDate === '여기에_되돌릴_날짜_입력_예:2026-08-31'){
    Logger.log('❌ 위 targetDate 값을 실제 날짜(예: "2026-08-31")로 바꾼 다음 다시 실행해주세요.');
    return;
  }

  const folder = getOrCreateBackupFolder_();
  const fileName = `backup_${targetDate}.json`;
  const files = folder.getFilesByName(fileName);

  if(!files.hasNext()){
    Logger.log(`❌ ${fileName} 파일을 찾을 수 없어요. 날짜를 다시 확인해주세요.`);
    return;
  }

  const file = files.next();
  const backupContent = file.getBlob().getDataAsString();

  let backupData;
  try {
    backupData = JSON.parse(backupContent);
  } catch(e){
    Logger.log('❌ 백업 파일을 읽지 못했어요. 파일이 손상됐을 수 있어요.');
    return;
  }

  if(!backupData || !Array.isArray(backupData.students)){
    Logger.log('❌ 백업 파일 내용이 이상해서 안전하게 복원을 중단했어요.');
    return;
  }

  UrlFetchApp.fetch(BACKUP_CONFIG.SHEET_URL, {
    method: 'post',
    contentType: 'text/plain',
    payload: JSON.stringify(backupData),
    muteHttpExceptions: true
  });

  Logger.log(`✅ 복원 완료: ${targetDate} 시점 데이터로 되돌렸어요. (학생 ${backupData.students.length}명)`);
}

/** 지금까지 저장된 백업 파일 목록을 로그로 보여줘요 (날짜 확인용) */
function listBackups(){
  const folder = getOrCreateBackupFolder_();
  const files = folder.getFiles();
  const names = [];
  while(files.hasNext()) names.push(files.next().getName());
  names.sort();
  Logger.log(names.length > 0 ? names.join('\n') : '아직 백업이 없어요.');
}
