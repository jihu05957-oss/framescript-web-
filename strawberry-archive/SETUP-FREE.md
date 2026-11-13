# Strawberry Moon — 무료 운영 준비 (아직 정식 사용 불가)

**미검증 인프라를 완성으로 표시하지 않습니다.**

## 무료 구성
- 공개 앱: Render 무료 웹서비스 — 15분 무요청 시 절전 가능
- 영구 사진 저장: Cloudflare R2 Standard 10 GB-month 무료, 서버 측 안전 상한 9.8 GB
- 예약 실행: Cloudflare Workers Free Cron Trigger로 5분마다 /api/cron-scan 호출
- 배포 소스: 기존 GitHub 저장소의 strawberry-moon-free-storage-v4 브랜치

## Cloudflare R2 직접 연결 필요
Cloudflare > R2 object storage > Create bucket. 버킷 이름 예: strawberry-moon-private. Standard 저장 클래스.
R2 > Manage API Tokens > Create R2 API Token > 해당 버킷만 Object Read & Write.

**Access Key와 Secret을 채팅이나 GitHub 코드에 게시하지 마세요.**
Render 서비스의 Environment 탭에 안전하게 다음 4개를 입력해야 실제 수집·영구 저장이 시작됩니다:
- R2_ENDPOINT (https://<account-id>.r2.cloudflarestorage.com)
- R2_BUCKET
- R2_ACCESS_KEY_ID
- R2_SECRET_ACCESS_KEY

저장소 연결 시 앱은 Read/Write/Delete 왕복 테스트를 실행하고, 실패하면 수집을 시작하지 않게 설계되었습니다.

## 무료 스케줄러
Cloudflare Workers > Create Worker를 만들고 scheduler/src/index.js 코드를 배포합니다.
Cron Triggers는 scheduler/wrangler.toml의 `*/5 * * * *`와 동일하게 설정합니다.
Worker에 ARCHIVE_URL 변수, ARCHIVE_CRON_TOKEN 암호화 Secret을 설정합니다.
Render Environment에 CRON_SECRET 값으로 같은 32자 이상 비밀 문자열을 넣어야 합니다.
반드시 HTTPS로만 연결하며, 공개 API에 비밀번호를 직접 쓰지 않습니다.

## 완료 판정
'등록된 출처 탐색 완료'는 지정된 공개 범주와 하위 범주의 페이지를 모두 읽고, 미수집 파일 오류가 0개일 때만 표시합니다.
아이유의 세상 모든 공식 사진을 확보했다고 의미하지 않습니다. 인스타그램과 EDAM 자동 다운로드는 별도 권한 및 출처별 규정 확인이 필요합니다.
중복 SHA-256 파일만 자동 차단, 해상도·리사이즈 차이가 있는 유사 파일은 별도 검토 표시합니다.
R2 10GB-month와 무료 요청 할당량은 Cloudflare 계정 단위로 합산되므로 다른 버킷 사용량이나 API 요금은 별도 확인해야 합니다.

## 검증 항목
- JavaScript 정적 검사
- 저장 용량/중복/완료 판정 단위 테스트
- R2 읽기/쓰기/삭제, 수집 재시작 이어받기, 429 대기, 실제 이미지 다운로드
- Android Chrome 카카오톡 파일 공유 (기기에서 실제 실행 확인 필요)
- 24시간 이상 주기 수집 성공 및 계정 무료 한도 확인

이 중 실제 외부 자격증명과 휴대폰이 필요한 테스트는 사용자 연결 전까지 완료할 수 없습니다.
