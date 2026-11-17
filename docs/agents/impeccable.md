# Impeccable — Codex 프로젝트 로컬 설치

설치일: 2026-11-14 (Asia/Seoul). 대상 저장소: `Kercy-kim/replytrack`.
스킬 버전: **4.9.0**. 자체 실행 엔진: **0.1.23**.

## 설치 방식과 보존 범위

[공식 README](https://github.com/pbakaus/impeccable#installation)의 Codex 프로젝트 로컬 설치를 적용했다.
일반 환경에서는 프로젝트 루트에서 다음 명령을 실행한다.

```powershell
npx impeccable install --providers=codex --scope=project --yes
```

설치 환경에는 Node.js만 있고 npm/npx가 없으므로, npm CLI가 호출하는 동일한 공식 Windows x64 엔진으로 위의 `install` 인자를 실행했다.
다운로드: [공식 engine-v0.1.23 릴리스](https://github.com/pbakaus/impeccable/releases/tag/engine-v0.1.23).
공식 `engine-checksums.txt`와 대조한 SHA-256:

```text
e1364f415a838e080f394604f496bfa7dcc178c9bce62af673d54f2b5cbcd33c
```

- `.agents/skills/impeccable/`: Codex용 통합 스킬, 명령별 참고 문서, 실행 스크립트와 배포된 보조 에이전트 정의.
- `.codex/hooks.json`: `PostToolUse`와 `Stop` 디자인 검사. Windows의 `commandWindows` 포함.
- `.gitattributes`: POSIX 실행 스크립트의 LF 줄바꿈을 유지한다. 해당 스크립트는 Git 실행 권한(`100755`)으로 공유한다.
- `.gitignore`: 기존 내용을 유지하고 공식 임시 파일 제외 목록 및 플랫폼별 엔진 제외 규칙을 추가.
- `docs/third-party/impeccable/`: 원본 Apache-2.0 라이선스와 NOTICE.

이 설치 작업에서는 전역 스킬/설정, 앱 소스, package.json, README와 기존 에이전트 설정을 변경하지 않았다.
`--force`는 사용하지 않았고, `.codex/config.toml`이나 hook 신뢰 기록을 생성·수정하지 않았다.
`PRODUCT.md`, `DESIGN.md`와 디자인 설정은 초기화 명령을 실행할 때 작성한다.

## 사용자 승인과 첫 사용

1. 다음 턴에서 `$impeccable`을 사용한다. 목록에 보이지 않으면 Codex를 다시 열거나 프로젝트의 새 채팅을 시작한다. CLI에서는 `/skills`로 확인할 수 있다.
2. **Codex 앱 Settings → Hooks** 또는 **Codex CLI `/hooks`**에서 이 프로젝트의 `.codex/hooks.json`을 연다.
3. `.agents/skills/impeccable/scripts/impeccable.cmd`를 실행하는 **PostToolUse / Stop 두 정의를 검토하고 신뢰 승인**한다. 프로젝트 신뢰 요청이 표시되면 프로젝트도 확인한다.
4. Codex 채팅에서 `$impeccable hooks status`와 `$impeccable doctor`로 설치 상태를 확인한다.
5. 프로젝트 맥락을 설정하려면 `$impeccable init`, 기존 시각 규칙을 기록하려면 `$impeccable document`를 실행한다.

**설치 완료와 Codex의 신뢰 승인은 별개다.** 설치 검증 시 Impeccable은 enabled / wired였지만, Codex의 실제 자동 호출은 사용자의 승인 후 시작된다.
새 hook 또는 변경된 hook 정의는 다시 승인해야 한다. 신뢰 우회 옵션은 사용하지 않는다.
이는 [Impeccable hook 안내](https://impeccable.style/docs/hooks/) 및 [OpenAI 공식 hook 문서](https://learn.chatgpt.com/docs/hooks)의 요구사항이다.

현재 PC의 엔진은 스킬 폴더에 설치되어 있다. 새 PC에서 처음 실행할 때는 해당 플랫폼 엔진을 GitHub에서 다운로드하고 체크섬을 확인하므로 네트워크와 사용자 캐시 `~/.impeccable/bin/` 쓰기 권한이 필요할 수 있다.
업데이트에도 네트워크 및 프로젝트의 `.agents`/`.codex` 쓰기 권한이 필요하다. 권한 요청이 표시되면 다운로드 주소와 변경 대상을 확인한다.

## Codex 채팅 명령

아래의 `$impeccable` 명령은 **채팅 입력창**에 입력한다. PowerShell 변수나 `/impeccable` 슬래시 명령으로 실행하지 않는다.

| 목적 | 명령 (`$impeccable` 뒤에 입력) |
| --- | --- |
| 시작·설계 | `init`, `document`, `shape <대상>`, `extract <대상>` |
| 검토 | `critique <대상>`, `audit <대상>` |
| 시각 조정 | `bolder`, `quieter`, `distill`, `colorize`, `typeset`, `layout`, `animate`, `delight`, `overdrive` + 대상 |
| 완성도·사용성 | `polish`, `harden`, `clarify`, `adapt`, `optimize`, `onboard` + 대상 |
| 브라우저 반복 작업 | `live`, `generate <요청>` |
| 유지 관리 | `doctor`, `hooks status`, `hooks on`, `hooks off`, `pin audit`, `unpin audit` |

공식 README의 24개 디자인 명령 중 `craft`는 일반 새 UI 제작 요청의 폐기 예정 별칭이다. `$impeccable`만 입력하면 안내 메뉴를 볼 수 있다.
명령을 pin하면 `$audit` 같은 독립 단축 스킬을 추가할 수 있다. 이번 설치에서는 별도 단축 스킬을 만들지 않았다.

예:

```text
$impeccable critique 상담 상세 화면
$impeccable audit public/
$impeccable polish 질문 카드
$impeccable hooks status
```

`live`의 Apply에는 공식 README에 명시된 별도 실행 동작이 있다. 최근에 채팅 에이전트가 polling하지 않았다면 로컬 CLI를 승인·sandbox 우회 모드로 실행할 수 있다.
이를 피하려면 live를 시작하는 환경에서 `IMPECCABLE_LIVE_COPY_AGENT=chat`(현재 채팅만 사용) 또는 `off`(Apply 끄기)를 지정한다. 이번 설치에서는 live를 실행하지 않았다.

## 터미널 명령 (npm/npx 없이 사용)

프로젝트 루트의 PowerShell에서 실행한다.

```powershell
& .\.agents\skills\impeccable\scripts\impeccable.cmd --version
& .\.agents\skills\impeccable\scripts\impeccable.cmd hooks status
& .\.agents\skills\impeccable\scripts\impeccable.cmd doctor --json
& .\.agents\skills\impeccable\scripts\impeccable.cmd detect public/
& .\.agents\skills\impeccable\scripts\impeccable.cmd detect --json public/
& .\.agents\skills\impeccable\scripts\impeccable.cmd detect --list-rules
& .\.agents\skills\impeccable\scripts\impeccable.cmd update --scope=project --yes
```

통상 환경에서는 같은 인자를 `npx impeccable` 뒤에 붙일 수 있다.
검사 종료 코드: `0` = 발견 없음, `2` = 발견 있음, `1` = 검사 대상 처리 실패.
소스 검사는 패턴을 검사하며, 대비·글자 크기처럼 렌더링이 필요한 검사는 실행 중인 개발 서버 URL을 `detect` 대상으로 지정한다.
공식 hook은 프로젝트 루트 기준 상대 경로이므로 Codex를 이 저장소 루트에서 실행한다.

## 검증 결과

- 설치된 엔진의 SHA-256과 버전 일치.
- `hooks status`: enabled, Codex (`.agents`) wired.
- `doctor --json`: `findings: []`.
- 설치된 `commandWindows`를 직접 실행하는 테스트: PostToolUse에서 `gradient-text`, Stop에서 `overused-font`를 검출. 반복 Stop에서는 중복 출력 없음.
- 이 테스트는 hook 프로그램의 동작 확인이며 Codex의 신뢰 승인 또는 실제 lifecycle 자동 호출 검증을 대신하지 않는다.
- 설치 시점 `detect --json public/`: 경고 3건 (`overused-font` 2건, `dark-glow` 1건), 종료 코드 2. 기존 UI는 수정하지 않았다.
- 테스트 출력과 보존 확인용 해시는 Git에서 제외되는 `.artifacts/impeccable-setup/`에 저장했다.
- 최종 대조에서 설치 작업 외의 `server.mjs`, `src/domain.mjs` 변경과 추가 개발 파일이 확인됐다. 해당 동시 작업은 수정하거나 되돌리지 않았다.

## Git에 포함할 파일

설치 단계에서는 커밋하지 않았으며, 공유 시 아래 파일을 함께 관리한다.

```powershell
git add -- .gitattributes .gitignore .agents/skills/impeccable .codex/hooks.json .impeccable/config.json .impeccable/design.json PRODUCT.md DESIGN.md docs/agents/impeccable.md docs/third-party/impeccable
git update-index --chmod=+x .agents/skills/impeccable/scripts/impeccable
```

- 포함: 스킬의 `SKILL.md`, `reference/`, `agents/`, `scripts/`의 텍스트·JavaScript·체크섬·버전 파일, hook 정의, 설치 문서, 라이선스/NOTICE, `.gitignore`.
- 제외: `scripts/bin/`의 플랫폼별 실행 파일(Windows 엔진 약 22 MB), `.artifacts/`, `.impeccable/config.local.json`, hook 캐시/대기 상태, 스크린샷과 live 실행 상태. Codex의 개인별 신뢰 승인은 Git으로 공유하지 않는다.
- 나중에 생성되면 포함: `PRODUCT.md`, `DESIGN.md`, `.impeccable/config.json`, `.impeccable/live/config.json`, `.impeccable/design.json`, `.impeccable/surfaces/*.md`, `.impeccable/critique/*.md`.
- 기존 미커밋 작업이 있었으므로 `git add .` 대신 위 경로를 지정하고, 기존 `.gitignore` 내용도 함께 검토한다.

## 공식 출처

- [Impeccable README](https://github.com/pbakaus/impeccable)
- [자동 디자인 검사와 승인](https://impeccable.style/docs/hooks/)
- [OpenAI 프로젝트 스킬 위치](https://learn.chatgpt.com/docs/build-skills)
- [OpenAI hook 검색·신뢰 방식](https://learn.chatgpt.com/docs/hooks)
- [설치 코드의 Codex 경로 매핑](https://github.com/pbakaus/impeccable/blob/main/crates/skills/src/providers.rs)
