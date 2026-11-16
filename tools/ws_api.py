# -*- coding: utf-8 -*-
"""연구지원 워크스페이스 파일 저장소(v90) — serve.py 가 api.php?r=ws&op=... 로 넘겨주는 요청을 처리한다.

설계 원칙: **DB 없음 · 파일만 · 덮어쓰지 않음 · 폴더 복사 = 이사 끝**
  <DATA_DIR>/                       (기본 userdata/workspace — --data-dir / STUDY_DATA_DIR / userdata/data-dir.txt 로 변경)
    users/<계정>/
      projects/<pid>/
        project.json                  프로젝트 메타(원자적 교체 — 쓰다 죽어도 이전 파일이 남는다)
        log.jsonl                     ★ 추가만 하는 이력(대화 한 턴·문서 저장·내보내기·업로드…). 줄 단위라 중간에 끊겨도 앞 줄은 멀쩡
        files/<fid>.<ext>             올린 원본(PDF·txt·md·docx·pptx) + <fid>.json(메타) + <fid>.txt(추출 텍스트, 쪽 표시 [p.N])
        docs/<did>/v0001.json …       문서 버전(새 저장 = 새 번호, 예전 버전은 그대로) + current.json(최신 번호)
        out/<이름>                    내보낸 DOCX·PPTX·HTML·MD
      mirror/progress.json            앱 상태(localStorage) 거울(옛 형식) + progress-YYYYMMDD.json(하루 1장)
    _trash/<계정>/<pid>-<시각>/       삭제 = 이동(복구 가능)
    _backups/ws-YYYYMMDD.zip          하루 첫 쓰기 때 자동 압축(최근 30개 보관)
  모든 쓰기는 X-Study-Vault: 1 헤더가 있어야 하고, 계정은 (v92) 서버 로그인 세션의 사용자 id 로 나눈다(users/<id>/).
  system/(계정·정책·AI 연결 공용·암호화 키)도 일일 zip 에 들어간다(세션·CLI 작업 폴더 제외). logs/ 는 백업하지 않는다.
  PDF 텍스트: PyMuPDF(fitz) → pypdf 순으로 시도. DOCX/PPTX 는 python-docx / python-pptx (없으면 HTML·MD 만).
"""
import safeio   # (v140) 정전 대비 쓰기(임시 파일 → fsync → 바꾸기)
import vfs      # noqa: E402  (v151) SQLite 엔진이면 데이터 폴더의 .json·.jsonl 은 DB — 아래 open·exists 등은 vfs 판
open = vfs.open  # noqa: A001
import hashlib
import io
import json
import logkit
import os
import re
import shutil
import threading
import time
import zipfile
import docview   # (v98) 자료 보기 엔진 — 어떤 형식이든 플랫폼 안에서
import subprocess

import report_api   # (v106) 보고서 작업실 — HTML → DOCX
import slide_api   # (v112) 발표자료 작업실 — 저장·PPTX
import tex_api   # (v105) 논문 작업실 — 컴파일·SyncTeX·쪽 그림·그림 파일·zip (tools/tex_api.py)


def tex_engine():
    return tex_api.engine()


from datetime import datetime

SAFE_ID = re.compile(r"^[A-Za-z0-9_\-]{1,64}$")
MAX_UPLOAD = 80 * 1024 * 1024
MAX_JSON = 4 * 1024 * 1024
MAX_STATE = 24 * 1024 * 1024
# (v93) 로컬 폴더 연결 — 폴더를 복사하지 않고 그 자리의 파일 구조 그대로 쓴다(읽기만, 내보내기·문서는 프로젝트 폴더에)
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv", "dist", "build", "_backups", "_trash", "userdata", ".idea", ".vscode", ".claude", "versions", ".next", "target"}
DOC_EXT = {"pdf", "txt", "md", "docx", "pptx", "html", "htm", "csv", "tsv", "json", "jsonl", "hwp", "hwpx", "xlsx", "xlsm", "doc", "ppt", "xls", "rtf", "odt", "odp", "ods", "py", "js", "ts", "css", "java", "c", "cpp", "h", "sql", "yaml", "yml", "xml", "tex", "rst", "ipynb"}
MAX_TREE = 4000
MAX_DEPTH = 8


def _fid_of(rel):
    return "x" + hashlib.sha1(rel.encode("utf-8")).hexdigest()[:20]


def _extract_any(path, ext):
    """폴더 파일 텍스트 — PDF·DOCX·PPTX·TXT·MD 는 기존 추출기, 그 밖의 글 파일은 그대로 읽는다(HTML 은 태그 제거)."""
    if ext in ("pdf", "docx", "pptx", "txt", "md"):
        return extract_text(path, ext)
    try:   # (v98) HWP·HWPX·엑셀·CSV
        if ext in ("hwp", "hwpx"):
            t = docview.hwp_text(path); return ([t] if t.strip() else []), "hwp"
        if ext in ("xlsx", "xlsm", "csv", "tsv"):
            t = docview.sheet_text(path); return ([t] if t.strip() else []), "sheet"
    except Exception as e:      # noqa: BLE001
        return [], "fail: " + str(e)[:80]
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            t = fh.read(3 * 1024 * 1024)
    except OSError:
        return [], "read-fail"
    if ext in ("html", "htm"):
        t = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", t)
        t = re.sub(r"(?s)<[^>]+>", " ", t)
        t = re.sub(r"[ \t]+", " ", t)
    if ext == "ipynb":
        try:
            nb = json.loads(t); t = "\n\n".join("".join(c.get("source") or []) for c in nb.get("cells") or [])
        except ValueError:
            pass
    return ([t] if t.strip() else []), "text"
KEEP_BACKUPS = 30
_lock = threading.Lock()


def office_text(path, cache, wait=90):
    """(v98) 예전 오피스 형식(doc·ppt·xls·rtf…) — 오피스로 PDF 를 만든 뒤(최대 wait 초 기다림) 쪽별 글."""
    pdf, state, err = docview.office_pdf(path, cache)
    t0 = time.time()
    while not pdf and state == "converting" and time.time() - t0 < wait:
        time.sleep(1.5)
        pdf, state, err = docview.office_pdf(path, cache)
    if not pdf:
        return [], "office-" + (state or "fail")
    return docview.page_texts(pdf, cache), "office-pdf"


def resolve_data_dir(root, argv, environ):
    for a in argv:
        if a.startswith("--data-dir="):
            return os.path.abspath(os.path.expanduser(a.split("=", 1)[1].strip('"')))
    if environ.get("STUDY_DATA_DIR"):
        return os.path.abspath(os.path.expanduser(environ["STUDY_DATA_DIR"]))
    cfg = os.path.join(root, "userdata", "data-dir.txt")
    if vfs.exists(cfg):
        with open(cfg, "r", encoding="utf-8-sig") as fh:
            line = fh.read().strip()
        if line:
            return os.path.abspath(os.path.expanduser(line))
    return os.path.join(root, "userdata", "workspace")


def _now():
    return int(time.time() * 1000)


def _uid(prefix=""):
    import secrets
    return prefix + datetime.now().strftime("%Y%m%d") + "-" + secrets.token_hex(4)


def _atomic_json(path, obj):
    safeio.atomic_json(path, obj, indent=1)


def _read_json(path, default=None):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return default


def _append_line(path, obj):
    safeio.append_line(path, json.dumps(obj, ensure_ascii=False))


def _safe_name(name, fallback="file"):
    name = os.path.basename(str(name or "")).strip()
    name = re.sub(r"[\\/:*?\"<>|\x00-\x1f]+", "_", name)
    name = re.sub(r"\s+", " ", name).strip(" .")
    return name[:120] or fallback


def _user_folder(user):
    u = re.sub(r"[^0-9A-Za-z가-힣_\-]+", "_", str(user or "").strip())[:40]
    return u or "guest"


# ---------------------------------------------------------------------------
# 텍스트 추출
# ---------------------------------------------------------------------------
def extract_text(path, ext):
    """→ (pages[list of str], note). 쪽 개념이 없으면 pages 는 1개."""
    ext = ext.lower()
    if ext == "pdf":
        try:
            import fitz  # PyMuPDF
            doc = fitz.open(path)
            pages = [p.get_text("text") for p in doc]
            doc.close()
            if sum(len(p.strip()) for p in pages) > 50:
                return pages, "pymupdf"
            return pages, "pymupdf-empty"      # 스캔본(텍스트 레이어 없음)
        except Exception:
            pass
        try:
            from pypdf import PdfReader
            rd = PdfReader(path)
            pages = [(pg.extract_text() or "") for pg in rd.pages]
            return pages, "pypdf"
        except Exception as e:
            return [], "pdf-fail: " + str(e)[:80]
    if ext in ("txt", "md", "csv", "json", "html", "htm"):
        raw = open(path, "rb").read()
        for enc in ("utf-8-sig", "cp949", "euc-kr", "latin-1"):
            try:
                t = raw.decode(enc)
                break
            except UnicodeDecodeError:
                t = None
        if t is None:
            t = raw.decode("utf-8", "replace")
        if ext in ("html", "htm"):
            t = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", t, flags=re.S | re.I)
            t = re.sub(r"<[^>]+>", " ", t)
            t = re.sub(r"[ \t]+", " ", t)
        return [t], ext
    if ext == "docx":
        try:
            import docx
            d = docx.Document(path)
            parts = [p.text for p in d.paragraphs]
            for tb in d.tables:
                for row in tb.rows:
                    parts.append(" | ".join(c.text.strip() for c in row.cells))
            return ["\n".join(parts)], "python-docx"
        except Exception as e:
            return [], "docx-fail: " + str(e)[:80]
    if ext == "pptx":
        try:
            from pptx import Presentation
            pr = Presentation(path)
            pages = []
            for sl in pr.slides:
                buf = []
                for sh in sl.shapes:
                    if sh.has_text_frame:
                        buf.append(sh.text_frame.text)
                pages.append("\n".join(buf))
            return pages, "python-pptx"
        except Exception as e:
            return [], "pptx-fail: " + str(e)[:80]
    return [], "unsupported"


def _join_pages(pages):
    out = []
    for i, p in enumerate(pages):
        out.append("\n\n[p.%d]\n%s" % (i + 1, (p or "").strip()))
    return "".join(out).strip()


# ---------------------------------------------------------------------------
# 문서 → DOCX / PPTX / HTML / MD  (문서 = {title, kind, kicker, sections:[{h, body}]}, body 는 가벼운 마크다운)
# ---------------------------------------------------------------------------
_B = re.compile(r"\*\*(.+?)\*\*")


def _md_blocks(body):
    """마크다운 → [(kind, payload)]  kind: h, p, ul, ol, table, quote"""
    blocks, buf, kind = [], [], None

    def flush():
        nonlocal buf, kind
        if buf and kind:
            blocks.append((kind, buf))
        buf, kind = [], None

    for raw in str(body or "").replace("\r", "").split("\n"):
        line = raw.rstrip()
        if not line.strip():
            flush(); continue
        m = re.match(r"^(#{1,4})\s+(.*)", line)
        if m:
            flush(); blocks.append(("h", [m.group(2).strip(), len(m.group(1))])); continue
        if re.match(r"^\s*[-*•·]\s+", line):
            if kind != "ul": flush(); kind = "ul"
            buf.append(re.sub(r"^\s*[-*•·]\s+", "", line)); continue
        if re.match(r"^\s*\d+[.)]\s+", line):
            if kind != "ol": flush(); kind = "ol"
            buf.append(re.sub(r"^\s*\d+[.)]\s+", "", line)); continue
        if line.strip().startswith("|"):
            if kind != "table": flush(); kind = "table"
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if not all(re.match(r"^:?-{2,}:?$", c) for c in cells if c):
                buf.append(cells)
            continue
        if line.strip().startswith(">"):
            if kind != "quote": flush(); kind = "quote"
            buf.append(line.strip().lstrip(">").strip()); continue
        if kind != "p": flush(); kind = "p"
        buf.append(line.strip())
    flush()
    return blocks


def _plain(s):
    return _B.sub(r"\1", str(s or "")).replace("`", "")


def _add_runs(par, text):
    pos = 0
    for m in _B.finditer(text):
        if m.start() > pos:
            par.add_run(text[pos:m.start()])
        r = par.add_run(m.group(1)); r.bold = True
        pos = m.end()
    if pos < len(text):
        par.add_run(text[pos:])


