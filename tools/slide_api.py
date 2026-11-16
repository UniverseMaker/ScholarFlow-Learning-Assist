# -*- coding: utf-8 -*-
"""slide_api.py (v112) — 🎬 발표자료 작업실 서버 쪽.

프로젝트 폴더 안에 둔다(폴더 복사 = 이사).
    projects/<pid>/slides/<deck>/current.json        지금 발표자료(슬라이드·요소·대본)
    projects/<pid>/slides/<deck>/versions/<n>.json   저장한 버전
    projects/<pid>/slides/_assets/<해시>.<확장자>     그림(같은 그림은 한 번만)
    projects/<pid>/slides/_trash/<deck>~<시각>/       지운 발표자료(되살리기)

PPTX 는 python-pptx 로 그림이 아니라 진짜 도형·글상자·표·차트로 만든다(파워포인트에서 고칠 수 있게).
색·꾸밈은 브라우저(slidekit.js exportDeck)가 풀어서 보내므로 여기서는 테마를 모른다.
"""
import safeio   # (v140) 정전 대비 쓰기
import vfs      # noqa: E402  (v151) SQLite 엔진이면 데이터 폴더의 .json·.jsonl 은 DB — 아래 open·exists 등은 vfs 판
open = vfs.open  # noqa: A001
import base64
import hashlib
import io
import json
import os
import re
import shutil
import time
from datetime import datetime

SAFE = re.compile(r"^[A-Za-z0-9_\-]{1,64}$")
ASSET = re.compile(r"^[0-9a-f]{24}\.(png|jpg|jpeg|gif|webp)$")
IMG_TYPES = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif", "webp": "image/webp"}
MAX_ASSET = 16 * 1024 * 1024
PX = 9525                      # 1280×720 좌표 1px = 9525 EMU(13.33×7.5 인치)
FONT = "맑은 고딕"


def _now():
    return int(time.time() * 1000)


def _atomic(path, obj):
    safeio.atomic_json(path, obj)


def _read(path, default=None):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return default


def _root(pd):
    return os.path.join(pd, "slides")


def _ddir(pd, did):
    return os.path.join(_root(pd), did)


def _meta(c, did):
    sl = c.get("slides") or []
    return {"id": did, "title": c.get("title") or "제목 없음", "theme": c.get("theme"), "n": len(sl), "updated": c.get("updated") or 0,
            "created": c.get("created") or 0, "minutes": c.get("minutes"), "first": sl[0] if sl else None, "folder": c.get("folder") or ""}


def list_decks(pd):
    base = _root(pd)
    out = []
    if vfs.isdir(base):
        for d in vfs.listdir(base):
            if d.startswith("_") or not SAFE.match(d):
                continue
            c = _read(os.path.join(base, d, "current.json"))
            if c:
                m = _meta(c, d)
                m["versions"] = _count_versions(pd, d)
                out.append(m)
    out.sort(key=lambda m: -(m.get("updated") or 0))
    return out


def _count_versions(pd, did):
    v = os.path.join(_ddir(pd, did), "versions")
    try:
        return sum(1 for f in vfs.listdir(v) if f.endswith(".json"))
    except OSError:
        return 0


def get(pd, did):
    return _read(os.path.join(_ddir(pd, did), "current.json"))


def put(pd, did, deck):
    cur = get(pd, did) or {}
    deck = dict(deck)
    base = deck.pop("ifUpdated", None)   # (v124) 동시 수정 감지 — 내가 읽은 시각과 다르면 저장하지 않는다
    if base is not None and cur.get("updated") and base != cur["updated"]:
        return {"conflict": True, "updated": cur["updated"]}
    deck["id"] = did
    deck["created"] = cur.get("created") or deck.get("created") or _now()
    deck["updated"] = _now()
    _atomic(os.path.join(_ddir(pd, did), "current.json"), deck)
    return {"id": did, "updated": deck["updated"]}


