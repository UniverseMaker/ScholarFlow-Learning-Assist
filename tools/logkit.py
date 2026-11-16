# -*- coding: utf-8 -*-
"""서버 로깅(v92) — 구조화(JSON Lines) · 분류별 파일 · 크기 회전 · 민감정보 가림.

<DATA_DIR>/logs/
  server.log    모든 분류의 INFO 이상(한눈에 보기)
  error.log     WARNING 이상만(문제 찾기)
  access.log    HTTP 요청 한 줄씩(API 는 전부, 정적 파일은 4xx/5xx 만 — --log-static 이면 전부)
  audit.log     보안 감사: 로그인 성공/실패·잠김·비밀번호 변경·계정/권한 변경·AI 연결 정보 변경·관리자 조치
  llm.log       AI 호출(누가·어떤 연결·모델·걸린 시간·글자 수 — 대화 내용은 남기지 않는다)
  client.log    브라우저에서 보낸 오류(window.onerror·unhandledrejection)
  activity.log  ★ 조작 감사: 연구지원·자료 학습의 모든 조작(화면 열기·버튼·설정 변경·업로드·내려받기·문서 저장…)
                 + 서버 쪽 저장소 쓰기. 입력한 글 내용은 남기지 않는다(칸 이름·글자 수만, 비밀번호는 '입력함'만).
한 줄 = JSON {"ts","lvl","cat","msg", ...필드}. 5MB 마다 회전, 10개 보관(.1 ~ .10).
감사용 audit.log · activity.log 는 **하루 단위 파일**(audit.log.2026-11-02 …)로 넘기고 10년(3650개) 보관한다.
가림: 키 이름이 password/secret/token/api_key/authorization/cookie/key 류면 값을 "***" 로,
      문자열 안의 'sk-…', 'Bearer …', 긴 hex 토큰도 가린다. 런처(GUI)는 이 파일들을 읽기만 한다.
"""
import json
import logging
import logging.handlers
import os
import re
import sys
import time

MAX_BYTES = 5 * 1024 * 1024
BACKUPS = 10
FILES = ("server", "error", "access", "audit", "activity", "llm", "client")
KEEP_DAYS = 3650
_SENSITIVE_KEY = re.compile(r"(pass(word)?|secret|token|api[_-]?key|authorization|cookie|^key$|^pw$|sid)", re.I)
_SENSITIVE_VAL = [
    (re.compile(r"sk-[A-Za-z0-9_\-]{6,}"), "sk-***"),
    (re.compile(r"(?i)bearer\s+[A-Za-z0-9._\-]{6,}"), "Bearer ***"),
    (re.compile(r"(?i)(study_sid=)[A-Za-z0-9_\-]+"), r"\1***"),
]
_state = {"dir": None, "ready": False, "log_static": False}
SINK = None      # (v157) platlog.Platlog — 통합로그인 로그·감사 이원화 스풀(같은 event_id). 없으면 로컬만


def redact(v, key=""):
    if key and _SENSITIVE_KEY.search(str(key)):
        return "***" if v not in (None, "", False) else v
    if isinstance(v, str):
        for rx, rep in _SENSITIVE_VAL:
            v = rx.sub(rep, v)
        return v[:4000]
    if isinstance(v, dict):
        return {k: redact(x, k) for k, x in list(v.items())[:60]}
    if isinstance(v, (list, tuple)):
        return [redact(x) for x in list(v)[:60]]
    return v


class JsonFormatter(logging.Formatter):
    def format(self, rec):
        t = time.localtime(rec.created)
        d = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S", t) + ".%03d" % rec.msecs, "lvl": rec.levelname, "cat": getattr(rec, "cat", rec.name.split(".")[-1]),
             "msg": redact(rec.getMessage())}
        f = getattr(rec, "fields", None)
        if f:
            for k, v in f.items():
                if k not in d:
                    d[k] = redact(v, k)
        if rec.exc_info:
            d["exc"] = redact(self.formatException(rec.exc_info))[-3000:]
        return json.dumps(d, ensure_ascii=False, default=str)


