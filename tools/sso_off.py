# -*- coding: utf-8 -*-
"""비상 복구: 통합로그인 모드를 off 로 되돌린다(서버 PC 에서만 실행).

  python tools/sso_off.py            off 로 되돌린다(서버를 켠 채로 해도 다음 요청부터 반영)
  python tools/sso_off.py --status   지금 모드만 본다

통합로그인 서버가 꺼졌거나 관리자가 잠겼을 때 쓴다. 웹 경로는 없다. 계정·연결 데이터는 지우지 않는다.
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import sso_api  # noqa: E402
import ws_api  # noqa: E402


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    data = ws_api.resolve_data_dir(ROOT, sys.argv[1:], os.environ)
    c = sso_api._read(sso_api.conf_path(data), {}) or {}
    print("지금 모드:", c.get("mode") or "off")
    if "--status" in sys.argv:
        return
    sso_api.set_mode_file(data, "off", "local-console")
    try:
        import logkit
        logkit.audit("sso_mode", mode="off", via="sso_off.py")
    except Exception:
        pass
    print("off 로 되돌렸습니다. 로컬 아이디·비밀번호로 로그인할 수 있습니다.")


if __name__ == "__main__":
    main()
