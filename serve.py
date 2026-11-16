# -*- coding: utf-8 -*-
"""개발용 정적 서버 — 캐시를 끄고 app-html/ 을 서비스한다. + (v75) DB 없는 'AI 연결 보관함' 파일 저장소.

왜 필요한가:
  python -m http.server 는 Cache-Control 을 보내지 않아서, 브라우저가 Last-Modified
  만 보고 제멋대로 캐시한다. 그러면 style.css / app.js 를 고쳐도 화면이 그대로다
  (index.html 에만 ?v= 를 붙여도 소용없다 — 안쪽 자산은 따로 캐시되기 때문).
  이 서버는 모든 응답에 no-store 를 붙여 항상 최신 파일을 내려보낸다.

AI 연결 보관함(파일) — api.php?r=vault&id=<id> (PHP 호스팅의 app-html/api.php 와 같은 규칙) · /api/vault/<id>
  브라우저 localStorage 는 브라우저마다 따로라서, 다른 브라우저·PC 에서 [받아 쓰기]를 하려면
  어딘가 공용 저장소가 있어야 한다. DB 대신 이 서버가 프로젝트의 userdata/llm-vault/<id>.json 파일에 둔다.
  - 서버는 **암호문만** 받는다(브라우저가 AES-256-GCM 으로 암호화한 enc{alg,iv,salt,ct}). 평문 키(api_key)가 보이면 거부.
  - <id> = 브라우저가 PBKDF2(암호 문구, 계정 이름)로 만든 64자리 hex — 계정 이름+암호 문구를 모르면 찾을 수도, 풀 수도 없다.
  - 쓰기·지우기는 X-Study-Vault 헤더가 있어야 한다(다른 사이트에서 몰래 보내는 요청 차단). 없는 id 조회가 잦으면 잠시 막는다.
  - userdata/ 는 app-html 밖이라 정적 파일로 새지 않고, 버전 백업(version-backup)에서도 빠진다.

사용:
  python serve.py            # 기본 18162 포트(고정 배포 포트), 이 PC 에서만(127.0.0.1)
  python serve.py 8200       # 포트 지정
  python serve.py 18162 --lan # 같은 네트워크의 다른 PC 에서도 접속(보관함 공유) — 믿을 수 있는 네트워크에서만
  python serve.py 18162 --vault-dir="G:/내 드라이브/study-vault"   # 보관함을 동기화 폴더에(여러 PC 가 각자 serve.py 로 공유)
    → 매번 쓰기 싫으면 userdata/vault-dir.txt 에 경로 한 줄, 또는 환경변수 STUDY_VAULT_DIR
  python serve.py --log-static  # 정적 파일 요청도 access.log 에 전부 남기기(기본은 API 와 4xx/5xx 만)

(v92) 계정·세션·보안 · 로깅 · AI 연결(서버 보관 + 프록시 + Claude CLI)
  tools/auth_api.py  계정(PBKDF2 60만 회)·HttpOnly 쿠키 세션·잠금·CSRF·감사 기록   — api.php?r=auth&op=…
  tools/llm_api.py   계정별 AI 연결(키는 서버에 암호화)·OpenAI 호환 프록시·Claude CLI — api.php?r=llm&op=…
  tools/logkit.py    <DATA_DIR>/logs/{server,error,access,audit,llm,client}.log (JSON Lines, 5MB×10 회전, 민감정보 가림)
  연구 저장소(r=ws)·보관함 쓰기는 로그인 세션이 있어야 한다(계정은 세션에서 — 헤더로 남의 계정을 흉내 낼 수 없다).
"""
import json
import os
import re
import secrets
import socket
import sys
import time
import threading
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

ROOT = os.path.dirname(os.path.abspath(__file__))
# 보관함 폴더: --vault-dir=<경로> > 환경변수 STUDY_VAULT_DIR > userdata/vault-dir.txt 한 줄 > 기본 userdata/llm-vault
#   여러 PC 가 같은 보관함을 쓰려면 Google Drive·OneDrive 처럼 동기화되는 폴더를 지정한다(각 PC 의 serve.py 가 같은 폴더를 보면 됨).
def _vault_dir():
    for a in sys.argv[1:]:
        if a.startswith("--vault-dir="):
            return os.path.abspath(os.path.expanduser(a.split("=", 1)[1].strip('"')))
    if os.environ.get("STUDY_VAULT_DIR"):
        return os.path.abspath(os.path.expanduser(os.environ["STUDY_VAULT_DIR"]))
    cfg = os.path.join(ROOT, "userdata", "vault-dir.txt")
    if os.path.exists(cfg):
        with open(cfg, "r", encoding="utf-8-sig") as fh:
            line = fh.read().strip()
        if line:
            return os.path.abspath(os.path.expanduser(line))
    return os.path.join(ROOT, "userdata", "llm-vault")


VAULT_DIR = _vault_dir()
# (v90) 연구지원 워크스페이스 — 프로젝트·자료·대화 이력·문서 버전·내보내기를 파일로(tools/ws_api.py). 폴더: --data-dir / STUDY_DATA_DIR / userdata/data-dir.txt / 기본 userdata/workspace
sys.path.insert(0, os.path.join(ROOT, "tools"))
import ws_api                      # noqa: E402
import logkit                      # noqa: E402
import auth_api                    # noqa: E402
import llm_api                     # noqa: E402
import kv_api                      # noqa: E402
import kanban_api                  # noqa: E402
import rnd_api                     # noqa: E402
import hublink_api                 # noqa: E402
import aitask_api                  # noqa: E402
import sso_api                     # noqa: E402
import portreg                     # noqa: E402
import aireg_api                   # noqa: E402
import offline                     # noqa: E402
import safeio                      # noqa: E402  (v140) 정전 대비 쓰기·읽기 전용 잠금
import vfs      # noqa: E402  (v151) SQLite 엔진이면 데이터 폴더의 .json·.jsonl 은 DB — 아래 open·exists 등은 vfs 판
open = vfs.open  # noqa: A001
offline.install()                  # STUDY_OFFLINE=1 이면 다른 서버로 나가는 호출을 전부 막는다(복사본 시험)
import dash_api                    # noqa: E402
DATA_DIR = ws_api.resolve_data_dir(ROOT, sys.argv[1:], os.environ)
LOG_DIR = logkit.setup(os.path.join(DATA_DIR, "logs"), console=True, log_static="--log-static" in sys.argv)
# (v140, G10) 시작 점검 — 저장소를 열기 전에 데이터 파일이 읽히는지 본다. 깨졌으면 쓰기를 멈추고(자동으로 덮어쓰지 않는다) 복구 명령을 안내한다
import dbconn                      # noqa: E402  저장소 커넥터(엔진 하나 고르기) — tools/dbconn.py
import backup_api                  # noqa: E402  시간별·일별·월별 백업 — tools/backup_api.py
DBCONF = dbconn.load_conf(DATA_DIR)
DBENG = dbconn.Engine(DATA_DIR, DBCONF) if DBCONF.get("engine", "files") != "files" else None
BACKUP = backup_api.Backup(ROOT, DATA_DIR, VAULT_DIR, db=DBENG,
                           log=lambda lv, msg, **f: (logkit.error if lv == "ERROR" else logkit.warn if lv == "WARNING" else logkit.info)("backup", msg, **f))
