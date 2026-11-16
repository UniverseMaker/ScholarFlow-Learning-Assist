# -*- coding: utf-8 -*-
"""AI 연결(LLM) — 계정별 등록·관리 + 서버 프록시 + Claude CLI(v92). serve.py 가 api.php?r=llm&op=… 로 넘겨준다.

왜 서버로 옮겼나
  예전(v28~v90)에는 API 키가 브라우저 localStorage 에 있었다 → 브라우저마다 다시 등록, 공용 PC 에 키가 남음.
  이제 키는 **서버 파일에 암호화**해 두고, AI 호출도 서버가 대신 한다(프록시). 브라우저는 키를 받지도 보지도 않는다.

저장
  <DATA_DIR>/users/<uid>/llm.json      내 연결 {schema, active:"u:<id>"|"s:<id>"|null, profiles:[Profile]}
  <DATA_DIR>/system/llm_system.json    관리자가 만든 공용 연결 {schema, profiles:[Profile]} (v166: 기본 관리자 전용, allow=[사용자 id] 면 그 사람도 고를 수 있다)
  Profile = {id, provider: "openai"|"claude-cli", name, base_url, model, params:{temperature,max_tokens,top_p,timeout_ms},
             note, key:{alg,n,ct,...}|null, key_hint:"sk-…AbCd", allow, created, updated, by}
  키 암호화: system/secret.key(32바이트) 로 AES-256-GCM(cryptography 있으면) 또는 HMAC-SHA256 CTR+태그(표준 라이브러리만).
             AAD = "<범위>|<소유자>|<프로필 id>" — 다른 계정·다른 프로필 자리로 옮겨 붙이면 풀리지 않는다.

제공자
  openai      OpenAI 호환 /chat/completions (vLLM·Ollama·LM Studio·OpenRouter·OpenAI…). 서버가 브라우저 User-Agent 를 붙여 보낸다
              (Cloudflare 뒤 엔드포인트는 UA 가 없으면 403).
  claude-cli  이 PC 에 로그인된 Claude Code CLI(`claude -p`)를 그대로 LLM 으로 쓴다. 도구·MCP·설정 파일을 모두 끄고
              (--tools "" --strict-mcp-config --setting-sources ""), 빈 작업 폴더(system/cli-sandbox)에서 실행한다.
              PC 주인의 구독을 쓰므로 **관리자만 만들 수 있고**, 관리자가 허용(allow)한 계정만 쓸 수 있다.
  응답은 브라우저가 이미 아는 OpenAI 형식(JSON / SSE data: {"choices":[{"delta":{"content":…}}]})으로 통일한다.

보안
  · 일반 사용자는 사설망·localhost 주소를 등록할 수 없다(SSRF — 서버가 대신 요청하므로). 정책 user_llm_private_hosts 로 허용 가능.
  · 프로필 목록·조회 응답에 키는 절대 담지 않는다(key_hint 만). 키를 바꿀 때만 새 키를 보낸다(빈칸 = 그대로).
  · llm.log 에는 누가·어떤 연결·모델·시간·글자 수만 남긴다. 대화 내용·키는 남기지 않는다.
"""
import safeio   # (v140) 정전 대비 쓰기(임시 파일 → fsync → 바꾸기)
import vfs      # noqa: E402  (v151) SQLite 엔진이면 데이터 폴더의 .json·.jsonl 은 DB — 아래 open·exists 등은 vfs 판
open = vfs.open  # noqa: A001
import base64
import hashlib
import hmac
import ipaddress
import json
import os
import re
import secrets
import shutil
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit

import logkit

BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
DEFAULT_PARAMS = {"temperature": 0.7, "max_tokens": 2048, "top_p": 1, "timeout_ms": 120000}
MAX_BODY = 2 * 1024 * 1024
ID_RE = re.compile(r"^[a-z0-9][a-z0-9\-]{0,47}$")
CLI_MAX_CONCURRENT = 2
_lock = threading.RLock()
_cli_sem = threading.BoundedSemaphore(CLI_MAX_CONCURRENT)
_cli_cache = {"t": 0, "info": None}


def _now():
    return int(time.time())


def _atomic_json(path, obj):
    safeio.atomic_json(path, obj, indent=1)


def _read_json(path, default):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return default


# ---------------------------------------------------------------------------
# 저장 암호화
# ---------------------------------------------------------------------------
class SecretBox:
    def __init__(self, key_path):
        self.path = key_path
        if not vfs.exists(key_path) and safeio.READONLY:      # (v140) 점검으로 멈춘 동안에는 새 키를 만들지 않는다(옛 암호문을 못 읽게 됨)
            self.key = secrets.token_bytes(32)
        else:
            if not vfs.exists(key_path):
                safeio.atomic_text(key_path, base64.b64encode(secrets.token_bytes(32)).decode("ascii"))
                logkit.info("security", "저장 암호화 키를 만들었어요", path=key_path)
            with open(key_path, "r", encoding="ascii") as fh:
                self.key = base64.b64decode(fh.read().strip())
        try:
            from cryptography.hazmat.primitives.ciphers.aead import AESGCM  # noqa
            self.aes = AESGCM(self.key)
        except Exception:
            self.aes = None

    def _ks(self, n, nonce, length):
        out, i = b"", 0
        k = hmac.new(self.key, b"enc", hashlib.sha256).digest()
        while len(out) < length:
            out += hmac.new(k, nonce + i.to_bytes(4, "big"), hashlib.sha256).digest(); i += 1
        return out[:length]

    def seal(self, text, aad):
        data, aad = text.encode("utf-8"), aad.encode("utf-8")
        n = secrets.token_bytes(12)
        if self.aes:
            return {"alg": "aes-256-gcm", "n": base64.b64encode(n).decode(), "ct": base64.b64encode(self.aes.encrypt(n, data, aad)).decode()}
        ct = bytes(a ^ b for a, b in zip(data, self._ks(0, n, len(data))))
        tag = hmac.new(hmac.new(self.key, b"mac", hashlib.sha256).digest(), aad + b"|" + n + ct, hashlib.sha256).digest()
        return {"alg": "hmac-ctr-sha256", "n": base64.b64encode(n).decode(), "ct": base64.b64encode(ct).decode(), "tag": base64.b64encode(tag).decode()}

    def open(self, rec, aad):
        if not rec:
            return ""
        n, ct, aad = base64.b64decode(rec["n"]), base64.b64decode(rec["ct"]), aad.encode("utf-8")
        if rec.get("alg") == "aes-256-gcm":
            if not self.aes:
                raise ValueError("cryptography 라이브러리가 없어 키를 풀 수 없어요(pip install cryptography)")
            return self.aes.decrypt(n, ct, aad).decode("utf-8")
        tag = hmac.new(hmac.new(self.key, b"mac", hashlib.sha256).digest(), aad + b"|" + n + ct, hashlib.sha256).digest()
        if not hmac.compare_digest(tag, base64.b64decode(rec["tag"])):
            raise ValueError("암호문이 손상됐거나 다른 자리의 것이에요")
        return bytes(a ^ b for a, b in zip(ct, self._ks(0, n, len(ct)))).decode("utf-8")


