/* =============================================================================
 * rndread.js (v98) — 연구지원 [📖 자료 보기] = 읽기 작업대: 뷰어 | 💬 AI · 📝 문서 · 📌 수집함 · 🔎 찾기 · 🗂 주석 (옆 칸에 문서·수집함을 하나 더)
 *   · AI 는 '지금 보는 곳'(쪽·구간 글) + 고른 부분 + 프로젝트 전체 자료(BM25 발췌)를 함께 보고 답한다 → (파일 p.N) 인용, 누르면 그 쪽으로
 *   · ✍ 문서에 바로 쓰기: 대화가 곧 편집 — "이 쪽 요약해 넣어 줘", "2절 짧게", "표로 바꿔" 를 AI 가 작업 문서에 바로 반영(바뀐 절 표시·되돌리기)
 *   · 찾기: 뷰어가 이 자료 전 쪽을 찾고, 없거나 '다른 자료도'를 켜면 프로젝트의 다른 자료를 뒤져 🔎 찾기 칸에 모은다 → 누르면 그 자료·그 쪽·그 글자로
 *   · 고른 글·AI 답·메모를 수집함에 모아 → AI 로 요약 노트·보고서·발표 자료·브리핑·비교표 → 문서 저장 → DOCX·PPTX·HTML·MD
 *   · 주석(형광펜·메모·책갈피)은 파일별로 계정에 실시간 저장(docview.js)
 *   · 높이는 화면에 딱 맞춘다(fit) — 페이지 스크롤·아래 빈 공간 없음, 안쪽 칸만 스크롤
 *   rnd.js 가 INT(내부 함수)를 넘겨준다: R, WS, retrieve, groundBlock, sysPrompt, write, makeDoc, saveDoc, newDoc, exportDoc, toDocMsg, paintSide, paintHist, setTab, persist, inCtx
 * ========================================================================== */
