# 개발 및 실행 안내

## 빠른 시작

```powershell
node --version
node server.mjs
```

Node.js 24 이상이 필요합니다. `http://127.0.0.1:3100`에서 실행하며 의존성 설치·빌드는 없습니다. npm이 설치된 환경에서는 `npm start`, `npm test`, `npm run check`도 사용할 수 있습니다. 종료는 터미널에서 Ctrl+C입니다.

코드 변경을 자동 반영하려면 `node --watch server.mjs`를 사용합니다. 화면 파일 변경 후에는 브라우저를 새로고침합니다. 서버가 재시작되면 화면에서 입력한 API 키는 다시 등록해야 합니다.

## AI 설정

화면의 `AI 연결 설정`에서 API 키와 모델을 입력합니다. 연결 표시 자체는 키가 등록됐다는 뜻이며 실제 인증·사용량 확인은 분석 요청 때 수행합니다. 키는 서버 메모리에서만 유지되고, 브라우저 저장소·DB·내보내기에 포함하지 않습니다.

환경변수 방식이 필요하면 `.env.example`을 복사해 로컬 `.env`를 만들고 직접 값을 입력합니다.

```dotenv
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5-mini
PORT=3100
REPLYTRACK_DATA_DIR=./data
```

`.env`는 Git에서 제외됩니다. 키를 채팅, 이슈, 소스 코드에 기재하지 않습니다. 화면과 `.env` 모두 설정했다면 화면에서 등록한 값이 현재 프로세스에서 우선합니다. 모델은 이미지 입력과 Structured Outputs를 지원해야 합니다.

API 요청은 [Responses API의 Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)와 [이미지 입력](https://developers.openai.com/api/docs/guides/images-vision)을 사용합니다. `store: false`로 전송하며, 이 설정을 제공자의 모든 로그가 남지 않는다는 보장으로 해석하지 않습니다.

## 구현 구조

```text
server.mjs            HTTP 라우팅, 로컬 출처 확인, 정적 화면
src/store.mjs         SQLite 저장, 레코드 버전 검사
src/service.mjs       상담·분석·사용자 수정·초안 유스케이스
src/domain.mjs        원문 검증, 날짜 계산, 상태 병합
src/openai.mjs        Responses API 호출과 오류 처리
src/schema.mjs       분석·전사·초안 JSON 스키마
src/prompts.mjs       각 작업의 프롬프트
src/demo.mjs          API 없는 고정 예제와 후속 답변
public/              한국어 반응형 화면
tests/               도메인 및 HTTP API 테스트
scripts/             문법 검사와 실제 API 검증
data/                로컬 SQLite (Git 제외)
.artifacts/          검증 결과·화면 캡처 (Git 제외)
```

상담은 JSON 문서 단위로 SQLite에 저장합니다. `messages`가 근거 원문이며, `questions`·`promises`·`history`·`drafts`를 함께 보관합니다. 원문 메시지는 분석 뒤 편집하지 않으며 잘못 입력했다면 검토 화면에서 수정하거나 새 상담으로 다시 등록합니다. 질문 제목과 판정은 상세 화면에서 수정할 수 있습니다.

## 오류와 상태 처리

- 추가 메시지 저장과 분석을 분리합니다. API 실패 시 새 원문과 이전 분석이 남고 `새 답변 분석`으로 재시도합니다.
- 검증되지 않은 답변 인용은 `확인 필요`, 원문에 없는 새 질문·약속은 제외와 경고로 처리합니다. 기존 질문·약속은 AI가 누락해도 삭제하지 않습니다.
- 사용자가 직접 수정한 상태는 재분석 후에도 유지하고 최신 AI 제안을 별도로 표시합니다. `AI 제안 적용`으로 되돌릴 수 있습니다.
- 업체의 처리 안내만으로 사용자 확인 완료를 만들지 않습니다. 실제 확인 시각은 사용자 액션으로만 저장합니다.
- 새 메시지·분석·판정 수정·처리 확인 시 이전 초안을 비웁니다. 입력 사실이 달라진 초안을 재사용하지 않도록 합니다.
- 같은 버전에서 시작한 AI 결과라도 중간에 다른 수정이 저장되면 HTTP 409로 거절합니다. 화면은 최신 기록을 다시 읽습니다.
- 현재 기한 계산은 연도까지 명시된 날짜, 기준 상담 날짜가 있는 오늘·내일·모레를 지원합니다. 영업일·불명확한 표현은 자동 계산하지 않습니다. 한국 시간 기준으로 날짜를 계산합니다.

## 입력과 보관 범위

상담당 최대 60개 메시지, 메시지당 6,000자, 합계 40,000자입니다. 붙여넣기 인식은 30,000자까지, 캡처는 PNG/JPEG/WebP 1장·4MB까지 지원합니다. 이미지 원본은 API에 전송한 뒤 보관하지 않고 검토한 전사 텍스트만 저장합니다. 음성 입력은 현재 구현하지 않았습니다.

데이터는 로컬 `data/replytrack.sqlite`에 저장됩니다. 백업할 때는 서버를 종료한 뒤 `data` 폴더를 복사합니다. 앱의 삭제는 원문·분석 기록을 삭제하며 복구 기능은 없습니다. Markdown 내보내기는 확인용 문서이며 복원 파일은 아닙니다. 초안 직접 편집 내용은 현재 화면에만 유지되므로 복사하거나 기록 저장을 사용합니다.

## 검증

```powershell
node scripts/check.mjs
node --test
```

실제 API 검증은 서버를 실행하고 키를 등록한 뒤 **명시적으로** 실행합니다. 가상 상담만 사용하지만 API 사용료가 발생합니다.

```powershell
node scripts/live-check.mjs
```

이 검증은 실제 AI 모드의 가상 상담 한 건을 생성합니다. 화면에서 결과를 검토할 수 있고 상세 결과는 `.artifacts/live-text-result.json`에 기록합니다. Windows에서 `./scripts/make-demo-image.ps1`로 가상 캡처를 만든 뒤 `node scripts/live-check.mjs --image`로 이미지 검증을 실행할 수 있습니다. `.artifacts/synthetic-chat.png`를 화면에 직접 업로드해도 됩니다. 자동 테스트는 실제 API를 호출하지 않습니다.

## 문제 해결

- `node`를 찾지 못함: Node.js 24 이상을 설치하고 터미널을 다시 엽니다.
- `EADDRINUSE`: 해당 포트를 사용 중인 기존 개발 서버를 확인하거나 `.env`의 PORT를 변경합니다.
- API 인증 오류: 키를 연결 설정에서 다시 등록합니다.
- 사용량·결제 한도 오류: OpenAI 프로젝트의 사용량·결제 설정을 확인합니다. 예제는 API 없이 실행 가능합니다.
- API 응답 시간 초과: 90초 제한입니다. 입력을 줄이거나 다시 분석합니다.
- 질문 누락·오인식: 인식 검토 화면과 원문을 대조합니다. 검증은 문자열·출처 확인 수준이며 의미 해석의 정확도를 보장하지 않습니다.