vfs.init(DATA_DIR, DBENG, tables=False)      # (v151) 점검 전 — 경로 판정만(표는 점검 통과 뒤)
HEALTH = BACKUP.startup_check()
try:
    vfs.init(DATA_DIR, DBENG, tables=not HEALTH["bad"])     # (v151) SQLite 엔진이면 데이터 폴더 .json·.jsonl 은 DB(tools/vfs.py)
except Exception as _e:              # (v151) DB 표를 만들지 못함 — 읽기 전용으로
    HEALTH["bad"].append({"path": "db", "why": "DB 표 준비 실패: " + str(_e)[:120]})
    vfs.init(DATA_DIR, DBENG, tables=False)
if DBENG and not HEALTH["bad"]:
    _db_bad, _db_warn = vfs.check_docs()      # (v151) DB 안 JSON 도 시작 때 읽혀야 한다
    HEALTH["bad"] += _db_bad
    HEALTH["warn"] = (HEALTH.get("warn") or []) + _db_warn[:20]
if HEALTH["bad"]:
    safeio.READONLY = "%d개 파일(%s)" % (len(HEALTH["bad"]), ", ".join(b["path"] for b in HEALTH["bad"][:3]))
    _last = (BACKUP.list() or [{}])[0].get("name")
    logkit.error("backup", "데이터 점검: 깨진 파일이 있어 저장을 멈췄습니다", bad=HEALTH["bad"][:10], latest_backup=_last,
                 restore="python tools/restore.py --check  →  서버를 끄고  python tools/restore.py --file <경로> [--snapshot %s]" % (_last or "<이름>"))
WS = ws_api.Workspace(DATA_DIR)
AUTH = auth_api.AuthStore(DATA_DIR)
if os.environ.get("STUDY_BREAKGLASS", "on") != "off":     # (v179) 비상용 관리자 local-admin/1 — admin 을 비상용으로(처음은 미설정). 시험 사본은 끌 수 있다
    try:
        AUTH.ensure_breakglass()
    except Exception:
        logkit.error("app", "비상용 관리자 계정 준비 실패", exc=True)
import local_admin                    # noqa: E402  (v179) /local-admin — 서버 PC 에서만 비밀번호 정하기
LLM = llm_api.LlmStore(DATA_DIR, AUTH)
LLM.aim = aireg_api.AiReg(DATA_DIR, LLM.box)   # (v139) AI 관리시스템 연동 ai-registry/1 — a:<id> 프로필
try:
    KV = dbconn.SqlKvStore(DATA_DIR, DBENG) if DBENG else kv_api.KvStore(DATA_DIR)   # (v140) 화면·API 는 엔진을 모른다
except Exception as _e:
    logkit.error("backup", "저장소 DB 를 열지 못해 파일 저장소로 읽기만 합니다", err=str(_e)[:200])
    safeio.READONLY = safeio.READONLY or "저장소 DB 열기 실패"
    KV = kv_api.KvStore(DATA_DIR)
KB = kanban_api.Kanban(DATA_DIR, LLM.box)   # (v93) FlowBoard(칸반) 연동 — 토큰은 계정별 암호화          # (v93) 계정 데이터 실시간 저장(바뀌는 항목만 즉시) — 브라우저는 캐시
RNDA = rnd_api.RndAdmin(DATA_DIR, LLM.box)   # (v117) 연구행정관리시스템 연결 — 토큰은 계정별 암호화
HUB = rnd_api.Hub(DATA_DIR, AUTH, LLM, WS, 18162)   # (v117) 연구 허브 서비스 토큰·게이트웨이
LINK = hublink_api.HubLink(DATA_DIR, AUTH, LLM.box, HUB, WS, os.path.join(ROOT, "app-html"))   # (v120) 계정 연동
auth_api.ON_LOGOUT.append(LINK.logout_all)
SSO = sso_api.Sso(DATA_DIR, AUTH, LLM.box, LINK)     # (v135) 통합로그인 ulogin-link/1. 기본 off
LINK.sso = SSO                                        # (v176) 11.10 자동 연동 확정 전 userinfo 확인
auth_api.LOGIN_GUARD.append(SSO.login_guard)
import ulink_api                   # noqa: E402  (v145) 통합로그인 중앙 계정 연결 — 계정 목록 보내기·연결 사건·account_link
ULINK = ulink_api.ULink(DATA_DIR, SSO, AUTH)
SSO.ulink = ULINK
LLM.aim.ul_token = lambda u: SSO.access_token_of((u or {}).get("id"))      # (v167) AI 관리 사용자 판정 X-ULogin-Token
import emergency_api               # noqa: E402  (v169) 비상복구모드 emergency/1 — 통합로그인이 죽었을 때 비상 로그인
EMG = emergency_api.Emergency(DATA_DIR, AUTH, SSO, LLM.box)
SSO.emg = ULINK.emg = EMG
import platlog                     # noqa: E402  (v157) 로그·감사 이원화 — 통합로그인 수집 API(계약 116s0)
PLAT = platlog.install(DATA_DIR)
PLAT.sso = SSO
SSO.platlog = PLAT
_WHO = {}


def _who(user):
    """감사·로그 행위자: 계정 id(또는 아이디) → 역할·아이디·통합로그인 uuid. 60초 캐시."""
    hit = _WHO.get(user)
    if hit and time.time() - hit[0] < 60:
        return hit[1]
    u = AUTH.find(uid=user) or AUTH.find(username=user)
    v = {"role": u.get("role"), "username": u.get("username"), "uuid": (u.get("sso") or {}).get("uuid")} if u else None
    if len(_WHO) > 500:
        _WHO.clear()
    _WHO[user] = (time.time(), v)
    return v