def save_version(pd, did, note=""):
    c = get(pd, did)
    if not c:
        return None
    vdir = os.path.join(_ddir(pd, did), "versions")
    os.makedirs(vdir, exist_ok=True)
    n = max([int(f[:-5]) for f in vfs.listdir(vdir) if f.endswith(".json") and f[:-5].isdigit()] or [0]) + 1
    rec = dict(c, _v=n, _t=_now(), _note=str(note or "")[:120])
    _atomic(os.path.join(vdir, "%d.json" % n), rec)
    for f in sorted([f for f in vfs.listdir(vdir) if f.endswith(".json") and f[:-5].isdigit()], key=lambda x: int(x[:-5]))[:-60]:
        try:
            vfs.remove(os.path.join(vdir, f))     # 슬라이드 버전은 60개까지만(이 폴더 안의 사본만 지운다)
        except OSError:
            pass
    return n


def versions(pd, did):
    vdir = os.path.join(_ddir(pd, did), "versions")
    out = []
    if vfs.isdir(vdir):
        for f in vfs.listdir(vdir):
            if f.endswith(".json") and f[:-5].isdigit():
                c = _read(os.path.join(vdir, f))
                if c:
                    out.append({"v": c.get("_v"), "t": c.get("_t"), "note": c.get("_note"), "n": len(c.get("slides") or []), "title": c.get("title")})
    out.sort(key=lambda x: -(x.get("v") or 0))
    return out


def load_version(pd, did, v):
    try:
        return _read(os.path.join(_ddir(pd, did), "versions", "%d.json" % int(v)))
    except (TypeError, ValueError):
        return None


def trash(pd, did):
    src = _ddir(pd, did)
    if not vfs.isdir(src):
        return False
    tdir = os.path.join(_root(pd), "_trash")
    os.makedirs(tdir, exist_ok=True)
    vfs.move(src, os.path.join(tdir, did + "~" + datetime.now().strftime("%Y%m%d%H%M%S")))
    return True


def trash_list(pd):
    base = os.path.join(_root(pd), "_trash")
    out = []
    if vfs.isdir(base):
        for tid in vfs.listdir(base):
            c = _read(os.path.join(base, tid, "current.json"))
            m = re.search(r"~(\d{14})$", tid)
            if c and m:
                x = _meta(c, tid.split("~")[0])
                x["tid"] = tid
                x["trashed"] = int(datetime.strptime(m.group(1), "%Y%m%d%H%M%S").timestamp() * 1000)
                out.append(x)
    out.sort(key=lambda x: -x["trashed"])
    return out


def restore(pd, tid):
    if not re.match(r"^[A-Za-z0-9_\-]{1,64}~\d{14}$", str(tid or "")):
        return None
    src = os.path.join(_root(pd), "_trash", tid)
    if not vfs.isdir(src):
        return None
    did = tid.split("~")[0]
    dst = _ddir(pd, did)
    if vfs.exists(dst):
        did = did[:40] + "r" + datetime.now().strftime("%H%M%S")
        dst = _ddir(pd, did)
        c = _read(os.path.join(src, "current.json"), {}) or {}
        c["id"] = did
        _atomic(os.path.join(src, "current.json"), c)
    vfs.move(src, dst)
    return did


# ---------------------------------------------------------------- 그림
def asset_put(pd, data, ext):
    ext = str(ext or "").lower().strip(".")
    if ext not in IMG_TYPES:
        raise ValueError("PNG·JPG·GIF·WEBP 그림만 넣을 수 있어요")
    if not data or len(data) > MAX_ASSET:
        raise ValueError("그림은 16MB 까지예요")
    name = hashlib.sha1(data).hexdigest()[:24] + "." + ext
    d = os.path.join(_root(pd), "_assets")
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, name)
    if not vfs.exists(p):
        with open(p + ".tmp", "wb") as fh:
            fh.write(data)
        vfs.replace(p + ".tmp", p)
    return name


def asset_path(pd, name):
    if not ASSET.match(str(name or "")):
        return None
    p = os.path.join(_root(pd), "_assets", name)
    return p if vfs.isfile(p) else None


# ---------------------------------------------------------------- PPTX 내보내기
def _rgb(c):
    from pptx.dml.color import RGBColor
    c = str(c or "").lstrip("#")
    if len(c) == 3:
        c = "".join(x * 2 for x in c)
    if not re.match(r"^[0-9a-fA-F]{6}$", c):
        c = "111827"
    return RGBColor.from_string(c.upper())


