# -*- coding: utf-8 -*-
"""(v105) 논문 작업실 서버 — LaTeX 컴파일 · SyncTeX(원고↔PDF 오가기) · 쪽 그림 · 그림 파일 · zip 가져오기/내보내기.

폴더(계정 데이터 안): users/<uid>/projects/<pid>/paper/<mid>/
  assets/                     그림·데이터 같은 바이너리(폴더 구조 그대로). 글 파일(.tex·.bib…)은 계정 저장소(paper.kv.json)에
  build/                      컴파일 작업 폴더(글 파일 + assets 사본 + 로그). 매번 바뀐 것만 다시 쓴다
  view.pdf · view.synctex.gz · view.json   마지막으로 만든 결과 — 쪽 그림·되찾기·찾기는 이것만 읽는다
엔진: 환경변수 STUDY_TEX > userdata/tex/tectonic(.exe) > PATH 의 tectonic·xelatex·lualatex·pdflatex
보안: TeX 엔진은 절대 경로(\\input{C:/…})로 이 PC 의 파일을 읽을 수 있다 — 그래서 컴파일은 관리자 계정만(ws_api 에서 확인).
      셸 실행(write18)은 끈다(--untrusted / -no-shell-escape). 파일 이름은 NAME_RE·'..' 금지로 작업 폴더 밖을 못 가리킨다.
"""
import safeio   # (v140) 정전 대비 쓰기(임시 파일 → fsync → 바꾸기)
import vfs      # noqa: E402  (v151) SQLite 엔진이면 데이터 폴더의 .json·.jsonl 은 DB — 아래 open·exists 등은 vfs 판
open = vfs.open  # noqa: A001
import gzip
import io
import json
import os
import re
import shutil
import subprocess
import threading
import time
import zipfile

import docview

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENGINES = ("tectonic", "xelatex", "lualatex", "pdflatex")
NAME_RE = re.compile(r"^[\w\-. /가-힣()+,@&]{1,180}$")
TEXT_EXT = {"tex", "bib", "sty", "cls", "bst", "bbx", "cbx", "lbx", "dbx", "txt", "md", "cfg", "def", "clo", "ltx", "dtx", "ins", "tikz", "pgf", "lua", "latexmkrc", "gitignore", "csv", "tsv", "dat", "json", "yaml", "yml", "xml", "r", "py", "m"}
EDIT_EXT = {"tex", "bib", "sty", "cls", "bst", "bbx", "cbx", "lbx", "dbx", "txt", "md", "cfg", "def", "clo", "ltx", "tikz", "pgf", "lua"}   # 편집기로 여는 글 파일
ASSET_EXT = {"png", "jpg", "jpeg", "gif", "bmp", "tif", "tiff", "pdf", "eps", "ps", "svg", "webp", "otf", "ttf", "csv", "tsv", "dat", "txt", "json", "xml", "yaml", "yml", "r", "py", "m", "ipynb", "xlsx", "docx", "pptx", "zip"}
MAX_ASSET = 30 * 1024 * 1024
MAX_ASSETS = 300 * 1024 * 1024
MAX_TEXT = 8 * 1024 * 1024
MAX_ZIP_FILES = 1500
TIMEOUT = 480            # 첫 컴파일은 패키지를 받느라 몇 분 걸린다
SP = 65781.76            # synctex 단위(sp) → PDF 단위(bp)
NOWIN = getattr(subprocess, "CREATE_NO_WINDOW", 0)
# 패키지 캐시도 폴더 안에 둔다. 폴더만 옮기면 새 PC 에서 내려받지 않고 바로 컴파일된다
CACHE = os.environ.get("TECTONIC_CACHE_DIR") or os.path.join(ROOT, "userdata", "tex", "cache")


# ---------------------------------------------------------------- 엔진
def engine():
    p = os.environ.get("STUDY_TEX")
    if p and vfs.isfile(p):
        return p, os.path.basename(p).split(".")[0].lower()
    local = os.path.join(ROOT, "userdata", "tex", "tectonic.exe" if os.name == "nt" else "tectonic")
    if vfs.isfile(local):
        return local, "tectonic"
    for e in ENGINES:
        x = shutil.which(e)
        if x:
            return x, e
    return None, None


