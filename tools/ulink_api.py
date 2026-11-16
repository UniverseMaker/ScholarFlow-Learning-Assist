# -*- coding: utf-8 -*-
"""(v145) 통합로그인 v1.8.3(구현 판 v1.8.4) 계정 연결 — 중앙 방식. ulogin 관리자가 이 시스템 로컬 계정을 보고 ulogin 계정에 연결·해제한다.

S-2 계정 목록 보내기  POST {ulogin}/server/api/sso/accounts_push.php  (service_id + service_secret, 서버 대 서버)
    external_id = 계정 id(영구 불변) · username · name = display · status(active|disabled|deleted) · created_at·last_login_at(ISO8601 UTC)
    bound_uuid = sso.uuid · extra = {role, note:"plan=…"}.  비밀번호·해시·토큰·last_ip·modes 는 보내지 않는다. 이메일 칸은 없다.
    전체 전송: 새 sync_id, page 1…, 200개씩, 마지막 final:true.  증분: 바뀐 계정만 final:false.
S-3 기동 30초 뒤 1회 전체 전송, 60초마다 계정 표를 보고 바뀐 것만 증분, 실패하면 다음 주기에 다시(같은 요청은 결과가 같다)
S-4 연결 사건 피드  POST …/link_events.php {after, limit} — 3분마다. linked → 그 계정을 uuid 에 묶음(origin ulogin, 같은 uuid 의 다른 묶음은 품),
    unlinked → ulogin 이 만든 묶음만 풀고 그 계정 세션 정리(로컬 계정은 지우지 않음). sync_requested 면 전체 전송.
S-5 로그인 처리는 sso_api(callback·check_session)가 apply_link() 로 한다.
상태 파일: <데이터>/system/ulink.json {after, last_full, last_push, last_error, sent:{id: 지문}}
"""
import hashlib
import json
import os
import threading
import time
import uuid as _uuid
from datetime import datetime, timezone

import auth_api
import logkit
import safeio
import vfs      # noqa: E402  (v151) SQLite 엔진이면 데이터 폴더의 .json·.jsonl 은 DB — 아래 open·exists 등은 vfs 판
open = vfs.open  # noqa: A001

PAGE = 200
FULL_DELAY = int(os.environ.get("STUDY_ULINK_DELAY") or 30)     # 시험 사본만 짧게
TICK = int(os.environ.get("STUDY_ULINK_TICK") or 60)
FEED_EVERY = int(os.environ.get("STUDY_ULINK_FEED") or 180)
RETRY = int(os.environ.get("STUDY_ULINK_RETRY") or 600)        # 보내기 실패(ulogin 꺼짐·아직 404) 뒤 다시 시도 간격


