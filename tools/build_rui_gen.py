# -*- coding: utf-8 -*-
"""style.css 의 하드코딩 색·그라디언트·그림자를 research-ui 토큰으로 옮긴 덮어쓰기 규칙을 만든다.

  python tools/build_rui_gen.py          → app-html/ui/rui-gen.css 를 다시 쓴다
  python tools/build_rui_gen.py --stats  → 쓰지 않고 접두사별 개수만 본다

· 원본 규칙과 특이성이 같도록 :where() 로 범위를 건다. 원본의 다른 규칙 우선순위를 뒤집지 않기 위해서다.
· 같은 선택자·같은 속성을 뒤에서 토큰 값으로 다시 정한 규칙이 있으면 앞 규칙은 만들지 않는다.
· 문서 내용·슬라이드·종이처럼 결과물 모습을 보여 주는 영역(KEEP)은 건드리지 않는다.
style.css 를 고쳤으면 다시 실행한다(bump-assets.py 가 부른다).
"""
import colorsys
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "app-html", "style.css")
OUT = os.path.join(ROOT, "app-html", "ui", "rui-gen.css")
SCOPE = ':where(html[data-app-theme="rui"])'

# 결과물 모습 그대로여야 하는 영역 — 슬라이드 내용, 보고서 종이, 테마 견본, 그림 팔레트
KEEP = re.compile(
    r"\.(ss-|dx-sk|dx-prog|dx-spin|dv-popset|sd-stage|sd-thumb|sd-slide|sd-canvas|sd-el|sd-show|sd-pres|sd-print|t-navy|t-green|t-warm|th-prev|th-card|rp-page|rp-paper|rp-ed|rp-dtitle|rp-sheet|rp-doc|rp-body|rp-sheet|rp-swatch|rp-color|sw-|hl-|dv-hl|dv-mark|dv-page|dv-text|dv-fm|dv-fl|dv-fi|dv-hit|dv-f|dv-fcur|dv-pg|dv-pages|pp2-pdf|pp-pdf|cm-|CodeMirror|mk-|gm-)"
)
SKIP_SEL = re.compile(r'\[data-theme=(?!"white")|\[data-layout="(sidebar|topnav|command)"\]|\[data-ui=|\[data-shell="command"\]|\[data-mode="light"\]\[data-theme')
PROPS_COLOR = {"color", "fill", "stroke", "caret-color", "accent-color", "-webkit-text-fill-color"}
PROPS_BG = {"background", "background-color"}
PROPS_LINE = {"border", "border-color", "border-top", "border-right", "border-bottom", "border-left", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color", "outline", "outline-color", "border-inline-start", "border-inline-end", "border-block-end", "border-block-start"}
HEX = r"#[0-9a-fA-F]{3,8}\b"
RGB = r"rgba?\([^()]*\)"
HSL = r"hsla?\([^()]*\)"
NAMED = r"(?<![w-])(?:white|black)(?![w-])"
COLOR = re.compile("(%s|%s|%s|%s)" % (HEX, RGB, HSL, NAMED))
FLOAT = re.compile(r"(menu|pop|modal|dialog|toast|drop|fab|tip|dock|panel|sheet|palette|float|dlg|scrim|-bar\b|pomo|chip-float|cmd)", re.I)


def parse(c):
    c = c.strip().lower()
    if c == "white":
        return 255, 255, 255, 1.0
    if c == "black":
        return 0, 0, 0, 1.0
    if c.startswith("#"):
        h = c[1:]
        if len(h) in (3, 4):
            h = "".join(x * 2 for x in h)
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        return r, g, b, (int(h[6:8], 16) / 255 if len(h) == 8 else 1.0)
    m = re.match(r"rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)", c)
    if m:
        a = m.group(4)
        al = 1.0 if a is None else (float(a[:-1]) / 100 if a.endswith("%") else float(a))
        return float(m.group(1)), float(m.group(2)), float(m.group(3)), al
    return None


def fam(rgb):
    """(무채색 여부, 계열, 명도)"""
    r, g, b = [x / 255 for x in rgb[:3]]
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    deg = h * 360
    chroma = max(r, g, b) - min(r, g, b)
    if chroma < 0.08 or (s < 0.14):
        return True, "ink", l
    if 75 <= deg < 172:
        return False, "ok", l
    if 22 <= deg < 62:
        return False, "warn", l
    if deg >= 340 or deg < 22:
        return False, "bad", l
    return False, "accent", l


def soft(f):
    return {"accent": "var(--rui-accent-soft)", "ok": "var(--rui-ok-soft)", "warn": "var(--rui-warn-soft)", "bad": "var(--rui-bad-soft)"}[f]


def solid(f):
    return {"accent": "var(--rui-accent)", "ok": "var(--rui-ok)", "warn": "var(--rui-warn)", "bad": "var(--rui-bad)"}[f]


def text(f):
    return {"accent": "var(--rui-accent-text)", "ok": "var(--rui-ok)", "warn": "var(--rui-warn)", "bad": "var(--rui-bad)"}[f]


def bg_token(c):
    p = parse(c)
    if not p:
        return None
    neutral, f, l = fam(p)
    a = p[3]
    if neutral:
        if l < .25 and a >= .28:
            return "keep"  # 어두운 막(스크림)·반투명 검정
        if a < .3:
            return "var(--rui-hover)"
        if l > .985:
            return "var(--rui-surface)"
        if l > .6:
            return "var(--rui-sunken)"
        return "var(--rui-ink)"
    if a < .5 or l > .8 or l < .2:
        return soft(f)
    return solid(f)


def fg_token(c, on_solid):
    p = parse(c)
    if not p:
        return None
    neutral, f, l = fam(p)
    if neutral:
        if l > .9:
            return "var(--rui-accent-ink)" if on_solid else "var(--rui-ink)"
        if l < .35:
            return "var(--rui-ink)"
        return "var(--rui-ink-2)"
    return text(f)


def line_token(c):
    p = parse(c)
    if not p:
        return None
    neutral, f, l = fam(p)
    if neutral:
        return "var(--rui-line)" if l > .72 else "var(--rui-line-strong)"
    return solid(f)


def split_top(s, ch=","):
    out, d, cur, q = [], 0, "", None
    for x in s:
        if q:
            cur += x
            if x == q:
                q = None
            continue
        if x in "\"'":
            q = x
        if x in "([":
            d += 1
        elif x in ")]":
            d -= 1
        if x == ch and d == 0:
            out.append(cur)
            cur = ""
        else:
            cur += x
    if cur.strip():
        out.append(cur)
    return out


def walk(s, ctx, rules):
    """{...} 를 훑어 (at규칙 문맥, 선택자, 선언문) 목록을 만든다."""
    i, n = 0, len(s)
    while i < n:
        j = s.find("{", i)
        if j < 0:
            return
        head = s[i:j].strip()
        d, k, q = 1, j + 1, None
        while k < n and d:
            ch = s[k]
            if q:
                if ch == "\\":
                    k += 1
                elif ch == q:
                    q = None
            elif ch in "\"'":
                q = ch
            elif ch == "{":
                d += 1
            elif ch == "}":
                d -= 1
            k += 1
        body = s[j + 1:k - 1]
        if head.startswith("@media") or head.startswith("@container") or head.startswith("@supports"):
            walk(body, ctx + [head], rules)
        elif head.startswith("@"):
            pass
        else:
            rules.append((tuple(ctx), head, body))
        i = k


def decls(body):
    out = []
    for d in split_top(body, ";"):
        if ":" not in d:
            continue
        p, v = d.split(":", 1)
        out.append((p.strip().lower(), v.strip()))
    return out


def has_hard(v):
    v2 = re.sub(r"url\((?:[^()\"']|\"[^\"]*\"|'[^']*')*\)", "", v)
    v2 = re.sub(r"var\(--[\w-]+\s*,\s*[^()]*\)", "", v2)
    return bool(COLOR.search(v2)) or "gradient(" in v2


def is_fallback_only(v):
    return not has_hard(v)


def scope_sel(sel):
    out = []
    for x in split_top(sel):
        x = x.strip()
        if not x or SKIP_SEL.search(x):
            continue
        if KEEP.search(x):
            continue
        m = re.match(r"^(:root|html)((?:\[[^\]]*\])*)(.*)$", x, re.S)
        if m:
            attrs = m.group(2)
            rest = m.group(3)
            out.append("%s%s:where([data-app-theme=\"rui\"])%s" % (m.group(1), attrs, rest))   # 원본 특이성 유지
        else:
            out.append(SCOPE + " " + x)
    return out


BAR = re.compile(r"(bar|fill|prog|meter|gauge|\\bgt\\b|pg\\b|-t i|-b i)", re.I)
BTN = re.compile(r"(cmp|\\.primary|btn|ai-t\\.on|\\.pp-m\\.u|\\.u >)", re.I)


def grad(sel, v, imp):
    """그라디언트는 쓰지 않는다 — 장식은 없애고, 막대·주요 버튼은 단색, 나머지는 면."""
    if re.search(r"::?(after|before)", sel) and "radial" in v:
        return [("background", "none" + imp)]
    if BAR.search(sel) or BTN.search(sel):
        m = re.search(r"var\(--(wrong|warn|correct)\)", v)
        tok = {"wrong": "var(--rui-bad)", "warn": "var(--rui-warn)", "correct": "var(--rui-ok)"}[m.group(1)] if m else "var(--rui-accent)"
        return [("background", tok + imp)]
    return [("background", "var(--rui-surface)" + imp)]


def radius_rules(rules):
    """공통 테마 2 전용: style.css 에 숫자로 쓴 모서리를 토큰으로. 알약(99px)과 2~4px 는 그대로 둔다."""
    def rp(m):
        n = float(m.group(1))
        return "var(--rui-r)" if 5 <= n < 10 else "var(--rui-r-lg)" if 10 <= n <= 24 else m.group(0)
    res = []
    for ctx, sel, body in rules:
        if "scrollbar" in sel:
            continue
        keep = []
        for p, v in decls(body):
            if p == "border-radius" or (p.startswith("border-") and p.endswith("-radius")):
                nv = re.sub(r"(?<![\w.-])(\d+(?:\.\d+)?)px", rp, v)
                if nv != v:
                    keep.append((p, nv))
        sels = [x.replace('data-app-theme="rui"', 'data-app-theme="rui"][data-rui-theme="2"') for x in scope_sel(sel)]
        if not keep or not sels:
            continue
        txt = ",\n".join(sels) + " { " + " ".join("%s: %s;" % x for x in keep) + " }"
        for c in reversed(ctx):
            txt = c + " { " + txt + " }"
        res.append(txt)
    return res


def convert(sel, ds):
    """규칙 하나를 토큰 선언 목록으로 바꾼다."""
    res = []
    has_clip = any(p in ("-webkit-background-clip", "background-clip") and v == "text" for p, v in ds)
    bgs = [v for p, v in ds if p in PROPS_BG]
    solid_bg = False
    fam_solid = None
    for v in bgs:   # 토큰으로 칠한 바탕 위의 글자도 판단한다
        if re.search(r"var\(--(wrong|correct|warn)\)", v):
            fam_solid = "var(--rui-bad)"
    for v in bgs:
        m = COLOR.search(v)
        if m and "gradient" not in v:
            t = bg_token(m.group(0))
            if t in ("var(--rui-accent)",):
                solid_bg = True
            elif t in ("var(--rui-ok)", "var(--rui-warn)", "var(--rui-bad)"):
                fam_solid = t
        if "var(--accent" in v and "gradient" not in v and "weak" not in v:
            solid_bg = True
        if "gradient" in v and BTN.search(sel) and not re.search(r"::?(after|before)", sel):
            solid_bg = True
    white_text = any(p == "color" and parse(COLOR.search(v).group(0))[:3] == (255, 255, 255) if COLOR.search(v) and parse(COLOR.search(v).group(0)) else False for p, v in ds)
    for p, v in ds:
        imp = " !important" if "!important" in v else ""
        v0 = v.replace("!important", "").strip()
        if not has_hard(v0):
            continue
        if p in PROPS_BG:
            if has_clip:
                res.append((p, "none" + imp))
                res.append(("-webkit-text-fill-color", "currentColor" + imp))
                res.append(("color", "var(--rui-accent-text)" + imp))
                continue
            if "url(" in v0:
                continue
            if "gradient" in v0:
                if "repeating" in v0:
                    continue
                res.extend(grad(sel, v0, imp))
                continue
            def rp(m):
                t = bg_token(m.group(0))
                return m.group(0) if (t in (None, "keep")) else t
            nv = COLOR.sub(rp, v0)
            if nv != v0:
                res.append((p, nv + imp))
        elif p in PROPS_COLOR:
            def rp(m):
                if fam_solid and white_text:
                    return "var(--rui-surface)"   # 상태색 바탕 위 글자 — 밝게·어둡게 모두 대비가 맞는다
                return fg_token(m.group(0), solid_bg) or m.group(0)
            nv = COLOR.sub(rp, v0)
            if nv != v0:
                res.append((p, nv + imp))
        elif p in PROPS_LINE:
            nv = COLOR.sub(lambda m: line_token(m.group(0)) or m.group(0), v0)
            if nv != v0:
                res.append((p, nv + imp))
        elif p == "box-shadow":
            if ":focus" in sel:
                continue
            if "inset" in v0:
                res.append((p, "inset 0 0 0 1px var(--rui-line)" + imp))
            elif FLOAT.search(sel):
                res.append((p, "var(--shadow-lg)" + imp))
            else:
                res.append((p, "none" + imp))
        elif p in ("text-shadow", "filter", "backdrop-filter"):
            if p == "text-shadow":
                res.append((p, "none" + imp))
        elif p.startswith("--"):
            continue
    return res


def main():
    css = re.sub(r"/\*.*?\*/", "", io.open(SRC, encoding="utf-8").read(), flags=re.S)
    rules = []
    walk(css, [], rules)
    # 같은 선택자·속성을 뒤에서 토큰 값으로 다시 정했는지 찾는다
    last = {}
    for i, (ctx, sel, body) in enumerate(rules):
        for p, v in decls(body):
            for one in split_top(sel):
                last[(ctx, one.strip(), p)] = (i, has_hard(v))
    out, stats, total = [], {}, 0
    for i, (ctx, sel, body) in enumerate(rules):
        ds = decls(body)
        if not any(has_hard(v) or p == "box-shadow" for p, v in ds):
            continue
        sels = scope_sel(sel)
        if not sels:
            continue
        conv = convert(sel, ds)
        keep = []
        for p, v in conv:
            later = [last.get((ctx, one.strip(), p)) for one in split_top(sel)]
            if all(x and x[0] > i and not x[1] for x in later):
                continue
            keep.append((p, v))
        if not keep:
            continue
        total += 1
        for one in split_top(sel):
            m = re.search(r"\.([a-zA-Z]+)[-_]?", one)
            k = m.group(1) if m else one[:12]
            stats[k] = stats.get(k, 0) + 1
        txt = ",\n".join(sels) + " { " + " ".join("%s: %s;" % (p, v) for p, v in keep) + " }"
        for c in reversed(ctx):
            txt = c + " { " + txt + " }"
        out.append(txt)
    if "--stats" in sys.argv:
        print(total, sorted(stats.items(), key=lambda x: -x[1])[:60])
        return
    corners = radius_rules(rules)
    head = "/* rui-gen.css — tools/build_rui_gen.py 가 style.css 에서 만든다. 손으로 고치지 말 것. 손댈 규칙은 rui-map.css 에. */\n"
    io.open(OUT, "w", encoding="utf-8", newline="\n").write(head + "\n".join(out + corners) + "\n")
    print("rui-gen.css", total, "rules +", len(corners), "corners", os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    main()