def warm():
    """tectonic 이 패키지를 받아 둔 적이 있나(없으면 첫 컴파일이 몇 분 걸린다)."""
    try:
        return any(os.scandir(CACHE))
    except OSError:
        return False


def allowed(au):
    return bool(au) and au.get("role") == "admin"


# ---------------------------------------------------------------- 경로
def clean(name):
    nm = str(name or "").replace("\\", "/").strip().strip("/")
    if not nm or len(nm) > 180 or not NAME_RE.match(nm):
        return None
    parts = nm.split("/")
    if any(p in ("", ".", "..") or p.startswith(".") or p.endswith(" ") or p.endswith(".") for p in parts):
        return None
    if re.match(r"^(con|prn|aux|nul|com\d|lpt\d)(\.|$)", parts[-1], re.I):
        return None
    return nm


def ext_of(rel):
    b = rel.rsplit("/", 1)[-1]
    return b.rsplit(".", 1)[-1].lower() if "." in b else ""


def mdir(pdir, mid):
    return os.path.join(pdir, "paper", mid)


def _join(base, rel):
    return os.path.join(base, *rel.split("/"))


def _rj(path):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def _wj(path, obj):
    safeio.atomic_json(path, obj)


def _walk(base):
    out = []
    if not vfs.isdir(base):
        return out
    for dp, dn, fn in vfs.walk(base):
        dn[:] = [d for d in dn if not d.startswith(".")]
        for f in fn:
            full = os.path.join(dp, f)
            rel = os.path.relpath(full, base).replace("\\", "/")
            if clean(rel):
                try:
                    out.append((rel, full, vfs.stat(full)))
                except OSError:
                    pass
    return out


_locks = {}
_locks_g = threading.Lock()


def _lock(key):
    with _locks_g:
        return _locks.setdefault(key, threading.Lock())


# ---------------------------------------------------------------- 컴파일
_TL = re.compile(r"^(error|warning): (.+?):(\d+): (.+)$")
_FLE = re.compile(r"^(?:\./)?([^:\n]+?\.(?:tex|sty|cls|bib|ltx)):(\d+): (.+)$", re.M)
_NOISE = ("Fontconfig", "something bad happened inside", "the XeTeX engine had", "halted on", "errors were issued by the TeX engine", "its output follows", "caused by:")


def _fixname(f, files):
    f = f.replace("\\", "/")
    if f.startswith("./"):
        f = f[2:]
    if f in files:
        return f
    if f + ".tex" in files:
        return f + ".tex"
    return f


def _find_key(files, pat):
    rx = re.compile(pat)
    for name in sorted(files):
        if not name.endswith(".tex"):
            continue
        for i, ln in enumerate(files[name].split("\n")):
            if rx.search(ln):
                return name, i + 1
    return None, 0


def parse_problems(out, logtxt, files):
    res, seen = [], set()

    def add(kind, f, line, msg, src="engine"):
        k = (kind, f, line, msg[:160])
        if k in seen:
            return
        seen.add(k)
        res.append({"kind": kind, "file": f, "line": line, "msg": msg.strip()[:400], "src": src})

    for ln in (out or "").splitlines():
        s = ln.strip()
        if not s or s.startswith("note:") or any(n in s for n in _NOISE) or "in font nullfont" in s:
            continue
        m = _TL.match(s)
        if m:
            add("error" if m.group(1) == "error" else "warning", _fixname(m.group(2), files), int(m.group(3)), m.group(4))
        elif s.startswith("error:"):
            add("error", None, 0, s[6:].strip())
    lg = logtxt or ""
    if not any(r["kind"] == "error" for r in res):   # tectonic 밖 엔진(-file-line-error)
        for m in _FLE.finditer(lg):
            add("error", _fixname(m.group(1), files), int(m.group(2)), m.group(3))
    # LaTeX 경고(여러 줄로 이어질 수 있다)
    lines = lg.split("\n")
    i = 0
    while i < len(lines):
        ln = lines[i]
        m = re.match(r"^(?:LaTeX|Package (\w+)|Class (\w+)) Warning: (.*)$", ln)
        if m:
            msg = m.group(3)
            j = i + 1
            while j < len(lines) and lines[j].strip() and (lines[j].startswith("(") or lines[j].startswith(" ")) and len(msg) < 600:
                msg += " " + re.sub(r"^\(\w+\)\s*", "", lines[j].strip())
                j += 1
            i = j
            src = (m.group(1) or m.group(2) or "LaTeX")
            if "Rerun to get" in msg or "Label(s) may have changed" in msg:
                continue
            ref = re.search(r"Reference `([^']+)' on page \d+ undefined", msg)
            cit = re.search(r"Citation `([^']+)' on page \d+ undefined", msg)
            lab = re.search(r"Label `([^']+)' multiply defined", msg)
            f, line = None, 0
            if ref:
                f, line = _find_key(files, r"ref\{[^}]*\b" + re.escape(ref.group(1)) + r"\b")
                add("warning", f, line, "참조할 이름표가 없어요: " + ref.group(1), "ref")
                continue
            if cit:
                f, line = _find_key(files, r"cite\w*\*?(\[[^\]]*\])*\{[^}]*\b" + re.escape(cit.group(1)) + r"\b")
                add("warning", f, line, "참고문헌에 없는 인용: " + cit.group(1), "cite")
                continue
            if lab:
                f, line = _find_key(files, r"\\label\{" + re.escape(lab.group(1)) + r"\}")
                add("warning", f, line, "이름표가 두 번 이상 정의됐어요: " + lab.group(1), "label")
                continue
            lm = re.search(r"on input line (\d+)", msg)
            add("warning", None, int(lm.group(1)) if lm else 0, src + ": " + msg, "latex")
            continue
        i += 1
    return res[:300]


