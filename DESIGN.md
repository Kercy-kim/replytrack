---
name: "ReplyTrack"
description: "차분한 상담 기록장 — 친근하고 정돈된 작업 공간"
colors:
  deep-green: "#1e4a3d"
  deep-green-hover: "#163c31"
  paper-white: "#f7f8f5"
  surface-white: "#fff"
  ink: "#23352f"
  line: "#e5e9e3"
  soft-green: "#f0f5e8"
  nav-hover: "#f5f7f0"
  supporting-ink: "#536958"
  promise-ink: "#705f3a"
  evidence-ink: "#536958"
  evidence-surface: "#f7f9f3"
  field-border: "#d9dfd7"
  focus-action: "#88ad66"
  focus-field: "#82a78c"
  waiting-surface: "#fbf1e0"
  waiting-ink: "#795a1d"
  answered-surface: "#edf4e5"
  answered-ink: "#3f5d39"
  unanswered-surface: "#faeee8"
  unanswered-ink: "#8a4935"
  partial-surface: "#eef1f9"
  partial-ink: "#425a85"
  review-surface: "#f3edf7"
  review-ink: "#6c4780"
  promise-surface: "#fdfdf8"
  danger: "#aa463d"
typography:
  display:
    fontFamily: "Inter, \"Pretendard\", \"Segoe UI\", \"Malgun Gothic\", sans-serif"
    fontWeight: 750
    lineHeight: 1.5
    letterSpacing: "-2px"
  headline:
    fontFamily: "Inter, \"Pretendard\", \"Segoe UI\", \"Malgun Gothic\", sans-serif"
    fontSize: "27px"
    fontWeight: 700
    lineHeight: 1.6
    letterSpacing: "-1px"
  title:
    fontFamily: "Inter, \"Pretendard\", \"Segoe UI\", \"Malgun Gothic\", sans-serif"
    fontSize: "14px"
    fontWeight: 650
    lineHeight: 1.6
    letterSpacing: "-0.2px"
  body:
    fontFamily: "Inter, \"Pretendard\", \"Segoe UI\", \"Malgun Gothic\", sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
  supporting:
    fontFamily: "Inter, \"Pretendard\", \"Segoe UI\", \"Malgun Gothic\", sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.8
  evidence:
    fontFamily: "Inter, \"Pretendard\", \"Segoe UI\", \"Malgun Gothic\", sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.8
  control:
    fontFamily: "Inter, \"Pretendard\", \"Segoe UI\", \"Malgun Gothic\", sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.4
  badge:
    fontFamily: "Inter, \"Pretendard\", \"Segoe UI\", \"Malgun Gothic\", sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.5
  dialog:
    fontFamily: "Inter, \"Pretendard\", \"Segoe UI\", \"Malgun Gothic\", sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.6
    letterSpacing: "-0.8px"
  eyebrow:
    fontFamily: "Inter, \"Pretendard\", \"Segoe UI\", \"Malgun Gothic\", sans-serif"
    fontSize: "10px"
    fontWeight: 700
    lineHeight: 1.6
    letterSpacing: "1.7px"
rounded:
  badge: "5px"
  evidence: "7px"
  control: "9px"
  navigation: "10px"
  card: "11px"
  metric: "12px"
  panel: "13px"
  showcase: "16px"
  dialog: "19px"
spacing:
  small-gap: "8px"
  control-gap: "9px"
  field-inline: "12px"
  card-block: "18px"
  card-inline: "20px"
  section: "24px"
  workspace-gap: "25px"
  page-inline: "40px"
