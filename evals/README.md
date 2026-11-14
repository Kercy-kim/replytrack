# ReplyTrack 실제 AI 평가

## 고정한 평가 기준

`support-cases.mjs`는 실제 고객 정보가 없는 가상 한국어 상담 20건(배송 7, 환불 7, 구독 6)이다. 첫 API 호출 전에 입력과 기대 질문·상태·근거 메시지·약속·기한을 작성했다. 정답은 개발 에이전트가 작성했으며 외부 전문가/사용자가 검증한 정답은 아니다. 모델에는 입력 대화와 기존 분석만 전달하고 기대값은 전달하지 않는다.

초기 분석 20회와 새 답변 반영 3회(S06/R03/U04), 재문의 4회와 인계 3회를 실행한다. 초안 검토 추가 전에는 **30 API 호출**, 현재 구성에서는 생성+검토로 **보통 37회, 수정이 모두 필요하면 최대 51회**다. 사용자의 DB 대신 메모리 SQLite를 사용한다. 서비스의 `analyze`, `append`, `draft`와 실제 OpenAI Responses API를 호출한다. 예제 모드나 응답 fixture는 쓰지 않는다. 기본 모델은 앱과 동일한 `gpt-5-mini`, reasoning effort는 분석·생성 `low`, 초안 검토만 `medium`이다. 평가 정답 채점은 코드로 하며, 제품 내부의 초안 검토 호출을 정답 채점기로 사용하지 않는다.

- 질문 추출: 원문 메시지와 주제 표현으로 일대일 대응한다. 대응이 모호하면 통과시키지 않고 검토 대상으로 기록한다. 누락과 추가 항목을 따로 확인한다.
- 상태: 5개 상태의 정답과 정확히 일치해야 한다. 미해결 정답을 `answered`로 표시한 횟수는 별도 집계한다. `answered`는 답변을 받았다는 뜻이며 실제 처리가 완료됐다는 뜻이 아니다.
- 근거: 요구된 답변 메시지가 모두 인용됐는지와 모든 인용이 원문에 존재하는지 자동 검사한다. 내용상 관련성은 저장된 결과를 읽어 별도로 검토한다.
- 약속: 수행 행동, promised/reported, 기한 표현, 계산된 날짜, AI의 사용자 확인 금지 여부를 검사한다. 일반 정책은 개별 약속으로 만들지 않는다.
- 추가 답변: 기존 질문·약속 ID 유지, 최신 답변과 철회/완료 반영을 확인한다. 기한을 명시적으로 철회한 경우는 미정으로 바꾸지만 단순한 완료 통보는 과거 약속 기한을 보존한다.
- 초안 7건: 서버 검증 외에 남은 질문 집중, 사실/숫자 생성 여부, 답변받은 질문 반복, 약속과 완료 구분을 개발 에이전트가 원문과 직접 대조해 결과 보고서에 기록한다. 외부 사람의 검수가 아니며 문장 자연스러움은 자동 점수에 포함하지 않는다.

케이스 통과는 모든 분석 단계의 자동 기준을 통과해야 한다. 초안 검토는 별도 지표다. API 실패는 품질 성공으로 세지 않으며 중단/실패 수와 평가 가능한 분모를 함께 표시한다. 같은 데이터로 수정한 후 재평가하므로 결과는 회귀 평가이며 독립적인 일반화 성능이 아니다. 실제 상담, OCR/음성, 사용자 효용, 반복 실행 변동성, 다른 모델과의 비용 비교는 이번 범위 밖이다.

## 재실행

Node.js 24 이상에서 로컬 `.env`에 `OPENAI_API_KEY`를 설정한 뒤 실행한다. 실제 API 요금이 발생한다. 키는 결과 파일에 기록되지 않는다.

```powershell
node --env-file=.env scripts/evaluate-ai.mjs --out .artifacts/eval/new-run.json
node --env-file=.env scripts/evaluate-ai.mjs --only R03 --out .artifacts/eval/r03.json
node scripts/evaluate-ai.mjs --rescore evals/results/baseline.json
node --env-file=.env scripts/evaluate-ai.mjs --only draft-probes --out .artifacts/eval/probes.json
node --env-file=.env scripts/evaluate-ai.mjs --suite all --analysis-only --out .artifacts/eval/status-boundaries.json
```

`draft-probes`는 저장된 실제 실패 출력 3개(질문 누락, 담당자 추정, 상담원 관점)를 현재 제품의 검토 AI에 다시 넣는 부정 사례 검사다. 새로운 상담 3건이나 초안 생성 3건으로 세지 않는다. 응답은 실제 API로 받으며 `valid=false`여야 통과한다. 다른 평가 모드와 결과 형식이 다르므로 `--rescore` 대상은 아니다.

상태 기준 후속 평가는 `--suite support`(원래 20건, 기본값), `--suite boundary`(추가 경계 8건), `--suite all`(28건)을 지원한다. `--analysis-only`는 변경 대상인 분석만 평가하며 초안을 생성하지 않는다. 전체 28건은 후속 답변을 포함해 31회 분석 호출이다. 원래 정답은 수정하지 않았고 추가 자료는 `status-boundary-cases.mjs`에 별도 보관한다. Interactive JSON에서도 `suite`, `analysisOnly`를 사용할 수 있다.

실행 중 각 케이스 결과를 저장하며 기존 결과 파일은 덮어쓰지 않는다. API 오류 자동 재시도는 하지 않으며 제품의 초안 수정만 한 번 허용한다. 동시 요청은 최대 2개다. 결과에는 데이터/프롬프트/스키마/구현의 SHA-256, 기반 커밋, 실제 반환 모델, 토큰 수, 호출 지연 시간, 구조화된 원본 출력, 검증 후 기록이 들어간다. 실패한 중간 구성도 `results/iteration-*.json`에 보존한다. 저장된 대화와 AI 출력도 공개 전에 검토해야 한다. 실제 사용자 대화로 데이터셋을 교체한 경우 결과를 커밋하면 안 된다.

키를 파일에 두지 않는 실행은 `--key-stdin`을 사용한다. `--interactive`를 함께 쓰면 숨겨진 stdin으로 `{"out":".artifacts/eval/after.json"}`을 입력해 변경된 코드로 재실행할 수 있다. 각 실행은 새 프로세스에서 현재 서비스 코드를 불러온다. 종료는 `quit`이다.

설계 참고: [OpenAI 평가 가이드](https://developers.openai.com/api/docs/guides/evaluation-best-practices)의 과제별 기준 설정, 경계 사례 포함, 자동 점수와 사람의 검토 결합 원칙을 적용했다. 이 저장소의 구체적인 정답과 판정 기준은 프로젝트에서 정한 것이다.
