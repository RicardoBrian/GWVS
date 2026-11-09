# GWVS 작업 지침 (관산중 봉사활동 관리)

봉사활동 관리: 교육과정 내 활동(학급별 불참 학생), 교육과정 외 역할·인정 시간, 전교생 명단, 확인서 출력.

- **업무용 앱**이다(출결·방송부·봉사). 수업용 Ohweb 과는 분리한다. 방학 때 gwansanattend·GWBS·GWVS 를 DB 하나·레포 하나로 합칠 예정이며, **지금은 합치지 않는다**(다른 레포 코드·DB를 끌어오지 않는다).

## 구조
- 빌드 없음. 레포 맨 위가 그대로 배포된다. React·Tailwind·Babel 을 CDN 으로 불러와 브라우저에서 `.jsx` 를 바로 변환한다(`index.html`).
- `core.jsx` 공통(경로 `PATHS`, 영역·학년 상수), `auth.jsx` 로그인·교사 승인, `app.jsx` 화면 틀, `term.jsx` 학기·명단·역할, `curriculum.jsx` 교육과정 내 활동, `certificate.jsx`·`certificate.css` 확인서, `helpers.jsx`.

## DB — Firebase `gwvs-77114`
- 맨 위: `teachers`, `admins`.
- 나머지는 `artifacts/{APP_ID}/public/data/` 아래(`core.jsx` 의 `PATHS`): `settings/term`, `settings/certificate`, `roles`, `students`, `logs`, `roster`, `events`, `attendance`.
- 규칙: `firestore.rules`. **자동 배포 안 됨** — Firebase 콘솔에 붙여넣어 게시. 고쳤으면 사용자에게 알린다.

## 배포
- 정적 호스팅(레포 맨 위). 배포처·주소는 코드에 적혀 있지 않다 — **확인되면 여기에 적는다.**

## 테스트
- 자동 테스트 없음. 로컬: `python3 -m http.server 8000` 후 브라우저에서 확인(실제 DB에 붙으니 쓰기 동작은 조심).

## 작업 원칙
- 고치기 전에 **실제 오류 메시지를 먼저 확보**한다. 메시지 없이 추측으로 고치지 않는다.
  사용자에게 확인을 부탁할 때는 열어볼 주소·볼 곳을 하나로 정확히 준다.
- 잘 되던 기능은 요청 없이 건드리지 않는다. 원인이 확인되면 그 원인만 고치고, "겸사겸사" 개선은 먼저 묻는다.
- 같은 문제로 두 번 고쳐도 안 되면 멈추고, 확인한 사실과 모르는 것을 정리해 보고한다.
- 사용자에게는 한국어로, 짧게, 무엇을 바꿨고 무엇을 확인했는지(확인 못 한 것도) 말한다.
- 전체 DB 지도는 `RicardoBrian/Ohweb` 의 `DB.md`. 컬렉션을 새로 만들면 그 표도 고친다.