def _alpha(fill_fmt, a):
    """python-pptx 에 투명도 API 가 없어 XML 로 넣는다."""
    if a is None or a >= 1:
        return
    from lxml import etree
    ns = "http://schemas.openxmlformats.org/drawingml/2006/main"
    el = fill_fmt._xPr.find("{%s}solidFill" % ns)
    if el is not None and len(el):
        for old in el[0].findall("{%s}alpha" % ns):
            el[0].remove(old)
        x = etree.SubElement(el[0], "{%s}alpha" % ns)
        x.set("val", str(int(max(0, min(1, a)) * 100000)))


def _fill(shape_fill, f):
    if not f or f == "none":
        shape_fill.background()
        return
    if isinstance(f, dict) and f.get("g"):
        shape_fill.gradient()
        shape_fill.gradient_angle = (90 - (f.get("angle", 135) or 0)) % 360     # CSS: 위쪽 0°·시계 방향 → PPT: 오른쪽 0°·반시계 방향
        st = shape_fill.gradient_stops
        st[0].color.rgb = _rgb(f["g"][0])
        st[0].position = 0
        st[1].color.rgb = _rgb(f["g"][-1])
        st[1].position = 1
        return
    c = f.get("c") if isinstance(f, dict) else f
    shape_fill.solid()
    shape_fill.fore_color.rgb = _rgb(c)
    if isinstance(f, dict):
        _alpha(shape_fill, f.get("a"))


def _font(run, st):
    from lxml import etree
    from pptx.util import Pt
    f = run.font
    f.name = st.get("font") or FONT
    rpr = run._r.get_or_add_rPr()
    ns = "http://schemas.openxmlformats.org/drawingml/2006/main"
    for tag in ("ea", "cs"):
        x = rpr.find("{%s}%s" % (ns, tag))
        if x is None:
            x = etree.SubElement(rpr, "{%s}%s" % (ns, tag))
        x.set("typeface", st.get("font") or FONT)
    if st.get("fs"):
        f.size = Pt(round(float(st["fs"]) * 0.75 * 2) / 2)     # px → pt
    if st.get("b") is not None:
        f.bold = bool(st["b"])
    if st.get("i"):
        f.italic = True
    if st.get("u"):
        f.underline = True
    if st.get("color"):
        f.color.rgb = _rgb(st["color"])
        if st.get("op") is not None and st["op"] < 1:
            c = rpr.find("{%s}solidFill" % ns)
            if c is not None and len(c):
                etree.SubElement(c[0], "{%s}alpha" % ns).set("val", str(int(st["op"] * 100000)))


def _bullet(p, kind, level, fs):
    from lxml import etree
    ns = "http://schemas.openxmlformats.org/drawingml/2006/main"
    ppr = p._p.get_or_add_pPr()
    ind = int(float(fs or 24) * 1.15 * PX)
    ppr.set("marL", str(ind * (level + 1)))
    ppr.set("indent", str(-ind))
    if kind == "num":
        b = etree.SubElement(ppr, "{%s}buAutoNum" % ns)
        b.set("type", "arabicPeriod")
    else:
        b = etree.SubElement(ppr, "{%s}buChar" % ns)
        b.set("char", "•" if level == 0 else "–")


def _text(tf, e):
    """e.paras = [{runs:[{t,b,i,u,color,fs}], bullet, level, align}]"""
    from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
    from pptx.util import Emu, Pt
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = Emu(int(e.get("px", 0) * PX))
    tf.margin_top = tf.margin_bottom = Emu(int(e.get("py", 0) * PX))
    tf.vertical_anchor = {"top": MSO_ANCHOR.TOP, "middle": MSO_ANCHOR.MIDDLE, "bottom": MSO_ANCHOR.BOTTOM}.get(e.get("valign") or "top", MSO_ANCHOR.TOP)
    AL = {"left": PP_ALIGN.LEFT, "center": PP_ALIGN.CENTER, "right": PP_ALIGN.RIGHT, "justify": PP_ALIGN.JUSTIFY}
    paras = e.get("paras") or [{"runs": []}]
    for i, pa in enumerate(paras):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        al = pa.get("align") or e.get("align")
        if al in AL:
            p.alignment = AL[al]
        if e.get("lh"):
            p.line_spacing = float(e["lh"])
        for r in pa.get("runs") or []:
            run = p.add_run()
            run.text = str(r.get("t") or "")
            st = {"fs": r.get("fs") or e.get("fs"), "b": r.get("b") if r.get("b") is not None else e.get("b"), "i": r.get("i") or e.get("i"),
                  "u": r.get("u"), "color": r.get("color") or e.get("color"), "op": e.get("op")}
            _font(run, st)
        if pa.get("bullet"):
            _bullet(p, pa["bullet"], int(pa.get("level") or 0), e.get("fs"))
            p.space_after = Pt(float(e.get("fs") or 24) * 0.75 * 0.32)


