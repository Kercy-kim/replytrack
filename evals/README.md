# ReplyTrack 실제 AI 평가

## 고정한 평가 기준

`support-cases.mjs`는 실제 고객 정보가 없는 가상 한국어 상담 20건(배송 7, 환불 7, 구독 6)이다. 첫 API 호출 전에 입력과 기대 질문·상태·근거 메시지·약속·기한을 작성했다. 정답은 개발 에이전트가 작성했으며 외부 전문가/사용자가 검증한 정답은 아니다. 모델에는 입력 대화와 기존 분석만 전달하고 기대값은 전달하지 않는다.

초기 분석 20회와 새 답변 반영 3회(S06/R03/U04), 재문의 4회와 인계 3회를 실행한다. 초안 검토 추가 전에는 **30 API 호출**, 현재 구성의 기본 호출은 분석 23회와 초안 생성·검토 14회로 37회다. 확인 필요 질문의 경계 검토, 인용 수정, 초안 수정이 있으면 추가되며 모두 필요한 이론적 최대는 97회다. 실제 호출 수를 실행별로 기록한다. 사용자의 DB 대신 메모리 SQLite를 사용한다. 서비스의 `analyze`, `append`, `draft`와 실제 OpenAI Responses API를 호출한다. 예제 모드나 응답 fixture는 쓰지 않는다. 기본 모델은 앱과 동일한 `gpt-5-mini`다. 이전 품질 개선까지는 reasoning effort가 분석·모든 초안 생성·검토에서 `medium`이었다. 현재 최적화 설정은 아래 재실행 절을 따른다. 초기 보고서의 분석·생성 `low`와 구분하며 각 실제 호출의 설정과 토큰 수를 결과에 보존한다. 평가 정답 채점은 코드로 하며, 제품 내부의 초안 검토 호출을 정답 채점기로 사용하지 않는다.

- 질문 추출: 원문 메시지와 주제 표현으로 일대일 대응한다. 대응이 모호하면 통과시키지 않고 검토 대상으로 기록한다. 누락과 추가 항목을 따로 확인한다.
- 상태: 5개 상태의 정답과 정확히 일치해야 한다. 미해결 정답을 `answered`로 표시한 횟수는 별도 집계한다. `answered`는 답변을 받았다는 뜻이며 실제 처리가 완료됐다는 뜻이 아니다.
- 근거: 요구된 답변 메시지가 모두 인용됐는지와 모든 인용이 원문에 존재하는지 자동 검사한다. 내용상 관련성은 저장된 결과를 읽어 별도로 검토한다.
- 약속: 수행 행동, promised/reported, 기한 표현, 계산된 날짜, AI의 사용자 확인 금지 여부를 검사한다. 일반 정책은 개별 약속으로 만들지 않는다.
- 추가 답변: 기존 질문·약속 ID 유지, 최신 답변과 철회/완료 반영을 확인한다. 기한을 명시적으로 철회한 경우는 미정으로 바꾸지만 단순한 완료 통보는 과거 약속 기한을 보존한다.
- 초안 7건: 서버 검증 외에 남은 질문 집중, 사실/숫자 생성 여부, 답변받은 질문 반복, 약속과 완료 구분을 개발 에이전트가 원문과 직접 대조해 결과 보고서에 기록한다. 외부 사람의 검수가 아니며 문장 자연스러움은 자동 점수에 포함하지 않는다.

케이스 통과는 모든 분석 단계의 자동 기준을 통과해야 한다. 초안 검토는 별도 지표다. API 실패는 품질 성공으로 세지 않으며 중단/실패 수와 평가 가능한 분모를 함께 표시한다. 같은 데이터로 수정한 후 재평가하므로 결과는 회귀 평가이며 독립적인 일반화 성능이 아니다. 실제 상담, OCR/음성, 사용자 효용, 반복 실행 변동성, 다른 모델과의 비용 비교는 이번 범위 밖이다.

## 재실행

현재 추론 설정은 분석·경계 검토·모든 초안 의미 검토와 수정에서 `medium`, 재문의와 인계의 첫 생성에서 `low`다. 인계에는 별도 생성 지침과 추가 검토 기준을 적용한다. 위 초기 평가의 설정과 달라졌으며, 변경 근거는 [성능 최적화 보고서](../docs/AI-PERFORMANCE.md), [인계 지연 개선 보고서](../docs/HANDOFF-PERFORMANCE.md), [ADR 0009](../docs/adr/0009-handoff-specific-generation.md)에 있다.

Node.js 24 이상에서 로컬 `.env`에 `OPENAI_API_KEY`를 설정한 뒤 실행한다. 실제 API 요금이 발생한다. 키는 결과 파일에 기록되지 않는다.

```powershell
node --env-file=.env scripts/evaluate-ai.mjs --out .artifacts/eval/new-run.json
node --env-file=.env scripts/evaluate-ai.mjs --only R03 --out .artifacts/eval/r03.json
node scripts/evaluate-ai.mjs --rescore evals/results/baseline.json
node --env-file=.env scripts/evaluate-ai.mjs --only draft-probes --out .artifacts/eval/probes.json
node --env-file=.env scripts/evaluate-ai.mjs --suite all --analysis-only --out .artifacts/eval/status-boundaries.json
node --env-file=.env scripts/evaluate-ai.mjs --suite unseen --out .artifacts/eval/unseen-new-run.json
```

