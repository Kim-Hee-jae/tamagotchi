# Assets

이 폴더에는 전시용 영상 파일을 넣습니다.

## miku360.mp4

- config.txt의 `miku.normalMode`가 `"360"`일 때 사용됩니다.
- 진짜 360도 equirectangular mp4여야 합니다.
- 일반 2D 영상을 넣으면 진짜 360도 VR이 되지 않습니다.
- 권장 해상도: 3840x1920 또는 2560x1280

## miku2d.mp4

- config.txt의 `miku.normalMode`가 `"theater"`일 때 사용됩니다.
- 일반 2D 영상을 VR 극장처럼 보여줄 때 사용됩니다.

## 주의

OpenAI API Key나 VAPID Private Key 같은 비밀값은 이 폴더나 app/main_pwa/config.txt에 넣지 마세요.
비밀값은 app/render_server/private_config.txt 또는 Render Secret File로 관리합니다.