(function () {
  "use strict";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (id) => document.getElementById(id);
  const st = (k, d) => (window.TK ? TK.store.get(k, d) : d);
  const sset = (k, v) => { if (window.TK) TK.store.set(k, v); };
  const QUICK = [["이 쪽 요약", "지금 보는 곳을 5줄로 요약해 줘. 핵심 수치·용어는 그대로."], ["쉽게 설명", "지금 보는 곳을 처음 보는 사람도 알게 쉽게 설명해 줘(비유 1개)."], ["앞뒤 연결", "지금 보는 곳이 자료 전체에서 어떤 역할인지, 다른 부분(다른 쪽·다른 자료)과 어떻게 이어지는지 알려 줘."], ["표·수치 정리", "지금 보는 곳의 수치·일정·금액·지표를 표로 정리해 줘."], ["비판적으로", "지금 보는 곳의 주장에서 근거가 약하거나 모호한 곳, 평가자가 지적할 점을 짚어 줘."], ["예상 질문", "지금 보는 곳에서 심사·발표 때 나올 질문 5개와 답 방향."]];
  // ✍ 문서 쓰기 모드의 빠른 지시
  const DOCQ = [["이 쪽 요약해 넣기", "지금 보는 곳을 핵심 5줄과 수치로 요약해서 문서에 새 절로 넣어 줘(출처 쪽 표기)."], ["초안 쓰기", "지금까지의 대화와 보는 자료를 바탕으로 문서 초안을 써 줘. 차례는 4~6절, 각 절은 자료 근거로."], ["표로 정리해 넣기", "지금 보는 곳의 수치·일정·금액을 표 절로 만들어 문서에 넣어 줘."], ["문서 다듬기", "문서 전체를 읽기 쉽게 다듬어 줘. 내용·수치·출처는 그대로."], ["개조식으로", "문서 전체를 보고서 개조식(명사형 종결, 불릿)으로 바꿔 줘."], ["결론·제언 쓰기", "문서 끝에 결론과 제언 절을 써 줘."], ["빠진 것 채우기", "문서에서 빠졌거나 근거가 약한 곳을 자료로 보강해 줘."]];
  const MAKE = [["note", "요약 노트"], ["report", "보고서"], ["slides", "발표 자료(PPT)"], ["brief", "브리핑 1쪽"], ["table", "비교·정리 표"], ["free", "자유(지시대로)"]];
  const TABS = [["ai", "💬", "AI"], ["doc", "📝", "문서"], ["col", "📌", "수집함"], ["find", "🔎", "찾기"], ["ann", "🗂", "주석"]];
  let I = null, V = null, cur = null, where = null, msgs = [], busy = false, paneEl = null, flashI = [];
  const TX = {};                       // 다른 자료 찾기용 글 캐시(fid → 글)
  const FS = { q: "", tok: 0, res: [], sem: [], busy: false, done: 0, total: 0, here: null };

  /* ---------------- 그리기 ---------------- */
  function paint(pane, internals) {
    I = internals; paneEl = pane;
    const R = I.R;
    const vis = R.files.filter((f) => !f.hidden);
    if (!R.srcFid || !R.files.some((f) => f.id === R.srcFid)) R.srcFid = (vis.filter((f) => f.chars)[0] || vis[0] || {}).id || null;
    const f = R.files.filter((x) => x.id === R.srcFid)[0];
    if (V) { try { V.destroy(); } catch (e) { /* 계속 */ } V = null; }
    if (!f) { pane.innerHTML = '<div class="rn-empty"><b>볼 자료가 없어요</b><p class="sh-muted">왼쪽에서 자료를 올리거나 폴더를 연결하면 여기서 PDF·한글·워드·PPT·엑셀·그림·소리·영상을 바로 열고, 보는 곳을 AI 와 함께 읽어요.</p></div>'; return; }
    cur = f;
    const P = st("rr.prefs", {});
    if (P.pop === true) P.pop = "col";                       // 예전 값(수집함만 옆에) 이어받기
    const tab = P.tab || "ai", pop = P.pop || "", closed = !!P.closed;
    const groups = {}; vis.forEach((x) => { const g = x.folder ? "📁 " + (x.rel.indexOf("/") > 0 ? x.rel.split("/")[0] : "(맨 위)") : "📎 올린 자료"; (groups[g] = groups[g] || []).push(x); });
    const opt = (x) => '<option value="' + x.id + '"' + (x.id === f.id ? " selected" : "") + ">" + esc(x.folder ? x.rel : x.name) + "</option>";
    const idx = vis.findIndex((x) => x.id === f.id);
    pane.innerHTML = '<div class="rr' + (pop ? " pop" : "") + (closed ? " closed" : "") + '" style="--rr-w:' + (P.w || 420) + 'px;--rr-w2:' + (P.w2 || 380) + 'px">' +
      '<div class="rr-top"><span class="rr-g"><button type="button" class="rr-b" data-rr="prevf" title="이전 자료" aria-label="이전 자료"' + (idx <= 0 ? " disabled" : "") + '>‹</button><select id="rrSel" aria-label="볼 자료">' + Object.keys(groups).map((g) => '<optgroup label="' + esc(g) + '">' + groups[g].map(opt).join("") + "</optgroup>").join("") + '</select><button type="button" class="rr-b" data-rr="nextf" title="다음 자료" aria-label="다음 자료"' + (idx >= vis.length - 1 ? " disabled" : "") + ">›</button></span>" +
      (f.chars !== 0 ? '<label class="rr-ctx" title="대화·도구의 근거 자료에 넣기"><input type="checkbox" data-rn-ctx="' + f.id + '"' + (I.inCtx(f.id) ? " checked" : "") + "> 근거</label>" : "") +
      '<span class="rr-where" id="rrWhere"></span>' +
      '<span class="rr-g rr-tabs" role="tablist">' + TABS.map((t) => '<button type="button" class="rr-b' + (t[0] === tab && !closed ? " on" : "") + '" data-rr-tab="' + t[0] + '" role="tab" title="' + t[2] + '"><span aria-hidden="true">' + t[1] + "</span><em>" + t[2] + "</em>" + (t[0] === "col" ? '<b class="rr-n" id="rrColN">' + col().length + "</b>" : t[0] === "find" ? '<b class="rr-n hidden" id="rrFindN"></b>' : "") + "</button>").join("") + "</span>" +
      '<span class="rr-g"><button type="button" class="rr-b' + (pop ? " on" : "") + '" data-rr="pop" title="' + (pop ? "옆 칸 닫기" : "옆 칸에 작업 문서 열기 — 대화하면서 문서가 바뀌는 걸 바로 봐요") + '"><span aria-hidden="true">⫴</span><em>옆에 문서</em></button><button type="button" class="rr-b" data-rr="close" title="' + (closed ? "오른쪽 칸 열기" : "오른쪽 칸 접기 — 뷰어를 넓게") + '" aria-label="오른쪽 칸 접기·열기">' + (closed ? "⇤" : "⇥") + "</button></span></div>" +
      '<div class="rr-grid"><div class="rr-view" id="rrView"></div><div class="rr-split" data-split="1" title="끌어서 폭 조절"></div><aside class="rr-panel" id="rrPanel"></aside><div class="rr-split s2" data-split="2"></div><aside class="rr-col" id="rrCol"></aside></div></div>';
    $("rrSel").addEventListener("change", (e) => { R.srcFid = e.target.value; I.persist(); paint(pane, I); });
    const pendQ = paint.pendQ; paint.pendQ = null;
    V = DOCVIEW.mount($("rrView"), {
      name: f.folder ? f.rel.split("/").pop() : f.name, ext: (f.ext || (f.name || "").split(".").pop() || "").toLowerCase(),
      url: (op, extra) => I.WS.url(op, Object.assign({ pid: R.pid, fid: f.id }, extra || {})),
      json: (op, extra) => I.WS.req(op, Object.assign({ pid: R.pid, fid: f.id }, extra || {})),
      annKey: "rnd.ann." + R.pid + "." + f.id,
      onLocate: (w) => { where = w; paintWhere(); },
      onAnn: () => { if (curTab() === "ann") paintPanel(); },
      onAction: onAction,
      onSearchOther: onSearchOther,
    });
    if (R.srcPage > 1) { V.goto(R.srcPage); R.srcPage = 1; }
    if (pendQ) V.find(pendQ, { quiet: !!paint.pendQuiet });
    msgs = R.msgs.filter((m) => m.via === "read");
    paintPanel(); paintWhere(); bindSplit(pane);
    fit(); setTimeout(fit, 80); setTimeout(fit, 400);
  }
  const curTab = () => { const P = st("rr.prefs", {}); return P.closed ? "" : (P.tab || "ai"); };
  const col = () => st("rnd.collect." + I.R.pid, []);
  const setCol = (l) => { sset("rnd.collect." + I.R.pid, l); const n = $("rrColN"); if (n) n.textContent = l.length; if (curTab() === "col" || st("rr.prefs", {}).pop === "col") paintPanel(); };
  function paintWhere() {
    const el = $("rrWhere"); if (!el) return;
    const w = where || (V && V.where()) || {};
    el.innerHTML = w.label ? '<span aria-hidden="true">👁</span> <b>' + esc(w.label) + "</b>" : "";
    const h = $("rrAiWhere"); if (h) h.textContent = w.label || "";
  }
  function prefs(k, v) { const P = st("rr.prefs", {}); P[k] = v; sset("rr.prefs", P); }

  function paintPanel() {
    const P = st("rr.prefs", {}); let tab = P.tab || "ai"; const pop = P.pop === true ? "col" : P.pop || "";
    if (pop && tab === pop) { tab = "ai"; prefs("tab", "ai"); }   // 옆 칸과 같은 것은 두 번 보이지 않게
    document.querySelectorAll("[data-rr-tab]").forEach((b) => { b.classList.toggle("on", b.dataset.rrTab === tab && !P.closed); b.classList.toggle("in-pop", b.dataset.rrTab === pop); });
    const pn = $("rrPanel"), cl = $("rrCol"); if (!pn) return;
    if (cl) { if (pop === "doc") paintDoc(cl, true); else if (pop === "col") paintCol(cl); else cl.innerHTML = ""; }
    ({ ai: paintAi, doc: paintDoc, col: paintCol, find: paintFind, ann: paintAnn }[tab] || paintAi)(pn);
  }
  // 옆 칸이든 탭이든, 지금 '문서'가 보이는 곳
  function docHost() { const P = st("rr.prefs", {}); if (P.pop === "doc") return $("rrCol"); if ((P.tab || "ai") === "doc" && !P.closed) return $("rrPanel"); return null; }
  function docVisible() { const h = docHost(); return !!(h && h.offsetWidth > 40); }

  /* ---------------- 화면 높이에 맞추기 ---------------- */
  function scroller(el) { let p = el.parentElement; while (p && p !== document.body && p !== document.documentElement) { const o = getComputedStyle(p).overflowY; if (/(auto|scroll)/.test(o) && p.scrollHeight > p.clientHeight + 1) return p; p = p.parentElement; } return null; }
  function fit() {
    const ws = document.querySelector("#rndArea .rn-ws.fit"); if (!ws || !ws.offsetParent) return;
    const sc = scroller(ws);
    if (sc) sc.scrollTop = 0; else if (window.scrollY) window.scrollTo(0, 0);
    const gap = window.innerWidth < 760 ? 6 : 12;
    let h = Math.floor(window.innerHeight - ws.getBoundingClientRect().top - gap);
    ws.style.height = Math.max(380, h) + "px";
    const over = sc ? sc.scrollHeight - sc.clientHeight : document.documentElement.scrollHeight - window.innerHeight;   // 아래 여백 때문에 남는 만큼 더 줄인다
    if (over > 0 && over < 80) { h -= over; ws.style.height = Math.max(380, h) + "px"; }   // 바깥 여백만큼만(안쪽 칸이 넘치는 건 칸 안에서 스크롤)
  }
  window.addEventListener("resize", () => { clearTimeout(fit.t); fit.t = setTimeout(fit, 60); });
  document.addEventListener("fullscreenchange", () => setTimeout(fit, 60));
  new MutationObserver(() => setTimeout(fit, 40)).observe(document.body, { attributes: true, attributeFilter: ["class"] });

  /* ---------------- 💬 AI ---------------- */
  const writing = () => !!st("rr.prefs", {}).write;
  function paintAi(pn) {
    const P = st("rr.prefs", {}), useAll = P.all === true, wr = !!P.write;
    pn.innerHTML = '<div class="rr-ai' + (wr ? " writing" : "") + '"><div class="rr-ai-h"><span class="rr-ai-w">보는 곳 <b id="rrAiWhere"></b></span><label title="AI 는 늘 지금 쪽 → 이 자료 전체 순서로 찾아요. 켜면 프로젝트의 다른 자료까지 뒤져요"><input type="checkbox" id="rrAll"' + (useAll ? " checked" : "") + "> 다른 자료도 찾기</label>" +
      '<label class="rr-wsw' + (wr ? " on" : "") + '" title="켜면 AI 가 말한 대로 작업 문서에 바로 쓰고·고치고·요약해요(옆에 문서가 열려요)"><input type="checkbox" id="rrWrite"' + (wr ? " checked" : "") + "> ✍ 문서에 바로 쓰기</label></div>" +
      '<div class="rr-log" id="rrLog">' + (msgs.length ? msgs.map(bubble).join("") : hello(wr)) + "</div>" +
      '<div class="rr-quick">' + (wr ? DOCQ : QUICK).map((q, i) => '<button type="button" class="rr-chip" data-rr-q="' + (wr ? "d" : "q") + i + '">' + esc(q[0]) + "</button>").join("") + "</div>" +
      '<div class="rr-sel hidden" id="rrSelChip"></div><div class="rr-in"><textarea id="rrIn" rows="2" placeholder="' + (wr ? "문서에 무엇을 할까요? 예: 이 쪽 요약해서 2절에 넣어 줘 (Enter 보내기)" : "이 쪽에서 궁금한 것 (Enter 보내기 · Shift+Enter 줄바꿈)") + '"></textarea><button type="button" class="primary" data-rr="send" id="rrSend">' + (wr ? "✍ 쓰기" : "보내기") + "</button></div></div>";
    paintWhere();
    const lg = $("rrLog"); lg.scrollTop = lg.scrollHeight;
    $("rrAll").addEventListener("change", (e) => prefs("all", e.target.checked));
    $("rrWrite").addEventListener("change", (e) => {
      prefs("write", e.target.checked);
      if (e.target.checked && !docVisible()) { prefs("pop", "doc"); prefs("closed", false); paint(paneEl, I); return; }   // 쓰는 걸 바로 보이게 옆에 문서
      paintPanel();
    });
    $("rrIn").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
    paintSelChip();
  }
  function hello(wr) {
    return wr ? '<div class="rr-hello"><b>✍ 말로 문서를 써요</b><p class="sh-muted">"이 쪽 요약해서 넣어 줘", "2절을 표로 바꿔", "결론 써 줘"처럼 말하면 AI 가 옆의 작업 문서에 바로 쓰고 고쳐요. 바뀐 절은 잠깐 빛나고, 마음에 안 들면 ↩ 되돌리기.</p></div>'
      : '<div class="rr-hello"><b>보면서 물어보세요</b><p class="sh-muted">AI 는 <b>지금 보는 쪽 → 이 자료 전체</b> 순서로 찾아 답하고(검색어를 넓혀 KRU·한국연구대학교 같은 다른 표기도 찾아요), 답의 근거 쪽으로 뷰어를 옮겨 칠해 줘요. <b>다른 자료도 찾기</b>를 켜면 프로젝트의 다른 자료까지 뒤져요. "…를 문서에 넣어 줘"처럼 말하면 작업 문서에 바로 써요.</p></div>';
  }
  let pendSel = null;
  function paintSelChip() { const c = $("rrSelChip"); if (!c) return; c.classList.toggle("hidden", !pendSel); c.innerHTML = pendSel ? '✂ <b>' + esc(pendSel.label) + "</b> “" + esc(pendSel.text.slice(0, 140)) + (pendSel.text.length > 140 ? "…" : "") + '” <button type="button" class="icon-mini" data-rr="unsel" aria-label="고른 부분 빼기">✕</button>' : ""; }
  function linkCites(html) {
    const files = I.R.files;
    return html.replace(/\(([^()<>]{1,120}?)\s+p\.(\d+)\)/g, (m0, name, p) => { const f = files.filter((x) => (x.folder ? x.rel.split("/").pop() : x.name) === name.trim() || x.name === name.trim())[0]; return f ? '<a href="#" class="rr-cite" data-rr-go="' + f.id + "|" + p + '">' + m0 + "</a>" : m0; });
  }
  function bubble(m, i) {
    if (m.role === "user") return '<div class="rn-msg user"><div class="bubble user">' + (m.where ? '<small class="rr-mw">' + (m.doc ? "✍ 문서 · " : "👁 ") + esc(m.where) + "</small>" : "") + esc(m.text) + "</div></div>";
    const acts = m.text && i != null ? '<div class="rr-acts">' + (m.changes ? (m.undo ? '<button type="button" class="rr-act" data-rr-undo="' + i + '">↩ 되돌리기</button>' : "") + '<button type="button" class="rr-act" data-rr="dsave">💾 저장</button>' + (docVisible() ? "" : '<button type="button" class="rr-act" data-rr="dshow">📝 문서 보기</button>')
      : '<button type="button" class="rr-act" data-rr-colm="' + i + '">📌 담기</button><button type="button" class="rr-act" data-rr-doc="' + i + '">✍ 문서에</button><button type="button" class="rr-act" data-rr-copy="' + i + '">복사</button>') + "</div>" : "";
    const ch = m.changes && m.changes.length ? '<ul class="rr-chg">' + m.changes.map((c) => "<li>" + esc(c) + "</li>").join("") + "</ul>" : m.changes ? '<p class="rr-chg0">문서는 바꾸지 않았어요.</p>' : "";
    const tr = m.trace ? '<div class="rr-trace"><span>' + esc(m.trace) + "</span>" + (m.hits && m.hits.length ? '<span class="rr-hits">' + m.hits.map((h) => '<a href="#" data-rr-go="' + esc(h.fid + "|" + h.p + "|" + (h.q || "")) + '" title="' + esc(h.name) + ' — 그 쪽으로 가서 칠하기">' + (h.other ? "📄 " + esc(h.name.split("/").pop().slice(0, 14)) + " " : "") + "p." + h.p + "</a>").join("") + "</span>" : "") + "</div>" : "";
    return '<div class="rn-msg bot"><div class="bubble bot' + (m.changes ? " wr" : "") + '">' + linkCites(chatMarkup(m.text || "…")) + ch + tr + "</div>" + acts + "</div>";
  }
  /* 찾는 순서: ① 지금 보는 쪽 ② 이 자료 전체(AI 가 넓힌 검색어로 — 한연대→KRU·한국연구대학교 같은 다른 표기까지) ③ [다른 자료도 찾기]면 프로젝트의 다른 자료 */
  async function expandKw(text) {
    const base = String(text).replace(/[?？.!,~"“”'‘’()]/g, " ").split(/\s+/).filter((x) => x.length >= 2 && !/^(설명|알려|정리|요약|해줘|해봐|줘|주세요|뭐야|무엇|어떻게)/.test(x));
    try {
      const r = await llmGenerate({ messages: [{ role: "system", content: "문서 검색어 추출기입니다. JSON 하나만 출력: {\"k\":[\"검색어\"]}. 질문의 핵심 개념마다 문서에 실제로 쓰였을 표현을 6~12개 — 동의어·한글/영문 표기·약어·공식 명칭·상위 용어를 넣고, '설명해 줘' 같은 말은 빼요. 예: 한연대 → KRU, 한국연구대학교 / 정량목표 → 정량적 목표, 성과지표, 목표치, KPI / 올해 → 1차년도, 2026" }, { role: "user", content: text }], temperature: 0, maxTokens: 240 });
      const k = (r && Array.isArray(r.k) ? r.k : []).map((x) => String(x).trim()).filter((x) => x.length >= 2);
      return Array.from(new Set(k.concat(base))).slice(0, 14);
    } catch (e) { return base; }
  }
  async function gather(text, sel, w) {
    const kws = await expandKw(text + (sel ? " " + sel.text.slice(0, 120) : ""));
    const q = kws.join(" ");
    let here = []; if (cur.chars !== 0) { try { here = await I.retrieveIn(cur.id, q, 9, 8000); } catch (e) { here = []; } }
    let other = []; if (st("rr.prefs", {}).all === true) { try { other = (await I.retrieve(q, 6, 4500)).filter((c) => c.fid !== cur.id); } catch (e) { other = []; } }
    return { kws: kws, here: here, other: other };
  }
  function kwIn(t, kws) { const low = String(t || "").toLowerCase(); return (kws || []).filter((k) => low.indexOf(k.toLowerCase()) >= 0).sort((a, b) => b.length - a.length)[0] || ""; }
  function ctxText(g, sel, w) {
    return "\n\n[① 지금 보는 곳 — " + (w.label || "") + "]\n" + (w.text || "(글 없음 — 그림·영상이면 파일 이름과 메모로만 판단)").slice(0, 5000) + (sel ? "\n\n[사용자가 고른 부분 — " + sel.label + "]\n" + sel.text.slice(0, 3000) : "") +
      I.groundBlock(g.here, "② 이 자료(" + (cur.folder ? cur.rel.split("/").pop() : cur.name) + ") 전체에서 찾은 곳 — 검색어: " + g.kws.join(", ")) + I.groundBlock(g.other, "③ 프로젝트의 다른 자료에서 찾은 곳");
  }
  const FIND_RULE = "\n\n답을 찾는 순서: ① 지금 보는 곳 → ② 이 자료 전체에서 찾은 곳 → ③ 다른 자료. 지금 쪽에 없다고 끝내지 말고 ②③ 발췌를 끝까지 확인해 답하세요. 답의 근거마다 (파일명 p.쪽)을 붙이세요. 정말 어디에도 없을 때만 '자료에서 찾지 못함'이라고 하고, 가장 가까운 내용과 그 쪽을 알려 주세요.";
  // 답이 나오면 근거 쪽으로 뷰어를 옮기고 그 낱말을 칠한다
  function jumpToAnswer(answer, g) {
    if (!V || !g) return;
    const nm = (cur.folder ? cur.rel.split("/").pop() : cur.name).trim(); let p = 0;
    String(answer).replace(/\(([^()]{1,140}?)\s+p\.(\d+)\)/g, (m0, n, pp) => { if (!p && (n.trim() === nm || n.trim() === cur.name)) p = +pp; return m0; });
    const best = (p && g.here.filter((c) => c.p === p)[0]) || g.here[0];
    if (!best || !best.p) return;
    const w = V.where() || {}; const kw = kwIn(best.text, g.kws);
    if (best.p !== w.page) V.goto(best.p);
    if (kw) setTimeout(() => V.find(kw, { quiet: true }), 350);
  }
  function hitsOf(g) {
    const seen = {}, out = [];
    g.here.concat(g.other).forEach((c) => { const k = c.fid + "|" + c.p; if (!c.p || seen[k] || out.length >= 8) return; seen[k] = 1; out.push({ fid: c.fid, p: c.p, name: c.name || "", other: c.fid !== cur.id, q: kwIn(c.text, g.kws) }); });
    return out;
  }
  async function send(text, selOverride) {
    const ta = $("rrIn"); text = (text || (ta && ta.value) || "").trim(); if (!text || busy) return;
    // "…를 문서에 넣어 줘 / 보고서로 써 줘 / 2절 고쳐" 같은 말은 ✍ 를 켜지 않아도 문서 쓰기로
    if (writing() || /(문서|보고서|초안|\d+\s*절|슬라이드|PPT|발표\s*자료)[^.?!\n]{0,14}(넣|추가|써\s*줘|써줘|작성|만들|반영|고쳐|수정|바꿔|채워)|(넣어|추가해|반영해|적어)\s*(줘|주세요|줄래)/i.test(text)) return docWrite(text, selOverride);
    if (ta) ta.value = "";
    const g = await gateAction({ action: "rnd", cost: 1 }); if (!g.ok) { $("rrLog").insertAdjacentHTML("beforeend", '<p class="lb-warn">' + esc(gateMessage(g)) + "</p>"); return; }
    busy = true; const sb = $("rrSend"); if (sb) sb.disabled = true;
    const w = V ? V.where() : {}; const sel = selOverride || pendSel || (w.sel ? { text: w.sel, label: w.label } : null); pendSel = null; paintSelChip();
    const um = { role: "user", text: text, t: Date.now(), via: "read", where: (sel ? "고른 부분 · " : "") + (w.label || "") };
    msgs.push(um); I.R.msgs.push(um); I.write("event", { pid: I.R.pid }, { kind: "chat", role: "user", text: text, via: "read", where: um.where, fid: cur.id, p: w.page || null });
    const lg = $("rrLog"); if (lg.querySelector(".rr-hello")) lg.innerHTML = "";
    lg.insertAdjacentHTML("beforeend", bubble(um)); lg.insertAdjacentHTML("beforeend", '<div class="rn-msg bot"><div class="bubble bot" id="rrCur">보는 곳과 관련 자료를 살피는 중…</div></div>'); lg.scrollTop = lg.scrollHeight;
    const box = $("rrCur");
    try {
      box.innerHTML = '<span class="lb-dots"><i></i><i></i><i></i></span> 🔎 지금 쪽 → 이 자료 전체' + (st("rr.prefs", {}).all === true ? " → 다른 자료" : "") + "에서 찾는 중…";
      const gg = await gather(text, sel, w);
      const sys = I.sysPrompt() + "\n\n사용자는 지금 자료 뷰어로 '" + (w.label || cur.name) + "' 를 보면서 묻고 있어요. '이 쪽·여기·이 부분' 은 아래 [① 지금 보는 곳](고른 부분이 있으면 그것)을 뜻해요." + FIND_RULE + ctxText(gg, sel, w);
      const messages = [{ role: "system", content: sys }];
      msgs.slice(-7, -1).forEach((m) => { if (m.text) messages.push({ role: m.role === "user" ? "user" : "assistant", content: m.text.slice(0, 3000) }); });
      messages.push({ role: "user", content: text });
      box.textContent = "답하는 중…";
      const acc = await llmStreamChat(messages, (d, full) => { if (full) { box.innerHTML = chatMarkup(full); lg.scrollTop = lg.scrollHeight; } }, { temperature: 0.3, maxTokens: 1800 });
      const bm = { role: "assistant", text: acc || "답변을 받지 못했어요.", t: Date.now(), via: "read", where: um.where, trace: "🔎 지금 쪽 → 이 자료 전체 " + gg.here.length + "곳" + (st("rr.prefs", {}).all === true ? " → 다른 자료 " + gg.other.length + "곳" : "") + (gg.kws.length ? " · 검색어 " + gg.kws.slice(0, 6).join(", ") : ""), hits: hitsOf(gg) };
      msgs.push(bm); I.R.msgs.push(bm); I.write("event", { pid: I.R.pid }, { kind: "chat", role: "assistant", text: bm.text, via: "read", where: um.where, fid: cur.id });
      box.parentNode.outerHTML = bubble(bm, msgs.length - 1);
      jumpToAnswer(bm.text, gg);
      I.R.events.push({ kind: "chat", role: "user", text: text, t: um.t }, { kind: "chat", role: "assistant", text: bm.text, t: bm.t }); I.paintHist();
    } catch (e) { box.innerHTML = '<span class="lb-err">' + esc(e.message) + "</span>"; }
    finally { busy = false; const b = $("rrSend"); if (b) b.disabled = false; lg.scrollTop = lg.scrollHeight; }
  }

  /* ---------------- ✍ 대화로 문서 쓰기 ---------------- */
  // AI 는 편집 지시를 받아 {reply, ops[]} 를 낸다 → 작업 문서(R.doc)에 바로 반영(바뀐 절 빛남 · 되돌리기 · 저장은 💾)
  function applyOps(d, ops) {
    const n = d.sections.length, out = [], changed = new Set(), adds = {};
    const secs = d.sections.slice();
    (ops || []).forEach((o) => {
      if (!o || typeof o !== "object") return;
      const i = parseInt(o.i, 10);
      if (o.op === "title" && o.text) { d.title = String(o.text).slice(0, 120); out.push("제목 → " + d.title); }
      else if (o.op === "set" && secs[i]) { const s = secs[i] = Object.assign({}, secs[i]); if (o.body != null) s.body = String(o.body); if (o.h) s.h = String(o.h).slice(0, 80); changed.add(s); out.push("고침 · " + (i + 1) + ". " + s.h); }
      else if (o.op === "del" && secs[i]) { out.push("지움 · " + (i + 1) + ". " + secs[i].h); secs[i] = null; }
      else if (o.op === "add") { let at = parseInt(o.after, 10); if (!Number.isInteger(at) || at >= n) at = n - 1; if (at < -1) at = -1; const s = { h: String(o.h || "새 절").slice(0, 80), body: String(o.body || "") }; (adds[at] = adds[at] || []).push(s); changed.add(s); out.push("새 절 · " + s.h); }
    });
    const next = (adds[-1] || []).slice();
    secs.forEach((s, i) => { if (s) next.push(s); (adds[i] || []).forEach((a) => next.push(a)); });
    d.sections = next;
    flashI = next.map((s, i) => (changed.has(s) ? i : -1)).filter((i) => i >= 0);
    return out;
  }
  async function docWrite(text, selOverride) {
    const ta = $("rrIn"); if (ta) ta.value = "";
    const g = await gateAction({ action: "rnd", cost: 2 }); if (!g.ok) { $("rrLog").insertAdjacentHTML("beforeend", '<p class="lb-warn">' + esc(gateMessage(g)) + "</p>"); return; }
    busy = true; const sb = $("rrSend"); if (sb) sb.disabled = true;
    const R = I.R; if (!R.doc) { I.newDoc("free"); R.doc.title = (R.project.name || "작업") + " 작업 문서"; R.doc.sections = []; }
    const d = R.doc, before = JSON.parse(JSON.stringify(d));
    const w = V ? V.where() : {}; const sel = selOverride || pendSel || (w.sel ? { text: w.sel, label: w.label } : null); pendSel = null; paintSelChip();
    const um = { role: "user", text: text, t: Date.now(), via: "read", doc: true, where: (sel ? "고른 부분 · " : "") + (w.label || "") };
    msgs.push(um); I.R.msgs.push(um); I.write("event", { pid: R.pid }, { kind: "chat", role: "user", text: text, via: "read", mode: "doc", where: um.where, fid: cur.id, p: w.page || null });
    const lg = $("rrLog"); if (lg.querySelector(".rr-hello")) lg.innerHTML = "";
    lg.insertAdjacentHTML("beforeend", bubble(um)); lg.insertAdjacentHTML("beforeend", '<div class="rn-msg bot"><div class="bubble bot wr" id="rrCur"><span class="lb-dots"><i></i><i></i><i></i></span> 자료를 보고 문서를 쓰는 중…</div></div>'); lg.scrollTop = lg.scrollHeight;
    const box = $("rrCur");
    try {
      const outline = d.sections.length ? d.sections.map((s, i) => "[" + i + "] " + (s.h || "(제목 없음)") + "\n" + (String(s.body || "").trim() || "(비어 있음)").slice(0, 2200)).join("\n\n") : "(아직 절이 없음 — 새로 만들면 add)";
      const sys = I.sysPrompt() + "\n\n당신은 사용자와 대화하며 '작업 문서'를 함께 쓰는 편집자입니다. 사용자의 말을 문서 편집 지시로 받아 문서를 바꿉니다. 반드시 JSON 하나만 출력하세요(설명·코드펜스 없이). 형식:\n" +
        '{"reply":"무엇을 했는지 1~3문장(사용자에게)","ops":[{"op":"add","after":절번호(-1=맨 앞, 생략=맨 끝),"h":"절 제목","body":"마크다운 본문"},{"op":"set","i":절번호,"h":"(제목을 바꿀 때만)","body":"고친 본문 전체"},{"op":"del","i":절번호},{"op":"title","text":"문서 제목"}]}\n' +
        "규칙: 절번호는 아래 [작업 문서]의 [번호]. 기존 절을 고칠 때는 set 으로 그 절 본문 전체를 다시 쓴다(일부만 바꿔도 전체). 새 내용은 add. '요약·정리해 넣어 줘'는 add, '고쳐·바꿔·다듬어·짧게'는 set. 문서와 상관없는 질문이면 ops 는 [] 로 두고 reply 에 답한다. 수치·명칭은 자료 그대로, 근거는 (파일명 p.쪽) 로 본문에 남긴다. 자료에 없는 내용은 지어내지 않는다." + FIND_RULE + ctxText(await gather(text, sel, w), sel, w);
      const messages = [{ role: "system", content: sys }];
      msgs.slice(-7, -1).forEach((m) => { if (m.text) messages.push({ role: m.role === "user" ? "user" : "assistant", content: m.text.slice(0, 1500) }); });
      messages.push({ role: "user", content: "[작업 문서 — 제목: " + (d.title || "") + "]\n" + outline + "\n\n[지시]\n" + text });
      const r = await llmGenerate({ messages: messages, temperature: 0.3, maxTokens: 4000 });
      if (!r || (typeof r.reply !== "string" && !Array.isArray(r.ops))) throw new Error("AI 응답을 해석하지 못했어요. 다시 말해 주세요.");
      const changes = applyOps(d, r.ops);
      if (changes.length) { R.dirty = true; I.paintSide(); }
      const bm = { role: "assistant", text: String(r.reply || (changes.length ? "문서에 반영했어요." : "")) || "…", t: Date.now(), via: "read", where: um.where, changes: changes, undo: changes.length ? before : null };
      msgs.push(bm); I.R.msgs.push(bm); I.write("event", { pid: R.pid }, { kind: "chat", role: "assistant", text: bm.text + (changes.length ? "\n\n" + changes.map((c) => "- " + c).join("\n") : ""), via: "read", mode: "doc", where: um.where, fid: cur.id });
      if (changes.length) I.write("event", { pid: R.pid }, { kind: "ai", what: "문서 같이 쓰기 · " + changes.slice(0, 3).join(" / ") });
      box.parentNode.outerHTML = bubble(bm, msgs.length - 1);
      if (changes.length) { if (!docVisible()) { const P = st("rr.prefs", {}); if (!P.pop) { prefs("pop", "doc"); const rr = document.querySelector(".rr"); if (rr) rr.classList.add("pop"); const pb = document.querySelector('[data-rr="pop"]'); if (pb) pb.classList.add("on"); } } refreshDoc(); }
    } catch (e) { box.innerHTML = '<span class="lb-err">' + esc(e.message) + "</span>"; }
    finally { busy = false; const b = $("rrSend"); if (b) b.disabled = false; lg.scrollTop = lg.scrollHeight; }
  }

  /* ---------------- 📝 작업 문서(옆 칸 · 탭) ---------------- */
  function paintDoc(box, inPop) {
    if (!box) return;
    const R = I.R, d = R.doc;
    if (!d) {
      box.innerHTML = '<div class="rr-docw"><div class="rr-col-h"><b>📝 작업 문서</b><span class="sh-muted">아직 없어요</span>' + (inPop ? '<button type="button" class="rr-b sm" data-rr="popx" title="옆 칸 닫기" aria-label="옆 칸 닫기">✕</button>' : "") + '</div><div class="rr-hello"><b>대화로 문서를 만들어요</b><p class="sh-muted">AI 칸에서 <b>✍ 문서에 바로 쓰기</b>를 켜고 "이 쪽 요약해서 넣어 줘"라고 말하면 여기에 바로 써져요. 종류를 골라 빈 차례로 시작할 수도 있어요.</p><div class="rr-kinds">' +
        Object.keys(I.docKinds).map((k) => '<button type="button" class="rr-chip" data-rr-nd="' + k + '">' + esc(I.docKinds[k]) + "</button>").join("") + '</div><button type="button" class="primary" data-rr="wron">✍ 문서에 바로 쓰기 켜기</button></div></div>';
      return;
    }
    const state = R.did ? "v" + (d.v || "?") + (R.dirty ? " · 저장 안 함" : " · 저장됨") : "새 문서" + (R.dirty ? " · 저장 안 함" : "");
    box.innerHTML = '<div class="rr-docw"><div class="rr-doc-h"><input id="rrDT" class="rr-dt" type="text" value="' + esc(d.title) + '" aria-label="문서 제목" placeholder="문서 제목">' + (inPop ? '<button type="button" class="rr-b sm" data-rr="popx" title="옆 칸 닫기" aria-label="옆 칸 닫기">✕</button>' : "") + "</div>" +
      '<div class="rr-doc-bar"><span class="rr-dst' + (R.dirty ? " dirty" : "") + '" id="rrDSt">' + esc(state) + '</span><button type="button" class="rr-b sm primary" data-rr="dsave" title="저장(새 버전) — Ctrl+S">💾 저장</button><select id="rrDExp" class="rr-sel" aria-label="내보내기"><option value="">⬇ 내보내기</option>' + ["docx", "pptx", "html", "md"].map((f) => '<option value="' + f + '">' + f.toUpperCase() + "</option>").join("") + '</select><button type="button" class="rr-b sm" data-rr="dopen" title="문서 탭에서 크게 열기(AI 초안·절별 AI·버전)">↗ 크게</button></div>' +
      '<div class="rr-doc-b" id="rrDB">' + (d.sections.length ? d.sections.map((s, i) => '<section class="rr-ds' + (flashI.indexOf(i) >= 0 ? " flash" : "") + '" data-i="' + i + '"><div class="rr-ds-h"><span class="rr-dn">' + (i + 1) + '</span><input type="text" class="rr-dh" data-rr-dh="' + i + '" value="' + esc(s.h) + '" placeholder="절 제목" aria-label="' + (i + 1) + '절 제목"><span class="rr-ds-a"><button type="button" class="rr-b xs" data-rr-dai="' + i + '" title="AI 에게 이 절 고치기 지시">✨</button><button type="button" class="rr-b xs" data-rr-dmv="' + i + '|-1" title="위로" aria-label="위로"' + (i ? "" : " disabled") + '>↑</button><button type="button" class="rr-b xs" data-rr-dmv="' + i + '|1" title="아래로" aria-label="아래로"' + (i < d.sections.length - 1 ? "" : " disabled") + '>↓</button><button type="button" class="rr-b xs" data-rr-ddel="' + i + '" title="절 지우기" aria-label="절 지우기">✕</button></span></div><textarea class="rr-db" data-rr-db="' + i + '" placeholder="내용 (마크다운)">' + esc(s.body) + "</textarea></section>").join("")
        : '<div class="rr-hello"><p class="sh-muted">절이 없어요. AI 에게 말하거나 ＋ 절 추가.</p></div>') + "</div>" +
      '<div class="rr-doc-f"><button type="button" class="rr-b sm" data-rr="daddsec">＋ 절 추가</button><span class="sh-muted">' + (writing() ? "✍ 켜짐 — AI 에게 말하면 여기에 바로 써져요" : "AI 칸에서 ✍ 를 켜면 말로 쓸 수 있어요") + "</span></div></div>";
    const t = $("rrDT"); t.addEventListener("input", () => { d.title = t.value; dirty(); });
    box.querySelectorAll("[data-rr-dh]").forEach((x) => x.addEventListener("input", () => { d.sections[+x.dataset.rrDh].h = x.value; dirty(); }));
    box.querySelectorAll("[data-rr-db]").forEach((x) => { grow(x); x.addEventListener("input", () => { d.sections[+x.dataset.rrDb].body = x.value; dirty(); grow(x); }); });
    $("rrDExp").addEventListener("change", (e) => { const f = e.target.value; e.target.value = ""; if (f) I.exportDoc(f); });
    const fl = box.querySelector(".rr-ds.flash"); if (fl) { fl.scrollIntoView({ block: "nearest", behavior: "smooth" }); setTimeout(() => { flashI = []; box.querySelectorAll(".rr-ds.flash").forEach((x) => x.classList.remove("flash")); }, 2600); }
  }
  function grow(x) { x.style.height = "auto"; x.style.height = Math.min(520, Math.max(64, x.scrollHeight + 2)) + "px"; }
  function dirty() { I.R.dirty = true; const s = $("rrDSt"); if (s) { s.textContent = (I.R.did ? "v" + (I.R.doc.v || "?") : "새 문서") + " · 저장 안 함"; s.classList.add("dirty"); } }
  function refreshDoc() { const h = docHost(); if (h) paintDoc(h, h.id === "rrCol"); }

  /* ---------------- 📌 수집함 ---------------- */
  const KICO = { quote: "❝", ai: "✨", memo: "📝", clip: "🎬" };
  function addCol(item) { const l = col(); l.push(Object.assign({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), t: Date.now() }, item)); setCol(l); flash("수집함에 담았어요 (" + l.length + ")"); }
  function flash(t) { const el = $("rrWhere"); if (!el) return; el.innerHTML = '<b class="rr-flash">✓ ' + esc(t) + "</b>"; clearTimeout(flash.t); flash.t = setTimeout(paintWhere, 1800); }
  function paintCol(pn) {
    if (!pn) return;
    const l = col(), inPop = pn.id === "rrCol";
    pn.innerHTML = '<div class="rr-colw"><div class="rr-col-h"><b>📌 수집함 ' + l.length + '</b><span class="sh-muted">고른 글·AI 답·메모를 모아 문서로</span>' + (l.length ? '<button type="button" class="rr-b sm" data-rr="colmd">⬇ MD</button><button type="button" class="rr-b sm" data-rr="colclear">비우기</button>' : "") + (inPop ? '<button type="button" class="rr-b sm" data-rr="popx" title="옆 칸 닫기" aria-label="옆 칸 닫기">✕</button>' : "") + "</div>" +
      '<div class="rr-items" id="rrItems">' + (l.length ? l.map((x, i) => '<div class="rr-it k-' + (x.kind || "quote") + '" draggable="true" data-rr-it="' + i + '"><div class="rr-it-h"><span>' + (KICO[x.kind] || "❝") + "</span>" + (x.src ? '<a href="#" data-rr-go="' + esc(x.src.fid + "|" + (x.src.p || 1)) + '">' + esc(x.src.label || x.src.name || "") + "</a>" : "<small>" + esc(x.label || "") + "</small>") + '<span class="rr-it-a"><button type="button" class="rr-b xs" data-rr-mv="' + i + '|-1" title="위로"' + (i ? "" : " disabled") + '>↑</button><button type="button" class="rr-b xs" data-rr-mv="' + i + '|1" title="아래로"' + (i < l.length - 1 ? "" : " disabled") + '>↓</button><button type="button" class="rr-b xs" data-rr-note="' + i + '" title="내 메모">✎</button><button type="button" class="rr-b xs" data-rr-del="' + i + '" title="빼기">✕</button></span></div><div class="rr-it-t">' + (x.kind === "ai" ? chatMarkup(x.text) : esc(x.text)) + "</div>" + (x.note ? '<div class="rr-it-n">✎ ' + esc(x.note) + "</div>" : "") + "</div>").join("")
        : '<div class="rr-hello"><b>여기에 모아요</b><p class="sh-muted">뷰어에서 글을 고르고 <b>📌 담기</b>, AI 답 아래 <b>📌 담기</b>, 또는 글을 이 칸에 끌어다 놓으세요. 다 모이면 아래에서 요약 노트·보고서·발표 자료로 만들어요.</p></div>') + "</div>" +
      '<div class="rr-make"><select id="rrMk" class="rr-sel" aria-label="만들 문서 종류">' + MAKE.map((m) => '<option value="' + m[0] + '">' + m[1] + "</option>").join("") + '</select><input id="rrMkHow" class="rr-inp" type="text" placeholder="지시(선택) 예: 경영진용 2쪽, 표 위주"><button type="button" class="rr-b primary" data-rr="make"' + (l.length ? "" : " disabled") + '>✨ 만들기</button></div><div id="rrMkOut"></div></div>';
    const box = $("rrItems") || pn.querySelector(".rr-items");
    box.addEventListener("dragover", (e) => { e.preventDefault(); box.classList.add("over"); });
    box.addEventListener("dragleave", () => box.classList.remove("over"));
    box.addEventListener("drop", (e) => {
      e.preventDefault(); box.classList.remove("over");
      const from = e.dataTransfer.getData("text/rr-it");
      if (from !== "") { const tgt = e.target.closest("[data-rr-it]"); const L = col(); const a = +from, b = tgt ? +tgt.dataset.rrIt : L.length - 1; if (a === b || isNaN(a)) return; const [x] = L.splice(a, 1); L.splice(b, 0, x); setCol(L); return; }
      const t = (e.dataTransfer.getData("text/plain") || "").trim(); if (t) { const w = V ? V.where() : {}; addCol({ kind: "quote", text: t.slice(0, 4000), src: { fid: cur.id, name: cur.name, p: w.page || 0, label: w.label || cur.name } }); }
    });
    box.querySelectorAll("[data-rr-it]").forEach((it) => it.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/rr-it", it.dataset.rrIt); }));
  }
  function colMd(l) { return l.map((x, i) => "### " + (i + 1) + ". " + (x.src ? x.src.label : x.label || "") + "\n" + (x.kind === "ai" ? x.text : "> " + String(x.text).replace(/\n/g, "\n> ")) + (x.note ? "\n\n✎ " + x.note : "")).join("\n\n"); }
  async function make() {
    const l = col(); if (!l.length) return;
    const kind = $("rrMk").value, how = ($("rrMkHow").value || "").trim(), out = $("rrMkOut");
    out.innerHTML = '<div class="lb-loading"><span class="lb-dots"><i></i><i></i><i></i></span>모은 ' + l.length + "개로 문서를 만드는 중…</div>";
    const PURPOSE = { note: "학습·검토용 요약 노트(핵심 → 근거 → 내 메모 반영)", report: "보고서(개요·본문 절·결론/제언, 격식체)", slides: "발표 자료 — 절 하나가 슬라이드 한 장, 본문은 불릿 3~6개(짧게)", brief: "1쪽 브리핑(한 줄 요지·핵심 5개·숫자·쟁점·다음 할 일)", table: "비교·정리 표 중심 문서(마크다운 표, 표 아래 한 줄 해석)", free: "사용자 지시대로" };
    try {
      const g = await gateAction({ action: "rnd", cost: 2 }); if (!g.ok) throw new Error(gateMessage(g));
      const r = await llmGenerate({ messages: [{ role: "system", content: I.sysPrompt() + " 반드시 JSON 하나만 출력. 형식: {\"title\":\"\",\"sections\":[{\"h\":\"절 제목\",\"body\":\"마크다운 본문\"}]}" },
        { role: "user", content: "아래는 사용자가 자료를 읽으며 직접 모은 발췌·AI 답·메모입니다(순서도 사용자가 정함). 이것만 근거로 " + PURPOSE[kind] + "을(를) 만드세요. 인용 출처 (파일명 p.쪽) 는 남기고, 모은 것에 없는 내용은 지어내지 마세요. 사용자 메모(✎)는 사용자의 의견이니 반영하세요." + (how ? "\n지시: " + how : "") + "\n\n" + colMd(l).slice(0, 26000) }], temperature: 0.3, maxTokens: 3600 });
      if (!r || !Array.isArray(r.sections) || !r.sections.length) throw new Error("AI 응답을 해석하지 못했어요. 다시 눌러 주세요.");
      const dkind = kind === "slides" ? "slides" : kind === "brief" ? "brief" : kind === "report" ? "report" : kind === "note" ? "summary" : "free";
      await I.makeDoc(dkind, r.title || "수집함 정리", r.sections.map((s) => ({ h: String(s.h || "").slice(0, 80), body: String(s.body || "") })), "수집함 " + l.length + "개로 만듦");
      const o2 = $("rrMkOut"); if (o2) o2.innerHTML = '<div class="rr-done"><b>✓ “' + esc(r.title || "수집함 정리") + '” 문서를 만들어 저장했어요</b><div class="rr-row"><button type="button" class="rr-b sm primary" data-rr="dshow">📝 옆에 열기</button>' + ["docx", "pptx", "html", "md"].map((f) => '<button type="button" class="rr-b sm" data-rr-exp="' + f + '">⬇ ' + f.toUpperCase() + "</button>").join("") + "</div></div>";
    } catch (e) { const o2 = $("rrMkOut"); if (o2) o2.innerHTML = '<p class="lb-warn">' + esc(e.message) + "</p>"; }
  }

  /* ---------------- 🔎 다른 자료에서 찾기 ---------------- */
  // 뷰어가 이 자료를 찾은 뒤 부른다: none=이 자료에 없음 · force=[다른 자료도] 를 방금 켬
  function onSearchOther(q, none, force) {
    FS.here = q ? !none : null;
    const on = !!(st("dv.prefs", {}) || {}).others;
    if (!q) { FS.q = ""; FS.tok++; FS.res = []; FS.sem = []; FS.busy = false; badge(); if (curTab() === "find") paintPanel(); return; }
    if (!on && !none && !force) { if (curTab() === "find") paintPanel(); return; }
    if (q !== FS.q || force) searchOthers(q);
    if (curTab() !== "find") { prefs("tab", "find"); prefs("closed", false); const rr = document.querySelector(".rr"); if (rr) rr.classList.remove("closed"); paintPanel(); }
  }
  function badge() { const b = $("rrFindN"); if (!b) return; const n = FS.res.length; b.textContent = n > 99 ? "99+" : n; b.classList.toggle("hidden", !FS.q || !n); }
  async function textOf(f) { if (TX[f.id] != null) return TX[f.id]; let t = ""; try { t = (await I.WS.req("text", { pid: I.R.pid, fid: f.id })).text || ""; } catch (e) { t = ""; } TX[f.id] = t; return t; }
  async function searchOthers(q) {
    const tok = ++FS.tok; FS.q = q; FS.res = []; FS.sem = []; FS.busy = true; FS.done = 0;
    const files = I.R.files.filter((f) => !f.hidden && f.id !== cur.id && f.chars !== 0 && (!f.folder || f.doc)).slice(0, 300);
    FS.total = files.length; if (curTab() === "find") paintPanel();
    const lq = q.toLowerCase(); let k = 0;
    const scan = (f, t) => {
      if (!t) return; const parts = t.split(/\n\n\[p\.(\d+)\]\n/); let hits = 0;
      const pages = parts.length > 1 ? Array.from({ length: (parts.length - 1) / 2 }, (_, j) => [+parts[1 + j * 2], parts[2 + j * 2] || ""]) : [[0, t]];
      for (const [p, body] of pages) {
        const low = body.toLowerCase(); let j = low.indexOf(lq), per = 0;
        while (j >= 0 && per < 3 && hits < 40) { FS.res.push({ fid: f.id, name: f.folder ? f.rel : f.name, ext: (f.ext || "").toLowerCase(), p: p, snip: body.slice(Math.max(0, j - 50), j + q.length + 70).replace(/\s+/g, " "), at: Math.max(0, j - 50) < j ? j - Math.max(0, j - 50) : 0 }); per++; hits++; j = low.indexOf(lq, j + lq.length); }
        if (hits >= 40) break;
      }
    };
    const worker = async () => { while (k < files.length) { const f = files[k++]; const t = await textOf(f); if (tok !== FS.tok) return; scan(f, t); FS.done++; if (FS.done % 4 === 0 && curTab() === "find") paintFind($("rrPanel")); } };
    await Promise.all([worker(), worker(), worker(), worker()]);
    if (tok !== FS.tok) return;
    FS.busy = false; badge(); if (curTab() === "find") paintFind($("rrPanel"));
    try { const ch = await I.retrieve(q, 8, 7000); if (tok !== FS.tok) return; FS.sem = ch.filter((c) => !FS.res.some((r) => r.fid === c.fid && r.p === c.p)).slice(0, 6); if (curTab() === "find") paintFind($("rrPanel")); } catch (e) { /* 계속 */ }
  }
  const ICO = (ext) => /pdf/.test(ext) ? "📕" : /hwp/.test(ext) ? "📘" : /docx?|rtf|odt/.test(ext) ? "📄" : /pptx?|odp/.test(ext) ? "📙" : /xlsx?|csv|tsv|ods/.test(ext) ? "📗" : /png|jpe?g|gif|webp|svg/.test(ext) ? "🖼" : "📃";
  function hiSnip(s, q) { const i = s.toLowerCase().indexOf(q.toLowerCase()); return i < 0 ? esc(s) : esc(s.slice(0, i)) + "<mark>" + esc(s.slice(i, i + q.length)) + "</mark>" + esc(s.slice(i + q.length)); }
  function paintFind(pn) {
    if (!pn) return;
    const on = !!(st("dv.prefs", {}) || {}).others, q = FS.q;
    const by = {}; FS.res.forEach((r) => { (by[r.fid] = by[r.fid] || []).push(r); });
    pn.innerHTML = '<div class="rr-findw"><div class="rr-col-h"><b>🔎 찾기</b><span class="sh-muted">' + (q ? "“" + esc(q) + "”" : "뷰어 위쪽 찾기 칸에 적으세요") + '</span><label class="rr-tg" title="켜 두면 찾을 때마다 다른 자료까지 뒤져요"><input type="checkbox" id="rrOth"' + (on ? " checked" : "") + "> 늘 다른 자료도</label></div>" +
      '<div class="rr-items">' + (!q ? '<div class="rr-hello"><b>자료 안에서 찾기</b><p class="sh-muted">뷰어 찾기(Ctrl+F)는 지금 쪽부터 이 자료 전체를 찾아 그 자리로 옮기고 글자 위에 칠해요. 이 자료에 없으면 프로젝트의 다른 자료를 뒤져 여기에 모아요.</p></div>' :
        (FS.here === true ? '<p class="rr-fnote">✓ 지금 자료에서 찾았어요 — 뷰어 ‹ › 로 옮겨 다녀요.</p>' : FS.here === false ? '<p class="rr-fnote none">지금 자료에는 없어요 — 다른 자료를 찾아봤어요.</p>' : "") +
        (FS.busy ? '<p class="rr-fnote"><span class="lb-dots"><i></i><i></i><i></i></span> 다른 자료 ' + FS.done + " / " + FS.total + " 찾는 중…</p>" : "") +
        Object.keys(by).map((fid) => { const L = by[fid]; return '<div class="rr-fg"><div class="rr-fg-h"><span aria-hidden="true">' + ICO(L[0].ext) + "</span><b>" + esc(L[0].name.split("/").pop()) + "</b><small>" + L.length + (L.length >= 40 ? "+" : "") + "곳</small></div>" + L.slice(0, 12).map((r) => '<button type="button" class="rr-fh" data-rr-fgo="' + esc(fid + "|" + (r.p || 1)) + '"><span class="rr-fp">' + (r.p ? r.p + "쪽" : "") + "</span><span>" + hiSnip(r.snip, q) + "</span></button>").join("") + (L.length > 12 ? '<p class="sh-muted rr-fmore">… ' + (L.length - 12) + "곳 더 — 그 자료를 열어 ‹ › 로</p>" : "") + "</div>"; }).join("") +
        (!FS.busy && q && !FS.res.length ? '<p class="rr-fnote">다른 자료에서도 똑같은 글은 없어요.</p>' : "") +
        (FS.sem.length ? '<div class="rr-fg sem"><div class="rr-fg-h"><span aria-hidden="true">✨</span><b>비슷한 내용</b><small>뜻이 가까운 곳</small></div>' + FS.sem.map((c) => '<button type="button" class="rr-fh" data-rr-fgo="' + esc(c.fid + "|" + (c.p || 1)) + '" data-nq="1"><span class="rr-fp">' + esc((c.name || "").split("/").pop().slice(0, 18)) + (c.p ? " " + c.p + "쪽" : "") + "</span><span>" + esc(c.text.slice(0, 150).replace(/\s+/g, " ")) + "…</span></button>").join("") + "</div>" : "")) + "</div></div>";
    const o = $("rrOth"); if (o) o.addEventListener("change", (e) => { const p = st("dv.prefs", {}); p.others = e.target.checked; sset("dv.prefs", p); const b = document.querySelector('.dv [data-dv="others"]'); if (b) b.classList.toggle("on", e.target.checked); if (e.target.checked && FS.q && !FS.res.length) searchOthers(FS.q); });
    badge();
  }

  /* ---------------- 🗂 주석 ---------------- */
  function paintAnn(pn) {
    const a = V ? V.ann() : { hl: [], memo: [], bm: [] };
    const COLN = { y: "노랑", g: "초록", b: "파랑", p: "분홍" };
    const ats = (x) => x.at != null ? Math.floor(x.at / 60) + ":" + String(Math.floor(x.at % 60)).padStart(2, "0") : x.p ? x.p + "쪽" : "";
    pn.innerHTML = '<div class="rr-annw"><div class="rr-col-h"><b>🗂 이 자료의 주석</b><span class="sh-muted">형광펜 ' + a.hl.length + " · 메모 " + a.memo.length + " · 책갈피 " + a.bm.length + "</span>" + (a.hl.length + a.memo.length ? '<button type="button" class="rr-b sm" data-rr="ann2col">📌 모두 수집함으로</button><button type="button" class="rr-b sm" data-rr="annmd">⬇ MD</button>' : "") + "</div>" +
      (a.hl.length + a.memo.length + a.bm.length ? a.bm.slice().sort((x, y) => x.p - y.p).map((b) => '<div class="rr-an"><span>🔖</span><a href="#" data-rr-go="' + cur.id + "|" + b.p + '">' + esc(b.label || b.p + "쪽") + "</a><small>" + b.p + "쪽</small></div>").join("") +
        a.hl.slice().sort((x, y) => (x.p - y.p) || (x.t - y.t)).map((h) => '<div class="rr-an hl-' + h.color + '"><span class="dv-c c-' + h.color + '" title="' + COLN[h.color] + '"></span><div><a href="#" data-rr-go="' + cur.id + "|" + (h.p || 1) + '">' + esc(h.text.slice(0, 220)) + "</a>" + (h.note ? "<p>✎ " + esc(h.note) + "</p>" : "") + "</div><small>" + ats(h) + "</small></div>").join("") +
        a.memo.slice().sort((x, y) => ((x.p || 0) - (y.p || 0)) || ((x.at || 0) - (y.at || 0))).map((m) => '<div class="rr-an"><span>📝</span><div>' + (m.at != null ? '<b>' + ats(m) + "</b> " : '<a href="#" data-rr-go="' + cur.id + "|" + (m.p || 1) + '">' + ats(m) + "</a> ") + esc(m.text || "(빈 메모)") + "</div></div>").join("")
        : '<div class="rr-hello"><b>아직 주석이 없어요</b><p class="sh-muted">뷰어에서 글을 고르면 형광펜 4색·메모가 나오고, 📝 로 쪽에 메모를 붙이고, 🔖 로 책갈피를 해요. 모두 계정에 바로 저장돼 다른 기기에서도 보여요.</p></div>') + "</div>";
  }
  function annMd() { const a = V.ann(); return "# " + cur.name + " — 주석\n\n" + (a.bm.length ? "## 책갈피\n" + a.bm.map((b) => "- " + b.p + "쪽 " + (b.label || "")).join("\n") + "\n\n" : "") + (a.hl.length ? "## 형광펜\n" + a.hl.map((h) => "> " + h.text + " (" + cur.name + (h.p ? " p." + h.p : "") + ")" + (h.note ? "\n\n✎ " + h.note : "")).join("\n\n") + "\n\n" : "") + (a.memo.length ? "## 메모\n" + a.memo.map((m) => "- " + (m.p ? m.p + "쪽 " : "") + (m.text || "")).join("\n") : ""); }

  /* ---------------- 뷰어에서 온 동작 ---------------- */
  function onAction(kind, info) {
    const src = { fid: cur.id, name: cur.name, p: info.page || 0, label: info.label };
    if (kind === "collect") { addCol({ kind: info.text.indexOf("[") === 0 && /\d:\d\d~/.test(info.text) ? "clip" : "quote", text: info.text, src: src }); return; }
    if (kind === "note") return;
    if (kind === "todoc") {   // ✍ 고른 글을 작업 문서에 — ✍ 쓰기가 켜져 있으면 AI 가 알맞은 절에 다듬어 넣고, 아니면 그대로 붙인다
      if (writing()) { openAi(); docWrite("고른 부분을 작업 문서의 알맞은 절에 넣어 줘. 문서 문장으로 다듬고 출처 쪽을 남겨. 알맞은 절이 없으면 새 절로.", { text: info.text, label: info.label }); return; }
      I.toDocMsg("> " + String(info.text).replace(/\n/g, "\n> ") + "\n\n(" + info.label + ")", "발췌 · " + info.label); flashI = [I.R.doc.sections.length - 1];
      if (!docVisible()) { prefs("pop", "doc"); paint(paneEl, I); } else refreshDoc();
      flash("작업 문서에 붙였어요 — ✍ 를 켜면 AI 가 다듬어 넣어요"); return;
    }
    openAi();
    const sel = { text: info.text, label: info.label };
    if (kind === "ask") { pendSel = sel; paintSelChip(); const ta = $("rrIn"); if (ta) { ta.focus(); ta.placeholder = "고른 부분에 대해 " + (writing() ? "문서에 무엇을 할까요?" : "물어보세요"); } return; }
    if (kind === "explain") { prefsWrite(false); send("고른 부분을 쉽게 풀어 설명해 줘. 어려운 용어는 따로 풀이하고, 자료의 다른 부분과 연결되면 알려 줘.", sel); }
    if (kind === "translate") { prefsWrite(false); send("고른 부분을 번역해 줘(영어면 한국어로, 한국어면 영어로). 전문 용어는 원어를 괄호로.", sel); }
  }
  function prefsWrite(v) { if (writing() === v) return; prefs("write", v); paintPanel(); }
  function openAi() { const P = st("rr.prefs", {}); if (P.closed || (P.tab || "ai") !== "ai") { prefs("closed", false); prefs("tab", "ai"); const rr = document.querySelector(".rr"); if (rr) rr.classList.remove("closed"); paintPanel(); } }

  /* ---------------- 폭 조절 ---------------- */
  function bindSplit(pane) {
    pane.querySelectorAll(".rr-split").forEach((sp) => sp.addEventListener("pointerdown", (e) => {
      e.preventDefault(); const rr = pane.querySelector(".rr"), two = sp.dataset.split === "2", x0 = e.clientX, w0 = parseInt(getComputedStyle(rr).getPropertyValue(two ? "--rr-w2" : "--rr-w")) || 400;
      sp.setPointerCapture(e.pointerId); rr.classList.add("dragging");
      const mv = (ev) => { const w = Math.max(260, Math.min(window.innerWidth * 0.6, w0 - (ev.clientX - x0))); rr.style.setProperty(two ? "--rr-w2" : "--rr-w", w + "px"); };
      const up = () => { sp.removeEventListener("pointermove", mv); rr.classList.remove("dragging"); prefs(two ? "w2" : "w", parseInt(rr.style.getPropertyValue(two ? "--rr-w2" : "--rr-w"))); };
      sp.addEventListener("pointermove", mv); sp.addEventListener("pointerup", up, { once: true });
    }));
  }

  /* ---------------- 클릭 ---------------- */
  function openAt(fid, p, q, quiet) { if (fid === cur.id) { V.goto(+p || 1); if (q) setTimeout(() => V.find(q, { quiet: !!quiet }), 250); return; } I.R.srcFid = fid; I.R.srcPage = +p || 1; I.persist(); paint.pendQ = q || null; paint.pendQuiet = !!quiet; paint(paneEl || $("rnPane"), I); }
  document.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && document.activeElement && document.activeElement.closest && document.activeElement.closest(".rr-docw")) { e.preventDefault(); I.saveDoc("작업 문서"); } });
  document.addEventListener("click", async (e) => {
    const t = e.target; if (!t.closest || !t.closest(".rr")) return;
    const go = t.closest("[data-rr-go]"); if (go) { e.preventDefault(); const [fid, p, gq] = go.dataset.rrGo.split("|"); openAt(fid, p, gq || null, true); return; }
    const fg = t.closest("[data-rr-fgo]"); if (fg) { const [fid, p] = fg.dataset.rrFgo.split("|"); openAt(fid, p, fg.dataset.nq ? null : FS.q); return; }
    const tb = t.closest("[data-rr-tab]"); if (tb) { const P = st("rr.prefs", {}); if (P.pop === tb.dataset.rrTab) { prefs("pop", ""); } prefs("tab", tb.dataset.rrTab); prefs("closed", false); paint(paneEl, I); return; }
    const q = t.closest("[data-rr-q]"); if (q) { const k = q.dataset.rrQ; const L = k[0] === "d" ? DOCQ : QUICK; const x = L[+k.slice(1)]; if (k[0] === "d") docWrite(x[1]); else send(x[1]); return; }
    const cm = t.closest("[data-rr-colm]"); if (cm) { const m = msgs[+cm.dataset.rrColm]; const w = V.where(); addCol({ kind: "ai", text: m.text, label: "AI 답 · " + (m.where || w.label || ""), src: { fid: cur.id, name: cur.name, p: w.page || 0, label: "AI · " + (m.where || w.label || "") } }); cm.textContent = "✓ 담음"; return; }
    const dc = t.closest("[data-rr-doc]"); if (dc) { const m = msgs[+dc.dataset.rrDoc]; I.toDocMsg(m.text, (msgs[+dc.dataset.rrDoc - 1] || {}).text || "자료 보며 묻기"); flashI = [I.R.doc.sections.length - 1]; dc.textContent = "✓ 문서에 넣음"; if (!docVisible()) { prefs("pop", "doc"); paint(paneEl, I); } else refreshDoc(); return; }
    const cp = t.closest("[data-rr-copy]"); if (cp) { try { await navigator.clipboard.writeText(msgs[+cp.dataset.rrCopy].text); cp.textContent = "복사됨"; } catch (er) { /* 계속 */ } return; }
    const ud = t.closest("[data-rr-undo]"); if (ud) { const m = msgs[+ud.dataset.rrUndo]; if (!m || !m.undo) return; I.R.doc = JSON.parse(JSON.stringify(m.undo)); I.R.dirty = true; m.undo = null; ud.textContent = "↩ 되돌림"; ud.disabled = true; refreshDoc(); I.paintSide(); return; }
    const mv = t.closest("[data-rr-mv]"); if (mv) { const [i, d] = mv.dataset.rrMv.split("|").map(Number); const l = col(); const j = i + d; if (j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; setCol(l); return; }
    const dl = t.closest("[data-rr-del]"); if (dl) { const l = col(); l.splice(+dl.dataset.rrDel, 1); setCol(l); return; }
    const nt = t.closest("[data-rr-note]"); if (nt) { const l = col(); const x = l[+nt.dataset.rrNote]; const n = prompt("내 메모(문서로 만들 때 반영돼요)", x.note || ""); if (n === null) return; x.note = n.trim(); setCol(l); return; }
    const ex = t.closest("[data-rr-exp]"); if (ex) { I.exportDoc(ex.dataset.rrExp); return; }
    const nd = t.closest("[data-rr-nd]"); if (nd) { I.newDoc(nd.dataset.rrNd); refreshDoc(); I.paintSide(); return; }
    const dmv = t.closest("[data-rr-dmv]"); if (dmv) { const [i, d] = dmv.dataset.rrDmv.split("|").map(Number); const s = I.R.doc.sections, j = i + d; if (j < 0 || j >= s.length) return; [s[i], s[j]] = [s[j], s[i]]; flashI = [j]; dirty(); refreshDoc(); return; }
    const ddl = t.closest("[data-rr-ddel]"); if (ddl) { const i = +ddl.dataset.rrDdel; const s = I.R.doc.sections; if (String(s[i].body || "").trim() && !confirm("'" + s[i].h + "' 절을 지울까요?")) return; s.splice(i, 1); dirty(); refreshDoc(); return; }
    const dai = t.closest("[data-rr-dai]"); if (dai) { const s = I.R.doc.sections[+dai.dataset.rrDai]; prefsWrite(true); openAi(); const ta = $("rrIn"); if (ta) { ta.value = (+dai.dataset.rrDai + 1) + "절 '" + (s.h || "") + "'을(를) "; ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } return; }
    const a = t.closest("[data-rr]"); if (!a) return;
    const k = a.dataset.rr, pane = paneEl || $("rnPane");
    if (k === "send") send();
    else if (k === "unsel") { pendSel = null; paintSelChip(); }
    else if (k === "prevf" || k === "nextf") { const vis = I.R.files.filter((f) => !f.hidden); const i = vis.findIndex((x) => x.id === cur.id) + (k === "nextf" ? 1 : -1); if (vis[i]) { I.R.srcFid = vis[i].id; I.persist(); paint(pane, I); } }
    else if (k === "close") { const P = st("rr.prefs", {}); prefs("closed", !P.closed); paint(pane, I); }
    else if (k === "pop") { const P = st("rr.prefs", {}); prefs("pop", P.pop ? "" : "doc"); if (!P.pop && P.tab === "doc") prefs("tab", "ai"); paint(pane, I); }
    else if (k === "popx") { prefs("pop", ""); paint(pane, I); }
    else if (k === "dshow") { prefs("pop", "doc"); prefs("closed", false); paint(pane, I); }
    else if (k === "wron") { prefs("write", true); prefs("tab", "ai"); if (!st("rr.prefs", {}).pop) prefs("pop", "doc"); paint(pane, I); setTimeout(() => { const ta = $("rrIn"); if (ta) ta.focus(); }, 60); }
    else if (k === "dsave") { await I.saveDoc("작업 문서"); refreshDoc(); }
    else if (k === "dopen") I.setTab("doc");
    else if (k === "daddsec") { if (!I.R.doc) I.newDoc("free"); I.R.doc.sections.push({ h: "", body: "" }); flashI = [I.R.doc.sections.length - 1]; dirty(); refreshDoc(); const hs = document.querySelectorAll("[data-rr-dh]"); if (hs.length) hs[hs.length - 1].focus(); }
    else if (k === "make") make();
    else if (k === "colclear") { if (confirm("수집함을 비울까요?")) setCol([]); }
    else if (k === "colmd") TK.download(TK.slug((I.R.project.name || "수집함") + "-수집함") + ".md", "# " + (I.R.project.name || "") + " — 수집함\n\n" + colMd(col()));
    else if (k === "annmd") TK.download(TK.slug(cur.name + "-주석") + ".md", annMd());
    else if (k === "ann2col") { const an = V.ann(); const l = col(); an.hl.forEach((h) => l.push({ id: "h" + h.id, kind: "quote", text: h.text, note: h.note || "", src: { fid: cur.id, name: cur.name, p: h.p || 0, label: cur.name + (h.p ? " p." + h.p : "") }, t: Date.now() })); an.memo.forEach((m) => l.push({ id: "m" + m.id, kind: "memo", text: m.text || "", src: { fid: cur.id, name: cur.name, p: m.p || 0, label: cur.name + (m.p ? " p." + m.p : "") }, t: Date.now() })); setCol(l); flash("주석 " + (an.hl.length + an.memo.length) + "개를 담았어요"); }
  });

  window.RNDREAD = { paint: paint, where: () => (V ? V.where() : null), add: addCol, docChanged: () => refreshDoc(), fit: fit };
})();