def _publish(root, bdir, stem):
    """빌드 결과를 view.* 로 옮긴다(쪽 그림을 그리는 중이면 기다림 — 열린 파일은 바꿀 수 없다)."""
    for src_ext, dst in ((".pdf", "view.pdf"), (".synctex.gz", "view.synctex.gz")):
        src = os.path.join(bdir, stem + src_ext)
        if not vfs.isfile(src):
            continue
        tmp = os.path.join(root, dst + ".new")
        vfs.copy(src, tmp)
        with docview._pdf_lock:
            for _ in range(20):
                try:
                    vfs.replace(tmp, os.path.join(root, dst))
                    break
                except PermissionError:
                    time.sleep(0.1)


def compile(pdir, mid, files, main):
    exe, eng = engine()
    if not exe:
        return {"ok": False, "error": "no_engine", "message": "이 PC 에 LaTeX 엔진이 없어요(tectonic·xelatex·pdflatex)."}
    main = clean(main)
    if not main or not main.endswith(".tex") or main not in files:
        return {"ok": False, "error": "bad_main", "message": "본문(.tex) 파일을 찾지 못했어요: " + str(main)}
    root = mdir(pdir, mid)
    bdir = os.path.join(root, "build")
    adir = os.path.join(root, "assets")
    os.makedirs(bdir, exist_ok=True)
    lk = _lock(bdir)
    if not lk.acquire(timeout=TIMEOUT + 30):
        return {"ok": False, "error": "busy", "message": "다른 컴파일이 아직 끝나지 않았어요."}
    try:
        t0 = time.time()
        man_p = os.path.join(bdir, ".manifest.json")
        man = _rj(man_p) or {}
        prev = set(man.get("files") or []) | set(man.get("assets") or [])
        now, total = set(), 0
        for name, txt in files.items():
            rel = clean(name)
            if not rel or not isinstance(txt, str) or ext_of(rel) not in TEXT_EXT:
                continue
            data = txt.encode("utf-8")
            total += len(data)
            if total > MAX_TEXT:
                return {"ok": False, "error": "too_big", "message": "원고가 너무 커요(8MB)."}
            fp = _join(bdir, rel)
            same = False
            try:
                if vfs.getsize(fp) == len(data):
                    with open(fp, "rb") as fh:
                        same = fh.read() == data
            except OSError:
                pass
            if not same:
                os.makedirs(os.path.dirname(fp), exist_ok=True)
                with open(fp, "wb") as fh:
                    fh.write(data)
            now.add(rel)
        aset = set()
        for rel, full, st in _walk(adir):
            if rel in now:
                continue
            fp = _join(bdir, rel)
            try:
                bst = vfs.stat(fp)
            except OSError:
                bst = None
            if not bst or bst.st_size != st.st_size or int(bst.st_mtime) != int(st.st_mtime):
                os.makedirs(os.path.dirname(fp), exist_ok=True)
                vfs.copy(full, fp)
            aset.add(rel)
        for rel in prev - now - aset:
            try:
                vfs.remove(_join(bdir, rel))
            except OSError:
                pass
        _wj(man_p, {"files": sorted(now), "assets": sorted(aset)})
        stem = main.rsplit("/", 1)[-1][:-4]
        odir = _join(bdir, main.rsplit("/", 1)[0]) if "/" in main else bdir   # tectonic 은 본문 파일 옆에 결과를 쓴다(--outdir 를 주면 synctex 마무리에서 멈춤)
        for e in (".pdf", ".synctex.gz", ".log"):
            try:
                vfs.remove(os.path.join(odir, stem + e))
            except OSError:
                pass
        if eng == "tectonic":
            cmds = [[exe, "-X", "compile", "--untrusted", "--synctex", "--keep-logs", "-Z", "continue-on-errors", main]]
        else:
            base = [exe, "-interaction=nonstopmode", "-file-line-error", "-synctex=1", "-no-shell-escape"] + (["-output-directory=" + main.rsplit("/", 1)[0]] if "/" in main else []) + [main]
            cmds = [base]
            bt = shutil.which("bibtex")
            if bt and any(r.endswith(".bib") for r in now):
                cmds += [[bt, stem]]
            cmds += [base, base]
        out = ""
        timed = False
        for c in cmds:
            try:
                r = subprocess.run(c, cwd=bdir, capture_output=True, timeout=TIMEOUT, creationflags=NOWIN, env=dict(os.environ, TECTONIC_CACHE_DIR=CACHE))
                out += (r.stdout or b"").decode("utf-8", "replace") + (r.stderr or b"").decode("utf-8", "replace")
            except subprocess.TimeoutExpired:
                out += "\n[시간 초과 — %d초]" % TIMEOUT
                timed = True
                break
            except OSError as e:
                out += "\n[엔진 실행 실패] %s" % e
                break
        logtxt = ""
        try:
            with open(os.path.join(odir, stem + ".log"), "r", encoding="utf-8", errors="replace") as fh:
                logtxt = fh.read()
        except OSError:
            pass
        probs = parse_problems(out, logtxt, files)
        ok = vfs.isfile(os.path.join(odir, stem + ".pdf"))
        meta = {"ok": ok, "engine": eng, "main": main, "sec": round(time.time() - t0, 2), "problems": probs,
                "errors": sum(1 for p in probs if p["kind"] == "error"), "warnings": sum(1 for p in probs if p["kind"] == "warning"),
                "log": (logtxt or out)[-60000:], "out": out[-8000:], "timeout": timed}
        if ok:
            _publish(root, odir, stem)
            info = docview.pdf_info(os.path.join(root, "view.pdf"))
            meta.update(build=int(time.time() * 1000), pages=info["pages"], sizes=info["sizes"], size=vfs.getsize(os.path.join(root, "view.pdf")),
                        synctex=vfs.isfile(os.path.join(root, "view.synctex.gz")))
            _wj(os.path.join(root, "view.json"), {k: v for k, v in meta.items() if k not in ("log", "out")})
        else:
            meta["message"] = "PDF 를 만들지 못했어요 — 문제 목록과 기록을 보세요."
        return meta
    finally:
        lk.release()


