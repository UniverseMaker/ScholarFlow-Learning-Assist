/* =============================================================================
 * toolsets2.js (v98) — 차별화 도구 24종(자료 학습 12 · 연구지원 12)
 *   toolsets.js 가 연 window.TOOLSETS(도구 목록·도우미)에 도구를 앞쪽에 더한다 — 도구함·연구 도구 탭 맨 위 "✨" 묶음.
 *   자료 학습: 기억 가림판 · 어려운 단어 풀이(루비) · 문단 아래 번역 · 빠른 읽기 표시 · 내 노트 전체에 묻기 · 학습 경로 ·
 *             그림으로 보기 · 반론 연습 · 오늘의 학습 일지 · 말로 설명하기(음성) · 다시 읽기 일정 · 이해도 지도
 *   연구지원: 모의 평가위원회 · 질의응답 훈련(음성) · 제안 모드(수락/거절) · 선행연구 지형도 · 신규성 검토 · 주장–근거 지도 ·
 *             발표 리허설(타이머·말 빠르기·군말) · 길이별 브리핑 · 프로젝트 지식 그래프 · 문장 진단 · 오디오 브리핑 · 폴더 변화 감시
 *   근거 조사: research/tools_survey.json · tools_survey2.json
 * ========================================================================== */
(function () {
  "use strict";
  const T = window.TOOLSETS; if (!T || !window.TK) return;
  const L = T.L, C = T.C, arr = T.arr, clip = T.clip;
  const esc = TK.esc, $ = (id) => document.getElementById(id);
  const GL = "✨ 새 학습법", GR = "✨ 새 연구 도구";
  const today = () => new Date().toISOString().slice(0, 10);
  const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

  /* ---------------- 공용: 문서(iframe) 조작 ---------------- */
  function docStyle(id, css) { const d = L.doc(); if (!d) return; let st = d.getElementById(id); if (!st) { st = d.createElement("style"); st.id = id; d.head.appendChild(st); } st.textContent = css; }
  // 범위의 문단 요소들(지금 읽는 부분 = 화면 위쪽에 걸린 제목부터 다음 같은/상위 제목 전까지)
  function scopeEls(scope) {
    const all = L.paras(); if (scope === "all") return all;
    const d = L.doc(); if (!d) return [];
    const hs = Array.from(d.querySelectorAll("h1, h2, h3")).filter((h) => h.offsetParent !== null);
    let cur = null; for (const h of hs) { if (h.getBoundingClientRect().top <= 140) cur = h; else break; }
    if (!cur) return all.filter((p) => { const r = p.el.getBoundingClientRect(); return r.bottom > 0 && r.top < (d.defaultView.innerHeight || 800) * 1.5; });
    const idx = hs.indexOf(cur), next = hs.slice(idx + 1).find((h) => +h.tagName[1] <= +cur.tagName[1]);
    return all.filter((p) => (cur.compareDocumentPosition(p.el) & 4) && (!next || (next.compareDocumentPosition(p.el) & 2)));
  }
  function wrapFirst(root, word, makeNode) {   // root 안 텍스트에서 word 의 첫 등장을 makeNode() 로 감싼다
    const d = root.ownerDocument, w = d.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      const n = w.currentNode; if (n.parentElement && n.parentElement.closest("ruby, .tk-tr, code, pre")) continue;
      const i = n.nodeValue.indexOf(word); if (i < 0) continue;
      const after = n.splitText(i); after.nodeValue = after.nodeValue.slice(word.length);
      n.parentNode.insertBefore(makeNode(d, word), after); return true;
    }
    return false;
  }
  // 음성 받아쓰기(Web Speech API) — 지원하지 않는 브라우저는 null
  function stt(onText) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR) return null;
    const r = new SR(); r.lang = "ko-KR"; r.continuous = true; r.interimResults = true;
    let final = "", on = false;
    r.onresult = (e) => { let interim = ""; for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) final += t + " "; else interim += t; } onText(final, interim); };
    r.onend = () => { if (on) { try { r.start(); } catch (er) { /* 계속 */ } } };
    return { start() { final = ""; on = true; try { r.start(); } catch (e) { /* 이미 시작 */ } }, stop() { on = false; try { r.stop(); } catch (e) { /* 계속 */ } }, text: () => final };
  }
  function speak(text, rate) { try { const s = window.speechSynthesis; s.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = /[가-힣]/.test(text) ? "ko-KR" : "en-US"; u.rate = rate || 1; s.speak(u); } catch (e) { /* 계속 */ } }
  function radarSvg(labels, values, max) {
    const n = labels.length, cx = 160, cy = 150, R = 105; if (n < 3) return "";
    const pt = (i, v) => { const a = -Math.PI / 2 + i * 2 * Math.PI / n; return [cx + Math.cos(a) * R * v / max, cy + Math.sin(a) * R * v / max]; };
    let s = '<svg class="tk-radar" viewBox="0 0 320 300" role="img" aria-label="평가 항목별 점수">';
    [0.25, 0.5, 0.75, 1].forEach((k) => { s += '<polygon class="rg" points="' + labels.map((_, i) => pt(i, max * k).join(",")).join(" ") + '"/>'; });
    labels.forEach((l, i) => { const p = pt(i, max * 1.17); s += '<line class="ra" x1="' + cx + '" y1="' + cy + '" x2="' + pt(i, max)[0] + '" y2="' + pt(i, max)[1] + '"/><text x="' + p[0] + '" y="' + p[1] + '" class="rl">' + esc(String(l).slice(0, 10)) + "</text>"; });
    s += '<polygon class="rv" points="' + values.map((v, i) => pt(i, Math.max(0, Math.min(max, +v || 0))).join(",")).join(" ") + '"/>';
    values.forEach((v, i) => { const p = pt(i, +v || 0); s += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="3.5" class="rd"><title>' + esc(labels[i] + " " + v) + "</title></circle>"; });
    return s + "</svg>";
  }
  // 흐름도 — 층(BFS) 배치
  function flowSvg(g) {
    const nodes = arr(g.nodes).slice(0, 14), ids = nodes.map((n) => String(n.id)), edges = arr(g.edges).filter((e) => ids.indexOf(String(e.from)) >= 0 && ids.indexOf(String(e.to)) >= 0);
    const indeg = {}; ids.forEach((i) => { indeg[i] = 0; }); edges.forEach((e) => { indeg[e.to]++; });
    const lvl = {}; const q = ids.filter((i) => !indeg[i]); if (!q.length && ids.length) q.push(ids[0]); q.forEach((i) => { lvl[i] = 0; });
    for (let k = 0; k < q.length; k++) { edges.filter((e) => String(e.from) === q[k]).forEach((e) => { const t = String(e.to); if (lvl[t] == null || lvl[t] < lvl[q[k]] + 1) { if ((lvl[q[k]] || 0) < 8) { lvl[t] = (lvl[q[k]] || 0) + 1; q.push(t); } } }); }
    ids.forEach((i) => { if (lvl[i] == null) lvl[i] = 0; });
    const rows = {}; ids.forEach((i) => { (rows[lvl[i]] = rows[lvl[i]] || []).push(i); });
    const W = 720, bw = 150, bh = 46, gy = 86, pos = {};
    Object.keys(rows).forEach((r) => { const row = rows[r]; row.forEach((i, k) => { pos[i] = [(W / (row.length + 1)) * (k + 1), 30 + (+r) * gy]; }); });
    const H = 60 + (Math.max.apply(null, Object.keys(rows).map(Number)) + 1) * gy;
    const lab = (i) => { const n = nodes.find((x) => String(x.id) === i); return String((n && n.label) || i); };
    let s = '<svg class="tk-flow" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(g.title || "흐름도") + '"><defs><marker id="tkArr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" class="fa"/></marker></defs>';
    edges.forEach((e) => { const a = pos[e.from], b = pos[e.to]; if (!a || !b) return; const y1 = a[1] + bh / 2, y2 = b[1] - bh / 2; s += '<path class="fe" d="M' + a[0] + "," + y1 + " C" + a[0] + "," + (y1 + 30) + " " + b[0] + "," + (y2 - 30) + " " + b[0] + "," + y2 + '" marker-end="url(#tkArr)"/>' + (e.label ? '<text class="fl" x="' + (a[0] + b[0]) / 2 + '" y="' + ((y1 + y2) / 2 - 3) + '">' + esc(String(e.label).slice(0, 14)) + "</text>" : ""); });
    ids.forEach((i) => { const p = pos[i], t = lab(i), l1 = t.slice(0, 13), l2 = t.slice(13, 26); s += '<g><rect class="fn" x="' + (p[0] - bw / 2) + '" y="' + (p[1] - bh / 2) + '" width="' + bw + '" height="' + bh + '" rx="10"/><text class="ft" x="' + p[0] + '" y="' + (p[1] + (l2 ? -3 : 5)) + '">' + esc(l1) + "</text>" + (l2 ? '<text class="ft" x="' + p[0] + '" y="' + (p[1] + 13) + '">' + esc(l2) + "</text>" : "") + "<title>" + esc(t) + "</title></g>"; });
    return s + "</svg>";
  }
  // 관계도 — 간단한 힘 배치(용수철)
  function graphSvg(nodes, edges) {
    const W = 760, H = 520, P = {}; nodes.forEach((n, i) => { const a = i * 2.399; P[n.id] = { x: W / 2 + Math.cos(a) * (40 + i * 9), y: H / 2 + Math.sin(a) * (40 + i * 7), vx: 0, vy: 0 }; });
    for (let it = 0; it < 260; it++) {
      nodes.forEach((a) => nodes.forEach((b) => { if (a === b) return; const p = P[a.id], q = P[b.id], dx = p.x - q.x, dy = p.y - q.y, d2 = dx * dx + dy * dy + 0.01, f = 2600 / d2; p.vx += dx * f / 60; p.vy += dy * f / 60; }));
      edges.forEach((e) => { const p = P[e.from], q = P[e.to]; if (!p || !q) return; const dx = q.x - p.x, dy = q.y - p.y, d = Math.sqrt(dx * dx + dy * dy) || 1, f = (d - 120) * 0.012; p.vx += dx / d * f * 10; p.vy += dy / d * f * 10; q.vx -= dx / d * f * 10; q.vy -= dy / d * f * 10; });
      nodes.forEach((n) => { const p = P[n.id]; p.vx += (W / 2 - p.x) * 0.002; p.vy += (H / 2 - p.y) * 0.002; p.x += p.vx; p.y += p.vy; p.vx *= 0.5; p.vy *= 0.5; p.x = Math.max(60, Math.min(W - 60, p.x)); p.y = Math.max(24, Math.min(H - 24, p.y)); });
    }
    const COL = { 기관: "#2563eb", 사람: "#db2777", 기술: "#7c3aed", 지표: "#059669", 과제: "#d97706", 개념: "#0891b2" };
    let s = '<svg class="tk-graph" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="관계도">';
    edges.forEach((e) => { const p = P[e.from], q = P[e.to]; if (!p || !q) return; s += '<line class="ge" x1="' + p.x + '" y1="' + p.y + '" x2="' + q.x + '" y2="' + q.y + '"/>' + (e.label ? '<text class="gl" x="' + (p.x + q.x) / 2 + '" y="' + (p.y + q.y) / 2 + '">' + esc(String(e.label).slice(0, 12)) + "</text>" : ""); });
    nodes.forEach((n) => { const p = P[n.id]; s += '<g class="gnode" data-gq="' + esc(n.label) + '"><circle cx="' + p.x + '" cy="' + p.y + '" r="9" fill="' + (COL[n.type] || "#64748b") + '"/><text class="gt" x="' + p.x + '" y="' + (p.y - 13) + '">' + esc(String(n.label).slice(0, 16)) + "</text><title>" + esc(n.label + " · " + (n.type || "")) + "</title></g>"; });
    return s + '</svg><p class="tk-legend">' + Object.keys(COL).map((k) => '<span><i style="background:' + COL[k] + '"></i>' + k + "</span>").join("") + "</p>";
  }

  /* =====================================================================
   * A. 자료 학습 — 새 학습법 12
   * =================================================================== */
  const LIBX = [
    { id: "recall", group: GL, ico: "🙈", name: "기억 가림판", desc: "문단을 흐리게 가리고, 떠올려 본 뒤 눌러서 확인(인출 연습) — 기억남/헷갈림 기록", go: "가리기 시작",
      inputs: [{ id: "mode", label: "가리는 정도", type: "select", options: [["blur", "흐리게(눈치챌 수 있게)"], ["hide", "완전히(제목만 보고 떠올리기)"]] }],
      run: async (c, io, v) => {
        const els = scopeEls(v.scope); if (!els.length) throw new Error("문서를 먼저 열어 주세요.");
        const d = L.doc(), key = L.key("recall"), rec = TK.store.get(key, { ok: 0, unsure: 0, at: 0 });
        docStyle("tkRecallCss", ".tk-veil{filter:blur(" + (v.mode === "hide" ? "12px" : "5px") + ");opacity:" + (v.mode === "hide" ? ".25" : ".8") + ";cursor:pointer;transition:filter .2s;user-select:none}.tk-veil:hover{filter:blur(" + (v.mode === "hide" ? "10px" : "3px") + ")}.tk-rate{display:inline-flex;gap:6px;margin:4px 0 10px}.tk-rate button{font:600 12px sans-serif;padding:3px 10px;border-radius:99px;border:1px solid #cbd5e1;background:#fff;cursor:pointer}.tk-rate button.ok{border-color:#059669;color:#059669}.tk-rate button.no{border-color:#d97706;color:#d97706}");
        els.forEach((p) => p.el.classList.add("tk-veil"));
        const paint = () => io.html('<p class="tk-sum">가린 문단 ' + d.querySelectorAll(".tk-veil").length + " · 이번에 기억남 " + rec.ok + " · 헷갈림 " + rec.unsure + '</p><p class="sh-muted">문단마다 내용을 먼저 떠올려 보고 누르세요. 열고 나면 [기억남]/[헷갈림]을 눌러 두면 헷갈린 문단만 다시 볼 수 있어요.</p><div class="lb-row"><button type="button" class="ghost-btn small-btn" id="tkRcAgain">헷갈린 문단만 다시 가리기</button><button type="button" class="ghost-btn small-btn" id="tkRcOff">가림 모두 끄기</button></div>', "기억 가림판: 기억남 " + rec.ok + " · 헷갈림 " + rec.unsure, "기억 가림판");
        paint();
        if (!d._tkRecall) {
          d._tkRecall = true;
          d.addEventListener("click", (e) => {
            const p = e.target.closest && e.target.closest(".tk-veil");
            if (p) { e.preventDefault(); p.classList.remove("tk-veil"); if (!p.nextElementSibling || !p.nextElementSibling.classList.contains("tk-rate")) { const r = d.createElement("div"); r.className = "tk-rate"; r.innerHTML = '<button class="ok">😀 기억남</button><button class="no">🤔 헷갈림</button>'; p.after(r); } return; }
            const b = e.target.closest && e.target.closest(".tk-rate button"); if (!b) return;
            const r = TK.store.get(key, { ok: 0, unsure: 0 }); const para = b.parentElement.previousElementSibling;
            if (b.classList.contains("ok")) { r.ok++; para.dataset.tkUnsure = ""; } else { r.unsure++; para.dataset.tkUnsure = "1"; }
            r.at = Date.now(); TK.store.set(key, r); rec.ok = r.ok; rec.unsure = r.unsure; b.parentElement.remove(); paint();
          }, true);
        }
        io.el.onclick = (e) => {
          if (e.target.id === "tkRcAgain") { d.querySelectorAll('[data-tk-unsure="1"]').forEach((x) => x.classList.add("tk-veil")); paint(); }
          if (e.target.id === "tkRcOff") { d.querySelectorAll(".tk-veil").forEach((x) => x.classList.remove("tk-veil")); d.querySelectorAll(".tk-rate").forEach((x) => x.remove()); paint(); }
        };
      } },
    { id: "gloss", group: GL, ico: "🔤", name: "어려운 단어 풀이", desc: "어려운 단어 바로 위에 짧은 뜻을 작게 달아 줘요(킨들 Word Wise 식) — 다시 누르면 지움", ai: true,
      run: async (c, io, v) => {
        const d = L.doc(); if (!d) throw new Error("문서를 먼저 열어 주세요.");
        if (d.querySelector("ruby.tk-gl")) { d.querySelectorAll("ruby.tk-gl").forEach((r) => r.replaceWith(d.createTextNode(r.firstChild.nodeValue))); io.md("단어 풀이를 지웠어요."); return; }
        const els = scopeEls(v.scope), text = clip(els.map((p) => p.text).join("\n"), 9000); if (!text) throw new Error("문서를 먼저 열어 주세요.");
        io.busy("어려운 단어를 고르는 중…");
        const r = await TK.aiJSON({ user: "다음 글에서 학습자가 막힐 만한 어려운 단어·표현 15~30개를 고르세요. w 는 글에 적힌 그대로(대소문자·띄어쓰기 동일), g 는 아주 짧은 풀이(영어면 한국어 뜻 2~6자, 한국어 전문용어면 쉬운 말 3~8자).\n\n" + text, shape: '{"terms":[{"w":"","g":""}]}', tokens: 1600 });
        docStyle("tkGlossCss", "ruby.tk-gl{ruby-position:over}ruby.tk-gl rt{font-size:.58em;color:#2563eb;font-weight:600;letter-spacing:0}");
        let n = 0; arr(r.terms).forEach((t) => { if (!t.w || !t.g) return; for (const p of els) { if (wrapFirst(p.el, t.w, (doc, w) => { const rb = doc.createElement("ruby"); rb.className = "tk-gl"; rb.appendChild(doc.createTextNode(w)); const rt = doc.createElement("rt"); rt.textContent = t.g; rb.appendChild(rt); return rb; })) { n++; break; } } });
        io.table([["w", "단어"], ["g", "풀이"]], arr(r.terms), "어려운 단어 " + n + "개 풀이", { before: '<p class="tk-sum">문서 안 ' + n + "곳에 풀이를 달았어요. 다시 누르면 지워요.</p>" });
      } },
    { id: "inlinetr", group: GL, ico: "🌐", name: "문단 아래 번역", desc: "원문은 그대로 두고 문단마다 바로 아래에 번역을 펼쳐요 — 다시 누르면 접음", ai: true,
      run: async (c, io, v) => {
        const d = L.doc(); if (!d) throw new Error("문서를 먼저 열어 주세요.");
        if (d.querySelector(".tk-tr")) { d.querySelectorAll(".tk-tr").forEach((x) => x.remove()); io.md("문단 번역을 접었어요."); return; }
        const els = scopeEls(v.scope === "all" ? "sec" : v.scope).slice(0, 24); if (!els.length) throw new Error("번역할 문단이 없어요.");
        io.busy("문단 " + els.length + "개 번역 중…");
        const r = await TK.aiJSON({ user: "다음 번호 붙은 문단을 각각 번역하세요(영어→한국어, 한국어→영어). 문단 수와 순서를 그대로.\n\n" + els.map((p, i) => i + ": " + p.text.slice(0, 700)).join("\n"), shape: '{"t":["번역0","번역1"]}', tokens: 3600 });
        docStyle("tkTrCss", ".tk-tr{margin:-4px 0 12px;padding:8px 12px;border-left:3px solid #7c3aed;background:rgba(124,58,237,.06);border-radius:6px;font-size:.93em;color:inherit;opacity:.92}");
        arr(r.t).forEach((t, i) => { const p = els[i]; if (!p || !t) return; const x = d.createElement("div"); x.className = "tk-tr"; x.textContent = t; p.el.after(x); });
        io.md("문단 " + arr(r.t).length + "개 아래에 번역을 펼쳤어요. (문서 전체는 너무 길어 지금 읽는 부분만 — 범위를 '선택한 부분'으로 해도 돼요)", "문단 아래 번역");
      } },
    { id: "bionic", group: GL, ico: "⚡", name: "빠른 읽기 표시", desc: "단어 앞부분을 굵게 해 눈이 빨리 따라가게(바이오닉 리딩) — 다시 누르면 원래대로",
      run: async (c, io, v) => {
        const d = L.doc(), root = L.root(); if (!root) throw new Error("문서를 먼저 열어 주세요.");
        if (d.querySelector("b.tk-bi")) { d.querySelectorAll("b.tk-bi").forEach((b) => b.replaceWith(d.createTextNode(b.textContent))); root.normalize(); io.md("빠른 읽기 표시를 껐어요."); return; }
        const w = d.createTreeWalker(root, NodeFilter.SHOW_TEXT), nodes = []; while (w.nextNode()) { const n = w.currentNode; if (n.nodeValue.trim().length > 2 && !n.parentElement.closest("code, pre, ruby, script, style, .tk-tr, svg, h1, h2, h3, h4")) nodes.push(n); }
        let k = 0;
        nodes.forEach((n) => {
          const parts = n.nodeValue.split(/(\s+)/); if (parts.length < 2 && n.nodeValue.length < 4) return;
          const frag = d.createDocumentFragment();
          parts.forEach((t) => { if (!t.trim() || t.length < 2) { frag.appendChild(d.createTextNode(t)); return; } const cut = /[가-힣]/.test(t) ? (t.length >= 3 ? 1 : 0) : Math.ceil(t.length * 0.45); if (!cut) { frag.appendChild(d.createTextNode(t)); return; } const b = d.createElement("b"); b.className = "tk-bi"; b.textContent = t.slice(0, cut); frag.appendChild(b); frag.appendChild(d.createTextNode(t.slice(cut))); k++; });
          n.parentNode.replaceChild(frag, n);
        });
        docStyle("tkBiCss", "b.tk-bi{font-weight:800}");
        io.md("단어 " + k.toLocaleString() + "개에 표시했어요. 다시 누르면 원래대로 돌아가요.", "빠른 읽기 표시");
      } },
    { id: "noteqa", group: GL, ico: "🧠", name: "내 노트 전체에 묻기", desc: "모든 문서의 내 노트·형광펜·북마크에서 찾아 답해요(내 지식 베이스)", ai: true, inputs: [{ id: "q", label: "질문", placeholder: "예: 트랜스포머와 RNN 차이를 내가 뭐라고 정리했지?" }],
      run: async (c, io, v) => {
        if (!v.q.trim()) throw new Error("질문을 적어 주세요.");
        let docs = []; try { docs = ((libState.catalog || {}).docs) || []; } catch (e) { docs = []; }
        const title = (id) => { const x = docs.find((d) => d.id === id); return x ? x.title : id; };
        const items = [], uid = (JSON.parse(localStorage.getItem("study.session") || "{}") || {}).user_id;
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i); let m;
          try {
            if ((m = /\.tk\.lib\.notes\.(.+)$/.exec(k)) && k.indexOf("study.user." + uid + ".") === 0) { const n = JSON.parse(localStorage.getItem(k)); if (n && n.t) n.t.split(/\n{2,}/).forEach((t) => { if (t.trim()) items.push({ src: "📝 " + title(m[1]), text: t.trim().slice(0, 900) }); }); }
            else if ((m = /^study\.reader\.hl\.(.+)$/.exec(k))) { arr(JSON.parse(localStorage.getItem(k))).forEach((h) => { const t = h.text || h.t || h; if (t) items.push({ src: "🖍 " + title(m[1]), text: String(t).slice(0, 600) }); }); }
          } catch (e) { /* 계속 */ }
        }
        if (!items.length) throw new Error("아직 노트·형광펜이 없어요. 문서를 읽으며 노트(🗒)나 형광펜(🖍)을 남기면 여기서 찾을 수 있어요.");
        const hits = T.bm25(items, v.q, 10); if (!hits.length) { io.md("내 노트·형광펜에서 관련된 것을 찾지 못했어요(" + items.length + "개 중)."); return; }
        io.busy("내 노트 " + items.length + "개에서 찾아 답하는 중…");
        const a = await TK.ai({ sys: "학습자 본인이 남긴 노트·형광펜만 근거로 답하세요. 문장마다 [번호] 로 근거를 붙이고, 노트에 없는 내용은 '노트에 없음'이라고 하세요.", user: "질문: " + v.q + "\n\n[내 노트·형광펜]\n" + hits.map((h, i) => "[" + (i + 1) + "] (" + h.src + ") " + h.text).join("\n\n") }, (f) => io.stream(f));
        io.md(a + "\n\n---\n" + hits.map((h, i) => "[" + (i + 1) + "] " + h.src).join("\n"), "내 노트에 묻기: " + v.q);
      } },
    { id: "path", group: GL, ico: "🗺", name: "학습 경로 만들기", desc: "목표를 말하면 학습 자료에서 읽을 순서를 짜 줘요 → 내 학습 폴더로 저장", ai: true, inputs: [{ id: "goal", label: "목표", placeholder: "예: 2주 안에 RAG 시스템을 직접 설계할 수 있게" }, { id: "hours", label: "쓸 수 있는 시간", type: "select", options: [["5", "5시간 이내"], ["15", "15시간 정도"], ["40", "40시간 이상"]] }],
      run: async (c, io, v) => {
        if (!v.goal.trim()) throw new Error("목표를 적어 주세요.");
        try { if (typeof libCatalog === "function") await libCatalog(); } catch (e) { /* 계속 */ }
        const docs = ((libState.catalog || {}).docs) || []; if (!docs.length) throw new Error("학습 자료 목록을 불러오지 못했어요.");
        io.busy("자료 " + docs.length + "편에서 경로를 짜는 중…");
        const r = await TK.aiJSON({ user: "학습 목표: " + v.goal + " (쓸 수 있는 시간 약 " + v.hours + "시간)\n아래 자료 목록(id|제목|수준|분)에서 목표에 필요한 것만 골라 쉬운 것→어려운 것, 선수 지식 순으로 배열하세요. 시간 안에 들어오게.\n\n" + docs.map((d) => d.id + "|" + d.title + "|" + (d.level || "") + "|" + (d.minutes || "")).join("\n"), shape: '{"title":"경로 이름","steps":[{"id":"자료 id","why":"왜 이 순서에(1문장)","focus":"집중해서 볼 것"}],"tip":"전체 조언 1문장"}', tokens: 2200 });
        const steps = arr(r.steps).filter((s) => docs.some((d) => d.id === s.id)); if (!steps.length) throw new Error("맞는 자료를 찾지 못했어요. 목표를 바꿔 보세요.");
        const mins = steps.reduce((a, s) => a + (+(docs.find((d) => d.id === s.id).minutes) || 0), 0);
        io.html('<p class="tk-sum">' + esc(r.title || "학습 경로") + " · " + steps.length + "편 · 약 " + Math.round(mins / 60 * 10) / 10 + '시간</p><ol class="tk-path">' + steps.map((s) => { const d = docs.find((x) => x.id === s.id); return "<li><b>" + esc(d.title) + "</b> <small>" + esc(d.level || "") + " · " + (d.minutes || "?") + "분</small><p>" + esc(s.why || "") + (s.focus ? "<br><i>집중: " + esc(s.focus) + "</i>" : "") + '</p><button type="button" class="ghost-btn small-btn" data-pathopen="' + esc(d.id) + '">열기</button></li>'; }).join("") + "</ol>" + (r.tip ? '<p class="sh-muted">💡 ' + esc(r.tip) + "</p>" : "") + '<div class="lb-row"><button type="button" class="primary small-btn" id="tkPathSave">📁 내 학습 폴더로 저장</button></div>',
          steps.map((s, i) => (i + 1) + ". " + docs.find((d) => d.id === s.id).title + " — " + (s.why || "")).join("\n"), "학습 경로 — " + (r.title || v.goal));
        io.el.onclick = (e) => {
          const o = e.target.closest("[data-pathopen]"); if (o) { window.libOpen && libOpen(o.dataset.pathopen); return; }
          if (e.target.id === "tkPathSave") { const fs = TK.store.get("lib.folders", []); fs.push({ id: "lf" + Date.now().toString(36), name: ("🗺 " + (r.title || v.goal)).slice(0, 40), docs: steps.map((s) => s.id), created: Date.now() }); TK.store.set("lib.folders", fs); e.target.textContent = "✓ 저장했어요(내 학습 폴더)"; }
        };
      } },
    { id: "diagram", group: GL, ico: "🎨", name: "그림으로 보기", desc: "글을 흐름도(상자·화살표)로 바꿔 한눈에 — 이중 부호화, SVG 로 내려받기", ai: true,
      run: async (c, io, v) => {
        const t = L.text(v.scope, 9000); io.busy("그림으로 정리하는 중…");
        const g = await TK.aiJSON({ user: "다음 내용의 핵심 흐름(과정·원인→결과·구성 요소 관계)을 흐름도로 만드세요. 상자 6~12개, 상자 글자는 짧게(14자 이내), 화살표 label 은 동사 2~6자.\n\n" + t, shape: '{"title":"","nodes":[{"id":"a","label":""}],"edges":[{"from":"a","to":"b","label":""}],"caption":"그림 설명 1~2문장"}', tokens: 1600 });
        const svg = flowSvg(g);
        io.html("<h4>" + esc(g.title || "흐름도") + "</h4>" + svg + (g.caption ? '<p class="sh-muted">' + esc(g.caption) + "</p>" : "") + '<div class="lb-row"><button type="button" class="ghost-btn small-btn" id="tkSvgDl">⬇ SVG 저장</button></div>', (g.title || "흐름도") + "\n" + arr(g.edges).map((e) => "- " + e.from + " → " + e.to + (e.label ? " (" + e.label + ")" : "")).join("\n"), "그림으로 보기");
        $("tkSvgDl").onclick = () => { const s = io.el.querySelector("svg.tk-flow"); TK.download(TK.slug(g.title || "흐름도") + ".svg", '<?xml version="1.0" encoding="UTF-8"?>' + s.outerHTML.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" style="font-family:sans-serif" '), "image/svg+xml"); };
      } },
    { id: "debate", group: GL, ico: "🥊", name: "반론 연습", desc: "AI 가 이 글의 주장에 가장 센 반론을 대고, 내 재반박을 평가해요(비판적 읽기)", ai: true, inputs: [{ id: "mine", label: "내 재반박(처음엔 비워 두고 실행)", type: "textarea", rows: 4 }],
      run: async (c, io, v) => {
        const key = L.key("debate"); const t = L.text(v.scope, 7000);
        if (!v.mine.trim()) {
          io.busy("반론을 세우는 중…");
          const r = await TK.aiJSON({ user: "다음 글의 핵심 주장 1~2개를 뽑고, 각각에 가장 강한 반론을 세우세요(근거 없는 비난 말고 학술적·논리적 반론). 학습자가 재반박할 때 쓸 힌트도.\n\n" + t, shape: '{"claims":[{"claim":"","counter":"","hint":""}]}', tokens: 1600 });
          TK.store.set(key, r);
          io.html(arr(r.claims).map((x, i) => '<div class="rp-card"><b>주장 ' + (i + 1) + ".</b> " + esc(x.claim) + '<p>🥊 <b>반론:</b> ' + esc(x.counter) + '</p><small>💡 재반박 힌트: ' + esc(x.hint) + "</small></div>").join("") + '<p class="sh-muted">위 칸에 내 재반박을 쓰고 다시 [✨ 실행]을 누르면 평가해 줘요.</p>', arr(r.claims).map((x) => "- 주장: " + x.claim + "\n  반론: " + x.counter).join("\n"), "반론 연습"); return;
        }
        const r = TK.store.get(key, null); if (!r) throw new Error("먼저 비워 둔 채 실행해 반론을 받아 주세요.");
        io.busy("재반박을 평가하는 중…");
        io.md(await TK.ai({ user: "[글의 주장과 AI 반론]\n" + arr(r.claims).map((x) => "주장: " + x.claim + "\n반론: " + x.counter).join("\n") + "\n\n[학습자 재반박]\n" + v.mine + "\n\n평가: ## 잘한 점 ## 약한 고리(반론이 여전히 유효한 지점) ## 더 강한 재반박 예시 ## 점수(10점 만점)", tokens: 1400 }, (f) => io.stream(f)), "반론 연습 — 평가");
      } },
    { id: "journal", group: GL, ico: "📓", name: "오늘의 학습 일지", desc: "오늘 읽은 문서·노트·형광펜·퀴즈를 모아 돌아보기 일지로(성찰) — 날짜별 보관",
      run: async (c, io) => {
        const d0 = new Date(); d0.setHours(0, 0, 0, 0); const t0 = d0.getTime();
        let docs = []; try { docs = ((libState.catalog || {}).docs) || []; } catch (e) { docs = []; }
        const title = (id) => { const x = docs.find((d) => d.id === id); return x ? x.title : id; };
        const notes = [], uid = (JSON.parse(localStorage.getItem("study.session") || "{}") || {}).user_id;
        for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); const m = /\.tk\.lib\.notes\.(.+)$/.exec(k); if (m && k.indexOf("study.user." + uid + ".") === 0) { try { const n = JSON.parse(localStorage.getItem(k)); if (n && n.at >= t0 && n.t) notes.push({ doc: title(m[1]), t: n.t }); } catch (e) { /* 계속 */ } } }
        const pomo = TK.store.get("pomo", []).filter((p) => p.t >= t0);
        let quiz = { n: 0, ok: 0 }; try { const ev = JSON.parse(localStorage.getItem("study.user." + uid + ".events") || "[]"); arr(ev).filter((e) => e.ts >= t0 && e.category === "학습 자료").forEach((e) => { quiz.n++; if (e.correct) quiz.ok++; }); } catch (e) { /* 계속 */ }
        const facts = "- 오늘 노트를 쓴 문서: " + (notes.map((n) => n.doc).join(", ") || "없음") + "\n- 집중(뽀모도로): " + pomo.length + "회\n- 학습 자료 퀴즈: " + quiz.ok + "/" + quiz.n + "\n- 지금 보는 문서: " + (L.id() ? L.title() : "-");
        let body = "## " + today() + " 학습 일지\n" + facts;
        const aiOk = (() => { try { return Api.llm.isConnected(); } catch (e) { return false; } })();
        if (aiOk && (notes.length || quiz.n)) {
          io.busy("일지를 쓰는 중…");
          try { body += "\n\n" + await TK.ai({ sys: "학습 코치입니다. 짧고 따뜻하게, 구체적으로.", user: "오늘 학습 기록:\n" + facts + "\n\n오늘 노트:\n" + clip(notes.map((n) => "[" + n.doc + "]\n" + n.t).join("\n\n"), 5000) + "\n\n## 오늘 배운 핵심 3가지 ## 아직 모호한 것 1가지(질문 형태) ## 내일 할 일 1가지 ## 한 줄 격려", tokens: 900 }, (f) => io.stream(body + "\n\n" + f)); } catch (e) { body += "\n\n_(AI 성찰은 건너뜀: " + e.message + ")_"; }
        }
        const J = TK.store.get("lib.journal", {}); J[today()] = { t: body, at: Date.now() }; TK.store.set("lib.journal", J);
        const past = Object.keys(J).sort().reverse().slice(1, 8);
        io.md(body + (past.length ? "\n\n---\n**지난 일지:** " + past.join(" · ") : ""), "학습 일지 " + today());
      } },
    { id: "voiceback", group: GL, ico: "🗣", name: "말로 설명하기", desc: "읽은 내용을 소리 내 설명하면 받아 적고(음성 인식) 빠진 점·틀린 점을 짚어 줘요", ai: true,
      run: async (c, io, v) => {
        const rec = stt((fin, interim) => { const x = $("tkVbTxt"); if (x) x.value = fin + interim; });
        io.html((rec ? '<div class="lb-row"><button type="button" class="primary small-btn" id="tkVbGo">🎤 말하기 시작</button><button type="button" class="ghost-btn small-btn" id="tkVbStop">■ 멈춤</button><span class="sh-muted" id="tkVbSt">준비</span></div>' : '<p class="lb-warn">이 브라우저는 음성 인식을 지원하지 않아요(크롬·엣지 권장). 아래에 직접 써도 돼요.</p>') + '<textarea id="tkVbTxt" rows="6" placeholder="여기에 받아 적혀요(직접 고쳐도 돼요)"></textarea><div class="lb-row"><button type="button" class="primary small-btn" id="tkVbEval">✨ 피드백 받기</button></div><div id="tkVbOut" class="tk-md"></div>', "", "말로 설명하기");
        io.el.onclick = async (e) => {
          if (e.target.id === "tkVbGo" && rec) { rec.start(); $("tkVbSt").textContent = "🔴 듣는 중…"; }
          if (e.target.id === "tkVbStop" && rec) { rec.stop(); $("tkVbSt").textContent = "멈춤"; }
          if (e.target.id === "tkVbEval") {
            if (rec) rec.stop(); const said = $("tkVbTxt").value.trim(); if (said.length < 30) { $("tkVbOut").textContent = "조금 더(30자 이상) 설명해 주세요."; return; }
            const out = $("tkVbOut"); out.innerHTML = '<p class="sh-muted">피드백 쓰는 중…</p>';
            try { const t = await TK.ai({ sys: T.SYS_LIB, user: "학습자가 자료를 소리 내 설명한 받아쓰기입니다(말이라 군더더기가 있어도 내용만 보세요). 1) 잘 설명한 점 2) 빠진 핵심 3) 틀리거나 모호한 부분(자료 근거) 4) 10점 만점 점수 5) 30초 안에 다시 말해 볼 한 문장 요약.\n\n[자료]\n" + L.text(v.scope, 8000) + "\n\n[받아쓰기]\n" + said, tokens: 1300 }, (f) => { out.innerHTML = TK.md(f); }); out.innerHTML = TK.md(t); } catch (er) { out.innerHTML = '<p class="lb-warn">' + esc(er.message) + "</p>"; }
          }
        };
      } },
    { id: "reread", group: GL, ico: "🔁", name: "다시 읽기 일정", desc: "이 문서를 1·3·7·14·30일 뒤에 다시 보도록 예약 · 오늘 다시 볼 문서 목록(간격 반복)",
      run: async (c, io) => {
        const S = TK.store.get("lib.reread", {}), steps = [1, 3, 7, 14, 30];
        const paint = () => {
          const due = Object.keys(S).filter((id) => S[id].due <= today()).sort((a, b) => S[a].due < S[b].due ? -1 : 1), later = Object.keys(S).filter((id) => S[id].due > today()).sort((a, b) => S[a].due < S[b].due ? -1 : 1);
          io.html((L.id() ? '<div class="lb-row"><button type="button" class="primary small-btn" id="tkRrAdd">' + (S[L.id()] ? "✓ 이 문서는 예약됨(" + S[L.id()].due + ")" : "＋ 지금 문서를 다시 읽기에 넣기") + "</button></div>" : "") +
            "<h4>📅 오늘 다시 볼 문서 " + due.length + "</h4>" + (due.map((id) => '<div class="tk-ref"><div><b>' + esc(S[id].title) + "</b><small>" + (S[id].step + 1) + "번째 복습 · 예정 " + S[id].due + '</small></div><button type="button" class="ghost-btn small-btn" data-rro="' + esc(id) + '">열기</button><button type="button" class="ghost-btn small-btn" data-rrd="' + esc(id) + '">다 읽음 →</button></div>').join("") || '<p class="sh-muted">오늘은 없어요.</p>') +
            "<h4>다음 예정</h4>" + (later.slice(0, 12).map((id) => '<div class="tk-ref"><div><b>' + esc(S[id].title) + "</b><small>" + S[id].due + '</small></div><button type="button" class="icon-mini" data-rrx="' + esc(id) + '" aria-label="빼기">✕</button></div>').join("") || '<p class="sh-muted">없어요.</p>'),
          "오늘 다시 볼 문서: " + due.map((id) => S[id].title).join(", "), "다시 읽기 일정");
        };
        paint();
        io.el.onclick = (e) => {
          if (e.target.id === "tkRrAdd" && !S[L.id()]) { S[L.id()] = { title: L.title(), step: 0, due: addDays(1), added: Date.now() }; TK.store.set("lib.reread", S); paint(); }
          const o = e.target.closest("[data-rro]"); if (o) { window.libOpen && libOpen(o.dataset.rro); return; }
          const dn = e.target.closest("[data-rrd]"); if (dn) { const x = S[dn.dataset.rrd]; x.step = Math.min(steps.length - 1, x.step + 1); x.due = addDays(steps[x.step]); x.last = Date.now(); TK.store.set("lib.reread", S); paint(); }
          const rx = e.target.closest("[data-rrx]"); if (rx) { delete S[rx.dataset.rrx]; TK.store.set("lib.reread", S); paint(); }
        };
      } },
    { id: "umap", group: GL, ico: "🎯", name: "이해도 지도", desc: "절 제목마다 😕·🙂·😎 를 눌러 스스로 점검 → 어려운 절만 모아 다시 보기(메타인지)",
      run: async (c, io) => {
        const d = L.doc(); if (!d) throw new Error("문서를 먼저 열어 주세요.");
        const key = L.key("umap"), M = TK.store.get(key, {});
        const hs = Array.from(d.querySelectorAll("main h2, main h3, article h2, article h3, h2, h3")).filter((h, i, a) => a.indexOf(h) === i && h.offsetParent !== null).slice(0, 60);
        docStyle("tkUmCss", ".tk-um{display:inline-flex;gap:4px;margin-left:10px;vertical-align:middle}.tk-um button{font-size:14px;line-height:1;padding:3px 6px;border-radius:8px;border:1px solid transparent;background:transparent;cursor:pointer;opacity:.45}.tk-um button.on{opacity:1;border-color:#94a3b8;background:rgba(148,163,184,.15)}");
        hs.forEach((h) => { if (h.querySelector(".tk-um")) return; const t = h.textContent.trim().slice(0, 80); const s = d.createElement("span"); s.className = "tk-um"; s.innerHTML = ["😕", "🙂", "😎"].map((e, i) => '<button data-um="' + i + '" class="' + (M[t] === i ? "on" : "") + '" title="' + ["어려워요", "그럭저럭", "잘 알아요"][i] + '">' + e + "</button>").join(""); s.dataset.t = t; h.appendChild(s); });
        const paint = () => {
          const rows = hs.map((h) => { const t = (h.querySelector(".tk-um") || {}).dataset ? h.querySelector(".tk-um").dataset.t : h.textContent.trim(); return { t: t, v: M[t] }; });
          const hard = rows.filter((r) => r.v === 0), mid = rows.filter((r) => r.v === 1), ok = rows.filter((r) => r.v === 2), none = rows.filter((r) => r.v == null);
          io.html('<p class="tk-sum">😕 ' + hard.length + " · 🙂 " + mid.length + " · 😎 " + ok.length + " · 아직 " + none.length + '</p><p class="sh-muted">문서의 절 제목 옆 얼굴을 눌러 표시하세요. 😕 절에서 [쉽게 풀어 설명]·[퀴즈]를 써 보세요.</p>' + (hard.length ? "<h4>😕 어려운 절</h4>" + hard.map((r) => '<div class="tk-ref"><div>' + esc(r.t) + '</div><button type="button" class="ghost-btn small-btn" data-umgo="' + esc(r.t) + '">그 절로</button></div>').join("") : ""), "이해도: 어려움 " + hard.map((r) => r.t).join(", "), "이해도 지도");
        };
        paint();
        if (!d._tkUm) { d._tkUm = true; d.addEventListener("click", (e) => { const b = e.target.closest && e.target.closest(".tk-um button"); if (!b) return; e.preventDefault(); e.stopPropagation(); const s = b.parentElement, t = s.dataset.t, i = +b.dataset.um; const MM = TK.store.get(key, {}); MM[t] = MM[t] === i ? undefined : i; if (MM[t] === undefined) delete MM[t]; TK.store.set(key, MM); Object.assign(M, MM); Object.keys(M).forEach((k) => { if (!(k in MM)) delete M[k]; }); s.querySelectorAll("button").forEach((x) => x.classList.toggle("on", MM[t] === +x.dataset.um)); paint(); }, true); }
        io.el.onclick = (e) => { const g = e.target.closest("[data-umgo]"); if (!g) return; const h = hs.find((x) => x.querySelector(".tk-um") && x.querySelector(".tk-um").dataset.t === g.dataset.umgo); if (h) h.scrollIntoView({ behavior: "smooth", block: "start" }); };
      } },
  ];

  /* =====================================================================
   * B. 연구지원 — 새 연구 도구 12
   * =================================================================== */
  const SYS_R = T.SYS_R;
  const DEF_CRIT = "기술성(혁신성·차별성), 연구 방법의 타당성, 수행 역량·추진 체계, 활용·사업화 가능성, 예산·일정의 적정성";
  const PERSONAS = [["기술 심사위원", "해당 분야 교수·연구원. 기술 혁신성·방법의 엄밀성·선행연구 대비 차별성을 깐깐하게 본다."], ["정책·사업화 심사위원", "정부 과제 기획·기술사업화 전문가. 정책 부합성·활용 계획·경제성·파급효과를 본다."], ["현장 실무 심사위원", "산업 현장 책임자. 실현 가능성·일정·인력·예산의 현실성과 위험을 본다."]];
  async function openalex(q, n) {
    const r = await fetch("https://api.openalex.org/works?per-page=" + (n || 50) + "&search=" + encodeURIComponent(q) + "&select=id,display_name,publication_year,cited_by_count,doi,authorships,primary_location,abstract_inverted_index");
    if (!r.ok) throw new Error("OpenAlex 검색 실패(" + r.status + ")");
    return ((await r.json()).results || []).map((w) => {
      let abs = ""; const ii = w.abstract_inverted_index; if (ii) { const pos = []; Object.keys(ii).forEach((k) => ii[k].forEach((p) => { pos[p] = k; })); abs = pos.filter(Boolean).slice(0, 80).join(" "); }
      return { title: w.display_name, year: w.publication_year, cited: w.cited_by_count || 0, doi: (w.doi || "").replace("https://doi.org/", ""), url: (w.primary_location || {}).landing_page_url || w.id, venue: ((w.primary_location || {}).source || {}).display_name || "", authors: (w.authorships || []).slice(0, 4).map((a) => (a.author || {}).display_name).join(", "), abs: abs };
    });
  }
  function scatterSvg(works) {
    const W = 720, H = 300, ys = works.map((w) => w.year).filter(Boolean); if (!ys.length) return "";
    const y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys) + 1, cmax = Math.log10(Math.max.apply(null, works.map((w) => w.cited + 1)) + 1);
    const X = (y) => 50 + (y - y0) / Math.max(1, y1 - y0) * (W - 70), Y = (c) => H - 30 - Math.log10(c + 1) / Math.max(0.5, cmax) * (H - 60);
    let s = '<svg class="tk-scatter" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="연도별 인용 분포"><line class="ax" x1="50" y1="' + (H - 30) + '" x2="' + (W - 10) + '" y2="' + (H - 30) + '"/><line class="ax" x1="50" y1="20" x2="50" y2="' + (H - 30) + '"/>';
    for (let y = y0; y <= y1; y += Math.max(1, Math.round((y1 - y0) / 8))) s += '<text class="tx" x="' + X(y) + '" y="' + (H - 12) + '">' + y + "</text>";
    [0, 10, 100, 1000, 10000].forEach((c) => { if (Math.log10(c + 1) <= cmax + 0.1) s += '<text class="ty" x="44" y="' + (Y(c) + 4) + '">' + c + "</text>"; });
    works.forEach((w, i) => { if (!w.year) return; s += '<circle class="pt" data-wi="' + i + '" cx="' + X(w.year + 0.5) + '" cy="' + Y(w.cited) + '" r="' + (4 + Math.min(8, Math.log10(w.cited + 1) * 2)) + '"><title>' + esc(w.title + " (" + w.year + ", 인용 " + w.cited + ")") + "</title></circle>"; });
    return s + '<text class="tx" x="' + (W - 10) + '" y="' + (H - 34) + '" text-anchor="end">연도 →</text><text class="ty" x="54" y="16" text-anchor="start">인용 수(로그)</text></svg>';
  }
  function sentences(t) { return String(t || "").replace(/\s+/g, " ").split(/(?<=[.!?。]|다\.|요\.|함\.|음\.)\s+|(?<=다)\s+(?=[가-힣A-Z])/).map((x) => x.trim()).filter((x) => x.length > 1); }
  function sentDiff(a, b) {   // 문장 단위 LCS → [{type:"same"|"del"|"add", text}]
    const A = sentences(a), B = sentences(b), n = A.length, m = B.length, dp = Array.from({ length: n + 1 }, () => new Int16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const out = []; let i = 0, j = 0;
    while (i < n && j < m) { if (A[i] === B[j]) { out.push({ t: "same", a: A[i] }); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: "del", a: A[i++] }); } else out.push({ t: "add", a: B[j++] }); }
    while (i < n) out.push({ t: "del", a: A[i++] }); while (j < m) out.push({ t: "add", a: B[j++] });
    // 이웃한 del+add 를 '바꿈' 하나로 묶는다
    const g = []; out.forEach((x) => { const last = g[g.length - 1]; if (x.t !== "same" && last && last.t === "chg") { if (x.t === "del") last.del.push(x.a); else last.add.push(x.a); } else if (x.t === "same") g.push({ t: "same", a: x.a }); else g.push({ t: "chg", del: x.t === "del" ? [x.a] : [], add: x.t === "add" ? [x.a] : [], on: true }); });
    return g;
  }
  const RNDX = [
    { id: "panel", group: GR, ico: "🏛", name: "모의 평가위원회", desc: "심사위원 3명(기술·사업화·현장) + 위원장이 기준별 점수·근거 쪽·보완점 → 합의 점수·레이더 차트", ai: true,
      inputs: [{ id: "crit", label: "평가 기준(쉼표로, 비우면 국가R&D 일반 기준)", value: DEF_CRIT }],
      run: async (c, io, v) => {
        const crit = (v.crit || DEF_CRIT).split(/[,，]/).map((x) => x.trim()).filter(Boolean).slice(0, 8);
        const g = await T.ground(crit.join(" ") + " 목표 방법 성과 예산 일정 추진체계", 14, 11000);
        const reviews = [];
        for (let i = 0; i < PERSONAS.length; i++) {
          io.busy("심사위원 " + (i + 1) + "/" + PERSONAS.length + " (" + PERSONAS[i][0] + ") 평가 중…");
          const r = await TK.aiJSON({ sys: SYS_R + " 당신은 " + PERSONAS[i][0] + "입니다: " + PERSONAS[i][1], user: "다음 평가 기준으로 계획서를 1~10점 채점하세요. 점수마다 근거(파일 p.쪽)를 대고, 후한 점수를 주지 마세요.\n기준: " + crit.join(" / ") + g, shape: '{"scores":[{"criterion":"","score":0,"reason":"","cite":"(파일 p.)"}],"strengths":[""],"weaknesses":[""],"question":"이 위원이 던질 날카로운 질문 1개"}', tokens: 1800 });
          reviews.push({ who: PERSONAS[i][0], r: r });
        }
        io.busy("위원장이 의견을 모으는 중…");
        const chair = await TK.aiJSON({ sys: "당신은 평가위원장입니다. 세 위원의 평가를 종합해 공정하게 합의안을 만드세요.", user: "기준: " + crit.join(" / ") + "\n\n" + reviews.map((x) => "[" + x.who + "]\n" + JSON.stringify(x.r)).join("\n\n"), shape: '{"consensus":[{"criterion":"","score":0}],"verdict":"선정 유력|보완하면 가능|미흡","summary":"총평 2~3문장","top_fixes":["점수를 가장 많이 올릴 보완 3가지"]}', tokens: 1400 });
        const sc = (r, k) => { const x = arr(r.scores).find((s) => s.criterion && (s.criterion.indexOf(k.slice(0, 4)) >= 0 || k.indexOf(String(s.criterion).slice(0, 4)) >= 0)) || arr(r.scores)[crit.indexOf(k)]; return x ? x.score : "-"; };
        const cons = crit.map((k, i) => { const x = arr(chair.consensus).find((s) => s.criterion && (s.criterion.indexOf(k.slice(0, 4)) >= 0 || k.indexOf(String(s.criterion).slice(0, 4)) >= 0)) || arr(chair.consensus)[i]; return x ? +x.score || 0 : 0; });
        const total = Math.round(cons.reduce((a, b) => a + b, 0) / (crit.length * 10) * 100);
        const rows = crit.map((k, i) => { const o = { k: k }; reviews.forEach((x, j) => { o["r" + j] = sc(x.r, k); }); o.c = cons[i]; return o; });
        io.html('<div class="tk-panel-top"><div>' + radarSvg(crit, cons, 10) + '</div><div><p class="tk-big">' + total + '<small>점 / 100</small></p><p class="tk-verdict v-' + esc((chair.verdict || "").slice(0, 2)) + '">' + esc(chair.verdict || "") + "</p><p>" + esc(chair.summary || "") + "</p><b>점수를 올릴 보완</b><ol>" + arr(chair.top_fixes).map((x) => "<li>" + esc(x) + "</li>").join("") + "</ol></div></div>" +
          TK.tableHtml([["k", "기준"]].concat(reviews.map((x, j) => ["r" + j, x.who.replace(" 심사위원", "")])).concat([["c", "합의"]]), rows) +
          reviews.map((x) => "<details class=\"tk-rev\"><summary><b>" + esc(x.who) + "</b> — 질문: " + esc(x.r.question || "") + "</summary>" + TK.tableHtml([["criterion", "기준"], ["score", "점수"], ["reason", "이유"], ["cite", "근거"]], arr(x.r.scores)) + "<p>👍 " + arr(x.r.strengths).map(esc).join(" · ") + "</p><p>👎 " + arr(x.r.weaknesses).map(esc).join(" · ") + "</p></details>").join(""),
          "# 모의 평가위원회 — " + total + "점 (" + (chair.verdict || "") + ")\n\n" + (chair.summary || "") + "\n\n" + TK.tableMd([["k", "기준"]].concat(reviews.map((x, j) => ["r" + j, x.who])).concat([["c", "합의"]]), rows) + "\n\n## 보완\n" + arr(chair.top_fixes).map((x) => "- " + x).join("\n") + "\n\n## 위원 질문\n" + reviews.map((x) => "- " + x.who + ": " + (x.r.question || "")).join("\n"), "모의 평가위원회");
      } },
    { id: "qadrill", group: GR, ico: "🎙", name: "질의응답 훈련", desc: "심사위원 질문을 하나씩 — 말하거나 써서 답하면 5점 척도 채점·빠진 점·모범 답안(30초)", ai: true,
      run: async (c, io) => {
        const g = await T.ground("목표 차별성 방법 예산 일정 위험 성과 활용 경쟁 기술", 12, 9000);
        io.busy("질문을 뽑는 중…");
        const q = arr((await TK.aiJSON({ sys: SYS_R, user: "발표 심사에서 나올 날카로운 질문 8개를 쉬운 것→어려운 것 순으로." + g, shape: '{"qs":[{"q":"","topic":"주제 2~4자"}]}', tokens: 1200 })).qs);
        const S = { i: 0, res: [] }, rec = stt((fin, interim) => { const x = $("tkQaA"); if (x) x.value = fin + interim; });
        const paint = () => {
          if (S.i >= q.length) { const avg = S.res.length ? (S.res.reduce((a, r) => a + (+r.score || 0), 0) / S.res.length).toFixed(1) : 0; const weak = S.res.filter((r) => +r.score <= 2).map((r) => r.topic); io.html('<p class="tk-big">' + avg + '<small> / 5</small></p><p>' + (weak.length ? "보완할 주제: <b>" + esc(weak.join(", ")) + "</b>" : "전부 3점 이상이에요 👏") + "</p>" + TK.tableHtml([["q", "질문"], ["score", "점수"], ["missing", "빠진 점"]], S.res), S.res.map((r) => "- (" + r.score + "점) " + r.q + "\n  모범: " + r.model).join("\n"), "질의응답 훈련 결과"); return; }
          const x = q[S.i];
          io.html('<p class="tk-sum">질문 ' + (S.i + 1) + " / " + q.length + " · " + esc(x.topic || "") + '</p><div class="rp-card"><b>🧑‍⚖️ ' + esc(x.q) + '</b></div><div class="lb-row">' + (rec ? '<button type="button" class="ghost-btn small-btn" id="tkQaMic">🎤 말로 답하기</button>' : "") + '<button type="button" class="ghost-btn small-btn" id="tkQaSay">🔊 질문 듣기</button></div><textarea id="tkQaA" rows="5" placeholder="답변(말로 하면 여기에 받아 적혀요)"></textarea><div class="lb-row"><button type="button" class="primary small-btn" id="tkQaGrade">채점</button><button type="button" class="ghost-btn small-btn" id="tkQaSkip">건너뛰기</button></div><div id="tkQaOut"></div>', "", "질의응답 훈련");
        };
        paint();
        io.el.onclick = async (e) => {
          const id = e.target.id;
          if (id === "tkQaMic" && rec) { if (e.target.dataset.on) { rec.stop(); e.target.dataset.on = ""; e.target.textContent = "🎤 말로 답하기"; } else { rec.start(); e.target.dataset.on = "1"; e.target.textContent = "■ 그만 말하기"; } }
          if (id === "tkQaSay") speak(q[S.i].q);
          if (id === "tkQaSkip") { if (rec) rec.stop(); S.res.push({ q: q[S.i].q, topic: q[S.i].topic, score: 0, missing: "건너뜀", model: "" }); S.i++; paint(); }
          if (id === "tkQaGrade") {
            if (rec) rec.stop(); const a = $("tkQaA").value.trim(); if (a.length < 10) { $("tkQaOut").textContent = "답변을 조금 더 써 주세요."; return; }
            $("tkQaOut").innerHTML = '<p class="sh-muted">채점 중…</p>';
            const r = await TK.aiJSON({ sys: SYS_R, user: "질문: " + q[S.i].q + "\n발표자 답변: " + a + "\n\n계획서 근거로 1~5점 채점(5=완벽). 빠진 점, 30초 분량 모범 답안(근거 쪽 포함)." + g, shape: '{"score":0,"good":"","missing":"","model":""}', tokens: 900 });
            S.res.push({ q: q[S.i].q, topic: q[S.i].topic, score: r.score, missing: r.missing, model: r.model });
            $("tkQaOut").innerHTML = '<div class="rp-card"><b>' + "★".repeat(+r.score || 0) + "☆".repeat(5 - (+r.score || 0)) + " " + (r.score || 0) + "점</b><p>👍 " + esc(r.good || "") + "</p><p>➕ " + esc(r.missing || "") + "</p><p>💬 <b>모범 답안:</b> " + esc(r.model || "") + '</p></div><div class="lb-row"><button type="button" class="primary small-btn" id="tkQaNext">다음 질문 →</button></div>';
          }
          if (id === "tkQaNext") { S.i++; paint(); }
        };
      } },
    { id: "suggest", group: GR, ico: "✍", name: "제안 모드(수락/거절)", desc: "AI 가 고친 문장을 바뀐 곳만 보여 주고, 하나씩 수락·거절해 문서에 반영(변경 추적)", ai: true,
      inputs: [{ id: "sec", label: "고칠 절", type: "select", options: [["", "(문서를 먼저 여세요)"]] }, { id: "how", label: "어떻게", type: "select", options: [["더 명확하고 구체적으로", "명확하게"], ["근거와 수치를 보강해서(자료 근거 쪽 포함)", "근거 보강"], ["30% 짧고 간결하게", "간결하게"], ["평가위원이 지적할 약점을 미리 보완해서", "약점 보완"], ["공문서 격식체로", "격식체"]] }],
      run: async (c, io, v) => {
        const cx = C(), d = cx.doc(); if (!d) throw new Error("[📝 문서] 탭에서 문서를 먼저 여세요.");
        const i = +v.sec, s = d.sections[i]; if (!s || !(s.body || "").trim()) throw new Error("내용이 있는 절을 고르세요.");
        io.busy("'" + s.h + "' 고치는 중…");
        const g = v.how.indexOf("근거") >= 0 ? await T.ground(s.h + " " + s.body.slice(0, 300), 6, 5000) : "";
        const nb = await TK.ai({ sys: SYS_R, user: "다음 문서 절을 " + v.how + " 고쳐 쓰세요. 고친 본문만 출력(설명 없이), 문장 단위 구성은 최대한 유지.\n\n[절 제목] " + s.h + "\n[본문]\n" + s.body + g, tokens: 2200 });
        const ch = sentDiff(s.body, nb), nch = ch.filter((x) => x.t === "chg").length;
        if (!nch) { io.md("바꿀 곳이 없대요. 다른 방식으로 해 보세요."); return; }
        const paint = () => io.html('<p class="tk-sum">바뀐 곳 ' + nch + '개 — 하나씩 수락/거절하고 [문서에 반영]</p><div class="tk-sugg">' + ch.map((x, k) => x.t === "same" ? "<span>" + esc(x.a) + " </span>" : '<span class="chg' + (x.on ? " on" : " off") + '" data-sg="' + k + '">' + (x.del.length ? "<del>" + esc(x.del.join(" ")) + "</del>" : "") + (x.add.length ? "<ins>" + esc(x.add.join(" ")) + "</ins>" : "") + '<button type="button" data-sgt="' + k + '">' + (x.on ? "✓ 수락됨" : "✕ 거절됨") + "</button></span> ").join("") + '</div><div class="lb-row"><button type="button" class="ghost-btn small-btn" id="tkSgAll">모두 수락</button><button type="button" class="ghost-btn small-btn" id="tkSgNone">모두 거절</button><button type="button" class="primary small-btn" id="tkSgApply">📝 문서에 반영</button></div>', "", "제안 모드 — " + s.h);
        paint();
        io.el.onclick = (e) => {
          const tg = e.target.closest("[data-sgt]"); if (tg) { const x = ch[+tg.dataset.sgt]; x.on = !x.on; paint(); return; }
          if (e.target.id === "tkSgAll" || e.target.id === "tkSgNone") { ch.forEach((x) => { if (x.t === "chg") x.on = e.target.id === "tkSgAll"; }); paint(); }
          if (e.target.id === "tkSgApply") { const text = ch.map((x) => x.t === "same" ? x.a : (x.on ? x.add : x.del).join(" ")).filter(Boolean).join(" "); cx.setSection(i, text); e.target.textContent = "✓ 반영했어요 — [📝 문서]에서 💾 저장하세요"; }
        };
      } },
    { id: "landscape", group: GR, ico: "🔭", name: "선행연구 지형도", desc: "주제로 논문 50편(OpenAlex)을 연도×인용 분포로 보고, 핵심 논문·연구 빈틈을 찾아요", inputs: [{ id: "q", label: "검색어(영어 권장, 비우면 프로젝트 이름)", placeholder: "예: retrieval augmented generation education" }], go: "검색",
      run: async (c, io, v) => {
        const cx = C(); const q = v.q.trim() || (cx.project() || {}).name || ""; if (!q) throw new Error("검색어를 넣어 주세요.");
        io.busy("OpenAlex 에서 '" + q + "' 논문을 찾는 중…");
        const ws = await openalex(q, 50); if (!ws.length) { io.md("찾은 논문이 없어요. 영어 검색어로 바꿔 보세요."); return; }
        const top = ws.slice().sort((a, b) => b.cited - a.cited).slice(0, 12), recent = ws.filter((w) => w.year >= new Date().getFullYear() - 2).sort((a, b) => b.cited - a.cited).slice(0, 6);
        const aiOk = (() => { try { return Api.llm.isConnected(); } catch (e) { return false; } })();
        io.html('<p class="tk-sum">' + esc(q) + " — " + ws.length + '편 (점 = 논문, 크기 = 인용)</p>' + scatterSvg(ws) + "<h4>📌 가장 많이 인용된 논문</h4>" + top.map((w) => '<div class="tk-ref"><button type="button" class="ghost-btn small-btn" data-lsadd="' + ws.indexOf(w) + '">＋</button><div><b>' + esc(w.title) + "</b><small>" + esc(w.authors) + " · " + w.year + " · 인용 " + w.cited + (w.doi ? ' · <a href="https://doi.org/' + esc(w.doi) + '" target="_blank" rel="noopener">DOI</a>' : "") + "</small></div></div>").join("") +
          (recent.length ? "<h4>🆕 최근 2년 주목 논문</h4>" + recent.map((w) => '<div class="tk-ref"><button type="button" class="ghost-btn small-btn" data-lsadd="' + ws.indexOf(w) + '">＋</button><div><b>' + esc(w.title) + "</b><small>" + w.year + " · 인용 " + w.cited + "</small></div></div>").join("") : "") +
          (aiOk ? '<div class="lb-row"><button type="button" class="primary small-btn" id="tkLsGap">✨ 연구 빈틈 분석</button></div><div id="tkLsOut" class="tk-md"></div>' : ""),
          ws.map((w) => "- " + w.title + " (" + w.year + ", 인용 " + w.cited + ")" + (w.doi ? " doi:" + w.doi : "")).join("\n"), "선행연구 지형도 — " + q);
        io.el.onclick = async (e) => {
          const a = e.target.closest("[data-lsadd]"); if (a) { const w = ws[+a.dataset.lsadd]; const k = "rnd.bib." + cx.pid; const l = TK.store.get(k, []); if (!l.some((x) => x.title === w.title)) l.push({ title: w.title, authors: w.authors, year: w.year, venue: w.venue, doi: w.doi, url: w.url }); TK.store.set(k, l); a.textContent = "✓"; return; }
          if (e.target.id === "tkLsGap") { const out = $("tkLsOut"); out.innerHTML = '<p class="sh-muted">분석 중…</p>'; try { const pg = await T.ground("목표 방법 차별성 기여", 6, 4000).catch(() => ""); const t = await TK.ai({ user: "주제 '" + q + "' 의 논문 목록(제목·연도·인용·초록 일부)과 우리 계획서 발췌입니다.\n## 연구 흐름(시기별 3단계) ## 주류 접근 ## 아직 덜 다뤄진 빈틈 3가지 ## 우리 과제가 노릴 자리(계획서 근거)\n\n" + ws.slice(0, 40).map((w) => "- " + w.title + " (" + w.year + ", " + w.cited + "회) " + (w.abs || "").slice(0, 200)).join("\n") + pg, tokens: 1800 }, (f) => { out.innerHTML = TK.md(f); }); out.innerHTML = TK.md(t); } catch (er) { out.innerHTML = '<p class="lb-warn">' + esc(er.message) + "</p>"; } }
        };
      } },
    { id: "novelty", group: GR, ico: "🧪", name: "신규성 검토", desc: "과제의 핵심 기여마다 가장 비슷한 기존 논문을 찾아 겹침 정도·차별점·보완을 표로", ai: true,
      run: async (c, io) => {
        const g = await T.ground("핵심 기술 독창성 차별성 최초 새로운 기여 목표", 10, 8000);
        io.busy("핵심 기여를 뽑는 중…");
        const cs = arr((await TK.aiJSON({ sys: SYS_R, user: "계획서의 핵심 기여(새롭다고 주장하는 것) 3~5개를 뽑고, 각각 논문 검색용 영어 키워드를 만드세요." + g, shape: '{"items":[{"claim":"","query":"english keywords","cite":"(파일 p.)"}]}', tokens: 900 })).items).slice(0, 5);
        const rows = [];
        for (let i = 0; i < cs.length; i++) {
          io.busy("기여 " + (i + 1) + "/" + cs.length + " 비슷한 논문 찾는 중…");
          let ws = []; try { ws = (await openalex(cs[i].query, 6)); } catch (e) { ws = []; }
          const r = await TK.aiJSON({ user: "우리 주장: " + cs[i].claim + "\n가장 비슷한 기존 논문들:\n" + ws.map((w, k) => k + ". " + w.title + " (" + w.year + ") " + (w.abs || "").slice(0, 300)).join("\n") + "\n\n겹침 정도를 판단하세요.", shape: '{"overlap":"높음|중간|낮음","closest":0,"diff":"우리만의 차별점","fix":"신규성을 분명히 할 보완 1문장"}', tokens: 600 });
          const w = ws[+r.closest] || ws[0];
          rows.push({ claim: cs[i].claim + " " + (cs[i].cite || ""), overlap: r.overlap, closest: w ? w.title + " (" + w.year + ")" : "-", diff: r.diff, fix: r.fix });
        }
        io.table([["claim", "우리 기여"], ["overlap", "겹침"], ["closest", "가장 비슷한 논문"], ["diff", "차별점"], ["fix", "보완"]], rows, "신규성 검토", { before: '<p class="tk-sum">겹침 높음 ' + rows.filter((r) => r.overlap === "높음").length + " · 중간 " + rows.filter((r) => r.overlap === "중간").length + " · 낮음 " + rows.filter((r) => r.overlap === "낮음").length + " (논문: OpenAlex)</p>" });
      } },
    { id: "claimmap", group: GR, ico: "🔗", name: "주장–근거 지도", desc: "문서의 주장마다 자료에서 근거를 찾아 '뒷받침·약함·근거 없음'으로 판정(인용 쪽)", ai: true,
      run: async (c, io) => {
        const cx = C(); const txt = cx.docText(); io.busy("주장을 뽑는 중…");
        const base = txt || cx.ground(await cx.head(9000));
        const cl = arr((await TK.aiJSON({ user: "다음 글에서 검증이 필요한 주장(수치·효과·필요성·우월성 등) 8~12개를 원문에 가깝게 뽑으세요.\n\n" + clip(base, 10000), shape: '{"claims":[""]}', tokens: 1000 })).claims).slice(0, 12);
        const blocks = [];
        for (const cl1 of cl) { const ev = await cx.retrieve(cl1, 3, 1800); blocks.push("주장: " + cl1 + "\n근거 후보:\n" + ev.map((e) => "(" + e.name + (e.p ? " p." + e.p : "") + ") " + e.text.slice(0, 500)).join("\n")); }
        io.busy("근거를 판정하는 중…");
        const r = await TK.aiJSON({ sys: SYS_R, user: "각 주장이 근거 후보로 뒷받침되는지 판정하세요. 뒷받침=근거가 직접 지지, 약함=간접·일부, 근거 없음=관련 근거 없음.\n\n" + blocks.join("\n\n"), shape: '{"rows":[{"claim":"","verdict":"뒷받침|약함|근거 없음","evidence":"(파일 p.) 짧은 인용","fix":"보완 방법"}]}', tokens: 2400 });
        const rows = arr(r.rows), cnt = (k) => rows.filter((x) => x.verdict === k).length;
        io.table([["verdict", "판정"], ["claim", "주장"], ["evidence", "근거"], ["fix", "보완"]], rows.map((x) => Object.assign({}, x, { verdict: (x.verdict === "뒷받침" ? "🟢 " : x.verdict === "약함" ? "🟡 " : "🔴 ") + x.verdict })), "주장–근거 지도", { before: '<p class="tk-sum">🟢 뒷받침 ' + cnt("뒷받침") + " · 🟡 약함 " + cnt("약함") + " · 🔴 근거 없음 " + cnt("근거 없음") + "</p>" });
      } },
    { id: "rehearse", group: GR, ico: "🎬", name: "발표 리허설", desc: "슬라이드별 대본·목표 시간 → 타이머로 연습, 말하면 말 빠르기(글자/분)·군말(음·어·그)을 세어 줘요", ai: true, inputs: [{ id: "min", label: "발표 시간", type: "select", options: [["5", "5분"], ["10", "10분"], ["15", "15분"], ["20", "20분"]] }],
      run: async (c, io, v) => {
        const cx = C(); const base = cx.docText() || cx.ground(await cx.head(9000)); io.busy("대본을 쓰는 중…");
        const r = await TK.aiJSON({ sys: SYS_R, user: v.min + "분 발표용으로 슬라이드 6~10장의 제목·요점(3개 이내)·말할 대본(구어체)·목표 초를 만드세요. 목표 초 합이 " + (v.min * 60) + "초에 맞게.\n\n" + clip(base, 10000), shape: '{"slides":[{"title":"","points":[""],"script":"","sec":60}]}', tokens: 3000 });
        const sl = arr(r.slides); if (!sl.length) throw new Error("대본을 만들지 못했어요.");
        const S = { i: 0, t0: 0, timer: null, log: [] }, FILL = /(^|\s)(음+|어+|그+|저+|약간|이제|뭐랄까|그러니까)(?=\s|$)/g;
        let spoken = ""; const rec = stt((fin, interim) => { spoken = fin; const x = $("tkRhTx"); if (x) x.textContent = (fin + interim).slice(-300); });
        const fmt = (s) => Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
        const paint = () => {
          if (S.i >= sl.length) { clearInterval(S.timer); const tot = S.log.reduce((a, x) => a + x.sec, 0); io.html('<p class="tk-big">' + fmt(tot) + '<small> / 목표 ' + v.min + ":00</small></p>" + TK.tableHtml([["t", "슬라이드"], ["time", "걸린 시간"], ["goal", "목표"], ["cpm", "말 빠르기(자/분)"], ["fill", "군말"]], S.log.map((x) => ({ t: x.t, time: fmt(x.sec), goal: fmt(x.goal), cpm: x.cpm || "-", fill: x.fill }))) + '<p class="sh-muted">한국어 발표는 보통 1분에 250~350자가 듣기 편해요. 군말은 슬라이드당 2개 이하를 목표로.</p>', S.log.map((x) => "- " + x.t + ": " + fmt(x.sec) + " (목표 " + fmt(x.goal) + "), " + (x.cpm || "-") + "자/분, 군말 " + x.fill).join("\n"), "발표 리허설 결과"); return; }
          const s = sl[S.i];
          io.html('<div class="tk-rh"><div class="tk-rh-h"><b>' + (S.i + 1) + " / " + sl.length + " · " + esc(s.title) + '</b><span class="tk-rh-t" id="tkRhT">0:00 / ' + fmt(s.sec) + '</span></div><ul>' + arr(s.points).map((p) => "<li>" + esc(p) + "</li>").join("") + '</ul><details><summary>대본 보기</summary><p>' + esc(s.script) + '</p></details><p class="sh-muted" id="tkRhTx"></p></div><div class="lb-row"><button type="button" class="primary small-btn" id="tkRhGo">' + (S.t0 ? "■ 이 장 끝" : "▶ 이 장 시작") + '</button><button type="button" class="ghost-btn small-btn" id="tkRhSay">🔊 대본 듣기</button>' + (rec ? '<span class="sh-muted">🎤 시작하면 말을 받아 적어 빠르기·군말을 세요</span>' : '<span class="sh-muted">(음성 인식 미지원 — 시간만 재요)</span>') + "</div>", sl.map((x, k) => "## " + (k + 1) + ". " + x.title + " (" + x.sec + "초)\n" + arr(x.points).map((p) => "- " + p).join("\n") + "\n\n" + x.script).join("\n\n"), "발표 대본");
        };
        paint();
        io.el.onclick = (e) => {
          if (e.target.id === "tkRhSay") speak(sl[S.i].script, 1.05);
          if (e.target.id !== "tkRhGo") return;
          if (!S.t0) { S.t0 = Date.now(); spoken = ""; if (rec) rec.start(); S.timer = setInterval(() => { const x = $("tkRhT"); if (x) { const el = (Date.now() - S.t0) / 1000; x.textContent = fmt(el) + " / " + fmt(sl[S.i].sec); x.classList.toggle("over", el > sl[S.i].sec); } }, 500); paint(); return; }
          clearInterval(S.timer); if (rec) rec.stop(); const sec = (Date.now() - S.t0) / 1000, txt = (rec ? rec.text() : spoken) || "";
          S.log.push({ t: sl[S.i].title, sec: sec, goal: sl[S.i].sec, cpm: txt ? Math.round(txt.replace(/\s/g, "").length / (sec / 60)) : 0, fill: (txt.match(FILL) || []).length });
          S.t0 = 0; S.i++; paint();
        };
      } },
    { id: "briefs", group: GR, ico: "⏱", name: "길이별 브리핑", desc: "같은 내용을 30초·2분·5분 세 길이로 — 엘리베이터 피치부터 보고까지, 소리로 듣기", ai: true,
      run: async (c, io) => {
        const g = await T.ground("목표 필요성 방법 성과 기대효과 예산 일정", 12, 9000); io.busy("세 가지 길이로 쓰는 중…");
        const r = await TK.aiJSON({ sys: SYS_R, user: "이 과제를 상급자·심사위원에게 말로 보고한다고 생각하고 세 길이 브리핑을 쓰세요: s30(30초, 약 150자), m2(2분, 약 600자), m5(5분, 약 1,500자, 소제목 포함)." + g, shape: '{"s30":"","m2":"","m5":""}', tokens: 3000 });
        const blk = (k, t) => '<div class="rp-card"><b>' + t + '</b> <button type="button" class="ghost-btn small-btn" data-bsay="' + k + '">🔊 듣기</button><div class="tk-md">' + TK.md(r[k] || "") + "</div></div>";
        io.html(blk("s30", "⏱ 30초") + blk("m2", "⏱ 2분") + blk("m5", "⏱ 5분"), "## 30초\n" + r.s30 + "\n\n## 2분\n" + r.m2 + "\n\n## 5분\n" + r.m5, "길이별 브리핑");
        io.el.onclick = (e) => { const b = e.target.closest("[data-bsay]"); if (b) speak(String(r[b.dataset.bsay] || "").replace(/[#*>|-]/g, " ")); };
      } },
    { id: "kgraph", group: GR, ico: "🕸", name: "프로젝트 지식 그래프", desc: "자료 속 기관·사람·기술·지표·과제와 관계를 그래프로 — 점을 누르면 자료에서 찾아요", ai: true,
      run: async (c, io) => {
        const cx = C(); const g = cx.ground(await cx.head(10000)); io.busy("관계를 뽑는 중…");
        const r = await TK.aiJSON({ user: "다음 자료의 핵심 개체(기관·사람·기술·지표·과제·개념)와 관계를 뽑으세요. 개체 12~25개, 관계 15~35개, label 은 짧게." + g, shape: '{"nodes":[{"id":"n1","label":"","type":"기관|사람|기술|지표|과제|개념"}],"edges":[{"from":"n1","to":"n2","label":""}]}', tokens: 2400 });
        const nodes = arr(r.nodes).slice(0, 25), ids = nodes.map((n) => n.id), edges = arr(r.edges).filter((e) => ids.indexOf(e.from) >= 0 && ids.indexOf(e.to) >= 0);
        io.html(graphSvg(nodes, edges) + '<div id="tkKgOut"></div>', edges.map((e) => "- " + (nodes.find((n) => n.id === e.from) || {}).label + " —" + (e.label || "") + "→ " + (nodes.find((n) => n.id === e.to) || {}).label).join("\n"), "프로젝트 지식 그래프");
        io.el.onclick = async (e) => { const n = e.target.closest(".gnode"); if (!n) return; const res = await cx.searchAll(n.dataset.gq); $("tkKgOut").innerHTML = "<h4>🔍 " + esc(n.dataset.gq) + " — " + res.length + "곳</h4>" + TK.tableHtml([["where", "어디"], ["text", "내용"]], res.slice(0, 12)); };
      } },
    { id: "prose", group: GR, ico: "🩺", name: "문장 진단", desc: "현재 문서의 긴 문장·피동 표현·군더더기·반복어·문단 길이를 세어 점수로(AI 없이)",
      run: async (c, io) => {
        const d = C().doc(); if (!d) throw new Error("[📝 문서] 탭에서 문서를 먼저 여세요.");
        const all = d.sections.map((s) => s.body || "").join("\n"), ss = sentences(all); if (!ss.length) throw new Error("문서에 본문이 없어요.");
        const lens = ss.map((x) => x.length), avg = Math.round(lens.reduce((a, b) => a + b, 0) / lens.length), long = ss.filter((x) => x.length > 90).sort((a, b) => b.length - a.length);
        const PAS = /(되었|되어|된다|되는|되며|되고|됨|되었다|에 의해|에 의하여)/g, FLUFF = /(것이다|것으로|에 대한|에 대해|을 통해|를 통해|할 수 있다|하도록 한다|하는 것|등을|등의|매우|다양한|효과적으로)/g;
        const pas = (all.match(PAS) || []).length, fl = {}; (all.match(FLUFF) || []).forEach((x) => { fl[x] = (fl[x] || 0) + 1; });
        const words = {}; all.split(/[^가-힣A-Za-z0-9]+/).filter((w) => w.length >= 3).forEach((w) => { words[w] = (words[w] || 0) + 1; });
        const rep = Object.keys(words).filter((w) => words[w] >= 4).sort((a, b) => words[b] - words[a]).slice(0, 10);
        const bul = (all.match(/^\s*([-•▪○]|\d+[.)])/gm) || []).length;
        const score = Math.max(0, Math.round(100 - Math.max(0, avg - 55) * 0.8 - long.length * 2 - pas / ss.length * 40 - Object.values(fl).reduce((a, b) => a + b, 0) / ss.length * 30));
        io.html('<p class="tk-big">' + score + '<small> / 100</small></p>' + TK.tableHtml([["k", "항목"], ["v", "값"], ["tip", "기준"]], [
          { k: "문장 수 · 평균 길이", v: ss.length + "문장 · 평균 " + avg + "자", tip: "보고서는 평균 40~60자가 읽기 편해요" },
          { k: "긴 문장(90자 넘음)", v: long.length + "개", tip: "둘로 나누세요" },
          { k: "피동 표현", v: pas + "회 (문장당 " + (pas / ss.length).toFixed(2) + ")", tip: "'~되었다'→'~했다' 주체를 드러내기" },
          { k: "군더더기 표현", v: Object.keys(fl).map((k) => k + " " + fl[k]).join(" · ") || "거의 없음", tip: "'~에 대한'·'~을 통해'·'~것이다'를 줄이기" },
          { k: "자주 반복한 말", v: rep.map((w) => w + "(" + words[w] + ")").join(", ") || "-", tip: "같은 말이 4번 넘으면 바꿔 쓰기·지시어" },
          { k: "개조식 줄", v: bul + "줄", tip: "평가 문서는 핵심을 개조식으로" },
        ]) + (long.length ? "<h4>✂ 나눌 만한 긴 문장</h4><ol>" + long.slice(0, 8).map((x) => "<li>" + esc(x) + " <small>(" + x.length + "자)</small></li>").join("") + "</ol>" : ""), "문장 진단 " + score + "점 · 평균 " + avg + "자 · 긴 문장 " + long.length + " · 피동 " + pas, "문장 진단");
      } },
    { id: "audio", group: GR, ico: "🎧", name: "오디오 브리핑", desc: "프로젝트 자료를 두 진행자 대화로 — 이동 중에 듣는 브리핑(NotebookLM 식)", ai: true,
      run: async (c, io) => {
        const g = await T.ground("목표 필요성 방법 성과 기대효과 쟁점", 12, 9000); io.busy("대본 쓰는 중…");
        const r = await TK.aiJSON({ sys: SYS_R, user: "이 과제를 두 진행자(A: 궁금한 연구 관리자, B: 과제 책임자)의 4~6분 대화로 만드세요. 핵심 숫자·쟁점·약점도 솔직하게, 마지막은 '세 줄 정리'." + g, shape: '{"lines":[{"sp":"A","text":""}]}', tokens: 3000 });
        const lines = arr(r.lines);
        io.html('<div class="lb-row"><button type="button" class="primary small-btn" id="tkAbPlay">▶ 재생</button><button type="button" class="ghost-btn small-btn" id="tkAbStop">■ 멈춤</button></div><div class="tk-dialog">' + lines.map((l, i) => '<p data-li="' + i + '"><b>' + (l.sp === "B" ? "🧑‍🔬 B" : "🙋 A") + "</b> " + esc(l.text) + "</p>").join("") + "</div>", lines.map((l) => l.sp + ": " + l.text).join("\n"), "오디오 브리핑");
        io.el.onclick = (e) => {
          const syn = window.speechSynthesis; if (e.target.id === "tkAbStop") { syn.cancel(); return; } if (e.target.id !== "tkAbPlay") return;
          syn.cancel(); const vs = syn.getVoices().filter((x) => /ko/i.test(x.lang));
          lines.forEach((l, i) => { const u = new SpeechSynthesisUtterance(l.text); u.lang = "ko-KR"; if (vs.length) u.voice = vs[(l.sp === "B" ? 1 : 0) % vs.length]; u.pitch = l.sp === "B" ? 0.9 : 1.15; u.onstart = () => io.el.querySelectorAll("[data-li]").forEach((p) => p.classList.toggle("on", +p.dataset.li === i)); syn.speak(u); });
        };
      } },
    { id: "watch", group: GR, ico: "📡", name: "폴더 변화 감시", desc: "연결 폴더에서 지난번 확인 뒤 새로 생기거나 바뀐 파일 — 한 번에 근거로 넣기",
      run: async (c, io) => {
        const cx = C(); const fs = cx.files().filter((f) => f.folder); if (!fs.length) throw new Error("로컬 폴더가 연결된 프로젝트에서 쓰는 도구예요.");
        const k = "rnd.seen." + cx.pid, seen = TK.store.get(k, null);
        if (!seen) { const m = {}; fs.forEach((f) => { m[f.id] = f.mtime || 0; }); TK.store.set(k, m); io.md("처음 확인이에요 — 지금 파일 " + fs.length + "개를 기준으로 저장했어요. 다음부터 새로 생기거나 바뀐 파일을 알려 드려요."); return; }
        const neu = fs.filter((f) => !(f.id in seen)), chg = fs.filter((f) => f.id in seen && (f.mtime || 0) > seen[f.id]);
        const rows = neu.map((f) => ({ k: "🆕 새 파일", f: f.rel || f.name, t: f.mtime ? new Date(f.mtime).toLocaleString("ko-KR") : "", id: f.id, doc: f.doc })).concat(chg.map((f) => ({ k: "✏ 바뀜", f: f.rel || f.name, t: new Date(f.mtime).toLocaleString("ko-KR"), id: f.id, doc: f.doc })));
        io.html('<p class="tk-sum">새 파일 ' + neu.length + " · 바뀐 파일 " + chg.length + "</p>" + (rows.length ? TK.tableHtml([["k", "변화"], ["f", "파일"], ["t", "수정 시각"]], rows) + '<div class="lb-row"><button type="button" class="primary small-btn" id="tkWcAdd">📎 문서 파일을 모두 근거로</button><button type="button" class="ghost-btn small-btn" id="tkWcOk">✓ 확인함(기준 새로)</button></div>' : '<p class="sh-muted">지난 확인 뒤로 바뀐 게 없어요. (폴더를 새로 읽으려면 사이드의 📁 ↻)</p>'), rows.map((r) => "- " + r.k + " " + r.f).join("\n"), "폴더 변화");
        io.el.onclick = (e) => {
          if (e.target.id === "tkWcAdd") { cx.addCtx(rows.filter((r) => r.doc).map((r) => r.id)); e.target.textContent = "✓ 근거에 넣었어요"; }
          if (e.target.id === "tkWcOk") { const m = {}; fs.forEach((f) => { m[f.id] = f.mtime || 0; }); TK.store.set(k, m); e.target.textContent = "✓ 기준을 새로 했어요"; }
        };
      } },
  ];

  // (v102) toolsets3.js 가 같은 도우미를 쓰게
  T.X2 = { stt: stt, speak: speak, radarSvg: radarSvg, flowSvg: flowSvg, graphSvg: graphSvg, openalex: openalex, sentences: sentences, scopeEls: scopeEls, docStyle: docStyle, today: today };
  // 도구함 맨 앞에 넣는다(묶음 순서 = 처음 나온 순서)
  T.LIB_TOOLS.unshift.apply(T.LIB_TOOLS, LIBX);
  T.RND_TOOLS.unshift.apply(T.RND_TOOLS, RNDX);
  // 제안 모드: 열 때 문서 절 목록을 채운다
  document.addEventListener("click", (e) => {
    const t = e.target.closest && e.target.closest('[data-tk-tool="suggest"]'); if (!t) return;
    setTimeout(() => { const s = document.querySelector('#rnTools [data-tk-in="sec"]'), cx = C(), d = cx && cx.doc(); if (s && d) s.innerHTML = d.sections.map((x, i) => '<option value="' + i + '">' + esc((i + 1) + ". " + x.h) + ((x.body || "").trim() ? "" : " (비어 있음)") + "</option>").join(""); }, 30);
  });
})();