def key_hint(k):
    k = str(k or "")
    if not k:
        return ""
    return (k[:3] + "…" + k[-4:]) if len(k) > 10 else "…" + k[-2:]


# ---------------------------------------------------------------------------
# 주소 검사(SSRF)
# ---------------------------------------------------------------------------
def host_is_private(url):
    try:
        host = urlsplit(url).hostname or ""
        if host in ("localhost",) or host.endswith(".localhost") or host.endswith(".local"):
            return True
        for fam, _t, _p, _c, sa in socket.getaddrinfo(host, None):
            ip = ipaddress.ip_address(sa[0].split("%")[0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
                return True
        return False
    except Exception:
        return True          # 확인할 수 없으면 사설로 본다(보수적)


def valid_url(url):
    u = urlsplit(url or "")
    return u.scheme in ("http", "https") and bool(u.hostname) and not u.username and not u.password


# ---------------------------------------------------------------------------
# Claude CLI
# ---------------------------------------------------------------------------
def cli_exe():
    p = shutil.which("claude")
    if p:
        return p
    for cand in (os.path.expanduser("~/.local/bin/claude.exe"), os.path.expanduser("~/.local/bin/claude"),
                 os.path.join(os.environ.get("APPDATA", ""), "npm", "claude.cmd")):
        if cand and vfs.exists(cand):
            return cand
    return None


def cli_info(force=False):
    if not force and _cli_cache["info"] and time.time() - _cli_cache["t"] < 300:
        return _cli_cache["info"]
    exe = cli_exe()
    info = {"available": False, "path": exe, "version": None}
    if exe:
        try:
            r = subprocess.run([exe, "--version"], capture_output=True, timeout=20, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            info["version"] = r.stdout.decode("utf-8", "replace").strip()[:80]
            info["available"] = r.returncode == 0
        except Exception as e:
            info["error"] = str(e)[:120]
    _cli_cache.update(t=time.time(), info=info)
    return info


def _flatten(messages):
    """messages → (system, prompt). 여러 턴이면 대화록으로 펼친다(CLI 한 번 호출 = 한 번 답)."""
    sys_parts, turns = [], []
    for m in messages or []:
        role, c = m.get("role"), m.get("content")
        if isinstance(c, list):
            c = "\n".join(x.get("text", "") for x in c if isinstance(x, dict))
        c = str(c or "")
        if role == "system":
            sys_parts.append(c)
        else:
            turns.append((role, c))
    if len(turns) == 1:
        prompt = turns[0][1]
    else:
        lines = ["[이전 대화]"]
        for r, c in turns[:-1]:
            lines.append(("사용자: " if r == "user" else "AI: ") + c)
        lines.append("\n[지금 메시지 — 여기에 답하세요]")
        lines.append(turns[-1][1] if turns else "")
        prompt = "\n".join(lines)
    return "\n\n".join(sys_parts) or "You are a helpful assistant.", prompt


def run_cli(sandbox, model, messages, timeout_s, on_text=None, cancel=None):
    """Claude CLI 를 한 번 실행. on_text(델타) 로 흘려 보내고 전체 텍스트를 돌려준다."""
    exe = cli_exe()
    if not exe:
        raise RuntimeError("이 PC 에서 claude 명령을 찾지 못했어요(Claude Code 설치·로그인 필요).")
    if not _cli_sem.acquire(timeout=30):
        raise RuntimeError("Claude CLI 가 다른 요청을 처리 중이에요. 잠시 뒤에 다시 해 주세요.")
    try:
        os.makedirs(sandbox, exist_ok=True)
        system, prompt = _flatten(messages)
        spf = os.path.join(sandbox, "sys-%s.txt" % secrets.token_hex(6))
        with open(spf, "w", encoding="utf-8") as fh:
            fh.write(system)
        cmd = [exe, "-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
               "--tools", "", "--strict-mcp-config", "--setting-sources", "", "--no-session-persistence",
               "--system-prompt-file", spf]
        if model and model not in ("default", "auto"):
            cmd += ["--model", model]
        env = dict(os.environ)
        env.pop("CLAUDECODE", None)
        proc = subprocess.Popen(cmd, cwd=sandbox, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env,
                                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        killer = threading.Timer(timeout_s, proc.kill); killer.start()
        acc, final, err = [], None, None
        try:
            proc.stdin.write(prompt.encode("utf-8")); proc.stdin.close()
            for raw in proc.stdout:
                if cancel and cancel():
                    proc.kill(); break
                try:
                    o = json.loads(raw.decode("utf-8", "replace"))
                except ValueError:
                    continue
                t = o.get("type")
                if t == "stream_event":
                    ev = o.get("event") or {}
                    d = ev.get("delta") or {}
                    if ev.get("type") == "content_block_delta" and d.get("type") == "text_delta" and d.get("text"):
                        acc.append(d["text"])
                        if on_text:
                            on_text(d["text"])
                elif t == "result":
                    if o.get("is_error") or (o.get("subtype") and o.get("subtype") != "success"):
                        err = str(o.get("result") or o.get("subtype"))[:300]
                    else:
                        final = o.get("result")
            proc.wait(timeout=10)
        finally:
            killer.cancel()
            try: vfs.remove(spf)
            except OSError: pass
        if err:
            raise RuntimeError("Claude CLI 오류: " + err)
        if proc.returncode not in (0, None) and not acc:
            se = proc.stderr.read().decode("utf-8", "replace")[-300:] if proc.stderr else ""
            raise RuntimeError("Claude CLI 가 실패했어요(코드 %s) %s" % (proc.returncode, se.strip()))
        text = "".join(acc)
        if not text and final:
            text = final
            if on_text:
                on_text(final)
        return text
    finally:
        _cli_sem.release()


# ---------------------------------------------------------------------------
# 저장소
# ---------------------------------------------------------------------------
class LlmStore:
    def __init__(self, data_dir, auth_store):
        self.dir = data_dir
        self.auth = auth_store
        self.box = SecretBox(os.path.join(data_dir, "system", "secret.key"))
        self.f_sys = os.path.join(data_dir, "system", "llm_system.json")
        self.sandbox = os.path.join(data_dir, "system", "cli-sandbox")
        self.aim = None           # (v139) aireg_api.AiReg — serve.py 가 넣는다. a:<id> = AI 관리시스템 프로필

    def f_user(self, uid):
        return os.path.join(self.dir, "users", uid, "llm.json")

    def _load_user(self, uid):
        st = _read_json(self.f_user(uid), None)
        if not isinstance(st, dict) or not isinstance(st.get("profiles"), list):
            st = {"schema": 1, "active": None, "profiles": []}
        return st

    def _load_sys(self):
        st = _read_json(self.f_sys, None)
        if not isinstance(st, dict) or not isinstance(st.get("profiles"), list):
            st = {"schema": 1, "profiles": []}
        # (v166) 공개 범위: 「모두에게 공유(shared)」 없앰 — 기본 관리자 전용, 일반 사용자는 관리자가 사람별로 허용(allow).
        #   예전 shared=true 는 관리자 전용으로 옮긴다(사용자 지시: AI 정보는 중앙 관리·관리자 전용 기본)
        moved = False
        for p in st["profiles"]:
            if "shared" in p:
                p.pop("shared", None)
                p.setdefault("allow", [])
                moved = True
        if moved:
            try:
                _atomic_json(self.f_sys, st)
                logkit.audit("llm_scope_migrate", note="공용 연결 '모두에게 공유' → 관리자 전용", n=len(st["profiles"]))
            except Exception:
                pass
        return st

    @staticmethod
    def _aad(scope, owner, pid):
        return "%s|%s|%s" % (scope, owner, pid)

    def public(self, p, scope, user):
        is_admin = user.get("role") == "admin"
        return {"ref": ("u:" if scope == "user" else "s:") + p["id"], "id": p["id"], "scope": scope, "provider": p.get("provider", "openai"),
                "name": p.get("name") or p.get("model"), "service": p.get("name") or p.get("model"), "base_url": p.get("base_url", ""),
                "model": p.get("model", ""), "params": p.get("params") or dict(DEFAULT_PARAMS), "note": p.get("note", ""),
                "has_key": bool(p.get("key")), "key_hint": p.get("key_hint", ""), "allow": (list(p.get("allow") or []) if is_admin and scope == "system" else None),
                "editable": scope == "user" or is_admin, "updated": p.get("updated")}

    def visible(self, user):
        """이 계정이 고를 수 있는 연결: 내 것 + (관리자면 공용 전부, 아니면 관리자가 허용한 공용만)."""
        out = []
        for p in self._load_user(user["id"])["profiles"]:
            out.append(("user", p))
        for p in self._load_sys()["profiles"]:
            if user.get("role") == "admin" or user.get("id") in (p.get("allow") or []):
                out.append(("system", p))
        return out

    def aim_public(self, p):
        return {"ref": "a:" + p["id"], "id": p["id"], "scope": "aim", "provider": p.get("provider", "openai"), "name": p.get("name"), "service": "AI 관리시스템",
                "base_url": "", "model": p.get("model", ""), "params": {}, "note": "AI 관리시스템에서 받은 프로필", "has_key": True, "key_hint": p.get("keyHint", ""),
                "allow": None, "editable": False, "updated": None, "down": bool(p.get("down"))}

    def resolve(self, user, ref):
        if not ref:
            return None, None
        if ref.startswith("a:"):      # (v139) AI 관리시스템 프로필 — 닿지 않으면 down 표시만 붙여 돌려준다(부를 때 자기 연결로 넘어간다)
            if not self.aim or not self.aim.uuid_of(user):
                return None, None
            import aireg_api
            try:
                p = self.aim.find(user, ref[2:])
                return ("aim", p) if p else (None, None)
            except aireg_api.Unavailable:
                return "aim", {"id": ref[2:], "name": ref[2:], "provider": "openai", "model": "", "down": True}
            except aireg_api.Denied as e:
                if user.get("emergency") and aireg_api.user_unverified(e):     # (v169) 비상 로그인 세션 — AI 관리가 사람을 확인할 수 없다
                    return "aim", {"id": ref[2:], "name": ref[2:], "provider": "openai", "model": "", "down": True}
                return None, None
        scope = "user" if ref.startswith("u:") else "system" if ref.startswith("s:") else None
        pid = ref[2:]
        for sc, p in self.visible(user):
            if sc == scope and p["id"] == pid:
                return sc, p
        return None, None

    def _aim_auto(self, user):
        """(v167, ai-registry 18.5 확정) 출처를 고른 적 없거나 고른 연결이 사라진 통합로그인 연결 계정 → AI 관리 default 프로필(없으면 첫 번째)."""
        if not self.aim or not self.aim.uuid_of(user):
            return None
        import aireg_api
        try:
            return self.aim.default_of(user)
        except (aireg_api.Unavailable, aireg_api.Denied) as e:      # (v169) 꺼졌으면 비상 묶음에서(이전에 쓰던 것만)
            if isinstance(e, aireg_api.Denied) and not (user.get("emergency") and aireg_api.user_unverified(e)):
                return None
            ep = self.aim.emergency_default(user)
            return dict(ep, down=True) if ep else None
        except Exception:
            return None

    def active(self, user):
        st = self._load_user(user["id"])
        sc, p = self.resolve(user, st.get("active"))
        if p:
            return sc, p
        ap = self._aim_auto(user)
        return ("aim", ap) if ap else (None, None)

    def list(self, user):
        st = self._load_user(user["id"])
        sc, p = self.resolve(user, st.get("active"))
        out = [self.public(p_, sc_, user) for sc_, p_ in self.visible(user)]
        auto = False
        if not p:
            ap = self._aim_auto(user)
            if ap:
                sc, p, auto = "aim", ap, True
        if sc == "aim" and p:
            ap_ = self.aim_public(p)
            ap_["auto"] = auto
            out.append(ap_)
        return {"profiles": out, "active": (("a:" + p["id"]) if auto else st.get("active")) if p else None, "local": st.get("local"), "auto": auto}

    def local_fallback(self, user):
        """AI 관리시스템이 꺼졌을 때 쓸 자기 연결: 마지막으로 고른 자기 연결, 없으면 첫 번째로 보이는 연결."""
        st = self._load_user(user["id"])
        sc, p = self.resolve(user, st.get("local"))
        if p:
            return sc, p
        v = self.visible(user)
        return v[0] if v else (None, None)

    def secret(self, scope, owner, p):
        if not p.get("key"):
            return ""
        return self.box.open(p["key"], self._aad(scope, owner, p["id"]))

    def save(self, user, body, ip=None):
        """프로필 만들기·고치기. body={id?, scope?, provider, name, base_url, model, api_key?, clear_key?, params, note, shared?}"""
        is_admin = user.get("role") == "admin"
        pol = self.auth.policy()
        provider = body.get("provider") if body.get("provider") in ("openai", "claude-cli") else "openai"
        scope = "system" if (body.get("scope") == "system" or provider == "claude-cli") else "user"
        if scope == "system" and not is_admin:
            return None, "공용 연결과 Claude CLI 는 관리자만 만들 수 있어요."
        if scope == "user" and not is_admin and not pol["user_llm_profiles"]:
            return None, "관리자가 개인 AI 연결 등록을 막아 두었어요. 관리자가 공유한 연결을 고르세요."
        name = str(body.get("name") or "").strip()[:80]
        model = str(body.get("model") or "").strip()[:120]
        base = str(body.get("base_url") or "").strip().rstrip("/")[:300]
        if provider == "openai":
            base = re.sub(r"/chat/completions$", "", base)
            if not valid_url(base):
                return None, "주소(base_url)는 http(s)://… 형식이어야 해요."
            if not model:
                return None, "모델 이름을 넣어 주세요."
            if not is_admin and not pol["user_llm_private_hosts"] and host_is_private(base):
                return None, "보안 정책상 사설망·localhost 주소는 관리자만 등록할 수 있어요."
        else:
            base = "claude-cli"
            model = model or "sonnet"
        pr = body.get("params") or {}
        params = {}
        for k, dv in DEFAULT_PARAMS.items():
            try:
                params[k] = float(pr.get(k, dv)) if k in ("temperature", "top_p") else int(pr.get(k, dv))
            except (TypeError, ValueError):
                params[k] = dv
        params["timeout_ms"] = max(5000, min(600000, params["timeout_ms"]))
        params["max_tokens"] = max(16, min(64000, params["max_tokens"]))
        with _lock:
            st = self._load_sys() if scope == "system" else self._load_user(user["id"])
            owner = "system" if scope == "system" else user["id"]
            pid = str(body.get("id") or "").strip().lower()
            cur = next((x for x in st["profiles"] if x["id"] == pid), None) if pid else None
            if pid and not cur:
                return None, "고칠 연결을 찾지 못했어요."
            if not cur:
                slug = re.sub(r"[^a-z0-9]+", "-", (name or model or provider).lower()).strip("-")[:30] or "llm"
                pid = slug
                n = 2
                while any(x["id"] == pid for x in st["profiles"]) or not ID_RE.match(pid):
                    pid = "%s-%d" % (slug or "llm", n); n += 1
                cur = {"id": pid, "created": _now(), "by": user["id"], "key": None, "key_hint": ""}
                st["profiles"].append(cur)
            cur.update({"provider": provider, "name": name or model, "base_url": base, "model": model, "params": params,
                        "note": str(body.get("note") or "")[:200], "updated": _now()})
            if scope == "system":
                if isinstance(body.get("allow"), list):            # (v166) 관리자가 사람별로 허용(기본 관리자 전용)
                    cur["allow"] = [str(x)[:40] for x in body["allow"] if x][:500]
                else:
                    cur.setdefault("allow", [])
                cur.pop("shared", None)
            newkey = str(body.get("api_key") or "").strip()
            if provider == "claude-cli":
                cur["key"] = None; cur["key_hint"] = ""
            elif newkey:
                cur["key"] = self.box.seal(newkey, self._aad(scope, owner, pid)); cur["key_hint"] = key_hint(newkey)
            elif body.get("clear_key"):
                cur["key"] = None; cur["key_hint"] = ""
            if scope == "system":
                _atomic_json(self.f_sys, st)
            else:
                if not st.get("active"):
                    st["active"] = "u:" + pid
                _atomic_json(self.f_user(user["id"]), st)
        logkit.audit("llm_profile_save", ip=ip, user=user["id"], scope=scope, profile=pid, provider=provider, model=model,
                     host=urlsplit(base).hostname if provider == "openai" else "claude-cli", key_changed=bool(newkey), allow=len(cur.get("allow") or []) if scope == "system" else None)
        return self.public(cur, scope, user), None

    def remove(self, user, ref, ip=None):
        scope = "user" if ref.startswith("u:") else "system"
        if scope == "system" and user.get("role") != "admin":
            return "관리자만 지울 수 있어요."
        with _lock:
            st = self._load_sys() if scope == "system" else self._load_user(user["id"])
            before = len(st["profiles"])
            st["profiles"] = [x for x in st["profiles"] if x["id"] != ref[2:]]
            if len(st["profiles"]) == before:
                return "없는 연결이에요."
            if scope == "system":
                _atomic_json(self.f_sys, st)
            else:
                if st.get("active") == ref:
                    st["active"] = None
                _atomic_json(self.f_user(user["id"]), st)
        logkit.audit("llm_profile_remove", ip=ip, user=user["id"], profile=ref)
        return None

    def set_active(self, user, ref):
        if ref:
            sc, p = self.resolve(user, ref)
            if not p:
                return "고를 수 없는 연결이에요."
        with _lock:
            st = self._load_user(user["id"])
            st["active"] = ref or None
            if ref and not ref.startswith("a:"):
                st["local"] = ref          # AI 관리시스템이 꺼졌을 때 돌아갈 자기 연결
            _atomic_json(self.f_user(user["id"]), st)
        return None

    def export_profiles(self, user, with_keys=False):
        """내 눈에 보이는 연결을 llm-lab-profiles 형식으로. 키는 기본 제외, 관리자가 고르면 포함."""
        keys = bool(with_keys) and user.get("role") == "admin"
        out = []
        for sc, p in self.visible(user):
            cli = p.get("provider") == "claude-cli"
            k = ""
            if keys and not cli and p.get("key"):
                k = self.secret(sc, "system" if sc == "system" else user["id"], p)
            elif p.get("key"):
                k = "(내보내기에서 뺌)"
            out.append({"id": p["id"], "service": p.get("name") or p.get("model"), "provider": p.get("provider", "openai"), "base_url": "" if cli else p.get("base_url", ""),
                        "model": p.get("model", ""), "auth": {"api_key": k}, "params": p.get("params") or dict(DEFAULT_PARAMS), "note": p.get("note", "")})
        return {"type": "llm-lab-profiles", "version": 1, "created": int(time.time() * 1000), "profiles": out}

    def import_profiles(self, user, payload, ip=None):
        """예전 브라우저 형식(llm-lab-profiles / 배열 / 내부 Profile) → 내 계정으로. 같은 주소+모델은 덮어쓴다."""
        data = payload
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except ValueError:
                return 0, "JSON 형식이 아니에요."
        lst = data if isinstance(data, list) else (data.get("profiles") if isinstance(data, dict) and isinstance(data.get("profiles"), list) else [data] if isinstance(data, dict) else [])
        n, errs = 0, []
        mine = self._load_user(user["id"])["profiles"]
        for raw in lst:
            if not isinstance(raw, dict):
                continue
            base = str(raw.get("base_url") or raw.get("baseUrl") or "").strip().rstrip("/")
            model = str(raw.get("model") or "").strip()
            key = str((raw.get("auth") or {}).get("api_key") or raw.get("api_key") or "").strip()
            if key.startswith("("):            # "(내보내기에서 뺌)" 같은 자리표시
                key = ""
            if raw.get("provider") == "claude-cli":      # CLI 는 이 PC 의 공용 연결 — 관리자만, 같은 모델이면 건너뛴다
                if user.get("role") != "admin":
                    continue
                if any(x.get("provider") == "claude-cli" and x.get("model") == model for x in self._load_sys()["profiles"]):
                    continue
                pu, err = self.save(user, {"provider": "claude-cli", "name": raw.get("service") or "Claude (이 PC)", "model": model, "params": raw.get("params") or {}, "note": raw.get("note") or ""}, ip)
                if err:
                    errs.append(err)
                else:
                    n += 1
                continue
            nb = re.sub(r"/chat/completions$", "", base)
            if not key and any(sc == "system" and x.get("base_url") == nb and x.get("model") == model for sc, x in self.visible(user)):
                continue                       # 키 없는 내보내기 파일을 다시 넣어도 공용 연결을 키 없는 사본으로 늘리지 않는다
            same = next((x for x in mine if x.get("base_url") == nb and x.get("model") == model), None)
            body = {"id": same["id"] if same else None, "provider": "openai", "name": raw.get("service") or raw.get("name") or model,
                    "base_url": base, "model": model, "api_key": key, "params": raw.get("params") or {}, "note": raw.get("note") or raw.get("network") or ""}
            pu, err = self.save(user, body, ip)
            if err:
                errs.append(err)
            else:
                n += 1
                mine = self._load_user(user["id"])["profiles"]
        return n, ("; ".join(sorted(set(errs))) if errs else None)


# ---------------------------------------------------------------------------
# 호출(프록시)
# ---------------------------------------------------------------------------
def _openai_request(p, key, messages, opts, stream):
    pr = p.get("params") or DEFAULT_PARAMS
    body = {"model": p["model"], "messages": messages,
            "temperature": opts.get("temperature") if opts.get("temperature") is not None else pr.get("temperature", 0.7),
            "max_tokens": opts.get("maxTokens") if opts.get("maxTokens") is not None else pr.get("max_tokens", 2048),
            "top_p": pr.get("top_p", 1), "stream": bool(stream)}
    h = {"Content-Type": "application/json", "User-Agent": BROWSER_UA, "Accept": "text/event-stream" if stream else "application/json"}
    if key:
        h["Authorization"] = "Bearer " + key
    return urllib.request.Request(p["base_url"] + "/chat/completions", data=json.dumps(body).encode("utf-8"), headers=h, method="POST")


def _sse(handler, obj):
    handler.wfile.write(("data: " + json.dumps(obj, ensure_ascii=False) + "\n\n").encode("utf-8"))
    handler.wfile.flush()


def chat(store, handler, user, body, ip):
    messages = body.get("messages")
    if not isinstance(messages, list) or not messages:
        return handler._json(400, {"ok": False, "message": "messages 가 없어요."})
    opts = body.get("opts") or {}
    stream = bool(opts.get("stream"))
    if body.get("ref"):
        sc, p = store.resolve(user, body["ref"])
    else:
        sc, p = store.active(user)
    if not p:
        return handler._json(409, {"ok": False, "error": "no_llm", "message": "AI 연결이 선택되어 있지 않아요. 설정 → AI 연결에서 연결을 고르세요."})
    aim_resp, fell, emg = None, None, False
    if sc == "aim":          # (v139) AI 관리시스템 중계 — 키는 그쪽 밖으로 나오지 않는다
        import aireg_api
        try:
            if p.get("down"):
                raise aireg_api.Unavailable("AI 관리시스템이 응답하지 않습니다.")
            p, aim_resp = store.aim.chat(user, p["id"], messages, opts, stream)
        except (aireg_api.Unavailable, aireg_api.Denied) as e:
            ep = emergency_profile(store, user, p["id"], e)            # (v169) 비상 AI 18.6 — 이전에 쓰던 사람은 저장된 연결로
            if ep:
                sc, p, emg = "emg", ep, True
            elif isinstance(e, aireg_api.Denied):
                logkit.log("llm", "WARNING", "chat aim_denied", user=user["id"], profile="a:" + p["id"], status=e.status, ip=ip)
                return handler._json(e.status if e.status in (401, 403, 404) else 502, {"ok": False, "error": "aim_denied", "message": str(e)})
            else:
                sc2, p2 = store.local_fallback(user)
                if not p2:
                    logkit.log("llm", "WARNING", "chat aim_down", user=user["id"], profile="a:" + p["id"], ip=ip)
                    return handler._json(503, {"ok": False, "error": "aim_down", "message": str(e) + " 대신 쓸 자기 AI 연결도 없습니다."})
                fell = "a:" + p["id"]
                sc, p = sc2, p2
    ref = ("a:" if sc in ("aim", "emg") else "u:" if sc == "user" else "s:") + p["id"]
    provider = p.get("provider", "openai")
    timeout_s = max(5, int((p.get("params") or {}).get("timeout_ms", 120000)) / 1000.0)
    t0 = time.time()
    chars_in = sum(len(str(m.get("content") or "")) for m in messages)
    out_len = [0]
    status = "ok"

    def done(st, extra=None):
        ex = dict(extra or {})
        if fell:
            ex["fallback_from"] = fell
        if emg:
            ex["emergency"] = True
        logkit.log("llm", "INFO" if st == "ok" else "WARNING", "chat " + st, user=user["id"], profile=ref, provider=provider, model=p.get("model"),
                   stream=stream, ms=int((time.time() - t0) * 1000), chars_in=chars_in, chars_out=out_len[0], ip=ip, **ex)
        if emg:              # (v169) 비상 사용 기록 → 116s0 스풀로 AI 관리 쪽 감사에도 간다
            logkit.audit("ai.emergency_use", ok=st == "ok", user=user["id"], ip=ip, uuid=((user.get("sso") or {}).get("uuid")), profile=p["id"], provider=provider,
                         tokens=out_len[1] if len(out_len) > 1 else None, chars_in=chars_in, chars_out=out_len[0], result=st)
    hdr = [("X-AI-Emergency", "1")] if emg else []

    if aim_resp is not None:
        return _relay(handler, aim_resp, stream, done, out_len)

    if provider == "claude-cli":
        if stream:
            handler.send_response(200)
            handler.send_header("Content-Type", "text/event-stream; charset=utf-8")
            handler.send_header("X-Accel-Buffering", "no")
            for k, v in hdr:
                handler.send_header(k, v)
            handler.end_headers()
            handler.close_connection = True
            broken = [False]

            def emit(t):
                out_len[0] += len(t)
                try:
                    _sse(handler, {"choices": [{"delta": {"content": t}}]})
                except OSError:
                    broken[0] = True
            try:
                run_cli(store.sandbox, p.get("model"), messages, timeout_s, on_text=emit, cancel=lambda: broken[0])
                if not broken[0]:
                    handler.wfile.write(b"data: [DONE]\n\n"); handler.wfile.flush()
                done("ok" if not broken[0] else "client_gone")
            except Exception as e:
                done("error", {"err": str(e)[:200]})
                try:
                    _sse(handler, {"error": {"message": str(e)[:300]}})
                except OSError:
                    pass
            return None
        try:
            text = run_cli(store.sandbox, p.get("model"), messages, timeout_s)
        except Exception as e:
            done("error", {"err": str(e)[:200]})
            return handler._json(502, {"ok": False, "message": str(e)[:300]})
        out_len[0] = len(text)
        done("ok")
        return handler._json(200, {"choices": [{"message": {"role": "assistant", "content": text}}], "model": p.get("model")}, headers=hdr)

    # OpenAI 호환
    if user.get("role") != "admin" and not store.auth.policy()["user_llm_private_hosts"] and sc == "user" and host_is_private(p["base_url"]):
        done("blocked_private")
        return handler._json(403, {"ok": False, "message": "보안 정책상 사설망 주소로는 보낼 수 없어요."})
    try:
        key = (p.get("_k") or "") if sc == "emg" else store.secret(sc, "system" if sc == "system" else user["id"], p)
    except Exception as e:
        done("key_error", {"err": str(e)[:120]})
        return handler._json(500, {"ok": False, "message": "저장된 키를 풀지 못했어요 — 연결을 다시 등록해 주세요."})
    try:
        resp = urllib.request.urlopen(_openai_request(p, key, messages, opts, stream), timeout=timeout_s)
    except urllib.error.HTTPError as e:
        msg = e.read()[:400].decode("utf-8", "replace")
        done("http_%d" % e.code)
        return handler._json(502, {"ok": False, "status": e.code, "message": "AI 서버 응답 오류(HTTP %d) %s" % (e.code, re.sub(r"\s+", " ", msg)[:200])})
    except Exception as e:
        done("unreachable", {"err": str(e)[:160]})
        return handler._json(502, {"ok": False, "message": "AI 서버에 연결하지 못했어요: " + str(e)[:160]})
    return _relay(handler, resp, stream, done, out_len, hdr)


def emergency_profile(store, user, pid, err):
    """(v169) 비상 AI 조건(18.6 2-2 ③): 연결 실패·시간 초과·5xx(비상 로그인 세션이면 403 도) + 묶음 만료 전 + grants + 최근 30일 사용.
    claude-cli 는 이 PC 에 같은 CLI 가 있을 때만."""
    import aireg_api
    if not store.aim:
        return None
    if isinstance(err, aireg_api.Denied) and not (user.get("emergency") and aireg_api.user_unverified(err)):
        return None
    ep = store.aim.emergency_for(user, pid)
    if ep and ep["provider"] == "claude-cli" and not cli_info().get("available"):
        return None
    if ep and ep["provider"] != "claude-cli" and not valid_url(ep.get("base_url") or ""):
        return None
    return ep


def _relay(handler, resp, stream, done, out_len, hdr=None):
    """OpenAI 호환 응답을 그대로 넘긴다(일반·스트리밍). 자기 연결과 AI 관리시스템 중계가 같이 쓴다."""
    status = "ok"
    with resp:
        if not stream:
            data = resp.read(16 * 1024 * 1024)
            try:
                obj = json.loads(data.decode("utf-8", "replace"))
                out_len[0] = len(((obj.get("choices") or [{}])[0].get("message") or {}).get("content") or "")
                if isinstance(obj.get("usage"), dict):
                    out_len.append(obj["usage"].get("total_tokens"))
            except ValueError:
                done("bad_json")
                return handler._json(502, {"ok": False, "message": "AI 서버가 JSON 이 아닌 응답을 보냈어요."})
            done("ok")
            return handler._json(200, obj, headers=hdr or None)
        handler.send_response(200)
        handler.send_header("Content-Type", "text/event-stream; charset=utf-8")
        handler.send_header("X-Accel-Buffering", "no")
        for k, v in (hdr or []):
            handler.send_header(k, v)
        handler.end_headers()
        handler.close_connection = True
        try:
            for line in resp:
                if line.startswith(b"data:") and b'"content"' in line:
                    out_len[0] += max(0, len(line) - 80)
                handler.wfile.write(line)
                if line in (b"\n", b"\r\n"):
                    handler.wfile.flush()
            handler.wfile.flush()
            done(status)
        except OSError:
            done("client_gone")
    return None


def complete(store, user, messages, max_tokens=900, temperature=0.3):
    """서버 안에서 쓰는 한 번 호출(배경 작업). → (글, 연결 이름). 실패하면 예외."""
    sc, p = store.active(user)
    if not p:
        raise RuntimeError("AI 연결이 선택되어 있지 않아요.")
    if sc == "aim":          # (v139) 작업을 만든 사람의 uuid 로 AI 관리시스템 중계, 꺼져 있으면 자기 연결
        import aireg_api
        try:
            if p.get("down"):
                raise aireg_api.Unavailable("down")
            t0 = time.time()
            p, r = store.aim.chat(user, p["id"], messages, {"maxTokens": max_tokens, "temperature": temperature}, False)
            with r:
                obj = json.loads(r.read(16 * 1024 * 1024).decode("utf-8", "replace") or "{}")
            text = ((obj.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
            logkit.log("llm", "INFO", "task ok", user=user["id"], provider="aim", model=p.get("model"), profile="a:" + p["id"], ms=int((time.time() - t0) * 1000), chars_out=len(text))
            if not text.strip():
                raise RuntimeError("AI 가 빈 답을 보냈어요.")
            return text, (p.get("name") or p.get("model") or "") + " (AI 관리시스템)"
        except (aireg_api.Unavailable, aireg_api.Denied) as e:
            ep = emergency_profile(store, user, p["id"], e)            # (v169) 비상 AI — 배경 작업도 같은 규칙
            if ep:
                return _emg_complete(store, user, ep, messages, max_tokens, temperature)
            if isinstance(e, aireg_api.Denied):
                raise RuntimeError(str(e))
            sc, p = store.local_fallback(user)
            if not p:
                raise RuntimeError("AI 관리시스템이 응답하지 않고 대신 쓸 자기 AI 연결도 없어요.")
    name = p.get("name") or p.get("model") or ""
    timeout_s = max(5, int((p.get("params") or {}).get("timeout_ms", 120000)) / 1000.0)
    t0 = time.time()
    if p.get("provider") == "claude-cli":
        text = run_cli(store.sandbox, p.get("model"), messages, timeout_s)
    else:
        if user.get("role") != "admin" and not store.auth.policy()["user_llm_private_hosts"] and sc == "user" and host_is_private(p["base_url"]):
            raise RuntimeError("보안 정책상 사설망 주소로는 보낼 수 없어요.")
        key = store.secret(sc, "system" if sc == "system" else user["id"], p)
        try:
            with urllib.request.urlopen(_openai_request(p, key, messages, {"maxTokens": max_tokens, "temperature": temperature}, False), timeout=timeout_s) as r:
                obj = json.loads(r.read(16 * 1024 * 1024).decode("utf-8", "replace"))
        except urllib.error.HTTPError as e:
            raise RuntimeError("AI 서버 응답 오류(HTTP %d)" % e.code)
        text = ((obj.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
    logkit.log("llm", "INFO", "task ok", user=user["id"], provider=p.get("provider"), model=p.get("model"), ms=int((time.time() - t0) * 1000), chars_out=len(text))
    if not text.strip():
        raise RuntimeError("AI 가 빈 답을 보냈어요.")
    return text, name


def _emg_complete(store, user, p, messages, max_tokens, temperature):
    t0, st, text = time.time(), "ok", ""
    try:
        timeout_s = max(5, int(p["params"].get("timeout_ms", 120000)) / 1000.0)
        if p["provider"] == "claude-cli":
            text = run_cli(store.sandbox, p.get("model"), messages, timeout_s)
        else:
            try:
                with urllib.request.urlopen(_openai_request(p, p.get("_k") or "", messages, {"maxTokens": max_tokens, "temperature": temperature}, False), timeout=timeout_s) as r:
                    obj = json.loads(r.read(16 * 1024 * 1024).decode("utf-8", "replace"))
            except urllib.error.HTTPError as e:
                st = "http_%d" % e.code
                raise RuntimeError("AI 서버 응답 오류(HTTP %d)" % e.code)
            text = ((obj.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
        if not text.strip():
            st = "empty"
            raise RuntimeError("AI 가 빈 답을 보냈어요.")
        return text, (p.get("name") or p.get("model") or "") + " (비상 모드)"
    except RuntimeError:
        raise
    except Exception as e:
        st = "error"
        raise RuntimeError("AI 서버에 연결하지 못했어요: " + str(e)[:120])
    finally:
        logkit.log("llm", "INFO" if st == "ok" else "WARNING", "task " + st, user=user["id"], provider=p.get("provider"), model=p.get("model"), profile="a:" + p["id"],
                   emergency=True, ms=int((time.time() - t0) * 1000), chars_out=len(text))
        logkit.audit("ai.emergency_use", ok=st == "ok", user=user["id"], uuid=((user.get("sso") or {}).get("uuid")), profile=p["id"], provider=p.get("provider"), chars_out=len(text), result=st, via="task")


def test_profile(store, user, ref):
    sc, p = store.resolve(user, ref)
    if not p:
        return False, "없는 연결이에요."
    if sc == "aim":
        if p.get("down"):
            return False, "AI 관리시스템이 응답하지 않습니다."
        return True, "AI 관리시스템에서 쓸 수 있는 프로필입니다 · " + (p.get("model") or p.get("name") or "")
    t0 = time.time()
    if p.get("provider") == "claude-cli":
        info = cli_info(force=True)
        if not info["available"]:
            return False, "claude 명령을 찾지 못했어요" + (": " + info.get("error") if info.get("error") else "")
        try:
            txt = run_cli(store.sandbox, p.get("model"), [{"role": "user", "content": "Reply with exactly: OK"}], 90)
            return True, "연결 성공 · %s · %.1f초 · 응답 '%s'" % (info.get("version") or "claude", time.time() - t0, txt.strip()[:20])
        except Exception as e:
            return False, str(e)[:200]
    try:
        key = store.secret(sc, "system" if sc == "system" else user["id"], p)
        req = urllib.request.Request(p["base_url"] + "/models", headers={"User-Agent": BROWSER_UA, **({"Authorization": "Bearer " + key} if key else {})})
        with urllib.request.urlopen(req, timeout=15) as r:
            ids = []
            try:
                ids = [m.get("id") for m in (json.loads(r.read(2 * 1024 * 1024).decode("utf-8", "replace")).get("data") or [])][:8]
            except ValueError:
                pass
        has = (" · 모델 확인됨" if p.get("model") in ids else (" · 서버 모델: " + ", ".join(i for i in ids if i)[:120] if ids else ""))
        return True, "연결 성공 (%.1f초)%s" % (time.time() - t0, has)
    except urllib.error.HTTPError as e:
        return False, "응답 오류 (HTTP %d)" % e.code
    except Exception as e:
        return False, "연결 실패: " + str(e)[:160]


def handle(store, handler, q, method):
    g = lambda k, d="": (q.get(k) or [d])[0]
    op = g("op")
    user = getattr(handler, "auth_user", None)
    import auth_api
    ip = auth_api.client_ip(handler)
    if not user:
        return handler._json(401, {"ok": False, "error": "no_session", "message": "로그인이 필요해요."})
    if method == "GET":
        if op == "profiles":
            d = store.list(user)
            pol = store.auth.policy()
            ci = cli_info() if user.get("role") == "admin" else {"available": None}
            return handler._json(200, {"ok": True, "profiles": d["profiles"], "active": d["active"], "auto": bool(d.get("auto")), "is_admin": user.get("role") == "admin",
                                       "policy": {"user_llm_profiles": pol["user_llm_profiles"], "user_llm_private_hosts": pol["user_llm_private_hosts"]},
                                       "cli": {"available": ci.get("available"), "version": ci.get("version")}})
        if op == "health":
            sc, p = store.active(user)
            if not p:
                return handler._json(200, {"ok": False, "connected": False})
            if sc == "aim":
                if p.get("down") and store.aim and store.aim.emergency_for(user, p["id"]):      # (v169)
                    return handler._json(200, {"ok": True, "connected": True, "aim": True, "emergency": True})
                return handler._json(200, {"ok": not p.get("down"), "connected": True, "aim": True})
            if p.get("provider") == "claude-cli":
                return handler._json(200, {"ok": bool(cli_info()["available"]), "connected": True})
            try:
                key = store.secret(sc, "system" if sc == "system" else user["id"], p)
                req = urllib.request.Request(p["base_url"] + "/models", headers={"User-Agent": BROWSER_UA, **({"Authorization": "Bearer " + key} if key else {})})
                with urllib.request.urlopen(req, timeout=8) as r:
                    return handler._json(200, {"ok": r.status < 400, "connected": True})
            except Exception:
                return handler._json(200, {"ok": False, "connected": True})
        if op == "aim":      # (v139) AI 관리시스템에서 받기 — 이 계정이 허용받은 프로필
            if not store.aim:
                return handler._json(200, {"ok": True, "ready": False, "profiles": [], "message": "AI 관리시스템 연동이 없습니다."})
            st = store.aim.status(user)
            st["profiles"] = [store.aim_public(x) for x in st["profiles"]]
            if user.get("role") == "admin":
                c = store.aim.conf()
                st["admin"] = {"internal": c["internal"], "hasToken": st["ready"], "handoff": store.aim.has_handoff(), "updated": c.get("updated"), "emergency": store.aim.emergency_info()}
            return handler._json(200, dict(st, ok=True))
        return handler._json(404, {"ok": False, "message": "없는 동작"})
    if method != "POST":
        return handler._json(405, {"ok": False, "message": "허용 안 됨"})
    if not auth_api.csrf_ok(handler):
        logkit.warn("security", "CSRF 차단(llm)", ip=ip, op=op)
        return handler._json(403, {"ok": False, "message": "요청 출처를 확인할 수 없어요."})
    b = auth_api.body_json(handler, MAX_BODY)
    if op == "chat":
        return chat(store, handler, user, b, ip)
    if op == "aim_emg_fetch":          # (v169) 관리자: 비상 AI 묶음 지금 받기
        if user.get("role") != "admin" or not store.aim:
            return handler._json(403, {"ok": False, "message": "관리자만 할 수 있어요."})
        ok, msg = store.aim.fetch_emergency(user["id"])
        return handler._json(200 if ok else 502, {"ok": ok, "message": msg, "emergency": store.aim.emergency_info()})
    if op in ("aim_handoff", "aim_addr"):
        if user.get("role") != "admin" or not store.aim:
            return handler._json(403, {"ok": False, "message": "관리자만 바꿀 수 있어요."})
        if op == "aim_handoff":
            err = store.aim.handoff(user["id"])
            return handler._json(400 if err else 200, {"ok": not err, "message": err})
        ins = str((b or {}).get("internal") or "").strip().rstrip("/")
        if not re.match(r"^https?://[A-Za-z0-9.\-\[\]:]+$", ins):
            return handler._json(400, {"ok": False, "message": "주소 형식이 맞지 않습니다(http(s)://…)."})
        store.aim.save({"internal": ins}, user["id"])
        logkit.audit("aim_addr", user=user["id"], ip=ip, internal=ins)
        return handler._json(200, {"ok": True})
    if op == "save":
        pu, err = store.save(user, b.get("profile") or {}, ip)
        return handler._json(200 if pu else 400, {"ok": bool(pu), "profile": pu, "message": err})
    if op == "remove":
        err = store.remove(user, str(b.get("ref") or ""), ip)
        return handler._json(400 if err else 200, {"ok": not err, "message": err})
    if op == "active":
        err = store.set_active(user, b.get("ref") or None)
        return handler._json(400 if err else 200, {"ok": not err, "message": err, "active": b.get("ref") or None})
    if op == "test":
        ok, msg = test_profile(store, user, str(b.get("ref") or ""))
        logkit.info("llm", "test " + ("ok" if ok else "fail"), user=user["id"], profile=b.get("ref"), result=msg[:120])
        return handler._json(200, {"ok": ok, "message": msg})
    if op == "export":
        wk = bool(b.get("withKeys"))
        if wk and user.get("role") != "admin":
            return handler._json(403, {"ok": False, "message": "키를 포함한 내보내기는 관리자만 할 수 있어요."})
        logkit.audit("llm_export", user=user["id"], ip=ip, with_keys=wk)
        return handler._json(200, {"ok": True, "payload": store.export_profiles(user, wk)})
    if op == "import":
        n, err = store.import_profiles(user, b.get("payload"), ip)
        return handler._json(200 if n else 400, {"ok": bool(n), "added": n, "message": err or (None if n else "새로 넣을 연결이 없어요(이미 등록돼 있어요).")})
    return handler._json(404, {"ok": False, "message": "없는 동작"})