PLAT.resolve = _who
auth_api.ON_LOGOUT_SESSION.append(SSO.on_logout)
KB.link = LINK
TASKS = aitask_api.Tasks(DATA_DIR, AUTH, LLM, WS, RNDA)   # (v123) AI 배경 작업 — main 에서 시작
def _project_extra(uid, pid):
    """(v138) 프로젝트 정보의 기간(시작·끝). 연구행정에서 받은 일정이 있으면 그 값"""
    info = DASH.kv_get(uid, "u:tk.rnd.pinfo." + str(pid), {}) or {}
    per = ((info.get("d") or info).get("period") or {}) if isinstance(info, dict) else {}
    def ymd(v):          # 2026.3.1 · 2026/03/01 · 2026-03-01 → 2026-03-01 (화면이 글자 순서로 비교한다)
        m = re.match(r"^\s*(\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})", str(v or ""))
        return "%s-%02d-%02d" % (m.group(1), int(m.group(2)), int(m.group(3))) if m else ""
    s, e = ymd(per.get("start")), ymd(per.get("end"))
    return {"period": {"start": s, "end": e}} if (s or e) else {}


ws_api.PROJECT_EXTRA = _project_extra
ws_api.ACCOUNTS = lambda: [{k: x.get(k) for k in ("id", "username", "display", "status")} for x in AUTH.list_users()]   # (v178) 공유 대상 고르기 — 이름만
dash_api.HUB_CHECK = HUB.check                         # (v178) 포털 건수는 토큰 주인 계정 것만
DASH = dash_api.Dash(DATA_DIR, WS, KV, TASKS, LLM, os.path.join(ROOT, "app-html"), RNDA)   # (v130) 연구 대시보드
STARTED = time.time()
APP_VERSION = "v181"
sso_api.APP_VERSION = APP_VERSION
import sitever                     # noqa: E402  (v152, G18) /version.json·화면 버전 = index.html 의 ?v= 값
sitever.FALLBACK = APP_VERSION      # (v148) G16 로그인 쪽 페이지 버전 뱃지
BACKUP.app = APP_VERSION
WS.snap = BACKUP                 # (v140) 프로젝트 되살리기도 새 스냅숏에서
CONTROL_TOKEN = os.environ.get("STUDY_CONTROL_TOKEN") or ""      # 런처가 넘겨 주는 '정상 종료' 열쇠(이 PC 에서만)
RESEARCH_KINDS = ("ws", "rnd", "dash", "aitask", "kb")   # (v143) 연구지원 기능 권한이 있어야 쓰는 API
READONLY_MSG = "데이터 점검에서 손상된 파일이 발견되어 저장을 멈췄습니다. 관리자가 백업에서 되살린 뒤 서버를 다시 켜야 합니다."
_client_logs = {}                # ip → [시각…] (브라우저 오류 보고 1분 60건)
SERVER = {"httpd": None}
VAULT_SHARED = os.path.normcase(VAULT_DIR) != os.path.normcase(os.path.join(ROOT, "userdata", "llm-vault"))
VAULT_ID = re.compile(r"^[a-f0-9]{64}$")
VAULT_MAX = 64 * 1024
_miss = {}                       # ip → [시각…] (없는 id 조회 — 마구 찔러 보기 방지)
_lock = threading.Lock()


def _too_many_misses(ip):
    now = time.time()
    with _lock:
        lst = [t for t in _miss.get(ip, []) if now - t < 60]
        _miss[ip] = lst
        return len(lst) >= 30


def _note_miss(ip):
    with _lock:
        _miss.setdefault(ip, []).append(time.time())


