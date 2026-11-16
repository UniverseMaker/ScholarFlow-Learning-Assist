# -*- coding: utf-8 -*-
"""(v106) 보고서 작업실 서버 — 편집기의 HTML 을 Word(DOCX) 로.

편집기(app-html/report.js)는 블록 HTML(h1~h4·p·ul/ol(개조식 포함)·표(figure.rp-table)·그림(figure.rp-fig, data URL)·상자(div.rp-box)·
인용·구분선·쪽 나눔·차례·각주)을 쓴다. 이것을 python-docx 로 그대로 옮긴다(글꼴·크기·줄 간격·여백·쪽 번호·제목 번호는 style 로).
"""
import base64
import io
import re
from html.parser import HTMLParser

VOID = {"br", "img", "hr", "input", "meta", "link", "col", "wbr"}


class _Node:
    __slots__ = ("tag", "attrs", "kids", "text", "parent")

    def __init__(self, tag, attrs=None, parent=None, text=None):
        self.tag, self.attrs, self.kids, self.text, self.parent = tag, dict(attrs or {}), [], text, parent

    def cls(self):
        return (self.attrs.get("class") or "").split()

    def all_text(self):
        if self.tag == "#text":
            return self.text or ""
        if self.tag == "br":
            return "\n"
        return "".join(k.all_text() for k in self.kids)