def _shape_kind(k):
    from pptx.enum.shapes import MSO_SHAPE as M
    return {"rect": M.RECTANGLE, "round": M.ROUNDED_RECTANGLE, "oval": M.OVAL, "tri": M.ISOSCELES_TRIANGLE, "diamond": M.DIAMOND,
            "arrow": M.RIGHT_ARROW, "chevron": M.CHEVRON, "pent": M.PENTAGON, "callout": M.RECTANGULAR_CALLOUT, "star": M.STAR_5_POINT}.get(k, M.RECTANGLE)


def _box(e):
    from pptx.util import Emu
    return Emu(int(e.get("x", 0) * PX)), Emu(int(e.get("y", 0) * PX)), Emu(int(max(1, e.get("w", 10)) * PX)), Emu(int(max(1, e.get("h", 10)) * PX))


def _add_el(sl, e, pd):
    from pptx.chart.data import CategoryChartData
    from pptx.enum.chart import XL_CHART_TYPE, XL_LEGEND_POSITION
    from pptx.enum.shapes import MSO_CONNECTOR
    from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
    from pptx.util import Emu, Pt
    t = e.get("type")
    x, y, w, h = _box(e)
    sh = None
    if t == "text":
        sh = sl.shapes.add_textbox(x, y, w, h)
        _text(sh.text_frame, e)
        if e.get("fill"):
            _fill(sh.fill, e["fill"])
    elif t == "shape":
        sh = sl.shapes.add_shape(_shape_kind(e.get("shape")), x, y, w, h)
        if e.get("shape") == "round" and len(sh.adjustments):
            sh.adjustments[0] = max(0.0, min(0.5, float(e.get("radius", 16)) / max(1.0, min(e.get("w", 10), e.get("h", 10)))))
        _fill(sh.fill, e.get("fill"))
        if e.get("stroke"):
            sh.line.color.rgb = _rgb(e["stroke"])
            sh.line.width = Pt(float(e.get("sw", 1)) * 0.75)
        else:
            sh.line.fill.background()
        sh.shadow.inherit = False
        if e.get("paras"):
            _text(sh.text_frame, dict(e, valign=e.get("valign") or "middle"))
    elif t == "line":
        c = sl.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, x, y, Emu(int((e.get("x", 0) + e.get("w", 10)) * PX)), Emu(int((e.get("y", 0) + e.get("h", 0)) * PX)))
        c.line.color.rgb = _rgb(e.get("stroke"))
        c.line.width = Pt(float(e.get("sw", 2)) * 0.75)
        return
    elif t == "image":
        src = str(e.get("src") or "")
        pth = None
        if src.startswith("asset:"):
            pth = asset_path(pd, src[6:])
        elif src.startswith("data:image"):
            pth = io.BytesIO(base64.b64decode(src.split(",", 1)[1]))
        if not pth:
            return
        sh = sl.shapes.add_picture(pth, x, y, w, h)
    elif t == "table":
        rows = e.get("rows") or [[""]]
        nr, nc = len(rows), max(len(r) for r in rows)
        gf = sl.shapes.add_table(nr, nc, x, y, w, h)
        tb = gf.table
        for ci, cw in enumerate(e.get("cols") or []):
            if ci < nc:
                tb.columns[ci].width = Emu(int(float(cw) * PX))
        for ri, row in enumerate(rows):
            tb.rows[ri].height = Emu(int(e.get("h", 200) / nr * PX))
            for ci in range(nc):
                c = tb.cell(ri, ci)
                val = row[ci] if ci < len(row) else ""
                head = ri == 0 and e.get("head", True)
                c.fill.solid()
                c.fill.fore_color.rgb = _rgb(e.get("headFill") if head else (e.get("zebra") if ri % 2 == 0 and e.get("zebra") else e.get("cellFill") or "#ffffff"))
                c.vertical_anchor = MSO_ANCHOR.MIDDLE
                c.margin_left = c.margin_right = Emu(12 * PX)
                tf = c.text_frame
                tf.word_wrap = True
                p = tf.paragraphs[0]
                if head:
                    p.alignment = PP_ALIGN.CENTER
                r = p.add_run()
                r.text = str(val)
                _font(r, {"fs": e.get("fs") or 18, "b": bool(head), "color": e.get("headInk") if head else e.get("color")})
    elif t == "chart":
        ch = e.get("chart") or {}
        cd = CategoryChartData()
        cd.categories = [str(x) for x in (ch.get("labels") or [])]
        for s in ch.get("series") or []:
            cd.add_series(str(s.get("name") or ""), [float(v or 0) for v in (s.get("vals") or [])])
        kind = {"col": XL_CHART_TYPE.COLUMN_CLUSTERED, "bar": XL_CHART_TYPE.BAR_CLUSTERED, "line": XL_CHART_TYPE.LINE_MARKERS, "pie": XL_CHART_TYPE.PIE,
                "doughnut": XL_CHART_TYPE.DOUGHNUT}.get(ch.get("type"), XL_CHART_TYPE.COLUMN_CLUSTERED)
        gf = sl.shapes.add_chart(kind, x, y, w, h, cd)
        c = gf.chart
        c.has_title = False
        c.font.size = Pt(float(e.get("fs") or 16) * 0.75)
        c.font.name = FONT
        if e.get("color"):
            c.font.color.rgb = _rgb(e["color"])
        many = len(ch.get("series") or []) > 1 or ch.get("type") in ("pie", "doughnut")
        c.has_legend = many
        if many:
            c.legend.position = XL_LEGEND_POSITION.BOTTOM
            c.legend.include_in_layout = False
        pal = e.get("pal") or []
        pl = c.plots[0]
        if ch.get("type") not in ("pie", "doughnut"):
            va = c.value_axis
            va.minimum_scale = 0
            va.has_major_gridlines = True
            va.major_gridlines.format.line.color.rgb = _rgb(e.get("grid") or "#e2e8f0")
            va.format.line.fill.background()
            c.category_axis.format.line.color.rgb = _rgb(e.get("grid") or "#e2e8f0")
            pl.has_data_labels = True
            pl.data_labels.show_value = True
            pl.data_labels.font.size = Pt(float(e.get("fs") or 16) * 0.65)
            pl.data_labels.font.bold = True
        if ch.get("type") in ("pie", "doughnut"):
            pl.has_data_labels = True
            pl.data_labels.show_percentage = True
            pl.data_labels.show_value = False
            for i in range(len(ch.get("labels") or [])):
                pt = pl.series[0].points[i]
                pt.format.fill.solid()
                pt.format.fill.fore_color.rgb = _rgb(pal[i % len(pal)] if pal else "#2563eb")
        else:
            for i, s in enumerate(pl.series):
                col = pal[i % len(pal)] if pal else "#2563eb"
                if ch.get("type") == "line":
                    s.format.line.color.rgb = _rgb(col)
                    s.format.line.width = Pt(2.25)
                    s.smooth = False
                else:
                    s.format.fill.solid()
                    s.format.fill.fore_color.rgb = _rgb(col)
        return
    if sh is not None:
        if e.get("r"):
            sh.rotation = float(e["r"])


