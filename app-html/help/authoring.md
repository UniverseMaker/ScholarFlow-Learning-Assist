# 학습 자료 만들기 · 등록 (통합 가이드)

다른 곳(Claude Code · Cowork · 직접 작성)에서 만든 **HTML 학습 문서**를 이 앱의 [학습 자료]로 넣는 방법입니다.
사람도, 다른 Claude 세션도 이 문서 하나만 보면 되게 썼습니다. 파일 위치: `app-html/help/authoring.md`.

## 0. 30초 요약

| 방법 | 누가 · 언제 | 결과 |
|---|---|---|
| **A. 앱에서 등록** | 관리자 · 지금 바로 | [학습 자료 → ⬆ 자료 등록] → HTML 파일 선택 → 등록. **이 브라우저에 즉시** 보임(서버 모드면 서버에 저장) |
| **B. 폴더에 넣고 빌드** | 개발자 · 모두에게 배포 | `app-html/library/docs/<id>.html` 에 복사 → `python tools/build_catalog.py` |

문서 규격(아래 §2)을 지키면 A·B 어느 쪽이든 그대로 동작합니다. 템플릿은 `app-html/help/templates/lds-doc-minimal.html`.

## 1. 문서 한 편 = HTML 파일 하나

- **단일 파일 · 외부 의존성 0** — CDN, 웹폰트, 외부 이미지, 빌드 도구 금지(오프라인에서도 열려야 함). 이미지가 꼭 필요하면 `data:` URI 로 넣거나(작게) 방법 B 에서 `library/assets/<id>/` 상대경로.
- **JS 없이도 본문 전문이 읽힌다** — 스크립트는 목차·검색·접기 같은 보조만.
- **색은 `var(--…)` 로만** — 색 리터럴은 `:root` 와 `:root[data-theme="dark"]` 블록 안에서만. 앱이 다크/라이트를 `html[data-theme]` 로 꽂아 넣습니다.
- **`scroll-behavior: smooth` 금지** — 일부 임베디드 뷰에서 목차 링크가 안 먹습니다.
- 목차가 있는 긴 문서는 **LDS 레이아웃 축**(§4)을 지원하면 뷰어의 ▤ 읽기 배치가 적용됩니다.

## 2. 필수 — 파일 이름과 doc-meta

### 2.1 파일 이름 = id
```
<domain>-<track>-<topic>-<슬러그>.html      예) data-semantic-knowledge-graph-shacl-governance.html
```
소문자 kebab-case, 영문·숫자·하이픈만. **파일 이름이 정본**(doc-meta 의 id 와 다르면 빌더는 파일 이름을 씀).

### 2.2 doc-meta (head 안)
```html
<script type="application/json" id="doc-meta">{
  "schema": "lds/1.0",
  "id": "data-semantic-knowledge-graph-shacl-governance",
  "title": "검증·품질·거버넌스 — SHACL로 온톨로지를 지킨다",
  "summary": "한두 문장 요약 — 목록에 그대로 보입니다.",
  "domain": "data", "track": "semantic", "topic": "knowledge-graph",
  "level": "advanced",
  "minutes": 90,
  "tags": ["shacl", "validation", "owl"],
  "status": "published",
  "updated": "2026-09-22",
  "subjects": ["knowledge-graph"]
}</script>
```

| 키 | 필수 | 설명 |
|---|---|---|
| `schema` | ✔ | 항상 `"lds/1.0"` |
| `id` | ✔ | 파일 이름과 같게 |
| `title` | ✔ | 목록 제목 |
| `domain` | ✔ | 분류 1단계(예: data · web · software · career · business) |
| `level` | ✔ | `beginner` / `intermediate` / `advanced` / `reference` |
| `summary` | 권장 | 목록·검색에 쓰임 |
| `track` / `topic` | 권장 | 분류 2·3단계 |
| `minutes` | | 예상 학습 시간(분) |
| `tags` | 권장 | 검색·필터. 소문자 영어 권장 |
| `status` | | `draft` / `review` / `published` |
| `updated` | | `YYYY-MM-DD` |

## 3. 본문 권장 구조
- `<h1>` 제목 → 요약 → **목차** → `<section>` 여러 개(`<h2>` · `<h3>`) → 연습문제 → 정리
- 용어는 `<dl><dt>용어</dt><dd>설명</dd></dl>`, 연습문제는 `<ol>` + 정답을 `<details>` 로 접기.