components:
  button-primary:
    backgroundColor: "{colors.deep-green}"
    textColor: "{colors.surface-white}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "12px 17px"
  button-primary-hover:
    backgroundColor: "{colors.deep-green-hover}"
  button-secondary:
    backgroundColor: "{colors.surface-white}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "12px 17px"
  button-secondary-hover:
    backgroundColor: "#f5f8f2"
  button-text:
    backgroundColor: "transparent"
    textColor: "{colors.deep-green}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "5px 0"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.surface-white}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "12px 17px"
  field:
    backgroundColor: "{colors.surface-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "11px 12px"
  navigation-item:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.navigation}"
    padding: "15px 11px"
  navigation-item-active:
    backgroundColor: "{colors.soft-green}"
  navigation-item-hover:
    backgroundColor: "{colors.nav-hover}"
  question-card:
    backgroundColor: "{colors.surface-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "18px 20px"
  evidence-link:
    backgroundColor: "{colors.evidence-surface}"
    textColor: "{colors.evidence-ink}"
    typography: "{typography.evidence}"
    rounded: "{rounded.evidence}"
    padding: "10px 12px"
  promise-card:
    backgroundColor: "{colors.promise-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "17px 19px"
  badge-waiting:
    backgroundColor: "{colors.waiting-surface}"
    textColor: "{colors.waiting-ink}"
    typography: "{typography.badge}"
    rounded: "{rounded.badge}"
    padding: "4px 7px"
  badge-answered:
    backgroundColor: "{colors.answered-surface}"
    textColor: "{colors.answered-ink}"
    typography: "{typography.badge}"
    rounded: "{rounded.badge}"
    padding: "4px 7px"
  badge-unanswered:
    backgroundColor: "{colors.unanswered-surface}"
    textColor: "{colors.unanswered-ink}"
    typography: "{typography.badge}"
    rounded: "{rounded.badge}"
    padding: "4px 7px"
  badge-partial:
    backgroundColor: "{colors.partial-surface}"
    textColor: "{colors.partial-ink}"
    typography: "{typography.badge}"
    rounded: "{rounded.badge}"
    padding: "4px 7px"
  badge-review:
    backgroundColor: "{colors.review-surface}"
    textColor: "{colors.review-ink}"
    typography: "{typography.badge}"
    rounded: "{rounded.badge}"
    padding: "4px 7px"
---

# Design System: ReplyTrack

## Overview

**Creative North Star: "차분한 상담 기록장"**

ReplyTrack은 친근하고 정돈된 상담 작업 공간이다. 딥 그린의 주요 행동 버튼과 짙은 본문, 페이퍼 화이트 바탕, 소프트 그린의 선택 영역을 사용한다. 밝은 화면 위에서 얇은 경계선과 밝기 차이로 정보를 구분하며, 상태는 색상과 한국어 라벨을 함께 보여 준다.

컴포넌트는 부드럽고 실용적인 도구로 표현한다. 일상적인 카드와 패널은 평평하게 유지하고, 대화상자·알림에는 그림자를 더한다. 시작 화면의 기울어진 예제 카드와 말풍선은 현재 구현된 소개용 표현이며, 상담 작업 화면 전체의 배치 규칙으로 확대하지 않는다.

**Key Characteristics:**

- 밝은 중성 바탕과 딥 그린 행동 버튼, 소프트 그린 선택 영역.
- 원문·질문·약속을 각각 구분하는 얇은 테두리와 둥근 모서리.
- 한국어 상태 라벨과 연결된 인용 문장으로 읽는 확인표.
- 데스크톱의 병렬 패널과 좁은 화면의 원문·분석 전환.
- 제한적인 그림자와 짧은 상태 전환, 모션 감소 설정 존중.

**기록 범위:** 2026-11-14의 기존 구현을 문서화했다. 사용자가 위의 중심 표현·색상 이름·깊이와 컴포넌트 표현을 확인했다. 디자인을 새로 만들거나 UI를 수정한 문서가 아니다. 제품 사실은 [PRODUCT.md](PRODUCT.md)를 따른다.