성능을 비교할 때는 모델 별칭 대신 동일한 모델 버전을 지정한다. 토큰 절감은 API가 보고한 전체 입력+출력 사용량이며 캐시 입력과 추론 출력도 포함한다. 분석·초안 각각의 `operations`에는 수정·검토·저장까지의 서비스 완료 시간과 실패 여부가 들어간다. UI 렌더링이나 텍스트·이미지 전사 시간은 측정하지 않는다.

```powershell
node --env-file=.env scripts/evaluate-ai.mjs --suite unseen --model gpt-5-mini-2025-08-07 --out .artifacts/eval/benchmark.json
node scripts/compare-evaluations.mjs evals/results/performance/baseline.json evals/results/performance/optimized.json
```

비교 도구는 모델·자료·채점기·케이스·분석/초안 실행 범위가 다르면 거절한다. 이전에 맞았던 질문 상태·근거·약속 또는 생성 가능한 초안이 퇴행하면 실패하며, 토큰 집계가 없는 API 호출이 있으면 절감률을 계산하지 않는다. 초안 의미는 자동 비교만으로 보증하지 않으므로 원문 대조를 별도로 수행한다. `performance/*.json`에는 같은 20건의 최적화 전후, 채택하지 않은 후보, 28건 회귀·마지막 오류 재검사·7건 검토 대조 결과를 보관한다.

`draft-probes`는 저장된 실제 실패 출력(질문 누락, 담당자 추정, 상담원 관점, 안내 순서 왜곡, 비용 차감 전제) 5개와 올바른 인계 2개를 현재 제품의 검토 AI에 다시 넣는 대조 검사다. 정상 출력에는 중간 실행에서 검토 AI가 과도하게 거절했던 초안도 포함한다. 새로운 상담이나 초안 생성으로 세지 않는다. 실제 API 응답이 실패 출력에서는 `valid=false`, 정상 출력에서는 `valid=true`여야 통과한다. 다른 평가 모드와 결과 형식이 다르므로 `--rescore` 대상은 아니다.

상태 기준 후속 평가는 `--suite support`(원래 20건, 기본값), `--suite boundary`(추가 경계 8건), `--suite all`(28건)을 지원한다. `--analysis-only`는 변경 대상인 분석만 평가하며 초안을 생성하지 않는다. 전체 28건은 후속 답변을 포함해 31개 분석 단계이며 수정·경계 검토 호출은 별도로 더해진다. 원래 정답은 수정하지 않았고 추가 자료는 `status-boundary-cases.mjs`에 별도 보관한다. Interactive JSON에서도 `suite`, `analysisOnly`를 사용할 수 있다.

`--suite unseen`은 기존 입력을 재사용하지 않은 배송 7·환불 7·구독 6건을 선택한다. `unseen-cases.mjs`의 입력과 정답을 최초 호출 전에 고정했고, 상담 20건에서 분석 24회(후속 답변 4회 포함), 질문 상태 32회, 약속 8회, 재문의 3건·인계 3건을 평가한다. `all`은 과거 보고서의 재채점 호환성을 위해 기존 28건을 그대로 뜻한다. **unseen이라는 이름은 최초 실행 때 미사용이었다는 뜻이다.** 첫 결과를 본 뒤 수정한 실행은 같은 자료에 대한 회귀 평가로 구분한다. 사람이 수집·독립 검수한 실사용 자료는 아니다.

실행 중 각 케이스 결과를 저장하며 기존 결과 파일은 덮어쓰지 않는다. API 오류 자동 재시도는 하지 않으며 제품의 초안 수정과 분석 인용·상태/근거 모순 수정을 각각 한 번 허용하고, 근거가 있는 확인 필요 질문에는 경계 검토를 한 번만 적용한다. 동시 요청은 최대 2개다. 결과에는 데이터/프롬프트/스키마/구현의 SHA-256, 기반 커밋, 실제 반환 모델, 토큰 수, 호출 지연 시간, 구조화된 원본 출력, 검증 후 기록이 들어간다. 실패한 중간 구성도 `results/`에 보존한다. 저장된 대화와 AI 출력도 공개 전에 검토해야 한다. 실제 사용자 대화로 데이터셋을 교체한 경우 결과를 커밋하면 안 된다.

새 20건의 `results/unseen/final.json`은 동일한 제품 소스 해시로 실행한 초안 사례 6건과 나머지 14건을 모두 합친 결과다. 원본 두 파일의 해시·ID 목록을 함께 보존한다. 이후의 좁은 수정 및 재평가는 별도 파일로 남기며, 최종 코드와 당시 집계의 파일 해시 차이·오프라인 재검증 범위는 [평가 보고서](../docs/UNSEEN-EVALUATION.md)에 설명한다. 처음 사용한 자료의 성능과 수정 후 회귀 성능을 혼동하지 않는다.

