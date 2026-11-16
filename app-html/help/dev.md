# 개발자

## 구조
- `serve.py` — 파이썬 표준 라이브러리 서버. 정적 파일(`app-html/`) + API(`api.php?r=…`, `/hub/…`, `/sso/…`, `/v1/…`).
- `tools/*.py` — 서버 모듈(계정 `auth_api` · AI 연결 `llm_api` · 연구 저장소 `ws_api` · 계정 데이터 `kv_api` · 저장 층 `vfs`(파일/SQLite) · 백업 `backup_api` · 로그 `logkit` …).
- `app-html/` — 화면. `index.html` 이 모든 스크립트를 읽고, 화면마다 파일이 하나씩(`rnd.js`·`paper.js`·`report.js`·`slidestudio.js`·`library.js` …). 새 화면은 `EXT_VIEWS[<키>] = { area, open }` 로 등록하면 `navTo(<키>)` 가 엽니다.
- `app-html/ui/` — 공용 테마(research-ui).

## 자산 버전
화면 파일을 고친 뒤 `python bump-assets.py <빌드 번호>` 를 실행하면 `index.html` 의 `?v=` 가 파일 내용 해시로 바뀌어 브라우저가 새 파일을 받습니다.

## 데이터 폴더
`python serve.py <포트> --data-dir=<폴더>` · 환경변수 `STUDY_DATA_DIR`. 저장 엔진(파일/SQLite)은 데이터 폴더의 `storage.json` 으로 정합니다 → [데이터 관리](#help:data-management).

## 시험 서버 띄우기
```
SK_PORT=18299 SK_REGISTRY=off python serve.py 18299 --data-dir=/tmp/sf-data
```