class _P(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = _Node("root")
        self.cur = self.root

    def handle_starttag(self, tag, attrs):
        n = _Node(tag, attrs, self.cur)
        self.cur.kids.append(n)
        if tag not in VOID:
            self.cur = n

    def handle_startendtag(self, tag, attrs):
        self.cur.kids.append(_Node(tag, attrs, self.cur))

    def handle_endtag(self, tag):
        n = self.cur
        while n is not None and n.tag != tag:
            n = n.parent
        if n is not None and n.parent is not None:
            self.cur = n.parent

    def handle_data(self, data):
        self.cur.kids.append(_Node("#text", parent=self.cur, text=data))


def parse(html):
    p = _P()
    p.feed(html or "")
    return p.root


def _color(v):
    v = (v or "").strip()
    m = re.match(r"#([0-9a-fA-F]{6})$", v)
    if m:
        return m.group(1)
    m = re.match(r"#([0-9a-fA-F]{3})$", v)
    if m:
        return "".join(c * 2 for c in m.group(1))
    m = re.match(r"rgba?\((\d+),\s*(\d+),\s*(\d+)", v)
    if m:
        return "%02x%02x%02x" % tuple(int(x) for x in m.groups())
    return None


def _style(node):
    st = {}
    for part in (node.attrs.get("style") or "").split(";"):
        if ":" in part:
            k, v = part.split(":", 1)
            st[k.strip().lower()] = v.strip()
    return st


def from_docx(data):
    """(v108) Word(.docx) → 편집기 블록 HTML — 제목·문단·굵게/기울임/밑줄·목록·표·그림."""
    import html as H
    from docx import Document
    from docx.table import Table
    from docx.text.paragraph import Paragraph
    d = Document(io.BytesIO(data))
    out, title, lst = [], "", []

    def flush():
        if lst:
            out.append("<ul>" + "".join("<li>" + x + "</li>" for x in lst) + "</ul>")
            del lst[:]

    def inline(p):
        h, imgs = "", []
        for r in p.runs:
            t = H.escape(r.text or "").replace("\n", "<br>")
            if r.bold: t = "<b>" + t + "</b>" if t else t
            if r.italic: t = "<i>" + t + "</i>" if t else t
            if r.underline: t = "<u>" + t + "</u>" if t else t
            h += t
            for rid in r._r.xpath(".//a:blip/@r:embed"):
                part = d.part.related_parts.get(rid)
                if part is not None and str(part.content_type).startswith("image/") and str(part.content_type).split("/")[1] in ("png", "jpeg", "jpg", "gif", "bmp"):
                    imgs.append("data:%s;base64,%s" % (part.content_type, base64.b64encode(part.blob).decode("ascii")))
        return h, imgs

    for el in d.element.body.iterchildren():
        tag = el.tag.rsplit("}", 1)[-1]
        if tag == "tbl":
            flush()
            t = Table(el, d)
            rows = []
            for ri, r in enumerate(t.rows):
                seen, cells = set(), []
                for c in r.cells:
                    if id(c._tc) in seen:
                        continue
                    seen.add(id(c._tc))
                    tg = "th" if ri == 0 else "td"
                    cells.append("<%s>%s</%s>" % (tg, "<br>".join(inline(p)[0] for p in c.paragraphs if p.text.strip()) or "<br>", tg))
                rows.append("<tr>" + "".join(cells) + "</tr>")
            out.append('<figure class="rp-table"><figcaption>표 제목</figcaption><table>' + "".join(rows) + "</table></figure>")
            continue
        if tag != "p":
            continue
        p = Paragraph(el, d)
        name = (p.style.name if p.style is not None else "") or ""
        h, imgs = inline(p)
        m = re.match(r"^(?:Heading|제목)\s*(\d)", name)
        if name.lower() == "title" or name == "제목":
            if not title and p.text.strip():
                title = p.text.strip()
                continue
        is_list = name.startswith("List") or name.startswith("목록") or bool(el.xpath("./w:pPr/w:numPr"))
        if is_list and h.strip():
            lst.append(h)
        else:
            flush()
            if m and h.strip():
                lv = min(4, max(1, int(m.group(1))))
                out.append("<h%d>%s</h%d>" % (lv, h, lv))
            elif h.strip():
                al = {1: "center", 2: "right", 3: "justify"}.get(int(p.alignment) if p.alignment is not None else 0)
                out.append("<p%s>%s</p>" % (' style="text-align:%s"' % al if al else "", h))
        for u in imgs:
            flush()
            out.append('<figure class="rp-fig"><img src="%s" data-w="80" style="width:80%%" alt=""><figcaption>그림 설명</figcaption></figure>' % u)
    flush()
    return {"html": "".join(out) or "<p><br></p>", "title": title}


def to_docx(html, title="", style=None):
    from docx import Document
    from docx.enum.section import WD_ORIENT
    from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.shared import Pt, Mm, RGBColor, Inches

    style = style or {}
    doc = Document()
    sec = doc.sections[0]
    sec.page_width, sec.page_height = Mm(210), Mm(297)
    if style.get("landscape"):
        sec.orientation = WD_ORIENT.LANDSCAPE
        sec.page_width, sec.page_height = Mm(297), Mm(210)
    m = float(style.get("margin") or 20)
    sec.left_margin = sec.right_margin = Mm(m)
    sec.top_margin = sec.bottom_margin = Mm(max(12, m - 2))
    font = style.get("font") or "맑은 고딕"
    size = float(style.get("size") or 11)
    lh = float(style.get("line") or 1.6)
    normal = doc.styles["Normal"]
    normal.font.name = font
    normal.font.size = Pt(size)
    rpr = normal.element.get_or_add_rPr()
    rf = rpr.find(qn("w:rFonts"))
    if rf is None:
        rf = OxmlElement("w:rFonts"); rpr.append(rf)
    for a in ("w:ascii", "w:hAnsi", "w:eastAsia", "w:cs"):
        rf.set(qn(a), font)
    normal.paragraph_format.line_spacing = lh
    normal.paragraph_format.space_after = Pt(4)
    for lv in range(1, 5):
        try:
            hs = doc.styles["Heading %d" % lv]
            hs.font.name = font
            hr = hs.element.get_or_add_rPr()
            f2 = hr.find(qn("w:rFonts"))
            if f2 is None:
                f2 = OxmlElement("w:rFonts"); hr.append(f2)
            for a in ("w:ascii", "w:hAnsi", "w:eastAsia", "w:cs"):
                f2.set(qn(a), font)
            hs.font.color.rgb = RGBColor(0x1F, 0x29, 0x37)
            hs.font.size = Pt({1: size + 7, 2: size + 4, 3: size + 2, 4: size + 1}[lv])
        except KeyError:
            pass
    if style.get("pageNum", True):
        fp = sec.footer.paragraphs[0]
        fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
        _field(fp, "PAGE", OxmlElement, qn)

    notes = []
    counters = {"tab": 0, "fig": 0}
    nums = [0, 0, 0, 0]
    numbering = style.get("numbering") or "none"
    GAE = ["□", "○", "-", "·"]
    ROM = ["Ⅰ", "Ⅱ", "Ⅲ", "Ⅳ", "Ⅴ", "Ⅵ", "Ⅶ", "Ⅷ", "Ⅸ", "Ⅹ"]
    HAN = "가나다라마바사아자차카타파하"

    def head_num(lv):
        nums[lv - 1] += 1
        for j in range(lv, 4):
            nums[j] = 0
        if numbering == "decimal":
            return (str(nums[0]) + ". ") if lv == 1 else ".".join(str(x) for x in nums[:lv]) + " "
        if numbering == "korean":
            n = nums[lv - 1]
            return [ROM[(n - 1) % 10] + ". ", str(n) + ". ", HAN[(n - 1) % 14] + ". ", str(n) + ") "][lv - 1]
        return ""

    def runs(par, node, fmt):
        for k in node.kids:
            if k.tag == "#text":
                t = k.text or ""
                if not t:
                    continue
                r = par.add_run(t)
                if fmt.get("b"): r.bold = True
                if fmt.get("i"): r.italic = True
                if fmt.get("u"): r.underline = True
                if fmt.get("s"): r.font.strike = True
                if fmt.get("sup"): r.font.superscript = True
                if fmt.get("sub"): r.font.subscript = True
                if fmt.get("code"): r.font.name = "Consolas"
                if fmt.get("color"): r.font.color.rgb = RGBColor.from_string(fmt["color"].upper())
                if fmt.get("hl"):
                    shd = OxmlElement("w:shd"); shd.set(qn("w:val"), "clear"); shd.set(qn("w:color"), "auto"); shd.set(qn("w:fill"), fmt["hl"].upper())
                    r._r.get_or_add_rPr().append(shd)
                if fmt.get("size"): r.font.size = Pt(fmt["size"])
                continue
            if k.tag == "br":
                par.add_run().add_break(); continue
            f = dict(fmt)
            if k.tag in ("b", "strong"): f["b"] = True
            if k.tag in ("i", "em"): f["i"] = True
            if k.tag == "u": f["u"] = True
            if k.tag in ("s", "strike", "del"): f["s"] = True
            if k.tag == "sup": f["sup"] = True
            if k.tag == "sub": f["sub"] = True
            if k.tag == "code": f["code"] = True
            if k.tag == "mark": f["hl"] = "FFF3A3"
            st = _style(k)
            c = _color(st.get("color")); bg = _color(st.get("background-color") or st.get("background"))
            if c: f["color"] = c
            if bg: f["hl"] = bg
            if st.get("font-weight") in ("bold", "700", "800"): f["b"] = True
            if k.tag == "font" and k.attrs.get("color"): f["color"] = _color(k.attrs.get("color")) or f.get("color")
            if "rp-fn" in k.cls():
                notes.append(k.attrs.get("data-note") or k.all_text())
                rr = par.add_run(str(len(notes))); rr.font.superscript = True
                continue
            if "rp-math" in k.cls():
                rr = par.add_run(k.attrs.get("data-tex") or k.all_text()); rr.italic = True; rr.font.name = "Cambria Math"
                continue
            if k.tag == "img":
                _pic(par, k, Inches)
                continue
            runs(par, k, f)

    def align(par, node):
        a = (_style(node).get("text-align") or node.attrs.get("align") or "").lower()
        if a == "center": par.alignment = WD_ALIGN_PARAGRAPH.CENTER
        elif a == "right": par.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        elif a == "justify": par.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY

    def list_items(node, level, ordered, gae):
        i = 0
        for li in node.kids:
            if li.tag != "li":
                continue
            i += 1
            par = doc.add_paragraph()
            par.paragraph_format.left_indent = Mm(6 + level * 7)
            par.paragraph_format.first_line_indent = Mm(-5)
            par.paragraph_format.space_after = Pt(2)
            mark = (GAE[min(level, 3)] + " ") if gae else (str(i) + ". " if ordered else "• ")
            if "rp-check" in node.cls() or li.attrs.get("data-check") is not None:
                mark = ("☑ " if li.attrs.get("data-check") == "1" else "☐ ")
            par.add_run(mark)
            inline = _Node("span", parent=li)
            inline.kids = [k for k in li.kids if k.tag not in ("ul", "ol")]
            runs(par, inline, {})
            for sub in li.kids:
                if sub.tag in ("ul", "ol"):
                    list_items(sub, level + 1, sub.tag == "ol", gae or "rp-gae" in sub.cls())

    def table(node, caption):
        rows = []
        for tr in _find_all(node, "tr"):
            rows.append([c for c in tr.kids if c.tag in ("td", "th")])
        if not rows:
            return
        ncol = max(sum(int(c.attrs.get("colspan") or 1) for c in r) for r in rows)
        if caption is not None:
            counters["tab"] += 1
            cp = doc.add_paragraph(); cp.alignment = WD_ALIGN_PARAGRAPH.CENTER
            rr = cp.add_run("<표 %d> " % counters["tab"]); rr.bold = True
            cp.add_run(caption)
        t = doc.add_table(rows=len(rows), cols=ncol)
        t.style = "Table Grid"
        for ri, r in enumerate(rows):
            ci = 0
            for c in r:
                span = int(c.attrs.get("colspan") or 1)
                if ci >= ncol:
                    break
                cell = t.cell(ri, ci)
                if span > 1 and ci + span - 1 < ncol:
                    cell = cell.merge(t.cell(ri, ci + span - 1))
                cell.text = ""
                p = cell.paragraphs[0]
                runs(p, c, {"b": c.tag == "th"})
                align(p, c)
                if c.tag == "th" or ri == 0 and "rp-nohead" not in node.cls():
                    tcPr = cell._tc.get_or_add_tcPr(); shd = OxmlElement("w:shd"); shd.set(qn("w:val"), "clear"); shd.set(qn("w:color"), "auto"); shd.set(qn("w:fill"), "E8EEF8"); tcPr.append(shd)
                ci += span
        doc.add_paragraph()

    def block(node):
        tag = node.tag
        cl = node.cls()
        if tag == "#text":
            if (node.text or "").strip():
                doc.add_paragraph(node.text.strip())
            return
        if tag in ("h1", "h2", "h3", "h4"):
            lv = int(tag[1])
            h = doc.add_heading(level=lv)
            if numbering != "none":
                h.add_run(head_num(lv))
            runs(h, node, {})
            return
        if tag == "p" or (tag == "div" and not cl and not any(k.tag in ("p", "h1", "h2", "h3", "ul", "ol", "table", "figure", "div") for k in node.kids)):
            par = doc.add_paragraph(); runs(par, node, {}); align(par, node); return
        if tag in ("ul", "ol"):
            list_items(node, 0, tag == "ol", "rp-gae" in cl); return
        if tag == "blockquote":
            par = doc.add_paragraph(); par.paragraph_format.left_indent = Mm(8); runs(par, node, {"i": True}); return
        if tag == "hr":
            par = doc.add_paragraph(); _border(par, OxmlElement, qn); return
        if "rp-pb" in cl:
            doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE); return
        if "rp-toc" in cl:
            par = doc.add_paragraph(); rr = par.add_run("차례"); rr.bold = True; rr.font.size = Pt(size + 3)
            _field(doc.add_paragraph(), 'TOC \\o "1-3" \\h \\z \\u', OxmlElement, qn, placeholder="(Word 에서 F9 를 누르면 차례가 채워져요)")
            return
        if tag == "figure" and ("rp-table" in cl or _find_all(node, "table")):
            cap = None
            for k in node.kids:
                if k.tag == "figcaption":
                    cap = k.all_text().strip()
            tb = _find_all(node, "table")
            if tb:
                table(tb[0], cap if cap is not None else "")
            return
        if tag == "table":
            table(node, None); return
        if tag == "figure":
            imgs = _find_all(node, "img")
            par = doc.add_paragraph(); par.alignment = WD_ALIGN_PARAGRAPH.CENTER
            for im in imgs:
                _pic(par, im, Inches)
            cap = [k for k in node.kids if k.tag == "figcaption"]
            counters["fig"] += 1
            cp = doc.add_paragraph(); cp.alignment = WD_ALIGN_PARAGRAPH.CENTER
            rr = cp.add_run("[그림 %d] " % counters["fig"]); rr.bold = True
            if cap:
                cp.add_run(cap[0].all_text().strip())
            return
        if tag == "div" and "rp-box" in cl:
            t = doc.add_table(rows=1, cols=1); t.style = "Table Grid"
            cell = t.cell(0, 0); cell.text = ""
            fill = {"note": "EEF4FF", "warn": "FFF4E5", "sum": "ECFDF5"}.get(node.attrs.get("data-kind") or "", "F3F4F6")
            tcPr = cell._tc.get_or_add_tcPr(); shd = OxmlElement("w:shd"); shd.set(qn("w:val"), "clear"); shd.set(qn("w:color"), "auto"); shd.set(qn("w:fill"), fill); tcPr.append(shd)
            first = True
            for k in node.kids:
                if k.tag == "#text" and not (k.text or "").strip():
                    continue
                p = cell.paragraphs[0] if first else cell.add_paragraph()
                first = False
                if k.tag in ("ul", "ol"):
                    for li in [x for x in k.kids if x.tag == "li"]:
                        p.add_run(("□ " if "rp-gae" in k.cls() else "• ") + li.all_text().strip())
                        p = cell.add_paragraph()
                else:
                    runs(p, k if k.tag != "#text" else _wrap(k), {"b": k.tag in ("h1", "h2", "h3", "h4", "b", "strong")})
            doc.add_paragraph()
            return
        for k in node.kids:
            block(k)

    if title:
        tp = doc.add_paragraph(); tp.alignment = WD_ALIGN_PARAGRAPH.CENTER
        rr = tp.add_run(title); rr.bold = True; rr.font.size = Pt(size + 9)
    for n in parse(html).kids:
        block(n)
    if notes:
        doc.add_paragraph()
        hp = doc.add_paragraph(); r = hp.add_run("주석"); r.bold = True
        for i, t in enumerate(notes):
            p = doc.add_paragraph(); rr = p.add_run(str(i + 1) + ") "); rr.font.superscript = False; p.add_run(t).font.size = Pt(size - 1.5)
    bio = io.BytesIO()
    doc.save(bio)
    return bio.getvalue()