def view_info(pdir, mid):
    root = mdir(pdir, mid)
    v = _rj(os.path.join(root, "view.json"))
    if not v or not vfs.isfile(os.path.join(root, "view.pdf")):
        return {"ok": True, "has": False}
    v.update(ok=True, has=True)
    return v


def view_pdf(pdir, mid):
    p = os.path.join(mdir(pdir, mid), "view.pdf")
    return p if vfs.isfile(p) else None


def page(pdir, mid, p, w):
    pdf = view_pdf(pdir, mid)
    if not pdf:
        return None
    return docview.page_png(pdf, os.path.join(mdir(pdir, mid), ".cache", "view"), p, w)


def search(pdir, mid, q):
    pdf = view_pdf(pdir, mid)
    return docview.search_pdf(pdf, q) if pdf else []


# ---------------------------------------------------------------- SyncTeX
_REC = re.compile(r"^([\[\(hvxkg$])(\d+),(\d+):(-?\d+),(-?\d+)(?::(-?\d+)(?:,(-?\d+),(-?\d+))?)?")
_sync_cache = {}


def _sync(root):
    p = os.path.join(root, "view.synctex.gz")
    try:
        st = vfs.stat(p)
    except OSError:
        return None
    key = (st.st_mtime, st.st_size)
    c = _sync_cache.get(p)
    if c and c[0] == key:
        return c[1]
    bdir = os.path.abspath(os.path.join(root, "build")).replace("\\", "/").lower().rstrip("/") + "/"
    inputs, pages, cur, unit, xo, yo = {}, {}, None, 1.0, 0.0, 0.0
    with gzip.open(p, "rt", encoding="utf-8", errors="replace") as fh:
        for ln in fh:
            c0 = ln[:1]
            if c0 == "{":
                try:
                    cur = int(ln[1:]); pages.setdefault(cur, [])
                except ValueError:
                    cur = None
            elif c0 == "}":
                cur = None
            elif cur is not None and c0 in "[(hvxkg$":
                m = _REC.match(ln)
                if m:
                    W = int(m.group(6) or 0); H = int(m.group(7) or 0); D = int(m.group(8) or 0)
                    pages[cur].append((c0, int(m.group(2)), int(m.group(3)), (int(m.group(4)) * unit + xo) / SP, (int(m.group(5)) * unit + yo) / SP,
                                       W * unit / SP, H * unit / SP, D * unit / SP))
            elif ln.startswith("Input:"):
                parts = ln.rstrip("\r\n").split(":", 2)
                if len(parts) == 3 and parts[2]:
                    path = parts[2].replace("\\", "/")
                    low = path.lower()
                    rel = path[len(bdir):] if low.startswith(bdir) else path
                    if rel.startswith("./"):
                        rel = rel[2:]
                    inputs[int(parts[1])] = rel
            elif ln.startswith("Unit:"):
                try: unit = float(ln[5:])
                except ValueError: pass
            elif ln.startswith("X Offset:"):
                try: xo = float(ln[9:])
                except ValueError: pass
            elif ln.startswith("Y Offset:"):
                try: yo = float(ln[9:])
                except ValueError: pass
    data = {"inputs": inputs, "pages": pages}
    _sync_cache[p] = (key, data)
    return data