class ConsoleFormatter(logging.Formatter):
    def format(self, rec):
        f = getattr(rec, "fields", None) or {}
        tail = " ".join("%s=%s" % (k, redact(v, k)) for k, v in f.items() if v not in (None, ""))
        s = "%s %-5s %-6s %s%s" % (time.strftime("%H:%M:%S", time.localtime(rec.created)), rec.levelname[:5], getattr(rec, "cat", ""), redact(rec.getMessage()), ("  " + tail) if tail else "")
        if rec.exc_info:
            s += "\n" + self.formatException(rec.exc_info)
        return s


class _CatFilter(logging.Filter):
    def __init__(self, cats):
        super().__init__(); self.cats = set(cats)

    def filter(self, rec):
        return getattr(rec, "cat", "") in self.cats


def _handler(path, level=logging.INFO, cats=None, daily=False):
    if daily:   # 감사 로그 — 날짜별 파일, 오래 보관
        h = logging.handlers.TimedRotatingFileHandler(path, when="midnight", backupCount=KEEP_DAYS, encoding="utf-8", delay=True)
    else:
        h = logging.handlers.RotatingFileHandler(path, maxBytes=MAX_BYTES, backupCount=BACKUPS, encoding="utf-8", delay=True)
    h.setLevel(level); h.setFormatter(JsonFormatter())
    if cats:
        h.addFilter(_CatFilter(cats))
    return h


def setup(log_dir, console=True, log_static=False, level=logging.INFO):
    """한 번만 부른다(serve.py main). 같은 프로세스에서 다시 부르면 무시."""
    if _state["ready"]:
        return log_dir
    os.makedirs(log_dir, exist_ok=True)
    _state.update(dir=log_dir, ready=True, log_static=bool(log_static))
    root = logging.getLogger("study")
    root.setLevel(logging.DEBUG); root.propagate = False
    # server.log: 접근 로그는 너무 많아 뺀다(문제 있는 요청은 WARNING 으로 error.log 에 간다)
    root.addHandler(_handler(os.path.join(log_dir, "server.log"), level, cats=["app", "auth", "audit", "llm", "ws", "vault", "client", "security", "launcher", "sso", "platlog", "backup"]))
    root.addHandler(_handler(os.path.join(log_dir, "error.log"), logging.WARNING))
    root.addHandler(_handler(os.path.join(log_dir, "access.log"), logging.DEBUG, cats=["access"]))
    root.addHandler(_handler(os.path.join(log_dir, "audit.log"), logging.DEBUG, cats=["audit"], daily=True))
    root.addHandler(_handler(os.path.join(log_dir, "activity.log"), logging.DEBUG, cats=["activity"], daily=True))
    root.addHandler(_handler(os.path.join(log_dir, "llm.log"), logging.DEBUG, cats=["llm"]))
    root.addHandler(_handler(os.path.join(log_dir, "client.log"), logging.DEBUG, cats=["client"]))
    try:                                    # (v157) 데이터 폴더의 logs 면 통합로그인 이원화 스풀을 건다(서버·명령 도구 공통)
        if os.path.isdir(os.path.join(os.path.dirname(os.path.abspath(log_dir)), "system")):
            import platlog
            platlog.install(os.path.dirname(os.path.abspath(log_dir)))
    except Exception:
        pass
    if console:
        ch = logging.StreamHandler(sys.stdout)
        ch.setLevel(level); ch.setFormatter(ConsoleFormatter())
        ch.addFilter(_CatFilter(["app", "auth", "audit", "llm", "ws", "vault", "client", "security", "access-warn", "launcher"]))
        root.addHandler(ch)
    return log_dir