class NoCacheHandler(SimpleHTTPRequestHandler):
    server_version = "StudyServer/" + APP_VERSION
    sys_version = ""
    # 파일 형식을 명시 — 윈도 레지스트리가 .js 를 text/plain 으로 잡는 PC 가 있어, nosniff 와 만나면 스크립트가 막힌다
    extensions_map = dict(SimpleHTTPRequestHandler.extensions_map, **{
        ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
        ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".json": "application/json; charset=utf-8",
        ".jsonl": "application/x-ndjson; charset=utf-8", ".md": "text/markdown; charset=utf-8", ".txt": "text/plain; charset=utf-8",
        ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
        ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".pdf": "application/pdf",
        ".mp3": "audio/mpeg", ".wav": "audio/wav", ".wasm": "application/wasm"})
    # (v116) 연결 다시 쓰기(keep-alive) — HTTP/1.0 이면 파일 하나마다 새 연결이라, 터널 너머에서 수십 번 연결을 맺느라 느렸다.
    #   GET·HEAD 이고 길이(Content-Length)를 밝힌 응답만 연결을 남긴다. 나머지(쓰기·스트리밍)는 지금처럼 응답 뒤 닫는다
    #   — 읽지 않은 요청 본문이 다음 요청으로 섞이거나, 길이 없는 스트림을 받는 쪽이 끝을 기다리며 멈추지 않게.
    protocol_version = "HTTP/1.1"
    timeout = 60          # 쉬는 연결은 60초 뒤 닫는다(스레드가 쌓이지 않게)

    def send_header(self, keyword, value):
        if keyword.lower() == "content-length":
            self._has_len = True
        elif keyword.lower() == "cache-control":
            self._has_cc = True            # (v153) 응답이 직접 정했으면 기본값을 또 붙이지 않는다
        SimpleHTTPRequestHandler.send_header(self, keyword, value)

    def end_headers(self):
        if not (self.command in ("GET", "HEAD") and (getattr(self, "_has_len", False) or self._status in (204, 304))):
            SimpleHTTPRequestHandler.send_header(self, "Connection", "close")
            self.close_connection = True
        cc = getattr(self, "_cc", None)
        if cc:                                   # (v116) 정적 파일 — ?v=빌드 가 붙은 건 1년 보관, 나머지는 ETag 로 바뀐 것만
            self.send_header("Cache-Control", cc)
        elif not getattr(self, "_has_cc", False):
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
        if not cc or getattr(self, "_cdn", None):   # (v153, G19 6-2) 화면 파일·동적 응답은 Cloudflare 등 중간 캐시도 저장하지 않게
            self.send_header("CDN-Cache-Control", "no-store")
        # 보안 헤더 — 다른 사이트가 이 앱을 틀(iframe)에 넣거나, 파일 형식을 속이거나, 주소를 흘리지 못하게
        self.send_header("X-Content-Type-Options", "nosniff")
        if not getattr(self, "_no_xfo", False):   # 연동 자동 로그인(enter)은 CSP frame-ancestors 로 대신 막는다
            self.send_header("X-Frame-Options", "SAMEORIGIN")
        self.send_header("Referrer-Policy", "same-origin")
        if getattr(self, "_rid", None):
            self.send_header("X-Request-Id", self._rid)
        SimpleHTTPRequestHandler.end_headers(self)

    # ---- 요청 단위: 요청 id · 걸린 시간 · 접근 로그 ----------------------
    def handle_one_request(self):
        self._t0 = time.time(); self._rid = secrets.token_hex(4); self._status = None; self._is_api = False; self._cc = None; self._has_len = False; self._has_cc = False; self._cdn = None
        self.auth_user = None; self.auth_hash = None; self._no_xfo = False; self._emg_notice = None
        try:
            SimpleHTTPRequestHandler.handle_one_request(self)
        except (ConnectionResetError, BrokenPipeError, ConnectionAbortedError):
            pass
        except Exception:
            logkit.error("app", "요청 처리 중 예외", exc=True, rid=self._rid, path=logkit.safe_path(getattr(self, "path", "") or ""))
        finally:
            if getattr(self, "command", None) and self._status is not None:
                u = self.auth_user
                logkit.access(self.command, logkit.safe_path(self.path), self._status, int((time.time() - self._t0) * 1000),
                              auth_api.client_ip(self), user=u and u["id"], rid=self._rid, static=not self._is_api,
                              ua=(self.headers.get("User-Agent") or "")[:80] if self._status >= 400 else None)

    def send_response(self, code, message=None):
        self._status = code
        SimpleHTTPRequestHandler.send_response(self, code, message)

    def parse_request(self):
        # (v177) 걸린 시간은 요청 줄이 도착한 때부터 — 다시 쓰는 연결(keep-alive)에서 다음 요청을 기다린 시간까지
        # 처리 시간에 들어가 health 5~10초·auth status 1.7초처럼 실제보다 크게 기록되던 것을 바로잡는다
        self._t0 = time.time()
        return SimpleHTTPRequestHandler.parse_request(self)

    def log_message(self, fmt, *args):      # 기본 stderr 한 줄 로그 대신 access.log(handle_one_request)를 쓴다
        pass

    def log_error(self, fmt, *args):
        # (v174) 정상 동작은 경고로 남기지 않는다 — 쉬는 연결 60초 닫힘("Request timed out")은 평상시 일,
        # send_error 의 4xx("code 404, ...")는 access.log 에 이미 상태 코드로 남는다. 5xx·그 밖의 것만 경고.
        if fmt.startswith("Request timed out"):
            return
        if fmt.startswith("code %d") and args and isinstance(args[0], int) and 400 <= args[0] < 500:
            return
        logkit.warn("app", "HTTP 오류: " + (fmt % args), rid=getattr(self, "_rid", None), ip=self.client_address[0])

    # ---- /api/* ----------------------------------------------------------
    def _json(self, code, obj, headers=None):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        for k, v in (headers or []):
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _resolve_session(self):
        tok = auth_api.read_cookie(self)
        if tok:
            self.auth_user, self.auth_hash = AUTH.session_user(tok, auth_api.client_ip(self))
            if self.auth_user and self.auth_user.get("_emg"):          # (v169) 비상 세션: 통합로그인이 살아나면 끝, 역할은 저장본
                self.auth_user = EMG.session(self.auth_hash, self.auth_user, auth_api.client_ip(self))
                if not self.auth_user:
                    self.auth_hash, self._emg_notice = None, emergency_api.MSG_END
                return
            if self.auth_user and not SSO.check_session(self.auth_hash, auth_api.client_ip(self)):   # (v141) 16.9.1 권한이 빠진 통합로그인 계정 세션
                self.auth_user, self.auth_hash = None, None
            self.auth_user = SSO.effective(self.auth_user)   # 통합로그인이 켜져 있으면 관리자 권한은 ulogin 관리자만

    def _route(self, method):
        """요청 → (종류, 보관함 id, 동작). API 가 아니면 None.
        두 가지 주소를 같은 동작으로 받는다:
          · api.php?r=health · api.php?r=vault&id=..[&op=put|delete] (POST)  ← PHP 공용 호스팅과 같은 규칙(앱은 이걸 쓴다)
          · /api/health · /api/vault/<id> (GET/PUT/DELETE)                      ← v75 초기 규칙(호환)"""
        from urllib.parse import urlsplit, parse_qs
        u = urlsplit(self.path)
        if u.path.startswith("/ai/"):          # (v123) AI 배경 작업 ai-task/1
            return ("aitask", u.path[4:].strip("/"), method)
        if u.path.startswith("/sso/"):         # (v135) 통합로그인 ulogin-link/1
            return ("ssoweb", u.path[5:].strip("/"), method)
        if u.path.startswith("/hub/"):         # (v120) 계정 연동 hub-link/1
            return ("hublink", u.path[5:].strip("/"), method)
        if u.path.startswith("/v1/"):          # (v117) 연구 허브 서비스 API — OpenAI 호환 게이트웨이·자료 검색(slc_ 토큰, 이 PC 안에서만)
            return ("hub", u.path.rstrip("/"), method)
        if u.path.endswith("/api.php"):
            q = parse_qs(u.query)
            r = (q.get("r") or [""])[0]
            if r == "health":
                return ("health", None, "GET")
            if r == "ws":
                return ("ws", q, method)
            if r in ("auth", "llm", "log", "admin", "ctl", "kv", "kb", "rnd", "dash", "sso"):
                return (r, q, method)
            if r != "vault":
                return ("unknown", None, method)
            vid = (q.get("id") or [""])[0]
            op = (q.get("op") or [""])[0]
            verb = "GET" if method == "GET" else ({"put": "PUT", "delete": "DELETE"}.get(op, "BAD") if method == "POST" else "BAD")
            return ("vault", vid, verb)
        i = u.path.find("/api/")
        if i < 0:
            return None
        p = u.path[i:]
        if p == "/api/health":
            return ("health", None, "GET")
        if p == "/api/research/portal":
            return ("portal", None, method)
        m = re.match(r"^/api/vault/([^/]+)$", p)
        return ("vault", m.group(1), method) if m else ("unknown", None, method)

    def _vault_file(self, vid):
        return os.path.join(VAULT_DIR, vid + ".json")

    def _api(self, method):
        rt = self._route(method)
        if rt is None:
            return False
        kind, vid, verb = rt
        self._is_api = True
        self._resolve_session()
        ip = auth_api.client_ip(self)
        if kind != "hublink" and method in ("POST", "PUT", "DELETE") and not auth_api.same_origin_ok(self):   # 연동 경로는 표·코드·서명으로 따로 인증한다
            logkit.warn("security", "다른 출처의 쓰기 요청 차단", ip=ip, origin=self.headers.get("Origin"), path=logkit.safe_path(self.path))
            self._json(403, {"ok": False, "message": "요청 출처를 확인할 수 없어요."})
            return True
        if self._emg_notice and not (kind == "auth" and verb == "GET") and kind not in ("health", "sso"):     # (v169) 통합로그인 복구 → 비상 세션 끝
            self._json(401, {"ok": False, "error": "emergency_ended", "message": self._emg_notice})
            return True
        if self.auth_user and self.auth_user.get("emergency") and EMG.blocked(kind, vid, verb if kind == "vault" else method):   # (v169) 비상 세션에서 막는 일
            logkit.audit("auth.emergency_blocked", ok=False, ip=ip, user=self.auth_user["id"], kind=kind)
            self._json(409, {"ok": False, "error": "emergency", "message": emergency_api.MSG_BLOCK})
            return True
        if kind in RESEARCH_KINDS and self.auth_user and "research" not in auth_api.features_of(self.auth_user):   # (v143) 연구지원 권한 없는 계정
            self._json(403, {"ok": False, "error": "feature_denied", "message": "이 계정에는 연구지원 기능 권한이 없어요. 관리자에게 요청하세요."})
            return True
        if safeio.READONLY and method in ("POST", "PUT", "DELETE") and kind not in ("auth", "log", "ssoweb") \
                and not (kind == "admin" and (vid.get("op") or [""])[0].startswith("backup")):
            self._json(503, {"ok": False, "error": "readonly", "message": READONLY_MSG})
            return True
        if kind == "health":
            self._json(200, {"ok": True, "vault": True, "store": "file", "shared": VAULT_SHARED, "auth": True, "version": APP_VERSION,
                             "lan": "--lan" in sys.argv, "ws": True, "llm_proxy": True, "readonly": bool(safeio.READONLY), "engine": DBCONF.get("engine", "files"), "folder": os.path.basename(VAULT_DIR.rstrip("\\/"))})
            return True
        if kind in ("auth", "llm", "ws", "log", "admin", "ctl", "kv", "kb", "rnd", "hub", "hublink", "aitask", "dash", "portal", "sso", "ssoweb"):
            try:
                if kind == "auth":
                    auth_api.handle(AUTH, self, vid, verb)
                elif kind == "llm":
                    llm_api.handle(LLM, self, vid, verb)
                elif kind == "ws":
                    if not self.auth_user:
                        self._json(401, {"ok": False, "error": "no_session", "message": "로그인이 필요해요(서버 세션이 끝났어요 — 다시 로그인)."})
                    else:
                        ws_api.handle(WS, self, vid, verb)
                elif kind == "log":
                    self._client_log(vid, verb, ip)
                elif kind == "admin":
                    self._admin(vid, verb, ip)
                elif kind == "dash":
                    dash_api.handle(DASH, self, vid, verb)
                elif kind == "ssoweb":
                    sso_api.handle_web(SSO, self, vid, verb)
                elif kind == "sso":
                    sso_api.handle_api(SSO, self, vid, verb)
                elif kind == "portal":
                    dash_api.handle_portal(DASH, AUTH, self, verb, APP_VERSION)
                elif kind == "kv":
                    kv_api.handle(KV, self, vid, verb, logkit)
                elif kind == "kb":
                    if (vid.get("op") or [""])[0] in ("issues", "issue_sync", "issue_link", "issue_new", "issue_unlink") and self.auth_user:
                        kanban_api.handle_issue(KB, WS, self, vid, verb, logkit)
                    else:
                        kanban_api.handle(KB, self, vid, verb, logkit)
                elif kind == "rnd":
                    rnd_api.handle_rnd(RNDA, WS, self, vid, verb, logkit)
                elif kind == "hub":
                    rnd_api.handle_hub(HUB, self, vid, verb, logkit)
                elif kind == "hublink":
                    hublink_api.handle(LINK, self, vid, verb)
                elif kind == "aitask":
                    aitask_api.handle(TASKS, self, vid, verb)
                else:
                    self._ctl(vid, verb)
            except (ConnectionResetError, BrokenPipeError, ConnectionAbortedError):
                pass
            except safeio.ReadOnly:
                try: self._json(503, {"ok": False, "error": "readonly", "message": READONLY_MSG})
                except Exception: pass
            except Exception as e:          # 오류가 서버를 죽이지 않게 — 자세한 내용은 error.log 에
                logkit.error(kind, "API 처리 오류", exc=True, rid=self._rid, ip=ip, user=self.auth_user and self.auth_user["id"])
                try: self._json(500, {"ok": False, "message": "서버 오류(요청 id %s) — 로그를 확인하세요." % self._rid, "rid": self._rid, "detail": str(e)[:120]})
                except Exception: pass
            return True
        if kind != "vault":
            self._json(404, {"ok": False, "message": "없는 API"})
            return True
        if not VAULT_ID.match(vid or ""):
            self._json(400, {"ok": False, "message": "잘못된 보관함 id"})
            return True
        ip = self.client_address[0]
        f = self._vault_file(vid)
        if verb == "GET":
            if _too_many_misses(ip):
                self._json(429, {"ok": False, "message": "잠시 후 다시 시도하세요"})
                return True
            if not vfs.exists(f):
                _note_miss(ip)
                self._json(404, {"ok": False, "message": "없음"})
                return True
            with open(f, "r", encoding="utf-8") as fh:
                self._json(200, {"ok": True, "record": json.load(fh)})
            return True
        if self.headers.get("X-Study-Vault") != "1":
            self._json(403, {"ok": False, "message": "헤더 없음"})
            return True
        if not self.auth_user:
            self._json(401, {"ok": False, "error": "no_session", "message": "로그인이 필요해요."})
            return True
        if verb == "DELETE":
            if vfs.exists(f):
                vfs.remove(f)
            self._json(200, {"ok": True})
            return True
        if verb == "PUT":
            n = int(self.headers.get("Content-Length") or 0)
            if n <= 0 or n > VAULT_MAX:
                self._json(413, {"ok": False, "message": "크기 초과"})
                return True
            raw = self.rfile.read(n).decode("utf-8", "replace")
            try:
                rec = json.loads(raw)
            except ValueError:
                self._json(400, {"ok": False, "message": "JSON 아님"})
                return True
            enc = rec.get("enc") if isinstance(rec, dict) else None
            if not isinstance(enc, dict) or not all(isinstance(enc.get(k), str) for k in ("alg", "iv", "salt", "ct")):
                self._json(400, {"ok": False, "message": "암호문(enc)만 받아요"})
                return True
            if "api_key" in raw or "plain" in rec:      # 평문 키가 섞여 있으면 저장하지 않는다
                self._json(400, {"ok": False, "message": "평문이 섞여 있어 거부"})
                return True
            keep = {"v": 1, "kind": "study.llmvault", "updated": rec.get("updated"), "count": rec.get("count"),
                    "active_id": rec.get("active_id"), "enc": {k: enc[k] for k in ("alg", "kdf", "iter", "iv", "salt", "ct") if k in enc}}
            safeio.atomic_json(f, keep)
            self._json(200, {"ok": True})
            return True
        self._json(405, {"ok": False, "message": "허용 안 됨"})
        return True





    # ---- 브라우저 오류 보고(v92) — client.log ---------------------------------
    def _client_log(self, q, verb, ip):
        if verb != "POST" or self.headers.get("X-Study-Vault") != "1":
            self._json(405, {"ok": False}); return
        if (q.get("op") or [""])[0] == "activity":
            self._activity(ip); return
        now = time.time()
        with _lock:
            lst = [t for t in _client_logs.get(ip, []) if now - t < 60]
            if len(lst) >= 60:
                self._json(429, {"ok": False}); return
            lst.append(now); _client_logs[ip] = lst
        b = auth_api.body_json(self, 64 * 1024)
        u = self.auth_user and self.auth_user["id"]
        for it in (b.get("items") or [])[:20]:
            if not isinstance(it, dict):
                continue
            lvl = "ERROR" if it.get("lvl") == "error" else "WARNING" if it.get("lvl") == "warn" else "INFO"
            logkit.log("client", lvl, str(it.get("msg") or "")[:500], user=u, ip=ip, src=str(it.get("src") or "")[:160], line=it.get("line"),
                       view=str(it.get("view") or "")[:40], build=str(it.get("build") or "")[:20], stack=str(it.get("stack") or "")[:1500])
        self._json(200, {"ok": True})

    # ---- (v92) 조작 감사 — 브라우저가 묶어 보낸 조작 기록 → activity.log -------------
    def _activity(self, ip):
        now = time.time()
        key = "act:" + ip
        with _lock:
            lst = [t for t in _client_logs.get(key, []) if now - t < 60]
            if len(lst) >= 60:          # 한 번에 최대 80건 묶음 × 분당 60번
                self._json(429, {"ok": False}); return
            lst.append(now); _client_logs[key] = lst
        b = auth_api.body_json(self, 256 * 1024)
        u = self.auth_user
        sid = (self.auth_hash or "")[:10] or None
        n = 0
        for it in (b.get("items") or [])[:80]:
            if not isinstance(it, dict):
                continue
            f = {k: (str(v)[:160] if not isinstance(v, (int, float, bool)) else v) for k, v in it.items() if k in ("v", "m", "l", "id", "d", "t", "k", "n", "val", "doc", "pid")}
            if isinstance(it.get("d"), dict):
                f["d"] = {str(k)[:30]: str(v)[:120] for k, v in list(it["d"].items())[:8]}
            logkit.activity(str(it.get("a") or "event")[:40], user=u and u["id"], username=u and u["username"], ip=ip, sess=sid, src="browser", **f)
            n += 1
        self._json(200, {"ok": True, "n": n})

    # ---- 관리자 서버 정보(v92) ----------------------------------------------
    def _admin(self, q, verb, ip):
        u = self.auth_user
        if not u or u.get("role") != "admin":
            self._json(403, {"ok": False, "message": "관리자만 볼 수 있어요."}); return
        op = (q.get("op") or [""])[0]
        if op == "info":
            sizes = {}
            for n in logkit.FILES:
                f = os.path.join(LOG_DIR, n + ".log")
                sizes[n] = vfs.getsize(f) if vfs.exists(f) else 0
            self._json(200, {"ok": True, "version": APP_VERSION, "uptime": int(time.time() - STARTED), "python": sys.executable,
                             "data_dir": DATA_DIR, "log_dir": LOG_DIR, "log_sizes": sizes, "auth": AUTH.stats(), "ws": WS.health(),
                             "cli": llm_api.cli_info(), "lan": "--lan" in sys.argv, "remote": auth_api.is_remote(self), "pid": os.getpid(),
                             "port": dict(portreg.SELF_PORT), "ports": portreg.status(), "backup": BACKUP.info(), "engine": DBCONF.get("engine", "files")})
            return
        if op == "backup_list":            # (v140) 시간별·일별·월별 스냅숏
            self._json(200, {"ok": True, "list": BACKUP.list(), "info": BACKUP.info()}); return
        if op in ("backup_now", "backup_check", "backup_mirror"):
            if verb != "POST" or self.headers.get("X-Study-Vault") != "1":
                self._json(403, {"ok": False, "message": "헤더 없음"}); return
            if op == "backup_check":
                h = BACKUP.startup_check()
                self._json(200, {"ok": True, "health": h, "readonly": safeio.READONLY}); return
            if op == "backup_mirror":
                m = str((auth_api.body_json(self) or {}).get("mirror") or "").strip()
                if m and not os.path.isabs(m):
                    self._json(400, {"ok": False, "message": "다른 디스크 사본 위치는 전체 경로로 적어 주세요."}); return
                BACKUP.set_conf({"mirror": m})
                logkit.audit("backup_mirror", user=u["id"], ip=ip, mirror=m)
                self._json(200, {"ok": True, "mirror": m, "result": BACKUP.mirror() if m else None}); return
            if safeio.READONLY:
                self._json(503, {"ok": False, "error": "readonly", "message": READONLY_MSG}); return
            r = BACKUP.make(force=True)
            logkit.audit("backup_now", user=u["id"], ip=ip, ok=bool(r.get("ok")), id=r.get("id"))
            self._json(200 if r.get("ok") else 500, dict(r, ok=bool(r.get("ok")), message=None if r.get("ok") else "깨진 파일이 있어 백업하지 않았습니다: " + ", ".join(b["path"] for b in r.get("bad", [])[:3])))
            return
        if op.startswith("hub_"):              # (v117) 연구 허브 — 게이트웨이 켜기·토큰 발급(로그인한 관리자만)
            if op != "hub_status" and (verb != "POST" or self.headers.get("X-Study-Vault") != "1"):
                self._json(403, {"ok": False, "message": "헤더 없음"}); return
            rnd_api.handle_hubadmin(HUB, self, op[4:], auth_api.body_json(self) if verb == "POST" else {}, logkit, ip)
            return
        self._json(404, {"ok": False, "message": "없는 동작"})

    # ---- 런처의 정상 종료 요청(이 PC + 런처가 준 열쇠) -------------------------
    def _ctl(self, q, verb):
        op = (q.get("op") or [""])[0]
        if verb != "POST" or op != "shutdown" or not CONTROL_TOKEN or auth_api.is_remote(self) \
                or not secrets.compare_digest(self.headers.get("X-Study-Control") or "", CONTROL_TOKEN):
            self._json(403, {"ok": False}); return
        logkit.info("app", "런처 요청으로 서버를 멈춥니다")
        self._json(200, {"ok": True})
        threading.Thread(target=lambda: (time.sleep(0.3), SERVER["httpd"] and SERVER["httpd"].shutdown()), daemon=True).start()

    # (v153, G20 6-2) 코드 폴더 파일 공개 차단 — 문서·설정·도구·DB 파일은 웹으로 내주지 않는다(404).
    #   글·데이터 파일(.md·.txt·.json·.jsonl·.csv)은 화면이 실제로 읽는 자리(ALLOW_DATA)만 연다. 웹 뿌리는 app-html — 데이터 폴더·백업·tools 는 그 밖이다.
    _NEVER_EXT = (".py", ".pyc", ".sql", ".env", ".sqlite", ".sqlite3", ".db", ".key", ".pem", ".crt", ".yml", ".yaml", ".log", ".bak", ".php",
                  ".ps1", ".bat", ".cmd", ".sh", ".ini", ".cfg", ".toml", ".zip", ".7z", ".tmp", ".kv.json", ".kv.prev")
    _DATA_EXT = (".md", ".txt", ".json", ".jsonl", ".csv")
    _ALLOW_DATA = re.compile(r"^/(?:help/[^/]+\.(?:md|json)|help/templates/[^/]+|library/catalog\.json|ui/menu\.json)$")

    def _blocked(self):
        # PHP 호스팅용 보관함 폴더(app-html/_vault)·설정(api-config.php)은 이 서버가 PHP 를 실행하지 않으니 정적으로도 내주지 않는다
        from urllib.parse import unquote
        p = unquote(self.path.split("?", 1)[0]).lower().replace("\\", "/")
        if p.endswith("/api.php"):              # API 경로(정적 파일이 아니다)
            return False
        if "/_vault" in p or "/." in p or p.endswith(self._NEVER_EXT):
            return True
        if p.endswith(self._DATA_EXT) and not p.startswith(("/api/", "/hub/", "/sso/", "/ai/", "/v1/")) and p != "/version.json":
            return not self._ALLOW_DATA.match(p)
        return False

    def do_GET(self):
        if self._blocked():
            self._json(404, {"ok": False}); return
        if self.path.split("?", 1)[0] == "/version.json":       # (v152, G18 6-2) 공용 새 버전 알림 — 로그인 없이, 버전 말고 아무것도 없이
            b = json.dumps({"version": sitever.get()}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)
            return
        if self.path.split("?", 1)[0] == "/local-admin":        # (v179) 비상용 관리자 비밀번호 — 서버 PC 브라우저만(그 밖은 404)
            local_admin.handle(AUTH, self, "GET"); return
        if not self._api("GET"):
            if not self._static():
                SimpleHTTPRequestHandler.do_GET(self)

    # (v116) 정적 파일 빠른 길 — 예전에는 모든 파일을 no-store·압축 없이 보내서, 터널(Cloudflare) 너머로 열 때마다 3.7MB 를 다시 받았다.
    #   · ?v=<빌드> 가 붙은 js·css(bump-assets.py 가 붙인다): 1년 보관(immutable) — 빌드 번호가 바뀌면 주소가 바뀌어 새로 받는다
    #   · 그 밖의 정적 파일·index.html: no-cache + ETag → 바뀌지 않았으면 304(본문 없음)
    #   · 글 파일(js·css·html·json·svg·md·txt)은 gzip(메모리에 한 번만 압축해 둔다)
    _GZ = {}
    _GZ_TYPES = ("text/", "application/json", "application/x-ndjson", "image/svg+xml", "application/wasm")

    def _static(self):
        if self.headers.get("Range"):
            return False
        from urllib.parse import urlsplit
        u = urlsplit(self.path)
        path = self.translate_path(u.path)
        if vfs.isdir(path):
            idx = os.path.join(path, "index.html")
            if not u.path.endswith("/") or not vfs.isfile(idx):
                return False
            path = idx
        if not vfs.isfile(path):
            return False
        ctype = self.guess_type(path)
        if ctype.startswith(("audio/", "video/")):
            return False
        try:
            st = vfs.stat(path)
        except OSError:
            return False
        versioned = bool(re.search(r"(^|&)v=[A-Za-z0-9._-]+", u.query or "")) and not ctype.startswith("text/html")   # (v153) 빌드 값이 v153.337 꼴이라 예전 v=\d 는 늘 빗나갔다
        self._cc = "public, max-age=31536000, immutable" if versioned else "no-cache"
        if ctype.startswith("text/html"):
            self._cdn = "no-store"
        gz = "gzip" in (self.headers.get("Accept-Encoding") or "") and ctype.startswith(self._GZ_TYPES) and st.st_size > 1024
        etag = '"%x-%x%s"' % (int(st.st_mtime * 1000), st.st_size, "-gz" if gz else "")
        if etag in [x.strip() for x in (self.headers.get("If-None-Match") or "").split(",")]:
            self.send_response(304)
            self.send_header("ETag", etag)
            self.end_headers()
            return True
        try:
            if gz:
                key = (path, st.st_mtime, st.st_size)
                body = self._GZ.get(key)
                if body is None:
                    import gzip
                    with open(path, "rb") as fh:
                        body = gzip.compress(fh.read(), 6)
                    if len(self._GZ) > 400:
                        self._GZ.clear()
                    self._GZ[key] = body
            else:
                with open(path, "rb") as fh:
                    body = fh.read()
        except OSError:
            return False
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("ETag", etag)
        self.send_header("Last-Modified", self.date_time_string(st.st_mtime))
        if gz:
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Vary", "Accept-Encoding")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass
        return True

    def do_HEAD(self):
        if self.path.split("?", 1)[0] == "/version.json":       # (v153) curl -sI 로 확인해도 GET 과 같은 머리글
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(json.dumps({"version": sitever.get()}).encode("utf-8"))))
            self.end_headers()
            return
        if self._blocked() or self._route("HEAD") is not None:
            self.send_response(404 if self._blocked() else 405); self.end_headers()
        else:
            SimpleHTTPRequestHandler.do_HEAD(self)

    def do_PUT(self):
        if not self._api("PUT"):
            self.send_response(405); self.end_headers()

    def do_DELETE(self):
        if not self._api("DELETE"):
            self.send_response(405); self.end_headers()

    def do_POST(self):
        if self.path.split("?", 1)[0] == "/local-admin":
            local_admin.handle(AUTH, self, "POST"); return
        if not self._api("POST"):
            self.send_response(405); self.end_headers()