def to_pptx(deck, pd, path):
    from pptx import Presentation
    from pptx.util import Emu
    prs = Presentation()
    prs.slide_width = Emu(1280 * PX)
    prs.slide_height = Emu(720 * PX)
    blank = prs.slide_layouts[6]
    prs.core_properties.title = str(deck.get("title") or "")[:200]
    for s in deck.get("slides") or []:
        sl = prs.slides.add_slide(blank)
        bg = s.get("bg")
        if bg:
            _fill(sl.background.fill, bg)
        for e in s.get("els") or []:
            try:
                _add_el(sl, e, pd)
            except Exception as ex:                  # 요소 하나가 잘못돼도 나머지는 내보낸다
                print("[slide_api] 요소 건너뜀:", e.get("type"), ex)
        if s.get("note"):
            sl.notes_slide.notes_text_frame.text = str(s["note"])
        if s.get("hidden"):
            sl._element.set("show", "0")
    prs.save(path)


# ---------------------------------------------------------------- PPTX 불러오기
def _para_html(p):
    out = []
    for r in p.runs:
        t = (r.text or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        if not t:
            continue
        if r.font.bold:
            t = "<b>" + t + "</b>"
        if r.font.italic:
            t = "<i>" + t + "</i>"
        out.append(t)
    return "".join(out)


def _first_size(tf, default):
    for p in tf.paragraphs:
        for r in p.runs:
            if r.font.size:
                return round(r.font.size.pt / 0.75)
    return default


def _first_color(tf):
    for p in tf.paragraphs:
        for r in p.runs:
            try:
                if r.font.color and r.font.color.type is not None and r.font.color.rgb is not None:
                    return "#" + str(r.font.color.rgb)
            except (AttributeError, TypeError):
                pass
    return None


def _walk(shapes):
    from pptx.enum.shapes import MSO_SHAPE_TYPE
    for sh in shapes:
        if sh.shape_type == MSO_SHAPE_TYPE.GROUP:
            for x in _walk(sh.shapes):
                yield x
        else:
            yield sh


def from_pptx(data, pd):
    from pptx import Presentation
    from pptx.enum.shapes import MSO_SHAPE_TYPE
    prs = Presentation(io.BytesIO(data))
    k = 1280.0 / prs.slide_width
    oy = max(0.0, (720 - prs.slide_height * k) / 2)
    slides = []
    uid = 0

    def nid():
        nonlocal uid
        uid += 1
        return "i%d" % uid
    for sl in prs.slides:
        els = []
        title = sl.shapes.title if sl.shapes.title is not None else None
        for sh in _walk(sl.shapes):
            try:
                x, y, w, h = sh.left, sh.top, sh.width, sh.height
                if x is None or w is None:
                    continue
                box = {"id": nid(), "x": round(x * k), "y": round(y * k + oy), "w": max(10, round(w * k)), "h": max(10, round(h * k))}
                if sh.shape_type == MSO_SHAPE_TYPE.PICTURE:
                    name = asset_put(pd, sh.image.blob, sh.image.ext)
                    els.append(dict(box, type="image", src="asset:" + name))
                elif getattr(sh, "has_table", False) and sh.has_table:
                    rows = [[c.text for c in r.cells] for r in sh.table.rows]
                    els.append(dict(box, type="table", rows=rows, fs=18))
                elif getattr(sh, "has_chart", False) and sh.has_chart:
                    c = sh.chart
                    p0 = c.plots[0]
                    els.append(dict(box, type="chart", fs=16, chart={"type": "col", "labels": [str(x) for x in p0.categories], "series": [{"name": s.name, "vals": [v or 0 for v in s.values]} for s in p0.series]}))
                elif sh.has_text_frame and sh.text_frame.text.strip():
                    tf = sh.text_frame
                    is_t = title is not None and sh.shape_id == title.shape_id
                    paras = [_para_html(p) for p in tf.paragraphs]
                    bul = len([p for p in paras if p]) > 1 and not is_t
                    html = "<ul>" + "".join("<li>" + p + "</li>" for p in paras if p) + "</ul>" if bul else "".join("<p>" + (p or "<br>") + "</p>" for p in paras)
                    el = dict(box, type="text", html=html, fs=_first_size(tf, 40 if is_t else 24), b=bool(is_t))
                    if is_t:
                        el["role"] = "title"
                    col = _first_color(tf)
                    if col:
                        el["color"] = col
                    els.append(el)
            except Exception as ex:
                print("[slide_api] 불러오기 건너뜀:", ex)
        note = ""
        try:
            if sl.has_notes_slide:
                note = sl.notes_slide.notes_text_frame.text or ""
        except Exception:
            pass
        slides.append({"id": "s%d" % (len(slides) + 1), "layout": "free", "els": els, "note": note})
    return {"slides": slides, "title": prs.core_properties.title or ""}
