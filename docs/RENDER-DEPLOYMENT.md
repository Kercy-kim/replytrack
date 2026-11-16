# 학교 컴퓨터에서 ReplyTrack 시연하기

Render의 Node.js Web Service에 배포하면 학교 PC에서 프로그램 설치 없이 HTTPS 주소를 열 수 있다. 공개 배포는 시연용 로그인으로 보호하며, 기존 로컬 실행 방식은 그대로 유지한다.

## 실제 접속 주소와 확인 결과

- 일반 서비스: https://replytrack.onrender.com
- 발표 결과 재생: https://replytrack.onrender.com/presentation
- 로그인 사용자 이름: `replytrack`. 비밀번호는 Render에서 직접 설정한 값을 사용한다.
- 2026-11-17 00:20 KST, `a804002` 배포가 Render에서 Live로 전환됐다.
- 외부 요청으로 `/api/health` 정상 응답(200)을 확인했다. 비로그인 상태의 메인·상담 목록·AI 설정·발표 화면은 모두 401로 차단됐다.
- 사용자가 일반 브라우저에서 로그인 후 메인 화면이 열리는 것을 확인했다. 자동 조작용 내장 브라우저는 Basic 인증창을 열지 못해 로그인 후 기능과 실제 OpenAI 호출은 이번 배포 점검에서 직접 재검증하지 않았다. 기존 로컬 테스트 결과와 구분한다.

학교 PC에서는 Chrome 또는 Edge의 시크릿 창을 이용한다. 이 호스팅 버전의 개인정보 가림과 OCR은 Render 서버에서 수행하므로 입력 원문·캡처는 해당 서버로 전송된다. 가림 검토 전 OpenAI로 전송하는 것은 아니다. 수업 시연에는 가상 자료를 사용한다.

## 배포 설정

- 저장소: `https://github.com/Kercy-kim/tripsketch-ai`
- 유형: Web Service / Node
- 서비스 이름: `replytrack`
- 지역: Singapore / 요금제: Free
- Build Command: `npm ci --omit=dev`
- Start Command: `npm start`
- Health Check Path: `/api/health`
- Node: 저장소의 `.node-version` 사용

환경변수는 Render의 Environment에만 입력한다. 키를 저장소나 발표자료에 넣지 않는다.

| 변수 | 값 |
| --- | --- |
| `OPENAI_API_KEY` | 기존 OpenAI API 키 |
| `OPENAI_MODEL` | `gpt-5-mini` |
| `REPLYTRACK_DEMO_PASSWORD` | 본인이 정한 16자 이상 시연용 비밀번호 |

Render가 `RENDER_EXTERNAL_URL`을 제공하므로 주소를 미리 추측해서 입력할 필요가 없다. 다른 호스팅이나 사용자 도메인을 사용할 때만 `REPLYTRACK_PUBLIC_ORIGIN=https://정확한주소`를 설정한다. 공개 주소가 설정됐는데 비밀번호가 없으면 서버가 시작되지 않는다.

`render.yaml`은 같은 설정의 Blueprint이다. 무료 서비스만 정의하며 유료 데이터베이스·디스크는 생성하지 않는다. 일반 Web Service 화면으로 생성했다면 Blueprint를 추가 생성하지 않는다.

## 접속과 시연

1. 배포가 Live가 되면 Render가 제공한 HTTPS 주소를 연다.
2. 브라우저 로그인창에서 사용자 이름 `replytrack`, 위에서 설정한 시연용 비밀번호를 입력한다.
3. 실제 서비스는 `/`, 사전 실행한 AI 결과는 `/presentation`에서 연다.
4. 발표 전에 연결 점검과 가상 문의를 준비한다. 30초 시연은 개인정보 가림 → 준비된 질문 상태·할 일 → 영어 재문의 → 새 답변 비교 순서다.
5. 새 API 분석을 직접 보여 줄 때는 실제 대기 시간이 추가된다. `/presentation`은 실시간 분석으로 설명하지 않는다.
6. 공용 PC에서는 시연 후 로그인 정보를 저장하지 않고 사용한 브라우저 창을 닫는다. 시크릿 창에서 시작하면 정리하기 편하다.

이 로그인은 발표자 한 명 또는 비밀번호를 공유한 시연자용이다. 비밀번호를 아는 사람들은 같은 서버 기록과 API 설정을 사용한다. 일반 고객용 회원 가입이나 사용자별 데이터 분리는 제공하지 않는다. 보호된 서비스 안에서는 API 키 변경도 가능하므로 시연 비밀번호를 공개 슬라이드에 넣지 않는다.

## 무료 요금제와 저장 기록

Render Free는 15분간 요청이 없으면 멈추며 다음 접속 때 시작 지연이 있다. 재시작·재배포·절전 때 로컬 SQLite 기록이 사라진다. 발표 직전 접속하고 필요한 문의를 준비하며, 보관할 기록은 내려받는다. 저장소에 포함한 `/presentation` 결과는 재시작 뒤에도 제공된다. 장기 보관이 필요하면 별도의 영구 저장소가 필요하다.

호스팅은 무료 제공 한도 안에서 사용하며 실제 OpenAI 요청 비용은 별도다. 원문·API 키·비밀번호는 Git에 올리지 않는다.

## 확인한 공식 문서

- [웹 서비스·공개 주소](https://render.com/docs/web-services)
- [자동 제공 환경변수](https://render.com/docs/environment-variables)
- [Node 버전](https://render.com/docs/node-version)
- [무료 요금제 제한](https://render.com/docs/free)

이번 변경은 서버 주소·접근 보호·배포 설정에 한정한다. 기존 AI 프롬프트와 판정 로직은 수정하지 않는다.
