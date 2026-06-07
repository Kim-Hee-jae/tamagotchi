// PWA 기본 설정
// 서버 푸시를 쓰려면 server/.env의 VAPID_PUBLIC_KEY와 동일한 공개키를 넣으세요.
// 서버 없이 Netlify 정적 배포만 쓰면 API_BASE_URL과 VAPID_PUBLIC_KEY는 빈 문자열로 둬도 됩니다.
// 이 경우 앱이 열려 있거나 브라우저가 타이머를 유지하는 동안에만 로컬 알림이 작동합니다.
window.TAMA_CONFIG = {
  API_BASE_URL: "",
  VAPID_PUBLIC_KEY: "",
  LOCAL_NOTIFICATION_INTERVAL_SECONDS: 30,
  REQUEST_INTERVAL_SECONDS: 12
};
