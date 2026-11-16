# -*- coding: utf-8 -*-
"""(v145) 통합로그인에 이 시스템 계정 목록을 전체 보낸다(S-2) / 연결 사건을 받는다(S-4). 서버 PC 에서:
  python tools/ulink_push.py            전체 보내기
  python tools/ulink_push.py --feed     연결 사건 받아 반영
  python tools/ulink_push.py --file 목록.json   보내는 대신 S-2 accounts 형식 JSON 파일로 저장(통합로그인 관리자가 올릴 수 있다)
  --data <데이터 폴더>
비밀값은 화면·로그에 쓰지 않는다. 비밀번호·해시는 보내지 않는다.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import auth_api   # noqa: E402
import llm_api    # noqa: E402
import logkit     # noqa: E402
import sso_api    # noqa: E402
import ulink_api  # noqa: E402
import ws_api     # noqa: E402


def main(argv):
    for st in (sys.stdout, sys.stderr):
        try:
            st.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    data = next((a.split("=", 1)[1] for a in argv if a.startswith("--data=")), None) or ws_api.resolve_data_dir(ROOT, [], os.environ)
    logkit.setup(os.path.join(data, "logs"), console=False)
    auth = auth_api.AuthStore(data)
    sso = sso_api.Sso(data, auth, llm_api.SecretBox(os.path.join(data, "system", "secret.key")), None)
    ul = ulink_api.ULink(data, sso, auth)
    if "--file" in argv:
        out = argv[argv.index("--file") + 1]
        accs = [ulink_api.account_of(u) for u in auth._users()["users"]]
        with open(out, "w", encoding="utf-8") as fh:
            json.dump({"service_id": sso.conf()["service_id"], "accounts": accs}, fh, ensure_ascii=False, indent=1)
        print("계정 %d개를 %s 에 썼습니다(비밀번호·해시 없음)." % (len(accs), out))
        return 0
    r = ul.feed() if "--feed" in argv else ul.push(True, by="cli")
    print(json.dumps(r, ensure_ascii=False))
    return 0 if r.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
