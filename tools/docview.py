# -*- coding: utf-8 -*-
"""자료 보기 엔진(v98) — 어떤 파일이든 플랫폼 안에서 보이게 만든다. ws_api.py 가 op=view·page·words·ptext 로 부른다.

  PDF            PyMuPDF 로 쪽 그림(PNG, 폭별 캐시) + 단어 좌표(글자 고르기·형광펜·찾기) + 쪽별 글
  Word·PPT·Excel 이 PC 의 MS Office 로 PDF 변환(office2pdf.py, 따로 프로세스·시간 제한) → PDF 와 똑같이
  HWP·HWPX       이 PC 의 한글로 쪽 모양 PDF(사용자가 한글을 쓰는 중이면 닫힐 때까지 기다림) + 본문 글(배포용 문서 복호화 포함 — 준비되는 동안 글 보기)
  XLSX·CSV       표(시트별) — 엑셀 모양 PDF 도 함께(있으면 [인쇄 모양])
  그림·소리·영상  원본을 그대로(Range 스트리밍) — 브라우저가 그린다
  글·코드·MD·JSON 글 보기
캐시: 프로젝트 폴더 fcache/<fid>.* (원본 mtime·크기가 바뀌면 다시 만든다 — 지워도 된다)
"""
import safeio   # (v140) 정전 대비 쓰기(임시 파일 → fsync → 바꾸기)
import csv
import io
import json
import os
import re
import subprocess
import sys
import threading
import time
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))