def sync_forward(pdir, mid, file, line):
    s = _sync(mdir(pdir, mid))
    if not s:
        return None
    f = str(file or "")
    tags = {t for t, r in s["inputs"].items() if r == f or r == f[:-4] or r + ".tex" == f}
    if not tags:
        return None
    have = {}
    for pg, recs in s["pages"].items():
        for r in recs:
            if r[1] in tags and r[0] not in "[v":
                have.setdefault(r[2], []).append((pg, r))
    if not have:
        return None
    ls = sorted(have)
    if line in have:
        L = line
    else:
        after = [x for x in ls if x > line]
        before = [x for x in ls if x < line]
        L = after[0] if after and (not before or after[0] - line <= (line - before[-1]) * 2 + 3) else (before[-1] if before else ls[0])
    hits = have[L]
    pg = min(h[0] for h in hits)
    x0 = y0 = 1e9; x1 = y1 = -1e9
    for p_, r in hits:
        if p_ != pg:
            continue
        k, _, _, x, y, W, H, D = r
        if k in "(h" and W > 0:
            x0 = min(x0, x); x1 = max(x1, x + W); y0 = min(y0, y - max(H, 6)); y1 = max(y1, y + D)
        else:
            x0 = min(x0, x); x1 = max(x1, x + 6); y0 = min(y0, y - 9); y1 = max(y1, y + 2)
    return {"page": pg, "x": round(x0, 2), "y": round(y0, 2), "w": round(max(8, x1 - x0), 2), "h": round(max(8, y1 - y0), 2), "line": L}


