/* =============================================================================
 * slidekit.js (v112) — 발표자료 디자인 키트 (slidestudio.js 가 쓴다)
 *   · 좌표는 1280×720 고정. 색은 "$ink" 같은 토큰이라 테마를 바꾸면 전체가 바뀐다.
 *   · 레이아웃 15종: 내용(data)을 주면 잘 배치된 요소(els)를 만든다 — AI 도 내용만 주면 디자인이 나온다.
 *   · 렌더: 슬라이드 → HTML(편집·썸네일·슬라이드 쇼 공용). 내보내기: exportDeck 이 색·꾸밈을 풀어 서버(PPTX)로.
 * ========================================================================== */
window.SLIDEKIT = (function () {
  "use strict";
  const W = 1280, H = 720;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const uid = () => "e" + Math.random().toString(36).slice(2, 9);

  /* ---------------- 테마 ---------------- */
  const THEMES = {
    clean:  { name: "클린 화이트", bg: "#ffffff", cover: { g: ["#1e40af", "#0ea5e9"], a: 135 }, ink: "#0f172a", tt: "#0f172a", muted: "#64748b", accent: "#2563eb", accent2: "#06b6d4", surface: "#f1f5f9", line: "#e2e8f0", on: "#ffffff", cink: "#ffffff", cmuted: "#dbeafe", deco: "bar", pal: ["#2563eb", "#06b6d4", "#8b5cf6", "#f59e0b", "#10b981", "#ef4444"] },
    navy:   { name: "다크 네이비", bg: "#0b1220", cover: { g: ["#0b1220", "#12305e"], a: 140 }, ink: "#e6edf7", tt: "#ffffff", muted: "#94a3b8", accent: "#38bdf8", accent2: "#818cf8", surface: "#16213a", line: "#26334f", on: "#0b1220", cink: "#ffffff", cmuted: "#a5b8d3", deco: "line", pal: ["#38bdf8", "#818cf8", "#34d399", "#fbbf24", "#f472b6", "#fb7185"] },
    aurora: { name: "오로라", bg: "#faf8ff", cover: { g: ["#4c1d95", "#db2777"], a: 125 }, ink: "#1e1b4b", tt: "#3b0764", muted: "#6b6a8e", accent: "#7c3aed", accent2: "#db2777", surface: "#f1ecff", line: "#e6defa", on: "#ffffff", cink: "#ffffff", cmuted: "#f3e2ff", deco: "blob", pal: ["#7c3aed", "#db2777", "#2563eb", "#f59e0b", "#14b8a6", "#ef4444"] },
    forest: { name: "그린 리서치", bg: "#fbfdfb", cover: { g: ["#064e3b", "#0f766e"], a: 135 }, ink: "#0f2a22", tt: "#064e3b", muted: "#5b7268", accent: "#059669", accent2: "#84cc16", surface: "#ecf7f1", line: "#d9ebe1", on: "#ffffff", cink: "#ffffff", cmuted: "#c8eede", deco: "side", pal: ["#059669", "#84cc16", "#0ea5e9", "#f59e0b", "#a855f7", "#ef4444"] },
    sunset: { name: "선셋", bg: "#fffaf5", cover: { g: ["#c2410c", "#e11d48"], a: 120 }, ink: "#2a1608", tt: "#7c2d12", muted: "#8a6f5d", accent: "#ea580c", accent2: "#e11d48", surface: "#fff0e4", line: "#fbe3d0", on: "#ffffff", cink: "#ffffff", cmuted: "#ffe1cf", deco: "blob", pal: ["#ea580c", "#e11d48", "#f59e0b", "#0d9488", "#7c3aed", "#2563eb"] },
    mono:   { name: "미니멀 모노", bg: "#ffffff", cover: "#111111", ink: "#111111", tt: "#111111", muted: "#6b7280", accent: "#111111", accent2: "#6b7280", surface: "#f4f4f5", line: "#e4e4e7", on: "#ffffff", cink: "#ffffff", cmuted: "#a1a1aa", deco: "line", pal: ["#111111", "#6b7280", "#a1a1aa", "#374151", "#d4d4d8", "#52525b"] },
    gov:    { name: "공공 보고", bg: "#ffffff", cover: { g: ["#0f2f6b", "#1d4ed8"], a: 90 }, ink: "#111827", tt: "#ffffff", muted: "#4b5563", accent: "#1e3a8a", accent2: "#0284c7", surface: "#eef2f9", line: "#d6deeb", on: "#ffffff", cink: "#ffffff", cmuted: "#d6e4ff", deco: "band", pal: ["#1e3a8a", "#0284c7", "#059669", "#d97706", "#7c3aed", "#dc2626"] },
    swiss:  { name: "스위스 레드", bg: "#ffffff", cover: "#dc2626", ink: "#111111", tt: "#111111", muted: "#57534e", accent: "#dc2626", accent2: "#111111", surface: "#f5f5f4", line: "#e7e5e4", on: "#ffffff", cink: "#ffffff", cmuted: "#ffe4e4", deco: "corner", pal: ["#dc2626", "#111111", "#78716c", "#f59e0b", "#2563eb", "#059669"] },
    mint:   { name: "민트 프레시", bg: "#f6fffb", cover: { g: ["#0d9488", "#22d3ee"], a: 130 }, ink: "#083344", tt: "#0f766e", muted: "#4f7a7a", accent: "#0d9488", accent2: "#22d3ee", surface: "#e3f8f2", line: "#cdeee6", on: "#ffffff", cink: "#ffffff", cmuted: "#d5fbf3", deco: "blob", pal: ["#0d9488", "#22d3ee", "#6366f1", "#f59e0b", "#ec4899", "#84cc16"] },
    slate:  { name: "슬레이트 프로", bg: "#111827", cover: { g: ["#111827", "#374151"], a: 150 }, ink: "#f3f4f6", tt: "#ffffff", muted: "#9ca3af", accent: "#f59e0b", accent2: "#fb7185", surface: "#1f2937", line: "#374151", on: "#111827", cink: "#ffffff", cmuted: "#d1d5db", deco: "bar", pal: ["#f59e0b", "#fb7185", "#60a5fa", "#34d399", "#c084fc", "#f87171"] },
  };
  const theme = (id) => THEMES[id] || THEMES.clean;

  function hexA(c, a) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(c || "")); if (!m) return c;
    const n = parseInt(m[1], 16); return "rgba(" + (n >> 16) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
  }
  function col(c, T, dark) {
    if (!c) return null; if (typeof c !== "string" || c[0] !== "$") return c;
    const k = c.slice(1);
    if (dark) { if (k === "ink" || k === "tt") return T.cink; if (k === "muted") return T.cmuted; if (k === "line") return hexA(T.cink, 0.3); if (k === "surface") return hexA(T.cink, 0.12); }
    return T[k] || T.ink;
  }
  function fillCss(f, T, dark) {
    if (!f || f === "none") return "transparent";
    if (typeof f === "object") { if (f.g) return "linear-gradient(" + (f.a == null ? 135 : f.a) + "deg," + col(f.g[0], T, dark) + "," + col(f.g[1], T, dark) + ")"; return hexA(col(f.c, T, dark), f.a == null ? 1 : f.a); }
    return col(f, T, dark);
  }

  /* ---------------- 레이아웃 ---------------- */
  const LAYOUTS = [
    ["cover", "표지"], ["section", "장 표지"], ["bullets", "제목+목록"], ["two", "두 단"], ["compare", "비교"], ["kpi", "숫자 강조"], ["process", "단계"],
    ["timeline", "타임라인"], ["grid", "카드"], ["big", "핵심 한 문장"], ["quote", "인용"], ["imgleft", "그림+글"], ["table", "표"], ["chart", "차트"], ["closing", "마무리"], ["blank", "빈 슬라이드"],
  ];
  const DARK = { cover: 1, section: 1, closing: 1 };
  const ul = (items) => "<ul>" + (items || []).map((x) => "<li>" + esc(x) + "</li>").join("") + "</ul>";
  const lines = (txt, w, fs) => String(txt || "").split("\n").reduce((a, l) => a + Math.max(1, Math.ceil(l.length * fs * 0.92 / w)), 0);
  function fitTitle(t, w, fs, min, maxL) { let f = fs; while (f > min && lines(t, w, f) > maxL) f -= 2; return f; }
  function fitList(items, w, h, fs, min) { let f = fs; const need = (s) => (items || []).reduce((a, x) => a + lines(x, w - s * 1.3, s) * s * 1.42 + s * 0.3, 0); while (f > min && need(f) > h) f -= 1; return f; }
  const tx = (role, x, y, w, h, html, st) => Object.assign({ id: uid(), type: "text", role: role, x: x, y: y, w: w, h: h, html: html }, st || {});
  const sh = (shape, x, y, w, h, st) => Object.assign({ id: uid(), type: "shape", shape: shape, x: x, y: y, w: w, h: h }, st || {});
  const titleEl = (t) => { const f = fitTitle(t, 1120, 40, 28, 2); return tx("title", 72, 40, 1136, 96, esc(t), { fs: f, b: 1, color: "$tt", valign: "middle", lh: 1.22 }); };
  const card = (x, y, w, h, st) => sh("round", x, y, w, h, Object.assign({ fill: "$surface", radius: 18 }, st || {}));

  const BUILD = {
    cover: (d) => { const f = fitTitle(d.title, 1040, 64, 40, 2); return [tx("title", 96, 214, 1088, 176, esc(d.title || "발표 제목"), { fs: f, b: 1, color: "$ink", valign: "bottom", lh: 1.2 }), tx("sub", 96, 406, 1088, 60, esc(d.sub || ""), { fs: 28, color: "$ink", op: 0.92 }), tx("meta", 96, 588, 1088, 40, esc(d.meta || ""), { fs: 20, color: "$muted" })]; },
    section: (d) => [tx("no", 96, 176, 300, 150, esc(d.no || "01"), { fs: 120, b: 1, color: "$ink", op: 0.35, lh: 1 }), tx("title", 96, 330, 1088, 130, esc(d.title || "장 제목"), { fs: fitTitle(d.title, 1040, 56, 36, 2), b: 1, color: "$ink", lh: 1.22 }), tx("sub", 96, 470, 1088, 50, esc(d.sub || ""), { fs: 24, color: "$muted" })],
    bullets: (d) => { const it = d.items && d.items.length ? d.items : ["첫 번째 내용", "두 번째 내용", "세 번째 내용"]; return [titleEl(d.title || "제목"), tx("body", 72, 160, 1136, 490, ul(it), { fs: fitList(it, 1136, 490, 28, 18), color: "$ink", lh: 1.42 })]; },
    two: (d) => { const L = d.left || {}, R = d.right || {}; const col2 = (x, c) => { const it = c.items && c.items.length ? c.items : ["내용"]; return [tx("h", x, 164, 548, 48, esc(c.h || "소제목"), { fs: 26, b: 1, color: "$accent", valign: "middle" }), { id: uid(), type: "line", x: x, y: 216, w: 548, h: 0, stroke: "$line", sw: 2 }, tx("body", x, 232, 548, 410, ul(it), { fs: fitList(it, 548, 410, 24, 17), color: "$ink", lh: 1.42 })]; }; return [titleEl(d.title || "제목")].concat(col2(72, L), col2(660, R)); },
    compare: (d) => { const L = d.left || {}, R = d.right || {}; const c2 = (x, c, f, hc) => { const it = c.items && c.items.length ? c.items : ["내용"]; return [card(x, 160, 548, 492, {}), sh("round", x + 24, 184, 500, 56, { fill: f, radius: 12, html: esc(c.h || "구분"), fs: 24, b: 1, color: hc, align: "center" }), tx("body", x + 32, 256, 484, 380, ul(it), { fs: fitList(it, 484, 380, 23, 16), color: "$ink", lh: 1.42 })]; }; return [titleEl(d.title || "비교")].concat(c2(72, L, "$muted", "$on"), c2(660, R, "$accent", "$on")); },
    kpi: (d) => { const k = (d.kpis && d.kpis.length ? d.kpis : [{ v: "00%", l: "지표" }, { v: "00", l: "지표" }, { v: "00", l: "지표" }]).slice(0, 4); const gap = 24, w = (1136 - gap * (k.length - 1)) / k.length, out = [titleEl(d.title || "핵심 수치")]; k.forEach((x, i) => { const cx = 72 + i * (w + gap), vf = fitTitle(x.v, w - 40, 72, 36, 1); out.push(card(cx, 184, w, 410, {}), sh("rect", cx + 28, 222, 56, 6, { fill: "$accent" }), tx("v", cx + 28, 250, w - 56, 110, esc(x.v), { fs: vf, b: 1, color: "$accent", valign: "middle", lh: 1.1 }), tx("l", cx + 28, 372, w - 56, 44, esc(x.l || ""), { fs: 22, b: 1, color: "$ink" }), tx("d", cx + 28, 424, w - 56, 150, esc(x.d || ""), { fs: 18, color: "$muted", lh: 1.45 })); }); return out; },
    process: (d) => { const k = (d.steps && d.steps.length ? d.steps : [{ h: "1단계" }, { h: "2단계" }, { h: "3단계" }, { h: "4단계" }]).slice(0, 6); const n = k.length, ov = 18, w = (1136 + ov * (n - 1)) / n, out = [titleEl(d.title || "추진 단계")]; k.forEach((x, i) => { const cx = 72 + i * (w - ov); out.push(sh(i ? "chevron" : "pent", cx, 196, w, 104, { fill: i % 2 ? "$accent2" : "$accent", html: esc(x.h || ""), fs: n > 4 ? 18 : 22, b: 1, color: "$on", align: "center", px: i ? 34 : 14 })); out.push(tx("d", cx + (i ? 18 : 6), 330, w - 44, 300, esc(x.d || ""), { fs: n > 4 ? 17 : 20, color: "$ink", lh: 1.5 })); }); return out; },
    timeline: (d) => { const k = (d.steps && d.steps.length ? d.steps : [{ t: "1분기", h: "준비" }, { t: "2분기", h: "개발" }, { t: "3분기", h: "실증" }, { t: "4분기", h: "확산" }]).slice(0, 6); const n = k.length, w = 1136 / n, y = 336, out = [titleEl(d.title || "추진 일정"), { id: uid(), type: "line", x: 72, y: y, w: 1136, h: 0, stroke: "$accent", sw: 4 }]; k.forEach((x, i) => { const cx = 72 + i * w; out.push(sh("oval", cx + 6, y - 13, 26, 26, { fill: "$surface", stroke: "$accent", sw: 5 }), tx("t", cx, y - 96, w - 16, 64, esc(x.t || ""), { fs: n > 4 ? 20 : 24, b: 1, color: "$accent", valign: "bottom" }), tx("h", cx, y + 34, w - 16, 76, esc(x.h || ""), { fs: n > 4 ? 19 : 22, b: 1, color: "$ink", lh: 1.3 }), tx("d", cx, y + 116, w - 16, 180, esc(x.d || ""), { fs: n > 4 ? 15 : 17, color: "$muted", lh: 1.45 })); }); return out; },
    grid: (d) => { const k = (d.cards && d.cards.length ? d.cards : [{ h: "항목" }, { h: "항목" }, { h: "항목" }, { h: "항목" }]).slice(0, 6); const n = k.length, cols = n <= 2 ? n : n <= 4 ? 2 : 3, rows = Math.ceil(n / cols), g = 20, w = (1136 - g * (cols - 1)) / cols, h = (492 - g * (rows - 1)) / rows, out = [titleEl(d.title || "핵심 내용")]; k.forEach((x, i) => { const cx = 72 + (i % cols) * (w + g), cy = 160 + Math.floor(i / cols) * (h + g); out.push(card(cx, cy, w, h, {}), sh("oval", cx + 22, cy + 22, 44, 44, { fill: "$accent", html: String(i + 1), fs: 20, b: 1, color: "$on", align: "center" }), tx("h", cx + 80, cy + 20, w - 104, 48, esc(x.h || ""), { fs: 23, b: 1, color: "$ink", valign: "middle" }), tx("d", cx + 24, cy + 78, w - 48, h - 96, esc(x.d || ""), { fs: rows > 1 ? 18 : 21, color: "$muted", lh: 1.45 })); }); return out; },
    big: (d) => [tx("title", 120, 196, 1040, 260, esc(d.title || "핵심 메시지를 한 문장으로"), { fs: fitTitle(d.title, 1000, 54, 32, 3), b: 1, color: "$tt2", align: "center", valign: "middle", lh: 1.3 }), sh("rect", 590, 476, 100, 6, { fill: "$accent" }), tx("sub", 160, 500, 960, 70, esc(d.sub || ""), { fs: 24, color: "$muted", align: "center" })],
    quote: (d) => [tx("mark", 96, 88, 200, 150, "“", { fs: 170, b: 1, color: "$accent", lh: 1 }), tx("title", 140, 214, 1000, 250, esc(d.quote || d.title || "인용문"), { fs: fitTitle(d.quote || d.title, 960, 42, 28, 4), b: 1, color: "$tt2", valign: "middle", lh: 1.4 }), tx("sub", 140, 486, 1000, 44, esc(d.by ? "— " + d.by : ""), { fs: 22, color: "$muted" })],
    imgleft: (d) => { const it = d.items && d.items.length ? d.items : ["그림을 설명하는 내용"]; return [titleEl(d.title || "제목"), { id: uid(), type: "image", role: "img", x: 72, y: 160, w: 560, h: 490, src: d.img || "", radius: 14, fit: "cover" }, tx("body", 664, 160, 544, 490, ul(it), { fs: fitList(it, 544, 490, 25, 17), color: "$ink", lh: 1.42 })]; },
    table: (d) => { const rows = d.rows && d.rows.length ? d.rows : [["구분", "내용", "비고"], ["항목", "", ""], ["항목", "", ""], ["항목", "", ""]]; return [titleEl(d.title || "표 제목"), { id: uid(), type: "table", role: "table", x: 72, y: 160, w: 1136, h: Math.min(490, 54 + 54 * rows.length), rows: rows, fs: rows.length > 8 ? 17 : 20, head: true }]; },
    chart: (d) => { const it = d.items || [], ch = d.chart || { type: "col", labels: ["항목 1", "항목 2", "항목 3", "항목 4"], series: [{ name: "값", vals: [30, 52, 41, 68] }] }; const side = it.length > 0; return [titleEl(d.title || "차트 제목"), { id: uid(), type: "chart", role: "chart", x: 72, y: 156, w: side ? 760 : 1136, h: 496, chart: ch, fs: 18 }].concat(side ? [card(856, 170, 352, 468, {}), tx("body", 880, 190, 304, 428, ul(it), { fs: fitList(it, 304, 428, 22, 16), color: "$ink", lh: 1.45 })] : []); },
    closing: (d) => [tx("title", 96, 250, 1088, 130, esc(d.title || "감사합니다"), { fs: 68, b: 1, color: "$ink", align: "center", valign: "middle" }), tx("sub", 96, 392, 1088, 60, esc(d.sub || "질문을 받겠습니다"), { fs: 28, color: "$muted", align: "center" })],
    blank: () => [],
  };
  function fromData(d) {
    const kind = BUILD[d.layout] ? d.layout : "bullets";
    return { id: "s" + uid().slice(1), layout: kind, dark: !!DARK[kind], els: BUILD[kind](d), note: String(d.note || "") };
  }
  /* 지금 슬라이드의 글을 뽑아 다른 레이아웃으로 옮길 때 쓴다 */
  function plain(html) { const t = document.createElement("template"); t.innerHTML = String(html || "").replace(/<\/(p|div|li)>/g, "\n").replace(/<br\s*\/?>/g, "\n"); return (t.content.textContent || "").trim(); }
  function dataOf(s) {
    const texts = (s.els || []).filter((e) => e.html && (e.type === "text" || e.type === "shape")), title = texts.find((e) => e.role === "title") || texts[0];
    const rest = texts.filter((e) => e !== title && e.role !== "no" && e.role !== "mark" && e.role !== "meta");
    const items = []; rest.forEach((e) => plain(e.html).split("\n").map((x) => x.trim()).filter(Boolean).forEach((x) => items.push(x)));
    const tb = (s.els || []).find((e) => e.type === "table"), ch = (s.els || []).find((e) => e.type === "chart"), img = (s.els || []).find((e) => e.type === "image");
    const half = Math.ceil(items.length / 2);
    return { title: title ? plain(title.html) : "", sub: items[0] || "", items: items, rows: tb && tb.rows, chart: ch && ch.chart, img: img && img.src, note: s.note, quote: title ? plain(title.html) : "",
      left: { h: "", items: items.slice(0, half) }, right: { h: "", items: items.slice(half) },
      kpis: items.slice(0, 4).map((x) => ({ v: x.slice(0, 8), l: x.slice(8, 26) })), steps: items.slice(0, 6).map((x) => ({ h: x.slice(0, 16), d: x.slice(16) })), cards: items.slice(0, 6).map((x) => ({ h: x.slice(0, 16), d: x.slice(16) })) };
  }

  /* ---------------- 꾸밈(테마 장식) ---------------- */
  function deco(T, dark, n, N, title) {
    const out = []; const add = (type, o) => out.push(Object.assign({ type: type, deco: 1 }, o));
    if (T.deco === "bar" && !dark) add("shape", { shape: "rect", x: 44, y: 62, w: 8, h: 52, fill: "$accent" });
    if (T.deco === "line" && !dark) add("shape", { shape: "rect", x: 72, y: 138, w: 96, h: 5, fill: "$accent" });
    if (T.deco === "side") add("shape", { shape: "rect", x: 0, y: 0, w: 26, h: H, fill: dark ? { c: "#ffffff", a: 0.2 } : "$accent" });
    if (T.deco === "band" && !dark) add("shape", { shape: "rect", x: 0, y: 0, w: W, h: 142, fill: { g: ["$accent", "$accent2"], a: 90 } });
    if (T.deco === "corner") add("shape", { shape: "rect", x: W - 96, y: 0, w: 96, h: 12, fill: dark ? "#ffffff" : "$accent" });
    if (T.deco === "blob" || dark) { add("shape", { shape: "oval", x: W - 300, y: -170, w: 500, h: 500, fill: { c: dark ? "#ffffff" : T.accent, a: dark ? 0.08 : 0.07 } }); add("shape", { shape: "oval", x: W - 150, y: H - 230, w: 320, h: 320, fill: { c: dark ? "#ffffff" : T.accent2, a: dark ? 0.1 : 0.08 } }); }
    if (!dark && n) { add("text", { x: W - 200, y: H - 44, w: 148, h: 26, html: n + " / " + N, fs: 14, color: "$muted", align: "right" }); if (title) add("text", { x: 72, y: H - 44, w: 800, h: 26, html: esc(title), fs: 14, color: "$muted" }); }
    return out;
  }

  /* ---------------- 그리기 ---------------- */
  function shapePath(k, w, h, r) {
    const rr = Math.min(r == null ? 16 : r, w / 2, h / 2);
    if (k === "oval") return "M0," + h / 2 + "A" + w / 2 + "," + h / 2 + " 0 1 1 " + w + "," + h / 2 + "A" + w / 2 + "," + h / 2 + " 0 1 1 0," + h / 2 + "Z";
    if (k === "round") return "M" + rr + ",0H" + (w - rr) + "A" + rr + "," + rr + " 0 0 1 " + w + "," + rr + "V" + (h - rr) + "A" + rr + "," + rr + " 0 0 1 " + (w - rr) + "," + h + "H" + rr + "A" + rr + "," + rr + " 0 0 1 0," + (h - rr) + "V" + rr + "A" + rr + "," + rr + " 0 0 1 " + rr + ",0Z";
    if (k === "tri") return "M" + w / 2 + ",0L" + w + "," + h + "L0," + h + "Z";
    if (k === "diamond") return "M" + w / 2 + ",0L" + w + "," + h / 2 + "L" + w / 2 + "," + h + "L0," + h / 2 + "Z";
    if (k === "arrow") { const a = Math.min(h / 2, w * 0.4); return "M0," + h * 0.25 + "H" + (w - a) + "V0L" + w + "," + h / 2 + "L" + (w - a) + "," + h + "V" + h * 0.75 + "H0Z"; }
    if (k === "chevron") { const a = Math.min(h / 2, w * 0.3); return "M0,0H" + (w - a) + "L" + w + "," + h / 2 + "L" + (w - a) + "," + h + "H0L" + a + "," + h / 2 + "Z"; }
    if (k === "pent") { const a = Math.min(h / 2, w * 0.3); return "M0,0H" + (w - a) + "L" + w + "," + h / 2 + "L" + (w - a) + "," + h + "H0Z"; }
    if (k === "callout") return "M0,0H" + w + "V" + h * 0.76 + "H" + w * 0.42 + "L" + w * 0.22 + "," + h + "V" + h * 0.76 + "H0Z";
    if (k === "star") { let p = ""; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, q = i % 2 ? 0.42 : 1; p += (i ? "L" : "M") + (w / 2 + Math.cos(a) * w / 2 * q).toFixed(1) + "," + (h / 2 + Math.sin(a) * h / 2 * q).toFixed(1); } return p + "Z"; }
    return "M0,0H" + w + "V" + h + "H0Z";
  }
  const nice = (m) => { if (m <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(m))), x = m / p; return (x <= 1 ? 1 : x <= 2 ? 2 : x <= 5 ? 5 : 10) * p; };
  const fnum = (v) => (Math.abs(v) >= 1000 ? Number(v).toLocaleString("ko-KR") : String(Math.round(v * 100) / 100));
  function chartSvg(e, T, dark) {
    const c = e.chart || {}, w = e.w, h = e.h, fs = e.fs || 18, ink = col("$ink", T, dark), mut = col("$muted", T, dark), line = col("$line", T, dark), pal = T.pal, L = c.labels || [], Sr = (c.series || []).filter((s) => s);
    const txt = (x, y, t, o) => '<text x="' + x + '" y="' + y + '" font-size="' + ((o && o.fs) || fs) + '" fill="' + ((o && o.fill) || mut) + '" text-anchor="' + ((o && o.a) || "middle") + '"' + (o && o.b ? ' font-weight="700"' : "") + ">" + esc(t) + "</text>";
    let g = "";
    if (c.type === "pie" || c.type === "doughnut") {
      const vals = (Sr[0] ? Sr[0].vals : []).map((v) => Math.max(0, +v || 0)), tot = vals.reduce((a, b) => a + b, 0) || 1, R = Math.min(h - 20, w * 0.56) / 2, cx = R + 14, cy = h / 2; let a0 = -Math.PI / 2;
      vals.forEach((v, i) => { const a1 = a0 + v / tot * Math.PI * 2, big = a1 - a0 > Math.PI ? 1 : 0; const r0 = c.type === "doughnut" ? R * 0.58 : 0; const p = (r, a) => (cx + Math.cos(a) * r).toFixed(1) + "," + (cy + Math.sin(a) * r).toFixed(1); g += '<path d="M' + p(R, a0) + "A" + R + "," + R + " 0 " + big + " 1 " + p(R, a1 - 0.0001) + (r0 ? "L" + p(r0, a1 - 0.0001) + "A" + r0 + "," + r0 + " 0 " + big + " 0 " + p(r0, a0) : "L" + cx + "," + cy) + 'Z" fill="' + pal[i % pal.length] + '" stroke="' + (typeof T.bg === "string" ? T.bg : "#fff") + '" stroke-width="2"/>'; a0 = a1; });
      const lx = cx + R + 40, step = Math.min(44, (h - 20) / Math.max(1, L.length)); L.forEach((l, i) => { const y = h / 2 - step * L.length / 2 + step * i + step / 2; g += '<rect x="' + lx + '" y="' + (y - 8) + '" width="16" height="16" rx="4" fill="' + pal[i % pal.length] + '"/>' + txt(lx + 26, y + fs * 0.35, l + "  " + Math.round((vals[i] || 0) / tot * 100) + "%", { a: "start", fill: ink }); });
      return '<svg viewBox="0 0 ' + w + " " + h + '" width="100%" height="100%">' + g + "</svg>";
    }
    const all = []; Sr.forEach((s) => (s.vals || []).forEach((v) => all.push(+v || 0))); const mx = nice(Math.max(1, ...all) * 1.08), legend = Sr.length > 1;
    if (c.type === "bar") {
      const lw = Math.min(w * 0.3, Math.max(...L.map((l) => String(l).length), 2) * fs * 0.92 + 12), pt = 8, pb = legend ? 42 : 8, pr = 76, gh = (h - pt - pb) / Math.max(1, L.length), bh = Math.min(gh * 0.72 / Math.max(1, Sr.length), 40), iw = w - lw - pr;
      L.forEach((l, i) => { const y0 = pt + gh * i + (gh - bh * Sr.length) / 2; g += txt(lw - 10, pt + gh * i + gh / 2 + fs * 0.35, l, { a: "end", fill: ink }); Sr.forEach((s, j) => { const v = +((s.vals || [])[i]) || 0, bw = Math.max(2, v / mx * iw); g += '<rect x="' + lw + '" y="' + (y0 + j * bh) + '" width="' + bw + '" height="' + (bh - 3) + '" rx="4" fill="' + pal[j % pal.length] + '"/>' + txt(lw + bw + 8, y0 + j * bh + bh / 2 + fs * 0.3, fnum(v), { a: "start", fill: ink, b: 1, fs: fs - 2 }); }); });
    } else {
      const pl = 12 + String(fnum(mx)).length * fs * 0.6, pb = legend ? 76 : 44, pt = 22, pr = 14, iw = w - pl - pr, ih = h - pt - pb, tick = 4;
      for (let i = 0; i <= tick; i++) { const y = pt + ih - ih * i / tick; g += '<line x1="' + pl + '" x2="' + (w - pr) + '" y1="' + y + '" y2="' + y + '" stroke="' + line + '" stroke-width="1"/>' + txt(pl - 10, y + fs * 0.32, fnum(mx * i / tick), { a: "end", fs: fs - 3 }); }
      const gw = iw / Math.max(1, L.length); L.forEach((l, i) => { g += txt(pl + gw * i + gw / 2, h - pb + fs + 8, l, { fill: ink }); });
      if (c.type === "line") Sr.forEach((s, j) => { const pts = (s.vals || []).map((v, i) => [pl + gw * i + gw / 2, pt + ih - (+v || 0) / mx * ih]); g += '<polyline fill="none" stroke="' + pal[j % pal.length] + '" stroke-width="4" stroke-linejoin="round" points="' + pts.map((p) => p.map((x) => x.toFixed(1)).join(",")).join(" ") + '"/>' + pts.map((p, i) => '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="6" fill="' + pal[j % pal.length] + '"/>' + (Sr.length < 3 ? txt(p[0], p[1] - 12, fnum(s.vals[i]), { fill: ink, b: 1, fs: fs - 2 }) : "")).join(""); });
      else { const bw = Math.min(gw * 0.72 / Math.max(1, Sr.length), 84); L.forEach((l, i) => { const x0 = pl + gw * i + (gw - bw * Sr.length) / 2; Sr.forEach((s, j) => { const v = +((s.vals || [])[i]) || 0, bh = v / mx * ih; g += '<rect x="' + (x0 + j * bw) + '" y="' + (pt + ih - bh) + '" width="' + (bw - 4) + '" height="' + bh + '" rx="5" fill="' + pal[j % pal.length] + '"/>' + txt(x0 + j * bw + (bw - 4) / 2, pt + ih - bh - 8, fnum(v), { fill: ink, b: 1, fs: fs - 2 }); }); }); }
    }
    if (legend) { let lx = 0; const parts = Sr.map((s, j) => { const x = lx; lx += 34 + String(s.name || "").length * fs * 0.95 + 18; return '<rect x="' + x + '" y="' + (h - 24) + '" width="16" height="16" rx="4" fill="' + pal[j % pal.length] + '"/>' + txt(x + 24, h - 10, s.name || "", { a: "start", fill: ink }); }); g += '<g transform="translate(' + Math.max(0, (w - lx) / 2) + ',0)">' + parts.join("") + "</g>"; }
    return '<svg viewBox="0 0 ' + w + " " + h + '" width="100%" height="100%" style="overflow:visible">' + g + "</svg>";
  }
  function elHtml(e, T, dark, opt) {
    opt = opt || {};
    const box = "left:" + e.x + "px;top:" + e.y + "px;width:" + e.w + "px;height:" + e.h + "px;" + (e.r ? "transform:rotate(" + e.r + "deg);" : "") + (e.op != null ? "opacity:" + e.op + ";" : "") + (e.shadow ? "filter:drop-shadow(0 8px 18px rgba(15,23,42,.22));" : "");
    const attr = e.deco ? ' class="sd-el sd-deco"' : ' class="sd-el sd-k-' + e.type + '" data-el="' + e.id + '"';
    const tstyle = "font-size:" + (e.fs || 24) + "px;color:" + (col(e.color || "$ink", T, dark)) + ";line-height:" + (e.lh || 1.35) + ";text-align:" + (e.align || "left") + ";font-weight:" + (e.b ? 700 : 400) + ";font-style:" + (e.i ? "italic" : "normal") + ";" + (e.u ? "text-decoration:underline;" : "");
    const just = { top: "flex-start", middle: "center", bottom: "flex-end" }[e.valign || (e.type === "shape" ? "middle" : "top")];
    const inner = (html) => '<div class="sd-tw" style="justify-content:' + just + ";padding:" + (e.py || 0) + "px " + (e.px || (e.type === "shape" ? 10 : 0)) + "px;" + tstyle + '"><div class="sd-tx">' + html + "</div></div>";
    if (e.type === "text") return "<div" + attr + ' style="' + box + (e.fill ? "background:" + fillCss(e.fill, T, dark) + ";" : "") + (e.radius ? "border-radius:" + e.radius + "px;" : "") + '">' + inner(e.html || "") + "</div>";
    if (e.type === "shape") {
      const gid = "sg" + (e.id || (e.shape + e.x + e.y)), f = e.fill; let defs = "", paint;
      if (f && typeof f === "object" && f.g) { const a = ((f.a == null ? 135 : f.a) - 90) * Math.PI / 180, x = Math.cos(a), y = Math.sin(a); defs = '<defs><linearGradient id="' + gid + '" x1="' + (0.5 - x / 2) + '" y1="' + (0.5 - y / 2) + '" x2="' + (0.5 + x / 2) + '" y2="' + (0.5 + y / 2) + '"><stop offset="0" stop-color="' + col(f.g[0], T, dark) + '"/><stop offset="1" stop-color="' + col(f.g[1], T, dark) + '"/></linearGradient></defs>'; paint = "url(#" + gid + ")"; } else paint = fillCss(f, T, dark);
      const w = Math.max(1, e.w), h = Math.max(1, e.h), sw = e.stroke ? (e.sw || 1) : 0;
      return "<div" + attr + ' style="' + box + '"><svg viewBox="0 0 ' + w + " " + h + '" width="100%" height="100%" preserveAspectRatio="none" style="position:absolute;inset:0;overflow:visible">' + defs + '<path d="' + shapePath(e.shape, w, h, e.radius) + '" fill="' + paint + '"' + (sw ? ' stroke="' + col(e.stroke, T, dark) + '" stroke-width="' + sw + '"' : "") + "/></svg>" + inner(e.html || "") + "</div>";
    }
    if (e.type === "line") return "<div" + attr + ' style="' + box + 'height:' + Math.max(e.h, 1) + 'px"><svg width="100%" height="' + Math.max(e.h, 8) + '" style="position:absolute;left:0;top:' + (e.h ? 0 : -4) + 'px;overflow:visible"><line x1="0" y1="' + (e.h ? 0 : 4) + '" x2="' + e.w + '" y2="' + (e.h ? e.h : 4) + '" stroke="' + col(e.stroke || "$ink", T, dark) + '" stroke-width="' + (e.sw || 2) + '"' + (e.dash ? ' stroke-dasharray="10 8"' : "") + "/></svg></div>";
    if (e.type === "image") { const src = e.src && String(e.src).indexOf("asset:") === 0 ? (opt.asset ? opt.asset(e.src.slice(6)) : "") : e.src; return "<div" + attr + ' style="' + box + (e.radius ? "border-radius:" + e.radius + "px;overflow:hidden;" : "") + '">' + (src ? '<img src="' + esc(src) + '" alt="" draggable="false" style="width:100%;height:100%;object-fit:' + (e.fit || "cover") + '">' : '<div class="sd-ph" style="background:' + fillCss("$surface", T, dark) + ";color:" + col("$muted", T, dark) + '"><b>🖼</b><span>그림 넣기</span></div>') + "</div>"; }
    if (e.type === "table") {
      const rows = e.rows || [[""]], hd = e.head !== false, ink = col("$ink", T, dark), ln = col("$line", T, dark), hf = col("$accent", T, dark), on = col("$on", T, dark), zb = col("$surface", T, dark);
      return "<div" + attr + ' style="' + box + '"><table class="sd-tb" style="font-size:' + (e.fs || 20) + "px;color:" + ink + '">' + rows.map((r, ri) => "<tr>" + r.map((c, ci) => { const head = hd && ri === 0; return "<td" + (opt.cells ? ' data-r="' + ri + '" data-c="' + ci + '"' : "") + ' style="border:1px solid ' + ln + ";" + (head ? "background:" + hf + ";color:" + on + ";font-weight:700;text-align:center;" : ri % 2 === 0 ? "background:" + zb + ";" : "") + '">' + esc(c) + "</td>"; }).join("") + "</tr>").join("") + "</table></div>";
    }
    if (e.type === "chart") return "<div" + attr + ' style="' + box + '">' + chartSvg(e, T, dark) + "</div>";
    return "";
  }
  function bgCss(s, T) { return fillCss(s.bg || (s.dark ? T.cover : T.bg), T, false); }
  function slideHtml(s, deck, n, N, opt) {
    const T = theme(deck.theme), dark = !!s.dark;
    const tk = Object.assign({}, T, { tt2: dark ? T.cink : (T.deco === "band" ? T.ink : T.tt) }); if (deco && T.deco === "band" && (s.layout === "big" || s.layout === "quote")) tk.deco = "none";
    return '<div class="sd-slide" style="background:' + bgCss(s, T) + '">' + deco(tk, dark, n, N, deck.footer ? deck.title : "").map((e) => elHtml(e, tk, dark, opt)).join("") + (s.els || []).map((e) => elHtml(e, tk, dark, opt)).join("") + "</div>";
  }
  function thumb(s, deck, w, n, N, opt) { return '<div class="sd-th" style="width:' + w + "px;height:" + Math.round(w * 9 / 16) + 'px"><div class="sd-sc" style="transform:scale(' + (w / W) + ')">' + slideHtml(s, deck, n, N, opt) + "</div></div>"; }

  /* ---------------- 내보내기용 — 색·꾸밈을 풀어 서버로 ---------------- */
  function exFill(f, T, dark) {
    if (!f || f === "none") return null;
    if (typeof f === "object") { if (f.g) return { g: [col(f.g[0], T, dark), col(f.g[1], T, dark)], angle: f.a == null ? 135 : f.a }; return { c: col(f.c, T, dark), a: f.a }; }
    const c = col(f, T, dark); const m = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(c);
    if (m) return { c: "#" + [m[1], m[2], m[3]].map((x) => (+x).toString(16).padStart(2, "0")).join(""), a: +m[4] };
    return { c: c };
  }
  function parasOf(html, T, dark) {
    const t = document.createElement("template"); t.innerHTML = html || ""; const out = [];
    const cssCol = (s) => { const m = /color:\s*(#[0-9a-f]{3,8}|rgb\([^)]*\))/i.exec(s || ""); if (!m) return null; const c = m[1]; if (c[0] === "#") return c; const q = c.match(/\d+/g); return "#" + q.slice(0, 3).map((x) => (+x).toString(16).padStart(2, "0")).join(""); };
    const fs = (s) => { const m = /font-size:\s*([\d.]+)px/i.exec(s || ""); return m ? +m[1] : null; };
    function runs(n, st, acc) { Array.from(n.childNodes).forEach((c) => { if (c.nodeType === 3) { if (c.nodeValue) acc.push(Object.assign({ t: c.nodeValue }, st)); return; } if (c.nodeType !== 1) return; const tg = c.tagName; if (tg === "BR") { acc.push({ br: 1 }); return; } if (/^(UL|OL)$/.test(tg)) return; const nx = Object.assign({}, st); if (tg === "B" || tg === "STRONG") nx.b = true; if (tg === "I" || tg === "EM") nx.i = true; if (tg === "U") nx.u = true; const sty = c.getAttribute("style") || ""; const cc = cssCol(sty); if (cc) nx.color = cc; const f = fs(sty); if (f) nx.fs = f; if (/font-weight:\s*(bold|[6-9]00)/.test(sty)) nx.b = true; runs(c, nx, acc); }); }
    function push(node, extra) { const acc = []; runs(node, {}, acc); let cur = []; const flush = () => { out.push(Object.assign({ runs: cur }, extra)); cur = []; }; acc.forEach((r) => { if (r.br) flush(); else cur.push(r); }); flush(); }
    function walk(p, level) { let inl = document.createElement("div"); const flushI = () => { if (inl.childNodes.length && inl.textContent.trim()) push(inl, {}); inl = document.createElement("div"); }; Array.from(p.childNodes).forEach((c) => { if (c.nodeType === 1 && /^(UL|OL)$/.test(c.tagName)) { flushI(); Array.from(c.children).forEach((li) => { push(li, { bullet: c.tagName === "OL" ? "num" : "dot", level: level }); Array.from(li.children).forEach((x) => { if (/^(UL|OL)$/.test(x.tagName)) { const w = document.createElement("div"); w.appendChild(x.cloneNode(true)); walk(w, level + 1); } }); }); } else if (c.nodeType === 1 && /^(P|DIV)$/.test(c.tagName)) { flushI(); if (Array.from(c.children).some((x) => /^(UL|OL)$/.test(x.tagName))) walk(c, level); else push(c, /text-align:\s*(left|center|right|justify)/.test(c.getAttribute("style") || "") ? { align: RegExp.$1 } : {}); } else inl.appendChild(c.cloneNode(true)); }); flushI(); }
    const w = document.createElement("div"); w.appendChild(t.content.cloneNode(true)); walk(w, 0);
    return out;
  }
  function exEl(e, T, dark) {
    const o = { type: e.type, x: e.x, y: e.y, w: e.w, h: e.h, r: e.r || 0 };
    if (e.op != null) o.op = e.op;
    if (e.type === "text" || e.type === "shape") Object.assign(o, { paras: e.html ? parasOf(e.html, T, dark) : null, fs: e.fs || 24, color: col(e.color || "$ink", T, dark), b: !!e.b, i: !!e.i, align: e.align, valign: e.valign, lh: e.lh, px: e.px || (e.type === "shape" ? 10 : 0), py: e.py || 0, fill: exFill(e.fill, T, dark) });
    if (e.type === "text" && !o.fill) delete o.fill;
    if (e.type === "text" && o.color && o.color.indexOf("rgba") === 0) o.color = col("$muted", T, false);
    if (e.type === "shape") Object.assign(o, { shape: e.shape, radius: e.radius, stroke: e.stroke ? col(e.stroke, T, dark) : null, sw: e.sw });
    if (e.type === "line") Object.assign(o, { stroke: col(e.stroke || "$ink", T, dark), sw: e.sw || 2 });
    if (e.type === "image") o.src = e.src;
    if (e.type === "table") Object.assign(o, { rows: e.rows, fs: e.fs || 20, head: e.head !== false, headFill: col("$accent", T, dark), headInk: col("$on", T, dark), color: col("$ink", T, dark), cellFill: typeof T.bg === "string" ? T.bg : "#ffffff", zebra: col("$surface", T, dark) });
    if (e.type === "chart") Object.assign(o, { chart: e.chart, fs: e.fs || 18, color: col("$ink", T, dark), pal: T.pal, grid: col("$line", T, dark) });
    return o;
  }
  function exportDeck(deck) {
    const base = theme(deck.theme), N = deck.slides.length;
    return { title: deck.title, slides: deck.slides.map((s, i) => {
      const dark = !!s.dark, T = Object.assign({}, base, { tt2: dark ? base.cink : (base.deco === "band" ? base.ink : base.tt) }); if (base.deco === "band" && (s.layout === "big" || s.layout === "quote")) T.deco = "none";
      return { bg: exFill(s.bg || (dark ? base.cover : base.bg), T, false), hidden: !!s.hidden, note: s.note || "", els: deco(T, dark, i + 1, N, deck.footer ? deck.title : "").concat(s.els || []).map((e) => exEl(e, T, dark)) };
    }) };
  }

  /* ---------------- 발표자료 양식 ---------------- */
  const T = (layout, o) => Object.assign({ layout: layout }, o || {});
  const TEMPLATES = [
    { id: "project", ico: "🔬", name: "연구 과제 발표", desc: "배경 → 목표 → 내용 → 일정 → 기대 효과", theme: "clean", slides: [T("cover", { title: "연구 과제 제목", sub: "연구개발계획 발표", meta: "주관기관 · 연구책임자 · 발표일" }), T("bullets", { title: "왜 이 연구가 필요한가", items: ["현장의 문제와 규모", "기존 방법의 한계", "지금 해야 하는 이유"] }), T("kpi", { title: "연구 목표 — 숫자로 보기", kpis: [{ v: "00%", l: "핵심 성능", d: "현재 대비 목표치" }, { v: "00건", l: "실증", d: "실증 대상·규모" }, { v: "00개", l: "성과물", d: "특허·논문·기술이전" }] }), T("process", { title: "연구 내용과 추진 체계", steps: [{ h: "데이터 구축", d: "내용을 적으세요" }, { h: "모델 개발", d: "내용을 적으세요" }, { h: "실증", d: "내용을 적으세요" }, { h: "확산", d: "내용을 적으세요" }] }), T("timeline", { title: "연차별 추진 일정", steps: [{ t: "1차년도", h: "기반 구축" }, { t: "2차년도", h: "핵심 기술 개발" }, { t: "3차년도", h: "실증·확산" }] }), T("grid", { title: "기대 효과", cards: [{ h: "기술적 효과", d: "내용" }, { h: "경제적 효과", d: "내용" }, { h: "사회적 효과", d: "내용" }, { h: "활용 계획", d: "내용" }] }), T("closing", {})] },
    { id: "midterm", ico: "📈", name: "중간·결과 보고", desc: "목표 대비 실적, 이슈, 다음 계획", theme: "gov", slides: [T("cover", { title: "과제 진행 보고", sub: "중간 점검", meta: "발표일 · 발표자" }), T("kpi", { title: "한눈에 보는 진도", kpis: [{ v: "62%", l: "전체 진도", d: "계획 60%" }, { v: "0건", l: "지연 과제", d: "사유·조치" }, { v: "00%", l: "예산 집행", d: "계획 대비" }] }), T("table", { title: "세부 과제별 실적", rows: [["세부 과제", "목표", "실적", "상태"], ["과제 1", "", "", "정상"], ["과제 2", "", "", "정상"], ["과제 3", "", "", "지연"]] }), T("chart", { title: "월별 추진 실적", items: ["핵심 해석을 한두 줄로"] }), T("bullets", { title: "이슈와 대응", items: ["이슈 1 — 대응 방안", "이슈 2 — 대응 방안"] }), T("timeline", { title: "다음 분기 계획", steps: [{ t: "1월", h: "할 일" }, { t: "2월", h: "할 일" }, { t: "3월", h: "할 일" }] }), T("closing", {})] },
    { id: "paper", ico: "📄", name: "논문 발표", desc: "문제 → 방법 → 실험 → 결론", theme: "mono", slides: [T("cover", { title: "논문 제목", sub: "학회 이름", meta: "저자 · 소속" }), T("bullets", { title: "연구 질문", items: ["어떤 문제를 푸는가", "왜 어려운가", "우리의 기여"] }), T("compare", { title: "관련 연구와의 차이", left: { h: "기존 연구", items: ["한계 1", "한계 2"] }, right: { h: "제안 방법", items: ["강점 1", "강점 2"] } }), T("imgleft", { title: "제안 방법", items: ["구조 설명", "핵심 아이디어"] }), T("chart", { title: "실험 결과", items: ["기준선 대비 개선"] }), T("big", { title: "핵심 결론을 한 문장으로", sub: "의의와 다음 연구" }), T("closing", { sub: "질문을 받겠습니다" })] },
    { id: "pitch", ico: "🚀", name: "사업 제안", desc: "문제 → 해법 → 시장 → 계획", theme: "aurora", slides: [T("cover", { title: "제안 제목", sub: "한 줄 가치 제안", meta: "제안사 · 날짜" }), T("big", { title: "고객이 겪는 가장 큰 문제를 한 문장으로" }), T("grid", { title: "우리의 해법", cards: [{ h: "기능 1", d: "고객이 얻는 것" }, { h: "기능 2", d: "고객이 얻는 것" }, { h: "기능 3", d: "고객이 얻는 것" }] }), T("kpi", { title: "시장과 기회", kpis: [{ v: "0조 원", l: "전체 시장" }, { v: "00%", l: "연 성장률" }, { v: "00만", l: "목표 고객" }] }), T("timeline", { title: "실행 계획", steps: [{ t: "1단계", h: "출시" }, { t: "2단계", h: "확장" }, { t: "3단계", h: "수익화" }] }), T("closing", { title: "함께해 주세요" })] },
    { id: "seminar", ico: "🎓", name: "세미나·강의", desc: "개념 → 예시 → 실습 → 요약", theme: "forest", slides: [T("cover", { title: "세미나 주제", sub: "부제목", meta: "발표자 · 날짜" }), T("bullets", { title: "오늘 다룰 내용", items: ["개념 이해", "사례 살펴보기", "직접 해 보기"] }), T("section", { no: "01", title: "개념 이해" }), T("two", { title: "핵심 개념", left: { h: "개념 A", items: ["설명"] }, right: { h: "개념 B", items: ["설명"] } }), T("section", { no: "02", title: "사례" }), T("imgleft", { title: "사례 소개", items: ["무엇을 했나", "무엇을 배웠나"] }), T("bullets", { title: "정리", items: ["핵심 1", "핵심 2", "핵심 3"] }), T("closing", {})] },
    { id: "meeting", ico: "🗂", name: "회의 보고", desc: "현황 → 쟁점 → 결정 요청", theme: "navy", slides: [T("cover", { title: "회의 안건", sub: "보고 목적", meta: "부서 · 날짜" }), T("kpi", { title: "현황 요약", kpis: [{ v: "00", l: "지표" }, { v: "00", l: "지표" }] }), T("compare", { title: "대안 비교", left: { h: "A안", items: ["장점", "단점"] }, right: { h: "B안", items: ["장점", "단점"] } }), T("big", { title: "결정이 필요한 사항", sub: "권고안" }), T("closing", { title: "논의 부탁드립니다", sub: "" })] },
  ];
  function deckFrom(tpl, title) {
    const d = { title: title || (tpl ? tpl.name : "새 발표자료"), theme: (tpl && tpl.theme) || "clean", minutes: 10, aud: "심사위원", footer: false, slides: (tpl ? tpl.slides : [{ layout: "cover", title: title || "" }]).map(fromData), runs: [] };
    return d;
  }
  /* (옛 발표 스튜디오 자료) {title,layout:bullets|title|big|two,bullets,note} → 새 구조 */
  function migrate(old) {
    const map = { title: "cover", big: "big", two: "two", bullets: "bullets" };
    const th = { blue: "clean", navy: "navy", green: "forest", warm: "sunset", mono: "mono" }[old.theme] || "clean";
    const slides = (old.slides || []).map((s) => { const b = s.bullets || [], k = map[s.layout] || "bullets", half = Math.ceil(b.length / 2); return fromData({ layout: k, title: s.title, sub: b[0], items: b, left: { h: "", items: b.slice(0, half) }, right: { h: "", items: b.slice(half) }, note: s.note }); });
    return { title: old.title, theme: th, minutes: old.minutes || 10, aud: old.aud || "", did: old.did || "", runs: old.runs || [], footer: false, slides: slides };
  }
  const SHAPE_HELP = 'layout 은 cover|section|bullets|two|compare|kpi|process|timeline|grid|big|quote|imgleft|table|chart|closing 중 하나.\n' +
    '{"layout":"cover","title":"","sub":"","meta":""}\n{"layout":"section","no":"01","title":""}\n{"layout":"bullets","title":"","items":[""]}\n{"layout":"two","title":"","left":{"h":"","items":[""]},"right":{"h":"","items":[""]}}\n{"layout":"compare","title":"","left":{"h":"","items":[""]},"right":{"h":"","items":[""]}}\n{"layout":"kpi","title":"","kpis":[{"v":"62%","l":"라벨","d":"설명"}]}  (2~4개)\n{"layout":"process","title":"","steps":[{"h":"단계","d":"설명"}]}  (3~6개)\n{"layout":"timeline","title":"","steps":[{"t":"시점","h":"제목","d":"설명"}]}  (3~6개)\n{"layout":"grid","title":"","cards":[{"h":"","d":""}]}  (2~6개)\n{"layout":"big","title":"핵심 한 문장","sub":""}\n{"layout":"quote","quote":"","by":""}\n{"layout":"imgleft","title":"","items":[""]}\n{"layout":"table","title":"","rows":[["머리글"],["값"]]}\n{"layout":"chart","title":"","chart":{"type":"col|bar|line|pie|doughnut","labels":[""],"series":[{"name":"","vals":[0]}]},"items":["해석 한 줄"]}\n{"layout":"closing","title":"감사합니다","sub":""}\n모든 슬라이드에 "note"(대본, 구어체)를 넣으세요.';
  return { W: W, H: H, THEMES: THEMES, LAYOUTS: LAYOUTS, TEMPLATES: TEMPLATES, theme: theme, col: col, fillCss: fillCss, fromData: fromData, dataOf: dataOf, plain: plain, slideHtml: slideHtml, thumb: thumb, elHtml: elHtml, exportDeck: exportDeck, deckFrom: deckFrom, migrate: migrate, uid: uid, SHAPE_HELP: SHAPE_HELP };
})();
