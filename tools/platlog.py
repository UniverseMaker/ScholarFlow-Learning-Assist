# -*- coding: utf-8 -*-
"""(v157) 로그·감사 이원화 — 통합로그인 v1.9.0 수집 API(계약 116s0 0장). 사용자 지시 2026-11-11.

  정본은 이 시스템(logs/*.log). 같은 사건(같은 event_id)을 스풀에 넣고 서버 작업자가 비동기로 보낸다.
  보내는 것  감사 = audit.log(보안 감사) 전부 + activity.log(조작 감사) 전부  → POST /server/api/platform/audit.php
             로그 = 모든 분류의 WARNING 이상(error.log 와 같은 범위)       → POST /server/api/platform/logs.php
  스풀       <데이터>/spool/ulogin-audit.jsonl · ulogin-logs.jsonl (한 줄 = 보낼 항목 그대로, 진짜 파일 — SQLite 밖)
             state.json(멈춤·미지원·백오프·건수) · *.quarantine.jsonl(1건이어도 400) · logs/audit-receipts.log(감사 receipt)
  규칙       본 요청 경로에서 보내지 않는다 · 실패는 삼키고 스풀에 남긴다 · 화면에 오류를 내지 않는다
             flush: 50건 이상 또는 마지막 전송 뒤 10초, 전송 간격 5초 이상, 배치 ≤100건·≤256KiB, 항목 ≤8KiB
             응답별: 200 지움(거절은 로컬에 사유) · 400 반으로(1건이면 격리) · 401 1시간 · 403 QUOTA 다음 UTC 자정/그 밖 1시간
                     · 404·405 미지원 6시간 · 429 retry_after · 5xx·시간 초과·연결 실패 5초×2 최대 15분 ±20%
             상한: 로그 스풀 50MB·7일 넘으면 오래된 것부터 버림 · 감사 스풀은 버리지 않고 관리자 경보
  마스킹(보내는 쪽 의무 6규칙) mask() 한 곳: 비밀 키 → "[REDACTED]" · 이메일 d***@도메인 · 전화 ***-****-1234 · 이름 첫 글자+* ·
             주민번호·카드·계좌는 싣지 않음 · 값 ≤200자, 객체·배열은 "{keys:a,b}" 요약
명령 도구(런처 계정 복구·sso_release 등)는 스풀에 넣기만 하고, 보내기는 서버가 한다.
"""
import http.client
import json
import os
import random
import re
import threading
import time
import urllib.parse
import uuid as _uuid
from datetime import datetime, timedelta, timezone

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 slc-platlog"
STREAMS = {"audit": {"file": "ulogin-audit.jsonl", "path": "/server/api/platform/audit.php", "drop": False},
           "logs": {"file": "ulogin-logs.jsonl", "path": "/server/api/platform/logs.php", "drop": True}}
BATCH, BATCH_BYTES, ITEM_BYTES = 100, 256 * 1024, 8 * 1024
FLUSH_N, FLUSH_SEC, MIN_GAP = 50, 10, int(os.environ.get("STUDY_PLATLOG_MIN_GAP") or 5)
LOG_SPOOL_BYTES, LOG_SPOOL_DAYS = 50 * 1024 * 1024, 7
AUDIT_ALERT_BYTES, AUDIT_ALERT_DAYS = 50 * 1024 * 1024, 7
UNSUP_SEC = int(os.environ.get("STUDY_PLATLOG_UNSUP_SEC") or 6 * 3600)
AUTH_SEC = 3600
CONNECT_T, TOTAL_T = 2, 5