## 4. (선택) LDS 레이아웃 축 지원
뷰어의 ▤ 읽기 배치는 문서 `<html>` 에 `data-toc`(left·right·top·hidden) · `data-width`(narrow·default·wide·full) · `data-header`(static·sticky·rail) 를 꽂습니다.
문서 CSS 가 이 속성 선택자를 지원하면 배치가 바뀝니다. 가장 쉬운 방법은 **LDS 전체 템플릿**(`library/template/lds-1.0-full.template.html`)으로 시작하는 것.
처음 그릴 때 저장값을 읽는 부트 스크립트:
```html
<script>
(function () { var r = document.documentElement;
  try { var t = JSON.parse(localStorage.getItem('lds:theme')); if (t) r.setAttribute('data-theme', t); } catch (e) {}
  try { var L = JSON.parse(localStorage.getItem('lds:layout')) || {};
        ['toc','width','header'].forEach(function (k) { if (L[k]) r.setAttribute('data-' + k, L[k]); }); } catch (e) {}
})();
</script>
```

## 5. 방법 A — 앱에서 등록(관리자)
1. [학습 자료] → **⬆ 자료 등록** → HTML 파일 선택
2. doc-meta 를 읽어 칸이 채워집니다(없으면 파일 이름·`<title>` 로). 확인·수정 → **등록**
3. 목록에 **앱 등록** 배지로 바로 나옵니다.
- 저장 위치: **로컬 모드 = 이 브라우저의 IndexedDB**(다른 기기·브라우저엔 없음) · **서버 모드 = 서버 DB/스토리지**(모두에게 보임).
- 모두에게 배포하려면(로컬 모드): 등록 창의 **⬇ 파일 받기** → 방법 B.
- 등록한 자료 목록·지우기도 같은 창에서.

## 6. 방법 B — 폴더에 넣고 빌드(배포)
```bash
cp 내문서.html app-html/library/docs/<id>.html
python tools/build_catalog.py
```
빌더는 doc-meta 를 모아 `catalog.json` 을 다시 만듭니다. 한글 분류 이름은 `catalog.json` 의 `taxonomy` 에 적어 두면 다음 빌드에도 남아요.

## 7. 다른 Claude 세션에게 맡길 때 (복사해서 쓰는 지시문)
```
너는 "ScholarFlow" 학습 자료(LDS 1.0)를 만든다. 규격: app-html/help/authoring.md.
- 단일 HTML 파일, 외부 의존성 0(CDN·웹폰트·외부 이미지 금지), JS 없이도 본문이 읽혀야 함
- <head> 에 <script type="application/json" id="doc-meta"> (schema·id·title·summary·domain·track·topic·level·minutes·tags·status·updated)
- 파일 이름 = id = <domain>-<track>-<topic>-<slug>.html (소문자 kebab-case)
- 색은 var(--…) 만, :root 와 :root[data-theme="dark"] 두 벌. scroll-behavior:smooth 금지
- 구조: h1 → 요약 → 목차 → section(h2/h3) → 개념 정의·규칙·예시·함정 → 연습문제(정답·해설은 <details>) → 정리
- 시작 틀: app-html/help/templates/lds-doc-minimal.html
주제: <여기에 주제>, 대상: <수준>, 분량: <약 N분>
완성 후 {{ 치환 자리가 남지 않았는지, doc-meta JSON 이 유효한지 확인하고 파일 하나로 출력해.
```

## 8. 체크리스트
- [ ] 파일 하나로 열린다(인터넷 끊고도) · 콘솔 오류 없음
- [ ] doc-meta JSON 이 유효하고 id = 파일 이름
- [ ] 다크 모드(`html[data-theme="dark"]`)에서 글자가 보인다
- [ ] `{{` 치환 자리가 남지 않았다
- [ ] 목차 링크가 이동한다(smooth scroll 없음)
- [ ] 확인 질문에는 답·설명이 있다

## 9. 자주 걸리는 것
| 증상 | 원인 |
|---|---|
| 목록에 안 보임 | (B) 빌더를 안 돌림 · (A) 다른 브라우저 |
| 분류가 misc | doc-meta 가 없거나 JSON 이 깨짐 |
| 다크에서 흰 종이 | `:root[data-theme="dark"]` 블록 없음 |
| 이미지 깨짐 | 절대경로 · 외부 URL · (A 방식에서) 상대경로 이미지 |
| 읽기 배치가 안 바뀜 | 문서가 LDS 레이아웃 축을 지원하지 않음(글자 크기만 적용) |
