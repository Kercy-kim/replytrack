# Chrome side panel

- Target: `extension/sidepanel.html`
- Mode: Operate
- Scope: existing ReplyTrack design extended into the user-requested Chrome side panel.

## Direction contract

THESIS: 선택한 고객센터 대화를 질문별 확인표로 바꾸고, 같은 패널에서 재문의 초안을 준비한다. 웹의 기록 관리와 AI 연결 설정을 재사용한다.

OWN-WORLD: 기존 DESIGN.md의 딥 그린, 페이퍼 화이트, 흰 작업면과 한국어 상태 용어를 유지한다. 일반 질문 카드는 얇은 경계선과 원문 펼치기를 사용한다. 새 시각 체계를 만들지 않는다.

STORY: 선택 대화 가져오기 → 전송 전 원문 편집 → 발화자 검토 → 질문 상태·근거 확인 → 질문 선택 → 초안 편집·복사. 실패 시 복구할 다음 행동을 표시한다. 새 선택은 편집 내용을 자동으로 덮어쓰지 않는다.

FIRST VIEWPORT: 320~480px 패널 상단에 브랜드·웹 링크·연결 상태, 아래에 작업 제목과 선택 대화 입력이 온다. 분석 후에는 상담 제목과 첫 질문의 상태·근거가 보인다. 원문 확인과 재문의는 세로로 이어진다.

FORM: narrowly specified extension of the established task surface; seed: none (pinned). 사용자 범위: “선택한 대화를 가져와서 옆 패널에 분석 결과랑 재문의 초안 보여주는 기능”. 기존 웹 디자인을 보존하며 입력·검토·결과의 세 단계로 구성한다.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

기존 DESIGN.md와 .impeccable/design.json은 유지한다. 새 래스터 자산은 사용하지 않는다. 기능 검증에는 실제 확장 로딩과 별도로 명시한 결정적 AI 테스트 응답을 사용한다.
