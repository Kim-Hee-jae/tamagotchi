# 동행 다마고치 PWA + Web Push 패키지

이 패키지는 두 단계로 사용할 수 있습니다.

## 1단계: Netlify 정적 PWA만 사용

`pwa/` 폴더를 Netlify에 배포하면 설치형 PWA가 됩니다.

가능한 것:
- 홈 화면에 앱처럼 추가
- 알림 권한 요청
- 앱이 열려 있거나 브라우저가 타이머를 유지하는 동안 로컬 알림
- 5관 QR을 통한 30초 뒤 요청 중단

제한:
- 서버 설정이 없으면 앱이 완전히 닫힌 뒤 계속 알림을 보내는 것은 보장되지 않습니다.

## 2단계: 진짜 Web Push 서버까지 사용

앱이 닫혀 있어도 서버에서 푸시를 보내려면 `server/`를 별도 서버에 배포해야 합니다.

### 서버 실행

```bash
cd server
npm install
npm run keys
```

출력된 값을 `.env`에 넣습니다.

```text
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:your-email@example.com
ALLOWED_ORIGIN=https://your-netlify-site.netlify.app
```

실행:

```bash
npm start
```

Render/Railway 같은 Node 서버에 배포하면 `https://your-server.onrender.com` 같은 주소가 생깁니다.

### PWA 설정

`pwa/config.js`에 값을 넣습니다.

```js
window.TAMA_CONFIG = {
  API_BASE_URL: "https://your-server.onrender.com",
  VAPID_PUBLIC_KEY: "서버에서_생성한_PUBLIC_KEY",
  LOCAL_NOTIFICATION_INTERVAL_SECONDS: 30,
  REQUEST_INTERVAL_SECONDS: 12
};
```

그 뒤 `pwa/` 폴더를 Netlify에 다시 배포합니다.

## QR 생성

```bash
cd pwa
python make_qr.py "https://your-netlify-site.netlify.app"
```

생성 파일:
- `qr_2hall_normal.png`
- `qr_2hall_start_push.png`
- `qr_5hall_stop_after_30s.png`
- `qr_5hall_rupture_now.png`
- `qr_rehearsal_reset.png`

## 추천 전시 흐름

1. Ⅱ관에서 `qr_2hall_normal.png` 또는 `qr_2hall_start_push.png` 사용
2. 관람자가 PWA를 설치하고 알림을 허용
3. 전시 이동 중 다마고치가 먹이/쓰다듬기 알림을 보냄
4. Ⅴ관에서 `qr_5hall_stop_after_30s.png` 사용
5. 30초 뒤 요청 알림이 멈추며 관계 형성 조건의 균열을 체험

## iPhone 주의

iPhone에서는 웹앱을 홈 화면에 추가한 뒤 알림 허용을 해야 Web Push가 정상적으로 작동합니다.