PDF = {"pdf", "xps", "epub", "cbz", "fb2"}
OFFICE = {"doc", "docx", "docm", "rtf", "odt", "dot", "dotx", "ppt", "pptx", "pptm", "pps", "ppsx", "odp", "pot", "potx", "xls", "xlsm", "xlsb", "ods"}
SHEET = {"xlsx", "xlsm", "csv", "tsv"}
HWP = {"hwp", "hwpx"}
IMAGE = {"png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "avif", "tif", "tiff"}
AUDIO = {"mp3", "wav", "m4a", "ogg", "oga", "flac", "aac", "opus", "weba"}
VIDEO = {"mp4", "webm", "mov", "m4v", "ogv", "mkv", "avi"}
MD = {"md", "markdown"}
TEXT = {"txt", "log", "ini", "cfg", "conf", "toml", "yaml", "yml", "xml", "tex", "rst", "bib", "srt", "vtt",
        "py", "js", "ts", "tsx", "jsx", "css", "scss", "java", "c", "h", "cpp", "hpp", "cs", "go", "rs", "rb", "php", "sh", "ps1", "bat", "sql", "r", "m", "kt", "swift", "vue", "json", "jsonl", "ipynb"}
HTML = {"html", "htm"}

MIME = {"pdf": "application/pdf", "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif", "webp": "image/webp", "bmp": "image/bmp",
        "svg": "image/svg+xml", "ico": "image/x-icon", "avif": "image/avif", "tif": "image/tiff", "tiff": "image/tiff",
        "mp3": "audio/mpeg", "wav": "audio/wav", "m4a": "audio/mp4", "ogg": "audio/ogg", "oga": "audio/ogg", "flac": "audio/flac", "aac": "audio/aac", "opus": "audio/ogg", "weba": "audio/webm",
        "mp4": "video/mp4", "webm": "video/webm", "mov": "video/quicktime", "m4v": "video/mp4", "ogv": "video/ogg", "mkv": "video/x-matroska", "avi": "video/x-msvideo",
        "html": "text/html; charset=utf-8", "htm": "text/html; charset=utf-8", "md": "text/markdown; charset=utf-8", "txt": "text/plain; charset=utf-8", "csv": "text/csv; charset=utf-8",
        "json": "application/json", "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation", "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "hwp": "application/x-hwp", "zip": "application/zip"}


def kind_of(ext):
    ext = (ext or "").lower()
    if ext in PDF: return "pdf"
    if ext in SHEET: return "sheet"
    if ext in OFFICE: return "office"
    if ext in HWP: return "hwp"
    if ext in IMAGE: return "image"
    if ext in AUDIO: return "audio"
    if ext in VIDEO: return "video"
    if ext in MD: return "md"
    if ext in HTML: return "html"
    if ext in TEXT: return "text"
    return "other"


def mime_of(ext):
    return MIME.get((ext or "").lower(), "application/octet-stream")


def _stamp(path):
    st = os.stat(path)
    return {"mtime": int(st.st_mtime * 1000), "size": st.st_size}


def _read_json(p):
    try:
        with open(p, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def _write_json(p, obj):
    safeio.atomic_json(p, obj)


def _decode(raw):
    for enc in ("utf-8-sig", "cp949", "euc-kr", "utf-16"):
        try:
            return raw.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
    return raw.decode("utf-8", "replace")


# ---------------- 오피스 → PDF(따로 프로세스, 한 번에 하나) ----------------
_conv_lock = threading.Lock()
_converting = {}          # cache 경로 → 시작 시각
_conv_err = {}            # cache 경로 → 오류 글
_conv_wait = {}           # cache 경로 → 한글이 사용 중이라 미룬 시각(잠시 뒤 다시)


def _office_job(src, pdf, stamp):
    with _conv_lock:
        try:
            if os.path.exists(pdf) and (_read_json(pdf + ".json") or {}) == stamp:
                return
            os.makedirs(os.path.dirname(pdf), exist_ok=True)
            r = subprocess.run([sys.executable, os.path.join(HERE, "office2pdf.py"), src, pdf], capture_output=True, timeout=240,
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            if r.returncode == 0 and os.path.exists(pdf):
                _write_json(pdf + ".json", stamp)
                _conv_err.pop(pdf, None)
            elif r.returncode == 3:               # 한글 사용 중 — 오류가 아니라 '잠시 뒤 다시'
                _conv_wait[pdf] = time.time()
            else:
                msg = (r.stderr or r.stdout or b"").decode("utf-8", "replace").strip().splitlines()
                _conv_err[pdf] = (msg[-1] if msg else "변환 실패")[:300]
        except subprocess.TimeoutExpired:
            _conv_err[pdf] = "오피스 변환이 4분 안에 끝나지 않았어요(문서가 너무 크거나 오피스가 대화상자를 띄웠을 수 있어요)."
        except Exception as e:          # noqa: BLE001
            _conv_err[pdf] = "변환 실패: " + str(e)[:200]
        finally:
            _converting.pop(pdf, None)


def office_pdf(src, cache):
    """→ (pdf 경로 or None, 상태 'ready'|'converting'|'error', 오류)."""
    pdf = cache + ".view.pdf"
    stamp = _stamp(src)
    if os.path.exists(pdf) and (_read_json(pdf + ".json") or {}) == stamp:
        return pdf, "ready", None
    if pdf in _converting:
        return None, "converting", None
    if pdf in _conv_wait:
        if time.time() - _conv_wait[pdf] < 20:
            return None, "waiting", None
        _conv_wait.pop(pdf, None)
    if pdf in _conv_err and (_read_json(pdf + ".err.json") or {}) == stamp:
        return None, "error", _conv_err[pdf]
    _conv_err.pop(pdf, None)
    _converting[pdf] = time.time()
    _write_json(pdf + ".err.json", stamp)
    threading.Thread(target=_office_job, args=(src, pdf, stamp), daemon=True).start()
    return None, "converting", None


# ---------------- PDF: 정보 · 쪽 그림 · 단어 · 쪽별 글 ----------------
_pdf_lock = threading.Lock()


def pdf_info(pdf):
    import fitz
    with _pdf_lock:
        d = fitz.open(pdf)
        try:
            sizes = [[round(p.rect.width, 1), round(p.rect.height, 1)] for p in d]
            toc = [[lv, str(t)[:120], pg] for lv, t, pg in d.get_toc(simple=True)][:400]
            return {"pages": len(sizes), "sizes": sizes, "toc": toc}
        finally:
            d.close()


def page_png(pdf, cache, p, width):
    """쪽 그림 — 폭은 200 단위로 묶어 캐시(같은 확대 비율이면 다시 그리지 않는다)."""
    import fitz
    width = max(200, min(2800, int(round(width / 200.0)) * 200))
    out = cache + ".pg/%d-%d.png" % (p, width)
    if os.path.exists(out) and os.path.getmtime(out) >= os.path.getmtime(pdf):
        with open(out, "rb") as fh:
            return fh.read()
    with _pdf_lock:
        d = fitz.open(pdf)
        try:
            if p < 1 or p > len(d):
                return None
            pg = d[p - 1]
            z = width / max(1.0, pg.rect.width)
            pix = pg.get_pixmap(matrix=fitz.Matrix(z, z), alpha=False)
            data = pix.tobytes("png")
        finally:
            d.close()
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out + ".tmp", "wb") as fh:
        fh.write(data)
    os.replace(out + ".tmp", out)
    return data


def page_words(pdf, p):
    """줄 단위 글 조각 [x0,y0,x1,y1,글] — 쪽 크기에 대한 비율(0~1)."""
    import fitz
    with _pdf_lock:
        d = fitz.open(pdf)
        try:
            if p < 1 or p > len(d):
                return None
            pg = d[p - 1]
            W, H = pg.rect.width or 1, pg.rect.height or 1
            lines = {}
            for x0, y0, x1, y1, w, b, ln, _ in pg.get_text("words"):
                k = (b, ln)
                if k not in lines:
                    lines[k] = [x0, y0, x1, y1, [w]]
                else:
                    L = lines[k]; L[0] = min(L[0], x0); L[1] = min(L[1], y0); L[2] = max(L[2], x1); L[3] = max(L[3], y1); L[4].append(w)
            out = [[round(L[0] / W, 5), round(L[1] / H, 5), round(L[2] / W, 5), round(L[3] / H, 5), " ".join(L[4])] for L in lines.values()]
            out.sort(key=lambda r: (round(r[1], 2), r[0]))
            return {"w": W, "h": H, "lines": out}
        finally:
            d.close()


def search_pdf(pdf, q, limit=1500):
    """전 쪽에서 정확히 찾기 — 찾은 곳마다 [쪽, [x0,y0,x1,y1](쪽 크기 비율), 그 줄의 글]. 대소문자 무시(PyMuPDF 기본)."""
    import fitz
    q = (q or "").strip()
    if len(q) < 2:
        return []
    out = []
    with _pdf_lock:
        d = fitz.open(pdf)
        try:
            lq = " ".join(q.lower().split())
            for i, pg in enumerate(d):
                W, H = pg.rect.width or 1, pg.rect.height or 1
                rs = pg.search_for(q)
                if not rs:
                    continue
                try:      # 문단(블록) 단위로 앞뒤 글을 뽑는다. 두 단 편집에서 옆 단 글이 섞이지 않게
                    blocks = [(fitz.Rect(b[:4]), " ".join(str(b[4]).split())) for b in pg.get_text("blocks") if len(b) > 4 and str(b[4]).strip()]
                except Exception:
                    blocks = []
                used = {}
                for r in rs:
                    cx, cy, ctx = (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, ""
                    for bi, (br, bt) in enumerate(blocks):
                        if br.x0 - 1 <= cx <= br.x1 + 1 and br.y0 - 1 <= cy <= br.y1 + 1:
                            k, at = used.get(bi, 0), -1      # 같은 문단의 몇 번째 찾은 곳인가
                            for _ in range(k + 1):
                                at = bt.lower().find(lq, at + 1)
                                if at < 0:
                                    break
                            used[bi] = k + 1
                            if at < 0:
                                at = max(0, bt.lower().find(lq))
                            ctx = bt[max(0, at - 70): at + len(lq) + 90]
                            break
                    out.append([i + 1, [round(r.x0 / W, 5), round(r.y0 / H, 5), round(r.x1 / W, 5), round(r.y1 / H, 5)], ctx])
                    if len(out) >= limit:
                        return out
        finally:
            d.close()
    return out


def page_texts(pdf, cache):
    out = cache + ".ptext.json"
    st = _stamp(pdf)
    m = _read_json(out)
    if m and m.get("stamp") == st:
        return m["pages"]
    import fitz
    with _pdf_lock:
        d = fitz.open(pdf)
        try:
            pages = [p.get_text("text") for p in d]
        finally:
            d.close()
    _write_json(out, {"stamp": st, "pages": pages})
    return pages


# ---------------- HWP · HWPX · 표 · 글 ----------------
def hwp_text(path):
    ext = path.rsplit(".", 1)[-1].lower()
    if ext == "hwpx":
        with zipfile.ZipFile(path) as z:
            secs = sorted((n for n in z.namelist() if re.match(r"(?i)Contents/section\d+\.xml$", n)), key=lambda n: int(re.findall(r"\d+", n)[-1]))
            paras = []
            for n in secs:
                x = z.read(n).decode("utf-8", "replace")
                for p in re.findall(r"(?s)<hp:p\b.*?</hp:p>", x):
                    t = "".join(re.findall(r"(?s)<hp:t\b[^>]*>(.*?)</hp:t>", p))
                    t = re.sub(r"<[^>]+>", "", t).replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&").replace("&quot;", '"')
                    paras.append(t)
            return "\n".join(paras)
    import hwpdist  # noqa: E402  (HWP 5.0 — 배포용 문서 복호화 포함)
    text, _, _ = hwpdist.hwp_text(path)
    text = text.replace("[[IMG]]", "🖼").replace("[[TBL]]", "")
    return text


def sheet_html(path, max_rows=3000, max_cols=60):
    """시트 → [{name, rows:[[...]]}]"""
    ext = path.rsplit(".", 1)[-1].lower()
    if ext in ("csv", "tsv"):
        with open(path, "rb") as fh:
            t = _decode(fh.read(8 * 1024 * 1024))
        rows = list(csv.reader(io.StringIO(t), delimiter="\t" if ext == "tsv" else ","))[:max_rows]
        return [{"name": os.path.basename(path), "rows": [r[:max_cols] for r in rows], "more": False}]
    import openpyxl
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    out = []
    try:
        for ws in wb.worksheets[:30]:
            rows, more = [], False
            for i, r in enumerate(ws.iter_rows(values_only=True)):
                if i >= max_rows:
                    more = True; break
                rows.append(["" if v is None else (v.isoformat() if hasattr(v, "isoformat") else str(v)) for v in r[:max_cols]])
            while rows and not any(rows[-1]):
                rows.pop()
            out.append({"name": ws.title, "rows": rows, "more": more})
    finally:
        wb.close()
    return out


def sheet_text(path):
    try:
        return "\n\n".join("[" + s["name"] + "]\n" + "\n".join(" | ".join(r) for r in s["rows"]) for s in sheet_html(path, 5000, 40))
    except Exception:            # noqa: BLE001
        return ""


def read_text(path, limit=6 * 1024 * 1024):
    with open(path, "rb") as fh:
        t = _decode(fh.read(limit))
    if path.lower().endswith(".ipynb"):
        try:
            nb = json.loads(t)
            t = "\n\n".join(("```\n" if c.get("cell_type") == "code" else "") + "".join(c.get("source") or []) + ("\n```" if c.get("cell_type") == "code" else "") for c in nb.get("cells") or [])
        except ValueError:
            pass
    return t


# ---------------- 한 번에: 이 파일을 어떻게 보여 줄까 ----------------
def describe(src, ext, cache):
    """→ dict(kind, …). 클라이언트는 kind 로 그리는 방법을 고른다."""
    k = kind_of(ext)
    out = {"kind": k, "ext": ext, "mime": mime_of(ext)}
    try:
        if k == "pdf":
            out.update(pdf=pdf_info(src))
        elif k == "office":
            pdf, state, err = office_pdf(src, cache)
            out.update(state=state, error=err)
            if pdf:
                out.update(pdf=pdf_info(pdf))
        elif k == "sheet":
            out.update(sheets=sheet_html(src))
            if ext != "csv" and ext != "tsv":
                pdf, state, err = (None, None, None)
                if os.path.exists(cache + ".view.pdf"):
                    pdf, state, err = office_pdf(src, cache)
                out.update(print_state=state)
        elif k == "hwp":
            out.update(text=hwp_text(src))
            pdf, state, err = office_pdf(src, cache)
            out.update(state=state, error=err)
            if pdf:
                out.update(pdf=pdf_info(pdf))
        elif k in ("text", "md"):
            out.update(text=read_text(src))
        elif k == "html":
            out.update(text=read_text(src, 3 * 1024 * 1024))
    except Exception as e:      # noqa: BLE001
        out.update(error="이 파일을 여는 중 문제가 생겼어요: " + str(e)[:240])
    return out


def view_pdf(src, ext, cache):
    """쪽 그림·단어를 그릴 PDF 경로(원본이 PDF 면 그대로, 오피스면 변환본)."""
    k = kind_of(ext)
    if k == "pdf":
        return src
    if k in ("office", "sheet", "hwp"):
        pdf, state, _ = office_pdf(src, cache)
        return pdf
    return None
