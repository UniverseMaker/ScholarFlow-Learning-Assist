# -*- coding: utf-8 -*-
"""(v179) 비상용 관리자 계정 local-admin/1 — 비밀번호를 정하고 되돌리는 곳. 서버 PC 에서만.

아이디 admin 은 이 시스템의 로컬 계정이고 통합로그인과 묶지 않는다. 통합로그인 모드와 상관없이 늘 로컬로 로그인한다.
처음은 「비밀번호 미설정」 — 로그인할 수 없다. 사용자가 아래 둘 중 하나로 직접 정한다(값은 코드·문서·로그·메시지에 쓰지 않는다).

  화면  http://127.0.0.1:18162/local-admin      서버 PC 브라우저에서만 열린다(공개 도메인·터널·다른 PC 는 404)
  명령  python tools/local_admin.py status       상태 보기
        python tools/local_admin.py set          새 비밀번호를 이 창에서 두 번 입력(화면에 안 보임)
        python tools/local_admin.py reset        미설정으로 되돌림(로그인 막힘, 세션 끝냄)
        --data <데이터 폴더>   --password-stdin(set 을 표준 입력 첫 줄로 — 자동화·시험용)

해시는 bcrypt. 실패 횟수 제한·잠금은 다른 계정과 같다. 정하기·되돌리기·admin 로그인은 감사 기록과 보안 경고로 남는다(값은 남기지 않음).
"""
import getpass
import html
import os
import secrets
import sys
import threading
import time
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import auth_api   # noqa: E402
import logkit     # noqa: E402

_TOK = {}          # 화면 한 장마다 한 번 쓰는 값(10분) — 다른 사이트가 이 PC 브라우저로 몰래 보내는 요청을 막는다
_lk = threading.Lock()
LOOP_HOSTS = ("127.0.0.1", "localhost", "[::1]")


def _local_only(handler):
    """서버 PC 의 브라우저가 127.0.0.1·localhost 로 직접 연 요청만. 터널(Cf-*·X-Forwarded-For)·공개 도메인·다른 PC 는 아니다."""
    if auth_api.is_remote(handler):
        return False
    host = (handler.headers.get("Host") or "").strip().lower()
    hn = host.rsplit(":", 1)[0] if not host.startswith("[") else host.split("]")[0] + "]"
    return hn in LOOP_HOSTS


def _same_origin(handler):
    o = (handler.headers.get("Origin") or "").strip().lower()
    if o and urllib.parse.urlsplit(o).hostname not in ("127.0.0.1", "localhost", "::1"):
        return False
    sfs = (handler.headers.get("Sec-Fetch-Site") or "").lower()
    return sfs in ("", "same-origin", "none")


def _new_token():
    t = secrets.token_urlsafe(24)
    with _lk:
        now = time.time()
        for k in [k for k, v in _TOK.items() if v < now]:
            _TOK.pop(k, None)
        _TOK[t] = now + 600
    return t


def _take_token(t):
    with _lk:
        exp = _TOK.pop(str(t or ""), 0)
    return exp >= time.time()


def _page(handler, body, code=200):
    import sso_api
    return sso_api._page(handler, "비상용 관리자 계정", body, code, [("Cache-Control", "no-store"), ("X-Frame-Options", "DENY")])


def _form(handler):
    n = int(handler.headers.get("Content-Length") or 0)
    if n <= 0 or n > 4096:
        return {}
    return {k: v[0] for k, v in urllib.parse.parse_qs(handler.rfile.read(n).decode("utf-8", "replace"), keep_blank_values=True).items()}


