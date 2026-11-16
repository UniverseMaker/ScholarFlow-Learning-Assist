(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const P = (k, d) => (window.TK ? TK.store.get(k, d) : d), PS = (k, v) => { if (window.TK) TK.store.set(k, v); };
  const uid = () => Math.random().toString(36).slice(2, 9);
  const fmtT = (t) => new Date(t).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  function toast(t, ms) { let el = $("dmToast"); if (!el) { el = document.createElement("div"); el.id = "dmToast"; el.className = "pp-toast"; document.body.appendChild(el); } el.textContent = t; el.classList.add("on"); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("on"), ms || 2600); }
  const projBar = (id, title, pid, list, right) => '<div class="ll-top"><div class="ll-t1"><b>' + title + '</b><select id="' + id + '" class="pp-proj">' + list.map((p) => '<option value="' + esc(p.id) + '"' + (p.id === pid ? " selected" : "") + ">" + esc(p.name) + "</option>").join("") + "</select></div>" + (right || "") + "</div>";
  async function pick(area, title) {
    let list = []; try { list = (await RND.ws.req("projects")).list || []; } catch (e) { area.innerHTML = '<p class="lb-warn">' + esc(e.message) + "</p>"; return null; }
    if (!list.length) { area.innerHTML = '<div class="sv hub"><div class="hub-head"><div><h2>' + title + '</h2></div></div><p class="sh-muted">연구 프로젝트를 먼저 만드세요.</p></div>'; return null; }
    let pid = P("hub.rnd", "") || (RND.cur && RND.cur()) || list[0].id; if (!list.some((p) => p.id === pid)) pid = list[0].id; return { list: list, pid: pid };
  }
  const toDoc = async (pid, title, md, note) => { const r = await RND.ws.req("doc", { pid: pid }, { title: title, kind: "report", sections: [{ h: title, body: md }], html: window.REPORT ? REPORT.md(md) : "", style: { numbering: "korean" }, note: note }); return r.doc; };

  /* ================================================================== 🔭 심층 조사 */
  const D = { pid: "", list: [], cur: null, busy: false };
  const dk = () => "rnd.deep." + D.pid, dl = () => ((P(dk(), null) || {}).list) || [];
  function dsave() { const l = dl(); const i = l.findIndex((x) => x.id === D.cur.id); if (i >= 0) l[i] = D.cur; else l.unshift(D.cur); PS(dk(), { list: l.slice(0, 30) }); }
  async function dPaint(area) {
    D.area = area; const p = await pick(area, "심층 조사"); if (!p) return; if (p.pid !== D.pid) { D.pid = p.pid; D.cur = null; } D.list = p.list; area.onclick = dClick;
    const l = dl(); area.innerHTML = '<div class="sv ll dr" id="dr">' + projBar("drProj", "🔭 심층 조사", D.pid, D.list) + '<div class="dr-body"><aside class="mr-card dr-side"><button type="button" class="primary small-btn" data-d="new">＋ 새 조사</button>' + l.map((x) => '<button type="button" class="rp-di' + (D.cur && D.cur.id === x.id ? " on" : "") + '" data-do="' + x.id + '"><b>' + esc(x.q.slice(0, 50)) + "</b><small>" + fmtT(x.t) + " · " + (x.report ? "완료" : "진행") + "</small></button>").join("") + '</aside><main id="drMain" class="dr-main"></main></div></div>';
    $("drProj").addEventListener("change", (e) => { PS("hub.rnd", e.target.value); dPaint(area); }); dMain();
  }
  function dMain() {
    const m = $("drMain"), c = D.cur; if (!m) return;
    if (!c) { m.innerHTML = '<section class="mr-card dr-ask"><h3>무엇을 깊이 조사할까요?</h3><textarea id="drQ" rows="3" placeholder="예: 도시 안전 분야에서 그래프 신경망 예측 모델의 실증 성과와 한계는?"></textarea><div class="dr-src"><label><input type="checkbox" id="drMat" checked> 프로젝트 자료</label><label><input type="checkbox" id="drPap" checked> 학술 문헌(OpenAlex)</label><button type="button" class="primary" data-d="plan">조사 계획 세우기</button></div><p class="sh-muted">먼저 하위 질문을 세워 보여 드려요. 고친 뒤 시작하면 질문마다 근거를 찾아 번호를 달아 답하고, 근거가 약한 곳은 약하다고 표시해요. 웹 일반 검색은 하지 않아요.</p></section>'; return; }
    const steps = c.subs || []; const srcs = c.sources || [];
    m.innerHTML = '<section class="mr-card"><div class="dr-h"><h3>' + esc(c.q) + "</h3>" + (c.report ? '<span class="dr-acts"><button type="button" class="ghost-btn small-btn" data-d="map">🕸 지식 지도</button><button type="button" class="primary small-btn" data-d="doc">→ 보고서 문서로</button></span>' : "") + '</div><ol class="dr-steps">' + steps.map((s, i) => '<li class="' + (s.done ? "done" : "") + '"><div class="dr-s"><i>' + (s.done ? "✓" : c.run && c.at === i ? "…" : i + 1) + '</i><span contenteditable="' + (c.started ? "false" : "true") + '" data-sq="' + i + '">' + esc(s.q) + "</span>" + (c.started ? (s.conf ? '<em class="c-' + s.conf + '">' + ({ high: "근거 강함", mid: "근거 보통", low: "근거 약함" }[s.conf] || "") + "</em>" : "") : '<button type="button" class="pp-ib" data-dx="' + i + '" aria-label="지우기">✕</button>') + "</div>" + (s.ans ? '<div class="dr-a tk-md">' + cite(TK.md(s.ans), srcs) + "</div>" : "") + "</li>").join("") + "</ol>" + (c.started && !c.report && !D.busy ? '<div class="lb-row"><span class="sh-muted">조사가 중간에 멈췄어요. 끝난 질문은 그대로 두고 이어서 해요.</span><span style="flex:1"></span><button type="button" class="primary" data-d="go">이어서 조사</button></div>' : "") + (c.started ? "" : '<div class="lb-row"><button type="button" class="ghost-btn small-btn" data-d="addq">＋ 질문 더하기</button><span style="flex:1"></span><button type="button" class="primary" data-d="go">▶ 조사 시작</button></div>') + "</section>" +
      (c.report ? '<section class="mr-card dr-rep tk-md">' + cite(TK.md(c.report), srcs) + "</section>" : "") + '<div id="drMap"></div>' +
      (srcs.length ? '<section class="mr-card"><h4>출처 ' + srcs.length + '</h4><ol class="dr-srcs">' + srcs.map((s, i) => '<li id="drS' + (i + 1) + '">' + (s.kind === "paper" ? "📄 " : "📎 ") + (s.url ? '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.title) + "</a>" : esc(s.title)) + (s.meta ? " <small>" + esc(s.meta) + "</small>" : "") + "</li>").join("") + "</ol></section>" : "");
    m.oninput = (e) => { const t = e.target.closest("[data-sq]"); if (t) { c.subs[+t.dataset.sq].q = t.textContent; dsave(); } };
  }
  function cite(h, srcs) { return h.replace(/\[(\d{1,3})\]/g, (m, n) => (srcs[+n - 1] ? '<a class="dr-c" href="#drS' + n + '" title="' + esc(srcs[+n - 1].title) + '">' + n + "</a>" : m)); }
  async function dPlan() {
    const q = ($("drQ").value || "").trim(); if (!q) return toast("질문을 쓰세요"); const mat = $("drMat").checked, pap = $("drPap").checked; const m = $("drMain"); m.insertAdjacentHTML("beforeend", '<p class="sh-muted"><span class="lb-dots"><i></i><i></i><i></i></span> 계획 세우는 중…</p>');
    try { const r = await TK.aiJSON({ sys: "당신은 연구 조사 설계자입니다. 큰 질문을 서로 겹치지 않는 하위 질문 4~6개로 나눕니다. 한국어로.", user: q, shape: '{"subs":["하위 질문"]}', tokens: 700 }); D.cur = { id: uid(), t: Date.now(), q: q, mat: mat, pap: pap, subs: (r.subs || []).map((s) => ({ q: s })), sources: [] }; dsave(); dPaint(D.area); } catch (e) { toast(e.message, 5000); dMain(); }
  }
  async function dGo() {
    if (D.busy) return; const c = D.cur; D.busy = true; c.started = true; c.run = true; dMain(); let ctx = null;
    try {
      if (c.mat) { try { await RND.prepare(D.pid); ctx = RND.ctx(); } catch (e) { ctx = null; } }
      for (let i = 0; i < c.subs.length; i++) {
        const s = c.subs[i]; if (s.done) continue; c.at = i; dMain(); const ev = [];   // (v122) 멈춘 조사는 끝난 질문을 건너뛰고 이어 간다
        if (ctx) { try { const ch = await ctx.retrieve(s.q, 5, 4000) || []; ch.forEach((x) => { const title = (x.name || "자료") + (x.p ? " p." + x.p : ""); let n = c.sources.findIndex((v) => v.title === title) + 1; if (!n) { c.sources.push({ kind: "file", title: title }); n = c.sources.length; } ev.push("[" + n + "] " + String(x.text || "").slice(0, 900)); }); } catch (e) { /* 계속 */ } }
        if (c.pap) { try { const kw = await TK.ai({ sys: "영어 학술 검색어만 한 줄로 출력.", user: s.q, tokens: 40 }); const ws = (await TK.BIB.search(String(kw).replace(/["\n]/g, " ").trim())).slice(0, 5); for (const w of ws) { let abs = ""; try { const r = await fetch("https://api.openalex.org/works?per-page=1&select=abstract_inverted_index&filter=doi:" + encodeURIComponent(w.doi || "none")); const a = (((await r.json()).results || [])[0] || {}).abstract_inverted_index; if (a) { const o = []; Object.keys(a).forEach((k) => a[k].forEach((p) => { o[p] = k; })); abs = o.join(" "); } } catch (e) { /* 계속 */ } let n = c.sources.findIndex((v) => v.title === w.title) + 1; if (!n) { c.sources.push({ kind: "paper", title: w.title, url: w.doi ? "https://doi.org/" + w.doi : w.url, meta: (w.authors || "").split(",")[0] + " " + (w.year || "") + (w.cited ? " · 인용 " + w.cited : "") }); n = c.sources.length; } ev.push("[" + n + "] " + w.title + " (" + w.year + ")" + (abs ? ": " + abs.slice(0, 700) : " — 초록 없음")); } } catch (e) { /* 계속 */ } }
        const r = await TK.aiJSON({ sys: "당신은 꼼꼼한 연구원입니다. 주어진 근거에 있는 내용만, 문장 끝에 [번호]를 달아 한국어로 답합니다. 근거가 없으면 없다고 씁니다.", user: "[큰 질문] " + c.q + "\n[하위 질문] " + s.q + "\n\n[근거]\n" + (ev.join("\n\n") || "(찾은 근거 없음)"), shape: '{"answer":"마크다운 답(3~6문장, [번호] 인용)","confidence":"high|mid|low"}', tokens: 1000 });
        s.ans = r.answer || "근거를 찾지 못했어요."; s.conf = /^(high|mid|low)$/.test(r.confidence) ? r.confidence : "low"; s.done = true; dsave(); dMain();
      }
      c.at = -1; dMain();
      c.report = await TK.ai({ sys: "당신은 연구 보고 작성자입니다. 소견에 있는 내용만 쓰고 [번호] 인용을 그대로 유지합니다. 한국어로.", user: "[질문] " + c.q + "\n\n" + c.subs.map((s, i) => "### " + (i + 1) + ". " + s.q + " (확신도 " + s.conf + ")\n" + s.ans).join("\n\n") + "\n\n형식: ## 핵심 답(3문장) ## 주요 발견 ## 서로 어긋나는 근거 ## 아직 모르는 것(추가 조사) ## 시사점", tokens: 2200 });
      c.run = false; dsave(); dPaint(D.area);
    } catch (e) { c.run = false; c.started = false; toast(e.message, 6000); dsave(); dMain(); }
    D.busy = false;
  }
  async function dMap() {
    const c = D.cur, box = $("drMap"); box.innerHTML = '<p class="sh-muted"><span class="lb-dots"><i></i><i></i><i></i></span> 개념을 뽑는 중…</p>';
    try {
      const r = c.graph || await TK.aiJSON({ sys: "조사 내용에서 핵심 개념과 관계를 뽑습니다. 한국어, 개념은 8자 이내.", user: c.report.slice(0, 7000), shape: '{"nodes":[{"id":"개념","type":"방법|데이터|결과|문제|기관"}],"edges":[{"a":"개념","b":"개념","t":"관계(3자 안팎)"}]}', tokens: 1200 }); c.graph = r; dsave();
      const N = (r.nodes || []).slice(0, 30), W = 900, H = 460, P2 = N.map((n, i) => ({ x: W / 2 + Math.cos(i * 2.4) * (60 + i * 11), y: H / 2 + Math.sin(i * 2.4) * (40 + i * 7), vx: 0, vy: 0 })), ix = {}; N.forEach((n, i) => { ix[n.id] = i; }); const E = (r.edges || []).filter((e) => ix[e.a] != null && ix[e.b] != null);
      for (let t = 0; t < 240; t++) { for (let i = 0; i < N.length; i++) for (let j = i + 1; j < N.length; j++) { const dx = P2[i].x - P2[j].x, dy = P2[i].y - P2[j].y, d = Math.sqrt(dx * dx + dy * dy) + 0.1, f = 9000 / (d * d); P2[i].vx += dx / d * f; P2[i].vy += dy / d * f; P2[j].vx -= dx / d * f; P2[j].vy -= dy / d * f; } E.forEach((e) => { const a = P2[ix[e.a]], b = P2[ix[e.b]], dx = b.x - a.x, dy = b.y - a.y; a.vx += dx * 0.01; a.vy += dy * 0.01; b.vx -= dx * 0.01; b.vy -= dy * 0.01; }); P2.forEach((p) => { p.vx += (W / 2 - p.x) * 0.006; p.vy += (H / 2 - p.y) * 0.012; p.x = Math.max(50, Math.min(W - 50, p.x + p.vx * 0.5)); p.y = Math.max(26, Math.min(H - 26, p.y + p.vy * 0.5)); p.vx *= 0.6; p.vy *= 0.6; }); }
      const COL = { 방법: "#2563eb", 데이터: "#0d9488", 결과: "#16a34a", 문제: "#dc2626", 기관: "#7c3aed" };
      box.innerHTML = '<section class="mr-card"><h4>🕸 지식 지도</h4><svg viewBox="0 0 ' + W + " " + H + '" class="dr-map">' + E.map((e) => { const a = P2[ix[e.a]], b = P2[ix[e.b]]; return '<line x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '" stroke="#cbd5e1"/><text x="' + (a.x + b.x) / 2 + '" y="' + (a.y + b.y) / 2 + '" text-anchor="middle" font-size="9.5" fill="#64748b">' + esc(e.t) + "</text>"; }).join("") + N.map((n, i) => { const w = 18 + String(n.id).length * 12; return '<rect x="' + (P2[i].x - w / 2) + '" y="' + (P2[i].y - 13) + '" width="' + w + '" height="26" rx="13" fill="' + (COL[n.type] || "#475569") + '"/><text x="' + P2[i].x + '" y="' + (P2[i].y + 4) + '" text-anchor="middle" font-size="12" font-weight="700" fill="#fff">' + esc(n.id) + "</text>"; }).join("") + "</svg></section>";
    } catch (e) { box.innerHTML = '<p class="lb-warn">' + esc(e.message) + "</p>"; }
  }
  async function dClick(e) {
    const t = e.target; let b; const c = D.cur;
    if ((b = t.closest("[data-do]"))) { D.cur = dl().find((x) => x.id === b.dataset.do); dPaint(D.area); return; }
    if ((b = t.closest("[data-dx]"))) { c.subs.splice(+b.dataset.dx, 1); dsave(); dMain(); return; }
    if ((b = t.closest("[data-d]"))) {
      const k = b.dataset.d;
      if (k === "new") { D.cur = null; dPaint(D.area); } if (k === "plan") dPlan(); if (k === "go") dGo(); if (k === "map") dMap(); if (k === "addq") { c.subs.push({ q: "새 질문" }); dsave(); dMain(); }
      if (k === "doc") { const md = c.report + "\n\n## 출처\n" + c.sources.map((s, i) => (i + 1) + ". " + s.title + (s.meta ? " — " + s.meta : "")).join("\n"); try { const d = await toDoc(D.pid, "조사: " + c.q.slice(0, 40), md, "심층 조사"); toast("작업 문서 '" + d.title + "' 를 만들었어요 — 📝 보고서에서 열 수 있어요", 5000); } catch (er) { toast(er.message, 5000); } }
    }
  }

  /* ================================================================== 🗓 회의실 */
  const M = { pid: "", list: [], cur: null, tab: "meet", sv: null, area: null };
  const mk = () => "rnd.meet." + M.pid; const mdata = () => { const d = P(mk(), null) || {}; d.list = d.list || []; d.surveys = d.surveys || []; return d; };
  function msave() { const d = mdata(); if (M.cur) { const i = d.list.findIndex((x) => x.id === M.cur.id); if (i >= 0) d.list[i] = M.cur; else d.list.unshift(M.cur); } if (M.sv) { const i = d.surveys.findIndex((x) => x.id === M.sv.id); if (i >= 0) d.surveys[i] = M.sv; else d.surveys.unshift(M.sv); } PS(mk(), d); }
  const msoon = () => { clearTimeout(M._s); M._s = setTimeout(msave, 500); };
  async function mPaint(area) {
    M.area = area; const p = await pick(area, "회의실"); if (!p) return; if (p.pid !== M.pid) { M.pid = p.pid; M.cur = null; M.sv = null; } M.list = p.list; area.onclick = mClick; const d = mdata();
    area.innerHTML = '<div class="sv ll dr" id="mt">' + projBar("mtProj", "🗓 회의실", M.pid, M.list, '<nav class="ll-tabs"><button type="button" data-mtab="meet" class="' + (M.tab === "meet" ? "on" : "") + '">회의록</button><button type="button" data-mtab="survey" class="' + (M.tab === "survey" ? "on" : "") + '">📋 설문 설계실</button></nav>') + '<div class="dr-body"><aside class="mr-card dr-side">' + (M.tab === "meet" ? '<button type="button" class="primary small-btn" data-mm="new">＋ 새 회의</button>' + d.list.map((x) => '<button type="button" class="rp-di' + (M.cur && M.cur.id === x.id ? " on" : "") + '" data-mo="' + x.id + '"><b>' + esc(x.title) + "</b><small>" + esc(x.date) + " · 할 일 " + ((x.actions || []).filter((a) => !a.done).length) + "</small></button>").join("") : '<button type="button" class="primary small-btn" data-mm="snew">＋ 새 설문</button>' + d.surveys.map((x) => '<button type="button" class="rp-di' + (M.sv && M.sv.id === x.id ? " on" : "") + '" data-so="' + x.id + '"><b>' + esc(x.goal.slice(0, 40)) + "</b><small>문항 " + (x.qs || []).length + "</small></button>").join("")) + '</aside><main id="mtMain" class="dr-main"></main></div></div>';
    $("mtProj").addEventListener("change", (e) => { PS("hub.rnd", e.target.value); mPaint(area); }); if (M.tab === "meet") mMain(); else sMain();
  }
  function mMain() {
    const m = $("mtMain"), c = M.cur, d = mdata(); if (!m) return;
    if (!c) { const open = [].concat(...d.list.map((x) => (x.actions || []).filter((a) => !a.done).map((a) => Object.assign({ from: x.title }, a)))); m.innerHTML = '<section class="mr-card"><h4>아직 끝나지 않은 할 일 ' + open.length + "</h4>" + (open.length ? '<table class="rh-tbl"><thead><tr><th>할 일</th><th>담당</th><th>기한</th><th>회의</th></tr></thead><tbody>' + open.map((a) => '<tr><td class="t">' + esc(a.task) + "</td><td>" + esc(a.who || "-") + "</td><td>" + esc(a.due || "-") + "</td><td>" + esc(a.from) + "</td></tr>").join("") + "</tbody></table>" : '<p class="sh-muted">없어요. ＋ 새 회의로 시작하세요.</p>') + "</section>"; return; }
    m.innerHTML = '<section class="mr-card mt-head"><input id="mtTitle" value="' + esc(c.title) + '" placeholder="회의 제목"><input id="mtDate" type="date" value="' + esc(c.date) + '"><input id="mtWho" value="' + esc(c.who || "") + '" placeholder="참석자 (쉼표)"></section><div class="mt-two"><section class="mr-card"><h4>📌 안건</h4><textarea id="mtAgenda" rows="3" placeholder="한 줄에 하나">' + esc(c.agenda || "") + '</textarea><h4>📝 회의 메모 <button type="button" class="ghost-btn small-btn" data-mm="mic" id="mtMic">🎙 받아쓰기</button></h4><textarea id="mtNotes" rows="15" placeholder="대충 적어도 돼요 — 끝나면 AI 가 정리해요">' + esc(c.notes || "") + '</textarea><button type="button" class="primary mr-go" data-mm="ai">✨ 회의록 정리</button></section><section class="mr-card"><h4>요약</h4><div class="tk-md" id="mtSum">' + (c.summary ? TK.md(c.summary) : '<p class="sh-muted">정리하면 여기에 나와요.</p>') + "</div><h4>결정 사항</h4><ul>" + (c.decisions || []).map((x) => "<li>" + esc(x) + "</li>").join("") + '</ul><h4>할 일</h4><table class="rh-tbl mt-act"><tbody>' + (c.actions || []).map((a, i) => '<tr class="' + (a.done ? "done" : "") + '"><td><input type="checkbox" data-ad="' + i + '"' + (a.done ? " checked" : "") + '></td><td class="t" contenteditable="true" data-at="' + i + '|task">' + esc(a.task) + '</td><td contenteditable="true" data-at="' + i + '|who">' + esc(a.who || "") + '</td><td contenteditable="true" data-at="' + i + '|due">' + esc(a.due || "") + "</td></tr>").join("") + "</tbody></table>" + ((c.open || []).length ? "<h4>미결·다음에</h4><ul>" + c.open.map((x) => "<li>" + esc(x) + "</li>").join("") + "</ul>" : "") + '<div class="lb-row" style="margin-top:10px"><button type="button" class="ghost-btn small-btn" data-mm="todo">✅ 프로젝트 할 일로 보내기</button>' + ((M.list || []).some((p) => p.id === M.pid && p.rnd) ? '<button type="button" class="ghost-btn small-btn" data-mm="admin">연구행정에 회의록 등록</button>' : "") + '<button type="button" class="ghost-btn small-btn" data-mm="doc">📝 회의록 문서로</button><span style="flex:1"></span><button type="button" class="ghost-btn small-btn" data-mm="del">지우기</button></div></section></div>';
    [["mtTitle", "title"], ["mtDate", "date"], ["mtWho", "who"], ["mtAgenda", "agenda"], ["mtNotes", "notes"]].forEach(([id, k]) => $(id).addEventListener("input", (e) => { c[k] = e.target.value; msoon(); }));
    m.oninput = (e) => { const t = e.target.closest("[data-at]"); if (t) { const [i, f] = t.dataset.at.split("|"); c.actions[+i][f] = t.textContent; msoon(); } };
    m.onchange = (e) => { const t = e.target.closest("[data-ad]"); if (t) { c.actions[+t.dataset.ad].done = t.checked; msave(); } };
  }
  async function mAi() {
    const c = M.cur; if (!(c.notes || "").trim()) return toast("메모를 먼저 쓰세요"); toast("정리 중…", 6000); const prev = [].concat(...mdata().list.filter((x) => x.id !== c.id).map((x) => (x.actions || []).filter((a) => !a.done).map((a) => a.task))).slice(0, 15);
    try { const r = await TK.aiJSON({ sys: "당신은 회의록 담당자입니다. 메모에 있는 내용만, 말하지 않은 결정을 만들지 마세요. 개조식 한국어로. 담당·기한이 없으면 비웁니다.", user: "[제목] " + c.title + "\n[참석] " + (c.who || "") + "\n[안건]\n" + (c.agenda || "") + "\n[메모]\n" + c.notes + (prev.length ? "\n[지난 회의 미완료 — 이번에 언급되었으면 open 에 진행 상황을]\n" + prev.join("\n") : ""), shape: '{"summary":"3~5줄 마크다운","decisions":[""],"actions":[{"task":"","who":"","due":"YYYY-MM-DD 또는 빈칸"}],"open":["미결"]}', tokens: 1500 }); c.summary = r.summary; c.decisions = r.decisions || []; c.actions = (r.actions || []).map((a) => Object.assign({ done: false }, a)); c.open = r.open || []; msave(); mPaint(M.area); } catch (e) { toast(e.message, 5000); }
  }
  /* ---- 📋 설문 설계실 ---- */
  function sMain() {
    const m = $("mtMain"), s = M.sv; if (!m) return;
    if (!s) { m.innerHTML = '<section class="mr-card dr-ask"><h3>무엇을 알고 싶나요?</h3><textarea id="svGoal" rows="3" placeholder="예: 시민이 AI 안전 지도를 얼마나 신뢰하고 쓸 의향이 있는지"></textarea><input id="svWho" placeholder="대상 (예: 서울 시민 20~60대)"><button type="button" class="primary mr-go" data-mm="sgen">✨ 문항 설계</button></section>'; return; }
    m.innerHTML = '<section class="mr-card"><div class="dr-h"><h3>' + esc(s.goal) + '</h3><span class="dr-acts"><button type="button" class="ghost-btn small-btn" data-mm="sadd">＋ 문항</button><label class="sv-n">가상 응답 <input id="svN" type="number" min="10" max="200" value="' + (s.n || 50) + '"></label><button type="button" class="primary small-btn" data-mm="ssim">▶ 시뮬레이션</button></span></div><p class="sh-muted">시뮬레이션은 AI 가 대상자를 상상한 가상 응답이에요. 실제 조사 결과가 아니라 문항 문제를 미리 찾는 용도입니다.</p>' + s.qs.map((q, i) => { const r = (s.sim || {})[i]; const tot = r ? Object.values(r.dist || {}).reduce((a, b) => a + (+b || 0), 0) || 1 : 1; return '<div class="sv-q"><b>' + (i + 1) + '</b><div><div contenteditable="true" data-qt="' + i + '" class="sv-t">' + esc(q.t) + '</div><small>' + esc({ likert: "5점 척도", single: "객관식", open: "주관식" }[q.type] || q.type) + "</small>" + (q.opts || []).map((o) => { const v = r ? +((r.dist || {})[o] || 0) : null; return '<div class="sv-o"><span>' + esc(o) + "</span>" + (v != null ? '<i style="width:' + Math.round(v / tot * 100) + '%"></i><em>' + Math.round(v / tot * 100) + "%</em>" : "") + "</div>"; }).join("") + (r && r.issue ? '<p class="sv-iss">⚠ ' + esc(r.issue) + "</p>" : "") + '</div><button type="button" class="pp-ib" data-qx="' + i + '" aria-label="지우기">✕</button></div>'; }).join("") + "</section>";
    m.oninput = (e) => { const t = e.target.closest("[data-qt]"); if (t) { s.qs[+t.dataset.qt].t = t.textContent; msoon(); } if (e.target.id === "svN") { s.n = +e.target.value || 50; msoon(); } };
  }
  async function sGen() { const goal = ($("svGoal").value || "").trim(); if (!goal) return toast("목적을 쓰세요"); const who = $("svWho").value.trim(); toast("문항 설계 중…", 6000); try { const r = await TK.aiJSON({ sys: "당신은 조사 방법론 전문가입니다. 이중 질문·유도 질문을 피하고 쉬운 말로. 한국어로.", user: "목적: " + goal + "\n대상: " + who + "\n문항 8~12개.", shape: '{"qs":[{"t":"문항","type":"likert|single|open","opts":["보기(likert 는 매우 그렇다~전혀 아니다 5개)"]}]}', tokens: 1800 }); M.sv = { id: uid(), goal: goal, who: who, qs: r.qs || [], n: 50 }; msave(); mPaint(M.area); } catch (e) { toast(e.message, 5000); } }
  async function sSim() { const s = M.sv; toast("가상 응답 중…", 8000); try { const r = await TK.aiJSON({ sys: "당신은 설문 사전 검증 전문가입니다. 대상 집단의 다양한 사람을 상상해 응답 분포를 어림합니다. 실제 통계인 척하지 말고, 문항 문제(모호·이중·쏠림·민감)를 지적합니다. 한국어로.", user: "대상: " + (s.who || "일반") + " / 응답자 " + (s.n || 50) + "명\n" + JSON.stringify(s.qs.map((q, i) => ({ i: i, t: q.t, opts: q.opts }))), shape: '{"rows":[{"i":0,"dist":{"보기":명수},"issue":"문항 문제(없으면 빈칸)"}]}', tokens: 2600 }); s.sim = {}; (r.rows || []).forEach((x) => { s.sim[x.i] = x; }); msave(); sMain(); } catch (e) { toast(e.message, 5000); } }
  async function mClick(e) {
    const t = e.target; let b; const c = M.cur;
    if ((b = t.closest("[data-mtab]"))) { M.tab = b.dataset.mtab; mPaint(M.area); return; }
    if ((b = t.closest("[data-mo]"))) { M.cur = mdata().list.find((x) => x.id === b.dataset.mo); mPaint(M.area); return; }
    if ((b = t.closest("[data-so]"))) { M.sv = mdata().surveys.find((x) => x.id === b.dataset.so); mPaint(M.area); return; }
    if ((b = t.closest("[data-qx]"))) { M.sv.qs.splice(+b.dataset.qx, 1); msave(); sMain(); return; }
    if ((b = t.closest("[data-mm]"))) {
      const k = b.dataset.mm;
      if (k === "new") { M.cur = { id: uid(), title: "회의 " + new Date().toLocaleDateString("ko-KR"), date: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10), notes: "", actions: [] }; msave(); mPaint(M.area); }
      if (k === "snew") { M.sv = null; mPaint(M.area); } if (k === "sgen") sGen(); if (k === "ssim") sSim(); if (k === "sadd") { M.sv.qs.push({ t: "새 문항", type: "likert", opts: ["매우 그렇다", "그렇다", "보통", "아니다", "전혀 아니다"] }); msave(); sMain(); }
      if (k === "ai") mAi();
      if (k === "mic") { const ta = $("mtNotes"); if (M.rec) { M.rec.stop(); M.rec = null; b.textContent = "🎙 받아쓰기"; return; } const base = ta.value; const rec = TOOLSETS.X2.stt((f, i) => { ta.value = base + (base ? "\n" : "") + f + (i || ""); c.notes = ta.value; msoon(); }); if (!rec) return toast("이 브라우저는 음성 입력을 못 써요"); M.rec = rec; rec.start(); b.textContent = "⏹ 그만"; }
      if (k === "todo") { const key = "rnd.todo." + M.pid; const l = TK.store.get(key, []) || []; let n = 0; (c.actions || []).filter((a) => !a.done).forEach((a) => { if (!l.some((x) => x.what === a.task)) { l.push({ what: a.task + (a.who ? " (" + a.who + ")" : ""), due: a.due || "", done: false, at: Date.now() }); n++; } }); TK.store.set(key, l); toast("할 일 " + n + "건을 보냈어요"); }
      if (k === "admin") {
        if (!confirm("이 회의록을 연구행정관리시스템에 등록할까요?\n\n" + c.title + " (" + c.date + ")\n할 일 " + (c.actions || []).length + "건\n\n다시 보내면 같은 항목을 고쳐요.")) return;
        const line = (a) => "- " + a.task + (a.who ? " (" + a.who + ")" : "") + (a.due ? " ~" + a.due : "");
        const body = { meetingId: c.id, title: c.title, date: c.date, attendees: c.who || "", minutes: [c.summary || c.notes || "", (c.decisions || []).length ? "[결정 사항]\n" + c.decisions.map((x) => "- " + x).join("\n") : ""].filter(Boolean).join("\n\n"), actions: (c.actions || []).map(line).join("\n") };
        try {
          const r = await fetch("api.php?r=rnd&op=meeting&pid=" + encodeURIComponent(M.pid), { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-Study-Vault": "1" }, body: JSON.stringify(body) }), d = await r.json();
          if (!d.ok) throw new Error(d.message || "등록하지 못했어요");
          toast(d.meta && d.meta.idempotent ? "이미 등록된 회의록이라 내용을 고쳤어요" : "연구행정에 회의록을 등록했어요");
        } catch (er) { toast("⚠ " + er.message, 5000); }
      }
      if (k === "doc") { const md = "■ 일시: " + c.date + "\n■ 참석: " + (c.who || "") + "\n\n## 요약\n" + (c.summary || "") + "\n\n## 결정 사항\n" + (c.decisions || []).map((x) => "□ " + x).join("\n") + "\n\n## 할 일\n| 할 일 | 담당 | 기한 |\n|---|---|---|\n" + (c.actions || []).map((a) => "| " + a.task + " | " + (a.who || "") + " | " + (a.due || "") + " |").join("\n"); try { const d = await toDoc(M.pid, c.title, md, "회의실"); toast("작업 문서 '" + d.title + "' 를 만들었어요", 4000); } catch (er) { toast(er.message, 5000); } }
      if (k === "del") { if (!confirm("이 회의를 지울까요?")) return; const d = mdata(); d.list = d.list.filter((x) => x.id !== c.id); PS(mk(), d); M.cur = null; mPaint(M.area); }
    }
  }
  function build() {
    const content = document.querySelector("main.content"); if (!content || typeof EXT_VIEWS === "undefined") return;
    [["rx_deep", dPaint], ["rx_meet", mPaint]].forEach(([k, fn]) => { let a = $("hub_" + k); if (!a) { a = document.createElement("section"); a.id = "hub_" + k; a.className = "hidden"; content.appendChild(a); } EXT_VIEWS[k] = { area: a, open: () => fn(a).catch((er) => { a.innerHTML = '<p class="lb-warn">' + esc(er.message) + "</p>"; }) }; });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(build, 0)); else setTimeout(build, 30);
})();