def sync_backward(pdir, mid, page_no, x, y):
    s = _sync(mdir(pdir, mid))
    if not s or page_no not in s["pages"]:
        return None
    recs = s["pages"][page_no]
    boxes = [r for r in recs if r[0] in "(h" and r[5] > 0 and r[3] - 1 <= x <= r[3] + r[5] + 1 and r[4] - r[6] - 1 <= y <= r[4] + r[7] + 1]
    pick = None
    if boxes:
        box = min(boxes, key=lambda r: r[5] * (r[6] + r[7] + 0.1))
        pts = [r for r in recs if r[0] in "gk$x" and abs(r[4] - box[4]) < 0.6 and box[3] - 1 <= r[3] <= box[3] + box[5] + 1]
        if pts:
            left = [r for r in pts if r[3] <= x + 2]
            pick = max(left, key=lambda r: r[3]) if left else min(pts, key=lambda r: abs(r[3] - x))
        else:
            pick = box
    else:
        cand = [r for r in recs if r[0] not in "[v"]
        if cand:
            pick = min(cand, key=lambda r: abs(r[4] - y) * 3 + abs(r[3] - x))
    if not pick:
        return None
    f = s["inputs"].get(pick[1], "")
    if not f or "/" in f and ":" in f:   # 작업 폴더 밖(엔진 내장 파일·.bbl 등)
        return None
    return {"file": f, "line": pick[2]}


# ---------------------------------------------------------------- 그림·데이터 파일
def assets(pdir, mid):
    out = []
    for rel, full, st in _walk(os.path.join(mdir(pdir, mid), "assets")):
        out.append({"name": rel, "size": st.st_size, "mtime": int(st.st_mtime * 1000), "ext": ext_of(rel)})
    out.sort(key=lambda a: a["name"].lower())
    return out


def asset_path(pdir, mid, name):
    rel = clean(name)
    if not rel:
        return None
    p = _join(os.path.join(mdir(pdir, mid), "assets"), rel)
    return p if vfs.isfile(p) else None


def asset_put(pdir, mid, name, data):
    rel = clean(name)
    if not rel:
        return None, "파일 이름이 이상해요"
    if ext_of(rel) not in ASSET_EXT:
        return None, "올릴 수 없는 형식이에요(." + ext_of(rel) + ")"
    if len(data) > MAX_ASSET:
        return None, "파일 하나는 30MB 까지예요"
    adir = os.path.join(mdir(pdir, mid), "assets")
    used = sum(st.st_size for _, _, st in _walk(adir))
    if used + len(data) > MAX_ASSETS:
        return None, "그림·데이터 파일은 모두 합쳐 300MB 까지예요"
    fp = _join(adir, rel)
    os.makedirs(os.path.dirname(fp), exist_ok=True)
    safeio.atomic_bytes(fp, data)
    return {"name": rel, "size": len(data), "ext": ext_of(rel), "mtime": int(time.time() * 1000)}, None


def asset_move(pdir, mid, src, dst):
    """파일 하나 또는 폴더(접두어) 통째로 옮기기·이름 바꾸기."""
    a, b = clean(src), clean(dst)
    if not a or not b:
        return 0
    adir = os.path.join(mdir(pdir, mid), "assets")
    n = 0
    for rel, full, st in _walk(adir):
        if rel == a or rel.startswith(a + "/"):
            nr = b + rel[len(a):]
            if not clean(nr):
                continue
            fp = _join(adir, nr)
            os.makedirs(os.path.dirname(fp), exist_ok=True)
            vfs.replace(full, fp)
            n += 1
    _prune(adir)
    return n


def asset_copy(pdir, mid, src, dst):
    """폴더 복제(예: v1/ → v2/) 때 그림·데이터 파일도 같이."""
    a, b = clean(src), clean(dst)
    if not a or not b:
        return 0
    adir = os.path.join(mdir(pdir, mid), "assets")
    n = 0
    for rel, full, st in _walk(adir):
        if rel == a or rel.startswith(a + "/"):
            nr = clean(b + rel[len(a):])
            if not nr:
                continue
            fp = _join(adir, nr)
            os.makedirs(os.path.dirname(fp), exist_ok=True)
            vfs.copy(full, fp)
            n += 1
    return n


def asset_del(pdir, mid, name):
    a = clean(name)
    if not a:
        return 0
    adir = os.path.join(mdir(pdir, mid), "assets")
    n = 0
    for rel, full, st in _walk(adir):
        if rel == a or rel.startswith(a + "/"):
            try:
                vfs.remove(full); n += 1
            except OSError:
                pass
    _prune(adir)
    return n


def _prune(base):
    for dp, dn, fn in sorted(vfs.walk(base), key=lambda t: -len(t[0])):
        if dp != base and not vfs.listdir(dp):
            try:
                os.rmdir(dp)
            except OSError:
                pass