def _iso(ms):
    try:
        return datetime.fromtimestamp(int(ms) / 1000 if int(ms) > 10 ** 11 else int(ms), timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if ms else None
    except (TypeError, ValueError, OSError):
        return None


def _now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def account_of(u):
    """로컬 계정 → ulogin accounts[] 한 줄. 보내면 안 되는 값은 넣지 않는다."""
    a = {"external_id": str(u["id"]), "username": str(u.get("username") or "")[:128], "name": str(u.get("display") or u.get("username") or "")[:128],
         "status": "disabled" if u.get("status") == "locked" else "active",
         "created_at": _iso(u.get("created")), "last_login_at": _iso(u.get("last_login")),
         "bound_uuid": ((u.get("sso") or {}).get("uuid") or None),
         "extra": {"role": str(u.get("role") or "user")[:100], "note": ("plan=" + str(u.get("plan") or "free"))[:100]}}
    return {k: v for k, v in a.items() if v is not None or k == "bound_uuid"}


def _fp(a):
    return hashlib.sha256(json.dumps(a, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()[:24]


class ULink:
    def __init__(self, data_dir, sso, auth):
        self.dir, self.sso, self.auth = data_dir, sso, auth
        self.f = os.path.join(data_dir, "system", "ulink.json")
        self.lock = threading.Lock()
        self._stop = threading.Event()
        self.emg = None            # (v169) emergency_api.Emergency — emergency_verifier·emergency_revoke 사건

    def state(self):
        try:
            with open(self.f, encoding="utf-8") as fh:
                return json.load(fh)
        except (OSError, ValueError):
            return {}

    def _save(self, st):
        safeio.atomic_json(self.f, st, indent=1)

    def ready(self):
        return bool(self.sso.secret()) and os.environ.get("STUDY_OFFLINE") != "1"

    def _post(self, path, body):
        c = self.sso.conf()
        return self.sso.call("POST", path, dict(body, service_id=c["service_id"], service_secret=self.sso.secret()))

    # ---- S-2 ----
    def push(self, full=True, only=None, by="auto"):
        """→ {ok, sent, pages, error}. full=True 면 전체 전송(final:true), 아니면 only(계정 id 목록) 증분."""
        if not self.ready():
            return {"ok": False, "error": "not_ready", "message": "통합로그인 비밀값이 없어 보낼 수 없습니다."}
        with self.lock:
            users = self.auth._users()["users"]
            accs = [account_of(u) for u in users if not auth_api.is_breakglass(u) and (full or (only and u["id"] in only))]   # (v179) 비상용 관리자는 보내지 않는다
            if not full:
                gone = [x for x in (only or []) if not any(u["id"] == x for u in users)]
                accs += [{"external_id": x, "status": "deleted"} for x in gone]
            if not accs and not full:
                return {"ok": True, "sent": 0, "pages": 0}
            sid, pages, st = str(_uuid.uuid4()), max(1, (len(accs) + PAGE - 1) // PAGE), self.state()
            res, again = None, False
            for i in range(pages):
                body = {"sync_id": sid, "page": i + 1, "final": bool(full and i == pages - 1), "sent_at": _now_iso(), "accounts": accs[i * PAGE:(i + 1) * PAGE]}
                code, j = self._post("/server/api/sso/accounts_push.php", body)
                if code != 200 or not (isinstance(j, dict) and j.get("ok")):
                    err = ((j or {}).get("error") or {}).get("code") if isinstance(j, dict) and isinstance((j or {}).get("error"), dict) else ("HTTP %s" % code if code else "연결 안 됨")
                    st.update(last_error={"at": int(time.time()), "code": err, "page": i + 1})
                    self._save(st)
                    logkit.warn("sso", "계정 목록 보내기 실패 — 다음 주기에 다시", code=err, page=i + 1, full=full)
                    return {"ok": False, "error": err, "sent": i * PAGE, "pages": i}
                res = j.get("data") or {}
                again = again or bool(res.get("sync_requested"))
            sent = dict(st.get("sent") or {})
            for a in accs:
                if a.get("status") == "deleted":
                    sent.pop(a["external_id"], None)
                else:
                    sent[a["external_id"]] = _fp(a)
            st.update(sent=sent, last_push=int(time.time()), last_error=None, last_sync=sid)
            if full:
                st["last_full"] = int(time.time())
            self._save(st)
        logkit.audit("ulink_push", user=by, full=full, accounts=len(accs), pages=pages)
        if again and not full:
            return self.push(True, by="sync_requested")
        return {"ok": True, "sent": len(accs), "pages": pages, "result": {k: res.get(k) for k in ("accepted", "created", "updated", "unchanged")} if res else None}

    def changed(self):
        """지난번에 보낸 것과 달라진 계정 id(사라진 계정 포함)."""
        sent = self.state().get("sent") or {}
        users = self.auth._users()["users"]
        out = [u["id"] for u in users if sent.get(u["id"]) != _fp(account_of(u))]
        out += [x for x in sent if not any(u["id"] == x for u in users)]
        return out

    # ---- S-4·S-6 ----
    def feed(self):
        if not self.ready():
            return {"ok": False, "error": "not_ready"}
        st = self.state()
        after, n, req = int(st.get("after") or 0), 0, False
        for _ in range(20):
            code, j = self._post("/server/api/sso/link_events.php", {"after": after, "limit": 200})
            if code != 200 or not (isinstance(j, dict) and j.get("ok")):
                return {"ok": False, "error": "HTTP %s" % code if code else "연결 안 됨", "applied": n}
            d = j.get("data") or {}
            for e in d.get("events") or []:
                if e.get("type") in ("linked", "unlinked"):
                    self.apply_link(e.get("uuid"), str(e.get("external_id") or "") if e.get("type") == "linked" else None, unlink_id=str(e.get("external_id") or ""), why="feed")
                    n += 1
                if self.emg and e.get("type") in ("emergency_verifier", "emergency_revoke", "unlinked"):   # (v169) 비상 확인값 받기·지우기
                    try:
                        self.emg.on_event(e)
                    except Exception as er:
                        logkit.warn("sso", "비상 확인값 처리 오류", err=str(er)[:160])
                    n += e.get("type") != "unlinked"
            after = int(d.get("next_after") or after)
            req = req or bool(d.get("sync_requested"))
            st = self.state()
            st["after"] = after
            self._save(st)
            if not d.get("has_more"):
                break
        if req:
            self.push(True, by="sync_requested")
        return {"ok": True, "applied": n, "after": after}

    def apply_link(self, uuid, external_id, unlink_id=None, why="login"):
        """ulogin 관리자의 결정을 반영한다. external_id 가 있으면 그 계정을 uuid 에 묶고(다른 묶음은 품), None 이면 ulogin 이 만든 묶음을 푼다.
        → (상태, 계정) 상태: linked | missing | unlinked | none"""
        if not uuid:
            return "none", None
        ss = self.sso
        if external_id:
            target = self.auth.find(uid=external_id)
            if auth_api.is_breakglass(target):          # (v179) 비상용 관리자는 통합로그인과 묶지 않는다
                logkit.audit("ulink_breakglass_refused", ok=False, user=external_id, uuid=uuid, via=why)
                return "missing", None
            if not target or target.get("status") == "locked":
                logkit.audit("ulink_missing", ok=False, user=external_id, uuid=uuid, via=why)
                return "missing", None
            for x in self.auth._users()["users"]:
                if x["id"] != external_id and (x.get("sso") or {}).get("uuid") == uuid:
                    ss._set(x["id"], lambda y: (y.pop("sso", None), y.update(local_login=True)))   # (v156) 비밀번호는 되살리지 않는다(이관 표식 그대로)
                    self.auth.revoke_user_sessions(x["id"])
            cur = (target.get("sso") or {})
            if cur.get("uuid") != uuid or cur.get("origin") != "ulogin":
                same = cur.get("uuid") == uuid
                new = {"uuid": uuid, "username": cur.get("username", "") if same else "", "name": cur.get("name", "") if same else "",
                       "rank": int(cur.get("rank") or 0) if same else 0, "linked_at": int(time.time()), "seen": int(time.time()), "origin": "ulogin"}
                if same and "modes" in cur:
                    new["modes"] = cur["modes"]
                ss._set(external_id, lambda y: (y.update(sso=new), auth_api.migrate_local(y)))   # (v156) 완전 이관
                self.auth.revoke_local_sessions(external_id)
                logkit.audit("ulink_linked", user=external_id, uuid=uuid, via=why, migrated=True)
            return "linked", self.auth.find(uid=external_id)
        # 해제: ulogin 연결로 생긴 묶음만(이 시스템에서 사람이 직접 만든 연결은 그대로)
        done = None
        for x in self.auth._users()["users"]:
            s = x.get("sso") or {}
            if s.get("uuid") == uuid and s.get("origin") == "ulogin" and (not unlink_id or x["id"] == unlink_id):
                ss._set(x["id"], lambda y: (y.pop("sso", None), y.update(local_login=True)))
                self.auth.revoke_user_sessions(x["id"])
                logkit.audit("ulink_unlinked", user=x["id"], uuid=uuid, via=why)
                done = x
        return ("unlinked", done) if done else ("none", None)

    # ---- 주기 ----
    def start(self):
        def loop():
            if self._stop.wait(FULL_DELAY):
                return
            full_done, last_feed, wait_until = False, 0, 0
            while not self._stop.is_set():
                try:
                    if not safeio.READONLY:
                        self.sso.sweep_migrate()          # (v156) 묶인 계정 완전 이관 — 매 주기 확인(통합로그인 비밀값과 상관없이)
                    if self.ready() and time.time() >= wait_until:
                        if not full_done:
                            full_done = bool(self.push(True, by="startup").get("ok"))
                            if not full_done:
                                wait_until = time.time() + RETRY
                        else:
                            ch = self.changed()
                            if ch and not self.push(False, only=ch, by="change").get("ok"):
                                wait_until = time.time() + RETRY
                        if full_done and time.time() - last_feed >= FEED_EVERY:
                            last_feed = time.time()
                            self.feed()
                except Exception as e:
                    logkit.warn("sso", "계정 연결 작업 오류", err=str(e)[:200])
                self._stop.wait(TICK)
        threading.Thread(target=loop, daemon=True, name="ulink").start()

    def stop(self):
        self._stop.set()

    def info(self):
        st = self.state()
        return {"ready": self.ready(), "last_full": st.get("last_full"), "last_push": st.get("last_push"), "last_error": st.get("last_error"),
                "after": st.get("after"), "accounts": len(self.auth._users()["users"]), "pending": len(self.changed()) if self.ready() else None}
