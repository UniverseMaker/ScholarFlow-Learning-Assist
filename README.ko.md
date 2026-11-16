<div align="center">

# ScholarFlow

**AI 기반 자체 호스팅 연구·학습 작업 공간**
쪽 단위로 근거를 짚어 주는 AI 와 함께 자료를 읽고, 보고서·논문·발표자료를 만들고, 학습 자료로 공부합니다. 모두 내 컴퓨터에서.

[English README](README.md) · [라이선스](LICENSE) · [스크린샷](#스크린샷)

![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white)
![빌드 단계 없음](https://img.shields.io/badge/빌드-없음-0f6b62)
![저장](https://img.shields.io/badge/저장-파일%20%7C%20SQLite-0f6b62)
![License](https://img.shields.io/badge/license-Use--Only-lightgrey)

<img src="docs/screenshots/02-dashboard.jpg" alt="오늘 연구 대시보드" width="100%">

</div>

---

## 왜 만들었나

연구 작업은 보통 흩어져 있습니다. PDF 는 폴더에, 메모는 다른 앱에, AI 채팅은 내 파일을 모르는 브라우저 탭에, 발표자료·문헌 관리·문서 작성 도구도 제각각입니다. ScholarFlow 는 이 과정을 **자체 호스팅 작업 공간 하나**로 모았습니다. AI 는 **내 프로젝트 자료를 근거로** 답하고, 모든 답에는 근거가 된 쪽이 붙습니다.

- **가볍습니다.** 파이썬 표준 라이브러리 서버(`serve.py`) 하나와 HTML/JS 화면뿐입니다. Node 빌드·외부 DB·컨테이너가 필요 없습니다. 데이터는 폴더 하나 또는 SQLite 파일 하나 — 폴더를 복사하면 이사가 끝납니다.
- **AI 중심, 그러나 근거 기반.** 질문·요약·초안·심사·발표자료를 프로젝트 자료로 만들고, 누르면 그 쪽으로 이동하는 근거 쪽 칩을 붙입니다.
- **원하는 모델을 연결.** OpenAI 호환 주소(로컬 vLLM·Ollama 류 서버나 클라우드)나 Claude CLI 를 연결합니다. 키는 서버에 암호화해 두고 브라우저로 돌려보내지 않습니다.
- **내 것으로.** 계정, 계정별 데이터 소유와 명시적 공유, 감사 기록, 시간별·일별·월별 백업까지 내 장비에서.

## 핵심 기능

| | |
|---|---|
| 🔬 **연구 프로젝트** | PDF·Word·PowerPoint·Excel·한글(HWP·HWPX)·그림·소리·영상·글·코드를 올리고, 찾기·형광펜·쪽 메모·책갈피가 있는 내장 뷰어로 읽습니다. |
| 💬 **근거 기반 AI 대화** | 지금 보는 쪽이나 프로젝트 전체에 대해 묻습니다. 답의 근거 쪽으로 뷰어가 이동합니다. 글을 드래그하면 *AI 에게 · 쉽게 · 번역 · 담기 · 문서에* 를 바로 씁니다(메뉴 위치·거리 설정 가능). |
| 📝 **보고서 작업실** | 워드·구글 문서식 A4 쪽 편집기 — 스타일, 번호 제목, 표·그림·수식·차트·각주·차례. AI 블록 편집이 절을 고치고 넣고 지우며 되돌릴 수 있습니다. DOCX·PDF·HTML·Markdown·PPTX 로 내보냅니다. |
| 📄 **논문 작업실** | 브라우저 안 LaTeX 작업실 — 폴더 트리, 자동 완성 편집기, 즉시 HTML 미리보기, 샘플 18종(IEEE·Elsevier·Beamer 등), BibTeX 찾기, TeX 엔진이 있으면 서버 PDF 컴파일과 SyncTeX. |
| 🎬 **발표자료 작업실** | 캔버스에서 레이아웃·테마·도형·표·차트로 슬라이드를 만들고 대본·발표자 보기·리허설까지. 진짜 PPTX·PDF·HTML·Beamer 로 내보냅니다. |
| 📚 **문헌·선행연구** | OpenAlex 검색, 서재 상태 보드, AI 비교표 채우기, 연구 공백·놓친 핵심 논문 찾기, 관련 연구를 논문·보고서로 보내기. |
| 🎯 **모의 심사실** | 평가 배점표로 AI 심사위원단이 초안을 채점하고, 치명적 약점·수정 목록을 내며, 질의응답을 연습합니다. |
| 🔭 **심층 조사·회의** | 하위 질문을 세워 근거와 확신도를 모으고, AI 회의록과 할 일을 남깁니다. |
| 🤖 **AI 배경 작업** | 자료 정리·문헌 검토·심사 반복·제출 전 점검 같은 긴 작업을 서버가 이어서 하고, 바꿀 내용은 확인 카드로 제안합니다. |
| 📖 **자료 학습 모드** | HTML 학습 문서를 필터·리딩 메이트·형광펜·노트와 함께 읽고, 복습 카드(간격 반복)·서술형 연습·개념 지도·학습 계획으로 공부합니다. |
| 🛡 **계정·운영** | 서버 계정·세션, 계정별 기능 권한, 데이터 소유와 보기/편집 공유, 감사 기록, 백업·복원, 선택 기능인 통합로그인(SSO)·시스템 간 계정 연동, 서버 PC 에서만 설정되는 비상용 관리자. |

## 스크린샷

> 모든 스크린샷은 가상의 시연 데이터입니다. 시연 인스턴스에는 모델을 연결하지 않아 AI 칸에 *AI 미연결* 이 보입니다.

### 연구지원

| | |
|---|---|
| **오늘 연구** — 지금 할 일과 이유, 시간을 쓴 곳<br><img src="docs/screenshots/02-dashboard.jpg" width="100%"> | **연구 프로젝트** — 상태·마감·연결, 표·카드·트리 보기<br><img src="docs/screenshots/03-projects.jpg" width="100%"> |
| **프로젝트 작업 공간** — 자료·문서·근거 대화<br><img src="docs/screenshots/04-workspace-chat.jpg" width="100%"> | **자료 보기** — 쪽 보기·글 층·썸네일·AI 옆 칸<br><img src="docs/screenshots/05-viewer.jpg" width="100%"> |
| **고른 글로 바로** — 칠하기·질문·쉽게·번역·담기<br><img src="docs/screenshots/06-viewer-select.jpg" width="100%"> | **보고서 작업실** — 쪽 편집기와 AI 블록 편집<br><img src="docs/screenshots/07-report.jpg" width="100%"> |
| **논문 작업실** — LaTeX 샘플과 작업실<br><img src="docs/screenshots/08-paper.jpg" width="100%"> | **발표자료 작업실** — 발표자료함·레이아웃·발표 도구<br><img src="docs/screenshots/09-slides.jpg" width="100%"> |
| **문헌·선행연구** — OpenAlex 검색·서재 보드<br><img src="docs/screenshots/10-literature.jpg" width="100%"> | **모의 심사실** — AI 위원단 배점 채점<br><img src="docs/screenshots/11-review.jpg" width="100%"> |
| **심층 조사** — 계획·근거·확신도<br><img src="docs/screenshots/12-deep-research.jpg" width="100%"> | **회의·설문·메모**<br><img src="docs/screenshots/13-meeting.jpg" width="100%"> |
| **AI 작업**<br><img src="docs/screenshots/14-ai-tasks.jpg" width="100%"> | **프로젝트 정보·관리** — 계획·예산·목표·기간<br><img src="docs/screenshots/15-project-info.jpg" width="100%"> |
| **작업 이력·저장소 상태**<br><img src="docs/screenshots/16-timeline.jpg" width="100%"> | |

### 자료 학습

| | |
|---|---|
| **학습 자료** — 필터, 목록·카드·트리<br><img src="docs/screenshots/17-library.jpg" width="100%"> | **읽기 화면** — 목차·리딩 메이트·관련 문서<br><img src="docs/screenshots/18-library-reader.jpg" width="100%"> |
| **복습 카드**(간격 반복)<br><img src="docs/screenshots/19-review-cards.jpg" width="100%"> | **노트 허브**<br><img src="docs/screenshots/20-notes.jpg" width="100%"> |
| **학습 계획**<br><img src="docs/screenshots/21-study-plan.jpg" width="100%"> | |

### 설정·관리 외

| | |
|---|---|
| **로그인**<br><img src="docs/screenshots/01-login.jpg" width="100%"> | **화면 설정** — 팔레트·밝게/어둡게·왼쪽/위쪽 메뉴·글꼴<br><img src="docs/screenshots/22-settings.jpg" width="100%"> |
| **어둡게**<br><img src="docs/screenshots/23-dark.jpg" width="100%"> | **계정·서버 관리**<br><img src="docs/screenshots/24-admin.jpg" width="100%"> |
| **AI 연결** — OpenAI 호환·Claude CLI·가져오기/내보내기<br><img src="docs/screenshots/25-ai-connection.jpg" width="100%"> | **비상용 관리자** — 비밀번호는 서버 PC 에서만<br><img src="docs/screenshots/26-local-admin.jpg" width="100%"> |
| **휴대폰**<br><img src="docs/screenshots/27-mobile.jpg" width="40%"> | |

## 빠른 시작

```bash
git clone https://github.com/UniverseMaker/ScholarFlow-Learning-Assist.git
cd ScholarFlow-Learning-Assist
python -m pip install -r requirements.txt        # 선택 — PDF·Office·한글 보기, DOCX·PPTX 내보내기
python serve.py 18162 --data-dir=./data          # http://127.0.0.1:18162
python tools/local_admin.py set --data ./data    # 관리자(admin) 비밀번호 — 서버 PC 에서만
```

1. 브라우저에서 `http://127.0.0.1:18162` 를 열고 `admin` 으로 로그인합니다.
2. **설정 → AI 연결** 에서 OpenAI 호환 주소·모델·키(또는 Claude CLI)를 등록합니다.
3. **연구지원 → 연구 프로젝트 → 새 프로젝트** 에서 자료를 올리고 물어봅니다.

**필요한 것:** Python 3.10 이상. 서버 자체는 표준 라이브러리만 씁니다. `requirements.txt` 의 선택 패키지가 있으면 PDF·Office·한글 보기와 DOCX·PPTX 내보내기가 켜집니다. Windows 에서는 설치된 MS Office·한컴오피스로 원래 모양 미리보기를 씁니다. 서버에 TeX 엔진(tectonic·xelatex)이 있으면 논문 PDF 컴파일이 됩니다.

## 구조

```
브라우저(HTML/JS, 빌드 없음) ──►  serve.py  (파이썬 표준 라이브러리 HTTP 서버)
                                   ├─ tools/ws_api.py     프로젝트·자료·문서·버전·내보내기
                                   ├─ tools/llm_api.py    AI 연결(키 암호화)·스트리밍 중계
                                   ├─ tools/aitask_api.py AI 배경 작업(이어 하기)
                                   ├─ tools/auth_api.py   계정·세션·CSRF·잠금·감사
                                   ├─ tools/vfs.py        저장: 일반 파일 또는 SQLite 파일 하나
                                   └─ tools/backup_api.py 시간별·일별·월별 스냅숏
```

- **데이터 폴더**(`--data-dir`): 계정·프로젝트·문서·로그·백업. 폴더를 옮기면 설치가 옮겨집니다.
- **보안:** PBKDF2 비밀번호(비상용 관리자는 bcrypt), HttpOnly 세션 쿠키, CSRF 확인, 로그인 실패 잠금, 보안 머리글, 계정별 데이터 소유와 명시적 보기/편집 공유, 감사 기록.
- **화면 파일:** 고친 뒤 `python bump-assets.py <빌드 번호>` 로 파일별 캐시 해시를 다시 매깁니다.

## 학습 자료 추가

단일 HTML 문서를 `app-html/library/docs/<id>.html` 에 넣고 `python tools/build_catalog.py` 를 실행합니다. 규격과 템플릿은 앱의 **도움말** 과 `app-html/help/templates/` 에 있습니다.

## 라이선스

ScholarFlow 는 **소스 공개(source-available) 소프트웨어이며 오픈소스가 아닙니다.** [ScholarFlow 사용 전용 라이선스](LICENSE)를 따릅니다.

- ✅ 수정하지 않은 소프트웨어를 개인·교육·연구·기관 내부 용도로 무료로 내려받아 설치·**사용**할 수 있습니다. 만든 결과물은 자유롭게 씁니다.
- ❌ 서면 허락 없이 수정·2차 저작, 재배포·판매, 제3자 대상 호스팅(SaaS), 다른 제품에 포함할 수 없습니다.
- 버그 제보·제안은 Issues 로 환영합니다. 풀 리퀘스트는 사전 합의 후에만 받습니다.

제3자 구성요소는 각자의 라이선스를 따릅니다: Pretendard Variable 글꼴(SIL OFL 1.1), 실행 중 공개 CDN 에서 불러오는 CodeMirror·KaTeX.
