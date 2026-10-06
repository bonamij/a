/**
 * ============================================================================
 * 📨 학부모 문자 (2026-10-06)
 * ============================================================================
 * 두 가지 방식이에요. 관리자 앱 "데이터 관리" 탭에서 고를 수 있어요.
 *  - 문자앱 열기(link): 폰에서 문자앱이 받는 사람·내용이 채워진 채로 열려요.
 *    전송은 선생님이 직접 누르고, 서버에는 기록만 남아요. (준비물 없음)
 *  - 자동 발송(gateway): 학원 안드로이드폰의 MacroDroid 웹훅을 서버가 불러서,
 *    폰이 대신 문자를 보내요. 컴퓨터에서 눌러도 나가요.
 *
 * 안전장치: 웹훅 주소는 MacroDroid 주소(https://trigger.macrodroid.com/...)만 허용해요.
 * 설정이 잘못되거나 누가 엉뚱한 주소를 넣어도 다른 곳으로 요청이 가지 않아요.
 * ============================================================================
 */

const SMS = {
  MAX_TEXT: 1000,
  GATEWAY_PREFIX: 'https://trigger.macrodroid.com/'
};

// 숫자만 남겨요 (010-1234-5678 → 01012345678)
function normalizePhone_(raw) {
  const digits = String(raw || '').replace(/[^0-9]/g, '');
  if (digits.length < 9 || digits.length > 11) return '';
  return digits;
}

function smsSettings_(snap) {
  const s = (snap || snapshot_()).maps.settings || {};
  return {
    mode: s.smsMode || 'link',
    gatewayUrl: s.smsGatewayUrl || '',
    signature: s.smsSignature || ''
  };
}

/** 자동 발송: 학원폰(MacroDroid)에 "이 번호로 이 내용을 보내라"고 알려요 */
function adminSendSms_(body) {
  const cfg = smsSettings_();
  const to = normalizePhone_(body.to);
  if (!to) throw storeError_('BAD_PHONE', '전화번호가 올바르지 않아요. 학생 정보에서 학부모 번호를 확인해주세요.');
  const text = String(body.text || '').trim();
  if (!text) throw storeError_('BAD_INPUT', '보낼 내용이 비어 있어요.');
  if (text.length > SMS.MAX_TEXT) throw storeError_('BAD_INPUT', '문자가 너무 길어요 (' + SMS.MAX_TEXT + '자까지).');
  if (!cfg.gatewayUrl) throw storeError_('SMS_NOT_SET', '자동 발송 주소가 아직 없어요. 데이터 관리 탭에서 MacroDroid 웹훅 주소를 넣어주세요.');
  if (cfg.gatewayUrl.indexOf(SMS.GATEWAY_PREFIX) !== 0) throw storeError_('SMS_BAD_URL', 'MacroDroid 웹훅 주소(https://trigger.macrodroid.com/...)만 쓸 수 있어요.');

  const url = cfg.gatewayUrl + (cfg.gatewayUrl.indexOf('?') >= 0 ? '&' : '?') +
    'sms_number=' + encodeURIComponent(to) + '&sms_text=' + encodeURIComponent(text);

  let code = 0;
  let err = '';
  try {
    const res = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true });
    code = res.getResponseCode();
  } catch (e) {
    err = e.message;
  }
  const sent = !err && code >= 200 && code < 300;

  const log = {
    id: newServerId_(),
    studentId: body.studentId === undefined ? null : body.studentId,
    studentName: String(body.studentName || ''),
    to: to,
    text: text,
    kind: String(body.kind || 'notice'),
    via: 'gateway',
    status: sent ? 'sent' : 'failed',
    detail: err || ('HTTP ' + code),
    sentAt: new Date().toISOString()
  };
  const result = withLock_(function () {
    return commitOps_([{ op: 'put', c: 'smsLogs', id: String(log.id), data: log }], 'admin:sms');
  });

  if (!sent) {
    throw storeError_('SMS_FAILED', '학원폰에 신호를 보내지 못했어요 (' + (err || ('HTTP ' + code)) + '). 폰이 켜져 있고 인터넷에 연결돼 있는지, MacroDroid가 실행 중인지 확인해주세요.');
  }
  return { ok: true, rev: result.rev, log: log };
}

/** 설정 화면의 "테스트 발송" — 내 번호로 한 통 보내봐요 */
function adminTestSms_(body) {
  return adminSendSms_({
    to: body.to,
    text: '[테스트] 학원관리 앱에서 보낸 문자예요. 이 문자가 보이면 설정이 끝났어요.',
    kind: 'test',
    studentName: '테스트'
  });
}