**근거:** [public/styles.css](public/styles.css), [public/app.js](public/app.js), [public/index.html](public/index.html), [public/favicon.svg](public/favicon.svg). 가상 데이터로 렌더링한 데스크톱과 390px 모바일의 상담 화면·입력 대화상자를 확인했다. YAML은 문서화된 토큰 값이며 구현의 최종 CSS 적용값에서 추출했다. 기존 클래스명·CSS 변수명은 바꾸지 않는다. 프런트매터 구조는 [DESIGN.md 포맷](https://raw.githubusercontent.com/google-labs-code/design.md/main/docs/spec.md)을 따른다.

## Colors

초록 계열을 주요 행동과 선택에 사용하고, 따뜻한 저채도 상태색을 밝은 작업면에 얹는다. 정확한 색상값은 프런트매터가 기준이다.

### Primary

- **딥 그린** (`colors.deep-green`): 기본 주요 버튼. hover는 `deep-green-hover`로 어두워진다. 구현의 `--green`에 대응한다.
- **소프트 그린** (`colors.soft-green`): 활성 상담 항목의 바탕. hover 바탕은 `nav-hover`로 따로 기록했다. 채워진 버튼 색과 선택 영역의 색을 혼용하지 않는다.

### Neutral

- **페이퍼 화이트** (`colors.paper-white`): 앱의 전체 바탕. `--paper`에 대응한다.
- **서피스 화이트** (`colors.surface-white`): 사이드바·질문 카드·패널·입력창의 흰 작업면. `--white`에 대응한다.
- **잉크**와 **보조 본문** (`ink`, `supporting-ink`): 제목·기본 텍스트와 원문·판단 이유를 구분한다.
- **경계선** (`line`): 화면·패널을 나누는 얇은 선. 입력창은 `field-border`를 사용한다.
- **근거 영역** (`evidence-surface`, `evidence-ink`): 클릭 가능한 인용 문장. 처리 약속은 별도 `promise-surface`를 사용한다.

### Status and focus

| 상태 | 바탕 / 글자 토큰 | 의미 |
| --- | --- | --- |
| 답변 대기 | waiting-surface / waiting-ink | 구체적인 답변을 기다림 |
| 답변 받음 | answered-surface / answered-ink | 질문의 답변 수신. 실제 처리 완료와 구분 |
| 미답변 | unanswered-surface / unanswered-ink | 연결된 답변이 없음 |
| 부분 답변 | partial-surface / partial-ink | 필요한 범위의 일부만 답변 |
| 확인 필요 | review-surface / review-ink | 근거·판정의 확인이 필요 |

삭제 확인 버튼은 `danger`, 키보드 버튼 포커스는 `focus-action`, 필드 포커스는 `focus-field`를 사용한다. 로고 SVG와 브라우저 테마 메타데이터의 기존 색은 자산 고유값으로 유지하며, 주요 버튼 색과 강제로 통합하지 않는다.

**The 상태를 함께 읽는 규칙 Rule.** 상태색은 한국어 라벨과 함께 사용한다. 답변 받음과 사용자 확인 완료는 서로 다른 표시다.

## Typography

**Display Font / Body Font:** Inter → Pretendard → Segoe UI → Malgun Gothic → sans-serif. 현재 외부 폰트 다운로드나 `@font-face`는 없다. 이 목록은 요청한 폰트 순서이며, 실제 글리프는 설치된 폰트와 OS에 따라 달라진다. 한글과 영문의 폴백을 보존한다.

**Character:** 같은 산세리프 계열에서 크기·굵기·자간으로 제목과 작업 정보를 구분한다. 제목은 조밀하고, 원문·판단 이유는 충분한 줄 간격으로 읽는다.

### Hierarchy

- **Display:** 소개 제목. 넓은 화면의 크기는 `clamp(30px, 3.1vw, 47px)`; 프런트매터에는 고정 크기를 만들어 넣지 않았다. 1200px 이하 42px, 960px 이하 37px, 650px 이하 32px로 바뀐다.
- **Headline:** 상담 제목. 기본 27px, 1200px 이하 25px, 960px 이하 23px, 650px 이하 22px, 1600px 이상 30px. 프런트매터는 기본 구간 값이다.
- **Title:** 질문 제목. 기본 14px, 모바일 13px, 1600px 이상 15px. 질문의 번호와 상태 라벨이 제목보다 먼저 배치된다.
- **Body / Supporting:** 기본 텍스트 14px. 원문과 판단 이유는 최종 보정으로 13px, 650px 이하 12px. 원문 줄 높이는 1.95, 판단 이유는 1.8이다.
- **Evidence:** 인용 문장은 14px, 줄 높이 1.8. 모바일에서도 14px을 유지한다.
- **Control / Badge:** 기본 버튼은 13px, 상태 라벨은 질문 선택 목록과 모바일을 포함해 12px, 줄 높이 1.5이다. 작은 버튼·탭·보조 메타데이터에는 개별 크기가 있으므로 모든 라벨을 하나로 치환하지 않는다.
- **Dialog / Eyebrow:** 기본 대화상자 제목은 22px, 모바일 20px. 짧은 영문 eyebrow는 넓은 자간으로 구분하되 한국어 본문에 적용하지 않는다.

**The 최종 적용값 규칙 Rule.** 같은 선택자가 다시 선언되면 CSS 뒤쪽의 가독성 보정과 마지막 모바일 보정까지 적용한 값을 따른다.

## Layout

기본 데스크톱은 고정 사이드바와 오른쪽 작업 영역이다. 사이드바는 244px, 메인 좌우 패딩은 40px, 메인 최대 너비는 1860px이다. 소개 화면은 최대 1230px의 2열, 상담 상세는 원문 `minmax(290px, .86fr)`와 분석 `minmax(400px, 1.4fr)`의 2열, 간격 25px이다. 현황 수치는 4열이며 원문 목록은 기본 최대 높이 620px에서 내부 스크롤한다.

| 조건 | 실제 변화 |
| --- | --- |
| 1600px 이상 | 메인 좌우 55px. 원문/분석 최소 너비 360/500px, 비율 .9/1.4, 간격 35px. 원문 높이 740px. 질문 카드 패딩 23px |
| 1200px 이하 | 사이드바 215px, 메인 좌우 25px. 작업 열 최소 너비 255/345px, 비율 .8/1.2, 간격 18px. 소개 화면 1열, 질문 카드 패딩 16px |
| 960px 이하 | 사이드바 190px, 메인 좌우 22px. 작업 영역 1열. 원문·질문 확인표 전환 버튼으로 한 영역씩 표시. 현황 수치 2열. 원문 내부 높이 제한 해제 |
| 650px 이하 | 사이드바가 상단의 일반 흐름으로 전환. 메인 좌우 18px, 상담 목록은 가로 스크롤, 상단 바 52px. 질문 카드 패딩 15px 16px, 대화상자 패딩 23px 20px |

폼의 제목·업체명은 모바일에서도 현재 2열이다. 검토 메시지의 날짜·시간은 별도 라벨이 있는 전체 너비 행에 배치한다. 추가 답변 폼은 모바일에서 발화자와 날짜를 세로로 배치한다. 실제 상담의 주요 행동인 `새 답변 추가`를 상담 상단에 두고 모바일에서는 전체 너비로 표시한다. 새 입력 항목 추가 시 기존 반응형 동작을 임의로 단순화하지 않는다. 확인한 390px 상담 화면은 가로 넘침이 없었다. 이는 해당 예제·뷰포트 확인이며 모든 콘텐츠에 대한 보증은 아니다.

간격은 역할별 값이다. 프런트매터의 `spacing`은 재사용되는 값을 추출한 목록이며, 현재 코드에 없는 4px/8px 정규 척도가 존재한다고 해석하지 않는다. 패딩 조합은 각 `components` 토큰을 따른다.

## Elevation & Depth

기본 카드와 패널은 밝기 차이와 1px 경계선으로 나눈다. 그림자는 소개 카드, 모달, 토스트와 모바일 선택 버튼에 제한된다. 웹의 진행 안내는 그림자 없이 텍스트와 경계선으로 구분한다. 모달은 구조적 전경, 소개 카드의 그림자는 장식적 깊이 역할이다.

### Shadow vocabulary

- **소개 카드:** `0 20px 65px #2a45240d`. 약한 초록빛 그림자와 -2도 회전. 일반 작업 카드에는 적용하지 않는다.
- **대화상자:** `0 25px 100px #15271826`. backdrop은 `#1d302b66`과 3px blur.
- **토스트:** `0 6px 25px #23372b20`. 화면 하단 중앙에서 잠시 표시.
- **진행 표시:** `box-shadow: none`. 일반 화면의 작업 설명은 문서 흐름에 배치하고, 모달 안의 단계·시간·취소 영역만 내부 스크롤 중 sticky로 유지한다.
- **모바일 선택 버튼:** `0 2px 5px #20331a09`. 선택된 보기만 얕게 들어 올린다.

**The 평평한 작업면 규칙 Rule.** 일반 질문 카드·패널에는 그림자를 추가하지 않는다. 기존 예제 카드·대화상자·알림·선택 상태의 그림자는 해당 역할 안에서 유지한다.

버튼의 배경·테두리·이동은 0.15초, 원문 강조는 0.3초, 토스트는 0.2초 전환이다. 기본 easing은 CSS의 `ease`, spinner는 1초 linear 무한 회전이다. 모션 감소 설정에서는 전환을 없애고 애니메이션을 0.01ms로 줄이며 부드러운 스크롤을 끈다. 그림자·모션·브레이크포인트는 확장 데이터에 기록한다.

## Shapes

작은 상태 라벨은 5px, 근거 링크는 7px, 버튼·필드는 9px, 상담 항목은 10px, 질문·약속 카드는 11px, 현황 카드는 12px, 패널은 13px, 소개 카드는 16px, 모달은 19px 모서리를 사용한다. 이 값들은 기존 역할 구분이며 하나의 반경으로 일괄 치환하지 않는다.

원문 말풍선은 `0 11px 11px 11px`의 비대칭 모서리다. 상태 점과 아바타는 원형이다. 모달은 기본 너비 550px, 넓은 입력형 740px, 최대 너비 `calc(100vw - 28px)`, 최대 높이 90vh에서 내부 스크롤한다. 기본 모달 패딩은 29px 31px이다.

## Components

### 2026-11-15 개별 문의 정리 화면

개별 문의 중심의 흐름을 유지한다. 상세의 네 개 숫자 카드를 세 항목의 `문의 진행 요약`으로 바꾼다. 내가 확인할 질문, 업체 답변·처리 대기, 내가 할 일·결과 확인을 얇은 구분선과 짧은 문장으로 보여 주고 관련 영역으로 이동한다. 모바일은 세 행과 오른쪽의 짧은 바로가기, 넓은 화면은 세 열이다. 새 답변 미분석 시 이전 분석과 현재 상태를 구분한다. 완료처럼 보이는 사이드바 체크 표시를 사용하지 않는다.

목록은 `내 문의함`으로 표기하고 첫 문의의 제한된 미리보기, 유형, 확인할 항목과 대기를 표시한다. 목록은 여러 문의를 찾아보는 보조 화면이며 별도의 통계 대시보드나 알림·메모 기능을 추가하지 않는다. 기존 초록·페이퍼 색과 글꼴·원문 검토 흐름을 유지한다.

### 2026-11-15 사용성 보완

아래 항목은 앞 절의 최초 기록보다 우선하는 현재 웹 구현이다. 색상·원문 근거·상태 구분은 유지한다.

- 기본 탐색에는 문의 추가와 내 문의함을 둔다. 예제 생성 버튼과 발표 링크는 일반 화면에서 제외한다. 모바일은 로고·문의 추가를 첫 행에, 내 문의함을 다음 행에 배치한다. 발표 결과는 별도 `/presentation` 주소로 접근하며 기존 가상 기록의 구분 표시는 유지한다.
- 원문·판정 이유·상담 요약은 모바일 포함 15px, 질문·약속 제목은 16px, 폼 입력은 16px로 읽는다. 모바일 현황은 큰 카드 대신 두 열의 간결한 수치로 표시한다.
- 질문 카드와 겹치는 재문의 제안·업체 대기 상세는 접어 두고 건수를 보여 준다. 업체 요청과 실제 결과 확인은 바로 보이며 원문 연결을 유지한다. 펼친 상태는 탭 메모리에서 상담별로 보존한다.
- `답장 작성` 탭은 남은 질문과 재문의 초안에 집중한다. 인계 생성 UI는 제거했다. 생성 당시 질문을 표시하고 선택·언어가 바뀌면 재작성을 안내한다. 이 안내는 초안 편집기를 다시 렌더링하지 않으며 편집 내용은 탭 이동 시에도 유지한다. 모든 질문에 답변받으면 질문 확인표의 재문의 유도 버튼을 숨기되 실제 처리 확인은 유지한다.
- 캡처 언어·파일 선택은 `캡처로 가져오기 (선택)`에서 펼친다. 파일을 선택했다면 입력 재개 시 펼쳐 표시한다. 모바일의 제목·업체명 입력은 한 열로 배치한다.
- 상담 삭제는 상담 관리 안에 텍스트 버튼으로 제공하고 기존 삭제 확인 단계를 유지한다.

### Buttons

분명한 행동을 제시하는 둥근 직사각형이다. primary는 딥 그린/흰 글자, secondary는 흰 바탕/얇은 테두리, text는 투명 바탕/딥 그린 글자, danger는 삭제 확인의 붉은 바탕이다. 기본 간격은 아이콘과 글자 사이 9px, SVG는 20px이다. compact는 9px 12px 패딩과 12px 글자다.

활성 hover는 1px 위로 이동한다. primary/secondary에는 배경 변화가 있고 text/danger에는 별도 active 색상이 정의되어 있지 않다. disabled는 opacity .48과 wait 커서다. 키보드 focus-visible은 3px outline과 4px offset이다. 아이콘 전용 버튼은 기능을 설명하는 접근성 라벨을 유지한다.

### Inputs / Fields

흰 바탕, 얇은 필드 테두리, 9px 모서리, 11px 12px 패딩이다. 모달 필드의 입력 글자는 기본 12px, 650px 이하에서 16px이다. focus는 2px outline과 1px offset을 사용한다. textarea는 세로 크기 조절과 줄 높이 1.8을 제공한다. 오류는 별도 alert 텍스트·배너로 표시하며 현재 모든 입력에 공통 붉은 테두리 상태가 정의된 것은 아니다.

### Navigation

상담 항목은 좌측 아이콘, 제목, 업체명, 미해결 수를 포함한다. 제목은 한 줄 말줄임이며 활성 항목은 소프트 그린이다. hover 스타일이 active보다 뒤에 선언되어 활성 항목도 hover 중에는 nav-hover 바탕이 된다. 분석 탭은 활성 상태에 2px 밑줄·글자색·굵기 차이를 사용한다. 좁은 화면의 보기 전환과 앱의 상담 탐색은 서로 다른 역할이다.

### Status chips

점과 한국어 상태를 함께 넣는 작은 라벨이다. 바탕·글자색 쌍은 Colors의 상태표를 따른다. 점은 currentColor, 크기는 4px이다. 라벨은 줄바꿈하지 않는다. 이 칩 자체는 현재 클릭 필터가 아니다.

### Cards / Containers

질문 카드는 번호·상태·수정 버튼, 질문 제목, 판정 이유, 근거 링크 순으로 구성된다. 흰 바탕과 경계선, 11px 모서리로 묶고 일반 카드 그림자는 없다. 원문 패널·초안 패널은 독립된 13px 외곽을 사용한다. 내용이 없는 상태는 빈 영역 안내와 다음 행동으로 표현한다.

### Evidence links and conversation

원문 인용은 클릭 가능한 연한 바탕의 영역이다. 줄바꿈과 긴 문장 분할을 허용한다. 누르면 해당 메시지를 스크롤해 보여 주고 3.5초간 테두리 강조를 표시한다. 답변 근거가 없을 때는 질문 원문으로 연결하며, 답변이 있다는 것처럼 인용을 꾸미지 않는다. 고객/상담원은 발화자 라벨과 서로 다른 밝기의 말풍선으로 구분한다.

### Promise cards

연한 별도 바탕 위에 약속 상태, 제목, 기한, 인용, 직접 확인 버튼을 배치한다. 사용자 확인 후에는 기존 확인 완료 스타일과 시각을 표시하고 확인 취소를 제공한다. 기한 미정도 명시적으로 보여 준다. 상태색만으로 업체 안내와 사용자 확인을 합치지 않는다.

### Dialogs and feedback

네이티브 dialog에 제목·닫기·폼·행동 영역을 둔다. AI 작업 중에는 변경·저장 행동을 제한하되 상담 탐색, 탭·원문 조회, 기존 초안 복사·내려받기와 `작업 취소`를 허용한다. 진행 안내에 작업 대상 상담을 표시하고 다른 상담으로 이동해도 완료 결과가 현재 화면을 바꾸지 않는다. 생성 중 초안은 읽기 전용으로 선택·복사할 수 있다. 새 상담 입력은 탭 메모리에 보관해 설정·이전 단계·닫기 후 복원하며 브라우저 저장소에는 원문·캡처·키를 임시 저장하지 않는다. 서버의 실제 처리 단계·경과 시간과 거친 단계를 표시하며 추정 완료율은 사용하지 않는다. 단계 변화는 상태 알림으로 전달하고 초 단위 타이머는 반복 낭독하지 않는다. 오류는 role=alert, 진행·토스트는 상태 알림으로 전달한다. 배경 blur와 내부 스크롤, 모바일 여백을 보존한다.

## 웹 상담 홈과 편집 상태

기록이 있으면 홈은 상담 업무 목록을 보여 준다. 제목·업체 검색과 정렬, 개수가 표시된 필터 다음에 상담 행을 배치한다. 행의 왼쪽은 업체·제목·남은 항목 수, 오른쪽은 기한과 다음 행동이다. 960px 이하에서는 행을 한 열로 쌓고, 650px 이하에서는 검색·정렬도 세로로 배치한다. 새 장식이나 별도 색상 체계 없이 기존 그린·페이퍼 바탕과 경계선을 유지한다.

기한 라벨은 글자로 오늘·기한 지남·미정을 구분한다. 사용자의 실제 완료 확인과 보관 상태를 혼동하지 않는다. 초안 편집기의 저장 상태·저장 버튼·복사 버튼은 함께 배치하며, 모바일 편집 입력은 16px로 유지한다. 저장하지 않은 초안이 있는 경우 이동 경고를 제공하고, 충돌 시 편집 텍스트를 보존한다. 생성 근거와 편집 전 생성 내용은 접힌 영역에서 확인한다.

## Do's and Don'ts

### Do:

- **Do** 현재 딥 그린·페이퍼 화이트·소프트 그린의 역할과 한국어 안내를 유지한다.
- **Do** 상태 라벨, 판단 이유, 원문 인용을 함께 표시하고 근거에서 원문으로 이동하는 동작을 보존한다.
- **Do** 답변 상태와 처리 약속의 사용자 확인을 별도로 표현한다.
- **Do** 좁은 화면에서 원문·분석 전환과 가로 상담 목록을 유지한다.
- **Do** 포커스 표시, 입력 라벨, 모션 감소 대응을 보존한다.

### Don't:

- **Don't** 문서화 작업을 이유로 기존 UI, 기능, 로고, 카피 또는 CSS를 바꾸지 않는다.
- **Don't** 뒤쪽의 가독성 보정을 무시하고 이전의 작은 상태·본문 크기로 되돌리지 않는다.
- **Don't** 답변 받음·업체의 처리 안내를 사용자의 실제 완료 확인과 합치지 않는다.
- **Don't** 소개용 카드의 회전·궤도 장식을 일반 상담 카드의 공통 규칙으로 확장하지 않는다.
- **Don't** 설치되지 않은 폰트, 다크 모드, 접근성 인증, 새 브랜드 색상이나 정규 간격 척도가 이미 존재한다고 가정하지 않는다.

**확장 데이터:** [.impeccable/design.json](.impeccable/design.json)은 schemaVersion 2로 그림자·모션·브레이크포인트와 실제 컴포넌트의 HTML/CSS 미리보기를 담는다. 색상별 8단계 tonal ramp는 패널 표시를 위해 합성한 참고 데이터이며, 기존 CSS에 존재하는 색상 척도나 신규 UI 토큰으로 승인된 것이 아니다. 원시 토큰 값은 이 파일의 프런트매터에만 둔다.

### 관련 공식 안내

문의 상세의 접힌 텍스트 영역으로 표시한다. 독립적인 SSG 입력 화면은 제거한다. 본문·적용 조건·출처 검증이 끝나기 전에는 빈 카드나 확정적인 안내를 보여 주지 않는다. 배경 조회 완료 시 해당 영역만 갱신해 초안 편집을 방해하지 않는다.

### 읽기와 원문 왕복

입력 안내·가림 안내·검토 라벨·빈 상태·초안 저장 안내는 최소 14px와 충분한 줄 간격으로 표시한다. 모달과 작은 행동 버튼은 최소 높이 44px를 확보하고 긴 한국어 문구는 줄바꿈한다. 원문 인용을 누르면 해당 메시지에 키보드 포커스를 옮기고, 메시지 아래 복귀 버튼으로 원래 질문·초안·필터·펼친 근거·정확한 인용 버튼을 복원한다. 다른 문의나 새 기록 버전으로 바뀌면 이전 복귀 위치를 폐기한다. 모션 감소 설정에서는 부드러운 스크롤을 사용하지 않는다. 이 변경은 접근성 인증이나 실제 휴대전화 사용성 검증을 뜻하지 않는다.
