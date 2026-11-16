# -*- coding: utf-8 -*-
"""연결 폴더 경로 고치기. ScholarFlow 폴더를 옮겨도 연결 폴더 내용은 따라가지 않는다(원본은 밖에 있다).

  python tools/relink_folders.py                     연결 폴더 목록과 지금 찾을 수 있는지 본다
  python tools/relink_folders.py --from C:\\옛경로 --to D:\\새경로          바뀔 내용만 보여 준다
  python tools/relink_folders.py --from C:\\옛경로 --to D:\\새경로 --apply  고친다

서버를 끈 뒤에 --apply 한다. project.json 의 source.path 와 masters 파일의 path 앞부분만 바꾼다.
원본 폴더와 파일은 건드리지 않는다.
"""
import argparse
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import ws_api  # noqa: E402
import vfs      # noqa: E402  (v151) SQLite 엔진이면 데이터 폴더의 .json·.jsonl 은 DB — 아래 open·exists 등은 vfs 판
open = vfs.open  # noqa: A001


def norm(p):
    return os.path.normcase(os.path.normpath(p))


def moved(path, old, new):
    if not old or not path:
        return None
    a, b = norm(path), norm(old)
    if a == b or a.startswith(b + os.sep):
        return os.path.join(new, os.path.normpath(path)[len(os.path.normpath(old)):].lstrip("\\/"))
    return None


def write(fp, obj):
    tmp = fp + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
    vfs.replace(tmp, fp)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="old")
    ap.add_argument("--to", dest="new")
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()
    if bool(a.old) != bool(a.new):
        ap.error("--from 과 --to 를 함께 주세요.")
    data = ws_api.resolve_data_dir(ROOT, [], os.environ)
    total = found = changed = 0
    for u in sorted(vfs.listdir(os.path.join(data, "users"))):
        ud = os.path.join(data, "users", u)
        pd = os.path.join(ud, "projects")
        if not vfs.isdir(pd):
            continue
        for pid in sorted(vfs.listdir(pd)):
            fp = os.path.join(pd, pid, "project.json")
            if not vfs.isfile(fp):
                continue
            with open(fp, encoding="utf-8") as f:
                j = json.load(f)
            s = j.get("source") or {}
            if not s.get("path"):
                continue
            total += 1
            ok = vfs.isdir(s["path"])
            found += 1 if ok else 0
            np = moved(s["path"], a.old, a.new)
            if np:
                changed += 1
                print("%s  %s\n   -> %s" % (j.get("name"), s["path"], np))
                if a.apply:
                    s["path"] = np
                    write(fp, j)
            elif not a.old:
                print(("있음  " if ok else "없음  ") + str(j.get("name")) + "  " + s["path"])
        fp = os.path.join(ud, "masters.json")      # 마스터 폴더 목록
        if vfs.isfile(fp):
            with open(fp, encoding="utf-8") as f:
                ms = json.load(f)
            for m in ms if isinstance(ms, list) else []:
                np = moved(m.get("path"), a.old, a.new)
                if np:
                    print("마스터  %s\n   -> %s" % (m["path"], np))
                    if a.apply:
                        m["path"] = np
            if a.apply and a.old:
                write(fp, ms)
    print("연결 폴더 %d개, 지금 찾을 수 있는 것 %d개" % (total, found) + (", 바꿀 것 %d개%s" % (changed, "(적용함)" if a.apply else "(보기만 함)") if a.old else ""))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
