/**
 * 🧪 [TEST] 시트 사본 전용 — 운영(원본) 프로젝트에는 절대 올리지 않아요.
 * 편집기에서 setupTestEnvironment 를 한 번 실행하면:
 *  - 실제 알림 발송을 막고(PUSH_DISABLED), 백업은 테스트 전용 폴더로 보내요
 *  - 필요한 권한을 승인받고
 *  - 스크립트 속성 ADMIN_KEY_PLAIN(테스트용 비밀번호)이 있으면 해시로 바꿔 저장하고
 *  - A1 데이터를 새 구조(Items 시트)로 옮겨요
 */
function setupTestEnvironment() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getName().indexOf('[TEST]') !== 0) {
    throw new Error('이 함수는 [TEST] 사본에서만 실행할 수 있어요. 지금 시트: ' + ss.getName());
  }
  const p = PropertiesService.getScriptProperties();
  p.setProperties({
    PUSH_DISABLED: 'true',
    LEGACY_MODE: 'full',
    IS_TEST_COPY: 'true',
    BACKUP_FOLDER_NAME: '아임수학학원_백업_TEST'
  });
  authorizeOnce();

  if (p.getProperty('ADMIN_KEY_PLAIN')) {
    hashAdminKey();
  } else if (!p.getProperty('ADMIN_KEY_HASH')) {
    Logger.log('⚠️ 프로젝트 설정 → 스크립트 속성에 ADMIN_KEY_PLAIN (테스트용 비밀번호, 8자 이상)을 추가하고 다시 실행해주세요.');
  }

  if (!isMigrated_()) migrateToV2();
  else Logger.log('이미 새 구조로 옮겨져 있어요.');

  Logger.log('✅ 테스트 환경 준비 완료 (알림 꺼짐, 테스트 백업 폴더 사용)');
}