# ---------------------------------------------------------------- zip 가져오기·내보내기
def _decode(raw):
    for enc in ("utf-8-sig", "utf-8", "cp949", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", "replace")


def import_zip(pdir, mid, data, prefix=""):
    """Overleaf·GitHub 에서 받은 zip 을 그대로 — 글 파일은 돌려주고(편집기 저장소로), 그림·데이터는 assets 로."""
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        return {"ok": False, "message": "zip 파일이 아니에요"}
    infos = [i for i in zf.infolist() if not i.is_dir()]
    if len(infos) > MAX_ZIP_FILES:
        return {"ok": False, "message": "파일이 너무 많아요(%d개 — %d개까지)" % (len(infos), MAX_ZIP_FILES)}
    names = [i.filename.replace("\\", "/") for i in infos if not i.filename.startswith("__MACOSX")]
    strip = ""
    tops = {n.split("/", 1)[0] for n in names}
    if len(tops) == 1 and all("/" in n for n in names):
        strip = list(tops)[0] + "/"
    pre = clean(prefix) + "/" if prefix and clean(prefix) else ""
    files, added, skipped, total, ttext = {}, [], [], 0, 0
    for i in infos:
        n = i.filename.replace("\\", "/")
        if n.startswith("__MACOSX/") or "/." in "/" + n:
            continue
        if strip and n.startswith(strip):
            n = n[len(strip):]
        rel = clean(pre + n)
        if not rel:
            skipped.append(n); continue
        ext = ext_of(rel)
        if i.file_size > MAX_ASSET:
            skipped.append(n + " (30MB 초과)"); continue
        total += i.file_size
        if total > MAX_ASSETS:
            skipped.append(n + " (전체 용량 초과)"); continue
        if ext in EDIT_EXT or rel.rsplit("/", 1)[-1] in ("latexmkrc", ".latexmkrc"):
            raw = zf.read(i)
            ttext += len(raw)
            if ttext > MAX_TEXT:
                skipped.append(n + " (글 파일 합계 8MB 초과)"); continue
            files[rel] = _decode(raw).replace("\r\n", "\n")
        elif ext in ASSET_EXT:
            meta, err = asset_put(pdir, mid, rel, zf.read(i))
            if meta:
                added.append(rel)
            else:
                skipped.append(n + " (" + err + ")")
        else:
            skipped.append(n)
    main = None
    cands = [k for k, v in files.items() if k.endswith(".tex") and "\\documentclass" in v and "\\begin{document}" in v]
    for k in sorted(cands, key=lambda k: (k.count("/"), 0 if k.rsplit("/", 1)[-1] == "main.tex" else 1, k)):
        main = k; break
    return {"ok": True, "files": files, "assets": added, "skipped": skipped[:200], "main": main}


def export_zip(pdir, mid, files, name):
    odir = os.path.join(pdir, "out")
    os.makedirs(odir, exist_ok=True)
    nm = re.sub(r"[^\w\-.가-힣]+", "_", str(name or "paper"))[:80] or "paper"
    path = os.path.join(odir, nm + ".zip")
    with zipfile.ZipFile(path + ".tmp", "w", zipfile.ZIP_DEFLATED) as z:
        for rel, txt in sorted((files or {}).items()):
            r = clean(rel)
            if r and isinstance(txt, str):
                z.writestr(r, txt)
        for rel, full, st in _walk(os.path.join(mdir(pdir, mid), "assets")):
            if rel not in (files or {}):
                vfs.zwrite(z, full, rel)
        pdf = view_pdf(pdir, mid)
        if pdf:
            v = _rj(os.path.join(mdir(pdir, mid), "view.json")) or {}
            z.write(pdf, "output/" + (v.get("main") or "main.tex").rsplit("/", 1)[-1][:-4] + ".pdf")
    vfs.replace(path + ".tmp", path)
    return nm + ".zip", vfs.getsize(path)


def export_pdf(pdir, mid, name):
    pdf = view_pdf(pdir, mid)
    if not pdf:
        return None
    odir = os.path.join(pdir, "out")
    os.makedirs(odir, exist_ok=True)
    nm = (re.sub(r"[^\w\-.가-힣]+", "_", str(name or "paper"))[:80] or "paper") + ".pdf"
    vfs.copy(pdf, os.path.join(odir, nm))
    return nm