# ---------------------------------------------------------------- 마스킹(계약 0-8)
_KEY = re.compile(r"password|passwd|secret|token|api_key|apikey|key|hash|otp|pin|credential|cookie|authorization", re.I)
_EMAIL = re.compile(r"(?<![A-Za-z0-9._%+-])([A-Za-z0-9])[A-Za-z0-9._%+-]*@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})")
_PHONE = re.compile(r"(?<![\d+])(?:\+?82[- ]?0?|0)\d{1,2}[-. ]?\d{3,4}[-. ]?(\d{4})(?!\d)")
_RRN = re.compile(r"(?<!\d)\d{6}-?[1-8]\d{6}(?!\d)")
_CARD = re.compile(r"(?<!\d)(?:\d{4}[- ]?){3}\d{3,4}(?!\d)")
_ACCT = re.compile(r"(?<!\d)\d{2,6}-\d{2,6}-\d{2,8}(?:-\d{1,6})?(?!\d)")
_SK = [(re.compile(r"sk-[A-Za-z0-9_\-]{6,}"), "[REDACTED]"), (re.compile(r"(?i)bearer\s+[A-Za-z0-9._\-]{6,}"), "Bearer [REDACTED]"),
       (re.compile(r"(?i)(study_sid=)[A-Za-z0-9_\-]+"), r"\1[REDACTED]"), (re.compile(r"\b(?:slc|mgm|ul|ulr)_[A-Za-z0-9_\-]{12,}"), "[REDACTED]")]
_NAME_KEYS = {"name", "display", "display_name", "displayname", "nickname", "realname", "real_name", "fullname", "full_name", "sso_name", "owner_name", "person"}


def _acct(m):
    s = m.group(0)
    digits = sum(c.isdigit() for c in s)
    if re.match(r"^\d{4}-\d{2}-\d{2}$", s) or digits < 10:    # 날짜·짧은 번호는 그대로
        return s
    return "[제외]"


def mask_str(s, limit=200):
    if not isinstance(s, str):
        return s
    for rx, rep in _SK:
        s = rx.sub(rep, s)
    s = _RRN.sub("[제외]", s)
    s = _CARD.sub("[제외]", s)
    s = _PHONE.sub(lambda m: "***-****-" + m.group(1), s)
    s = _ACCT.sub(_acct, s)
    s = _EMAIL.sub(lambda m: m.group(1) + "***@" + m.group(2), s)
    return s if len(s) <= limit else s[:limit - 1] + "…"


def mask_name(s):
    s = str(s or "")
    return (s[0] + "*") if s else s


def mask_value(k, v, limit=200):
    """규칙 ①~⑥. 키 이름이 비밀류면 값 대신 [REDACTED](바뀐 사실만), 객체·배열은 요약."""
    if k and _KEY.search(str(k)):
        return "[REDACTED]" if v not in (None, "") else v
    if k and str(k).lower() in _NAME_KEYS and isinstance(v, str):
        return mask_name(v)
    if isinstance(v, dict):
        return "{keys:%s}" % ",".join(str(x) for x in list(v)[:12])[:limit]
    if isinstance(v, (list, tuple)):
        return "[%d items]" % len(v)
    if isinstance(v, str):
        return mask_str(v, limit)
    return v


def mask(d, limit=200):
    return {str(k)[:64]: mask_value(k, v, limit) for k, v in list((d or {}).items())[:32]}


# ---------------------------------------------------------------- 사건 만들기
def _iso(t):
    return datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + "%03dZ" % int((t % 1) * 1000)


def _slug(s, rx, n):
    s = re.sub(r"[^a-z0-9_.:-]", "_", str(s or "").lower()).strip("_") or "event"
    return s[:n] if rx.match(s[:n]) else "event"


_EV = re.compile(r"^[a-z0-9_.:-]{1,64}$")
_ACT = re.compile(r"^[a-z0-9_.]{1,64}$")
_TAG = re.compile(r"^[a-z0-9_.:-]{1,32}$")
_DENY = ("denied", "feature_denied", "sso_only", "sso_admin", "sso_user", "sso_migrated", "sso_unlinked", "account_locked", "temp_locked", "default_pw_remote", "forbidden")
_TOP = ("event", "ok", "user", "ip", "rid", "ua", "username", "event_id", "sess", "t")


def _target(action, f):
    for k in ("target", "username", "uid", "pid", "did", "fid", "id", "name"):
        if f.get(k):
            tid = str(f[k])
            break
    else:
        tid = None
    a = action
    ty = ("user" if re.match(r"^(login|logout|lockout|password|user_|role|sso|ulink|feature|account|seed_admin|session)", a) else
          "llm_profile" if a.startswith(("llm", "aim", "ai_")) else "backup" if a.startswith(("backup", "restore")) else
          "project" if a.startswith(("ws", "project")) else "system")
    return {"type": ty, "id": mask_str(tid, 128) if tid else None}