def _wrap(n):
    w = _Node("span"); w.kids = [n]; return w


def _find_all(node, tag):
    out = []
    for k in node.kids:
        if k.tag == tag:
            out.append(k)
        out.extend(_find_all(k, tag))
    return out


def _pic(par, im, Inches):
    src = im.attrs.get("src") or ""
    m = re.match(r"data:image/(png|jpe?g|gif|bmp);base64,(.+)$", src, re.S)
    if not m:
        par.add_run("[그림]")
        return
    try:
        data = base64.b64decode(m.group(2))
        w = im.attrs.get("data-w") or ""
        frac = float(w) / 100.0 if re.match(r"^\d+(\.\d+)?$", w) else 0.9
        par.add_run().add_picture(io.BytesIO(data), width=Inches(6.3 * max(0.15, min(1.0, frac))))
    except Exception:
        par.add_run("[그림]")


def _field(par, instr, OxmlElement, qn, placeholder="1"):
    r = par.add_run()
    b = OxmlElement("w:fldChar"); b.set(qn("w:fldCharType"), "begin"); r._r.append(b)
    r2 = par.add_run()
    it = OxmlElement("w:instrText"); it.set(qn("xml:space"), "preserve"); it.text = instr; r2._r.append(it)
    r3 = par.add_run()
    s = OxmlElement("w:fldChar"); s.set(qn("w:fldCharType"), "separate"); r3._r.append(s)
    par.add_run(placeholder)
    r4 = par.add_run()
    e = OxmlElement("w:fldChar"); e.set(qn("w:fldCharType"), "end"); r4._r.append(e)


def _border(par, OxmlElement, qn):
    pPr = par._p.get_or_add_pPr()
    bdr = OxmlElement("w:pBdr")
    bt = OxmlElement("w:bottom"); bt.set(qn("w:val"), "single"); bt.set(qn("w:sz"), "6"); bt.set(qn("w:space"), "1"); bt.set(qn("w:color"), "9CA3AF")
    bdr.append(bt); pPr.append(bdr)
