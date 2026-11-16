# -*- coding: utf-8 -*-
"""(v156) 비상 복구 — 통합로그인으로 이관된 계정을 이 시스템 계정으로 되돌린다. 서버 PC 에서만.

통합로그인이 멈추면 이관된 관리자도 들어올 수 없다. 모드를 off 로 바꿔도(sso_off.py) 이관된 계정은 로컬로 돌아오지 않는다.
이 명령이 그 계정의 통합로그인 묶음을 풀고, 이 시스템의 비밀번호 재설정 경로로 돌려놓는다.

  python tools/sso_release.py <아이디>                       묶음만 푼다 → 런처 [계정 복구]나 관리자 [비번 초기화]로 새 비밀번호
  python tools/sso_release.py <아이디> --set-password          묶음을 풀고 새 비밀번호를 이 창에서 두 번 입력(화면에 안 보임, 다음 로그인 때 바꾸게 함)
  python tools/sso_release.py <아이디> --password-stdin        새 비밀번호를 표준 입력 첫 줄에서(자동화·시험용)
  --data <데이터 폴더>

비밀번호는 명령줄 인자로 받지 않는다(기록에 남지 않게). 감사 기록 sso_release 를 남긴다. 계정과 데이터는 지우지 않는다.
"""
import getpass
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import auth_api   # noqa: E402
import logkit     # noqa: E402
import ws_api     # noqa: E402


def main(argv):
    for st in (sys.stdout, sys.stderr):
        try:
            st.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    args = [a for a in argv if not a.startswith("--")]
    if not args:
        print(__doc__)
        return 2
    data = next((a.split("=", 1)[1] for a in argv if a.startswith("--data=")), None)
    if "--data" in argv:
        data = argv[argv.index("--data") + 1]
        args = [a for a in args if a != data]
    data = os.path.abspath(data) if data else ws_api.resolve_data_dir(ROOT, [], os.environ)
    logkit.setup(os.path.join(data, "logs"), console=False)
    auth = auth_api.AuthStore(data, seed_admin=None)
    u = auth.find(username=args[0])
    if not u:
        print("그런 아이디가 없습니다:", args[0])
        return 1
    new = None
    if "--password-stdin" in argv:
        new = sys.stdin.readline().rstrip("\r\n")
    elif "--set-password" in argv:
        new = getpass.getpass("새 비밀번호: ")
        if new != getpass.getpass("한 번 더: "):
            print("두 번 입력한 값이 다릅니다. 바꾸지 않았습니다.")
            return 1
    if new is not None:
        err = auth.check_new_password(u["username"], new)
        if err:
            print(err, "바꾸지 않았습니다.")
            return 1
    was_linked = bool((u.get("sso") or {}).get("uuid"))
    with auth_api._lock:
        st = auth._users()
        x = next(y for y in st["users"] if y["id"] == u["id"])
        x.pop("sso", None)
        x["local_login"] = True
        x["released"] = auth_api._now()
        if new is not None:
            x["pw"] = auth_api.hash_password(new)
            x.update(default_pw=False, must_change=True, fails=0, lock_until=0, lock_level=0)
            x.pop("migrated", None)
        x["updated"] = auth_api._now()
        auth._save_users(st)
    n = auth.revoke_user_sessions(u["id"])
    logkit.audit("sso_release", user=u["id"], username=u["username"], was_linked=was_linked, password_set=new is not None, sessions=n, note="서버 PC 비상 복구")
    print("%s: 통합로그인 묶음을 풀었습니다%s. 세션 %d개를 끝냈습니다." % (u["username"], "" if was_linked else "(묶여 있지 않았음)", n))
    if new is None:
        print("이제 런처 [계정 복구]나 관리자 [비번 초기화]로 새 비밀번호를 정하면 로컬로 로그인할 수 있습니다.")
    else:
        print("새 비밀번호로 로그인할 수 있습니다(다음 로그인 때 바꾸게 했습니다).")
    print("통합로그인 모드가 only 면 로컬 로그인이 막힙니다 — 필요하면 python tools/sso_off.py")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