class Platlog(object):
    def __init__(self, data_dir):
        self.dir = os.path.join(data_dir, "spool")
        self.logs_dir = os.path.join(data_dir, "logs")
        os.makedirs(self.dir, exist_ok=True)
        self.lk = threading.RLock()
        self.resolve = None          # fn(user) → {"role","username","uuid"} | None  (serve 가 넣는다)
        self.sso = None              # sso_api.Sso — 주소·service_id·비밀값(serve 가 넣는다)
        self._stop = threading.Event()
        self._post = self._http_post
        self._now = time.time

    # ---- 받기(logkit 가 부른다) ----
    def want(self, cat, levelno):
        if cat in ("platlog", "access"):
            return levelno >= 40 and cat == "access"          # 접근 로그는 5xx(ERROR)만
        return cat in ("audit", "activity") or levelno >= 30

    def put(self, cat, levelno, msg, fields, created=None):
        """로컬 기록과 같은 event_id 로 스풀에 한 줄. 어떤 오류도 밖으로 내지 않는다."""
        try:
            t = created or time.time()
            f = dict(fields or {})
            eid = f.get("event_id") or str(_uuid.uuid4())
            if cat in ("audit", "activity"):
                ev, st = self._audit_event(cat, levelno, msg, f, t, eid), "audit"
            else:
                ev, st = self._log_event(cat, levelno, msg, f, t, eid), "logs"
            line = json.dumps(self._fit(ev, st), ensure_ascii=False, separators=(",", ":"))
            with self.lk:
                with open(os.path.join(self.dir, STREAMS[st]["file"]), "a", encoding="utf-8") as fh:
                    fh.write(line + "\n")
                    fh.flush()
                    os.fsync(fh.fileno())
        except Exception:
            pass

    def _who(self, user, f):
        info = None
        if user and self.resolve:
            try:
                info = self.resolve(user)
            except Exception:
                info = None
        info = info or {}
        return info.get("role"), (info.get("username") or f.get("username") or user), info.get("uuid")

    def _audit_event(self, cat, levelno, msg, f, t, eid):
        role, lu, uu = self._who(f.get("user"), f)
        if cat == "activity":
            action = _slug(("ui." if f.get("src") == "browser" else "act.") + str(msg or "event"), _ACT, 64).replace(":", "_").replace("-", "_")
            target = {"type": "screen", "id": mask_str(str(f.get("v") or f.get("m") or ""), 128) or None}
            result = "success"
        else:
            action = _slug(f.get("event") or msg, _ACT, 64).replace(":", "_").replace("-", "_")
            target = _target(action, f)
            reason_code = str(f.get("reason") or "")
            result = "success" if f.get("ok", levelno < 30) else ("denied" if reason_code in _DENY or "denied" in reason_code else "failure")
        if not _ACT.match(action):
            action = "event"
        rest = mask({k: v for k, v in f.items() if k not in _TOP and v not in (None, "")})
        reason = "; ".join("%s=%s" % (k, v) for k, v in rest.items())[:255] or None
        actor = {"type": ("admin" if role == "admin" else "user") if (lu or uu) else "system", "uuid": uu, "local_user": mask_str(str(lu), 128) if lu else None}
        return {"event_id": eid, "ts": _iso(t), "actor": actor, "action": action, "target": target, "result": result,
                "ip": f.get("ip") or None, "user_agent": mask_str(str(f.get("ua") or ""), 255) or None, "request_id": (str(f.get("rid"))[:64] if f.get("rid") else None),
                "reason": reason}

    def _log_event(self, cat, levelno, msg, f, t, eid):
        _role, lu, uu = self._who(f.get("user"), f)
        lvl = "fatal" if levelno >= 50 else "error" if levelno >= 40 else "warn" if levelno >= 30 else "info" if levelno >= 20 else "debug"
        data = mask({k: v for k, v in f.items() if k not in ("user", "rid", "event_id", "username")})
        return {"event_id": eid, "ts": _iso(t), "level": lvl, "event": _slug("slc." + str(cat), _EV, 64), "message": mask_str(str(msg or ""), 1000),
                "tags": [x for x in [_slug(cat, _TAG, 32)] if _TAG.match(x)], "uuid": uu, "local_user": mask_str(str(lu), 128) if lu else None,
                "request_id": (str(f.get("rid"))[:64] if f.get("rid") else None), "data": data or None}

    def _fit(self, ev, st):
        """항목 1건 ≤ 8KiB — 넘으면 data·reason·message 를 줄인다."""
        def size(x):
            return len(json.dumps(x, ensure_ascii=False).encode("utf-8"))
        if size(ev) <= ITEM_BYTES:
            return ev
        if st == "logs":
            ev["data"] = {k: (v[:60] if isinstance(v, str) else v) for k, v in list((ev.get("data") or {}).items())[:12]} or None
            ev["message"] = ev["message"][:400]
        else:
            ev["reason"] = (ev.get("reason") or "")[:120] or None
            ev["user_agent"] = (ev.get("user_agent") or "")[:120] or None
        if size(ev) > ITEM_BYTES:
            ev.pop("data", None)
        return ev

    # ---- 스풀 ----
    def _path(self, st):
        return os.path.join(self.dir, STREAMS[st]["file"])

    def _read(self, st):
        out = []
        try:
            with open(self._path(st), "r", encoding="utf-8") as fh:
                for ln in fh:
                    ln = ln.strip()
                    if not ln:
                        continue
                    try:
                        out.append(json.loads(ln))
                    except ValueError:
                        pass             # 정전으로 반쯤 쓴 마지막 줄
        except OSError:
            pass
        return out

    def _rewrite(self, st, keep):
        import safeio
        safeio.atomic_text(self._path(st), "".join(json.dumps(x, ensure_ascii=False, separators=(",", ":")) + "\n" for x in keep))

    def _remove(self, st, ids):
        ids = set(ids)
        with self.lk:
            self._rewrite(st, [x for x in self._read(st) if x.get("event_id") not in ids])

    def pending(self, st):
        try:
            if os.path.getsize(self._path(st)) == 0:
                return 0
        except OSError:
            return 0
        return len(self._read(st))

    # ---- 상태 ----
    def _sfile(self):
        return os.path.join(self.dir, "state.json")

    def state(self):
        try:
            with open(self._sfile(), encoding="utf-8") as fh:
                d = json.load(fh)
        except (OSError, ValueError):
            d = {}
        for st in STREAMS:
            d.setdefault(st, {})
        return d

    def _save(self, d):
        import safeio
        try:
            safeio.atomic_json(self._sfile(), d, indent=1)
        except Exception:
            pass

    def _note(self, level, msg, **f):
        try:
            import logkit
            logkit.log("platlog", level, msg, **f)      # cat=platlog 는 스풀에 다시 넣지 않는다
        except Exception:
            pass

    # ---- 보내기 ----
    def ready(self):
        if os.environ.get("STUDY_OFFLINE") == "1" or not self.sso:
            return False
        try:
            return bool(self.sso.secret())
        except Exception:
            return False

    def _http_post(self, path, body):
        """→ (상태, 응답 json, 헤더). 연결 2초·전체 5초. 실패는 (0, None, {})."""
        c = self.sso.conf()
        base = urllib.parse.urlsplit(c["internal"])
        cls = http.client.HTTPSConnection if base.scheme == "https" else http.client.HTTPConnection
        cn = cls(base.hostname, base.port, timeout=CONNECT_T)
        try:
            t0 = time.time()
            cn.connect()
            cn.sock.settimeout(max(0.5, TOTAL_T - (time.time() - t0)))
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            cn.request("POST", (base.path.rstrip("/") + path), body=data, headers={"Content-Type": "application/json; charset=utf-8", "User-Agent": UA, "Accept": "application/json"})
            r = cn.getresponse()
            raw = r.read()
            try:
                j = json.loads(raw.decode("utf-8")) if raw else None
            except ValueError:
                j = None
            return r.status, j, {k.lower(): v for k, v in r.getheaders()}
        except Exception:
            return 0, None, {}
        finally:
            try:
                cn.close()
            except Exception:
                pass

    def _batch(self, items):
        out, size = [], 200
        for x in items:
            n = len(json.dumps(x, ensure_ascii=False).encode("utf-8")) + 1
            if out and (len(out) >= BATCH or size + n > BATCH_BYTES - 1024):
                break
            out.append(x)
            size += n
        return out

    def tick(self, force=False):
        """작업자가 1초마다. force=True(관리자 '지금 보내기')는 멈춤·미지원 대기를 무시하고 한 번 보낸다."""
        if not self.ready():
            return
        for st in ("audit", "logs"):
            try:
                self._tick(st, force)
            except Exception as e:
                self._note("WARNING", "로그·감사 보내기 작업 오류", stream=st, err=str(e)[:200])

    def _tick(self, st, force):
        now = self._now()
        d = self.state()
        s = d[st]
        self._caps(st, s, now)
        if not force and now < float(s.get("pause_until") or 0):
            self._save(d)
            return
        items = self._read(st)
        if not items:
            self._save(d)
            return
        gap = now - float(s.get("last_send") or 0)
        if not force and (gap < MIN_GAP or (len(items) < FLUSH_N and gap < FLUSH_SEC)):
            self._save(d)
            return
        self._send(st, s, self._batch(items), now)
        self._save(d)

    def _send(self, st, s, batch, now):
        c = self.sso.conf()
        s["last_send"] = now
        code, j, hdr = self._post(STREAMS[st]["path"], {"service_id": c["service_id"], "service_secret": self.sso.secret(), "events": batch})
        err = ((j or {}).get("error") or {}) if isinstance(j, dict) else {}
        s["last_code"] = code
        if code == 200 and isinstance(j, dict) and j.get("ok"):
            data = j.get("data") or {}
            self._remove(st, [x.get("event_id") for x in batch])
            for r in data.get("rejected") or []:
                self._note("WARNING", "통합로그인이 항목을 거절함", stream=st, event_id=r.get("event_id"), why=r.get("reason"))
            if int(data.get("redacted") or 0):
                self._note("WARNING", "통합로그인이 가린 항목이 있음 — 이쪽 마스킹 점검 필요", stream=st, redacted=data.get("redacted"))
            if st == "audit" and data.get("receipt"):
                rec = {"ts": _iso(now), "receipt": data["receipt"], "first": batch[0].get("event_id"), "last": batch[-1].get("event_id"), "n": len(batch)}
                os.makedirs(self.logs_dir, exist_ok=True)
                with open(os.path.join(self.logs_dir, "audit-receipts.log"), "a", encoding="utf-8") as fh:
                    fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
                s["receipt"] = data["receipt"]
            for k in ("accepted", "duplicate", "redacted"):
                s[k] = int(s.get(k) or 0) + int(data.get(k) or 0)
            s["rejected"] = int(s.get("rejected") or 0) + len(data.get("rejected") or [])
            s.update(fails=0, pause_until=0, unsupported=None, last_ok=now, last_error=None)
            return
        s["last_error"] = {"at": now, "code": code, "err": err.get("code") or ("연결 안 됨" if code == 0 else "HTTP %s" % code)}
        if code == 400:
            if len(batch) > 1:
                h = len(batch) // 2
                self._send(st, s, batch[:h], now)
                self._send(st, s, batch[h:], now)
                return
            with open(os.path.join(self.dir, st + ".quarantine.jsonl"), "a", encoding="utf-8") as fh:
                fh.write(json.dumps({"at": _iso(now), "error": err, "item": batch[0]}, ensure_ascii=False) + "\n")
            self._remove(st, [batch[0].get("event_id")])
            s["quarantined"] = int(s.get("quarantined") or 0) + 1
            self._note("WARNING", "1건도 400 — 격리 파일로 옮김", stream=st, event_id=batch[0].get("event_id"), err=err.get("code"))
        elif code == 401:
            s["pause_until"] = now + AUTH_SEC
        elif code == 403:
            if err.get("code") == "QUOTA_EXCEEDED":
                tm = datetime.fromtimestamp(now, timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
                s["pause_until"] = tm.timestamp()
            else:
                s["pause_until"] = now + AUTH_SEC
        elif code in (404, 405):
            if not s.get("unsupported"):
                self._note("INFO", "통합로그인 로그·감사 수집 미지원(v1.9.0 전) — 6시간마다 다시 확인", stream=st, code=code)
            s["unsupported"] = now
            s["pause_until"] = now + UNSUP_SEC
        elif code == 429:
            ra = ((j or {}).get("data") or {}).get("retry_after") if isinstance(j, dict) else None
            try:
                ra = float(ra if ra is not None else hdr.get("retry-after") or 30)
            except (TypeError, ValueError):
                ra = 30
            s["pause_until"] = now + max(1.0, ra)
        else:                                   # 5xx·시간 초과·연결 실패·그 밖
            n = int(s.get("fails") or 0)
            wait = min(900.0, 5.0 * (2 ** n)) * random.uniform(0.8, 1.2)
            s["fails"] = n + 1
            s["pause_until"] = now + wait

    def _caps(self, st, s, now):
        """로그 스풀: 50MB·7일 넘으면 오래된 것부터 버림. 감사 스풀: 버리지 않고 경보만."""
        try:
            size = os.path.getsize(self._path(st))
        except OSError:
            s["alert"] = None
            return
        if size == 0:
            s["alert"] = None
            return
        if now - float(s.get("caps_at") or 0) < 60 and size < (LOG_SPOOL_BYTES if STREAMS[st]["drop"] else AUDIT_ALERT_BYTES):
            return
        s["caps_at"] = now
        items = self._read(st)
        old = now - (LOG_SPOOL_DAYS if STREAMS[st]["drop"] else AUDIT_ALERT_DAYS) * 86400

        def tsec(x):
            try:
                return datetime.strptime(x.get("ts", "")[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc).timestamp()
            except ValueError:
                return now
        if STREAMS[st]["drop"]:
            keep = [x for x in items if tsec(x) >= old]
            while keep and sum(len(json.dumps(x, ensure_ascii=False).encode("utf-8")) + 1 for x in keep) > LOG_SPOOL_BYTES:
                keep = keep[len(keep) // 10 or 1:]
            if len(keep) != len(items):
                with self.lk:
                    self._rewrite(st, keep + [x for x in self._read(st)[len(items):]])
                s["dropped"] = int(s.get("dropped") or 0) + (len(items) - len(keep))
                self._note("WARNING", "로그 스풀 상한 — 오래된 로그를 버림", dropped=len(items) - len(keep))
        else:
            over = size > AUDIT_ALERT_BYTES or (items and tsec(items[0]) < old)
            if over and not s.get("alert"):
                self._note("WARNING", "감사 스풀이 상한을 넘음 — 통합로그인으로 보내지 못한 감사가 쌓였습니다(로컬 정본은 그대로)", size=size, n=len(items))
            s["alert"] = ({"at": now, "size": size, "n": len(items)} if over else None)

    # ---- 작업자 ----
    def start(self, every=1.0):
        def loop():
            self._stop.wait(3)
            while not self._stop.is_set():
                try:
                    self.tick()
                except Exception:
                    pass
                self._stop.wait(every)
        threading.Thread(target=loop, daemon=True, name="platlog").start()

    def stop(self):
        self._stop.set()

    def status(self):
        d = self.state()
        out = {"ready": self.ready()}
        for st in STREAMS:
            s = d[st]
            out[st] = {"pending": self.pending(st), "pause_until": s.get("pause_until") or 0, "unsupported": s.get("unsupported"), "last_ok": s.get("last_ok"),
                       "last_error": s.get("last_error"), "accepted": s.get("accepted", 0), "duplicate": s.get("duplicate", 0), "rejected": s.get("rejected", 0),
                       "redacted": s.get("redacted", 0), "quarantined": s.get("quarantined", 0), "dropped": s.get("dropped", 0), "alert": s.get("alert"),
                       "receipt": s.get("receipt")}
        return out


_INST = {"p": None}


def install(data_dir):
    """logkit 에 받는 곳으로 건다(서버·명령 도구 공통). 이미 걸려 있으면 그대로."""
    if _INST["p"] is None:
        _INST["p"] = Platlog(data_dir)
        import logkit
        logkit.SINK = _INST["p"]
    return _INST["p"]