def to_docx(doc, path):
    import docx
    from docx.shared import Pt, RGBColor
    d = docx.Document()
    st = d.styles["Normal"]; st.font.name = "Malgun Gothic"; st.font.size = Pt(10.5)
    try:
        from docx.oxml.ns import qn
        st.element.rPr.rFonts.set(qn("w:eastAsia"), "Malgun Gothic")
    except Exception:
        pass
    if doc.get("kicker"):
        p = d.add_paragraph(); r = p.add_run(str(doc["kicker"])); r.font.size = Pt(9); r.font.color.rgb = RGBColor(0x55, 0x66, 0xAA)
    d.add_heading(str(doc.get("title") or "제목 없음"), level=0)
    if doc.get("meta"):
        p = d.add_paragraph(); r = p.add_run(str(doc["meta"])); r.italic = True; r.font.size = Pt(9)
    for sec in doc.get("sections") or []:
        if sec.get("h"):
            d.add_heading(_plain(sec["h"]), level=1)
        for kind, payload in _md_blocks(sec.get("body")):
            if kind == "h":
                d.add_heading(_plain(payload[0]), level=min(2 + payload[1] - 1, 4))
            elif kind == "p":
                _add_runs(d.add_paragraph(), " ".join(payload))
            elif kind == "ul":
                for it in payload: _add_runs(d.add_paragraph(style="List Bullet"), it)
            elif kind == "ol":
                for it in payload: _add_runs(d.add_paragraph(style="List Number"), it)
            elif kind == "quote":
                p = d.add_paragraph(); r = p.add_run(" ".join(payload)); r.italic = True
            elif kind == "table" and payload:
                cols = max(len(r) for r in payload)
                t = d.add_table(rows=0, cols=cols); t.style = "Table Grid"
                for ri, row in enumerate(payload):
                    cells = t.add_row().cells
                    for ci in range(cols):
                        txt = _plain(row[ci]) if ci < len(row) else ""
                        cells[ci].text = txt
                        if ri == 0:
                            for pr in cells[ci].paragraphs:
                                for rn in pr.runs: rn.bold = True
    d.save(path)


def _bullets_for_slide(body, limit=7):
    items = []
    for kind, payload in _md_blocks(body):
        if kind in ("ul", "ol"):
            items.extend(_plain(x) for x in payload)
        elif kind == "p":
            txt = _plain(" ".join(payload))
            for s in re.split(r"(?<=[.!?。])\s+|(?<=다\.)\s*", txt):
                s = s.strip()
                if s: items.append(s)
        elif kind == "h":
            items.append("▶ " + _plain(payload[0]))
        elif kind == "table":
            for row in payload[:6]: items.append(" · ".join(_plain(c) for c in row))
        elif kind == "quote":
            items.append("“" + _plain(" ".join(payload)) + "”")
    items = [i[:160] for i in items if i]
    return [items[i:i + limit] for i in range(0, len(items), limit)] or [[]]


def to_pptx(doc, path):
    from pptx import Presentation
    from pptx.util import Pt, Inches
    pr = Presentation()
    pr.slide_width, pr.slide_height = Inches(13.333), Inches(7.5)
    s = pr.slides.add_slide(pr.slide_layouts[0])
    s.shapes.title.text = str(doc.get("title") or "제목 없음")
    if len(s.placeholders) > 1:
        s.placeholders[1].text = str(doc.get("kicker") or "") + ("\n" + str(doc["meta"]) if doc.get("meta") else "")
    secs = doc.get("sections") or []
    if len(secs) > 1:   # 목차
        s = pr.slides.add_slide(pr.slide_layouts[1]); s.shapes.title.text = "목차"
        tf = s.placeholders[1].text_frame; tf.clear()
        for i, sec in enumerate(secs):
            p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
            p.text = "%d. %s" % (i + 1, _plain(sec.get("h") or "")); p.font.size = Pt(20)
    for sec in secs:
        chunks = _bullets_for_slide(sec.get("body"))
        for ci, items in enumerate(chunks):
            s = pr.slides.add_slide(pr.slide_layouts[1])
            s.shapes.title.text = _plain(sec.get("h") or "") + (" (계속)" if ci else "")
            tf = s.placeholders[1].text_frame; tf.clear(); tf.word_wrap = True
            if not items:
                tf.paragraphs[0].text = ""
            for i, it in enumerate(items):
                p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
                p.text = it; p.font.size = Pt(18 if len(items) <= 5 else 16); p.level = 0
            try:
                s.notes_slide.notes_text_frame.text = _plain(sec.get("body") or "")[:3000]
            except Exception:
                pass
    pr.save(path)


