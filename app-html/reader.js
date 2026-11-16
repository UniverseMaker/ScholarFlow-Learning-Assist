(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => escapeHtml(String(s == null ? "" : s));
  const R = { open: null, quiz: null, ans: {}, speaking: false, t0: 0, docId: "" };
  let dock = null;

  function aiOn() { try { return !Api.llm.isConnected || Api.llm.isConnected(); } catch (e) { return false; } }
  function doc() { try { return lb.frame && lb.frame.contentDocument; } catch (e) { return null; } }
  function docId() { try { return libState.docId || ""; } catch (e) { return ""; } }
  function visible() { try { return lb.viewer && !lb.viewer.classList.contains("hidden") && lb.area && !lb.area.classList.contains("hidden"); } catch (e) { return false; } }
  function section() {
    const d = doc(); if (!d || !d.body) return { title: "", text: "" };
    const hs = Array.from(d.querySelectorAll("main h1, main h2, main h3, article h1, article h2, article h3, h1, h2, h3")).filter((h) => h.offsetParent !== null);
    let cur = null;
    for (const h of hs) { if (h.getBoundingClientRect().top <= 120) cur = h; else break; }
    if (!cur && hs.length) cur = hs[0];
    if (cur) {
      const lv = +cur.tagName.slice(1); let t = "", n = cur.nextElementSibling, guard = 0;
      while (n && guard++ < 400) { if (/^H[1-3]$/.test(n.tagName) && +n.tagName.slice(1) <= lv) break; t += " " + (n.innerText || ""); n = n.nextElementSibling; }
      if (t.trim().length > 80) return { title: cur.innerText.trim(), text: t.replace(/\s+/g, " ").trim().slice(0, 6000) };
    }
    // 제목 구조가 없으면 화면에 보이는 문단
    const ps = Array.from(d.querySelectorAll("p, li, td, blockquote")).filter((p) => { const r = p.getBoundingClientRect(); return r.bottom > 0 && r.top < (lb.frame.clientHeight || 800); });
    return { title: (d.title || "").trim(), text: ps.map((p) => p.innerText).join(" ").replace(/\s+/g, " ").trim().slice(0, 6000) };
  }
  function selText() { try { const d = doc(); const s = d && d.defaultView.getSelection(); return s ? String(s).trim() : ""; } catch (e) { return ""; } }

  /* ---- 막대 ---- */
  function build() {
    if (dock || !lb || !lb.viewer) return;
    dock = document.createElement("div");
    dock.className = "rm-dock hidden"; dock.id = "rmDock";
    dock.innerHTML = '<div class="rm-pop hidden" id="rmPop"><div class="rm-pop-h"><b id="rmPopT"></b><button type="button" class="ask-icon" data-rm="close" aria-label="닫기">✕</button></div><div class="rm-pop-b" id="rmPopB"></div></div>' +
      '<div class="rm-bar"><span class="rm-brand">✨ 리딩 메이트</span>' +
      [["sum", "📝", "이 부분 요약"], ["quiz", "❓", "이 부분 퀴즈"], ["tts", "🔊", "읽어 주기"], ["hl", "🖍", "형광펜"], ["focus", "🎯", "집중 모드"]].map((b) => '<button type="button" class="rm-b" data-rm="' + b[0] + '" title="' + b[2] + '"><span>' + b[1] + "</span><em>" + b[2] + "</em></button>").join("") +
      '<span class="rm-time" id="rmTime" title="이 문서를 읽은 시간">⏱ 0분</span></div>';
    (lb.viewer.querySelector(".lib2-pane") || lb.viewer).appendChild(dock);
  }
  function pop(title, html) {
    const p = $("rmPop"); if (!p) return;
    $("rmPopT").textContent = title; $("rmPopB").innerHTML = html; p.classList.remove("hidden");
  }
  const loading = (t) => '<div class="lb-loading"><span class="lb-dots"><i></i><i></i><i></i></span>' + esc(t) + "</div>";
  async function ai(user, sys, tokens) {
    const g = await gateAction({ action: "reader", cost: 1 }); if (!g.ok) throw new Error(gateMessage(g));
    const o = await llmGenerate({ messages: [{ role: "system", content: (sys || "당신은 학습 자료를 함께 읽는 튜터입니다(한국어).") + " 반드시 유효한 JSON 하나만." }, { role: "user", content: user }], temperature: 0.3, maxTokens: tokens || 1200 });
    if (!o || typeof o !== "object") throw new Error("AI 응답을 읽지 못했어요.");
    return o;
  }

  async function summarize() {
    const s = section(); if (!s.text) { pop("📝 이 부분 요약", '<p class="sh-muted">요약할 본문을 찾지 못했어요.</p>'); return; }
    pop("📝 " + (s.title || "이 부분") + " — 요약", loading("읽고 요약하는 중…"));
    if (!aiOn()) { const sents = s.text.match(/[^.!?。]+[.!?。]/g) || [s.text]; pop("📝 " + (s.title || "이 부분") + " — 요약(앞 문장)", "<ul>" + sents.slice(0, 3).map((x) => "<li>" + esc(x.trim()) + "</li>").join("") + '</ul><p class="sh-muted">AI 를 연결하면 핵심만 뽑아 3줄로 요약해요.</p>'); return; }
    try {
      const o = await ai("제목: " + s.title + "\n본문:\n" + s.text + '\n\n이 부분을 학습자가 기억하기 좋게 요약하세요.\nJSON: {"one_line":"한 줄 요지","points":["핵심 3개"],"terms":[{"term":"핵심 용어","meaning":"쉬운 뜻"}],"check":"이해 확인 질문 1개"}');
      pop("📝 " + (s.title || "이 부분") + " — 요약", '<p class="rm-one">' + esc(o.one_line || "") + "</p><ul>" + (o.points || []).map((x) => "<li>" + esc(x) + "</li>").join("") + "</ul>" +
        ((o.terms || []).length ? '<div class="rm-terms">' + o.terms.map((t) => '<span class="sh-chip"><b>' + esc(t.term) + "</b> " + esc(t.meaning) + "</span>").join("") + "</div>" : "") +
        (o.check ? '<p class="xr-tip">🤔 ' + esc(o.check) + "</p>" : "") + '<div class="lb-row"><button type="button" class="ghost-btn small-btn" data-rm="quiz">이 부분으로 퀴즈 →</button></div>');
    } catch (e) { pop("📝 요약", '<p class="lb-err">' + esc(e.message) + "</p>"); }
  }
  async function quiz() {
    const s = section(); if (!s.text) { pop("❓ 퀴즈", '<p class="sh-muted">퀴즈를 만들 본문을 찾지 못했어요.</p>'); return; }
    if (!aiOn()) { pop("❓ " + (s.title || "이 부분") + " — 퀴즈", '<p class="sh-muted">AI 를 연결하면 지금 읽는 부분으로 확인 문제 3개를 바로 만들어요(읽은 직후 떠올리기 = 오래 기억).</p>'); return; }
    pop("❓ " + (s.title || "이 부분") + " — 퀴즈", loading("문제를 만드는 중…"));
    try {
      const o = await ai("제목: " + s.title + "\n본문:\n" + s.text + '\n\n본문 내용으로만 답할 수 있는 4지선다 3문항(이해·적용 위주, 함정 보기 포함).\nJSON: {"items":[{"q":"","choices":["","","",""],"answer":"A|B|C|D","why":"본문 근거를 인용한 해설"}]}', "당신은 학습 자료로 확인 문제를 내는 출제자입니다(문제 언어는 본문 언어를 따름).", 1500);
      R.quiz = (o.items || []).filter((x) => x && x.q && (x.choices || []).length === 4).slice(0, 3); R.ans = {}; R.qTitle = s.title;
      quizRender();
    } catch (e) { pop("❓ 퀴즈", '<p class="lb-err">' + esc(e.message) + "</p>"); }
  }
  function quizRender() {
    const ok = R.quiz.filter((x, i) => R.ans[i] === x.answer).length, done = Object.keys(R.ans).length;
    pop("❓ " + (R.qTitle || "이 부분") + " — 퀴즈", R.quiz.map((x, i) => { const a = R.ans[i]; return '<div class="rm-q"><p><b>' + (i + 1) + ".</b> " + esc(x.q) + '</p><div class="lb-ch">' + x.choices.map((c, ci) => { const k = "ABCD"[ci]; return '<button type="button" class="lb-c' + (a ? (k === x.answer ? " ok" : k === a ? " no" : "") : "") + '" data-rm-a="' + i + "|" + k + '"' + (a ? " disabled" : "") + "><b>" + k + "</b>" + esc(c) + "</button>"; }).join("") + "</div>" + (a ? '<p class="sh-muted">' + esc(x.why || "") + "</p>" : "") + "</div>"; }).join("") +
      (done === R.quiz.length && R.quiz.length ? '<p class="xr-tip">' + ok + " / " + R.quiz.length + (ok === R.quiz.length ? " — 완벽해요!" : " — 틀린 부분을 다시 읽어 보세요.") + "</p>" : ""));
  }
  function tts() {
    if (!window.speechSynthesis) { pop("🔊 읽어 주기", '<p class="sh-muted">이 브라우저는 음성 합성을 지원하지 않아요.</p>'); return; }
    if (R.speaking) { speechSynthesis.cancel(); R.speaking = false; paint(); return; }
    const t = selText() || section().text; if (!t) return;
    const chunks = (t.match(/[^.!?。]+[.!?。]?/g) || [t]).map((x) => x.trim()).filter(Boolean).slice(0, 80);
    speechSynthesis.cancel(); R.speaking = true; paint();
    chunks.forEach((c, i) => {
      const ko = /[가-힣]/.test(c);
      const u = new SpeechSynthesisUtterance(c); u.lang = ko ? "ko-KR" : "en-US"; u.rate = ko ? 1.05 : 0.95;
      const v = speechSynthesis.getVoices().filter((x) => (x.lang || "").toLowerCase().indexOf(ko ? "ko" : "en") === 0)[0]; if (v) u.voice = v;
      if (i === chunks.length - 1) u.onend = () => { R.speaking = false; paint(); };
      speechSynthesis.speak(u);
    });
  }
  /* 형광펜 */
  const hlKey = () => "study.reader.hl." + docId();
  function hlLoad() { try { return JSON.parse(localStorage.getItem(hlKey()) || "[]"); } catch (e) { return []; } }
  function hlSave(l) { try { localStorage.setItem(hlKey(), JSON.stringify(l.slice(-200))); } catch (e) { /* 계속 */ } }
  function ensureHlStyle(d) {
    if (d.getElementById("rm-hl-style")) return;
    const st = d.createElement("style"); st.id = "rm-hl-style"; st.textContent = "mark.rm-hl{background:#ffe066;color:inherit;border-radius:3px;padding:0 1px;box-shadow:0 0 0 1px rgba(0,0,0,.04)}html[data-app-reader] mark.rm-hl{background:color-mix(in srgb,#ffd43b 55%,transparent)}";
    d.head.appendChild(st);
  }
  function wrapText(d, text) {
    if (!text || text.length < 2) return false;
    const w = d.createTreeWalker(d.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const i = n.nodeValue.indexOf(text);
      if (i >= 0 && !(n.parentNode && n.parentNode.classList && n.parentNode.classList.contains("rm-hl"))) {
        const r = d.createRange(); r.setStart(n, i); r.setEnd(n, i + text.length);
        const m = d.createElement("mark"); m.className = "rm-hl"; try { r.surroundContents(m); return true; } catch (e) { return false; }
      }
    }
    return false;
  }
  function hl() {
    const d = doc(); if (!d) return;
    const s = d.defaultView.getSelection(); const t = s ? String(s).trim() : "";
    if (t) {
      ensureHlStyle(d);
      let ok = false;
      try { const r = s.getRangeAt(0); const m = d.createElement("mark"); m.className = "rm-hl"; r.surroundContents(m); ok = true; } catch (e) { ok = wrapText(d, t.slice(0, 300)); }
      s.removeAllRanges();
      if (ok) { const l = hlLoad(); l.push({ t: t.slice(0, 300), at: Date.now() }); hlSave(l); }
      pop("🖍 형광펜", ok ? "<p>칠했어요. 이 문서를 다시 열어도 그대로 남아 있어요.</p>" + hlList() : '<p class="sh-muted">여러 단락에 걸친 선택은 칠할 수 없어요 — 한 단락 안에서 골라 주세요.</p>');
      return;
    }
    pop("🖍 형광펜", '<p class="sh-muted">본문에서 문장을 드래그한 뒤 🖍 를 누르면 칠해져요.</p>' + hlList());
  }
  function hlList() {
    const l = hlLoad(); if (!l.length) return "";
    return '<div class="rm-hls"><b>이 문서의 형광펜 ' + l.length + "개</b>" + l.slice().reverse().map((x, i) => '<div class="rm-hli"><span>' + esc(x.t) + '</span><button type="button" class="ask-icon" data-rm-hlx="' + (l.length - 1 - i) + '" title="지우기">✕</button></div>').join("") + "</div>";
  }
  function hlRestore() {
    const d = doc(); if (!d || !d.body) return;
    const l = hlLoad(); if (!l.length) return;
    ensureHlStyle(d); l.forEach((x) => wrapText(d, x.t));
  }
  function focusMode(on) {
    if (on == null) on = !document.body.classList.contains("rm-focus");
    document.body.classList.toggle("rm-focus", on);
    if (on && typeof askState !== "undefined" && askState.open) { try { askSetOpen(false); } catch (e) { /* 계속 */ } }
    paint();
    try { if (typeof libFitHeight === "function") setTimeout(libFitHeight, 50); } catch (e) { /* 계속 */ }
  }
  function paint() {
    if (!dock) return;
    dock.querySelectorAll(".rm-b").forEach((b) => b.classList.toggle("on", (b.dataset.rm === "tts" && R.speaking) || (b.dataset.rm === "focus" && document.body.classList.contains("rm-focus"))));
  }
  /* 읽은 시간 */
  const timeKey = () => "study.reader.time." + docId();
  function tick() {
    const vis = visible() && document.visibilityState === "visible";
    if (dock) dock.classList.toggle("hidden", !visible());
    if (!vis) { if (document.body.classList.contains("rm-focus") && !visible()) focusMode(false); return; }
    const id = docId(); if (!id) return;
    if (id !== R.docId) { R.docId = id; const p = $("rmPop"); if (p) p.classList.add("hidden"); setTimeout(hlRestore, 600); }
    let sec = 0; try { sec = (+localStorage.getItem(timeKey()) || 0) + 5; localStorage.setItem(timeKey(), String(sec)); } catch (e) { /* 계속 */ }
    const el = $("rmTime"); if (el) el.textContent = "⏱ " + Math.round(sec / 60) + "분 읽음";
  }

  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-rm]");
    if (b) {
      const k = b.dataset.rm;
      if (k === "close") { $("rmPop").classList.add("hidden"); return; }
      if (k === "sum") summarize(); else if (k === "quiz") quiz(); else if (k === "tts") tts(); else if (k === "hl") hl();
      else if (k === "focus") focusMode();
      return;
    }
    const a = e.target.closest("[data-rm-a]");
    if (a && R.quiz) { const [i, k] = a.dataset.rmA.split("|"); if (R.ans[i]) return; R.ans[i] = k; const x = R.quiz[+i]; quizRender(); return; }
    const hx = e.target.closest("[data-rm-hlx]");
    if (hx) { const l = hlLoad(); const it = l.splice(+hx.dataset.rmHlx, 1)[0]; hlSave(l); const d = doc(); if (d && it) { Array.from(d.querySelectorAll("mark.rm-hl")).filter((m) => m.textContent === it.t).slice(0, 1).forEach((m) => { m.replaceWith(d.createTextNode(m.textContent)); }); } pop("🖍 형광펜", hlList() || '<p class="sh-muted">형광펜이 없어요.</p>'); return; }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && document.body.classList.contains("rm-focus")) focusMode(false); });
  function init() {
    build();
    try { if (lb && lb.frame) lb.frame.addEventListener("load", () => { R.docId = ""; setTimeout(hlRestore, 400); }); } catch (e) { /* 계속 */ }
    setInterval(tick, 5000); setTimeout(tick, 800);
  }
  window.READER = { section: section, focus: focusMode };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