def handle(auth, handler, method):
    if not _local_only(handler):
        return handler._json(404, {"ok": False})
    msg = ""
    if method == "POST":
        f = _form(handler)
        if not _same_origin(handler) or not _take_token(f.get("t")):
            return _page(handler, '<p class="err">요청을 확인할 수 없습니다. 이 화면을 다시 열어 주세요.</p><a class="btn" href="/local-admin">다시 열기</a>', 403)
        if f.get("act") == "set":
            if f.get("pw") != f.get("pw2"):
                msg = '<p class="err">두 번 입력한 비밀번호가 다릅니다.</p>'
            else:
                err = auth.bg_set(f.get("pw") or "", via="local-page")
                msg = '<p class="err">' + html.escape(err) + "</p>" if err else '<p class="ok">비밀번호를 정했습니다. 이제 로그인 화면의 「이 시스템 계정」에 admin 으로 로그인할 수 있습니다.</p>'
        elif f.get("act") == "reset":
            err = auth.bg_reset(via="local-page")
            msg = '<p class="err">' + html.escape(err) + "</p>" if err else '<p class="ok">미설정으로 되돌렸습니다. admin 으로는 로그인할 수 없습니다.</p>'
    st = auth.bg_status()
    t = _new_token()
    state = {"set": "설정됨", "unset": "미설정 — 로그인 불가"}.get(st["state"], "계정 없음(서버를 다시 시작하세요)")
    body = (msg + '<p>아이디 <b>admin</b> · 상태 <b>' + state + "</b>" + (" · 잠김" if st.get("locked") else "") + "</p>"
            '<ul class="muted"><li>서버 PC 에서만 열리는 화면</li><li>통합로그인 모드와 상관없이 로컬 로그인</li><li>' + str(auth_api.BG_MIN) + "자 이상, 값은 어디에도 남지 않음</li></ul>"
            '<form method="post" action="/local-admin" style="display:grid;gap:10px;margin-top:12px" autocomplete="off">'
            '<input type="hidden" name="t" value="' + t + '"><input type="hidden" name="act" value="set">'
            '<input class="input" type="password" name="pw" placeholder="새 비밀번호" autocomplete="new-password" required minlength="' + str(auth_api.BG_MIN) + '">'
            '<input class="input" type="password" name="pw2" placeholder="한 번 더" autocomplete="new-password" required minlength="' + str(auth_api.BG_MIN) + '">'
            '<button class="btn primary">' + ("비밀번호 바꾸기" if st["state"] == "set" else "비밀번호 정하기") + "</button></form>")
    if st["state"] == "set":
        t2 = _new_token()
        body += ('<form method="post" action="/local-admin" style="margin-top:14px" onsubmit="return confirm(\'미설정으로 되돌릴까요? admin 으로 로그인할 수 없게 됩니다.\')">'
                 '<input type="hidden" name="t" value="' + t2 + '"><input type="hidden" name="act" value="reset"><button class="btn">미설정으로 되돌리기</button></form>')
    return _page(handler, body)


def main(argv):
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    cmd = next((a for a in argv if not a.startswith("--")), "status")
    data = None
    if "--data" in argv:
        data = argv[argv.index("--data") + 1]
        if cmd == data:
            cmd = "status"
    import ws_api
    data = os.path.abspath(data) if data else ws_api.resolve_data_dir(ROOT, [], os.environ)
    logkit.setup(os.path.join(data, "logs"), console=False)
    import vfs
    vfs.ensure(data)          # 운영이 SQLite 면 그 DB 를(storage.json 기준)
    auth = auth_api.AuthStore(data, seed_admin=None)
    auth.ensure_breakglass()
    if cmd == "status":
        st = auth.bg_status()
        print("admin:", {"set": "설정됨", "unset": "미설정(로그인 불가)"}.get(st["state"], st["state"]), "· 잠김" if st.get("locked") else "")
        return 0
    if cmd == "reset":
        err = auth.bg_reset(via="cli")
        print(err or "미설정으로 되돌렸습니다. admin 으로는 로그인할 수 없습니다.")
        return 1 if err else 0
    if cmd == "set":
        if "--password-stdin" in argv:
            pw = sys.stdin.readline().rstrip("\r\n")
        else:
            pw = getpass.getpass("새 비밀번호(%d자 이상): " % auth_api.BG_MIN)
            if pw != getpass.getpass("한 번 더: "):
                print("두 번 입력한 값이 다릅니다. 바꾸지 않았습니다.")
                return 1
        err = auth.bg_set(pw, via="cli")
        print(err or "비밀번호를 정했습니다. 로그인 화면의 「이 시스템 계정」에 admin 으로 로그인하세요.")
        return 1 if err else 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