def log(cat, level, msg, exc=False, **fields):
    lg = logging.getLogger("study." + cat)
    if isinstance(level, str):
        level = getattr(logging, level.upper(), logging.INFO)
    sink = SINK
    try:
        if sink is not None and sink.want(cat, level):
            if not fields.get("event_id"):
                import uuid
                fields["event_id"] = str(uuid.uuid4())      # 로컬 줄과 스풀 줄이 같은 event_id
        else:
            sink = None
    except Exception:
        sink = None
    lg.log(level, msg, extra={"cat": cat, "fields": fields}, exc_info=exc)
    if sink is not None:
        sink.put(cat, level, msg, fields, time.time())       # 실패는 안에서 삼킨다


def info(cat, msg, **f): log(cat, logging.INFO, msg, **f)
def warn(cat, msg, **f): log(cat, logging.WARNING, msg, **f)
def error(cat, msg, exc=False, **f): log(cat, logging.ERROR, msg, exc=exc, **f)


def audit(event, ok=True, user=None, ip=None, **fields):
    """보안 감사 한 줄. event 예: login, login_fail, lockout, logout, password_change, user_create, role_change, llm_profile_save …"""
    log("audit", logging.INFO if ok else logging.WARNING, event, event=event, ok=bool(ok), user=user, ip=ip, **fields)


def activity(action, user=None, ip=None, **fields):
    """조작 감사 한 줄(activity.log). action 예: view, click, change, upload, ws.doc, ws.export …"""
    log("activity", logging.INFO, action, user=user, ip=ip, **fields)


def access(method, path, status, ms, ip, user=None, rid=None, size=None, static=False, ua=None):
    if static and status < 400 and not _state["log_static"]:
        return
    lvl = logging.WARNING if status >= 500 else logging.INFO
    log("access", lvl, "%s %s %d" % (method, path, status), method=method, path=path, status=status, ms=ms, ip=ip, user=user, rid=rid, size=size, ua=ua)
    if status >= 500:
        log("app", logging.ERROR, "요청 처리 실패 %s %s → %d" % (method, path, status), rid=rid, ip=ip, user=user)


def safe_path(path):
    """접근 로그용 경로 — 질의 문자열의 비밀 성격 값(token·id·name 은 길이만)을 가린다."""
    if "?" not in path:
        return path[:300]
    base, q = path.split("?", 1)
    parts = []
    for kv in q.split("&")[:20]:
        k, _, v = kv.partition("=")
        if _SENSITIVE_KEY.search(k) or k in ("id",) and len(v) > 20:
            v = "***"
        parts.append(k + ("=" + v[:60] if v else ""))
    return (base + "?" + "&".join(parts))[:300]


def tail(name, lines=200, level=None, grep=None, user=None, day=None):
    """관리자 화면용 — 파일 끝에서 N줄(JSON 파싱). day='YYYY-MM-DD' 면 그날의 감사 파일(audit/activity.log.YYYY-MM-DD)."""
    if name not in FILES or not _state["dir"]:
        return []
    if day and not re.match(r"^\d{4}-\d{2}-\d{2}$", day):
        return []
    p = os.path.join(_state["dir"], name + ".log" + ("." + day if day else ""))
    if not os.path.exists(p):
        return []
    with open(p, "rb") as fh:
        fh.seek(0, 2); size = fh.tell(); fh.seek(max(0, size - 1024 * 1024))
        raw = fh.read().decode("utf-8", "replace").splitlines()
    out = []
    order = {"DEBUG": 0, "INFO": 1, "WARNING": 2, "ERROR": 3, "CRITICAL": 4}
    for ln in reversed(raw):
        try:
            d = json.loads(ln)
        except ValueError:
            continue
        if level and order.get(d.get("lvl"), 1) < order.get(level, 1):
            continue
        if grep and grep.lower() not in ln.lower():
            continue
        if user and d.get("user") != user:
            continue
        out.append(d)
        if len(out) >= lines:
            break
    return out
