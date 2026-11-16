/* =============================================================================
 * slidestudio.js (v112) — 🎬 발표자료 작성·보조 (rx_present) — 파워포인트식 슬라이드 작업실
 *   첫 화면: 프로젝트 → 발표자료함(목록/카드·새 발표자료·양식·AI 로 만들기·PPTX 불러오기·사본·휴지통)
 *   편집기: 왼쪽 슬라이드 목록(끌어 순서·복제·숨기기), 가운데 16:9 캔버스(끌기·크기·회전·맞춤선·여러 개 고르기·글 직접 편집),
 *           아래 대본, 오른쪽 디자인(테마)·레이아웃·서식·발표·발표 도구·버전, ✨ AI 대화(슬라이드를 직접 고침, 차례마다 되돌리기)
 *   슬라이드 쇼·발표자 보기(다음 장·대본·시간·리허설 기록), 내보내기 PPTX(진짜 도형·표·차트·대본)·PDF·HTML·Beamer·대본
 *   저장: 서버 projects/<pid>/slides/<deck>/ (tools/slide_api.py). 디자인 키트: slidekit.js
 * ========================================================================== */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const K = window.SLIDEKIT, uid = K.uid;
  const P = (k, d) => (window.TK ? TK.store.get(k, d) : d), PS = (k, v) => { if (window.TK) TK.store.set(k, v); };
  const fmtT = (t) => t ? new Date(t).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  const mmss = (n) => Math.floor(n / 60) + ":" + String(Math.abs(Math.round(n % 60))).padStart(2, "0");
  function toast(t, ms) { let el = $("ssToast"); if (!el) { el = document.createElement("div"); el.id = "ssToast"; el.className = "pp-toast"; document.body.appendChild(el); } el.textContent = t; el.classList.add("on"); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("on"), ms || 2600); }
  function popMenu(items, x, y) {
    let el = $("ssMenu"); if (!el) { el = document.createElement("div"); el.id = "ssMenu"; el.className = "pp-menu"; document.body.appendChild(el); document.addEventListener("mousedown", (e) => { if (!e.target.closest("#ssMenu")) el.classList.remove("on"); }); }
    el.innerHTML = items.map((it, i) => (it === "-" ? "<hr>" : '<button type="button" data-mi="' + i + '"' + (it[2] ? ' class="danger"' : "") + ">" + it[0] + "</button>")).join("");
    el.classList.add("on"); el.style.left = Math.max(8, Math.min(window.innerWidth - el.offsetWidth - 8, x)) + "px"; el.style.top = Math.max(8, Math.min(window.innerHeight - el.offsetHeight - 8, y)) + "px";
    el.onmousedown = (e) => e.preventDefault();
    el.onclick = (e) => { const b = e.target.closest("[data-mi]"); if (!b) return; el.classList.remove("on"); items[+b.dataset.mi][1](); };
  }
  const menuAt = (b, items, dx) => { const r = b.getBoundingClientRect(); popMenu(items, r.left + (dx || 0), r.bottom + 4); };

  const S = { pid: "", list: [], decks: [], docs: [], deck: null, i: 0, sel: [], area: null, hist: [], redo: [], scale: 0.5, zoom: 1, clip: null, editing: null, saveT: 0, dirty: false,
    side: P("sd.side", "design"), sideOpen: P("sd.sideOpen", true), ai: false, msgs: [], turns: {}, busyAI: false, front: "ai", view: P("sd.view", "list"), hide: { app: false, rib: false, list: false }, lay: Object.assign({ list: 196, side: 288, ai: 372 }, P("sd.lay", {})) };
  const req = (op, p, b, o) => RND.ws.req(op, Object.assign({ pid: S.pid }, p || {}), b, o);
  const asset = (n) => RND.ws.url("sasset", { pid: S.pid, name: n });
  const RO = { asset: asset };
  const cur = () => S.deck && S.deck.slides[S.i];
  const elById = (id) => { const s = cur(); return s && (s.els || []).find((e) => e.id === id); };
  const stageEl = (id) => { const f = $("sdSc"); return f && f.querySelector('[data-el="' + id + '"]'); };
  const secs = (s) => Math.round((String(s.note || "").replace(/\s/g, "").length || (s.els || []).reduce((a, e) => a + (e.html ? K.plain(e.html).replace(/\s/g, "").length : 0), 0) * 1.6) / 5.2);   // 분당 약 310자

  /* ================================================================== 저장 */
  function deckBody() { const d = S.deck; return { title: d.title, theme: d.theme, minutes: d.minutes, aud: d.aud, footer: !!d.footer, srcDoc: d.srcDoc || "", folder: d.folder || "", runs: d.runs || [], slides: d.slides, created: d.created }; }
  async function saveNow(force) { if (!S.deck || !S.deck.id) return; clearTimeout(S.saveT); S.dirty = false; try { const b = deckBody(); if (!force && S.deck.updated) b.ifUpdated = S.deck.updated; const r = await req("sdeck", { did: S.deck.id }, b); S.deck.updated = r.updated; stat("save", "저장됨"); } catch (e) {
      if (/먼저 저장했어요/.test(e.message)) {   // (v124) 먼저 저장된 내용은 버전으로 남기고 내 내용을 저장할지 묻는다
        if (confirm(e.message + "\n\n[확인] 먼저 저장된 내용을 버전으로 남기고 지금 내용을 저장해요.\n[취소] 저장하지 않아요. 새로고침하면 먼저 저장된 내용이 열려요.")) { try { await req("sversion", { did: S.deck.id }, { note: "다른 곳에서 저장한 내용" }); } catch (e2) { /* 계속 */ } return saveNow(true); }
        S.dirty = true; stat("save", "⚠ 다른 곳에서 저장됨 — 저장 안 함"); return;
      }
      S.dirty = true; stat("save", "⚠ 저장 실패: " + e.message); } }
  function saveSoon() { S.dirty = true; stat("save", "저장 중…"); clearTimeout(S.saveT); S.saveT = setTimeout(saveNow, 800); }
  function snap() { S.hist.push(JSON.stringify({ s: S.deck.slides, t: S.deck.theme, i: S.i })); if (S.hist.length > 80) S.hist.shift(); S.redo = []; }
  function restore(j) { const o = JSON.parse(j); S.deck.slides = o.s; S.deck.theme = o.t; S.i = Math.min(o.i, o.s.length - 1); S.sel = []; pAll(); saveSoon(); }
  const undo = () => { if (!S.hist.length) return; S.redo.push(JSON.stringify({ s: S.deck.slides, t: S.deck.theme, i: S.i })); restore(S.hist.pop()); };
  const redo = () => { if (!S.redo.length) return; S.hist.push(JSON.stringify({ s: S.deck.slides, t: S.deck.theme, i: S.i })); restore(S.redo.pop()); };

  /* ================================================================== 첫 화면 — 발표자료함 */
  async function paint(area) {
    S.area = area;
    if ($("sd") && area.contains($("sd")) && S.deck) { fitSoon(); patchCtx(true); applyHide(); return; }   // 다른 메뉴에 다녀오면 열던 그대로
    try { S.list = (await RND.ws.req("projects")).list || []; } catch (e) { area.innerHTML = '<p class="lb-warn">' + esc(e.message) + "</p>"; return; }
    if (!S.list.length) { area.innerHTML = '<div class="sv hub"><div class="hub-head"><div><h2>발표자료 작성·보조</h2></div></div><p class="sh-muted">연구 프로젝트를 먼저 만드세요.</p></div>'; return; }
    let pid = P("hub.rnd", "") || (RND.cur && RND.cur()) || S.list[0].id; if (!S.list.some((p) => p.id === pid)) pid = S.list[0].id;
    S.pid = pid; S.deck = null; area.onclick = onClick; area.oncontextmenu = onCtx;
    await loadHome();
  }
  async function migrateOld() {   // 옛 발표 스튜디오(계정 저장소) 자료를 파일로 옮긴다
    const key = "rnd.slides." + S.pid, o = P(key, null); if (!o || !o.decks || !o.decks.length) return;
    for (const old of o.decks) { const d = K.migrate(old), id = "d" + uid().slice(1); await req("sdeck", { did: id }, d); }
    PS(key, { decks: [], moved: Date.now() });
  }
  async function loadHome() {
    try { await migrateOld(); } catch (e) { /* 계속 */ }
    try { S.decks = (await req("sdecks")).list || []; S.trashN = ((await req("strash")).list || []).length; } catch (e) { S.area.innerHTML = '<p class="lb-warn">' + esc(e.message) + "</p>"; return; }
    try { S.docs = (await req("docs")).list || []; } catch (e) { S.docs = []; }
    paintHome();
  }
  function paintHome() {
    document.body.classList.remove("pp-zen"); patchCtx(false);
    const p = S.list.find((x) => x.id === S.pid) || {}, q = (S.hq || "").trim().toLowerCase(), v = S.view;
    S.area.innerHTML = '<div class="sv sd-h" id="sdH"><div class="sd-hh"><div><h2>🎬 발표자료 작성·보조</h2><p class="sh-muted">슬라이드를 직접 꾸미거나, 문서·자료로 AI 가 초안을 만들게 해요. 파워포인트로 내보내면 그대로 고칠 수 있어요.</p></div><div class="sd-ha"><button type="button" class="ghost-btn big-btn" data-h="import">⬆ PPTX 불러오기</button><button type="button" class="primary big-btn" data-h="new">＋ 새 발표자료</button></div></div>' +
      '<div class="sd-hb"><aside class="mr-card sd-hp"><b>프로젝트</b>' + S.list.filter((x) => !x.archived).map((x) => '<button type="button" class="sd-pj' + (x.id === S.pid ? " on" : "") + '" data-pj="' + esc(x.id) + '" title="' + esc(x.name) + '">' + esc(x.name) + "</button>").join("") + "</aside>" +
      '<section class="sd-hm"><div class="rn-gbar rn-lbar"><b class="sd-pn">' + esc(p.name || "") + '</b><input id="sdQ" type="search" placeholder="발표자료 찾기" value="' + esc(S.hq || "") + '"><span class="rn-gr">' + (S.trashN ? '<button type="button" class="sh-link" data-h="trash">🗑 휴지통 ' + S.trashN + "개</button>" : "") + '<span class="rn-vsw"><button type="button" data-hv="list"' + (v === "list" ? ' class="on"' : "") + '>☰ 목록</button><button type="button" data-hv="card"' + (v === "card" ? ' class="on"' : "") + ">▦ 카드</button></span></span></div><div id=\"sdDL\"></div></section></div></div>";
    $("sdQ").addEventListener("input", (e) => { S.hq = e.target.value; pDecks(); });
    pDecks();
  }
  function pDecks() {
    const box = $("sdDL"); if (!box) return; const q = (S.hq || "").trim().toLowerCase(), l = S.decks.filter((d) => !q || String(d.title).toLowerCase().indexOf(q) >= 0);
    if (!l.length) { box.innerHTML = '<div class="sw-empty sd-none"><span>🎬</span><b>' + (q ? "찾는 발표자료가 없어요" : "아직 발표자료가 없어요") + "</b>" + (q ? "" : '<p class="sh-muted">양식을 고르거나 문서로 AI 초안을 만들어 시작하세요.</p><button type="button" class="primary big-btn" data-h="new">＋ 새 발표자료</button>') + "</div>"; return; }
    const th = (d, w) => d.first ? K.thumb(d.first, { theme: d.theme, title: d.title }, w, 1, d.n, RO) : '<div class="sd-th" style="width:' + w + "px;height:" + Math.round(w * 9 / 16) + 'px"></div>';
    const pm = (d) => '<button type="button" class="rn-pm" data-dm="' + esc(d.id) + '" title="더 보기" aria-label="메뉴">⋯</button>';
    if (window.SLCLV && SLCLV.on()) {   // (v126) 발표자료함을 공통 목록으로. 표지 그림을 켜고 끌 수 있다
      SLCLV.mount(box, { key: "slides.decks", name: "발표자료", titleLabel: "제목", placeholder: "발표자료 찾기", rows: l.slice(), title: (x) => x.title, img: () => "", imgHtml: (x, cls) => th(x, cls === "lg" ? 300 : 64),
        columns: [{ k: "n", label: "슬라이드", get: (x) => x.n || 0, cls: "n" }, { k: "versions", label: "버전", get: (x) => x.versions || 0, cls: "n" }, { k: "folder", label: "폴더", get: (x) => x.folder || "" }, { k: "updated", label: "최근 수정", get: (x) => SLCLV.day(x.updated) }],
        groups: [{ k: "folder", label: "폴더", path: (x) => [x.folder || "폴더 없음"] }, { k: "month", label: "수정한 달", path: (x) => [SLCLV.day(x.updated).slice(0, 7)] }],
        action: pm, open: (x) => openDeck(x.id) });
      return;
    }
    box.innerHTML = S.view === "card" ? '<div class="sd-cards">' + l.map((d) => '<div class="sd-card" role="link" tabindex="0" data-open="' + esc(d.id) + '">' + th(d, 300) + "<b>" + esc(d.title) + "</b><small>" + d.n + "장 · " + fmtT(d.updated) + "</small>" + pm(d) + "</div>").join("") + "</div>"
      : '<div class="sd-lh"><span></span><span>제목</span><span class="n">슬라이드</span><span class="n">버전</span><span>최근 수정</span><span></span></div><div class="rn-rows">' + l.map((d) => '<div class="sd-row" role="link" tabindex="0" data-open="' + esc(d.id) + '">' + th(d, 88) + "<b>" + esc(d.title) + '</b><span class="n">' + d.n + '</span><span class="n">' + (d.versions || 0) + "</span><span>" + fmtT(d.updated) + "</span>" + pm(d) + "</div>").join("") + "</div>";
  }
  async function openDeck(id) {
    try { const d = (await req("sdeck", { did: id })).deck; S.deck = d; S.deck.id = id; S.deck.slides = (d.slides && d.slides.length) ? d.slides : [K.fromData({ layout: "cover", title: d.title })]; } catch (e) { toast("열지 못했어요: " + e.message, 4000); return; }
    S.i = 0; S.sel = []; S.hist = []; S.redo = []; S.msgs = []; S.turns = {}; paintEd();
  }
  async function createDeck(d, open) {
    const id = "d" + uid().slice(1); d.created = Date.now();
    await req("sdeck", { did: id }, d); if (open !== false) await openDeck(id); return id;
  }
  function deckMenu(id, b) {
    const d = S.decks.find((x) => x.id === id); if (!d) return;
    menuAt(b, [["📂 열기", () => openDeck(id)],
      ["✎ 이름 바꾸기", async () => { const n = prompt("발표자료 이름", d.title); if (!n || !n.trim()) return; const c = (await req("sdeck", { did: id })).deck; c.title = n.trim(); await req("sdeck", { did: id }, c); loadHome(); }],
      ["⧉ 사본 만들기", async () => { const c = (await req("sdeck", { did: id })).deck; c.title = d.title + " 사본"; delete c.id; await createDeck(c, false); toast("사본을 만들었어요"); loadHome(); }],
      ["📁 저장 위치", () => alert("이 프로젝트 폴더 안에 있어요.\nslides/" + id + "/ — 지금 파일과 버전, 그림은 slides/_assets/")], "-",
      ["🗑 지우기", async () => { if (!confirm("'" + d.title + "' 을(를) 지울까요?\n휴지통으로 옮겨서 되살릴 수 있어요.")) return; await req("srm", { did: id }, {}); toast("휴지통으로 옮겼어요"); loadHome(); }, true]], -170);
  }
  async function showTrash() {
    const l = (await req("strash")).list || [];
    modal("🗑 발표자료 휴지통", l.length ? '<div class="rn-rows">' + l.map((x) => '<div class="sd-tr"><b>' + esc(x.title) + "</b><span>" + x.n + "장 · " + fmtT(x.trashed) + '</span><button type="button" class="ghost-btn small-btn" data-tr="' + esc(x.tid) + '">되살리기</button></div>').join("") + "</div>" : '<p class="sh-muted">휴지통이 비어 있어요.</p>');
    $("sdMB").onclick = async (e) => { const b = e.target.closest("[data-tr]"); if (!b) return; await req("srestore", { tid: b.dataset.tr }, {}); closeModal(); toast("되살렸어요"); loadHome(); };
  }
  function modal(title, html, wide) {
    let m = $("sdModal"); if (!m) { m = document.createElement("div"); m.id = "sdModal"; m.className = "sd-modal"; m.innerHTML = '<div class="sd-mbox" role="dialog" aria-modal="true"><div class="sd-mh"><b id="sdMT"></b><button type="button" class="pp-ib" data-mx="1" aria-label="닫기">✕</button></div><div class="sd-mb" id="sdMB"></div></div>'; document.body.appendChild(m); m.addEventListener("click", (e) => { if (e.target === m || e.target.closest("[data-mx]")) closeModal(); }); }
    m.querySelector(".sd-mbox").classList.toggle("wide", !!wide); $("sdMT").textContent = title; $("sdMB").innerHTML = html; m.classList.add("on"); return $("sdMB");
  }
  const closeModal = () => { const m = $("sdModal"); if (m) m.classList.remove("on"); };

  /* ---- 새 발표자료 ---- */
  function newDialog() {
    const sample = (t) => K.thumb(K.fromData(t.slides[0]), { theme: t.theme, title: t.name }, 196, 1, t.slides.length);
    const body = modal("＋ 새 발표자료", '<div class="sd-tabs"><button type="button" class="on" data-nt="tpl">양식에서 시작</button><button type="button" data-nt="ai">✨ AI 로 만들기</button></div>' +
      '<div id="sdNT"><label class="ss-f">제목<input id="sdNName" placeholder="비워도 돼요"></label><div class="sd-tgal"><button type="button" class="sd-tpl" data-tpl=""><div class="sd-th sd-blank" style="width:196px;height:110px"><span>＋</span></div><b>빈 발표자료</b><small>표지 한 장에서 시작</small></button>' + K.TEMPLATES.map((t) => '<button type="button" class="sd-tpl" data-tpl="' + t.id + '">' + sample(t) + "<b>" + t.ico + " " + esc(t.name) + "</b><small>" + esc(t.desc) + "</small></button>").join("") + "</div></div>" +
      '<div id="sdNA" class="hidden">' + aiForm() + "</div>", true);
    body.onclick = async (e) => {
      const nt = e.target.closest("[data-nt]"); if (nt) { body.querySelectorAll("[data-nt]").forEach((x) => x.classList.toggle("on", x === nt)); $("sdNT").classList.toggle("hidden", nt.dataset.nt !== "tpl"); $("sdNA").classList.toggle("hidden", nt.dataset.nt !== "ai"); return; }
      const t = e.target.closest("[data-tpl]"); if (t) { const tp = K.TEMPLATES.find((x) => x.id === t.dataset.tpl) || null, name = $("sdNName").value.trim(); const d = K.deckFrom(tp, name || (tp ? tp.name : "새 발표자료")); if (name && d.slides[0]) { const ti = d.slides[0].els.find((x) => x.role === "title"); if (ti) ti.html = esc(name); } closeModal(); try { await createDeck(d); } catch (er) { toast(er.message, 4000); } return; }
      const th = e.target.closest("[data-gth]"); if (th) { body.querySelectorAll("[data-gth]").forEach((x) => x.classList.toggle("on", x === th)); S.genTheme = th.dataset.gth; return; }
      const a = e.target.closest("[data-gen]"); if (!a) return;
      if (a.dataset.gen === "outline") genOutline(); if (a.dataset.gen === "make") genSlides(); if (a.dataset.gen === "addrow") { S.outline.splice(+a.dataset.i + 1, 0, { layout: "bullets", head: "", point: "" }); paintOutline(); } if (a.dataset.gen === "delrow") { S.outline.splice(+a.dataset.i, 1); paintOutline(); }
    };
  }
  function aiForm() {
    S.genTheme = S.genTheme || "clean"; S.outline = null;
    return '<label class="ss-f">근거 문서<select id="sdGDoc">' + S.docs.map((x) => '<option value="' + esc(x.id) + '">' + esc(x.title) + "</option>").join("") + '<option value="">(문서 없이 — 주제·프로젝트 자료로)</option></select></label><label class="ss-f">주제·요청<input id="sdGTopic" placeholder="예: 평가위원에게 성과 중심으로, 기술 설명은 짧게"></label>' +
      '<div class="ss-r"><label class="ss-f">발표 시간<select id="sdGMin">' + [5, 7, 10, 15, 20, 30].map((m) => '<option value="' + m + '"' + (m === 10 ? " selected" : "") + ">" + m + "분</option>").join("") + '</select></label><label class="ss-f">청중<input id="sdGAud" value="심사위원"></label></div>' +
      '<div class="ss-f">테마</div><div class="sd-gth">' + Object.keys(K.THEMES).map((id) => { const t = K.THEMES[id]; return '<button type="button" data-gth="' + id + '"' + (id === S.genTheme ? ' class="on"' : "") + ' title="' + esc(t.name) + '" style="background:' + K.fillCss(t.cover, t) + '"><i style="background:' + esc(typeof t.bg === "string" ? t.bg : "#fff") + '"></i></button>'; }).join("") + '</div><div id="sdGOut"></div><div class="sd-gact"><button type="button" class="primary big-btn" data-gen="outline">✨ 흐름 만들기</button><span id="sdGMsg" class="sh-muted"></span></div>';
  }
  async function genSource() {
    const did = $("sdGDoc").value, topic = $("sdGTopic").value.trim(); let text = "", title = topic || "발표";
    if (did) { const d = (await req("doc", { did: did })).doc; title = d.title; text = (d.sections || []).map((s) => "## " + s.h + "\n" + (s.body || "")).join("\n\n").slice(0, 26000); }
    else { try { await RND.prepare(S.pid); const c = (origCtx || RND.ctx)(); const ch = await c.retrieve(topic || "연구 목표 내용 성과 일정", 10, 12000); text = c.ground(ch) || ""; } catch (e) { text = ""; } }
    return { text: text, title: title, topic: topic, min: +$("sdGMin").value, aud: $("sdGAud").value.trim() || "청중" };
  }
  const SYS_GEN = "당신은 발표 코치이자 슬라이드 디자이너입니다. 한 장에 메시지 하나만. 제목은 주제가 아니라 그 장의 결론 문장으로. 글은 적게, 항목은 5개 이하에 항목당 25자 안팎. 비슷한 레이아웃이 연달아 나오지 않게 숫자는 kpi, 절차는 process, 일정은 timeline, 비교는 compare, 분류는 grid, 수치 추세는 chart 를 쓰세요. 근거에 없는 수치는 지어내지 말고 없으면 [수치 확인 필요]로 적으세요. 대본은 실제 말하듯 구어체. 한국어로.";
  async function genOutline() {
    const m = $("sdGMsg"); m.textContent = "자료를 읽고 흐름을 짜는 중…";
    try {
      const g = await genSource(); S.genSrc = g; const n = Math.max(5, Math.round(g.min * 1.1));
      const r = await TK.aiJSON({ sys: SYS_GEN, user: "발표 시간 " + g.min + "분, 청중: " + g.aud + ", 약 " + n + "장(표지·마무리 포함)으로 발표 흐름을 짜세요." + (g.topic ? "\n요청: " + g.topic : "") + (g.text ? "\n\n[근거]\n" + g.text : ""), shape: '{"title":"발표 제목","slides":[{"layout":"cover|section|bullets|two|compare|kpi|process|timeline|grid|big|quote|imgleft|table|chart|closing","head":"이 장의 결론 문장","point":"이 장에 들어갈 핵심 내용 한 줄"}]}', tokens: 2500 });
      S.outline = r.slides || []; S.genTitle = r.title || g.title; if (!S.outline.length) throw new Error("흐름을 만들지 못했어요. 다시 눌러 주세요."); m.textContent = ""; paintOutline();
    } catch (e) { m.textContent = "⚠ " + e.message; }
  }
  function paintOutline() {
    const o = $("sdGOut"); if (!o) return;
    o.innerHTML = '<div class="sd-out"><b>흐름 — 고치고 지운 뒤 만들어요</b>' + S.outline.map((x, i) => '<div class="sd-orow"><span>' + (i + 1) + '</span><select data-oi="' + i + '" data-of="layout">' + K.LAYOUTS.filter((l) => l[0] !== "blank").map((l) => '<option value="' + l[0] + '"' + (l[0] === x.layout ? " selected" : "") + ">" + l[1] + "</option>").join("") + '</select><input data-oi="' + i + '" data-of="head" value="' + esc(x.head || "") + '" placeholder="이 장의 결론"><input data-oi="' + i + '" data-of="point" value="' + esc(x.point || "") + '" placeholder="핵심 내용"><button type="button" class="pp-ib" data-gen="addrow" data-i="' + i + '" title="아래에 추가">＋</button><button type="button" class="pp-ib" data-gen="delrow" data-i="' + i + '" title="지우기">✕</button></div>').join("") + "</div>";
    o.oninput = o.onchange = (e) => { const t = e.target; if (t.dataset.oi != null) S.outline[+t.dataset.oi][t.dataset.of] = t.value; };
    const a = o.parentElement.querySelector(".sd-gact"); if (a) a.innerHTML = '<button type="button" class="primary big-btn" data-gen="make">🎬 이 흐름으로 슬라이드 만들기</button><button type="button" class="ghost-btn big-btn" data-gen="outline">↻ 흐름 다시</button><span id="sdGMsg" class="sh-muted"></span>';
  }
  async function genSlides() {
    const m = $("sdGMsg"), g = S.genSrc; m.textContent = "슬라이드와 대본을 쓰는 중…(1~2분)";
    try {
      const r = await TK.aiJSON({ sys: SYS_GEN, user: "아래 흐름대로 슬라이드를 만드세요. 발표 시간 " + g.min + "분(1분 ≈ 300자)에 맞게 대본을 쓰고, 청중은 " + g.aud + ".\n\n[흐름]\n" + S.outline.map((x, i) => i + 1 + ". [" + x.layout + "] " + x.head + " — " + (x.point || "")).join("\n") + "\n\n[슬라이드 형식]\n" + K.SHAPE_HELP + (g.text ? "\n\n[근거]\n" + g.text : ""), shape: '{"slides":[슬라이드 JSON 들]}', tokens: 9000 });
      const list = (r.slides || []).filter((x) => x && typeof x === "object"); if (!list.length) throw new Error("슬라이드를 만들지 못했어요. 다시 눌러 주세요.");
      const d = { title: S.genTitle || g.title, theme: S.genTheme || "clean", minutes: g.min, aud: g.aud, footer: false, srcDoc: $("sdGDoc").value, runs: [], slides: list.map(K.fromData) };
      closeModal(); await createDeck(d); toast("슬라이드 " + list.length + "장을 만들었어요 — 말로 고치려면 ✨ AI");
    } catch (e) { const x = $("sdGMsg"); if (x) x.textContent = "⚠ " + e.message; }
  }

  /* ================================================================== 편집기 */
  const RIB = (b, sep) => b("addslide", "＋ 슬라이드 ▾", "새 슬라이드") + sep + b("text", "T 글상자", "글상자 넣기") + b("shapes", "◆ 도형 ▾", "도형 넣기") + b("image", "🖼 그림", "그림 넣기") + b("table", "▦ 표", "표 넣기") + b("chart", "📊 차트", "차트 넣기") + sep +
    '<select id="sdFs" aria-label="글자 크기" title="글자 크기">' + [12, 14, 16, 18, 20, 22, 24, 26, 28, 32, 36, 40, 44, 48, 54, 60, 72, 96].map((n) => '<option value="' + n + '">' + n + "</option>").join("") + "</select>" + b("fsm", "A−", "글자 작게") + b("fsp", "A＋", "글자 크게") + b("bold", "<b>B</b>", "굵게 (Ctrl+B)") + b("italic", "<i>I</i>", "기울임 (Ctrl+I)") + b("under", "<u>U</u>", "밑줄") + b("ink", '<span class="sd-swi">A</span>', "글자 색") + sep +
    b("al-left", "⬅", "왼쪽 맞춤") + b("al-center", "↔", "가운데 맞춤") + b("al-right", "➡", "오른쪽 맞춤") + b("ul", "•", "글머리표") + sep + b("fill", '<span class="sd-swf"></span>채우기', "채우기 색") + b("stroke", "▭ 윤곽", "윤곽선 색") + sep + b("front", "⇧", "맨 앞으로") + b("back", "⇩", "맨 뒤로") + b("arrange", "맞춤 ▾", "맞춤·분배") + sep + b("dup", "⧉", "복제 (Ctrl+D)") + b("del", "🗑", "지우기 (Del)") + sep + b("undo", "↶", "되돌리기 (Ctrl+Z)") + b("redo", "↷", "다시 (Ctrl+Y)") + sep + b("zout", "−", "작게 보기") + '<span class="rp-zv" id="sdZv"></span>' + b("zin", "＋", "크게 보기") + b("zfit", "⤢", "화면에 맞추기");
  const RAIL = [["design", "🎨", "디자인"], ["layout", "▦", "레이아웃"], ["format", "⚙", "서식"], ["talk", "🎤", "발표"], ["tools", "🧰", "발표 도구"], ["hist", "🕘", "버전"]];
  function paintEd() {
    const d = S.deck, b = (k, l, t) => '<button type="button" class="pp-tb" data-c="' + k + '" title="' + t + '">' + l + "</button>", sep = '<span class="pp-sep"></span>';
    S.area.innerHTML = '<div class="sv pp2 sd" id="sd"><div class="pp2-top sd-top"><div class="pp2-t1"><button type="button" class="rp-back" data-s="home" title="발표자료함으로">← 발표자료함</button><input id="sdTitle" class="rp-title" aria-label="발표자료 제목" value="' + esc(d.title) + '"><span class="pp2-save" id="sdSave">저장됨</span></div><div class="pp2-t2">' +
      '<button type="button" class="pp-tb" data-s="ver" title="버전 저장 (Ctrl+S)">💾 버전 저장</button><button type="button" class="pp-tb" data-s="exp">⬇ 내보내기 ▾</button><button type="button" class="pp-ai-t" data-s="ai">✨ AI</button><button type="button" class="primary sd-play-b" data-s="play" title="슬라이드 쇼 (F5)">▶ 슬라이드 쇼</button><button type="button" class="pp-tb" data-s="playm" aria-label="쇼 메뉴">▾</button><button type="button" class="pp-tb" data-s="zen" title="UI 가리기">◱ UI 가리기</button><button type="button" class="pp-tb" data-s="zenm" aria-label="가릴 것 고르기">▾</button><button type="button" class="pp-tb" data-s="full" title="전체 화면">⛶</button><button type="button" class="pp-tb" data-s="home" title="닫기">✕</button></div></div>' +
      '<div class="rp-ribbon sd-rib" id="sdRib" role="toolbar" aria-label="슬라이드 서식">' + RIB(b, sep) + "</div>" +
      '<div class="sd-ws" id="sdWs"><aside class="sd-list" id="sdList"></aside><section class="sd-main"><div class="sd-canvas" id="sdCanvas"><div class="sd-frame" id="sdFrame"><div class="sd-sc" id="sdSc"></div><div class="sd-over" id="sdOver"></div></div></div><div class="sd-note"><div class="sd-nh"><b>🎤 대본</b><span id="sdNoteS" class="sh-muted"></span></div><textarea id="sdNote" placeholder="이 장에서 말할 내용을 적으세요"></textarea></div></section>' +
      '<aside class="sd-side" id="sdSide"><nav class="pp2-rail">' + RAIL.map((r) => '<button type="button" data-rail="' + r[0] + '" title="' + r[2] + '"><span>' + r[1] + "</span></button>").join("") + '</nav><div class="sd-pane" id="sdPane"></div></aside><section class="pp2-ai sd-ai" id="sdAi"></section></div>' +
      '<div class="pp2-status" id="sdStatus"></div><input type="file" id="sdImg" accept="image/*" hidden><input type="file" id="sdPptx" accept=".pptx" hidden></div>';
    $("sdTitle").addEventListener("input", (e) => { d.title = e.target.value; saveSoon(); });
    $("sdNote").addEventListener("input", (e) => { cur().note = e.target.value; saveSoon(); stat(); });
    $("sdRib").addEventListener("mousedown", (e) => { if (!e.target.closest("select,input")) e.preventDefault(); });
    $("sdFs").addEventListener("change", (e) => setEl({ fs: +e.target.value }));
    $("sdImg").addEventListener("change", async (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) putImage(f); });
    const fr = $("sdFrame"); fr.addEventListener("pointerdown", onDown); fr.addEventListener("dblclick", onDbl);
    $("sdCanvas").addEventListener("pointerdown", (e) => { if (e.target.id === "sdCanvas") { if (S.editing) endEdit(); setSel([]); } });
    $("sdCanvas").addEventListener("wheel", (e) => { if (!e.ctrlKey) return; e.preventDefault(); S.zoom = Math.max(0.5, Math.min(2.5, S.zoom + (e.deltaY < 0 ? 0.1 : -0.1))); fitStage(); }, { passive: false });
    fr.addEventListener("dragover", (e) => e.preventDefault()); fr.addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f && /^image\//.test(f.type)) { e.preventDefault(); putImage(f); } });
    if (window.ResizeObserver) { if (S.ro) S.ro.disconnect(); S.ro = new ResizeObserver(fitStage); S.ro.observe($("sdCanvas")); }
    patchCtx(true); grid(); pAll(); paintAi(); applyHide(); fitSoon();
  }
  function grid() {
    const ws = $("sdWs"); if (!ws) return; const W = ws.clientWidth || window.innerWidth;
    if (S.sideOpen && S.ai && W && W < 1040) { if (S.front === "side") S.ai = false; else S.sideOpen = false; }
    const list = S.hide.list ? 0 : (W < 760 ? 132 : S.lay.list), side = S.sideOpen ? S.lay.side : 44, ai = S.ai ? Math.min(S.lay.ai, Math.max(300, W - list - side - 360)) : 0;
    ws.style.gridTemplateColumns = list + "px minmax(0,1fr) " + side + "px " + ai + "px";
    const root = $("sd"); root.classList.toggle("ai-off", !S.ai); root.classList.toggle("side-off", !S.sideOpen);
    document.querySelectorAll("#sd .pp2-rail [data-rail]").forEach((b) => b.classList.toggle("on", S.sideOpen && b.dataset.rail === S.side));
    const at = document.querySelector('#sd [data-s="ai"]'); if (at) at.classList.toggle("on", S.ai);
  }
  function fit() {
    const ws = $("sdWs"); if (!ws || !ws.offsetParent) return; const sc = document.querySelector("main.content"); if (sc && sc.scrollTop) sc.scrollTop = 0;
    const full = document.fullscreenElement && document.fullscreenElement.id === "sd", st = $("sdStatus");
    const h = Math.floor(window.innerHeight - ws.getBoundingClientRect().top - (st ? st.offsetHeight + 8 : 0) - (full ? 0 : 6)); ws.style.height = Math.max(420, h) + "px";
    const over = document.documentElement.scrollHeight - window.innerHeight; if (!full && over > 0 && over < 90) ws.style.height = Math.max(420, h - over) + "px";
    grid(); fitStage();
  }
  function fitSoon() { clearTimeout(fit.t); fit.t = setTimeout(fit, 40); }
  function fitStage() {
    const c = $("sdCanvas"), f = $("sdFrame"), sc = $("sdSc"); if (!c || !f || !c.clientWidth) return;
    const k = Math.max(0.1, Math.min((c.clientWidth - 44) / K.W, (c.clientHeight - 36) / K.H)) * S.zoom; S.scale = k; c.style.overflow = S.zoom > 1 ? "auto" : "hidden";
    f.style.width = K.W * k + "px"; f.style.height = K.H * k + "px"; sc.style.transform = "scale(" + k + ")"; const z = $("sdZv"); if (z) z.textContent = Math.round(k * 100) + "%"; paintSel();
  }
  window.addEventListener("resize", () => { if ($("sd")) fitSoon(); });
  document.addEventListener("fullscreenchange", () => { if ($("sd")) setTimeout(fit, 80); });

  /* ---- 그리기 ---- */
  function pAll() { pList(); pCur(); paintPane(); stat(); }
  function pCur() {
    const s = cur(), sc = $("sdSc"); if (!s || !sc) return;
    sc.innerHTML = K.slideHtml(s, S.deck, S.i + 1, S.deck.slides.length, RO);
    const n = $("sdNote"); if (n && document.activeElement !== n) n.value = s.note || "";
    fitStage(); syncRib();
  }
  function pList() {
    const d = S.deck, el = $("sdList"); if (!el) return; const w = (el.clientWidth || 196) - 44, N = d.slides.length;
    el.innerHTML = '<div class="sd-lw">' + d.slides.map((s, i) => '<div class="sd-it' + (i === S.i ? " on" : "") + (s.hidden ? " hid" : "") + '" draggable="true" data-si="' + i + '"><b>' + (i + 1) + "</b>" + K.thumb(s, d, Math.max(90, w), i + 1, N, RO) + (s.hidden ? '<i title="숨긴 슬라이드">🙈</i>' : "") + "</div>").join("") + '</div><button type="button" class="sd-add" data-c="addslide">＋ 슬라이드</button>';
    el.ondragstart = (e) => { const c = e.target.closest("[data-si]"); if (c) e.dataTransfer.setData("text/sd", c.dataset.si); };
    el.ondragover = (e) => { const c = e.target.closest("[data-si]"); if (c) { e.preventDefault(); el.querySelectorAll(".drop").forEach((x) => x.classList.remove("drop")); c.classList.add("drop"); } };
    el.ondrop = (e) => { const c = e.target.closest("[data-si]"); if (!c) return; e.preventDefault(); const a = +e.dataTransfer.getData("text/sd"), b = +c.dataset.si; if (a === b || isNaN(a)) return; snap(); const [m] = d.slides.splice(a, 1); d.slides.splice(b, 0, m); S.i = b; saveSoon(); pAll(); };
    const on = el.querySelector(".sd-it.on"); if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest" });
  }
  function pOne() { clearTimeout(pOne.t); pOne.t = setTimeout(() => { const c = document.querySelector("#sdList .sd-it.on .sd-th"); if (!c) return; const w = c.offsetWidth; const t = document.createElement("div"); t.innerHTML = K.thumb(cur(), S.deck, w, S.i + 1, S.deck.slides.length, RO); c.replaceWith(t.firstChild); }, 150); }
  function stat(kind, text) {
    if (kind === "save") { const s = $("sdSave"); if (s) s.textContent = text; return; }
    const el = $("sdStatus"); if (!el || !S.deck) return; const d = S.deck, tot = d.slides.filter((s) => !s.hidden).reduce((a, s) => a + secs(s), 0), goal = (d.minutes || 10) * 60, s = cur();
    el.innerHTML = "<span>🎬 슬라이드 " + (S.i + 1) + " / " + d.slides.length + "</span><span>" + esc(K.LAYOUTS.filter((l) => l[0] === (s && s.layout)).map((l) => l[1])[0] || "자유 배치") + '</span><span class="pp-st-c' + (tot > goal * 1.1 ? " rn-bad" : "") + '">대본 기준 ' + mmss(tot) + " / 목표 " + (d.minutes || 10) + ":00</span>";
    const n = $("sdNoteS"); if (n && s) n.textContent = "약 " + secs(s) + "초 · " + String(s.note || "").length + "자";
  }
  function syncRib() {
    const e = S.sel.length === 1 ? elById(S.sel[0]) : null, f = $("sdFs"); if (f) f.value = e && e.fs ? String(e.fs) : "";
    document.querySelectorAll('#sdRib [data-c^="al-"]').forEach((b) => b.classList.toggle("on", !!e && (e.align || "left") === b.dataset.c.slice(3)));
    [["bold", "b"], ["italic", "i"], ["under", "u"]].forEach((x) => { const b = document.querySelector('#sdRib [data-c="' + x[0] + '"]'); if (b) b.classList.toggle("on", !!(e && e[x[1]])); });
  }
  /* ---- 고르기·끌기 ---- */
  function setSel(ids) { S.sel = ids; paintSel(); syncRib(); if (S.side === "format" && S.sideOpen) paintPane(); }
  function paintSel(guides) {
    const o = $("sdOver"); if (!o) return; const k = S.scale, els = S.sel.map(elById).filter(Boolean); let h = "";
    if (S.editing) { o.innerHTML = ""; return; }
    if (els.length === 1) {
      const e = els[0], line = e.type === "line"; h = '<div class="sd-sb' + (line ? " line" : "") + '" style="left:' + e.x * k + "px;top:" + e.y * k + "px;width:" + e.w * k + "px;height:" + Math.max(e.h, line ? 0 : 1) * k + "px;" + (e.r ? "transform:rotate(" + e.r + "deg);" : "") + '">' + (line ? ["w", "e"] : ["nw", "n", "ne", "e", "se", "s", "sw", "w"]).map((x) => '<i class="sd-hd h-' + x + '" data-h="' + x + '"></i>').join("") + '<i class="sd-rot" data-rot="1" title="돌리기"></i></div>';
    } else if (els.length > 1) {
      const x0 = Math.min(...els.map((e) => e.x)), y0 = Math.min(...els.map((e) => e.y)), x1 = Math.max(...els.map((e) => e.x + e.w)), y1 = Math.max(...els.map((e) => e.y + e.h));
      h = els.map((e) => '<div class="sd-sb2" style="left:' + e.x * k + "px;top:" + e.y * k + "px;width:" + e.w * k + "px;height:" + e.h * k + 'px"></div>').join("") + '<div class="sd-sb3" style="left:' + x0 * k + "px;top:" + y0 * k + "px;width:" + (x1 - x0) * k + "px;height:" + (y1 - y0) * k + 'px"></div>';
    }
    (guides || []).forEach((g) => { h += g.x != null ? '<i class="sd-gd v" style="left:' + g.x * k + 'px"></i>' : '<i class="sd-gd h" style="top:' + g.y * k + 'px"></i>'; });
    o.innerHTML = h;
  }
  function lines(ignore) { const xs = [0, 640, 1280, 72, 1208], ys = [0, 360, 720]; (cur().els || []).forEach((o) => { if (ignore.indexOf(o.id) >= 0) return; xs.push(o.x, o.x + o.w / 2, o.x + o.w); ys.push(o.y, o.y + o.h / 2, o.y + o.h); }); return { xs: xs, ys: ys }; }
  function near(vals, targets, th) { let best = null; vals.forEach((v) => targets.forEach((t) => { const d = t - v; if (Math.abs(d) <= th && (!best || Math.abs(d) < Math.abs(best.d))) best = { d: d, t: t }; })); return best; }
  const applyBox = (e) => { const n = stageEl(e.id); if (!n) return; n.style.left = e.x + "px"; n.style.top = e.y + "px"; n.style.width = e.w + "px"; n.style.height = e.h + "px"; n.style.transform = e.r ? "rotate(" + e.r + "deg)" : ""; };
  function onDown(ev) {
    if (ev.button !== 0) return; const t = ev.target;
    if (S.editing) { const n = stageEl(S.editing); if (n && n.contains(t)) return; endEdit(); }
    const hd = t.closest("[data-h]"); if (hd) { dragResize(ev, hd.dataset.h); return; }
    if (t.closest("[data-rot]")) { dragRot(ev); return; }
    const node = t.closest("[data-el]");
    if (!node) { if (!ev.shiftKey) setSel([]); marquee(ev); return; }
    const id = node.dataset.el;
    if (ev.shiftKey) { setSel(S.sel.indexOf(id) >= 0 ? S.sel.filter((x) => x !== id) : S.sel.concat([id])); return; }
    if (S.sel.indexOf(id) < 0) setSel([id]);
    dragMove(ev);
  }
  function dragMove(ev) {
    ev.preventDefault(); const k = S.scale, sx = ev.clientX, sy = ev.clientY, els = S.sel.map(elById).filter(Boolean), orig = els.map((e) => ({ x: e.x, y: e.y })); if (!els.length) return;
    const L = lines(S.sel), x0 = Math.min(...els.map((e) => e.x)), y0 = Math.min(...els.map((e) => e.y)), x1 = Math.max(...els.map((e) => e.x + e.w)), y1 = Math.max(...els.map((e) => e.y + e.h)); let moved = false;
    const mv = (m) => {
      let dx = (m.clientX - sx) / k, dy = (m.clientY - sy) / k; if (!moved && Math.abs(dx) + Math.abs(dy) < 3 / k) return; if (!moved) { moved = true; snap(); }
      if (m.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      const g = [], th = 6 / k, bx = near([x0 + dx, (x0 + x1) / 2 + dx, x1 + dx], L.xs, th), by = near([y0 + dy, (y0 + y1) / 2 + dy, y1 + dy], L.ys, th);
      if (bx && !m.altKey) { dx += bx.d; g.push({ x: bx.t }); } if (by && !m.altKey) { dy += by.d; g.push({ y: by.t }); }
      els.forEach((e, i) => { e.x = Math.round(orig[i].x + dx); e.y = Math.round(orig[i].y + dy); applyBox(e); }); paintSel(g);
    };
    const up = () => { document.removeEventListener("pointermove", mv); document.removeEventListener("pointerup", up); if (moved) { paintSel(); saveSoon(); pOne(); if (S.side === "format") paintPane(); } };
    document.addEventListener("pointermove", mv); document.addEventListener("pointerup", up);
  }
  function dragResize(ev, h) {
    ev.preventDefault(); ev.stopPropagation(); const k = S.scale, sx = ev.clientX, sy = ev.clientY, e = elById(S.sel[0]); if (!e) return; const o = { x: e.x, y: e.y, w: e.w, h: e.h }, ratio = o.w / Math.max(1, o.h), L = lines(S.sel); let moved = false;
    const mv = (m) => {
      const dx = (m.clientX - sx) / k, dy = (m.clientY - sy) / k; if (!moved) { moved = true; snap(); }
      let x = o.x, y = o.y, w = o.w, hh = o.h; const g = [], th = 6 / k;
      if (h.indexOf("e") >= 0) w = o.w + dx; if (h.indexOf("s") >= 0) hh = o.h + dy; if (h.indexOf("w") >= 0) { w = o.w - dx; x = o.x + dx; } if (h.indexOf("n") >= 0) { hh = o.h - dy; y = o.y + dy; }
      if ((m.shiftKey || e.type === "image") && h.length === 2) { hh = w / ratio; if (h.indexOf("n") >= 0) y = o.y + o.h - hh; }
      else if (!m.altKey) {
        if (h.indexOf("e") >= 0) { const b = near([x + w], L.xs, th); if (b) { w += b.d; g.push({ x: b.t }); } } if (h.indexOf("w") >= 0) { const b = near([x], L.xs, th); if (b) { x += b.d; w -= b.d; g.push({ x: b.t }); } }
        if (h.indexOf("s") >= 0) { const b = near([y + hh], L.ys, th); if (b) { hh += b.d; g.push({ y: b.t }); } } if (h.indexOf("n") >= 0) { const b = near([y], L.ys, th); if (b) { y += b.d; hh -= b.d; g.push({ y: b.t }); } }
      }
      const minH = e.type === "line" ? 0 : 16; e.w = Math.max(16, Math.round(w)); e.h = Math.max(minH, Math.round(e.type === "line" ? o.h : hh)); e.x = Math.round(x + (w < 16 ? w - 16 : 0)); e.y = Math.round(y); applyBox(e); paintSel(g);
    };
    const up = () => { document.removeEventListener("pointermove", mv); document.removeEventListener("pointerup", up); if (moved) { pCur(); saveSoon(); pOne(); if (S.side === "format") paintPane(); } };
    document.addEventListener("pointermove", mv); document.addEventListener("pointerup", up);
  }
  function dragRot(ev) {
    ev.preventDefault(); ev.stopPropagation(); const e = elById(S.sel[0]), fr = $("sdFrame").getBoundingClientRect(), k = S.scale; if (!e) return; const cx = fr.left + (e.x + e.w / 2) * k, cy = fr.top + (e.y + e.h / 2) * k; snap();
    const mv = (m) => { let a = Math.atan2(m.clientY - cy, m.clientX - cx) * 180 / Math.PI + 90; if (a < 0) a += 360; if (m.shiftKey) a = Math.round(a / 15) * 15; else { [0, 90, 180, 270, 360].forEach((t) => { if (Math.abs(a - t) < 4) a = t; }); } e.r = Math.round(a) % 360; applyBox(e); paintSel(); };
    const up = () => { document.removeEventListener("pointermove", mv); document.removeEventListener("pointerup", up); saveSoon(); pOne(); };
    document.addEventListener("pointermove", mv); document.addEventListener("pointerup", up);
  }
  function marquee(ev) {
    const fr = $("sdFrame").getBoundingClientRect(), k = S.scale, sx = ev.clientX, sy = ev.clientY, o = $("sdOver"); let box = null;
    const mv = (m) => { if (!box && Math.abs(m.clientX - sx) + Math.abs(m.clientY - sy) > 4) { box = document.createElement("div"); box.className = "sd-mq"; o.appendChild(box); } if (!box) return; const x = Math.min(sx, m.clientX) - fr.left, y = Math.min(sy, m.clientY) - fr.top, w = Math.abs(m.clientX - sx), h = Math.abs(m.clientY - sy); box.style.cssText = "left:" + x + "px;top:" + y + "px;width:" + w + "px;height:" + h + "px"; };
    const up = (m) => { document.removeEventListener("pointermove", mv); document.removeEventListener("pointerup", up); if (!box) return; const a = (Math.min(sx, m.clientX) - fr.left) / k, b = (Math.min(sy, m.clientY) - fr.top) / k, c = a + Math.abs(m.clientX - sx) / k, d = b + Math.abs(m.clientY - sy) / k; box.remove(); setSel((cur().els || []).filter((e) => e.x < c && e.x + e.w > a && e.y < d && e.y + e.h > b).map((e) => e.id)); };
    document.addEventListener("pointermove", mv); document.addEventListener("pointerup", up);
  }
  function onDbl(ev) { const n = ev.target.closest("[data-el]"); if (n) startEdit(n.dataset.el); }
  /* ---- 글 편집 ---- */
  function cleanHtml(html) {
    const t = document.createElement("template"); t.innerHTML = html;
    t.content.querySelectorAll("script,style,iframe,img,object,embed,a").forEach((x) => { if (x.tagName === "A") x.replaceWith(document.createTextNode(x.textContent)); else x.remove(); });
    t.content.querySelectorAll("*").forEach((el) => { const st = el.getAttribute("style") || "", keep = (st.match(/(?:^|;)\s*(color|font-size|background-color|text-align|font-weight)\s*:[^;]+/gi) || []).map((x) => x.replace(/^[;\s]+/, "")).join(";"); Array.from(el.attributes).forEach((a) => el.removeAttribute(a.name)); if (keep) el.setAttribute("style", keep); });
    return t.innerHTML;
  }
  function startEdit(id) {
    const e = elById(id); if (!e) return;
    if (e.type === "image") { setSel([id]); $("sdImg").click(); return; }
    if (e.type === "chart") { setSel([id]); showSide("format"); return; }
    if (e.type === "table") { snap(); S.editing = id; setSel([id]); const n = stageEl(id); n.outerHTML = K.elHtml(e, K.theme(S.deck.theme), !!cur().dark, Object.assign({ cells: 1 }, RO)); const m = stageEl(id); m.classList.add("editing"); m.querySelectorAll("td").forEach((c) => { c.contentEditable = "true"; }); const f = m.querySelector("td"); if (f) f.focus(); paintSel(); return; }
    if (e.type !== "text" && e.type !== "shape") return;
    snap(); S.editing = id; setSel([id]); const n = stageEl(id), tx = n.querySelector(".sd-tx"); n.classList.add("editing"); tx.contentEditable = "true"; tx.focus(); paintSel();
    const r = document.createRange(); r.selectNodeContents(tx); if (K.plain(e.html) === "글자를 입력하세요") { const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); } else { r.collapse(false); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
  }
  function endEdit() {
    if (!S.editing) return; const id = S.editing, e = elById(id), n = stageEl(id); S.editing = null;
    if (e && n) {
      if (e.type === "table") n.querySelectorAll("td").forEach((c) => { const r = +c.dataset.r, q = +c.dataset.c; if (e.rows[r]) e.rows[r][q] = c.textContent; });
      else { const tx = n.querySelector(".sd-tx"); tx.contentEditable = "false"; e.html = cleanHtml(tx.innerHTML); }
      n.classList.remove("editing");
    }
    window.getSelection().removeAllRanges(); pCur(); saveSoon(); pOne();
  }
  /* ---- 요소 바꾸기 ---- */
  function setEl(patch, opt) {
    const els = S.sel.map(elById).filter(Boolean); if (!els.length) { toast("먼저 요소를 고르세요"); return; }
    if (!S.editing) snap(); els.forEach((e) => Object.assign(e, patch));
    if (S.editing) { const n = stageEl(S.editing), tw = n && n.querySelector(".sd-tw"); if (tw) { if (patch.fs) tw.style.fontSize = patch.fs + "px"; if (patch.align) tw.style.textAlign = patch.align; } } else pCur();
    saveSoon(); pOne(); syncRib(); if (!opt && S.side === "format") paintPane();
  }
  function addEl(o, edit) { snap(); const s = cur(), id = uid(); s.els = s.els || []; s.els.push(Object.assign({ id: id }, o)); saveSoon(); pCur(); setSel([id]); pOne(); if (edit) startEdit(id); }
  const SHAPES = [["rect", "▭ 사각형"], ["round", "▢ 둥근 사각형"], ["oval", "◯ 타원"], ["tri", "△ 삼각형"], ["diamond", "◇ 마름모"], ["arrow", "➡ 화살표"], ["chevron", "❯ 갈매기"], ["pent", "⬟ 오각 화살표"], ["callout", "💬 말풍선"], ["star", "☆ 별"]];
  function addShape(k) { addEl({ type: "shape", shape: k, x: 480, y: 260, w: 320, h: 200, fill: "$accent", html: "", fs: 24, color: "$on", align: "center", radius: 18 }); }
  async function putImage(f) {
    toast("그림을 올리는 중…", 8000); const ext = (f.name.split(".").pop() || "").toLowerCase().replace("jpeg", "jpg"), type = (f.type.split("/")[1] || "png").replace("jpeg", "jpg");
    try {
      const r = await req("sasset", { ext: /^(png|jpg|gif|webp)$/.test(ext) ? ext : type }, f, { raw: true }), src = "asset:" + r.name, tgt = S.sel.length === 1 ? elById(S.sel[0]) : null;
      if (tgt && tgt.type === "image") { snap(); tgt.src = src; pCur(); saveSoon(); pOne(); toast("그림을 바꿨어요"); return; }
      const im = new Image(); im.onload = () => { const m = Math.min(760 / im.naturalWidth, 500 / im.naturalHeight, 1), w = Math.round(im.naturalWidth * m), h = Math.round(im.naturalHeight * m); addEl({ type: "image", src: src, x: Math.round((K.W - w) / 2), y: Math.round((K.H - h) / 2), w: w, h: h, fit: "cover" }); toast("그림을 넣었어요"); }; im.onerror = () => toast("그림을 읽지 못했어요"); im.src = asset(r.name);
    } catch (e) { toast("그림을 넣지 못했어요: " + e.message, 4000); }
  }
  function colorMenu(kind, b) {
    const T = K.theme(S.deck.theme), dark = !!cur().dark, toks = [["$ink", "글자"], ["$muted", "흐린 글자"], ["$accent", "강조"], ["$accent2", "강조 2"], ["$surface", "면"], ["$on", "강조 위 글자"]];
    let el = $("sdCol"); if (!el) { el = document.createElement("div"); el.id = "sdCol"; el.className = "pp-menu sd-colm"; document.body.appendChild(el); document.addEventListener("mousedown", (e) => { if (!e.target.closest("#sdCol")) el.classList.remove("on"); }); }
    const fixed = ["#ffffff", "#000000", "#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#94a3b8", "#475569"];
    el.innerHTML = "<small>테마 색 — 테마를 바꾸면 함께 바뀌어요</small><div>" + toks.map((t) => '<button type="button" data-cv="' + t[0] + '" title="' + t[1] + '" style="background:' + K.col(t[0], T, dark) + '"></button>').join("") + "</div><small>고정 색</small><div>" + fixed.map((c) => '<button type="button" data-cv="' + c + '" style="background:' + c + '"></button>').join("") + "</div>" + (kind === "ink" ? "" : '<button type="button" class="sd-none-c" data-cv="none">없음</button>') + '<label class="sd-cc">직접 고르기 <input type="color" id="sdCP"></label>';
    const r = b.getBoundingClientRect(); el.classList.add("on"); el.style.left = Math.min(window.innerWidth - 230, r.left) + "px"; el.style.top = r.bottom + 4 + "px"; el.onmousedown = (e) => { if (!e.target.closest("input")) e.preventDefault(); };
    const pick = (v) => { el.classList.remove("on"); if (kind === "ink") { if (S.editing && !window.getSelection().isCollapsed) { document.execCommand("foreColor", false, K.col(v, T, dark)); return; } setEl({ color: v }); } else if (kind === "fill") setEl({ fill: v === "none" ? "" : v }); else setEl({ stroke: v === "none" ? "" : v, sw: 2 }); };
    el.onclick = (e) => { const c = e.target.closest("[data-cv]"); if (c) pick(c.dataset.cv); }; $("sdCP").addEventListener("change", (e) => pick(e.target.value));
  }
  function arrange(k) {
    const els = S.sel.map(elById).filter(Boolean); if (!els.length) return; snap();
    const one = els.length === 1, x0 = one ? 0 : Math.min(...els.map((e) => e.x)), y0 = one ? 0 : Math.min(...els.map((e) => e.y)), x1 = one ? K.W : Math.max(...els.map((e) => e.x + e.w)), y1 = one ? K.H : Math.max(...els.map((e) => e.y + e.h));
    if (k === "dx" || k === "dy") { const a = k === "dx" ? "x" : "y", s = k === "dx" ? "w" : "h", l = els.slice().sort((p, q) => p[a] - q[a]); if (l.length > 2) { const tot = l.reduce((t, e) => t + e[s], 0), gap = ((k === "dx" ? x1 - x0 : y1 - y0) - tot) / (l.length - 1); let p = k === "dx" ? x0 : y0; l.forEach((e) => { e[a] = Math.round(p); p += e[s] + gap; }); } }
    else els.forEach((e) => { if (k === "l") e.x = x0; if (k === "c") e.x = Math.round((x0 + x1 - e.w) / 2); if (k === "r") e.x = x1 - e.w; if (k === "t") e.y = y0; if (k === "m") e.y = Math.round((y0 + y1 - e.h) / 2); if (k === "b") e.y = y1 - e.h; });
    pCur(); saveSoon(); pOne();
  }
  function delSel() { if (!S.sel.length) return; snap(); const s = cur(); s.els = s.els.filter((e) => S.sel.indexOf(e.id) < 0); S.sel = []; saveSoon(); pCur(); pOne(); }
  function dupSel() { const els = S.sel.map(elById).filter(Boolean); if (!els.length) { dupSlide(); return; } snap(); const s = cur(), ids = []; els.forEach((e) => { const c = JSON.parse(JSON.stringify(e)); c.id = uid(); c.x += 24; c.y += 24; s.els.push(c); ids.push(c.id); }); saveSoon(); pCur(); setSel(ids); pOne(); }
  function paste() { if (!S.clip) return; snap(); const s = cur(), ids = []; S.clip.forEach((e) => { const c = JSON.parse(JSON.stringify(e)); c.id = uid(); c.x += 24; c.y += 24; s.els.push(c); ids.push(c.id); }); saveSoon(); pCur(); setSel(ids); pOne(); }
  function goSlide(i) { if (S.editing) endEdit(); S.i = Math.max(0, Math.min(S.deck.slides.length - 1, i)); S.sel = []; pList(); pCur(); paintPane(); stat(); }
  function addSlide(kind) { if (S.editing) endEdit(); snap(); const s = K.fromData({ layout: kind || "bullets" }); S.deck.slides.splice(S.i + 1, 0, s); S.i++; S.sel = []; saveSoon(); pAll(); }
  function dupSlide() { snap(); const c = JSON.parse(JSON.stringify(cur())); c.id = "s" + uid().slice(1); (c.els || []).forEach((e) => { e.id = uid(); }); S.deck.slides.splice(S.i + 1, 0, c); S.i++; saveSoon(); pAll(); }
  function delSlide() { if (S.deck.slides.length < 2) { toast("마지막 한 장은 지울 수 없어요"); return; } snap(); S.deck.slides.splice(S.i, 1); S.i = Math.min(S.i, S.deck.slides.length - 1); S.sel = []; saveSoon(); pAll(); }
  function setLayout(kind) {
    snap(); const s = cur(), d = K.dataOf(s); d.layout = kind; const n = K.fromData(d); n.id = s.id; n.note = s.note; n.hidden = s.hidden; n.bg = s.bg; S.deck.slides[S.i] = n; S.sel = []; saveSoon(); pAll();
  }
  function layoutMenu(b) { menuAt(b, K.LAYOUTS.map((l) => [l[1], () => addSlide(l[0])])); }
  function slideMenu(i, x, y) {
    goSlide(i); const s = cur();
    popMenu([["＋ 아래에 새 슬라이드", () => addSlide("bullets")], ["⧉ 복제", dupSlide], [s.hidden ? "👁 다시 보이기" : "🙈 쇼에서 숨기기", () => { snap(); s.hidden = !s.hidden; saveSoon(); pList(); }], ["▦ 레이아웃 바꾸기", () => showSide("layout")], "-", ["🗑 지우기", delSlide, true]], x, y);
  }

  /* ================================================================== 오른쪽 칸 */
  function showSide(k) { S.front = "side"; S.side = k; S.sideOpen = true; PS("sd.side", k); PS("sd.sideOpen", true); grid(); paintPane(); fitStage(); }
  function paintPane() {
    const el = $("sdPane"); if (!el || !S.deck) return; grid(); const d = S.deck; if (!S.sideOpen) { el.innerHTML = ""; return; }
    const head = (t) => '<div class="pp-sh"><b>' + t + '</b><button type="button" class="pp-ib" data-s="sideclose" title="접기">»</button></div>';
    if (S.side === "design") {
      el.innerHTML = head("디자인") + '<div class="sd-p"><small>테마</small><div class="sd-thm">' + Object.keys(K.THEMES).map((id) => { const t = K.THEMES[id], first = d.slides[0]; return '<button type="button" class="' + (id === d.theme ? "on" : "") + '" data-sdth="' + id + '" title="' + esc(t.name) + '">' + K.thumb(first, Object.assign({}, d, { theme: id }), 112, 1, d.slides.length, RO) + "<span>" + esc(t.name) + "</span></button>"; }).join("") + '</div><small>이 슬라이드 배경</small><div class="sd-row2"><button type="button" class="ghost-btn small-btn" data-s="bgc">색 고르기</button><button type="button" class="ghost-btn small-btn" data-s="bgclr">테마 기본</button><label class="sd-chk"><input type="checkbox" id="sdDark"' + (cur().dark ? " checked" : "") + '> 표지 배경</label></div><small>모든 슬라이드</small><label class="sd-chk"><input type="checkbox" id="sdFoot"' + (d.footer ? " checked" : "") + "> 꼬리말에 발표 제목</label></div>";
      $("sdDark").onchange = (e) => { snap(); cur().dark = e.target.checked; saveSoon(); pCur(); pOne(); }; $("sdFoot").onchange = (e) => { d.footer = e.target.checked; saveSoon(); pAll(); };
    } else if (S.side === "layout") {
      el.innerHTML = head("레이아웃 — 글은 그대로 옮겨요") + '<div class="sd-p"><div class="sd-lays">' + K.LAYOUTS.map((l) => { const s = K.fromData({ layout: l[0] }); return '<button type="button" class="' + (cur().layout === l[0] ? "on" : "") + '" data-lay="' + l[0] + '">' + K.thumb(s, d, 112, 2, 9) + "<span>" + l[1] + "</span></button>"; }).join("") + "</div></div>";
    } else if (S.side === "format") paintFormat(el, head);
    else if (S.side === "talk") {
      const tot = d.slides.filter((s) => !s.hidden).reduce((a, s) => a + secs(s), 0), goal = (d.minutes || 10) * 60, mx = Math.max(1, ...d.slides.map(secs));
      el.innerHTML = head("발표") + '<div class="sd-p"><div class="sd-row2"><label class="ss-f">목표 시간(분)<input id="sdMin" type="number" min="1" max="120" value="' + (d.minutes || 10) + '"></label><label class="ss-f">청중<input id="sdAud" value="' + esc(d.aud || "") + '"></label></div><p class="sd-tot' + (tot > goal * 1.1 ? " over" : "") + '">대본 기준 <b>' + mmss(tot) + "</b> / 목표 " + (d.minutes || 10) + ':00</p><small>슬라이드별 시간</small><div class="sd-tb2">' + d.slides.map((s, i) => '<button type="button" data-go="' + i + '"><span>' + (i + 1) + '</span><i><u style="width:' + Math.round(secs(s) / mx * 100) + '%"></u></i><em>' + secs(s) + "초</em></button>").join("") + '</div><button type="button" class="ghost-btn small-btn" data-s="notes">✨ 대본 없는 장에 AI 대본</button><small>리허설 기록</small>' + ((d.runs || []).length ? (d.runs || []).slice().reverse().slice(0, 8).map((r) => '<div class="sd-run"><span>' + fmtT(r.t) + "</span><b>" + mmss(r.total) + "</b></div>").join("") : '<p class="sh-muted">발표자 보기로 끝까지 해 보면 쌓여요.</p>') + "</div>";
      $("sdMin").onchange = (e) => { d.minutes = Math.max(1, +e.target.value || 10); saveSoon(); paintPane(); stat(); }; $("sdAud").onchange = (e) => { d.aud = e.target.value; saveSoon(); };
    } else if (S.side === "tools") paintTools(el, head);
    else if (S.side === "hist") paintHist(el, head);
  }
  function paintFormat(el, head) {
    const els = S.sel.map(elById).filter(Boolean);
    if (els.length !== 1) { el.innerHTML = head("서식") + '<div class="sd-p"><p class="sh-muted">' + (els.length ? "요소 " + els.length + "개를 골랐어요 — 위쪽 막대의 맞춤·분배를 쓰세요." : "슬라이드에서 요소를 누르면 여기서 고칠 수 있어요.") + "</p></div>"; return; }
    const e = els[0], num = (k, l, v) => '<label class="ss-f">' + l + '<input type="number" data-f="' + k + '" value="' + Math.round(v || 0) + '"></label>';
    let h = '<small>위치·크기</small><div class="sd-g4">' + num("x", "X", e.x) + num("y", "Y", e.y) + num("w", "너비", e.w) + num("h", "높이", e.h) + num("r", "회전", e.r) + '<label class="ss-f">불투명<input type="number" min="0" max="100" data-f="op" value="' + Math.round((e.op == null ? 1 : e.op) * 100) + '"></label></div><label class="sd-chk"><input type="checkbox" data-fc="shadow"' + (e.shadow ? " checked" : "") + "> 그림자</label>";
    if (e.type === "text" || e.type === "shape") h += '<small>글</small><div class="sd-g4"><label class="ss-f">세로<select data-fs="valign">' + [["top", "위"], ["middle", "가운데"], ["bottom", "아래"]].map((v) => '<option value="' + v[0] + '"' + ((e.valign || (e.type === "shape" ? "middle" : "top")) === v[0] ? " selected" : "") + ">" + v[1] + "</option>").join("") + '</select></label><label class="ss-f">줄 간격<input type="number" step="0.05" min="0.8" max="3" data-fn="lh" value="' + (e.lh || 1.35) + '"></label></div>';
    if (e.type === "shape" || e.type === "image") h += '<div class="sd-g4"><label class="ss-f">모서리<input type="number" min="0" max="200" data-fn="radius" value="' + (e.radius || 0) + '"></label></div>';
    if (e.type === "shape") h += '<small>도형</small><select data-fs="shape" class="sd-wide">' + SHAPES.map((s) => '<option value="' + s[0] + '"' + (e.shape === s[0] ? " selected" : "") + ">" + s[1] + "</option>").join("") + "</select>";
    if (e.type === "image") h += '<small>그림</small><div class="sd-row2"><button type="button" class="ghost-btn small-btn" data-c="image">바꾸기</button><label class="ss-f">맞춤<select data-fs="fit"><option value="cover"' + (e.fit !== "contain" ? " selected" : "") + '>가득 채우기</option><option value="contain"' + (e.fit === "contain" ? " selected" : "") + ">전체 보이기</option></select></label></div>";
    if (e.type === "table") h += '<small>표 — 두 번 눌러 칸을 고쳐요</small><div class="sd-row2"><button type="button" class="ghost-btn small-btn" data-tb="r+">＋ 행</button><button type="button" class="ghost-btn small-btn" data-tb="r-">− 행</button><button type="button" class="ghost-btn small-btn" data-tb="c+">＋ 열</button><button type="button" class="ghost-btn small-btn" data-tb="c-">− 열</button></div><label class="sd-chk"><input type="checkbox" data-fc="head"' + (e.head !== false ? " checked" : "") + "> 머리글 줄</label>";
    if (e.type === "chart") { const c = e.chart || {}; h += '<small>차트</small><select data-chart="type" class="sd-wide">' + [["col", "세로 막대"], ["bar", "가로 막대"], ["line", "꺾은선"], ["pie", "원형"], ["doughnut", "도넛"]].map((v) => '<option value="' + v[0] + '"' + (c.type === v[0] ? " selected" : "") + ">" + v[1] + "</option>").join("") + '</select><small>데이터 — 첫 줄은 머리글, 쉼표로 구분</small><textarea id="sdCD" rows="7">' + esc(["항목," + (c.series || []).map((s) => s.name).join(",")].concat((c.labels || []).map((l, i) => l + "," + (c.series || []).map((s) => (s.vals || [])[i]).join(","))).join("\n")) + '</textarea><button type="button" class="ghost-btn small-btn" data-s="chartok">데이터 적용</button>'; }
    el.innerHTML = head("서식") + '<div class="sd-p">' + h + '<div class="sd-row2"><button type="button" class="ghost-btn small-btn" data-c="dup">⧉ 복제</button><button type="button" class="ghost-btn small-btn rn-danger" data-c="del">🗑 지우기</button></div></div>';
    el.oninput = null; el.onchange = (ev) => {
      const t = ev.target;
      if (t.dataset.f) { const k = t.dataset.f, v = +t.value || 0; setEl(k === "op" ? { op: Math.max(0, Math.min(1, v / 100)) } : { [k]: v }, 1); paintSel(); }
      if (t.dataset.fn) setEl({ [t.dataset.fn]: +t.value }, 1); if (t.dataset.fs) setEl({ [t.dataset.fs]: t.value }, 1); if (t.dataset.fc) setEl({ [t.dataset.fc]: t.checked }, 1);
      if (t.dataset.chart) { snap(); e.chart = Object.assign({}, e.chart, { type: t.value }); pCur(); saveSoon(); pOne(); }
    };
  }
  function applyChartData() {
    const e = elById(S.sel[0]), ta = $("sdCD"); if (!e || !ta) return; const rows = ta.value.trim().split(/\r?\n/).map((l) => l.split(/[,\t]/).map((x) => x.trim())); if (rows.length < 2 || rows[0].length < 2) { toast("머리글과 값이 필요해요"); return; }
    snap(); e.chart = { type: (e.chart || {}).type || "col", labels: rows.slice(1).map((r) => r[0]), series: rows[0].slice(1).map((n, j) => ({ name: n, vals: rows.slice(1).map((r) => parseFloat(String(r[j + 1] || "").replace(/[,%]/g, "")) || 0) })) }; pCur(); saveSoon(); pOne(); toast("차트를 고쳤어요");
  }
  function tableEdit(k) {
    const e = elById(S.sel[0]); if (!e || !e.rows) return; snap(); const n = e.rows[0].length;
    if (k === "r+") e.rows.push(new Array(n).fill("")); if (k === "r-" && e.rows.length > 1) e.rows.pop(); if (k === "c+") e.rows.forEach((r) => r.push("")); if (k === "c-" && n > 1) e.rows.forEach((r) => r.pop()); pCur(); saveSoon(); pOne();
  }
  async function paintHist(el, head) {
    el.innerHTML = head("버전") + '<div class="sd-p"><button type="button" class="ghost-btn small-btn" data-s="ver">💾 지금 버전 저장</button><div id="sdVL"><p class="sh-muted">불러오는 중…</p></div></div>';
    try { const l = (await req("sversions", { did: S.deck.id })).list || []; const b = $("sdVL"); if (b) b.innerHTML = l.length ? l.map((v) => '<div class="sd-ver"><div><b>v' + v.v + "</b> <small>" + fmtT(v.t) + " · " + v.n + "장</small>" + (v.note ? "<p>" + esc(v.note) + "</p>" : "") + '</div><button type="button" class="ghost-btn small-btn" data-vr="' + v.v + '">되돌리기</button></div>').join("") : '<p class="sh-muted">아직 저장한 버전이 없어요.</p>'; } catch (e) { const b = $("sdVL"); if (b) b.innerHTML = '<p class="lb-warn">' + esc(e.message) + "</p>"; }
  }
  async function saveVersion(note) { await saveNow(); try { const r = await req("sversion", { did: S.deck.id }, { note: note || "" }); toast("v" + r.v + " 로 저장했어요"); if (S.side === "hist") paintPane(); } catch (e) { toast(e.message, 4000); } }
  /* ---- 발표 도구(연구 도구를 이 발표자료 대상으로) ---- */
  const TOOL_IDS = ["rehearse", "briefs", "audio", "qadrill", "qa"];
  let origCtx = null;
  const deckMd = () => S.deck.slides.map((s, i) => { const d = K.dataOf(s); return "## " + (i + 1) + ". " + (d.title || "") + "\n" + d.items.map((x) => "- " + x).join("\n") + (s.note ? "\n\n대본: " + s.note : ""); }).join("\n\n");
  function patchCtx(on) {
    if (!window.RND || !RND.ctx) return; if (!origCtx) origCtx = RND.ctx; if (!on) { RND.ctx = origCtx; return; }
    RND.ctx = function () {
      const vis = $("sd") && $("hub_rx_present") && !$("hub_rx_present").classList.contains("hidden"), base = origCtx(); if (!vis || !base || base.pid !== S.pid || !S.deck) return base;
      const doc = { id: S.deck.id, title: S.deck.title, kind: "slides", sections: S.deck.slides.map((s) => { const d = K.dataOf(s); return { h: d.title, body: d.items.map((x) => "- " + x).join("\n") + (s.note ? "\n\n" + s.note : "") }; }) };
      return Object.assign({}, base, { doc: () => doc, did: () => S.deck.id, docText: () => "# " + S.deck.title + "\n\n" + deckMd(), toDoc: (title, md) => { snap(); const items = String(md).split(/\n/).map((x) => x.replace(/^[-*#\s]+/, "").trim()).filter(Boolean).slice(0, 6); S.deck.slides.splice(S.i + 1, 0, K.fromData({ layout: "bullets", title: title || "도구 결과", items: items })); S.i++; saveSoon(); pAll(); toast("슬라이드로 넣었어요"); } });
    };
  }
  function paintTools(el, head) {
    if (!window.TOOLSETS || !TK.mount) { el.innerHTML = head("발표 도구") + '<p class="sh-muted">도구를 불러오지 못했어요.</p>'; return; }
    const all = TOOLSETS.RND_TOOLS || [], tools = TOOL_IDS.map((id) => all.find((t) => t.id === id)).filter(Boolean);
    el.innerHTML = head("발표 도구") + '<div class="sd-p"><div id="sdTk"></div></div>';
    RND.prepare(S.pid).then(() => { patchCtx(true); TK.mount($("sdTk"), { id: "sdTools", title: "발표 도구", intro: "", tools: tools }); }).catch((e) => { el.innerHTML = head("발표 도구") + '<p class="lb-warn">' + esc(e.message) + "</p>"; });
  }

  /* ================================================================== ✨ AI 대화 */
  const QUICK = [["이 장 다시 디자인", "지금 슬라이드를 내용에 맞는 더 좋은 레이아웃으로 다시 구성해 줘"], ["제목을 결론으로", "모든 슬라이드 제목을 주제가 아니라 그 장의 결론 문장으로 바꿔 줘"], ["대본 써 줘", "대본이 없는 슬라이드에 목표 시간에 맞춰 발표 대본을 써 줘"], ["흐름 점검", "전체 흐름을 점검해서 빠진 장을 넣고 겹치는 장은 합쳐 줘"], ["글 줄이기", "글이 많은 슬라이드를 핵심만 남기고 줄여 줘"], ["표를 차트로", "지금 슬라이드의 표나 숫자를 차트로 바꿔 줘"], ["자료로 보강", "프로젝트 자료를 찾아서 근거 수치를 넣어 줘"]];
  const AI_SYS = () => ["당신은 발표자료를 함께 만드는 디자이너이자 발표 코치입니다. 사용자의 말대로 슬라이드를 직접 고칩니다. 아래 태그로만 작업하세요.",
    "<reply>사용자에게 할 말(짧게)</reply>", '<add after="번호">슬라이드 JSON</add>  그 번호 뒤에 새 슬라이드(0 = 맨 앞)', '<set slide="번호">슬라이드 JSON</set>  그 슬라이드를 통째로 다시 구성', '<edit slide="번호" el="요소id">{"text":"새 글","fs":28,"color":"$accent","x":0,"y":0,"w":0,"h":0}</edit>  요소 하나만 고치기(바꿀 것만)', '<note slide="번호">대본</note>', '<del slide="번호"/>', '<move from="번호" to="번호"/>', '<theme id="' + Object.keys(K.THEMES).join("|") + '"/>', "<title>발표 제목</title>", '<search_materials query="검색어"/>  프로젝트 자료(PDF 등)에서 근거 찾기 — 결과는 다음 차례에',
    "슬라이드 JSON:\n" + K.SHAPE_HELP,
    "규칙: 번호는 1부터. 한 장에 메시지 하나. 글은 적게, 제목은 결론 문장으로. 같은 레이아웃이 연달아 나오지 않게. 근거에 없는 수치를 지어내지 말고 없으면 [수치 확인 필요]. 대본은 구어체. 색 토큰: $ink $muted $accent $accent2 $surface $on. 바꾸지 않을 슬라이드는 건드리지 마세요."].join("\n");
  function deckForAI() {
    const d = S.deck, L = d.slides.map((s, i) => { const x = K.dataOf(s); return "#" + (i + 1) + (i === S.i ? " ◀ 지금" : "") + " [" + (s.layout || "free") + "] " + x.title + (x.items.length ? " | " + x.items.join(" / ").slice(0, 400) : "") + (s.els.some((e) => e.type === "table") ? " | (표)" : "") + (s.els.some((e) => e.type === "chart") ? " | (차트)" : "") + (s.els.some((e) => e.type === "image") ? " | (그림)" : "") + " | 대본 " + String(s.note || "").length + "자"; }).join("\n");
    const c = (cur().els || []).map((e) => e.id + " " + e.type + (e.role ? "(" + e.role + ")" : "") + " x" + e.x + " y" + e.y + " w" + e.w + " h" + e.h + (e.html ? ' "' + K.plain(e.html).slice(0, 120) + '"' : "")).join("\n");
    return "[발표] " + d.title + " · 테마 " + d.theme + " · 목표 " + (d.minutes || 10) + "분 · 청중 " + (d.aud || "-") + "\n[슬라이드 목록]\n" + L + "\n\n[지금 슬라이드 #" + (S.i + 1) + " 요소]\n" + c + (S.sel.length ? "\n[고른 요소] " + S.sel.join(", ") : "");
  }
  function paintAi() {
    const el = $("sdAi"); if (!el) return;
    el.innerHTML = '<div class="pp-aih"><b>✨ 발표자료 AI</b><span class="pp-aim">슬라이드 직접 고침 · 되돌리기</span><button type="button" class="pp-ib" data-s="aiclear" title="대화 지우기">🧹</button><button type="button" class="pp-ib" data-s="ai" title="닫기">✕</button></div><div class="pp-ail" id="sdAiL"></div><div class="pp-aiq"><div class="pp-aichips">' + QUICK.map((q, i) => '<button type="button" data-aq="' + i + '">' + esc(q[0]) + "</button>").join("") + '</div><div class="pp-aiin"><textarea id="sdAiQ" rows="2" placeholder="무엇을 할까요? 예) 3장을 숫자 강조로 · 일정 슬라이드 추가 · 테마를 더 차분하게"></textarea><button type="button" class="primary" data-s="aisend" aria-label="보내기">↑</button></div></div>';
    paintMsgs(); const ta = $("sdAiQ"); ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); const v = ta.value.trim(); if (v) { ta.value = ""; aiSend(v); } } });
  }
  function paintMsgs() {
    const el = $("sdAiL"); if (!el) return;
    if (!S.msgs.length) { el.innerHTML = '<div class="pp-aiempty"><span>✨</span><b>말로 발표자료를 고치세요</b><p>AI 가 슬라이드를 직접 넣고 고쳐요. 바꾼 뒤에는 차례마다 <b>↩ 되돌리기</b>.</p><p class="sh-muted">자료 근거가 필요하면 프로젝트 자료에서 찾아 써요.</p></div>'; return; }
    el.innerHTML = S.msgs.map((m) => {
      if (m.role === "user") return '<div class="pp-m u"><div>' + esc(m.text) + "</div></div>"; if (m.role === "sys") return '<div class="pp-m s">' + esc(m.text) + "</div>";
      const ch = (m.changes || []).map((c) => '<div class="pp-chg"><i>' + esc(c.ico || "•") + "</i><span>" + esc(c.label || "") + "</span>" + (c.go != null ? '<button type="button" data-go="' + c.go + '">보기</button>' : "") + "</div>").join(""), st = (m.steps || []).map((s) => '<div class="pp-step">' + esc(s) + "</div>").join("");
      const foot = !m.busy && m.turn && S.turns[m.turn] && (m.changes || []).length ? '<div class="pp-mfoot"><button type="button" data-cundo="' + esc(m.turn) + '">↩ 이 차례 되돌리기</button></div>' : "";
      return '<div class="pp-m a"><div class="pp-mb2">' + (m.busy && !m.text ? '<span class="lb-dots"><i></i><i></i><i></i></span> 생각하는 중…' : TK.md(m.text || "")) + (m.busy && m.text ? ' <span class="lb-dots"><i></i><i></i><i></i></span>' : "") + "</div>" + st + (ch ? '<div class="pp-chgs">' + ch + "</div>" : "") + foot + "</div>";
    }).join(""); el.scrollTop = el.scrollHeight;
  }
  function paintMsg() { clearTimeout(paintMsg.t); paintMsg.t = setTimeout(paintMsgs, 60); }
  function parseAgent(t) {
    const ops = []; let reply = ""; const rm = /<reply>([\s\S]*?)(<\/reply>|$)/.exec(t); if (rm) reply = rm[1].trim();
    const re = /<add\s+after="(\d+)"\s*>([\s\S]*?)<\/add>|<set\s+slide="(\d+)"\s*>([\s\S]*?)<\/set>|<edit\s+slide="(\d+)"\s+el="([^"]+)"\s*>([\s\S]*?)<\/edit>|<note\s+slide="(\d+)"\s*>([\s\S]*?)<\/note>|<del\s+slide="(\d+)"\s*\/?>|<move\s+from="(\d+)"\s+to="(\d+)"\s*\/?>|<theme\s+id="([^"]+)"\s*\/?>|<title>([\s\S]*?)<\/title>|<search_materials\s+query="([^"]*)"\s*\/?>/g; let m;
    while ((m = re.exec(t))) {
      if (m[1] != null) ops.push({ op: "add", after: +m[1], json: m[2] }); else if (m[3] != null) ops.push({ op: "set", n: +m[3], json: m[4] }); else if (m[5] != null) ops.push({ op: "edit", n: +m[5], el: m[6], json: m[7] }); else if (m[8] != null) ops.push({ op: "note", n: +m[8], text: m[9].trim() }); else if (m[10] != null) ops.push({ op: "del", n: +m[10] }); else if (m[11] != null) ops.push({ op: "move", from: +m[11], to: +m[12] }); else if (m[13] != null) ops.push({ op: "theme", id: m[13] }); else if (m[14] != null) ops.push({ op: "title", text: m[14].trim() }); else if (m[15] != null) ops.push({ op: "search", q: m[15] });
    }
    if (!reply) reply = t.replace(re, "").replace(/<\/?reply>/g, "").trim(); return { reply: reply, ops: ops };
  }
  const liveReply = (f) => { const r = /<reply>([\s\S]*?)(<\/reply>|$)/.exec(f); if (r) return r[1]; const i = f.search(/<(add|set|edit|note|del|move|theme|title|search_)/); return (i >= 0 ? f.slice(0, i) : f).replace(/<\/?reply>?/g, ""); };
  const pj = (s) => { const m = /\{[\s\S]*\}/.exec(String(s || "")); if (!m) throw new Error("JSON 이 아니에요"); return JSON.parse(m[0]); };
  async function applyOp(o) {
    const d = S.deck, N = d.slides.length; const lab = (x) => (K.dataOf(x).title || "").slice(0, 30);
    try {
      if (o.op === "search") { await RND.prepare(S.pid); const c = (origCtx || RND.ctx)(), ch = await c.retrieve(o.q || "", 7, 7000); return { info: "[자료 검색: " + o.q + "]\n" + (c.ground(ch) || "(찾은 자료 없음)"), step: "🔎 자료 검색: " + o.q + " — " + (ch ? ch.length : 0) + "곳" }; }
      if (o.op === "title") { d.title = o.text.slice(0, 200); const t = $("sdTitle"); if (t) t.value = d.title; return { change: { ico: "T", label: "제목: " + d.title } }; }
      if (o.op === "theme") { if (!K.THEMES[o.id]) return { error: "없는 테마: " + o.id }; d.theme = o.id; return { change: { ico: "🎨", label: "테마: " + K.THEMES[o.id].name } }; }
      if (o.op === "add") { const s = K.fromData(pj(o.json)), at = Math.max(0, Math.min(N, o.after)); d.slides.splice(at, 0, s); S.i = at; return { change: { ico: "＋", label: at + 1 + "장 추가: " + lab(s), go: at } }; }
      const i = o.n - 1; if (o.op !== "move" && (i < 0 || i >= N)) return { error: o.n + "번 슬라이드가 없어요(전체 " + N + "장)" };
      if (o.op === "set") { const s = K.fromData(pj(o.json)); s.id = d.slides[i].id; s.hidden = d.slides[i].hidden; if (!s.note) s.note = d.slides[i].note; d.slides[i] = s; S.i = i; return { change: { ico: "✎", label: o.n + "장 다시 구성: " + lab(s), go: i } }; }
      if (o.op === "note") { d.slides[i].note = o.text; return { change: { ico: "🎤", label: o.n + "장 대본 " + o.text.length + "자", go: i } }; }
      if (o.op === "del") { if (N < 2) return { error: "마지막 한 장은 지울 수 없어요" }; const l = lab(d.slides[i]); d.slides.splice(i, 1); S.i = Math.min(S.i, d.slides.length - 1); return { change: { ico: "🗑", label: o.n + "장 지움: " + l } }; }
      if (o.op === "move") { const a = o.from - 1, b = o.to - 1; if (a < 0 || a >= N || b < 0 || b >= N) return { error: "슬라이드 번호가 맞지 않아요" }; const [m] = d.slides.splice(a, 1); d.slides.splice(b, 0, m); return { change: { ico: "⇅", label: o.from + "장 → " + o.to + "장", go: b } }; }
      if (o.op === "edit") { const e = d.slides[i].els.find((x) => x.id === o.el); if (!e) return { error: o.el + " 요소가 " + o.n + "장에 없어요" }; const p = pj(o.json); if (p.text != null) { e.html = /<(ul|li)\b/.test(p.text) ? p.text : esc(p.text).replace(/\n/g, "<br>"); delete p.text; } ["fs", "color", "fill", "x", "y", "w", "h", "b", "align", "valign"].forEach((k) => { if (p[k] != null) e[k] = p[k]; }); S.i = i; return { change: { ico: "✎", label: o.n + "장 " + o.el + " 고침", go: i } }; }
    } catch (e) { return { error: e.message }; }
    return {};
  }
  async function aiSend(text) {
    if (S.busyAI || !S.deck) return; if (S.editing) endEdit();
    const g = await gateAction({ action: "tools", cost: 1 }); if (!g.ok) { S.msgs.push({ role: "sys", text: gateMessage(g), t: Date.now() }); paintMsgs(); return; }
    S.front = "ai"; S.ai = true; grid(); fitSoon(); if (!$("sdAiL")) paintAi();
    const turn = "t" + uid(); S.turns[turn] = JSON.stringify({ s: S.deck.slides, t: S.deck.theme, i: S.i, title: S.deck.title });
    await saveNow(); try { await req("sversion", { did: S.deck.id }, { note: "AI 작업 전" }); } catch (e) { /* 계속 */ }
    const hist = S.msgs.filter((m) => m.role !== "sys").slice(-8).map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.role === "user" ? m.text : "<reply>" + (m.text || "") + "</reply>" }));
    S.msgs.push({ role: "user", text: text, t: Date.now() }); const am = { role: "ai", text: "", changes: [], steps: [], busy: true, turn: turn }; S.msgs.push(am); paintMsgs(); S.busyAI = true;
    const convo = [{ role: "system", content: AI_SYS() }].concat(hist).concat([{ role: "user", content: deckForAI() + "\n\n[요청]\n" + text }]), replies = [];
    try {
      for (let round = 0; round < 5; round++) {
        let full = ""; const acc = await llmStreamChat(convo, (d, f) => { full = f; am.text = replies.concat([liveReply(f)]).filter(Boolean).join("\n\n"); paintMsg(); }, { temperature: 0.4, maxTokens: 8000 });
        full = String(acc || full || ""); const pa = parseAgent(full); if (pa.reply) replies.push(pa.reply); am.text = replies.join("\n\n");
        const results = []; for (const o of pa.ops) { const r = await applyOp(o); if (r.change) am.changes.push(r.change); if (r.step) am.steps.push(r.step); if (r.info) results.push(r.info); if (r.error) results.push("[실패] " + r.error); paintMsg(); }
        if (am.changes.length) { S.sel = []; pAll(); saveSoon(); }
        if (!results.length) break;
        convo.push({ role: "assistant", content: full }); convo.push({ role: "user", content: "[도구 결과]\n" + results.join("\n\n") + "\n\n[지금 상태]\n" + deckForAI() + "\n\n이어서 작업하세요. 끝났으면 <reply> 로 마무리만." });
      }
    } catch (e) { am.text = (am.text ? am.text + "\n\n" : "") + "⚠ " + e.message; }
    am.busy = false; S.busyAI = false; paintMsgs();
  }
  function undoTurn(id) { const t = S.turns[id]; if (!t) return; const o = JSON.parse(t); S.deck.slides = o.s; S.deck.theme = o.t; S.deck.title = o.title; S.i = Math.min(o.i, o.s.length - 1); S.sel = []; const ti = $("sdTitle"); if (ti) ti.value = o.title; delete S.turns[id]; S.msgs.forEach((m) => { if (m.turn === id) { m.text += "\n\n↩ 이 차례에서 바꾼 것을 되돌렸어요."; m.turn = null; } }); pAll(); paintMsgs(); saveSoon(); toast("되돌렸어요"); }

  /* ================================================================== 슬라이드 쇼·발표자 보기 */
  function play(presenter, from) {
    if (S.editing) endEdit(); const d = S.deck, order = d.slides.map((s, i) => i).filter((i) => !d.slides[i].hidden); if (!order.length) { toast("보여 줄 슬라이드가 없어요"); return; }
    let p = Math.max(0, order.indexOf(from == null ? S.i : from)); if (p < 0) p = 0; let black = false, jump = ""; const t0 = Date.now(); let st = Date.now(); const per = d.slides.map(() => 0), budget = d.slides.map(secs);
    const el = document.createElement("div"); el.id = "sdPlay"; el.className = "sd-show" + (presenter ? " pres" : ""); document.body.appendChild(el); try { if (el.requestFullscreen) el.requestFullscreen(); } catch (e) { /* 계속 */ }
    const stage = (i, w, h) => { const k = Math.min(w / K.W, h / K.H); return '<div class="sd-pf" style="width:' + K.W * k + "px;height:" + K.H * k + 'px"><div class="sd-sc" style="transform:scale(' + k + ')">' + K.slideHtml(d.slides[i], d, i + 1, d.slides.length, RO) + "</div></div>"; };
    function draw() {
      const i = order[p], s = d.slides[i], n = order[p + 1], vw = window.innerWidth, vh = window.innerHeight;
      if (!presenter) { el.innerHTML = '<div class="sd-pm' + (black ? " black" : "") + '">' + (black ? "" : stage(i, vw, vh)) + "</div>"; return; }
      el.innerHTML = '<div class="sd-pl">' + (black ? '<div class="sd-pf black"></div>' : stage(i, vw * 0.62, vh * 0.86)) + '<div class="sd-pbar"><button type="button" data-p="-1">◀</button><span>' + (p + 1) + " / " + order.length + '</span><button type="button" data-p="1">▶</button><button type="button" data-p="b">⬛ 가리기</button><button type="button" data-p="x">끝내기</button></div></div><aside class="sd-pr"><div class="ss-clock"><b id="sdClk">0:00</b><small>목표 ' + (d.minutes || 10) + ':00</small><span id="sdPer"></span></div><div class="sd-pnote">' + esc(s.note || "(대본 없음)").replace(/\n/g, "<br>") + '</div><div class="sd-pnext"><small>다음</small>' + (n != null ? K.thumb(d.slides[n], d, Math.min(320, vw * 0.3), n + 1, d.slides.length, RO) : "<b>마지막 슬라이드</b>") + "</div></aside>";
    }
    const tick = () => { const c = $("sdClk"); if (!c) return; const tot = Math.floor((Date.now() - t0) / 1000), i = order[p], cu = per[i] + Math.floor((Date.now() - st) / 1000); c.textContent = mmss(tot); c.classList.toggle("over", tot > (d.minutes || 10) * 60); const q = $("sdPer"); if (q) { q.textContent = "이 장 " + cu + "초 / 계획 " + budget[i] + "초"; q.classList.toggle("over", cu > budget[i] * 1.25 + 5); } };
    const iv = setInterval(tick, 500);
    const go = (k) => { const i = order[p]; per[i] += (Date.now() - st) / 1000; st = Date.now(); const np = p + k; if (np >= order.length) { end(); return; } p = Math.max(0, np); draw(); tick(); };
    const key = (e) => { const k = e.key; if (k === "ArrowRight" || k === " " || k === "PageDown" || k === "Enter" && !jump) { e.preventDefault(); go(1); } else if (k === "ArrowLeft" || k === "PageUp" || k === "Backspace") { e.preventDefault(); go(-1); } else if (k === "Escape") { e.preventDefault(); end(); } else if (k === "b" || k === "B" || k === ".") { black = !black; draw(); } else if (/^\d$/.test(k)) jump += k; else if (k === "Enter" && jump) { const t = Math.min(order.length, Math.max(1, +jump)) - 1; jump = ""; const i = order[p]; per[i] += (Date.now() - st) / 1000; st = Date.now(); p = t; draw(); } };
    function end() {
      clearInterval(iv); document.removeEventListener("keydown", key, true); window.removeEventListener("resize", draw); if (document.fullscreenElement) document.exitFullscreen(); el.remove(); const total = Math.round((Date.now() - t0) / 1000);
      if (presenter && total >= 20) { per[order[p]] += (Date.now() - st) / 1000; d.runs = (d.runs || []).concat([{ t: Date.now(), total: total, per: per.map(Math.round) }]).slice(-20); saveSoon(); toast("리허설 " + mmss(total) + " 기록했어요", 4000); if (S.side === "talk") paintPane(); } goSlide(order[p]);
    }
    document.addEventListener("keydown", key, true); window.addEventListener("resize", draw);
    el.addEventListener("click", (e) => { const b = e.target.closest("[data-p]"); if (b) { const v = b.dataset.p; if (v === "x") end(); else if (v === "b") { black = !black; draw(); } else go(+v); return; } if (!presenter) go(1); });
    draw(); tick();
  }

  /* ================================================================== 내보내기 */
  async function expPptx() {
    await saveNow(); toast("PPTX 를 만드는 중…", 8000);
    try { const r = await req("sexport", { did: S.deck.id }, K.exportDeck(S.deck)); const a = document.createElement("a"); a.href = RND.ws.url("out", { pid: S.pid, name: r.name }); a.download = r.name; document.body.appendChild(a); a.click(); a.remove(); toast("PPTX 로 내보냈어요(" + Math.round(r.size / 1024) + "KB) — 파워포인트에서 그대로 고칠 수 있어요", 4000); }
    catch (e) { toast("PPTX 로 못 만들었어요: " + e.message, 5000); }
  }
  function slideCss() { return Array.from(document.styleSheets).map((s) => { try { return Array.from(s.cssRules).map((r) => r.cssText).filter((t) => /\.sd-(slide|sc|el|tw|tx|tb|ph|pf|th)\b/.test(t)).join("\n"); } catch (e) { return ""; } }).join("\n"); }
  function printPdf() {
    const d = S.deck, w = window.open("", "_blank"); if (!w) { toast("팝업이 막혔어요 — 허용해 주세요"); return; }
    const pages = d.slides.filter((s) => !s.hidden).map((s, i) => '<div class="pg"><div class="sd-sc">' + K.slideHtml(s, d, i + 1, d.slides.length, RO) + "</div></div>").join("");
    w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>' + esc(d.title) + "</title><base href=\"" + esc(location.href) + '"><style>' + slideCss() + "@page{size:1280px 720px;margin:0}html,body{margin:0;background:#fff}.pg{width:1280px;height:720px;overflow:hidden;position:relative;break-after:page;-webkit-print-color-adjust:exact;print-color-adjust:exact}.sd-sc{transform:none!important}</style></head><body>" + pages + "<script>window.onload=function(){setTimeout(function(){window.print()},500)}<\/script></body></html>");
    w.document.close();
  }
  async function expHtml() {
    const d = S.deck; toast("HTML 을 만드는 중…", 6000); const map = {}, names = []; d.slides.forEach((s) => (s.els || []).forEach((e) => { if (e.type === "image" && String(e.src).indexOf("asset:") === 0) names.push(e.src.slice(6)); }));
    for (const n of names) { if (map[n]) continue; try { const b = await (await fetch(asset(n))).blob(); map[n] = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); }); } catch (e) { /* 계속 */ } }
    const O = { asset: (n) => map[n] || "" }, sl = d.slides.filter((s) => !s.hidden).map((s, i) => '<section class="pg"><div class="sd-sc">' + K.slideHtml(s, d, i + 1, d.slides.length, O) + "</div></section>").join("");
    const js = "var p=[].slice.call(document.querySelectorAll('.pg')),i=0;function f(){var k=Math.min(innerWidth/1280,innerHeight/720);p.forEach(function(x,n){x.style.display=n===i?'block':'none';x.style.transform='scale('+k+')';x.style.left=(innerWidth-1280*k)/2+'px';x.style.top=(innerHeight-720*k)/2+'px'})}addEventListener('resize',f);addEventListener('keydown',function(e){if(e.key==='ArrowRight'||e.key===' '||e.key==='PageDown'){i=Math.min(p.length-1,i+1);f()}if(e.key==='ArrowLeft'||e.key==='PageUp'){i=Math.max(0,i-1);f()}});addEventListener('click',function(){i=Math.min(p.length-1,i+1);f()});f()";
    TK.download((d.title || "발표자료") + ".html", '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>' + esc(d.title) + "</title><style>" + slideCss() + "html,body{margin:0;height:100%;background:#000;overflow:hidden}.pg{position:absolute;width:1280px;height:720px;transform-origin:0 0;overflow:hidden}.sd-sc{transform:none!important}</style></head><body>" + sl + "<script>" + js + "<\/script></body></html>", "text/html"); toast("HTML 로 내보냈어요 — ← → 로 넘겨요");
  }
  function beamer() {
    const B = String.fromCharCode(92), d = S.deck, tx = (t) => String(t || "").replace(/[&%#_$]/g, (c) => B + c);
    const fr = d.slides.map((s) => { const x = K.dataOf(s); return B + "begin{frame}{" + tx(x.title) + "}\n" + (x.items.length ? "  " + B + "begin{itemize}\n" + x.items.map((b) => "    " + B + "item " + tx(b)).join("\n") + "\n  " + B + "end{itemize}\n" : "") + (s.note ? "  " + B + "note{" + tx(s.note) + "}\n" : "") + B + "end{frame}"; }).join("\n\n");
    return B + "documentclass[aspectratio=169,11pt]{beamer}\n" + B + "usepackage{kotex}\n" + B + "usetheme{Madrid}\n" + B + "setbeamertemplate{navigation symbols}{}\n" + B + "title{" + tx(d.title) + "}\n" + B + "date{" + B + "today}\n\n" + B + "begin{document}\n" + B + "begin{frame}\n  " + B + "titlepage\n" + B + "end{frame}\n\n" + fr + "\n" + B + "end{document}\n";
  }
  function expMenu(b) {
    menuAt(b, [["📊 파워포인트(PPTX) — 도형·표·차트·대본 그대로", expPptx], ["🖨 PDF (인쇄 → PDF 로 저장)", printPdf], ["🌐 HTML 한 파일", expHtml], "-", ["🏛 연구행정에 산출물 등록", () => { if (window.PINFO) PINFO.registerOutput({ pid: S.pid, type: "발표자료", title: S.deck.title, docId: S.deck.id, tab: "slides" }); }],
      ["📝 대본만 내려받기", () => TK.download((S.deck.title || "대본") + " 대본.md", S.deck.slides.map((s, i) => "## " + (i + 1) + ". " + K.dataOf(s).title + "\n\n" + (s.note || "(대본 없음)")).join("\n\n"), "text/markdown")],
      ["𝑻 Beamer 로 논문 작업실에 넣기", async () => { const ok = window.PAPER && PAPER.importFrom ? await PAPER.importFrom(S.pid, { files: { "slides/main.tex": beamer() } }) : null; toast(ok ? "논문 작업실 slides/main.tex 에 넣었어요 — ★ 본문으로 지정해 컴파일하세요" : "논문 작업실을 한 번 열어 원고를 만든 뒤 다시 시도하세요", 5000); }]], -220);
  }
  async function importPptx(f) {
    if (!f) return; toast("PPTX 를 읽는 중…", 12000);
    try { const r = await req("simport", { name: f.name.slice(0, 80) }, f, { raw: true }); toast("불러왔어요(" + r.n + "장)"); await loadHome(); await openDeck(r.id); } catch (e) { toast("불러오지 못했어요: " + e.message, 5000); }
  }
  function applyHide() {
    const h = S.hide, root = $("sd"); document.body.classList.toggle("pp-zen", !!h.app && !!root); if (!root) return; root.classList.toggle("rp-norib", !!h.rib); const ws = $("sdWs"); if (ws) grid();
    const b = document.querySelector('#sd [data-s="zen"]'); if (b) { const on = h.app || h.rib || h.list; b.classList.toggle("on", !!on); b.textContent = on ? "◳ UI 보이기" : "◱ UI 가리기"; } fitSoon();
  }

  /* ================================================================== 클릭·단축키 */
  async function closeDeck() { if (S.editing) endEdit(); await saveNow(); S.deck = null; S.hide = { app: false, rib: false, list: false }; await loadHome(); }
  function cmd(k, b) {
    const T = { "al-left": "left", "al-center": "center", "al-right": "right" };
    if (k === "addslide") return layoutMenu(b); if (k === "text") return addEl({ type: "text", x: 400, y: 300, w: 480, h: 90, html: "<p>글자를 입력하세요</p>", fs: 28, color: "$ink" }, true);
    if (k === "shapes") return menuAt(b, SHAPES.map((s) => [s[1], () => addShape(s[0])]).concat(["-", ["― 선", () => addEl({ type: "line", x: 400, y: 360, w: 480, h: 0, stroke: "$ink", sw: 3 })]]));
    if (k === "image") { $("sdImg").click(); return; } if (k === "table") return addEl({ type: "table", x: 140, y: 170, w: 1000, h: 320, rows: [["구분", "내용", "비고"], ["", "", ""], ["", "", ""], ["", "", ""]], fs: 20, head: true });
    if (k === "chart") return addEl({ type: "chart", x: 160, y: 140, w: 960, h: 500, fs: 18, chart: { type: "col", labels: ["항목 1", "항목 2", "항목 3", "항목 4"], series: [{ name: "값", vals: [30, 52, 41, 68] }] } });
    if (k === "fsm" || k === "fsp") { const e = elById(S.sel[0]); if (!e) return toast("먼저 글을 고르세요"); return setEl({ fs: Math.max(10, (e.fs || 24) + (k === "fsp" ? 2 : -2)) }); }
    if (k === "bold" || k === "italic" || k === "under") { if (S.editing) { document.execCommand(k === "under" ? "underline" : k); return; } const f = { bold: "b", italic: "i", under: "u" }[k], e = elById(S.sel[0]); if (!e) return toast("먼저 글을 고르세요"); return setEl({ [f]: !e[f] }); }
    if (T[k]) return setEl({ align: T[k] });
    if (k === "ul") { if (S.editing) { document.execCommand("insertUnorderedList"); return; } const e = elById(S.sel[0]); if (!e || !e.html) return; snap(); e.html = /<ul/.test(e.html) ? K.plain(e.html).split("\n").map((x) => "<p>" + esc(x) + "</p>").join("") : "<ul>" + K.plain(e.html).split("\n").filter(Boolean).map((x) => "<li>" + esc(x) + "</li>").join("") + "</ul>"; pCur(); saveSoon(); pOne(); return; }
    if (k === "ink" || k === "fill" || k === "stroke") { if (!S.sel.length) return toast("먼저 요소를 고르세요"); return colorMenu(k, b); }
    if (k === "front" || k === "back") { const s = cur(), l = s.els.filter((e) => S.sel.indexOf(e.id) >= 0), r = s.els.filter((e) => S.sel.indexOf(e.id) < 0); if (!l.length) return; snap(); s.els = k === "front" ? r.concat(l) : l.concat(r); pCur(); saveSoon(); pOne(); return; }
    if (k === "arrange") return menuAt(b, [["⫷ 왼쪽 맞춤", () => arrange("l")], ["⫿ 가운데 맞춤", () => arrange("c")], ["⫸ 오른쪽 맞춤", () => arrange("r")], ["⊤ 위쪽 맞춤", () => arrange("t")], ["⊝ 세로 가운데", () => arrange("m")], ["⊥ 아래쪽 맞춤", () => arrange("b")], "-", ["⇔ 가로 간격 같게", () => arrange("dx")], ["⇕ 세로 간격 같게", () => arrange("dy")]]);
    if (k === "dup") return dupSel(); if (k === "del") return delSel(); if (k === "undo") return undo(); if (k === "redo") return redo();
    if (k === "zin" || k === "zout") { S.zoom = Math.max(0.5, Math.min(2.5, Math.round((S.zoom + (k === "zin" ? 0.1 : -0.1)) * 10) / 10)); return fitStage(); } if (k === "zfit") { S.zoom = 1; return fitStage(); }
  }
  async function onClick(e) {
    const t = e.target; let b;
    if ((b = t.closest("[data-dm]"))) { e.stopPropagation(); deckMenu(b.dataset.dm, b); return; }
    if ((b = t.closest("[data-open]"))) { openDeck(b.dataset.open); return; }
    if ((b = t.closest("[data-pj]"))) { S.pid = b.dataset.pj; PS("hub.rnd", S.pid); loadHome(); return; }
    if ((b = t.closest("[data-hv]"))) { S.view = b.dataset.hv; PS("sd.view", S.view); paintHome(); return; }
    if ((b = t.closest("[data-h]"))) { const k = b.dataset.h; if (k === "new") newDialog(); if (k === "trash") showTrash(); if (k === "import") { let i = $("sdPptxH"); if (!i) { i = document.createElement("input"); i.type = "file"; i.id = "sdPptxH"; i.accept = ".pptx"; i.hidden = true; S.area.appendChild(i); i.addEventListener("change", (ev) => { const f = ev.target.files[0]; ev.target.value = ""; importPptx(f); }); } i.click(); } return; }
    if (!$("sd")) return;
    if ((b = t.closest("[data-si]"))) { goSlide(+b.dataset.si); return; }
    if ((b = t.closest("[data-rail]"))) { const k = b.dataset.rail; S.front = "side"; if (S.side === k && S.sideOpen) S.sideOpen = false; else { S.side = k; S.sideOpen = true; } PS("sd.side", S.side); PS("sd.sideOpen", S.sideOpen); paintPane(); fitSoon(); return; }
    if ((b = t.closest("[data-sdth]"))) { snap(); S.deck.theme = b.dataset.sdth; saveSoon(); pAll(); return; }
    if ((b = t.closest("[data-lay]"))) { setLayout(b.dataset.lay); return; }
    if ((b = t.closest("[data-go]"))) { goSlide(+b.dataset.go); return; }
    if ((b = t.closest("[data-aq]"))) { aiSend(QUICK[+b.dataset.aq][1]); return; }
    if ((b = t.closest("[data-cundo]"))) { if (confirm("이 차례에서 AI 가 바꾼 것을 되돌릴까요?")) undoTurn(b.dataset.cundo); return; }
    if ((b = t.closest("[data-tb]"))) { tableEdit(b.dataset.tb); return; }
    if ((b = t.closest("[data-vr]"))) { if (!confirm("v" + b.dataset.vr + " 로 되돌릴까요? (지금 상태도 먼저 버전으로 남겨요)")) return; await saveVersion("되돌리기 전"); const r = (await req("sversion", { did: S.deck.id, v: b.dataset.vr })).deck; if (r) { snap(); S.deck.slides = r.slides; S.deck.theme = r.theme; S.deck.title = r.title; S.i = 0; S.sel = []; $("sdTitle").value = r.title; saveSoon(); pAll(); toast("되돌렸어요"); } return; }
    if ((b = t.closest("[data-c]"))) { cmd(b.dataset.c, b); return; }
    if ((b = t.closest("[data-s]"))) {
      const k = b.dataset.s;
      if (k === "home") closeDeck(); if (k === "ver") saveVersion(prompt("이 버전 메모(선택)", "") || ""); if (k === "exp") expMenu(b); if (k === "play") { await saveNow(); play(false); }
      if (k === "playm") menuAt(b, [["▶ 처음부터", () => play(false, 0)], ["▶ 이 장부터", () => play(false)], ["🎤 발표자 보기(대본·시간·다음 장)", () => play(true, S.i)]], -170);
      if (k === "ai") { S.front = "ai"; S.ai = !S.ai; grid(); fitSoon(); if (S.ai) { paintAi(); setTimeout(() => { const q = $("sdAiQ"); if (q) q.focus(); }, 60); } }
      if (k === "aiclear") { S.msgs = []; paintMsgs(); } if (k === "aisend") { const q = $("sdAiQ"), v = q.value.trim(); if (v) { q.value = ""; aiSend(v); } }
      if (k === "sideclose") { S.sideOpen = false; PS("sd.sideOpen", false); paintPane(); fitSoon(); }
      if (k === "bgc") { const h = K.theme(S.deck.theme); S.sel = []; let i = $("sdBgI"); if (!i) { i = document.createElement("input"); i.type = "color"; i.id = "sdBgI"; i.hidden = true; document.body.appendChild(i); } i.value = typeof h.bg === "string" ? h.bg : "#ffffff"; i.onchange = () => { snap(); cur().bg = i.value; saveSoon(); pCur(); pOne(); }; i.click(); } if (k === "bgclr") { snap(); delete cur().bg; saveSoon(); pCur(); pOne(); }
      if (k === "notes") aiSend("대본이 없는 슬라이드에 목표 시간에 맞춰 대본을 써 줘"); if (k === "chartok") applyChartData();
      if (k === "zen") { const h = S.hide, on = h.app || h.rib || h.list; S.hide = on ? { app: false, rib: false, list: false } : { app: true, rib: true, list: false }; applyHide(); }
      if (k === "zenm") { const it = (f, l) => [(S.hide[f] ? "☑ " : "☐ ") + l, () => { S.hide[f] = !S.hide[f]; applyHide(); }]; menuAt(b, [it("app", "앱 메뉴·위 막대"), it("rib", "서식 막대"), it("list", "슬라이드 목록")], -150); }
      if (k === "full") { const r = $("sd"); if (document.fullscreenElement) document.exitFullscreen(); else if (r.requestFullscreen) r.requestFullscreen(); }
    }
  }
  function onCtx(e) {
    const it = e.target.closest("[data-si]"); if (it) { e.preventDefault(); slideMenu(+it.dataset.si, e.clientX, e.clientY); return; }
    const n = e.target.closest("[data-el]"); if (n && $("sdFrame") && $("sdFrame").contains(n)) { e.preventDefault(); if (S.sel.indexOf(n.dataset.el) < 0) setSel([n.dataset.el]); popMenu([["⧉ 복제", dupSel], ["📋 복사", () => { S.clip = S.sel.map(elById).filter(Boolean); }], ["⇧ 맨 앞으로", () => cmd("front")], ["⇩ 맨 뒤로", () => cmd("back")], ["⚙ 서식", () => showSide("format")], "-", ["🗑 지우기", delSel, true]], e.clientX, e.clientY); }
  }
  document.addEventListener("keydown", (e) => {
    const root = $("sd"); if (!root || !root.offsetParent || $("sdPlay")) return; const t = e.target, typing = t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable, mod = e.ctrlKey || e.metaKey, kk = e.key.toLowerCase();
    if (mod && kk === "s") { e.preventDefault(); saveVersion(""); return; }
    if (e.key === "F5") { e.preventDefault(); play(false); return; }
    if (S.editing) { if (e.key === "Escape") { e.preventDefault(); endEdit(); } return; }
    if (typing) return;
    if (mod && kk === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; } if (mod && kk === "y") { e.preventDefault(); redo(); return; }
    if (mod && kk === "d") { e.preventDefault(); dupSel(); return; } if (mod && kk === "c") { S.clip = JSON.parse(JSON.stringify(S.sel.map(elById).filter(Boolean))); return; } if (mod && kk === "x") { S.clip = JSON.parse(JSON.stringify(S.sel.map(elById).filter(Boolean))); delSel(); return; } if (mod && kk === "v") { if (S.clip) { e.preventDefault(); paste(); } return; }
    if (mod && kk === "a") { e.preventDefault(); setSel((cur().els || []).map((x) => x.id)); return; }
    if (e.key === "Delete" || e.key === "Backspace") { if (S.sel.length) { e.preventDefault(); delSel(); } return; } if (e.key === "Escape") { setSel([]); return; }
    if (e.key === "Enter" && S.sel.length === 1) { e.preventDefault(); startEdit(S.sel[0]); return; }
    if (e.key === "PageDown") { e.preventDefault(); goSlide(S.i + 1); return; } if (e.key === "PageUp") { e.preventDefault(); goSlide(S.i - 1); return; }
    if (/^Arrow/.test(e.key)) { const els = S.sel.map(elById).filter(Boolean); if (!els.length) { if (e.key === "ArrowDown" || e.key === "ArrowRight") goSlide(S.i + 1); else goSlide(S.i - 1); e.preventDefault(); return; } e.preventDefault(); snap(); const d = e.shiftKey ? 10 : 1; els.forEach((x) => { if (e.key === "ArrowLeft") x.x -= d; if (e.key === "ArrowRight") x.x += d; if (e.key === "ArrowUp") x.y -= d; if (e.key === "ArrowDown") x.y += d; applyBox(x); }); paintSel(); saveSoon(); pOne(); }
  });
  document.addEventListener("paste", (e) => { const root = $("sd"); if (!root || !root.offsetParent || S.editing) return; const t = e.target; if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return; const it = Array.from((e.clipboardData && e.clipboardData.items) || []).find((x) => /^image\//.test(x.type)); if (it) { e.preventDefault(); const f = it.getAsFile(); if (f) putImage(new File([f], "붙인 그림." + (f.type.split("/")[1] || "png"), { type: f.type })); } });
  window.addEventListener("beforeunload", () => { if (S.dirty && S.deck) saveNow(); });

  function build() {
    const content = document.querySelector("main.content"); if (!content || typeof EXT_VIEWS === "undefined") return;
    let a = $("hub_rx_present"); if (!a) { a = document.createElement("section"); a.id = "hub_rx_present"; a.className = "hidden"; content.appendChild(a); }
    EXT_VIEWS.rx_present = { area: a, open: () => paint(a).catch((er) => { a.innerHTML = '<p class="lb-warn">' + esc(er.message) + "</p>"; }) };
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(build, 0)); else setTimeout(build, 30);
  document.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches && e.target.matches(".sd-row[data-open],.sd-card[data-open]")) { e.preventDefault(); openDeck(e.target.dataset.open); } });
  window.SLIDESTUDIO = { open: (pid) => { if (pid) { PS("hub.rnd", pid); S.pid = pid; S.deck = null; } navTo("rx_present"); }, state: S };
})();
