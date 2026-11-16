# -*- coding: utf-8 -*-
"""학습 자료 목록(app-html/library/catalog.json) 만들기.

    python tools/build_catalog.py

app-html/library/docs/*.html 의 <script type="application/json" id="doc-meta"> 를 모아 catalog.json 을 다시 쓴다.
분류 이름(taxonomy)은 지금 catalog.json 의 것을 그대로 두고, 새 분류는 id 를 이름으로 채운다(나중에 손으로 고친다).
"""
import datetime
import io
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LIB = os.path.join(os.path.dirname(HERE), "app-html", "library")
DOCS = os.path.join(LIB, "docs")
CAT = os.path.join(LIB, "catalog.json")
META = re.compile(r'<script[^>]*id="doc-meta"[^>]*>(.*?)</script>', re.S)
FIELDS = ["schema", "id", "title", "summary", "domain", "track", "topic", "level", "minutes", "tags", "status", "updated", "source", "authors"]


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    old = {}
    if os.path.exists(CAT):
        with io.open(CAT, encoding="utf-8") as f:
            old = json.load(f)
    tax = old.get("taxonomy") or {}
    docs, warn = [], []
    for fn in sorted(os.listdir(DOCS)) if os.path.isdir(DOCS) else []:
        if not fn.endswith(".html"):
            continue
        p = os.path.join(DOCS, fn)
        with io.open(p, encoding="utf-8") as f:
            html = f.read()
        doc_id = fn[:-5]
        m = META.search(html)
        meta = {}
        if m:
            try:
                meta = json.loads(m.group(1))
            except ValueError as e:
                warn.append("%s: doc-meta JSON 오류 — %s" % (fn, e))
        else:
            warn.append("%s: doc-meta 없음 — 제목만 씀" % fn)
        if not meta.get("title"):
            t = re.search(r"<title>(.*?)</title>", html, re.S)
            meta["title"] = (t.group(1).strip() if t else doc_id)
        d = {k: meta[k] for k in FIELDS if k in meta}
        d["schema"] = d.get("schema") or "lds/1.0"
        d["id"] = doc_id                                   # 파일 이름이 정본
        d.setdefault("domain", "misc")
        d.setdefault("track", "general")
        d.setdefault("status", "published")
        d["path"] = "library/docs/" + fn
        d["bytes"] = os.path.getsize(p)
        docs.append(d)
        dom = tax.setdefault(d["domain"], {"label": d["domain"], "tracks": {}})
        tr = dom.setdefault("tracks", {}).setdefault(d["track"], {"label": d["track"], "topics": {}})
        if d.get("topic"):
            tr.setdefault("topics", {}).setdefault(d["topic"], d["topic"])
    out = {"schema": "library-catalog/1.0", "generated": datetime.date.today().isoformat(), "count": len(docs),
           "taxonomy": tax, "subjects": [], "docs": docs}
    with io.open(CAT, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print("catalog.json — 문서 %d편" % len(docs))
    for w in warn:
        print("  확인 필요:", w)
    return 0


if __name__ == "__main__":
    sys.exit(main())
