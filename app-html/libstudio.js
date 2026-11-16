(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const G = (k, d) => (window.TK ? TK.store.get(k, d) : d), PS = (k, v) => { if (window.TK) TK.store.set(k, v); };
  const uid = () => Math.random().toString(36).slice(2, 9);
  const today = () => { const n = new Date(); return new Date(n.getTime() - n.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };   // 지역 날짜(UTC 로 하면 KST 오전에 어제가 된다)
  const addDays = (d, n) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };   // UTC 끼리 계산(섞으면 하루가 안 넘어가 달력 반복이 끝나지 않는다)
  function toast(t, ms) { let el = $("lsToast"); if (!el) { el = document.createElement("div"); el.id = "lsToast"; el.className = "pp-toast"; document.body.appendChild(el); } el.textContent = t; el.classList.add("on"); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("on"), ms || 2600); }
  const dots = (t) => '<p class="sh-muted"><span class="lb-dots"><i></i><i></i><i></i></span> ' + esc(t) + "</p>";
  const sysLib = "당신은 학습 자료를 바탕으로 가르치는 튜터입니다. 자료에 있는 내용만 근거로 한국어로 답합니다.";

  /* ---- 자료 목록·본문 ---- */
  async function docs() { try { if (typeof libCatalog === "function") await libCatalog(); if (window.LIB2 && LIB2.markLegacy) LIB2.markLegacy(); } catch (e) { /* 계속 */ } return ((typeof libState !== "undefined" && libState.catalog) || {}).docs || []; }
  const curDoc = () => G("ls.doc", ""); const setDoc = (id) => PS("ls.doc", id);
  async function picker(id) {
    const l = await docs(); let cur = curDoc(); if (!l.some((d) => d.id === cur)) cur = (l.find((d) => !d.legacy) || l[0] || {}).id || ""; setDoc(cur);
    const nw = l.filter((d) => !d.legacy), lg = l.filter((d) => d.legacy); const opt = (d) => '<option value="' + esc(d.id) + '"' + (d.id === cur ? " selected" : "") + ">" + esc(d.title) + "</option>";
    return '<select id="' + id + '" class="ls-doc" aria-label="학습 자료">' + (nw.length ? '<optgroup label="새 자료">' + nw.map(opt).join("") + "</optgroup>" : "") + (lg.length ? '<optgroup label="레거시">' + lg.map(opt).join("") + "</optgroup>" : "") + "</select>";
  }
  const textCache = {};
  async function docText(id) {
    if (textCache[id]) return textCache[id]; const d = (await docs()).find((x) => x.id === id); if (!d || !d.path) throw new Error("이 자료의 본문을 읽지 못했어요.");
    const r = await fetch(d.path); if (!r.ok) throw new Error("자료를 불러오지 못했어요(" + r.status + ")"); const dom = new DOMParser().parseFromString(await r.text(), "text/html");
    dom.querySelectorAll("script,style,nav,svg,.toc,header,footer,[data-sources]").forEach((x) => x.remove()); const body = dom.querySelector("main,article,.doc,body") || dom.body;
    const secs = []; let cur = { h: d.title, t: "" }; body.querySelectorAll("h1,h2,h3,p,li,td,blockquote").forEach((n) => { if (/^H[12]$/.test(n.tagName)) { if (cur.t.trim()) secs.push(cur); cur = { h: n.textContent.trim().slice(0, 80), t: "" }; } else cur.t += n.textContent.trim() + "\n"; }); if (cur.t.trim()) secs.push(cur);
    return (textCache[id] = { title: d.title, secs: secs, all: secs.map((s) => "## " + s.h + "\n" + s.t).join("\n") });
  }
  const excerpt = (t, n) => { const a = t.all; if (a.length <= n) return a; const step = Math.floor(n / Math.max(1, t.secs.length)); return t.secs.map((s) => "## " + s.h + "\n" + s.t.slice(0, step)).join("\n").slice(0, n); };
  const shell = (id, title, sub, right) => '<div class="sv ll ls" id="' + id + '"><div class="ll-top"><div class="ll-t1"><b>' + title + "</b>" + (sub || "") + "</div>" + (right || "") + "</div>";
  const needAi = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message, 5000); return null; } };

  /* ================================================================== 🧠 복습 카드 */
  const SK = "lib.srs"; const srs = () => { const d = G(SK, null) || {}; d.cards = d.cards || []; d.log = d.log || {}; return d; }; const srsSave = (d) => PS(SK, d);
  function schedule(c, q) {   // q: 0 다시 · 1 어려움 · 2 알맞음 · 3 쉬움 (SM-2 변형)
    const t = today(); c.ease = c.ease || 2.5; c.reps = c.reps || 0;
    if (q === 0) { c.reps = 0; c.ivl = 0; c.lapses = (c.lapses || 0) + 1; c.ease = Math.max(1.3, c.ease - 0.2); }
    else { c.ease = Math.max(1.3, c.ease + [0, -0.15, 0, 0.15][q]); c.reps += 1; c.ivl = c.reps === 1 ? (q === 3 ? 3 : 1) : c.reps === 2 ? (q === 1 ? 3 : q === 3 ? 8 : 6) : Math.round(c.ivl * (q === 1 ? 1.2 : q === 3 ? c.ease * 1.3 : c.ease)); }
    c.due = addDays(t, c.ivl || 0); c.last = t; return c;
  }
  const nextLabel = (c, q) => { const x = schedule(Object.assign({}, c), q); return x.ivl ? (x.ivl >= 30 ? Math.round(x.ivl / 30) + "달" : x.ivl + "일") : "오늘 다시"; };
  async function memPaint(a) {
    a.onclick = memClick; const d = srs(), t = today(), due = d.cards.filter((c) => (c.due || t) <= t), l = await docs(), by = {}; d.cards.forEach((c) => { (by[c.doc] = by[c.doc] || []).push(c); });
    const days = Array.from({ length: 84 }, (_, i) => addDays(t, i - 83)), fc = Array.from({ length: 7 }, (_, i) => { const dd = addDays(t, i); return [dd, d.cards.filter((c) => (i ? c.due === dd : (c.due || t) <= t)).length]; }), mx = Math.max(1, ...fc.map((x) => x[1])), runDays = (() => { let n = 0, x = t; if (!d.log[x]) x = addDays(x, -1); while (d.log[x]) { n++; x = addDays(x, -1); } return n; })();
    a.innerHTML = shell("mem", "🧠 복습 카드", '<span class="ll-cnt">전체 ' + d.cards.length + "장 · 연속 " + runDays + "일</span>") + '<div class="ls-top"><section class="mr-card ls-today"><b>' + due.length + '</b><small>오늘 복습할 카드</small><button type="button" class="primary mr-go" data-c="go"' + (due.length ? "" : " disabled") + ">▶ 복습 시작</button></section>" +
      '<section class="mr-card"><h4>앞으로 7일</h4><div class="ls-fc">' + fc.map((x) => '<div><i style="height:' + Math.round(x[1] / mx * 100) + '%"></i><b>' + x[1] + "</b><small>" + x[0].slice(8) + "일</small></div>").join("") + '</div></section><section class="mr-card"><h4>최근 12주</h4><div class="ls-heat">' + days.map((x) => { const n = d.log[x] || 0; return '<i class="h' + (n === 0 ? 0 : n < 10 ? 1 : n < 30 ? 2 : 3) + '" title="' + x + " · " + n + '장"></i>'; }).join("") + '</div></section></div><section class="mr-card"><div class="dr-h"><h4>카드 만들기</h4></div><div class="ls-mk">' + await picker("memDoc") + '<label>장 수 <select id="memN"><option>10</option><option selected>20</option><option>30</option></select></label><button type="button" class="primary small-btn" data-c="gen">✨ 문서에서 카드 만들기</button><button type="button" class="ghost-btn small-btn" data-c="hl">🖍 내 형광펜으로</button></div><div id="memGen"></div></section><section class="mr-card"><h4>자료별 카드</h4>' + (Object.keys(by).length ? '<table class="rh-tbl"><thead><tr><th>자료</th><th>전체</th><th>오늘</th><th>익힘</th><th></th></tr></thead><tbody>' + Object.keys(by).map((id) => { const c = by[id], dd = l.find((x) => x.id === id); return '<tr><td class="t">' + esc(dd ? dd.title : id) + "</td><td>" + c.length + "</td><td>" + c.filter((x) => (x.due || t) <= t).length + "</td><td>" + c.filter((x) => (x.ivl || 0) >= 21).length + '</td><td><button type="button" class="ghost-btn small-btn" data-cd="' + esc(id) + '">이 자료만 복습</button></td></tr>'; }).join("") + "</tbody></table>" : '<p class="sh-muted">아직 카드가 없어요.</p>') + "</section></div>";
    $("memDoc").addEventListener("change", (e) => setDoc(e.target.value));
  }
  const cardShape = '{"cards":[{"front":"질문(한 가지만 묻기)","back":"답(짧게)","sec":"어느 절"}]}';
  async function memGen(fromHl) {
    const id = $("memDoc").value, n = +$("memN").value, box = $("memGen"); box.innerHTML = dots("카드 만드는 중…"); setDoc(id);
    try {
      const t = await docText(id); let src = excerpt(t, 24000); if (fromHl) { const hl = hlOf(id); if (!hl.length) { box.innerHTML = '<p class="sh-muted">이 자료에 형광펜이 없어요.</p>'; return; } src = hl.map((x) => "- " + x.text).join("\n"); }
      const r = await TK.aiJSON({ sys: "당신은 기억 과학에 밝은 학습 설계자입니다. 카드 한 장에 사실 하나. 이해를 묻고, 답은 자료에 있는 내용만. 한국어로.", user: "[자료: " + t.title + "]\n" + src + "\n\n핵심 위주로 카드 " + n + "장.", shape: cardShape, tokens: 3200 });
      S2.pre = { doc: id, cards: (r.cards || []).map((c) => ({ front: c.front, back: c.back, sec: c.sec })) }; prePaint();
    } catch (e) { box.innerHTML = '<p class="lb-warn">' + esc(e.message) + "</p>"; }
  }
  const S2 = { pre: null, q: [], i: 0, flip: false, done: 0 };
  function prePaint() { const box = $("memGen"), p = S2.pre; box.innerHTML = '<div class="ls-pre">' + p.cards.map((c, i) => '<div><div contenteditable="true" data-pf="' + i + '">' + esc(c.front) + '</div><div contenteditable="true" data-pb="' + i + '">' + esc(c.back) + '</div><button type="button" class="pp-ib" data-px="' + i + '">✕</button></div>').join("") + '</div><button type="button" class="primary small-btn" data-c="add">덱에 넣기 (' + p.cards.length + "장)</button>"; box.oninput = (e) => { const t = e.target; if (t.dataset.pf != null) p.cards[+t.dataset.pf].front = t.textContent; if (t.dataset.pb != null) p.cards[+t.dataset.pb].back = t.textContent; }; }
  function revPaint() {
    const a = $("hub_lx_memory"), c = S2.q[S2.i]; if (!c) { a.innerHTML = '<div class="sv ll ls"><section class="mr-card ls-end"><span>🎉</span><b>오늘 복습 끝 — ' + S2.done + '장</b><button type="button" class="primary" data-c="home">돌아가기</button></section></div>'; return; }
    a.innerHTML = '<div class="sv ll ls"><div class="ls-rv"><div class="ls-pg"><i style="width:' + Math.round(S2.i / S2.q.length * 100) + '%"></i></div><small>' + (S2.i + 1) + " / " + S2.q.length + '</small><div class="ls-card' + (S2.flip ? " flip" : "") + '" data-c="flip"><p>' + esc(c.front) + "</p>" + (S2.flip ? "<hr><p><b>" + esc(c.back) + "</b></p>" + (c.sec ? "<small>" + esc(c.sec) + "</small>" : "") : "<small>눌러서 답 보기 · Space</small>") + "</div>" + (S2.flip ? '<div class="ls-grade">' + [["다시", 0], ["어려움", 1], ["알맞음", 2], ["쉬움", 3]].map((g) => '<button type="button" data-g="' + g[1] + '" class="g' + g[1] + '"><b>' + g[0] + "</b><small>" + nextLabel(c, g[1]) + "</small></button>").join("") + "</div>" : "") + '<button type="button" class="ghost-btn small-btn" data-c="home">그만하기</button></div></div>';
  }
  function grade(q) { const d = srs(), c = S2.q[S2.i], i = d.cards.findIndex((x) => x.id === c.id); if (i >= 0) { schedule(d.cards[i], q); const t = today(); d.log[t] = (d.log[t] || 0) + 1; srsSave(d); } if (q === 0) S2.q.push(c); else S2.done++; S2.i++; S2.flip = false; revPaint(); }
  document.addEventListener("keydown", (e) => { const a = $("hub_lx_memory"); if (!a || a.classList.contains("hidden") || !a.querySelector(".ls-rv")) return; if (e.key === " ") { e.preventDefault(); S2.flip = !S2.flip; revPaint(); } if (S2.flip && /^[1-4]$/.test(e.key)) grade(+e.key - 1); });
  function memClick(e) {
    const t = e.target; let b; const a = $("hub_lx_memory");
    if ((b = t.closest("[data-g]"))) { grade(+b.dataset.g); return; }
    if ((b = t.closest("[data-px]"))) { S2.pre.cards.splice(+b.dataset.px, 1); prePaint(); return; }
    if ((b = t.closest("[data-cd]"))) { const tt = today(); S2.q = srs().cards.filter((c) => c.doc === b.dataset.cd && (c.due || tt) <= tt); if (!S2.q.length) S2.q = srs().cards.filter((c) => c.doc === b.dataset.cd).slice(0, 20); S2.i = 0; S2.done = 0; S2.flip = false; revPaint(); return; }
    if ((b = t.closest("[data-c]"))) {
      const k = b.dataset.c; if (k === "gen") memGen(false); if (k === "hl") memGen(true); if (k === "home") memPaint(a); if (k === "flip") { S2.flip = !S2.flip; revPaint(); }
      if (k === "go") { const tt = today(); S2.q = srs().cards.filter((c) => (c.due || tt) <= tt).sort(() => Math.random() - 0.5); S2.i = 0; S2.done = 0; S2.flip = false; revPaint(); }
      if (k === "add") { const d = srs(); S2.pre.cards.forEach((c) => d.cards.push({ id: uid(), doc: S2.pre.doc, front: c.front, back: c.back, sec: c.sec, due: today(), ease: 2.5, reps: 0, ivl: 0 })); srsSave(d); toast(S2.pre.cards.length + "장 넣었어요"); S2.pre = null; memPaint(a); }
    }
  }

  /* ================================================================== 🗒 노트 허브 */
  function hlOf(id) { let l = []; try { l = JSON.parse(localStorage.getItem("study.reader.hl." + id) || "[]"); } catch (e) { l = []; } return l.map((x) => ({ text: x.text || x.t || "", color: x.color || x.c || "", note: x.note || "" })).filter((x) => x.text); }
  const N = { q: "", doc: "", pick: {}, view: "all" };
  async function notePaint(a) {
    a.onclick = noteClick; const l = await docs(), items = []; l.forEach((d) => { hlOf(d.id).forEach((h, i) => items.push({ key: d.id + "#" + i, doc: d.id, title: d.title, kind: "hl", text: h.text, note: h.note, color: h.color })); const n = G("lib.notes." + d.id, null); if (n && n.t && n.t.trim()) items.push({ key: d.id + "#n", doc: d.id, title: d.title, kind: "note", text: n.t.trim() }); }); N.items = items;
    const q = N.q.toLowerCase(), f = items.filter((x) => (!N.doc || x.doc === N.doc) && (!q || (x.text + " " + (x.note || "") + " " + x.title).toLowerCase().indexOf(q) >= 0)), ds = {}; items.forEach((x) => { ds[x.doc] = ds[x.doc] || { t: x.title, n: 0 }; ds[x.doc].n++; }); const syn = G("lib.synth", []) || [], pk = Object.values(N.pick).filter(Boolean).length;
    a.innerHTML = shell("nh", "🗒 노트 허브", '<span class="ll-cnt">형광펜·노트 ' + items.length + "개 · 자료 " + Object.keys(ds).length + "편</span>") + '<div class="ls-nh"><aside class="mr-card dr-side"><button type="button" class="rp-di' + (N.doc ? "" : " on") + '" data-nd=""><b>모든 자료</b></button>' + Object.keys(ds).map((id) => '<button type="button" class="rp-di' + (N.doc === id ? " on" : "") + '" data-nd="' + esc(id) + '"><b>' + esc(ds[id].t.slice(0, 40)) + "</b><small>" + ds[id].n + "개</small></button>").join("") + (syn.length ? '<h4>종합 노트</h4>' + syn.map((s, i) => '<button type="button" class="rp-di" data-ns="' + i + '"><b>' + esc(s.title) + "</b></button>").join("") : "") + '</aside><main class="dr-main"><div class="ll-lbar"><input id="nhQ" type="search" placeholder="노트·형광펜 찾기" value="' + esc(N.q) + '"><span style="flex:1"></span><span class="sh-muted">고른 것 ' + pk + '개</span><button type="button" class="primary small-btn" data-n="syn">✨ 종합 노트 만들기</button><button type="button" class="ghost-btn small-btn" data-n="card">🧠 카드로</button></div><div id="nhOut"></div>' + (f.length ? '<div class="ls-notes">' + f.map((x) => '<article class="mr-card ls-n c-' + esc(x.color) + '"><input type="checkbox" data-nk="' + esc(x.key) + '"' + (N.pick[x.key] ? " checked" : "") + "><div><p>" + esc(x.text.slice(0, 500)) + "</p>" + (x.note ? "<small>✎ " + esc(x.note) + "</small>" : "") + '<a href="#" data-no="' + esc(x.doc) + '">' + (x.kind === "note" ? "📝 " : "🖍 ") + esc(x.title.slice(0, 50)) + "</a></div></article>").join("") + "</div>" : '<div class="ll-empty"><span>🗒</span><b>' + (items.length ? "맞는 항목이 없어요" : "아직 형광펜·노트가 없어요") + "</b><p>학습 자료를 읽으며 칠하고 적은 것이 모두 여기에 모여요.</p></div>") + "</main></div></div>";
    const qi = $("nhQ"); qi.addEventListener("input", () => { N.q = qi.value; clearTimeout(N.t); N.t = setTimeout(() => notePaint(a).then(() => { const x = $("nhQ"); x.focus(); x.setSelectionRange(x.value.length, x.value.length); }), 220); });
  }
  async function noteClick(e) {
    const t = e.target; let b; const a = $("hub_lx_notes");
    if ((b = t.closest("[data-nk]"))) { N.pick[b.dataset.nk] = b.checked; return; }
    if ((b = t.closest("[data-nd]"))) { N.doc = b.dataset.nd; notePaint(a); return; }
    if ((b = t.closest("[data-no]"))) { e.preventDefault(); navTo("library"); setTimeout(() => { if (window.libOpen) libOpen(b.dataset.no); }, 350); return; }
    if ((b = t.closest("[data-ns]"))) { const s = (G("lib.synth", []) || [])[+b.dataset.ns]; $("nhOut").innerHTML = '<section class="mr-card tk-md"><h3>' + esc(s.title) + "</h3>" + TK.md(s.md) + "</section>"; return; }
    if ((b = t.closest("[data-n]"))) {
      const pk = (N.items || []).filter((x) => N.pick[x.key]); if (!pk.length) return toast("항목을 먼저 고르세요");
      if (b.dataset.n === "syn") { const out = $("nhOut"); out.innerHTML = dots("묶는 중…"); try { const md = await TK.ai({ sys: "당신은 학습 노트 정리 전문가입니다. 주어진 메모에 있는 내용만 주제별로 묶고 연결합니다. 한국어로.", user: pk.map((x) => "[" + x.title + "] " + x.text + (x.note ? " (내 메모: " + x.note + ")" : "")).join("\n").slice(0, 16000) + "\n\n형식: ## 한 줄 요약 ## 주제별 정리 ## 자료들 사이의 연결 ## 아직 모르는 것(질문)", tokens: 1800 }, (f) => { out.innerHTML = '<section class="mr-card tk-md">' + TK.md(f) + "</section>"; }); const l = G("lib.synth", []) || []; l.unshift({ title: "종합 노트 " + new Date().toLocaleDateString("ko-KR"), md: md, t: Date.now() }); PS("lib.synth", l.slice(0, 30)); out.insertAdjacentHTML("afterbegin", '<p class="sh-muted">✓ 왼쪽 종합 노트에 저장했어요</p>'); } catch (er) { out.innerHTML = '<p class="lb-warn">' + esc(er.message) + "</p>"; } }
      if (b.dataset.n === "card") { toast("카드 만드는 중…", 6000); try { const r = await TK.aiJSON({ sys: "메모를 복습 카드로 바꿉니다. 메모에 있는 내용만. 한국어로.", user: pk.map((x) => "- " + x.text).join("\n").slice(0, 12000), shape: cardShape, tokens: 2400 }); const d = srs(); (r.cards || []).forEach((c) => d.cards.push({ id: uid(), doc: pk[0].doc, front: c.front, back: c.back, sec: c.sec, due: today(), ease: 2.5, reps: 0, ivl: 0 })); srsSave(d); toast((r.cards || []).length + "장을 복습 카드에 넣었어요"); } catch (er) { toast(er.message, 5000); } }
    }
  }

  /* ================================================================== ✍ 서술형 연습 */
  const W = { set: null, i: 0, t0: 0 };
  const wKey = "lib.write";
  async function writePaint(a) {
    a.onclick = writeClick; const h = G(wKey, []) || [];
    a.innerHTML = shell("wr", "✍ 서술형 연습", await picker("wrDoc"), '<button type="button" class="primary small-btn" data-w="gen">✨ 문제 만들기</button>') + '<div id="wrMain"></div></div>';
    $("wrDoc").addEventListener("change", (e) => setDoc(e.target.value));
    $("wrMain").innerHTML = W.set ? "" : (h.length ? '<section class="mr-card"><h4>최근 답안</h4><table class="rh-tbl"><thead><tr><th>문제</th><th>점수</th><th>시도</th></tr></thead><tbody>' + h.slice(0, 20).map((x, i) => '<tr data-wh="' + i + '"><td class="t">' + esc(x.q.slice(0, 70)) + "</td><td>" + x.score + "</td><td>" + (x.tries || 1) + "</td></tr>").join("") + "</tbody></table></section>" : '<div class="ll-empty"><span>✍</span><b>자료로 서술형 문제를 만들어 직접 써 봐요</b><p>기준별로 채점하고 어디가 빠졌는지 보여 줘요. 다시 쓰면 점수 변화도 보여요.</p></div>');
    if (W.set) wrQ();
  }
  async function wrGen() { const id = $("wrDoc").value; setDoc(id); const m = $("wrMain"); m.innerHTML = dots("문제 만드는 중…"); try { const t = await docText(id); const r = await TK.aiJSON({ sys: "당신은 시험 출제자입니다. 암기가 아니라 이해·설명·비교·적용을 묻는 서술형 문제를 냅니다. 자료에서 답할 수 있는 문제만. 한국어로.", user: "[자료: " + t.title + "]\n" + excerpt(t, 22000) + "\n\n서술형 4문제와 문제별 채점 기준(3~4개, 합 100점).", shape: '{"items":[{"q":"문제","minutes":5,"rubric":[{"c":"기준","w":30}]}]}', tokens: 1800 }); W.set = { doc: id, title: t.title, items: r.items || [] }; W.i = 0; W.prev = null; wrQ(); } catch (e) { m.innerHTML = '<p class="lb-warn">' + esc(e.message) + "</p>"; } }
  function wrQ() {
    const m = $("wrMain"), s = W.set, it = s.items[W.i]; if (!it) { W.set = null; writePaint($("hub_lx_write")); return; } W.t0 = Date.now();
    m.innerHTML = '<div class="ls-w"><section class="mr-card"><div class="dr-h"><small>' + (W.i + 1) + " / " + s.items.length + " · 권장 " + (it.minutes || 5) + '분</small><b id="wrT">0:00</b></div><h3>' + esc(it.q) + '</h3><div class="ls-rub">' + (it.rubric || []).map((r) => "<em>" + esc(r.c) + " " + r.w + "</em>").join("") + '</div><textarea id="wrA" rows="12" placeholder="자료를 보지 말고 내 말로 써 보세요.">' + esc(W.prev ? W.prev.a : "") + '</textarea><div class="lb-row"><span class="sh-muted" id="wrC">0자</span><span style="flex:1"></span><button type="button" class="ghost-btn small-btn" data-w="next">다음 문제</button><button type="button" class="primary small-btn" data-w="grade">채점</button></div></section><section id="wrFb"></section></div>';
    const ta = $("wrA"), cnt = () => { $("wrC").textContent = ta.value.replace(/\s/g, "").length + "자"; }; ta.addEventListener("input", cnt); cnt(); clearInterval(W.iv); W.iv = setInterval(() => { const el = $("wrT"); if (!el) return clearInterval(W.iv); const s2 = Math.floor((Date.now() - W.t0) / 1000); el.textContent = Math.floor(s2 / 60) + ":" + String(s2 % 60).padStart(2, "0"); }, 1000);
  }
  async function wrGrade() {
    const s = W.set, it = s.items[W.i], ans = $("wrA").value.trim(); if (ans.length < 10) return toast("조금 더 써 보세요"); const fb = $("wrFb"); fb.innerHTML = dots("채점 중…");
    try {
      const t = await docText(s.doc); const r = await TK.aiJSON({ sys: "당신은 공정한 채점자입니다. 자료를 정답 근거로, 기준별로 채점하고 무엇이 빠졌는지 구체적으로 짚습니다. 한국어로.", user: "[자료 발췌]\n" + excerpt(t, 16000) + "\n\n[문제] " + it.q + "\n[기준] " + JSON.stringify(it.rubric) + "\n[답안]\n" + ans, shape: '{"rows":[{"c":"기준","got":0,"w":30,"why":"이유"}],"miss":["빠진 핵심"],"wrong":["틀린 내용"],"model":"모범 답안"}', tokens: 1600 });
      const score = (r.rows || []).reduce((a, x) => a + (+x.got || 0), 0), prev = W.prev; W.prev = { a: ans, score: score };
      fb.innerHTML = '<section class="mr-card"><div class="ls-sc"><b>' + score + "</b><small>/ 100</small>" + (prev ? '<em class="' + (score >= prev.score ? "up" : "down") + '">지난번 ' + prev.score + " → " + (score >= prev.score ? "+" : "") + (score - prev.score) + "</em>" : "") + "</div>" + (r.rows || []).map((x) => '<div class="mr-row ls-rr"><span>' + esc(x.c) + '</span><div class="mr-range"><i style="left:0;width:' + Math.round((+x.got || 0) / (+x.w || 1) * 100) + '%"></i></div><b>' + (+x.got || 0) + "/" + x.w + "</b></div><p class=\"ls-why\">" + esc(x.why || "") + "</p>").join("") + ((r.miss || []).length ? "<h4>빠진 핵심</h4><ul>" + r.miss.map((x) => "<li>" + esc(x) + "</li>").join("") + "</ul>" : "") + ((r.wrong || []).length ? "<h4>틀린 내용</h4><ul>" + r.wrong.map((x) => "<li>" + esc(x) + "</li>").join("") + "</ul>" : "") + '<details><summary>모범 답안 보기</summary><p>' + esc(r.model || "") + '</p></details><div class="lb-row"><span class="sh-muted">고쳐 쓰고 다시 채점하면 변화를 보여 줘요.</span></div></section>';
      const h = G(wKey, []) || []; const i = h.findIndex((x) => x.q === it.q); if (i >= 0) { h[i].score = score; h[i].tries = (h[i].tries || 1) + 1; } else h.unshift({ q: it.q, score: score, tries: 1, doc: s.doc, t: Date.now() }); PS(wKey, h.slice(0, 60));
    } catch (e) { fb.innerHTML = '<p class="lb-warn">' + esc(e.message) + "</p>"; }
  }
  function writeClick(e) { const b = e.target.closest("[data-w]"); if (!b) return; const k = b.dataset.w; if (k === "gen") wrGen(); if (k === "grade") wrGrade(); if (k === "next") { W.i++; W.prev = null; wrQ(); } }

  /* ================================================================== 💬 대화·말하기 */
  const PERS = [["socrates", "🏛", "소크라테스 튜터", "답을 주지 말고 질문으로 이끕니다. 한 번에 질문 하나."], ["author", "✒", "저자", "이 자료를 쓴 저자처럼 왜 이렇게 썼는지 설명합니다."], ["prof", "🎓", "깐깐한 교수", "구술시험처럼 묻고 답의 빈틈을 파고듭니다. 틀리면 짧게 바로잡습니다."], ["feyn", "🧒", "학생에게 설명(파인만)", "당신은 호기심 많은 중학생입니다. 사용자가 설명하면 이해 안 되는 곳을 쉬운 말로 되묻습니다."], ["debate", "⚖", "토론 상대", "사용자 주장에 근거를 들어 반대합니다. 자료 내용을 근거로 씁니다."]];
  const C = { per: G("ls.per", "socrates"), msgs: [], busy: false, voice: false, doc: "" };
  async function chatPaint(a) {
    a.onclick = chatClick;
    a.innerHTML = shell("ct", "💬 대화·말하기", await picker("ctDoc"), '<span class="ss-acts"><label class="ls-v"><input type="checkbox" id="ctV"' + (C.voice ? " checked" : "") + '> 🔊 답 읽어 주기</label><button type="button" class="ghost-btn small-btn" data-t="end">📊 끝내고 평가</button><button type="button" class="ghost-btn small-btn" data-t="clear">새 대화</button></span>') + '<div class="ls-ct"><aside class="mr-panel ls-per">' + PERS.map((p) => '<button type="button" class="' + (C.per === p[0] ? "on" : "") + '" data-per="' + p[0] + '"><i>' + p[1] + "</i><b>" + p[2] + "</b><small>" + p[3] + '</small></button>').join("") + '</aside><section class="mr-card ls-chat"><div class="pp-ail" id="ctL"></div><div class="pp-aiin"><textarea id="ctQ" rows="2" placeholder="말을 걸어 보세요 (Enter 보내기)"></textarea><button type="button" class="ghost-btn small-btn" data-t="mic" id="ctMic">🎙</button><button type="button" class="primary" data-t="send" aria-label="보내기">↑</button></div></section></div></div>';
    $("ctDoc").addEventListener("change", (e) => { setDoc(e.target.value); C.msgs = []; ctMsgs(); }); $("ctV").addEventListener("change", (e) => { C.voice = e.target.checked; }); const q = $("ctQ"); q.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); const v = q.value.trim(); if (v) { q.value = ""; ctSend(v); } } }); ctMsgs();
  }
  function ctMsgs() { const el = $("ctL"); if (!el) return; el.innerHTML = C.msgs.length ? C.msgs.map((m) => (m.role === "user" ? '<div class="pp-m u"><div>' + esc(m.text) + "</div></div>" : '<div class="pp-m a"><div class="pp-mb2">' + TK.md(m.text || "…") + "</div></div>")).join("") : '<div class="pp-aiempty"><span>💬</span><b>왼쪽에서 상대를 고르고 대화를 시작하세요</b><p>자료 내용을 근거로 답해요. 🎙 로 말할 수 있고, 끝내면 이해도를 평가해 약한 곳을 복습 카드로 넣어 줘요.</p></div>'; el.scrollTop = el.scrollHeight; }
  async function ctSend(text) {
    if (C.busy) return; const g = await gateAction({ action: "tools", cost: 1 }); if (!g.ok) return toast(gateMessage(g), 5000); const id = $("ctDoc").value; C.busy = true; C.msgs.push({ role: "user", text: text }); const am = { role: "ai", text: "" }; C.msgs.push(am); ctMsgs();
    try { const t = await docText(id), p = PERS.find((x) => x[0] === C.per); const acc = await llmStreamChat([{ role: "system", content: sysLib + " 역할: " + p[2] + " — " + p[3] + " 답은 짧게(말로 주고받는 길이).\n\n[자료: " + t.title + "]\n" + excerpt(t, 18000) }].concat(C.msgs.slice(0, -1).slice(-12).map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.text }))), (d, f) => { am.text = f; clearTimeout(C.t); C.t = setTimeout(ctMsgs, 50); }, { temperature: 0.5, maxTokens: 900 }); am.text = String(acc || am.text); ctMsgs(); if (C.voice) TOOLSETS.X2.speak(am.text.replace(/[*#`]/g, "")); } catch (e) { am.text = "⚠ " + e.message; ctMsgs(); }
    C.busy = false;
  }
  async function ctEnd() {
    if (C.msgs.length < 4) return toast("대화를 조금 더 나눈 뒤 평가할 수 있어요"); const el = $("ctL"); const id = $("ctDoc").value; el.insertAdjacentHTML("beforeend", dots("평가 중…")); el.scrollTop = el.scrollHeight;
    try { const r = await TK.aiJSON({ sys: "학습자의 대화를 보고 이해도를 평가합니다. 학습자의 말만 평가하고, 한국어로.", user: C.msgs.map((m) => (m.role === "user" ? "학습자: " : "상대: ") + m.text).join("\n").slice(0, 12000), shape: '{"score":0~100,"good":["잘 이해한 것"],"gap":["약한 것"],"cards":[{"front":"","back":""}]}', tokens: 1200 }); const d = srs(); (r.cards || []).forEach((c) => d.cards.push({ id: uid(), doc: id, front: c.front, back: c.back, due: today(), ease: 2.5, reps: 0, ivl: 0 })); srsSave(d); C.msgs.push({ role: "ai", text: "## 이해도 " + (+r.score || 0) + "점\n**잘 이해한 것**\n" + (r.good || []).map((x) => "- " + x).join("\n") + "\n\n**약한 것**\n" + (r.gap || []).map((x) => "- " + x).join("\n") + "\n\n🧠 약한 곳 카드 " + (r.cards || []).length + "장을 복습 카드에 넣었어요." }); ctMsgs(); } catch (e) { toast(e.message, 5000); ctMsgs(); }
  }
  function chatClick(e) {
    let b; const t = e.target;
    if ((b = t.closest("[data-per]"))) { C.per = b.dataset.per; PS("ls.per", C.per); document.querySelectorAll("[data-per]").forEach((x) => x.classList.toggle("on", x === b)); return; }
    if ((b = t.closest("[data-t]"))) { const k = b.dataset.t; if (k === "send") { const q = $("ctQ"), v = q.value.trim(); if (v) { q.value = ""; ctSend(v); } } if (k === "clear") { C.msgs = []; ctMsgs(); } if (k === "end") ctEnd(); if (k === "mic") { const q = $("ctQ"); if (C.rec) { C.rec.stop(); C.rec = null; b.textContent = "🎙"; const v = q.value.trim(); if (v) { q.value = ""; ctSend(v); } return; } const r = TOOLSETS.X2.stt((f, i) => { q.value = f + (i || ""); }); if (!r) return toast("이 브라우저는 음성 입력을 못 써요"); C.rec = r; r.start(); b.textContent = "⏹"; } }
  }

  /* ================================================================== 🗺 개념 지도 */
  const L = { tab: "map", sel: null };
  const mapKey = (id) => "lib.cmap." + id;
  async function labPaint(a) {
    a.onclick = labClick; const id = curDoc();
    a.innerHTML = shell("lb2", "🗺 개념 지도", await picker("lbDoc"), '<nav class="ll-tabs">' + [["map", "지도"], ["time", "연표"], ["cmp", "비교표"], ["gloss", "용어집"]].map((t) => '<button type="button" data-lt2="' + t[0] + '" class="' + (L.tab === t[0] ? "on" : "") + '">' + t[1] + "</button>").join("") + '</nav><button type="button" class="primary small-btn" data-l="gen">✨ 이 자료로 만들기</button>') + '<div id="lbMain"></div></div>';
    $("lbDoc").addEventListener("change", (e) => { setDoc(e.target.value); L.sel = null; labMain(); }); labMain();
  }
  function labMain() {
    const m = $("lbMain"), d = G(mapKey($("lbDoc").value), null); if (!m) return; document.querySelectorAll("[data-lt2]").forEach((b) => b.classList.toggle("on", b.dataset.lt2 === L.tab));
    if (!d) { m.innerHTML = '<div class="ll-empty"><span>🗺</span><b>자료 한 편을 지도·연표·비교표·용어집으로 정리해요</b><p>✨ 이 자료로 만들기를 누르세요. 만든 뒤에는 저장돼서 다시 쓸 수 있어요.</p></div>'; return; }
    if (L.tab === "map") { m.innerHTML = '<div class="ls-map"><svg id="lbSvg" class="ls-svg"></svg><aside class="mr-card" id="lbDef"></aside></div>'; drawMap(d); return; }
    if (L.tab === "time") { const t = (d.timeline || []).slice().sort((x, y) => String(x.when).localeCompare(String(y.when), "ko", { numeric: true })); m.innerHTML = t.length ? '<div class="ls-tl">' + t.map((x) => "<div><b>" + esc(x.when) + "</b><span>" + esc(x.what) + "</span></div>").join("") + "</div>" : '<p class="sh-muted">이 자료에는 시간 순서가 뚜렷하지 않아요.</p>'; return; }
    if (L.tab === "cmp") { const c = d.compare || {}; m.innerHTML = (c.cols || []).length ? '<div class="ll-mxw"><table class="ll-mx"><thead><tr><th></th>' + c.cols.map((x) => "<th>" + esc(x) + "</th>").join("") + "</tr></thead><tbody>" + (c.rows || []).map((r) => "<tr><th><b>" + esc(r.name) + "</b></th>" + (r.cells || []).map((x) => "<td>" + esc(x) + "</td>").join("") + "</tr>").join("") + "</tbody></table></div>" : '<p class="sh-muted">비교할 대상이 뚜렷하지 않아요.</p>'; return; }
    m.innerHTML = '<div class="ls-gl">' + (d.nodes || []).map((n) => "<div class=\"mr-card\"><b>" + esc(n.id) + "</b><p>" + esc(n.def || "") + "</p></div>").join("") + "</div>";
  }
  function drawMap(d) {
    const svg = $("lbSvg"), W = svg.clientWidth || 900, H = svg.clientHeight || 560, N2 = (d.nodes || []).slice(0, 40), ix = {}; N2.forEach((n, i) => { ix[n.id] = i; }); const E = (d.edges || []).filter((e) => ix[e.a] != null && ix[e.b] != null), Ps = d.pos && d.pos.length === N2.length ? d.pos : N2.map((n, i) => ({ x: W / 2 + Math.cos(i * 2.4) * (50 + i * 12), y: H / 2 + Math.sin(i * 2.4) * (40 + i * 9) }));
    if (!d.pos) { for (let t = 0; t < 300; t++) { const v = Ps.map(() => ({ x: 0, y: 0 })); for (let i = 0; i < N2.length; i++) for (let j = i + 1; j < N2.length; j++) { const dx = Ps[i].x - Ps[j].x, dy = Ps[i].y - Ps[j].y, q = Math.sqrt(dx * dx + dy * dy) + 0.1, f = 16000 / (q * q); v[i].x += dx / q * f; v[i].y += dy / q * f; v[j].x -= dx / q * f; v[j].y -= dy / q * f; } E.forEach((e) => { const a = ix[e.a], b = ix[e.b], dx = Ps[b].x - Ps[a].x, dy = Ps[b].y - Ps[a].y; v[a].x += dx * 0.02; v[a].y += dy * 0.02; v[b].x -= dx * 0.02; v[b].y -= dy * 0.02; }); Ps.forEach((p, i) => { p.x = Math.max(60, Math.min(W - 60, p.x + (v[i].x + (W / 2 - p.x) * 0.02) * 0.4)); p.y = Math.max(24, Math.min(H - 24, p.y + (v[i].y + (H / 2 - p.y) * 0.03) * 0.4)); }); } }
    const draw = () => { svg.setAttribute("viewBox", "0 0 " + W + " " + H); svg.innerHTML = E.map((e) => { const a = Ps[ix[e.a]], b = Ps[ix[e.b]]; return '<line x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '" stroke="#cbd5e1" stroke-width="1.4"/><text x="' + (a.x + b.x) / 2 + '" y="' + ((a.y + b.y) / 2 - 3) + '" text-anchor="middle" font-size="10" fill="#64748b">' + esc(e.t || "") + "</text>"; }).join("") + N2.map((n, i) => { const w = 22 + String(n.id).length * 12.5, core = n.level === 1; return '<g data-ni="' + i + '" class="ls-node"><rect x="' + (Ps[i].x - w / 2) + '" y="' + (Ps[i].y - 15) + '" width="' + w + '" height="30" rx="15" fill="' + (L.sel === i ? "#7c3aed" : core ? "#1d4ed8" : "#fff") + '" stroke="#1d4ed8" stroke-width="1.5"/><text x="' + Ps[i].x + '" y="' + (Ps[i].y + 4.5) + '" text-anchor="middle" font-size="12.5" font-weight="700" fill="' + (core || L.sel === i ? "#fff" : "#1e3a8a") + '">' + esc(n.id) + "</text></g>"; }).join(""); };
    draw(); const def = (i) => { const n = N2[i], el = $("lbDef"); if (!el) return; el.innerHTML = n ? "<h4>" + esc(n.id) + "</h4><p>" + esc(n.def || "") + "</p><h4>연결</h4><ul>" + E.filter((e) => e.a === n.id || e.b === n.id).map((e) => "<li>" + esc(e.a) + " — " + esc(e.t || "") + " → " + esc(e.b) + "</li>").join("") + "</ul>" : '<p class="sh-muted">개념을 누르면 뜻과 연결이 보여요. 끌어서 옮길 수 있어요.</p>'; }; def(L.sel);
    let drag = -1, moved = false; const pos = (e) => { const r = svg.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H }; };
    svg.onpointerdown = (e) => { const g = e.target.closest("[data-ni]"); if (!g) return; drag = +g.dataset.ni; moved = false; svg.setPointerCapture(e.pointerId); };
    svg.onpointermove = (e) => { if (drag < 0) return; const p = pos(e); Ps[drag].x = p.x; Ps[drag].y = p.y; moved = true; draw(); };
    svg.onpointerup = () => { if (drag < 0) return; if (moved) { d.pos = Ps; PS(mapKey($("lbDoc").value), d); } else { L.sel = drag; draw(); def(drag); } drag = -1; };
  }
  async function labGen() { const id = $("lbDoc").value, m = $("lbMain"); setDoc(id); m.innerHTML = dots("자료를 읽고 정리하는 중…"); try { const t = await docText(id); const r = await TK.aiJSON({ sys: "당신은 지식 구조화 전문가입니다. 자료에 있는 내용만, 한국어로. 개념 이름은 10자 이내.", user: "[자료: " + t.title + "]\n" + excerpt(t, 26000), shape: '{"nodes":[{"id":"개념","def":"한두 문장 뜻","level":1}],"edges":[{"a":"개념","b":"개념","t":"관계 동사"}],"timeline":[{"when":"","what":""}],"compare":{"cols":["관점"],"rows":[{"name":"대상","cells":["내용"]}]}}', tokens: 3600 }); PS(mapKey(id), r); L.sel = null; labMain(); } catch (e) { m.innerHTML = '<p class="lb-warn">' + esc(e.message) + "</p>"; } }
  function labClick(e) { let b; if ((b = e.target.closest("[data-lt2]"))) { L.tab = b.dataset.lt2; labMain(); return; } if ((b = e.target.closest("[data-l]"))) labGen(); }

  /* ================================================================== 🗓 학습 계획 */
  const PK = "lib.plan"; const Q = { set: null, a: {} };
  async function planPaint(a) {
    a.onclick = planClick; const p = G(PK, null), t = today(), l = await docs(); const due = srs().cards.filter((c) => (c.due || t) <= t).length;
    a.innerHTML = shell("pl", "🗓 학습 계획", '<span class="ll-cnt">오늘 복습 카드 ' + due + "장</span>") + '<div id="plMain"></div></div>'; const m = $("plMain");
    if (!p) { m.innerHTML = '<section class="mr-card ls-plnew"><h3>계획 세우기</h3><label class="ss-f">목표<input id="plGoal" placeholder="예: AI 파노라마 1~5장 끝내기"></label><div class="ss-r"><label class="ss-f">시험·마감일<input id="plEnd" type="date" value="' + addDays(t, 21) + '"></label><label class="ss-f">하루 시간(분)<input id="plMin" type="number" value="60" min="15" step="15"></label></div><div class="ls-pick">' + l.filter((d) => !d.legacy).concat(l.filter((d) => d.legacy)).slice(0, 60).map((d) => '<label><input type="checkbox" data-pd="' + esc(d.id) + '"> ' + esc(d.title) + "</label>").join("") + '</div><button type="button" class="primary mr-go" data-p="make">계획 만들기</button></section>'; return; }
    const by = {}; p.tasks.forEach((x) => { (by[x.day] = by[x.day] || []).push(x); }); const done = p.tasks.filter((x) => x.done).length, late = p.tasks.filter((x) => !x.done && x.day < t).length, days = []; for (let d = p.start; d <= p.end; d = addDays(d, 1)) days.push(d); const first = new Date(p.start + "T00:00:00Z").getUTCDay();
    m.innerHTML = '<section class="mr-card ls-plh"><div><h3>' + esc(p.goal) + '</h3><div class="ls-pg"><i style="width:' + Math.round(done / (p.tasks.length || 1) * 100) + '%"></i></div><small>' + done + " / " + p.tasks.length + " · D-" + Math.max(0, Math.round((new Date(p.end) - new Date(t)) / 864e5)) + (late ? ' · <b class="bad">밀린 일 ' + late + "</b>" : "") + '</small></div><div class="ss-acts">' + (late ? '<button type="button" class="ghost-btn small-btn" data-p="shift">밀린 일 다시 배치</button>' : "") + '<button type="button" class="primary small-btn" data-p="quiz">📝 모의 시험</button><button type="button" class="ghost-btn small-btn" data-p="reset">계획 지우기</button></div></section><div id="plQuiz"></div><div class="ls-cal">' + ["일", "월", "화", "수", "목", "금", "토"].map((x) => "<b>" + x + "</b>").join("") + "<i></i>".repeat(first) + days.map((d) => '<div class="' + (d === t ? "now" : d < t ? "past" : "") + '"><small>' + +d.slice(8) + "</small>" + (by[d] || []).map((x) => '<label class="' + (x.done ? "done" : "") + '" title="' + esc(x.doc) + '"><input type="checkbox" data-pt="' + x.id + '"' + (x.done ? " checked" : "") + "> " + esc(x.sec.slice(0, 26)) + "</label>").join("") + (d === p.end ? "<em>시험</em>" : "") + "</div>").join("") + "</div>";
  }
  async function planMake() {
    const ids = Array.from(document.querySelectorAll("[data-pd]:checked")).map((x) => x.dataset.pd), end = $("plEnd").value, min = +$("plMin").value || 60, t = today(); if (!ids.length) return toast("자료를 고르세요"); if (!end || end <= t) return toast("마감일을 오늘 뒤로 정하세요"); toast("계획 짜는 중…", 5000);
    try {
      const secs = []; for (const id of ids) { const x = await docText(id); x.secs.forEach((s) => secs.push({ doc: x.title, id: id, sec: s.h, mins: Math.max(5, Math.round(s.t.length / 500)) })); }
      const days = Math.round((new Date(end) - new Date(t)) / 864e5), study = Math.max(1, days - 1), tot = secs.reduce((a, s) => a + s.mins, 0), per = Math.max(min, Math.ceil(tot / study)); let d = 0, used = 0; const tasks = secs.map((s) => { if (used + s.mins > per && used > 0 && d < study - 1) { d++; used = 0; } used += s.mins; return { id: uid(), day: addDays(t, d), doc: s.doc, did: s.id, sec: s.sec, done: false }; });
      PS(PK, { goal: $("plGoal").value.trim() || "학습 계획", start: t, end: end, min: min, tasks: tasks, docs: ids }); if (per > min) toast("하루 " + per + "분이 필요해요 — 정한 시간보다 많아요", 6000); planPaint($("hub_lx_plan"));
    } catch (e) { toast(e.message, 5000); }
  }
  async function quiz() {
    const p = G(PK, null), box = $("plQuiz"); box.innerHTML = dots("문제 만드는 중…");
    try { const done = p.tasks.filter((x) => x.done); const ids = p.docs; const txt = []; for (const id of ids.slice(0, 4)) { const x = await docText(id); txt.push(excerpt(x, Math.floor(20000 / Math.min(4, ids.length)))); } const r = await TK.aiJSON({ sys: "당신은 시험 출제자입니다. 자료에서 답할 수 있는 4지선다를 냅니다. 한국어로.", user: txt.join("\n\n") + "\n\n" + (done.length ? "지금까지 끝낸 절 위주: " + done.slice(-15).map((x) => x.sec).join(", ") + "\n" : "") + "문제 8개.", shape: '{"qs":[{"q":"","opts":["","","",""],"a":0,"why":"해설","sec":"절"}]}', tokens: 2600 }); Q.set = r.qs || []; Q.a = {}; quizPaint(); } catch (e) { box.innerHTML = '<p class="lb-warn">' + esc(e.message) + "</p>"; }
  }
  function quizPaint(graded) {
    const box = $("plQuiz"), s = Q.set; let right = 0; const body = s.map((q, i) => { const pick = Q.a[i]; if (pick === q.a) right++; return '<div class="ls-q"><b>' + (i + 1) + ". " + esc(q.q) + "</b>" + q.opts.map((o, j) => '<label class="' + (graded ? (j === q.a ? "ok" : pick === j ? "no" : "") : "") + '"><input type="radio" name="q' + i + '" data-qa="' + i + "|" + j + '"' + (pick === j ? " checked" : "") + (graded ? " disabled" : "") + "> " + esc(o) + "</label>").join("") + (graded ? "<small>" + esc(q.why || "") + "</small>" : "") + "</div>"; }).join("");
    box.innerHTML = '<section class="mr-card">' + (graded ? '<div class="ls-sc"><b>' + Math.round(right / s.length * 100) + "</b><small>점 · " + right + "/" + s.length + '</small><button type="button" class="ghost-btn small-btn" data-p="wrong">틀린 문제 카드로</button></div>' : "") + body + (graded ? "" : '<button type="button" class="primary small-btn" data-p="sub">채점</button>') + "</section>";
  }
  function planClick(e) {
    const t = e.target, a = $("hub_lx_plan"); let b;
    if ((b = t.closest("[data-pt]"))) { const p = G(PK, null); const x = p.tasks.find((y) => y.id === b.dataset.pt); x.done = b.checked; PS(PK, p); planPaint(a); return; }
    if ((b = t.closest("[data-qa]"))) { const [i, j] = b.dataset.qa.split("|"); Q.a[i] = +j; return; }
    if ((b = t.closest("[data-p]"))) { const k = b.dataset.p; if (k === "make") planMake(); if (k === "quiz") quiz(); if (k === "sub") quizPaint(true); if (k === "reset" && confirm("계획을 지울까요?")) { PS(PK, null); planPaint(a); } if (k === "shift") { const p = G(PK, null), tt = today(), late = p.tasks.filter((x) => !x.done && x.day < tt), n = Math.max(1, Math.round((new Date(p.end) - new Date(tt)) / 864e5)); late.forEach((x, i) => { x.day = addDays(tt, Math.floor(i / Math.max(1, Math.ceil(late.length / n)))); }); PS(PK, p); planPaint(a); toast(late.length + "개를 다시 배치했어요"); } if (k === "wrong") { const d = srs(); let n = 0; Q.set.forEach((q, i) => { if (Q.a[i] !== q.a) { d.cards.push({ id: uid(), doc: (G(PK, {}).docs || [""])[0], front: q.q, back: q.opts[q.a] + (q.why ? " — " + q.why : ""), sec: q.sec, due: today(), ease: 2.5, reps: 0, ivl: 0 }); n++; } }); srsSave(d); toast(n + "장을 복습 카드에 넣었어요"); } }
  }

  function build() {
    const content = document.querySelector("main.content"); if (!content || typeof EXT_VIEWS === "undefined") return;
    [["lx_memory", memPaint], ["lx_notes", notePaint], ["lx_write", writePaint], ["lx_chat", chatPaint], ["lx_lab", labPaint], ["lx_plan", planPaint]].forEach(([k, fn]) => { let a = $("hub_" + k); if (!a) { a = document.createElement("section"); a.id = "hub_" + k; a.className = "hidden"; content.appendChild(a); } EXT_VIEWS[k] = { area: a, open: () => fn(a).catch((er) => { a.innerHTML = '<p class="lb-warn">' + esc(er.message) + "</p>"; }) }; });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(build, 0)); else setTimeout(build, 30);
  window.LIBSTUDIO = { schedule: schedule, srs: srs };
})();