def main():
    for st in (sys.stdout, sys.stderr):                       # 윈도 콘솔(cp949)에서 한글·기호 출력하다 죽지 않게
        try:
            st.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    # (v137) 포트 등록부(port-registry/1): SK_PORT → 명령줄 → 서버 지킴이 /api/ports/learning-center(1초) → 기본 18162
    port, port_src = portreg.own_port(args[0] if args else None)
    portreg.SELF_PORT.update(port=port, src=port_src)
    HUB.port = port
    if safeio.READONLY:
        _last = (BACKUP.list() or [{}])[0].get("name") or "<스냅숏 이름>"
        print("\n[데이터 점검] 깨진 파일이 있어 저장을 멈췄습니다(읽기만 됩니다). 자동으로 덮어쓰지 않습니다.")
        for b in HEALTH["bad"][:10]:
            print("  · %s — %s" % (b["path"], b["why"]))
        print("  최근 백업: %s   (백업 폴더 %s)" % (_last, BACKUP.dir))
        print("  되살리기: 서버를 끈 뒤  python tools/restore.py --file <위 경로> --snapshot %s   (지금 파일은 _trash/ 로 옮겨 둡니다)" % _last)
        print("  전체 목록: python tools/restore.py --list    점검만: python tools/restore.py --check\n")
    else:
        TASKS.start()
        try:
            _n = SSO.sweep_migrate()       # (v156) 통합로그인으로 묶인 계정 완전 이관(이미 묶인 계정 정리)
            if _n:
                logkit.info("sso", "묶인 계정 이관", n=_n)
        except Exception as _e:
            logkit.warn("sso", "이관 정리 실패", err=str(_e)[:200])
        LLM.aim.start()         # (v169) 비상 AI 묶음 1시간마다(AI 관리시스템 emergency/1 2-2)
        PLAT.start()            # (v157) 스풀을 1초마다 보고 50건·10초·5초 간격 규칙대로 통합로그인에 보낸다(본 요청 경로와 무관)
        ULINK.start()           # (v145) 기동 30초 뒤 계정 목록 전체 전송, 60초마다 바뀐 계정만, 3분마다 연결 사건
        BACKUP.start()          # (v140) 1시간마다 스냅숏(바뀐 것이 있을 때) + 그날·그달 첫 스냅숏을 일별·월별로
    host = "0.0.0.0" if "--lan" in sys.argv else "127.0.0.1"
    handler = partial(NoCacheHandler, directory=os.path.join(ROOT, "app-html"))
    print("serving app-html/ at http://%s:%d  (no-cache, 포트 출처: %s)" % (host, port, port_src))
    print("AI 연결 보관함 폴더: %s%s" % (VAULT_DIR, "  ← 공유(동기화) 폴더" if VAULT_SHARED else "  (이 PC 전용 — 다른 PC 와 나누려면 --vault-dir)"))
    print("데이터 폴더: %s  (계정·연구·AI 연결·로그 — 이 폴더를 통째로 복사하면 이사 끝)" % DATA_DIR)
    print("로그 폴더: %s" % LOG_DIR)
    print("백업 폴더: %s  (1시간마다·일별·월별, 저장 방식: %s)" % (BACKUP.dir, DBCONF.get("engine", "files")))
    sys.stdout.flush()
    # 스레드 서버 — 단일 스레드면 브라우저가 미리 열어 둔(preconnect) 빈 연결 하나에 묶여 로딩이 멈춘다
    # (v100) 같은 포트에 두 번째 서버가 조용히 붙지 않게 — 윈도우의 SO_REUSEADDR 는 이미 쓰는 포트도 함께 열어 버린다(두 서버가 번갈아 응답)
    class _Server(ThreadingHTTPServer):
        allow_reuse_address = os.name != "nt"
        def server_bind(self):
            if os.name == "nt" and hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
                self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            ThreadingHTTPServer.server_bind(self)
    try:
        httpd = _Server((host, port), handler)
    except OSError as e:
        logkit.error("app", "포트 %d 를 열지 못했어요(이미 다른 프로그램이 쓰는 중?)" % port, err=str(e))
        sys.exit(2)
    httpd.daemon_threads = True
    SERVER["httpd"] = httpd
    # (v116) ::1 에서도 받는다 — 윈도에서 'localhost' 는 IPv6(::1)부터 시도해서, 127.0.0.1 만 열려 있으면 연결마다 약 0.2초씩 기다린다
    #   (터널 cloudflared 가 localhost 로 붙으면 파일·요청 하나하나가 그만큼 늦었다). 이 PC 안에서만 들리는 주소라 노출 범위는 같다.
    if host == "127.0.0.1" and socket.has_ipv6:
        class _Server6(_Server):
            address_family = socket.AF_INET6
        try:
            h6 = _Server6(("::1", port), handler); h6.daemon_threads = True
            threading.Thread(target=h6.serve_forever, name="http-v6", daemon=True).start()
        except OSError as e:
            logkit.warn("app", "::1 주소는 열지 못했어요(IPv4 로만 받아요)", err=str(e))
    st = AUTH.stats()
    logkit.info("app", "서버 시작", version=APP_VERSION, url="http://%s:%d" % (host, port), port_src=port_src, pid=os.getpid(), python=sys.executable,
                data_dir=DATA_DIR, users=st["users"], lan="--lan" in sys.argv)
    if st["default_pw"]:
        logkit.warn("security", "초기 비밀번호를 쓰는 관리자 계정이 있어요 — 이 PC 에서만 로그인됩니다. [설정 → 계정·보안]에서 바꾸세요.")
    if "--lan" in sys.argv:
        logkit.warn("security", "LAN 모드: 같은 네트워크의 다른 기기가 접속할 수 있어요")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        logkit.info("app", "서버 종료", uptime=int(time.time() - STARTED))


if __name__ == "__main__":
    main()