def _esc(s):
    return str(s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _inline_html(s):
    return _B.sub(r"<b>\1</b>", _esc(s))


def to_html(doc):
    parts = []
    for sec in doc.get("sections") or []:
        if sec.get("h"): parts.append("<h2>%s</h2>" % _inline_html(sec["h"]))
        for kind, payload in _md_blocks(sec.get("body")):
            if kind == "h": parts.append("<h%d>%s</h%d>" % (payload[1] + 1, _inline_html(payload[0]), payload[1] + 1))
            elif kind == "p": parts.append("<p>%s</p>" % _inline_html(" ".join(payload)))
            elif kind == "ul": parts.append("<ul>%s</ul>" % "".join("<li>%s</li>" % _inline_html(x) for x in payload))
            elif kind == "ol": parts.append("<ol>%s</ol>" % "".join("<li>%s</li>" % _inline_html(x) for x in payload))
            elif kind == "quote": parts.append("<blockquote>%s</blockquote>" % _inline_html(" ".join(payload)))
            elif kind == "table" and payload:
                rows = []
                for ri, row in enumerate(payload):
                    tag = "th" if ri == 0 else "td"
                    rows.append("<tr>%s</tr>" % "".join("<%s>%s</%s>" % (tag, _inline_html(c), tag) for c in row))
                parts.append("<table>%s</table>" % "".join(rows))
    css = ("body{font-family:'Pretendard Variable','Malgun Gothic',sans-serif;max-width:860px;margin:36px auto;padding:0 22px;color:#1d2433;line-height:1.75}"
           "h1{font-size:28px;letter-spacing:-.02em;margin:4px 0 6px}h2{margin-top:34px;padding-bottom:6px;border-bottom:2px solid #4f6bff}"
           ".k{color:#4f6bff;font-weight:800;font-size:12px}.m{color:#667;font-size:13px;margin-bottom:24px}table{border-collapse:collapse;margin:10px 0}"
           "td,th{border:1px solid #cfd4e0;padding:6px 10px;text-align:left;vertical-align:top}th{background:#eef1ff}blockquote{border-left:4px solid #cfd4e0;margin:10px 0;padding:4px 14px;color:#556}"
           "@media print{body{margin:0;max-width:none}}")
    return ("<!doctype html><html lang=\"ko\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>%s</title><style>%s</style></head><body>"
            "<div class=\"k\">%s</div><h1>%s</h1><div class=\"m\">%s</div>%s</body></html>") % (
        _esc(doc.get("title")), css, _esc(doc.get("kicker")), _esc(doc.get("title") or "제목 없음"), _esc(doc.get("meta")), "".join(parts))


def to_md(doc):
    out = ["# " + str(doc.get("title") or "제목 없음"), ""]
    if doc.get("kicker"): out.insert(0, "*" + str(doc["kicker"]) + "*\n")
    if doc.get("meta"): out.append("_" + str(doc["meta"]) + "_\n")
    for sec in doc.get("sections") or []:
        if sec.get("h"): out.append("## " + str(sec["h"]))
        out.append(str(sec.get("body") or "")); out.append("")
    return "\n".join(out)


# ---------------------------------------------------------------------------
# 저장소
# ---------------------------------------------------------------------------

_SHARE_LOCK = threading.Lock()
_ACT = threading.local()          # (v178) 이번 요청을 실제로 한 계정(공유받은 사람)   # (v178) 공유 기록·색인을 함께 바꾼다
ACCOUNTS = None        # (v178) serve.py 가 넣는다: () -> [계정 공개 정보] — 공유 대상 고르기
PROJECT_EXTRA = None   # (v138) serve.py 가 넣는다: (uid, pid) -> {'period': {'start','end'}}

class Workspace:
    def __init__(self, data_dir):
        vfs.ensure(data_dir)        # (v151)
        self.dir = data_dir
        self._backup_day = None
        self.snap = None          # (v140) backup_api.Backup — 있으면 일일 zip 대신 시간별 스냅숏을 쓴다

    # -- 경로 --
    def udir(self, user): return os.path.join(self.dir, "users", _user_folder(user))
    def pdir(self, user, pid): return os.path.join(self.udir(user), "projects", pid)

    def _backup_if_new_day(self, force=False):
        if self.snap is not None:          # (v140) 백업은 backup_api 가 1시간마다 — 예전 _backups/ws-*.zip 은 읽기만
            return
        day = datetime.now().strftime("%Y%m%d")
        if self._backup_day == day and not force:
            return
        bdir = os.path.join(self.dir, "_backups")
        os.makedirs(bdir, exist_ok=True)
        target = os.path.join(bdir, "ws-%s.zip" % day)
        self._backup_day = day
        if vfs.exists(target) and not force:   # (v124) [지금 백업]은 오늘 것을 새로 만든다. 예전에는 아침 사본이 그대로 남았다
            return

        def run():
            users = os.path.join(self.dir, "users")
            if not vfs.isdir(users):
                return
            tmp = target + ".tmp"
            try:
                with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
                    for top in ("users", "system"):
                        for base, dirs, files in vfs.walk(os.path.join(self.dir, top)):
                            dirs[:] = [d for d in dirs if d != "cli-sandbox"]
                            for f in files:
                                if f.endswith(".tmp") or f == "sessions.json":
                                    continue
                                full = os.path.join(base, f)
                                vfs.zwrite(z, full, os.path.relpath(full, self.dir))
                vfs.replace(tmp, target)
                olds = sorted(f for f in vfs.listdir(bdir) if f.startswith("ws-") and f.endswith(".zip"))
                for f in olds[:-KEEP_BACKUPS]:
                    try: vfs.remove(os.path.join(bdir, f))
                    except OSError: pass
            except Exception:
                try: vfs.remove(tmp)
                except OSError: pass
        threading.Thread(target=run, daemon=True).start()

    def _log(self, user, pid, ev):
        ev = dict(ev); ev.setdefault("t", _now())
        if getattr(_ACT, "by", None) and _ACT.by != user:
            ev.setdefault("by", _ACT.by)          # (v178) 공유받은 사람이 한 일 — 누가 했는지 남긴다
        _append_line(os.path.join(self.pdir(user, pid), "log.jsonl"), ev)
        try:   # (v120) 시스템 사이 변경 알림 /hub/events — 내용 없이 무엇이 바뀌었는지만
            _append_line(os.path.join(self.udir(user), "hub-events.jsonl"), {"at": ev.get("t"), "kind": str(ev.get("kind") or ""), "action": str(ev.get("action") or ""), "id": pid, "title": str(ev.get("name") or ev.get("title") or "")[:200], "actor": user})
        except Exception:
            pass
        self._backup_if_new_day()
        return ev

    # -- 프로젝트 --
    def projects(self, user):
        base = os.path.join(self.udir(user), "projects")
        out = []
        if vfs.isdir(base):
            for pid in vfs.listdir(base):
                meta = _read_json(os.path.join(base, pid, "project.json"))
                if meta:
                    meta["counts"] = {"files": self._count(os.path.join(base, pid, "files"), ".json"), "docs": self._count(os.path.join(base, pid, "docs"), None, dirs=True)}
                    out.append(meta)
        out.sort(key=lambda m: -(m.get("updated") or 0))
        return out

    @staticmethod
    def _count(path, suffix, dirs=False):
        try:
            names = vfs.listdir(path)
        except OSError:
            return 0
        if dirs:
            return sum(1 for n in names if vfs.isdir(os.path.join(path, n)))
        return sum(1 for n in names if n.endswith(suffix))

    def save_project(self, user, body):
        pid = body.get("id") if SAFE_ID.match(str(body.get("id") or "")) else None
        new = pid is None
        pid = pid or _uid("p")
        path = os.path.join(self.pdir(user, pid), "project.json")
        cur = _read_json(path, {}) or {}
        keep = {"id": pid, "name": str(body.get("name") or cur.get("name") or "새 프로젝트")[:120], "kind": str(body.get("kind") or cur.get("kind") or "research")[:30],
                "goal": str(body.get("goal") if body.get("goal") is not None else cur.get("goal") or "")[:2000], "tags": [str(t)[:30] for t in (body.get("tags") or cur.get("tags") or [])][:12],
                "created": cur.get("created") or _now(), "updated": _now(), "chat": body.get("chat") if isinstance(body.get("chat"), dict) else (cur.get("chat") or {})}
        hid = body.get("hidden") if "hidden" in body else cur.get("hidden")      # (v98) 폴더 트리에서 숨긴 항목(상대 경로) — 실제 파일은 그대로
        if isinstance(hid, list) and hid:
            keep["hidden"] = [str(x)[:400] for x in hid][:3000]
        rem = body.get("removed") if "removed" in body else cur.get("removed")   # (v112) 시스템에서 지운 폴더·파일(상대 경로) — 실제 파일은 그대로
        if isinstance(rem, list) and rem:
            keep["removed"] = [str(x)[:400] for x in rem][:3000]
        if (body.get("archived") if "archived" in body else cur.get("archived")):
            keep["archived"] = True                               # (v98) 목록에서 숨긴 프로젝트
        g_ = body.get("group") if "group" in body else cur.get("group")
        if g_:
            keep["group"] = str(g_)[:60]                          # (v93) 프로젝트 폴더(묶음) — 메타데이터, 디스크 위치는 그대로
        if cur.get("source"):
            keep["source"] = cur["source"]                       # 폴더 연결은 folder_link/master 로만(관리자) — 본문으로 경로를 바꿀 수 없다
        rn = body.get("rnd") if "rnd" in body else cur.get("rnd")         # (v117) 연구행정 과제 연결 {id, code, name}
        if isinstance(rn, dict) and rn.get("id"):
            keep["rnd"] = {k: str(rn.get(k) or "")[:300] for k in ("id", "code", "name")}
        ep = body.get("epic") if "epic" in body else cur.get("epic")
        if isinstance(ep, dict) and ep.get("id"):
            keep["epic"] = {k: str(ep.get(k) or "")[:300] for k in ("id", "title", "board", "url", "status", "key")}
        iss = body.get("issues") if "issues" in body else cur.get("issues")   # (v125) 칸반 이슈 연결 [{id,key,title,url}]
        if isinstance(iss, list) and iss:
            keep["issues"] = [{k: str(x.get(k) or "")[:300] for k in ("id", "key", "title", "url")} for x in iss if isinstance(x, dict)][:60]
        if cur.get("shares"):
            keep["shares"] = cur["shares"]                       # (v178) 공유는 share 동작으로만(소유자) — 저장 본문으로 바꾸지 못한다
        _atomic_json(path, keep)
        self._log(user, pid, {"kind": "project", "action": "create" if new else "update", "name": keep["name"]})
        self._write_readme(user, pid, keep)
        return keep

    # (v93) 사람이 폴더를 열어 봐도 알 수 있게 — 프로젝트마다 README.md, 전체 목록 projects/_INDEX.md
    def _write_readme(self, user, pid, meta):
        try:
            src = meta.get("source") or {}
            ep = meta.get("epic") or {}
            lines = ["# " + meta.get("name", pid), "", "- 프로젝트 id: `" + pid + "`", "- 종류: " + str(meta.get("kind")), "- 폴더(묶음): " + (meta.get("group") or "기본"),
                     "- 목표: " + (meta.get("goal") or "-")]
            if src.get("path"):
                lines.append("- 연결 폴더(읽기만): `" + src["path"] + "`" + (" (마스터 폴더에서)" if src.get("master") else ""))
            if ep.get("key"):
                lines.append("- FlowBoard 에픽: " + ep.get("key", "") + " " + ep.get("title", "") + (" — " + ep["url"] if ep.get("url") else ""))
            lines += ["", "## 이 폴더", "- `project.json` 프로젝트 정보", "- `files/` 올린 자료 원본 + 추출 텍스트(`<id>.txt`) + 정보(`<id>.json` — 원래 파일 이름)",
                      "- `docs/<문서 id>/v0001.json …` 문서 버전(저장할 때마다 새 번호) · `current.json` 최신 번호", "- `out/` 내보낸 DOCX·PPTX·HTML·MD·묶음 zip",
                      "- `log.jsonl` 이력(대화 한 턴·문서 저장·내보내기·자료) — 추가만", "- `notes.kv.json` · `todo.kv.json` · `references.kv.json` 메모·할 일·참고문헌(도구 탭)",
                      "- `fcache/` 연결 폴더 문서의 추출 텍스트 캐시(지워도 다시 만들어짐)", "", "_자동 생성 — 프로젝트를 저장할 때마다 새로 써요._"]
            with open(os.path.join(self.pdir(user, pid), "README.md"), "w", encoding="utf-8") as fh:
                fh.write("\n".join(lines) + "\n")
            ps = self.projects(user)
            groups = {}
            for p in ps:
                groups.setdefault(p.get("group") or "기본", []).append(p)
            idx = ["# 연구 프로젝트 목록", "", "폴더(묶음)별 · 최근 수정 순. 각 프로젝트 폴더의 README.md 에 자세한 구조가 있어요.", ""]
            for g in sorted(groups, key=lambda x: (x == "기본", x)):
                idx.append("## 📁 " + g)
                for p in groups[g]:
                    idx.append("- **" + p.get("name", "") + "** — `" + p["id"] + "/`" + (" · 📁 " + (p.get("source") or {}).get("path", "") if p.get("source") else "") + (" · 📋 " + (p.get("epic") or {}).get("key", "") if p.get("epic") else ""))
                idx.append("")
            with open(os.path.join(self.udir(user), "projects", "_INDEX.md"), "w", encoding="utf-8") as fh:
                fh.write("\n".join(idx))
        except OSError:
            pass

    # ---- (v93) 로컬 폴더 연결 · 마스터 폴더 ----
    def project_meta(self, user, pid):
        return _read_json(os.path.join(self.pdir(user, pid), "project.json"))

    # ---- (v178) 데이터 소유·공유 data-owner/1 — 프로젝트는 만든 계정 것, 다른 계정은 소유자가 공유해야 본다 ----
    def _f_shares(self):
        return os.path.join(self.dir, "system", "ws-shares.json")      # 받은 쪽 색인 {받은 uid: {"<소유자>|<pid>": perm}}

    def share_perm(self, owner, pid, uid):
        s = ((self.project_meta(owner, pid) or {}).get("shares") or {}).get(uid)
        return s.get("perm") if isinstance(s, dict) and s.get("perm") in ("view", "edit") else None

    def shares(self, owner, pid):
        return dict((self.project_meta(owner, pid) or {}).get("shares") or {})

    def set_share(self, owner, pid, target, perm, by):
        path = os.path.join(self.pdir(owner, pid), "project.json")
        with _SHARE_LOCK:
            cur = _read_json(path)
            if not cur:
                return False
            sh = dict(cur.get("shares") or {})
            if perm:
                sh[target] = {"perm": perm, "at": _now(), "by": by}
            else:
                sh.pop(target, None)
            if sh:
                cur["shares"] = sh
            else:
                cur.pop("shares", None)
            _atomic_json(path, cur)
            idx = _read_json(self._f_shares(), {}) or {}
            mine = dict(idx.get(target) or {})
            if perm:
                mine[owner + "|" + pid] = perm
            else:
                mine.pop(owner + "|" + pid, None)
            if mine:
                idx[target] = mine
            else:
                idx.pop(target, None)
            _atomic_json(self._f_shares(), idx)
        return True

    def shared_with(self, uid):
        """이 계정이 공유받은 프로젝트 [(소유자, pid, perm)] — 색인은 참고, 실제 권한은 소유자 project.json 으로 다시 확인."""
        out = []
        for k in ((_read_json(self._f_shares(), {}) or {}).get(uid) or {}):
            owner, _s, pid = k.partition("|")
            p = self.share_perm(owner, pid, uid) if SAFE_ID.match(owner or "") and SAFE_ID.match(pid or "") else None
            if p:
                out.append((owner, pid, p))
        return out

    def folder_root(self, user, pid):
        src = (self.project_meta(user, pid) or {}).get("source") or {}
        return src.get("path") if src.get("type") == "folder" and src.get("path") and vfs.isdir(src.get("path")) else None

    def scan(self, root, force=False):
        cache = getattr(self, "_scan", None)
        if cache is None:
            cache = self._scan = {}
        hit = cache.get(root)
        if hit and not force and time.time() - hit[0] < 20:
            return hit[1], hit[2]
        out, trunc = [], False
        for base, dirs, files in vfs.walk(root):
            relb = os.path.relpath(base, root)
            depth = 0 if relb == "." else relb.count(os.sep) + 1
            dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS and not d.startswith(".")) if depth < MAX_DEPTH else []
            for f in sorted(files):
                if f.startswith(".") or f.startswith("~$"):
                    continue
                full = os.path.join(base, f)
                rel = (f if relb == "." else os.path.join(relb, f)).replace("\\", "/")
                ext = f.rsplit(".", 1)[-1].lower() if "." in f else ""
                try:
                    st = vfs.stat(full)
                except OSError:
                    continue
                out.append({"id": _fid_of(rel), "rel": rel, "name": f, "ext": ext, "size": st.st_size, "mtime": int(st.st_mtime * 1000),
                            "doc": ext in DOC_EXT and st.st_size <= MAX_UPLOAD})
                if len(out) >= MAX_TREE:
                    trunc = True; break
            if trunc:
                break
        cache[root] = (time.time(), out, trunc)
        return out, trunc

    def _folder_entry(self, user, pid, fid):
        root = self.folder_root(user, pid)
        if not root:
            return None, None
        ent = next((e for e in self.scan(root)[0] if e["id"] == fid), None) or next((e for e in self.scan(root, force=True)[0] if e["id"] == fid), None)
        if not ent:
            return root, None
        full = os.path.realpath(os.path.join(root, ent["rel"]))
        if not full.startswith(os.path.realpath(root)):        # 폴더 밖으로 나가는 경로 차단
            return root, None
        return root, dict(ent, full=full)

    def _fcache(self, user, pid, fid):
        return os.path.join(self.pdir(user, pid), "fcache", fid)

    def tree(self, user, pid):
        root = self.folder_root(user, pid)
        if not root:
            return {"root": None, "list": [], "truncated": False}
        lst, trunc = self.scan(root)
        out = []
        for e in lst:
            m = _read_json(self._fcache(user, pid, e["id"]) + ".json") if e["doc"] else None
            ok = m and m.get("mtime") == e["mtime"] and m.get("size") == e["size"]
            out.append(dict(e, chars=(m.get("chars") if ok else None), pages=(m.get("pages") if ok else None)))
        return {"root": root, "list": out, "truncated": trunc}

    def folder_text(self, user, pid, fid):
        root, ent = self._folder_entry(user, pid, fid)
        if not ent or not ent["doc"]:
            return ""
        cp = self._fcache(user, pid, fid)
        m = _read_json(cp + ".json")
        if m and m.get("mtime") == ent["mtime"] and m.get("size") == ent["size"] and vfs.exists(cp + ".txt"):
            return open(cp + ".txt", "r", encoding="utf-8").read()
        pages, note = _extract_any(ent["full"], ent["ext"])
        if not pages and ent["ext"] in ("doc", "ppt", "xls", "rtf", "odt", "odp", "ods"):
            pages, note = office_text(ent["full"], cp)
        text = _join_pages(pages) if len(pages) > 1 else (pages[0] if pages else "")
        os.makedirs(os.path.dirname(cp), exist_ok=True)
        with open(cp + ".txt", "w", encoding="utf-8") as fh:
            fh.write(text)
        _atomic_json(cp + ".json", {"mtime": ent["mtime"], "size": ent["size"], "chars": len(text), "pages": len(pages), "extract": note, "rel": ent["rel"]})
        return text

    def folder_link(self, user, path, name=None, pid=None, master=None):
        path = os.path.abspath(os.path.expanduser(str(path or "").strip().strip('"')))
        if not vfs.isdir(path):
            return None, "폴더를 찾지 못했어요: " + path
        for m in self.projects(user):
            src = m.get("source") or {}
            if os.path.normcase(src.get("path") or "") == os.path.normcase(path):
                return m, None                                    # 이미 연결된 폴더 — 그 프로젝트를 돌려준다
        if pid:
            cur = self.project_meta(user, pid) or {}
            body = dict(cur)
        else:
            body = {"name": name or os.path.basename(path.rstrip("\\/")) or path, "kind": "other", "goal": ""}
        meta = self.save_project(user, body)
        meta["source"] = {"type": "folder", "path": path, "master": master or None, "linked": _now()}
        _atomic_json(os.path.join(self.pdir(user, meta["id"]), "project.json"), meta)
        self._log(user, meta["id"], {"kind": "project", "action": "folder_link", "path": path})
        return meta, None

    def _masters_path(self, user):
        return os.path.join(self.udir(user), "masters.json")

    def masters(self, user):
        lst = _read_json(self._masters_path(user), []) or []
        projs = self.projects(user)
        for m in lst:
            m["exists"] = vfs.isdir(m.get("path") or "")
            m["projects"] = sum(1 for p in projs if ((p.get("source") or {}).get("master") == m["id"]))
            m["subdirs"] = len(self._subdirs(m["path"])) if m["exists"] else 0
        return lst

    @staticmethod
    def _subdirs(path):
        try:
            return sorted(d for d in vfs.listdir(path) if vfs.isdir(os.path.join(path, d)) and d not in SKIP_DIRS and not d.startswith((".", "_")))
        except OSError:
            return []

    def master_add(self, user, path):
        path = os.path.abspath(os.path.expanduser(str(path or "").strip().strip('"')))
        if not vfs.isdir(path):
            return None, "폴더를 찾지 못했어요: " + path
        lst = _read_json(self._masters_path(user), []) or []
        m = next((x for x in lst if os.path.normcase(x["path"]) == os.path.normcase(path)), None)
        if not m:
            m = {"id": _uid("m"), "path": path, "name": os.path.basename(path.rstrip("\\/")) or path, "added": _now()}
            lst.append(m)
            os.makedirs(self.udir(user), exist_ok=True)
            _atomic_json(self._masters_path(user), lst)
        return self.master_sync(user, m["id"]), None

    def master_sync(self, user, mid):
        lst = _read_json(self._masters_path(user), []) or []
        m = next((x for x in lst if x["id"] == mid), None)
        if not m:
            return {"master": None, "created": [], "linked": 0}
        created, linked = [], 0
        known = {os.path.normcase((p.get("source") or {}).get("path") or "") for p in self.projects(user)}
        excl = {os.path.normcase(x) for x in (m.get("exclude") or [])}
        for d in self._subdirs(m["path"]):
            full = os.path.join(m["path"], d)
            if os.path.normcase(full) in excl:
                continue                                          # (v98) 지운 하위 폴더는 다시 만들지 않는다
            if os.path.normcase(full) in known:
                linked += 1; continue
            meta, err = self.folder_link(user, full, name=d, master=mid)
            if meta:
                created.append({"id": meta["id"], "name": meta["name"]})
        m["synced"] = _now()
        _atomic_json(self._masters_path(user), lst)
        return {"master": m, "created": created, "linked": linked}

    def master_include(self, user, mid, path):
        """제외했던 하위 폴더를 다시 넣는다(다음 동기화 때 프로젝트로)."""
        lst = _read_json(self._masters_path(user), []) or []
        for m in lst:
            if m.get("id") == mid:
                m["exclude"] = [x for x in (m.get("exclude") or []) if os.path.normcase(x) != os.path.normcase(path or "")]
        _atomic_json(self._masters_path(user), lst)
        return self.master_sync(user, mid)

    def master_remove(self, user, mid):
        lst = _read_json(self._masters_path(user), []) or []
        _atomic_json(self._masters_path(user), [x for x in lst if x["id"] != mid])
        return True

    @staticmethod
    def browse(path):
        """관리자 폴더 고르기 — 하위 폴더 이름만(파일 내용은 보지 않는다)."""
        if not path:
            roots = []
            if os.name == "nt":
                import string
                roots = [d + ":\\" for d in string.ascii_uppercase if vfs.isdir(d + ":\\")]
            home = os.path.expanduser("~")
            quick = [x for x in (home, os.path.join(home, "Documents"), os.path.join(home, "Documents", "Claude", "Projects"), os.path.join(home, "Desktop")) if vfs.isdir(x)]
            return {"path": "", "parent": None, "dirs": [], "roots": roots, "quick": quick}
        path = os.path.abspath(os.path.expanduser(path))
        if not vfs.isdir(path):
            return {"path": path, "error": "폴더가 아니에요", "dirs": []}
        try:
            dirs = sorted(d for d in vfs.listdir(path) if vfs.isdir(os.path.join(path, d)) and not d.startswith("."))[:500]
        except OSError as e:
            return {"path": path, "error": str(e)[:120], "dirs": []}
        par = os.path.dirname(path.rstrip("\\/"))
        return {"path": path, "parent": par if par and par != path else None, "dirs": dirs}

    def trash_project(self, user, pid):
        src = self.pdir(user, pid)
        if not vfs.isdir(src):
            return False
        meta = self.project_meta(user, pid) or {}
        so = meta.get("source") or {}
        if so.get("master") and so.get("path"):                  # (v98) 마스터에서 온 프로젝트 — 다음 동기화 때 다시 생기지 않게 제외 목록에
            lst = _read_json(self._masters_path(user), []) or []
            for m in lst:
                if m.get("id") == so["master"]:
                    m["exclude"] = sorted(set((m.get("exclude") or []) + [so["path"]]))
            _atomic_json(self._masters_path(user), lst)
        dst = os.path.join(self.dir, "_trash", _user_folder(user), pid + "-" + datetime.now().strftime("%Y%m%d%H%M%S"))
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        vfs.move(src, dst)
        return True

    def project_trash(self, user):
        base = os.path.join(self.dir, "_trash", _user_folder(user))
        out = []
        if vfs.isdir(base):
            for tid in vfs.listdir(base):
                c = _read_json(os.path.join(base, tid, "project.json"))
                m = re.search(r"-(\d{14})$", tid)
                if c and m:
                    out.append(dict(c, tid=tid, trashed=int(datetime.strptime(m.group(1), "%Y%m%d%H%M%S").timestamp() * 1000)))
        out.sort(key=lambda c: -(c.get("trashed") or 0))
        return out

    def restore_project(self, user, tid):
        if not re.match(r"^[A-Za-z0-9_\-]{1,64}-\d{14}$", str(tid or "")):
            return None
        src = os.path.join(self.dir, "_trash", _user_folder(user), tid)
        meta = _read_json(os.path.join(src, "project.json"))
        if not meta:
            return None
        pid = tid.rsplit("-", 1)[0]
        dst = self.pdir(user, pid)
        if vfs.exists(dst):
            return None
        so = meta.get("source") or {}
        if so.get("master") and so.get("path"):                  # 마스터 제외 목록에서 빼서 다시 정상 프로젝트로
            lst = _read_json(self._masters_path(user), []) or []
            for m in lst:
                if m.get("id") == so["master"]:
                    m["exclude"] = [x for x in (m.get("exclude") or []) if x != so["path"]]
            _atomic_json(self._masters_path(user), lst)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        vfs.move(src, dst)
        return pid

    # -- 자료 --
    def upload(self, user, pid, name, data):
        name = _safe_name(name)
        ext = (name.rsplit(".", 1)[-1].lower() if "." in name else "bin")[:8]
        fid = _uid("f")
        fdir = os.path.join(self.pdir(user, pid), "files")
        os.makedirs(fdir, exist_ok=True)
        fpath = os.path.join(fdir, fid + "." + ext)
        with open(fpath + ".tmp", "wb") as fh:
            fh.write(data); fh.flush(); os.fsync(fh.fileno())
        vfs.replace(fpath + ".tmp", fpath)
        pages, note = _extract_any(fpath, ext) if ext in DOC_EXT else ([], "media")   # (v98) 그림·소리·영상은 보기만
        if not pages and ext in ("doc", "ppt", "xls", "rtf", "odt", "odp", "ods"):
            pages, note = office_text(fpath, self._fcache(user, pid, fid), wait=30)
        text = _join_pages(pages) if pages else ""
        if text:
            with open(os.path.join(fdir, fid + ".txt"), "w", encoding="utf-8") as fh:
                fh.write(text)
        meta = {"id": fid, "name": name, "ext": ext, "size": len(data), "pages": len(pages), "chars": len(text), "extract": note, "added": _now()}
        _atomic_json(os.path.join(fdir, fid + ".json"), meta)
        self._touch(user, pid)
        self._log(user, pid, {"kind": "file", "action": "upload", "fid": fid, "name": name, "pages": len(pages), "chars": len(text)})
        return meta

    def files(self, user, pid):
        fdir = os.path.join(self.pdir(user, pid), "files")
        out = []
        if vfs.isdir(fdir):
            for n in vfs.listdir(fdir):
                if n.endswith(".json"):
                    m = _read_json(os.path.join(fdir, n))
                    if m: out.append(m)
        out.sort(key=lambda m: m.get("added") or 0)
        return out

    def file_text(self, user, pid, fid):
        if fid.startswith("x"):
            return self.folder_text(user, pid, fid)
        p = os.path.join(self.pdir(user, pid), "files", fid + ".txt")
        try:
            return open(p, "r", encoding="utf-8").read()
        except OSError:
            return ""

    def file_path(self, user, pid, fid):
        if fid.startswith("x"):
            root, ent = self._folder_entry(user, pid, fid)
            return (ent["full"], {"name": ent["name"], "ext": ent["ext"]}) if ent else (None, None)
        m = _read_json(os.path.join(self.pdir(user, pid), "files", fid + ".json"))
        if not m:
            return None, None
        return os.path.join(self.pdir(user, pid), "files", fid + "." + m["ext"]), m

    def remove_file(self, user, pid, fid):
        fdir = os.path.join(self.pdir(user, pid), "files")
        tdir = os.path.join(self.dir, "_trash", _user_folder(user), pid + "-files")
        os.makedirs(tdir, exist_ok=True)
        n = 0
        for f in vfs.listdir(fdir) if vfs.isdir(fdir) else []:
            if f.startswith(fid + "."):
                vfs.move(os.path.join(fdir, f), os.path.join(tdir, f)); n += 1
        if n:
            self._log(user, pid, {"kind": "file", "action": "remove", "fid": fid})
        return n > 0

    def _touch(self, user, pid):
        path = os.path.join(self.pdir(user, pid), "project.json")
        cur = _read_json(path)
        if cur:
            cur["updated"] = _now(); _atomic_json(path, cur)

    # -- 이력 --
    def events(self, user, pid, limit=300, kind=None, since=0):
        p = os.path.join(self.pdir(user, pid), "log.jsonl")
        out = []
        try:
            with open(p, "r", encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line: continue
                    try: ev = json.loads(line)
                    except ValueError: continue
                    if kind and ev.get("kind") != kind: continue
                    if since and (ev.get("t") or 0) <= since: continue
                    out.append(ev)
        except OSError:
            pass
        return out[-limit:]

    def all_events(self, user, limit=400):
        out = []
        for m in self.projects(user):
            for ev in self.events(user, m["id"], limit=200):
                ev = dict(ev); ev["pid"] = m["id"]; ev["pname"] = m["name"]; out.append(ev)
        out.sort(key=lambda e: -(e.get("t") or 0))
        return out[:limit]

    # -- 문서(버전) --
    def save_doc(self, user, pid, did, doc):
        did = did if SAFE_ID.match(str(did or "")) else _uid("d")
        ddir = os.path.join(self.pdir(user, pid), "docs", did)
        os.makedirs(ddir, exist_ok=True)
        cur = _read_json(os.path.join(ddir, "current.json"), {}) or {}
        v = int(cur.get("v") or 0) + 1
        base = doc.get("ifV")     # (v122) 동시 수정 감지 — 내가 읽은 버전과 다르면 저장하지 않는다(값을 안 보내면 예전처럼)
        if base is not None and cur.get("v") and int(base) != int(cur["v"]):
            return {"conflict": True, "v": int(cur["v"]), "saved": cur.get("saved")}
        rec = {"id": did, "v": v, "saved": _now(), "title": str(doc.get("title") or "제목 없음")[:200], "kind": str(doc.get("kind") or "free")[:20],
               "kicker": str(doc.get("kicker") or "")[:200], "meta": str(doc.get("meta") or "")[:300],
               "sections": [{"h": str(s.get("h") or "")[:300], "body": str(s.get("body") or "")[:60000]} for s in (doc.get("sections") or [])][:80],
               "note": str(doc.get("note") or "")[:200]}
        if isinstance(doc.get("html"), str) and doc.get("html"):   # (v106) 보고서 작업실 — 서식 있는 본문(HTML)·문서 서식·코멘트
            rec["html"] = doc["html"][:6 * 1024 * 1024]
            rec["style"] = doc.get("style") if isinstance(doc.get("style"), dict) else {}
            rec["comments"] = doc.get("comments")[:300] if isinstance(doc.get("comments"), list) else []
        _atomic_json(os.path.join(ddir, "v%04d.json" % v), rec)
        _atomic_json(os.path.join(ddir, "current.json"), {"id": did, "v": v, "title": rec["title"], "kind": rec["kind"], "saved": rec["saved"], "sections": len(rec["sections"])})
        self._touch(user, pid)
        self._log(user, pid, {"kind": "doc", "action": "save", "did": did, "v": v, "title": rec["title"], "note": rec["note"]})
        return rec

    # (v108) 문서 휴지통 — 지우기는 docs_trash/ 로 옮기기(되살릴 수 있음)
    def trash_doc(self, user, pid, did):
        src = os.path.join(self.pdir(user, pid), "docs", did)
        if not vfs.isdir(src):
            return False
        cur = _read_json(os.path.join(src, "current.json"), {}) or {}
        tdir = os.path.join(self.pdir(user, pid), "docs_trash")
        os.makedirs(tdir, exist_ok=True)
        tid = did + "~" + datetime.now().strftime("%Y%m%d%H%M%S")
        vfs.move(src, os.path.join(tdir, tid))
        self._log(user, pid, {"kind": "doc", "action": "trash", "did": did, "title": cur.get("title")})
        return True

    def doc_trash(self, user, pid):
        base = os.path.join(self.pdir(user, pid), "docs_trash")
        out = []
        if vfs.isdir(base):
            for tid in vfs.listdir(base):
                c = _read_json(os.path.join(base, tid, "current.json"))
                if c:
                    out.append(dict(c, tid=tid, trashed=int(vfs.getmtime(os.path.join(base, tid)) * 1000)))
        out.sort(key=lambda c: -(c.get("trashed") or 0))
        return out

    def restore_doc(self, user, pid, tid):
        if not re.match(r"^[A-Za-z0-9_\-]{1,64}~\d{14}$", str(tid or "")):
            return None
        src = os.path.join(self.pdir(user, pid), "docs_trash", tid)
        if not vfs.isdir(src):
            return None
        did = tid.split("~")[0]
        dst = os.path.join(self.pdir(user, pid), "docs", did)
        if vfs.exists(dst):
            did = _uid("d")
            dst = os.path.join(self.pdir(user, pid), "docs", did)
            c = _read_json(os.path.join(src, "current.json"), {}) or {}
            c["id"] = did
            _atomic_json(os.path.join(src, "current.json"), c)
        vfs.move(src, dst)
        self._log(user, pid, {"kind": "doc", "action": "restore", "did": did})
        return did

    def docs(self, user, pid):
        base = os.path.join(self.pdir(user, pid), "docs")
        out = []
        if vfs.isdir(base):
            for did in vfs.listdir(base):
                c = _read_json(os.path.join(base, did, "current.json"))
                if c: out.append(c)
        out.sort(key=lambda c: -(c.get("saved") or 0))
        return out

    def doc(self, user, pid, did, v=None):
        ddir = os.path.join(self.pdir(user, pid), "docs", did)
        if v is None:
            c = _read_json(os.path.join(ddir, "current.json"))
            if not c: return None
            v = c["v"]
        return _read_json(os.path.join(ddir, "v%04d.json" % int(v)))

    def doc_versions(self, user, pid, did):
        ddir = os.path.join(self.pdir(user, pid), "docs", did)
        out = []
        for n in sorted(vfs.listdir(ddir)) if vfs.isdir(ddir) else []:
            if n.startswith("v") and n.endswith(".json"):
                r = _read_json(os.path.join(ddir, n))
                if r: out.append({"v": r["v"], "saved": r["saved"], "title": r["title"], "note": r.get("note", ""), "sections": len(r.get("sections") or [])})
        return out

    def export(self, user, pid, did, fmt, v=None):
        rec = self.doc(user, pid, did, v)
        if not rec:
            return None, "문서 없음"
        odir = os.path.join(self.pdir(user, pid), "out")
        os.makedirs(odir, exist_ok=True)
        base = _safe_name(rec["title"], "document")
        stamp = datetime.now().strftime("%Y%m%d-%H%M")
        name = "%s_v%d_%s.%s" % (base, rec["v"], stamp, fmt)
        path = os.path.join(odir, name)
        try:
            if fmt == "docx": to_docx(rec, path)
            elif fmt == "pptx": to_pptx(rec, path)
            elif fmt == "html": open(path, "w", encoding="utf-8").write(to_html(rec))
            elif fmt == "md": open(path, "w", encoding="utf-8").write(to_md(rec))
            else: return None, "지원하지 않는 형식"
        except ImportError as e:
            return None, "이 형식을 만들 라이브러리가 없어요(%s). pip install python-docx python-pptx" % str(e)[:60]
        except Exception as e:
            return None, "만들다 실패: " + str(e)[:120]
        self._log(user, pid, {"kind": "export", "fmt": fmt, "did": did, "v": rec["v"], "name": name})
        return {"name": name, "size": vfs.getsize(path), "path": path}, None

    def outputs(self, user, pid):
        odir = os.path.join(self.pdir(user, pid), "out")
        out = []
        for n in vfs.listdir(odir) if vfs.isdir(odir) else []:
            p = os.path.join(odir, n)
            if vfs.isfile(p):
                out.append({"name": n, "size": vfs.getsize(p), "t": int(vfs.getmtime(p) * 1000)})
        out.sort(key=lambda x: -x["t"])
        return out

    # -- 앱 상태 거울(옛 형식) --
    def mirror_save(self, user, body):
        mdir = os.path.join(self.udir(user), "mirror")
        rec = {"saved": _now(), "data": body}
        _atomic_json(os.path.join(mdir, "progress.json"), rec)
        day = os.path.join(mdir, "progress-%s.json" % datetime.now().strftime("%Y%m%d"))
        if not vfs.exists(day):
            _atomic_json(day, rec)
        self._backup_if_new_day()
        return rec["saved"]

    def mirror_load(self, user):
        return _read_json(os.path.join(self.udir(user), "mirror", "progress.json"))

    # ---- (v92) 계정 상태(브라우저 학습 진행 전체) — 계정에 저장해 어느 브라우저에서든 이어서 ----
    #   users/<uid>/state/current.json  {saved, device, user:{접미사: 값}, global:{키: 값}}
    #   덮어쓰기 전 이전 판을 state/history/ 로(10분에 1장, 최근 60장) → 다른 기기가 덮어써도 되돌릴 수 있다.
    def state_save(self, user, body):
        d = os.path.join(self.udir(user), "state")
        cur = os.path.join(d, "current.json")
        hist = os.path.join(d, "history")
        with _lock:
            if vfs.exists(cur):
                os.makedirs(hist, exist_ok=True)
                olds = sorted(f for f in vfs.listdir(hist) if f.endswith(".json"))
                last_t = vfs.getmtime(os.path.join(hist, olds[-1])) if olds else 0
                prev_dev = (_read_json(cur) or {}).get("device")
                other = str(body.get("device") or "")[:60] != prev_dev          # 다른 기기가 덮어쓰면 언제나 이전 판을 남긴다
                if other or body.get("keep_prev") or time.time() - last_t > 600:
                    hn = os.path.join(hist, datetime.now().strftime("%Y%m%d-%H%M%S") + ".json")
                    if not vfs.exists(hn): vfs.copy(cur, hn)
                    for f in olds[:-59]:
                        try: vfs.remove(os.path.join(hist, f))
                        except OSError: pass
            saved = _now()
            rec = {"schema": 1, "saved": saved, "device": str(body.get("device") or "")[:60],
                   "user": body.get("user") if isinstance(body.get("user"), dict) else {}, "global": body.get("global") if isinstance(body.get("global"), dict) else {}}
            _atomic_json(cur, rec)
        self._backup_if_new_day()
        return {"ok": True, "saved": saved, "keys": len(rec["user"]) + len(rec["global"])}

    def state_archive(self, user, body):
        hist = os.path.join(self.udir(user), "state", "history")
        os.makedirs(hist, exist_ok=True)
        name = datetime.now().strftime("%Y%m%d-%H%M%S") + ".json"
        if vfs.exists(os.path.join(hist, name)):
            time.sleep(1.1); name = datetime.now().strftime("%Y%m%d-%H%M%S") + ".json"
        _atomic_json(os.path.join(hist, name), {"schema": 1, "saved": _now(), "device": ("이 브라우저 보관 · " + str(body.get("device") or ""))[:60],
                                                "user": body.get("user") if isinstance(body.get("user"), dict) else {}, "global": body.get("global") if isinstance(body.get("global"), dict) else {}})
        return name

    def state_load(self, user, name=None):
        d = os.path.join(self.udir(user), "state")
        if name:
            if not re.match(r"^\d{8}-\d{6}\.json$", name): return None
            return _read_json(os.path.join(d, "history", name))
        return _read_json(os.path.join(d, "current.json"))

    def state_history(self, user):
        h = os.path.join(self.udir(user), "state", "history")
        if not vfs.isdir(h): return []
        out = []
        for f in sorted(vfs.listdir(h), reverse=True):
            if f.endswith(".json"):
                st = _read_json(os.path.join(h, f)) or {}
                out.append({"name": f, "saved": st.get("saved"), "device": st.get("device"), "keys": len(st.get("user") or {}) + len(st.get("global") or {}), "size": vfs.getsize(os.path.join(h, f))})
        return out

    def state_restore(self, user, name):
        st = self.state_load(user, name)
        if not st: return None
        st = dict(st, saved=_now(), device="되돌림 " + name[:15])
        return self.state_save(user, st) and st

    def health(self):
        users = os.path.join(self.dir, "users")
        n_users = len(vfs.listdir(users)) if vfs.isdir(users) else 0
        bdir = os.path.join(self.dir, "_backups")
        backs = sorted(f for f in vfs.listdir(bdir) if f.endswith(".zip")) if vfs.isdir(bdir) else []
        if self.snap is not None:
            backs = [r["name"] for r in reversed(self.snap.list())]
        libs = {}
        for m in ("fitz", "pypdf", "docx", "pptx"):
            try: __import__(m); libs[m] = True
            except Exception: libs[m] = False
        try:
            free = shutil.disk_usage(self.dir if vfs.isdir(self.dir) else os.path.dirname(self.dir)).free
        except Exception:
            free = None
        import sys
        return {"ok": True, "dir": self.dir, "py": sys.executable, "users": n_users, "last_backup": backs[-1] if backs else None, "backups": len(backs), "libs": libs, "free_gb": round(free / 1e9, 1) if free else None}

    # (v124) 백업에서 프로젝트 하나 되살리기. 지금 폴더는 _trash 로 옮기고 푼다. 연결된 PC 폴더는 건드리지 않는다
    def backups(self):
        bdir = os.path.join(self.dir, "_backups")
        out = []
        if self.snap is not None:
            out += [{"name": r["name"], "size": r["bytes"], "t": r["created"], "kind": r["kind"], "files": r["files"]} for r in self.snap.list()]
        if vfs.isdir(bdir):
            for f in sorted(vfs.listdir(bdir), reverse=True):
                if re.match(r"^ws-\d{8}\.zip$", f):
                    p = os.path.join(bdir, f)
                    out.append({"name": f, "size": vfs.getsize(p), "t": int(vfs.getmtime(p) * 1000)})
        return out

    def _backup_zip(self, name):
        if not re.match(r"^ws-\d{8}\.zip$", str(name or "")):
            return None
        p = os.path.join(self.dir, "_backups", name)
        return p if vfs.isfile(p) else None

    def backup_projects(self, user, name):
        if self.snap is not None and not str(name or "").startswith("ws-"):
            mf = self.snap.find(name)[0]
            if not mf:
                return None
            pre = "data/users/%s/projects/" % _user_folder(user)
            out = []
            for rel, rd in self.snap.entries(mf).items():          # (v151) DB 사본 안 문서까지
                if rel.startswith(pre) and rel.endswith("/project.json") and rel.count("/") == 5:
                    try:
                        m = json.loads(rd().decode("utf-8"))
                    except (ValueError, OSError):
                        continue
                    out.append({"pid": rel.split("/")[4], "name": m.get("name"), "updated": m.get("updated")})
            return out
        p = self._backup_zip(name)
        if not p:
            return None
        pre = "users/%s/projects/" % _user_folder(user)
        out = []
        with zipfile.ZipFile(p) as z:
            for n in z.namelist():
                if n.startswith(pre) and n.endswith("/project.json") and n.count("/") == 4:
                    try:
                        m = json.loads(z.read(n).decode("utf-8"))
                    except ValueError:
                        continue
                    out.append({"pid": n.split("/")[3], "name": m.get("name"), "updated": m.get("updated")})
        return out

    def backup_restore(self, user, name, pid):
        if self.snap is not None and not str(name or "").startswith("ws-"):
            mf = self.snap.find(name)[0]
            if not mf or not SAFE_ID.match(str(pid or "")):
                return False
            pre = "data/users/%s/projects/%s/" % (_user_folder(user), pid)
            ents = self.snap.entries(mf)                             # (v151) DB 사본 안 문서까지
            names = [r for r in ents if r.startswith(pre)]
            if pre + "project.json" not in names:
                return False
            cur = self.pdir(user, pid)
            if vfs.isdir(cur):
                dst = os.path.join(self.dir, "_trash", _user_folder(user), pid + "-restore-" + datetime.now().strftime("%Y%m%d%H%M%S"))
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                vfs.move(cur, dst)
            for rel in names:
                safeio.atomic_bytes(os.path.join(self.dir, *rel[5:].split("/")), ents[rel]())
            self._log(user, pid, {"kind": "project", "action": "restore", "name": name})
            return True
        p = self._backup_zip(name)
        if not p or not SAFE_ID.match(str(pid or "")):
            return False
        pre = "users/%s/projects/%s/" % (_user_folder(user), pid)
        base = os.path.abspath(self.dir) + os.sep
        with zipfile.ZipFile(p) as z:
            names = [n for n in z.namelist() if n.startswith(pre) and not n.endswith("/")]
            if not names or not any(n == pre + "project.json" for n in names):
                return False
            for n in names:
                if not os.path.abspath(os.path.join(self.dir, n)).startswith(base):
                    return False
            cur = self.pdir(user, pid)
            if vfs.isdir(cur):
                dst = os.path.join(self.dir, "_trash", _user_folder(user), pid + "-restore-" + datetime.now().strftime("%Y%m%d%H%M%S"))
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                vfs.move(cur, dst)
            for n in names:
                t = os.path.join(self.dir, n)
                os.makedirs(os.path.dirname(t), exist_ok=True)
                with z.open(n) as src, open(t, "wb") as out:
                    shutil.copyfileobj(src, out)
        self._log(user, pid, {"kind": "project", "action": "restore", "name": name})
        return True

    def backup_now(self):
        if self.snap is not None:
            r = self.snap.make(force=True)
            if not r.get("ok"):
                raise RuntimeError("깨진 파일이 있어 백업하지 않았습니다: " + ", ".join(b["path"] for b in r.get("bad", [])[:3]) if r.get("bad") else "다른 백업이 진행 중입니다")
            return True
        self._backup_if_new_day(force=True)
        return True


# ---------------------------------------------------------------------------
# (v105) 논문 작업실 — tex* 동작. mid = 원고 작업 공간(기본 w). 컴파일만 관리자(TeX 엔진이 절대 경로로 PC 파일을 읽을 수 있어서)
# ---------------------------------------------------------------------------
# (v178) 공유받은 사람은 못 하는 동작 — 프로젝트 목록·휴지통·지우기·되살리기·백업·폴더 연결·계정 상태·공유 관리·전체 이력
SHARE_OWNER_ONLY = {"projects", "ptrash", "prestore", "trash", "backups", "backupitems", "backuprestore", "backup", "folder_link", "master_add", "master_sync",
                    "master_remove", "master_include", "masters", "browse", "mirror", "state", "state_archive", "state_history", "state_restore", "timeline",
                    "share", "shares", "share_targets", "bundle"}
TEX_GET = {"texview", "texassets", "texsearch", "texsync", "texpage", "texpdf", "texasset", "doctrash", "docpath"}
TEX_POST = {"tex", "texasset", "texmv", "texcp", "texrm", "teximport", "texzip", "texexport", "rexport", "rimport", "docrm", "docrestore"}
SL_GET = {"sdecks", "sdeck", "sversions", "sasset", "strash"}      # (v112) 발표자료 작업실 — tools/slide_api.py
SL_POST = {"sdeck", "sversion", "srm", "srestore", "sasset", "sexport", "simport"}


def _sl_get(handler, ws, user, pid, op, g):
    pd = ws.pdir(user, pid) if pid else None
    if not pd or not vfs.isdir(pd): return handler._json(404, {"ok": False, "message": "프로젝트 없음"})
    did = g("did")
    if op == "sdecks": return handler._json(200, {"ok": True, "list": slide_api.list_decks(pd)})
    if op == "strash": return handler._json(200, {"ok": True, "list": slide_api.trash_list(pd)})
    if op == "sasset":
        p = slide_api.asset_path(pd, g("name"))
        if not p: return handler._json(404, {"ok": False, "message": "그림 없음"})
        with open(p, "rb") as fh: data = fh.read()
        return _tex_send(handler, data, slide_api.IMG_TYPES.get(g("name").rsplit(".", 1)[-1], "application/octet-stream"), cache="private, max-age=31536000, immutable")
    if not SAFE_ID.match(did or ""): return handler._json(400, {"ok": False, "message": "잘못된 발표자료 id"})
    if op == "sdeck":
        d = slide_api.get(pd, did)
        return handler._json(200 if d else 404, {"ok": bool(d), "deck": d, "message": None if d else "발표자료가 없어요"})
    if op == "sversions": return handler._json(200, {"ok": True, "list": slide_api.versions(pd, did)})
    return handler._json(404, {"ok": False, "message": "없는 동작"})


def _sl_post(handler, ws, user, pid, op, g, body_json):
    pd = ws.pdir(user, pid) if pid else None
    if not pd or not vfs.isdir(pd): return handler._json(404, {"ok": False, "message": "프로젝트 없음"})
    did = g("did")
    def raw(limit):
        n = int(handler.headers.get("Content-Length") or 0)
        if n <= 0 or n > limit: return None
        return handler.rfile.read(n)
    if op == "sasset":
        data = raw(slide_api.MAX_ASSET)
        if data is None: return handler._json(413, {"ok": False, "message": "그림은 16MB 까지예요"})
        try: return handler._json(200, {"ok": True, "name": slide_api.asset_put(pd, data, g("ext"))})
        except ValueError as e: return handler._json(400, {"ok": False, "message": str(e)})
    if op == "simport":
        data = raw(120 * 1024 * 1024)
        if data is None: return handler._json(413, {"ok": False, "message": "120MB 까지만 불러올 수 있어요"})
        try: d = slide_api.from_pptx(data, pd)
        except Exception as e: return handler._json(200, {"ok": False, "message": "PPTX 를 읽지 못했어요: %s" % str(e)[:160]})
        name = re.sub(r"\.pptx$", "", g("name") or "", flags=re.I)[:80]
        deck = {"title": d.get("title") or name or "불러온 발표자료", "theme": "clean", "minutes": 10, "aud": "", "footer": False, "runs": [], "slides": d["slides"]}
        nid = _uid("d")
        slide_api.put(pd, nid, deck)
        return handler._json(200, {"ok": True, "id": nid, "n": len(d["slides"])})
    if op == "srestore":
        r = slide_api.restore(pd, g("tid"))
        return handler._json(200 if r else 404, {"ok": bool(r), "id": r, "message": None if r else "되살릴 발표자료가 없어요"})
    if not SAFE_ID.match(did or ""): return handler._json(400, {"ok": False, "message": "잘못된 발표자료 id"})
    if op == "sdeck":
        b = body_json(24 * 1024 * 1024)
        if not isinstance(b, dict): return handler._json(400, {"ok": False, "message": "발표자료가 비었거나 너무 커요(24MB)"})
        r = slide_api.put(pd, did, b)
        if r.get("conflict"):
            return handler._json(409, {"ok": False, "error": "conflict", "message": "다른 탭이나 기기에서 먼저 저장했어요."})
        return handler._json(200, dict(r, ok=True))
    if op == "sversion":
        if g("v"):
            d = slide_api.load_version(pd, did, g("v"))
            return handler._json(200 if d else 404, {"ok": bool(d), "deck": d, "message": None if d else "없는 버전"})
        b = body_json() or {}
        v = slide_api.save_version(pd, did, b.get("note"))
        return handler._json(200 if v else 404, {"ok": bool(v), "v": v, "message": None if v else "발표자료가 없어요"})
    if op == "srm": return handler._json(200, {"ok": slide_api.trash(pd, did)})
    if op == "sexport":
        b = body_json(24 * 1024 * 1024) or {}
        name = _safe_name((str(b.get("title") or "발표자료"))[:80]) + ".pptx"
        odir = os.path.join(pd, "out"); os.makedirs(odir, exist_ok=True)
        path = os.path.join(odir, name)
        try: slide_api.to_pptx(b, pd, path)
        except ImportError: return handler._json(200, {"ok": False, "message": "python-pptx 가 없어요(pip install python-pptx)"})
        except Exception as e: return handler._json(200, {"ok": False, "message": str(e)[:200]})
        logkit.activity("ws.slides.export", user=user, ip=handler.client_address[0], src="server", pid=pid, name=name[:120], size=vfs.getsize(path))
        return handler._json(200, {"ok": True, "name": name, "size": vfs.getsize(path)})
    return handler._json(404, {"ok": False, "message": "없는 동작"})


def _tex_send(handler, data, ctype, name=None, cache="private, max-age=86400"):
    handler.send_response(200)
    handler.send_header("Content-Type", ctype)
    handler.send_header("Content-Length", str(len(data)))
    handler.send_header("Cache-Control", cache)
    handler.send_header("X-Content-Type-Options", "nosniff")
    handler.send_header("Content-Security-Policy", "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox")
    if name:
        from urllib.parse import quote
        handler.send_header("Content-Disposition", "inline; filename*=UTF-8''" + quote(name))
    handler.end_headers()
    handler.wfile.write(data)
    return None


def _tex_mid(g):
    mid = g("mid") or "w"
    return mid if SAFE_ID.match(mid) else None


def _tex_get(handler, ws, user, au, pid, op, g):
    mid = _tex_mid(g)
    pd = ws.pdir(user, pid) if pid else None
    if not mid or not pd or not vfs.isdir(pd): return handler._json(404, {"ok": False, "message": "프로젝트 없음"})
    if op == "doctrash": return handler._json(200, {"ok": True, "list": ws.doc_trash(user, pid)})
    if op == "docpath":   # (v108) 저장 위치 — 전체 경로는 관리자에게만
        did = g("did")
        if not SAFE_ID.match(did or ""): return handler._json(400, {"ok": False, "message": "잘못된 문서 id"})
        full = os.path.join(pd, "docs", did)
        return handler._json(200, {"ok": True, "rel": "projects/" + pid + "/docs/" + did, "abs": full if (au or {}).get("role") == "admin" else None, "out": os.path.join(pd, "out") if (au or {}).get("role") == "admin" else None})
    if op == "texview": return handler._json(200, tex_api.view_info(pd, mid))
    if op == "texassets": return handler._json(200, {"ok": True, "list": tex_api.assets(pd, mid)})
    if op == "texsearch": return handler._json(200, {"ok": True, "hits": tex_api.search(pd, mid, g("q")[:200])})
    if op == "texsync":
        try:
            if g("dir") == "back": r = tex_api.sync_backward(pd, mid, int(g("p", "1")), float(g("x", "0")), float(g("y", "0")))
            else: r = tex_api.sync_forward(pd, mid, g("file"), int(g("line", "1")))
        except ValueError: r = None
        return handler._json(200, {"ok": bool(r), "at": r})
    if op == "texpage":
        try: pn, wd = int(g("p", "1")), int(g("w", "1000"))
        except ValueError: pn, wd = 1, 1000
        data = tex_api.page(pd, mid, pn, wd)
        if not data: return handler._json(404, {"ok": False, "message": "없는 쪽"})
        return _tex_send(handler, data, "image/png")
    if op == "texpdf":
        p = tex_api.view_pdf(pd, mid)
        if not p: return handler._json(404, {"ok": False, "message": "아직 PDF 가 없어요"})
        with open(p, "rb") as fh: data = fh.read()
        logkit.activity("ws.tex.pdf", user=user, ip=handler.client_address[0], src="server", pid=pid)
        return _tex_send(handler, data, "application/pdf", _safe_name(g("name") or "paper.pdf"), cache="no-store")
    if op == "texasset":
        p = tex_api.asset_path(pd, mid, g("name"))
        if not p: return handler._json(404, {"ok": False, "message": "파일 없음"})
        ext = p.rsplit(".", 1)[-1].lower()
        ctype = docview.mime_of(ext)
        if ext == "svg" or ctype.startswith("text/html"): ctype = "text/plain; charset=utf-8" if not g("img") else "image/svg+xml"
        if g("png") and ext in ("pdf", "eps"):    # PDF 그림은 첫 쪽을 그림으로(바로 보기·그림 고르기용)
            if ext == "pdf":
                data = docview.page_png(p, os.path.join(tex_api.mdir(pd, mid), ".cache", "a-" + hashlib.sha1(g("name").encode("utf-8")).hexdigest()[:12]), 1, int(g("w", "600") or 600))
                if data: return _tex_send(handler, data, "image/png")
            return handler._json(404, {"ok": False})
        with open(p, "rb") as fh: data = fh.read()
        return _tex_send(handler, data, ctype, os.path.basename(p), cache="no-cache")
    return handler._json(404, {"ok": False, "message": "없는 동작"})


def _tex_post(handler, ws, user, au, pid, op, g, body_json):
    mid = _tex_mid(g)
    pd = ws.pdir(user, pid) if pid else None
    if not mid or not pd or not vfs.isdir(pd): return handler._json(404, {"ok": False, "message": "프로젝트 없음"})
    if op == "tex":
        if not tex_api.allowed(au):
            return handler._json(200, {"ok": False, "error": "admin_only", "message": "PDF 컴파일은 관리자 계정만 쓸 수 있어요(TeX 엔진이 이 PC 의 파일을 읽을 수 있어서). 바로 보기는 누구나 쓸 수 있어요."})
        b = body_json(10 * 1024 * 1024) or {}
        files = b.get("files") if isinstance(b.get("files"), dict) else {}
        res = tex_api.compile(pd, mid, files, str(b.get("main") or "main.tex"))
        logkit.activity("ws.tex", user=user, ip=handler.client_address[0], src="server", pid=pid, engine=res.get("engine"), ok=res.get("ok"), sec=res.get("sec"), errors=res.get("errors"))
        return handler._json(200, res)
    if op == "texasset":
        n = int(handler.headers.get("Content-Length") or 0)
        if n <= 0 or n > tex_api.MAX_ASSET: return handler._json(413, {"ok": False, "message": "파일 하나는 30MB 까지예요"})
        from urllib.parse import unquote
        meta, err = tex_api.asset_put(pd, mid, unquote(g("name")), handler.rfile.read(n))
        if err: return handler._json(400, {"ok": False, "message": err})
        logkit.activity("ws.tex.asset", user=user, ip=handler.client_address[0], src="server", pid=pid, name=meta["name"][:120], size=meta["size"])
        return handler._json(200, {"ok": True, "file": meta})
    if op == "texmv":
        b = body_json() or {}
        return handler._json(200, {"ok": True, "moved": tex_api.asset_move(pd, mid, b.get("from"), b.get("to"))})
    if op == "texcp":
        b = body_json() or {}
        return handler._json(200, {"ok": True, "copied": tex_api.asset_copy(pd, mid, b.get("from"), b.get("to"))})
    if op == "texrm":
        b = body_json() or {}
        return handler._json(200, {"ok": True, "removed": tex_api.asset_del(pd, mid, b.get("name"))})
    if op == "teximport":
        n = int(handler.headers.get("Content-Length") or 0)
        if n <= 0 or n > MAX_UPLOAD: return handler._json(413, {"ok": False, "message": "zip 은 80MB 까지예요"})
        res = tex_api.import_zip(pd, mid, handler.rfile.read(n), g("prefix"))
        logkit.activity("ws.tex.import", user=user, ip=handler.client_address[0], src="server", pid=pid, files=len(res.get("files") or {}), assets=len(res.get("assets") or []))
        return handler._json(200, res)
    if op == "texzip":
        b = body_json(10 * 1024 * 1024) or {}
        name, size = tex_api.export_zip(pd, mid, b.get("files") if isinstance(b.get("files"), dict) else {}, b.get("name"))
        return handler._json(200, {"ok": True, "name": name, "size": size})
    if op == "docrm":
        did = g("did")
        if not SAFE_ID.match(did or ""): return handler._json(400, {"ok": False, "message": "잘못된 문서 id"})
        return handler._json(200, {"ok": ws.trash_doc(user, pid, did)})
    if op == "docrestore":
        did = ws.restore_doc(user, pid, g("tid"))
        return handler._json(200 if did else 404, {"ok": bool(did), "did": did, "message": None if did else "되살릴 문서가 없어요"})
    if op == "rimport":   # (v108) Word(.docx) → 편집기 HTML
        n = int(handler.headers.get("Content-Length") or 0)
        if n <= 0 or n > 30 * 1024 * 1024: return handler._json(413, {"ok": False, "message": "30MB 까지만 불러올 수 있어요"})
        try:
            r = report_api.from_docx(handler.rfile.read(n))
        except Exception as e:
            return handler._json(200, {"ok": False, "message": "Word 파일을 읽지 못했어요: %s" % e})
        return handler._json(200, dict(r, ok=True))
    if op == "rexport":   # (v106) 보고서 작업실 HTML → Word
        b = body_json(24 * 1024 * 1024) or {}
        try:
            data = report_api.to_docx(str(b.get("html") or ""), str(b.get("title") or "")[:200], b.get("style") if isinstance(b.get("style"), dict) else {})
        except Exception as e:
            return handler._json(200, {"ok": False, "message": "Word 로 만들지 못했어요: %s" % e})
        name = _safe_name((str(b.get("name") or b.get("title") or "보고서"))[:80]) + ".docx"
        odir = os.path.join(pd, "out"); os.makedirs(odir, exist_ok=True)
        with open(os.path.join(odir, name), "wb") as fh: fh.write(data)
        logkit.activity("ws.report.export", user=user, ip=handler.client_address[0], src="server", pid=pid, name=name[:120], size=len(data))
        return handler._json(200, {"ok": True, "name": name, "size": len(data)})
    if op == "texexport":
        b = body_json() or {}
        name = tex_api.export_pdf(pd, mid, b.get("name"))
        return handler._json(200 if name else 404, {"ok": bool(name), "name": name, "message": None if name else "아직 PDF 가 없어요 — 먼저 컴파일하세요"})
    return handler._json(404, {"ok": False, "message": "없는 동작"})


# ---------------------------------------------------------------------------
# HTTP 어댑터 (serve.py 가 부른다)
# ---------------------------------------------------------------------------
def handle(ws, handler, q, method):
    """q: parse_qs 결과(dict of list). 응답은 handler._json 으로 보낸다. 파일 다운로드만 직접 쓴다."""
    g = lambda k, d="": (q.get(k) or [d])[0]
    op = g("op")
    au = getattr(handler, "auth_user", None)            # (v92) 계정은 서버 세션에서만 — X-Study-User 헤더는 믿지 않는다
    user = au["id"] if au else ""
    pid = g("pid"); did = g("did"); fid = g("fid")
    if pid and not SAFE_ID.match(pid): return handler._json(400, {"ok": False, "message": "잘못된 프로젝트 id"})
    if did and not SAFE_ID.match(did): return handler._json(400, {"ok": False, "message": "잘못된 문서 id"})
    if fid and not SAFE_ID.match(fid): return handler._json(400, {"ok": False, "message": "잘못된 자료 id"})

    def body_json(limit=MAX_JSON):
        n = int(handler.headers.get("Content-Length") or 0)
        if n <= 0 or n > limit: return None
        try: return json.loads(handler.rfile.read(n).decode("utf-8", "replace"))
        except ValueError: return None

    # (v178) data-owner/1 — 다른 계정 프로젝트는 소유자가 공유한 것만, 공유받은 권한(보기·편집) 안에서만.
    #   owner 를 붙인 요청 = 공유받은 프로젝트. 권한이 없으면 있는지조차 알리지 않는다(404).
    owner = g("owner")
    shared = None
    _ACT.by = None
    if user and owner and owner != user:
        perm = ws.share_perm(owner, pid, user) if SAFE_ID.match(owner) and pid else None
        if not perm:
            return handler._json(404, {"ok": False, "message": "프로젝트를 찾지 못했어요."})
        if op in SHARE_OWNER_ONLY:
            return handler._json(403, {"ok": False, "message": "프로젝트 소유자만 할 수 있어요."})
        if method != "GET" and perm != "edit":
            return handler._json(403, {"ok": False, "message": "보기만 공유받은 프로젝트예요."})
        shared = {"owner": owner, "perm": perm, "actor": user}
        handler._ws_actor = user
        _ACT.by = user
        user = owner

    if user and not shared and op in ("shares", "share_targets", "share"):
        if op == "share_targets":
            me = au["id"]
            lst = [{"id": x["id"], "name": x.get("name") or x.get("display") or x.get("username"), "username": x.get("username")}
                   for x in ((ACCOUNTS() if ACCOUNTS else []) or []) if x.get("id") != me and x.get("status", "active") != "locked"]
            return handler._json(200, {"ok": True, "list": lst})
        if not pid or not ws.project_meta(user, pid):
            return handler._json(404, {"ok": False, "message": "프로젝트를 찾지 못했어요."})
        if op == "shares":
            names = {x["id"]: (x.get("name") or x.get("display") or x.get("username")) for x in ((ACCOUNTS() if ACCOUNTS else []) or [])}
            return handler._json(200, {"ok": True, "list": [dict(v, uid=k, name=names.get(k, k)) for k, v in ws.shares(user, pid).items()]})
        if method != "POST":
            return handler._json(405, {"ok": False, "message": "POST 로 보내 주세요."})
        b = body_json() or {}
        tgt, perm = str(b.get("target") or ""), b.get("perm")
        ok_t = any(x.get("id") == tgt and x.get("status", "active") != "locked" for x in ((ACCOUNTS() if ACCOUNTS else []) or []))
        if not SAFE_ID.match(tgt) or tgt == user or not ok_t or perm not in ("view", "edit", None):
            return handler._json(422, {"ok": False, "message": "공유할 계정이나 권한이 올바르지 않아요."})
        ws.set_share(user, pid, tgt, perm, user)
        logkit.audit("data_share" if perm else "data_unshare", user=user, pid=pid, target=tgt, perm=perm)
        return handler._json(200, {"ok": True, "list": [dict(v, uid=k) for k, v in ws.shares(user, pid).items()]})

    if method == "GET":
        if op == "health": return handler._json(200, ws.health())
        if op == "texinfo":
            exe, eng = tex_engine()
            return handler._json(200, {"ok": True, "engine": eng, "allowed": tex_api.allowed(au), "warm": bool(exe) and tex_api.warm()})
        if not user: return handler._json(401, {"ok": False, "message": "계정 이름이 없어요(로그인)"})
        if op in TEX_GET: return _tex_get(handler, ws, user, au, pid, op, g)
        if op in SL_GET: return _sl_get(handler, ws, user, pid, op, g)
        if op == "projects":
            lst = ws.projects(user)
            if PROJECT_EXTRA:      # (v138, G9) 기간을 붙여 화면이 '진행 중 먼저·마감 가까운 순'으로 세운다
                for m in lst:
                    try:
                        m.update(PROJECT_EXTRA(user, m.get("id")) or {})
                    except Exception:
                        pass
            names = None
            for (ow, spid, perm) in ws.shared_with(user):       # (v178) 공유받은 프로젝트 — 소유자 이름·권한을 붙인다(공유 목록은 내주지 않는다)
                m = ws.project_meta(ow, spid)
                if not m:
                    continue
                if names is None:
                    names = {x["id"]: (x.get("name") or x.get("display") or x.get("username")) for x in ((ACCOUNTS() if ACCOUNTS else []) or [])}
                m = {k: v for k, v in m.items() if k not in ("shares", "source", "hidden", "removed", "archived", "group")}
                m.update(owner=ow, ownerName=names.get(ow, ow), perm=perm, shared=True, group="공유받은 프로젝트")
                if PROJECT_EXTRA:
                    try:
                        m.update(PROJECT_EXTRA(ow, spid) or {})
                    except Exception:
                        pass
                lst.append(m)
            for m in lst:
                if not m.get("shared") and m.get("shares"):
                    m["sharedN"] = len(m["shares"])
                    m.pop("shares", None)
            return handler._json(200, {"ok": True, "list": lst})
        if op == "ptrash": return handler._json(200, {"ok": True, "list": ws.project_trash(user)})
        if op == "files": return handler._json(200, {"ok": True, "list": ws.files(user, pid)})
        if op == "text": return handler._json(200, {"ok": True, "text": ws.file_text(user, pid, fid)})
        if op == "events": return handler._json(200, {"ok": True, "list": ws.events(user, pid, int(g("limit", "300")), g("kind") or None, int(g("since", "0")))})
        if op in ("backups", "backupitems"):
            if not au or au.get("role") != "admin": return handler._json(403, {"ok": False, "message": "관리자만 할 수 있어요."})
            if op == "backups": return handler._json(200, {"ok": True, "list": ws.backups()})
            ls = ws.backup_projects(user, g("name"))
            return handler._json(200 if ls is not None else 404, {"ok": ls is not None, "list": ls or []})
        if op == "timeline": return handler._json(200, {"ok": True, "list": ws.all_events(user, int(g("limit", "400")))})
        if op == "docs": return handler._json(200, {"ok": True, "list": ws.docs(user, pid)})
        if op == "doc":
            d = ws.doc(user, pid, did, int(g("v")) if g("v") else None)
            return handler._json(200 if d else 404, {"ok": bool(d), "doc": d})
        if op == "versions": return handler._json(200, {"ok": True, "list": ws.doc_versions(user, pid, did)})
        if op == "outputs": return handler._json(200, {"ok": True, "list": ws.outputs(user, pid)})
        if op == "state":
            st = ws.state_load(user, g("name") or None)
            if g("meta"):
                return handler._json(200, {"ok": True, "saved": st and st.get("saved"), "device": st and st.get("device"), "keys": st and len((st.get("user") or {})) + len((st.get("global") or {}))})
            return handler._json(200, {"ok": True, "state": st})
        if op == "tree":
            return handler._json(200, dict(ws.tree(user, pid), ok=True))
        if op == "masters":
            return handler._json(200, {"ok": True, "list": ws.masters(user)})
        if op == "browse":
            if (au or {}).get("role") != "admin": return handler._json(403, {"ok": False, "message": "폴더 연결은 관리자만 할 수 있어요(서버 PC 의 디스크를 읽기 때문)."})
            return handler._json(200, dict(ws.browse(g("path")), ok=True))
        if op == "state_history":
            return handler._json(200, {"ok": True, "list": ws.state_history(user)})
        if op in ("file", "out", "doc") and not (handler.headers.get("Range") or "").startswith("bytes=") or (handler.headers.get("Range") or "").startswith("bytes=0-"):
            if op in ("file", "out", "doc"):   # 영상·소리의 이어 받기(Range)는 첫 요청만 감사에 남긴다
                logkit.activity("ws.open." + op, user=user, ip=handler.client_address[0], src="server", pid=pid or None, did=did or None, fid=fid or None, name=g("name")[:80] or None, v=g("v") or None)
        if op in ("view", "page", "words", "ptext", "search"):   # (v98) 자료 보기 — 어떤 형식이든
            path, meta = ws.file_path(user, pid, fid)
            if not path or not vfs.isfile(path): return handler._json(404, {"ok": False, "message": "파일 없음"})
            ext = ((meta or {}).get("ext") or path.rsplit(".", 1)[-1]).lower()
            cache = ws._fcache(user, pid, fid)
            os.makedirs(os.path.dirname(cache), exist_ok=True)
            if op == "view":
                if op == "view" and g("print") and docview.kind_of(ext) == "sheet":
                    docview.office_pdf(path, cache)
                d = docview.describe(path, ext, cache)
                st = vfs.stat(path)
                d.update(ok=True, name=(meta or {}).get("name"), size=st.st_size, mtime=int(st.st_mtime * 1000))
                if docview.kind_of(ext) == "sheet" and vfs.exists(cache + ".view.pdf"):
                    pdfp, stt, _ = docview.office_pdf(path, cache)
                    d.update(print_state=stt, pdf=docview.pdf_info(pdfp) if pdfp else None)
                return handler._json(200, d)
            pdf = docview.view_pdf(path, ext, cache)
            if not pdf: return handler._json(409, {"ok": False, "message": "아직 쪽 그림을 만들 수 없어요(변환 중이거나 쪽이 없는 형식)"})
            if op == "ptext": return handler._json(200, {"ok": True, "pages": docview.page_texts(pdf, cache)})
            if op == "search": return handler._json(200, {"ok": True, "hits": docview.search_pdf(pdf, g("q")[:200])})
            try: pn = int(g("p", "1"))
            except ValueError: pn = 1
            if op == "words":
                w = docview.page_words(pdf, pn)
                return handler._json(200 if w else 404, dict(w or {}, ok=bool(w)))
            try: wd = int(g("w", "1000"))
            except ValueError: wd = 1000
            data = docview.page_png(pdf, cache, pn, wd)
            if not data: return handler._json(404, {"ok": False, "message": "없는 쪽"})
            handler.send_response(200)
            handler.send_header("Content-Type", "image/png"); handler.send_header("Content-Length", str(len(data)))
            handler.send_header("Cache-Control", "private, max-age=86400"); handler.send_header("X-Content-Type-Options", "nosniff")
            handler.end_headers(); handler.wfile.write(data)
            return None
        if op == "mirror":
            m = ws.mirror_load(user)
            return handler._json(200, {"ok": True, "saved": m and m.get("saved"), "data": m and m.get("data")})
        if op in ("file", "out"):
            if op == "file":
                path, meta = ws.file_path(user, pid, fid); name = meta and meta["name"]
            else:
                name = _safe_name(g("name")); path = os.path.join(ws.pdir(user, pid), "out", name)
            if not path or not vfs.isfile(path): return handler._json(404, {"ok": False, "message": "파일 없음"})
            ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
            ctype = docview.mime_of(ext)
            if ctype.startswith("text/html") or ext == "svg":
                ctype = "text/plain; charset=utf-8" if not g("inline") else ctype     # HTML·SVG 는 내려받기로(바로 열면 스크립트가 돌 수 있어 sandbox iframe 에서만)
            size = vfs.getsize(path)
            start, end, code = 0, size - 1, 200
            rng = handler.headers.get("Range") or ""
            m = re.match(r"bytes=(\d*)-(\d*)$", rng.strip())
            if m and size:                                    # (v98) 영상·소리 이어 받기 · 건너뛰기
                if m.group(1): start = int(m.group(1)); end = int(m.group(2)) if m.group(2) else size - 1
                elif m.group(2): start = max(0, size - int(m.group(2)))
                end = min(end, size - 1)
                if start > end: 
                    handler.send_response(416); handler.send_header("Content-Range", "bytes */%d" % size); handler.end_headers(); return None
                code = 206
            from urllib.parse import quote
            handler.send_response(code)
            handler.send_header("Content-Type", ctype)
            handler.send_header("Accept-Ranges", "bytes")
            handler.send_header("Content-Length", str(end - start + 1))
            if code == 206: handler.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, size))
            handler.send_header("Content-Disposition", ("inline" if g("inline") else "attachment") + "; filename*=UTF-8''" + quote(name))
            handler.send_header("X-Content-Type-Options", "nosniff")
            handler.end_headers()
            try:
                with open(path, "rb") as fh:
                    fh.seek(start); left = end - start + 1
                    while left > 0:
                        chunk = fh.read(min(262144, left))
                        if not chunk: break
                        handler.wfile.write(chunk); left -= len(chunk)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass                                          # 보던 영상을 건너뛰면 브라우저가 끊는다 — 정상
            return None
        return handler._json(404, {"ok": False, "message": "없는 동작"})

    # ---- 쓰기 ----
    if handler.headers.get("X-Study-Vault") != "1": return handler._json(403, {"ok": False, "message": "헤더 없음"})
    if not user: return handler._json(401, {"ok": False, "message": "계정 이름이 없어요(로그인)"})
    if op not in ("state", "mirror"):   # (v92) 서버 쪽 조작 감사(거울·상태 동기화는 잦아서 제외 — 상태 저장은 요약 1줄) — 모든 저장소 쓰기(상태 동기화는 너무 잦아 따로 요약)
        logkit.activity("ws." + op, user=user, ip=handler.client_address[0], src="server", pid=pid or None, did=did or None, fid=fid or None,
                        fmt=g("fmt") or None, name=g("name")[:80] or None)
    if op == "state":
        n = int(handler.headers.get("Content-Length") or 0)
        if n <= 0 or n > MAX_STATE: return handler._json(413, {"ok": False, "message": "상태가 너무 커요(%dMB 초과)" % (MAX_STATE // 1048576)})
        try: b = json.loads(handler.rfile.read(n).decode("utf-8", "replace"))
        except ValueError: return handler._json(400, {"ok": False, "message": "JSON 아님"})
        r = ws.state_save(user, b)
        logkit.activity("state.save", user=user, ip=handler.client_address[0], src="server", keys=r.get("keys"), bytes=n, device=str(b.get("device") or "")[:40], reason=str(b.get("reason") or "")[:20])
        return handler._json(200, r)
    if op in ("folder_link", "master_add", "master_sync", "master_remove", "master_include"):
        if (au or {}).get("role") != "admin": return handler._json(403, {"ok": False, "message": "폴더 연결은 관리자만 할 수 있어요(서버 PC 의 디스크를 읽기 때문)."})
        b = body_json() or {}
        if op == "folder_link":
            meta, err = ws.folder_link(user, b.get("path"), name=b.get("name"), pid=pid or None)
            return handler._json(200 if meta else 400, {"ok": bool(meta), "project": meta, "message": err})
        if op == "master_add":
            r, err = ws.master_add(user, b.get("path"))
            return handler._json(200 if r else 400, dict(r or {}, ok=bool(r), message=err))
        if op == "master_sync":
            return handler._json(200, dict(ws.master_sync(user, b.get("id") or ""), ok=True))
        if op == "master_include":
            return handler._json(200, dict(ws.master_include(user, b.get("id") or "", b.get("path") or ""), ok=True))
        return handler._json(200, {"ok": ws.master_remove(user, b.get("id") or "")})
    if op == "bundle":   # (v93) 프로젝트 묶음 — 자료·문서 전 버전·이력·내보낸 파일을 zip 하나로(out/ 에 남기고 내려받기)
        pd = ws.pdir(user, pid)
        if not pid or not vfs.isdir(pd): return handler._json(404, {"ok": False, "message": "프로젝트가 없어요"})
        name = _safe_name(((ws.project_meta(user, pid) or {}).get("name") or pid)[:60]) + "-" + datetime.now().strftime("%Y%m%d-%H%M") + ".zip"
        outd = os.path.join(pd, "out"); os.makedirs(outd, exist_ok=True); target = os.path.join(outd, name)
        with zipfile.ZipFile(target + ".tmp", "w", zipfile.ZIP_DEFLATED) as z:
            for base, dirs, files in vfs.walk(pd):
                dirs[:] = [d for d in dirs if d != "fcache"]
                for f in files:
                    if f.endswith(".tmp") or (os.path.normcase(base) == os.path.normcase(outd) and f.endswith(".zip")): continue
                    full = os.path.join(base, f); vfs.zwrite(z, full, os.path.relpath(full, pd))
        vfs.replace(target + ".tmp", target)
        return handler._json(200, {"ok": True, "name": name, "size": vfs.getsize(target)})
    if op == "state_archive":   # (v92) 계정 상태를 받아 덮기 전에 이 브라우저 상태를 보관(되돌릴 수 있게) — current 는 바꾸지 않는다
        n = int(handler.headers.get("Content-Length") or 0)
        if n <= 0 or n > MAX_STATE: return handler._json(413, {"ok": False, "message": "너무 커요"})
        try: b = json.loads(handler.rfile.read(n).decode("utf-8", "replace"))
        except ValueError: return handler._json(400, {"ok": False, "message": "JSON 아님"})
        name = ws.state_archive(user, b)
        logkit.activity("state.archive", user=user, ip=handler.client_address[0], src="server", name=name, device=str(b.get("device") or "")[:40], reason=str(b.get("reason") or "")[:20])
        return handler._json(200, {"ok": True, "name": name})
    if op == "state_restore":
        r = ws.state_restore(user, g("name"))
        logkit.activity("state.restore", user=user, ip=handler.client_address[0], src="server", name=g("name"), ok=bool(r))
        return handler._json(200 if r else 404, {"ok": bool(r), "saved": r and r.get("saved")})
    if op == "project":
        b = body_json() or {}
        if shared:      # (v178) 편집 공유는 이름·목표·태그만 — 숨김·폴더·연결 같은 소유자 설정은 그대로
            b = dict({k: b[k] for k in ("name", "goal", "tags") if k in b}, id=pid)
        return handler._json(200, {"ok": True, "project": ws.save_project(user, b)})
    if op == "trash": return handler._json(200, {"ok": ws.trash_project(user, pid)})
    if op == "prestore":
        r = ws.restore_project(user, g("tid"))
        return handler._json(200 if r else 404, {"ok": bool(r), "pid": r, "message": None if r else "되살릴 프로젝트가 없어요(같은 프로젝트가 이미 있거나 휴지통에 없어요)"})
    if op == "upload":
        n = int(handler.headers.get("Content-Length") or 0)
        if n <= 0 or n > MAX_UPLOAD: return handler._json(413, {"ok": False, "message": "80MB 까지만 올릴 수 있어요"})
        if not vfs.isdir(ws.pdir(user, pid)): return handler._json(404, {"ok": False, "message": "프로젝트 없음"})
        from urllib.parse import unquote
        data = handler.rfile.read(n)
        meta = ws.upload(user, pid, unquote(g("name")) or "file", data)
        return handler._json(200, {"ok": True, "file": meta})
    if op == "rmfile": return handler._json(200, {"ok": ws.remove_file(user, pid, fid)})
    if op == "event":
        b = body_json(512 * 1024)
        if not isinstance(b, dict): return handler._json(400, {"ok": False, "message": "JSON 아님"})
        if not vfs.isdir(ws.pdir(user, pid)): return handler._json(404, {"ok": False, "message": "프로젝트 없음"})
        b.pop("t", None)
        return handler._json(200, {"ok": True, "event": ws._log(user, pid, b)})
    if op == "doc":
        b = body_json()
        if not isinstance(b, dict): return handler._json(400, {"ok": False, "message": "JSON 아님(또는 4MB 초과)"})
        if not vfs.isdir(ws.pdir(user, pid)): return handler._json(404, {"ok": False, "message": "프로젝트 없음"})
        rec = ws.save_doc(user, pid, did, b)
        if rec.get("conflict"):
            return handler._json(409, {"ok": False, "error": "conflict", "v": rec["v"], "message": "다른 탭이나 기기에서 먼저 저장했어요(v%d)." % rec["v"]})
        return handler._json(200, {"ok": True, "doc": rec})
    if op in TEX_POST: return _tex_post(handler, ws, user, au, pid, op, g, body_json)
    if op in SL_POST: return _sl_post(handler, ws, user, pid, op, g, body_json)
    if op == "export":
        res, err = ws.export(user, pid, did, g("fmt", "html"), int(g("v")) if g("v") else None)
        if err: return handler._json(400, {"ok": False, "message": err})
        return handler._json(200, {"ok": True, "name": res["name"], "size": res["size"]})
    if op == "mirror":
        b = body_json(16 * 1024 * 1024)
        if b is None: return handler._json(400, {"ok": False, "message": "JSON 아님(또는 16MB 초과)"})
        return handler._json(200, {"ok": True, "saved": ws.mirror_save(user, b)})
    if op == "backup": return handler._json(200, {"ok": ws.backup_now()})
    if op == "backuprestore":
        if not au or au.get("role") != "admin": return handler._json(403, {"ok": False, "message": "관리자만 할 수 있어요."})
        b = body_json() or {}
        ok = ws.backup_restore(user, b.get("name"), b.get("pid"))
        logkit.audit("backup_restore", ok=ok, user=user, zip=b.get("name"), pid=b.get("pid"))
        return handler._json(200 if ok else 404, {"ok": ok, "message": None if ok else "백업에서 그 프로젝트를 찾지 못했어요."})
    return handler._json(404, {"ok": False, "message": "없는 동작"})