키를 파일에 두지 않는 실행은 `--key-stdin`을 사용한다. `--interactive`를 함께 쓰면 숨겨진 stdin으로 `{"out":".artifacts/eval/after.json"}`을 입력해 변경된 코드로 재실행할 수 있다. 각 실행은 새 프로세스에서 현재 서비스 코드를 불러온다. 종료는 `quit`이다.

설계 참고: [OpenAI 평가 가이드](https://developers.openai.com/api/docs/guides/evaluation-best-practices)의 과제별 기준 설정, 경계 사례 포함, 자동 점수와 사람의 검토 결합 원칙을 적용했다. 이 저장소의 구체적인 정답과 판정 기준은 프로젝트에서 정한 것이다.

## 인계 응답 시간 전후 비교

`handoff-cases.json`은 API 호출 전에 고정한 12개 분석 기록이다. 기존 6개를 두 번, 새 합성 기록 6개를 한 번씩 실행해 총 18쌍을 비교한다. 분석 정확도는 재측정하지 않는다. 기준 main `1309bb1`과 현재 코드에 동일한 원문·질문·약속·ID를 제공한다. 같은 모델 버전으로 쌍마다 전후 순서를 번갈아 실행하며 작업자는 2개다. 기준 소스는 Git에서 `.artifacts/handoff-baseline`에 복원한다.

```powershell
node scripts/prepare-handoff-eval.mjs
node --env-file=.env scripts/evaluate-handoff.mjs --out .artifacts/eval/handoff-new.json
node scripts/compare-handoff.mjs .artifacts/eval/handoff-new.json
node --env-file=.env scripts/evaluate-handoff.mjs --only review-probes --out .artifacts/eval/handoff-review-new.json
```

생성·검증·검토·수정·저장을 포함한 완료 시간을 비교하고 실패 시간도 남긴다. 누락된 사용량이 있으면 전체 토큰 절감률은 계산하지 않는다. 비교 도구는 소스·자료·평가 코드 해시 불일치, 누락·중복·다른 모델을 거절한다. 현재 구현이 실패하면 종료 코드 1이며, 실행 성공과 별도로 모든 본문을 원문 및 고정 기준에 대조해야 한다. `--variant current`는 개선안만 실행하는 진단용이며 전후 비교 도구 입력으로 사용할 수 없다.

`results/handoff/`에는 채택하지 않은 후보, 최종 전체 비교, 정상·오류 초안 검토 대조를 보관한다. `handoff-review-probes.json`의 9개 대조는 후보의 오류 5개와 정상 4개를 검사하며 생성 성능의 분모에 더하지 않는다. 각 정답은 검토 API 호출 전에 고정했다. 이전 `draft-probes` 7개도 실제 제품의 초안 종류에 맞는 검토 지침으로 실행한다. 모델의 내부 검토 통과만으로 독립적인 품질 점수를 주장하지 않는다. [인계 보고서](../docs/HANDOFF-PERFORMANCE.md)에 실제 측정과 원문 대조를 기록한다.

## 50초 초과 인계 후속 비교

`--suite tail`은 기준 main `67b8e5a`와 `handoff-tail-cases.json`을 사용한다. 이전과 같은 12개 기록에서 R03 6회, NR05 4회, 나머지 각 1회로 전후 20쌍이다. 새로운 상담 20개가 아니다. 별도 `--only repair-probes`는 보존한 실패 초안 4개를 각 2회 재생해 **수정·최종 검토만** 전후 8쌍 비교한다. 첫 실패 생성·검토는 재생값이며 시간·토큰에 넣지 않는다. 서버가 거절한 내부 ID 초안에는 가짜 검토 실패를 재생하지 않는다. 개선안에서 코드로 표기를 정리한 결과도 실제 AI 검토를 받는다.

```powershell
node scripts/prepare-handoff-tail-eval.mjs
node --env-file=.env scripts/evaluate-handoff.mjs --suite tail --out .artifacts/eval/tail-new.json
node scripts/compare-handoff.mjs .artifacts/eval/tail-new.json
node --env-file=.env scripts/evaluate-handoff.mjs --suite tail --only repair-probes --out .artifacts/eval/repair-new.json
node scripts/compare-handoff.mjs .artifacts/eval/repair-new.json
```

비교 도구는 suite·mode가 다른 전체 생성/수정 재생의 혼합을 거절한다. 실패 시간도 포함한 50초 초과 횟수를 집계한다. 최종 기록은 `results/handoff-tail/full.json`, 수정 재생은 `repairs.json`, 제외한 low 수정 후보는 `rejected-low-repairs.json`이다. 각 최종 집계는 `full-comparison.json`, `repair-comparison.json`에 보관했다. 실제 모델 버전·소스·평가 코드·자료 해시와 각 호출의 시도 번호·추론량·사용량을 남긴다. [후속 보고서](../docs/HANDOFF-TAIL-PERFORMANCE.md)에 전체 생성 20/20회와 수정 8/8회의 원문 대조, 느려진 쌍, 실패를 포함한 한계를 기록했다.
