# Assets

이 폴더에는 전시용 영상 파일을 넣습니다.

## miku360_eac_source.mp4

- YouTube에서 추출된 EAC / Equi-Angular Cubemap 계열 원본을 보존하는 파일입니다.
- 앱에서 직접 재생하지 않습니다.

## miku360_equirect.mp4

- 앱의 3관 미쿠 360도 플레이어가 실제로 사용하는 파일입니다.
- `scripts/convert_miku360_eac_to_equirect.ps1`로 생성합니다.
- 2:1 equirectangular mp4여야 합니다.

## 주의

OpenAI API Key나 VAPID Private Key 같은 비밀값은 이 폴더나 app/main_pwa/config.txt에 넣지 마세요.
비밀값은 app/render_server/private_config.txt 또는 Render Secret File로 관리합니다.
