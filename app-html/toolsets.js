/* =============================================================================
 * toolsets.js (v93) — 자료 학습 도구함 · 연구지원 도구 (toolkit.js 위에)
 *   A. 자료 학습: 학습 자료 뷰어의 리딩 메이트 막대 [🧰 도구함] → 오른쪽 서랍. 범위 = 지금 읽는 부분 / 문서 전체 / 선택한 부분
 *   B. 연구지원: 프로젝트 작업실의 [🧰 도구] 탭 — 근거는 프로젝트 자료(체크한 것)에서 BM25 로 찾은 발췌, 인용 (파일 p.쪽)
 *   도구 목록은 research/tools_survey.json(48개 서비스 179기능 조사)의 '도입 추천'을 바탕으로 골랐다.
 * ========================================================================== */
(function () {
  "use strict";
  const esc = (s) => TK.esc(s);
  const $ = (id) => document.getElementById(id);
  const clip = (t, n) => { t = String(t || ""); return t.length > n ? t.slice(0, n) + "\n…(이하 " + (t.length - n) + "자 생략)" : t; };
  const arr = (x) => Array.isArray(x) ? x : [];

  /* =====================================================================
   * A. 자료 학습
   * =================================================================== */
  const L = {
    doc() { try { return lb.frame && lb.frame.contentDocument; } catch (e) { return null; } },
    id() { try { return libState.docId || ""; } catch (e) { return ""; } },
    title() { const t = $("libDocTitle"); return (t && t.textContent) || "학습 자료"; },
    root() { const d = this.doc(); return d && (d.querySelector("main") || d.querySelector("article") || d.body); },
    all() { const r = this.root(); return r ? r.innerText.replace(/\n{3,}/g, "\n\n").trim() : ""; },
    section() {
      const d = this.doc(); if (!d || !d.body) return "";
      const hs = Array.from(d.querySelectorAll("h1, h2, h3")).filter((h) => h.offsetParent !== null);
      let cur = null; for (const h of hs) { if (h.getBoundingClientRect().top <= 140) cur = h; else break; }
      if (!cur) return this.all().slice(0, 6000);
      const lvl = +cur.tagName[1]; let t = cur.innerText + "\n", n = cur.nextElementSibling, guard = 0;
      while (n && guard++ < 400) { if (/^H[1-3]$/.test(n.tagName) && +n.tagName[1] <= lvl) break; t += n.innerText + "\n"; n = n.nextElementSibling; }
      if (t.trim().length < 80) { const p = cur.parentElement; if (p) t = p.innerText; }
      return t.trim();
    },
    sel() { const d = this.doc(); try { return d ? String(d.getSelection()).trim() : ""; } catch (e) { return ""; } },
    text(scope, max) {
      const t = scope === "sel" ? this.sel() : scope === "all" ? this.all() : this.section();
      if (!t) throw new Error(scope === "sel" ? "문서에서 먼저 글을 드래그해 고르세요." : "문서를 먼저 열어 주세요.");
      return clip(t, max || 14000);
    },
    paras() {
      const r = this.root(); if (!r) return [];
      let h = ""; const out = [];
      r.querySelectorAll("h1,h2,h3,h4,p,li,td,blockquote,pre").forEach((el) => {
        if (/^H\d$/.test(el.tagName)) { h = el.innerText.trim(); return; }
        const t = el.innerText.trim(); if (t.length < 25) return;
        out.push({ h: h, text: t.slice(0, 900), el: el });
      });
      return out;
    },
    scopeName(s) { return s === "sel" ? "선택한 부분" : s === "all" ? "문서 전체" : "지금 읽는 부분"; },
    key(k) { return "lib." + k + "." + this.id(); },
  };
  function bm25(items, query, k) {
    const q = {}; textTokens(query).forEach((t) => { q[t] = 1; }); const terms = Object.keys(q);
    const docs = items.map((it) => { const tf = {}; const tk = textTokens(it.text); tk.forEach((t) => { tf[t] = (tf[t] || 0) + 1; }); return { it: it, tf: tf, len: tk.length || 1 }; });
    const N = docs.length || 1, avg = docs.reduce((a, d) => a + d.len, 0) / N, df = {};
    docs.forEach((d) => terms.forEach((t) => { if (d.tf[t]) df[t] = (df[t] || 0) + 1; }));
    return docs.map((d) => { let s = 0; const norm = 1.2 * (0.25 + 0.75 * d.len / avg); terms.forEach((t) => { const f = d.tf[t]; if (f) s += Math.log(1 + (N - df[t] + 0.5) / (df[t] + 0.5)) * f * 2.2 / (f + norm); }); return [s, d.it]; })
      .filter((x) => x[0] > 0).sort((a, b) => b[0] - a[0]).slice(0, k || 6).map((x) => x[1]);
  }
  const SYS_LIB = "당신은 학습 자료를 함께 읽는 친절하고 정확한 튜터입니다. 한국어로 답하고, 주어진 자료에 있는 내용만 근거로 삼으세요. 자료에 없는 것은 '자료에 없음'이라고 구분하세요.";
  function cardsHtml(cards) {
    return '<div class="tk-cards">' + cards.map((c, i) => '<button type="button" class="tk-fc" data-fc="' + i + '"><span class="f">' + esc(c.front) + '</span><span class="b">' + esc(c.back) + "</span></button>").join("") + "</div>";
  }
  function quizRun(io, qs, title) {
    let score = 0, done = 0;
    io.html('<div class="tk-quiz">' + qs.map((q, i) => '<div class="tk-q" data-qi="' + i + '"><p><b>' + (i + 1) + ".</b> " + esc(q.q) + "</p>" + arr(q.choices).map((c, j) => '<button type="button" class="tk-ch" data-ch="' + j + '">' + "ABCDE"[j] + ". " + esc(c) + "</button>").join("") + '<p class="tk-why hidden"></p></div>').join("") + '<p class="tk-score"></p></div>',
      qs.map((q, i) => (i + 1) + ". " + q.q + "\n" + arr(q.choices).map((c, j) => "   " + "ABCDE"[j] + ". " + c).join("\n") + "\n   정답: " + "ABCDE"[q.answer] + " — " + (q.why || "")).join("\n\n"), title);
    io.el.querySelectorAll(".tk-q").forEach((box) => box.addEventListener("click", (e) => {
      const b = e.target.closest(".tk-ch"); if (!b || box.dataset.done) return;
      const q = qs[+box.dataset.qi]; const j = +b.dataset.ch; box.dataset.done = 1; done++;
      const ok = j === +q.answer; if (ok) score++;
      box.querySelectorAll(".tk-ch").forEach((x, k) => { x.classList.toggle("ok", k === +q.answer); x.classList.toggle("bad", k === j && !ok); });
      const w = box.querySelector(".tk-why"); w.textContent = (ok ? "✅ " : "❌ ") + (q.why || ""); w.classList.remove("hidden");
      io.el.querySelector(".tk-score").textContent = done === qs.length ? "점수 " + score + " / " + qs.length + (score === qs.length ? " 🎉" : " — 틀린 문항은 해설을 읽고 다시 보세요.") : "";
    }));
  }
  const LIB_TOOLS = [
    // 이해하기
    { id: "guide", group: "이해하기", ico: "🧭", name: "학습 가이드", desc: "핵심 개념·중요 문장·예상 질문을 한 장으로", ai: true,
      run: async (c, io, v) => { const t = L.text(v.scope); io.busy(); io.md(await TK.ai({ sys: SYS_LIB, user: "다음 자료(" + L.scopeName(v.scope) + ")로 학습 가이드를 만드세요.\n## 한 줄 요약\n## 핵심 개념(5~8개, 각 1~2문장)\n## 꼭 기억할 문장(원문 인용 3~5개)\n## 예상 질문과 짧은 답(5개)\n## 헷갈리기 쉬운 점\n\n[자료: " + L.title() + "]\n" + t, tokens: 2200 }, (f) => io.stream(f)), "학습 가이드 — " + L.title()); } },
    { id: "eli5", group: "이해하기", ico: "🧒", name: "쉽게 풀어 설명", desc: "수준을 골라 다시 설명(초심자~전문가)", ai: true,
      inputs: [{ id: "lv", label: "수준", type: "select", options: [["초등학생도 알 수 있게", "아주 쉽게"], ["고등학생 수준으로", "보통"], ["이 분야 입문자에게 비유와 예시로", "입문자"], ["전문가에게 핵심만 압축해서", "전문가"]] }],
      run: async (c, io, v) => { const t = L.text(v.scope, 9000); io.busy(); io.md(await TK.ai({ sys: SYS_LIB, user: v.lv + " 다음 내용을 다시 설명하세요. 비유 1개와 예시 1개를 넣고 마지막에 '한 문장 정리'를 다세요.\n\n" + t }, (f) => io.stream(f)), "쉬운 설명"); } },
    { id: "translate", group: "이해하기", ico: "🌐", name: "번역(나란히 보기)", desc: "문단별 원문 ↔ 번역 표 — 영어는 한국어로, 한국어는 영어로", ai: true,
      run: async (c, io, v) => { const t = L.text(v.scope, 7000); io.busy(); const r = await TK.aiJSON({ user: "다음 글을 문단(또는 2~3문장) 단위로 나눠 번역하세요. 영어면 한국어로, 한국어면 영어로.\n\n" + t, shape: '{"rows":[{"src":"원문","dst":"번역"}]}', tokens: 3500 }); io.table([["src", "원문"], ["dst", "번역"]], arr(r.rows), "번역 — " + L.title()); } },
    { id: "ask", group: "이해하기", ico: "💬", name: "이 문서에 질문", desc: "문서에서 근거 문단을 찾아 인용하며 답해요", ai: true, inputs: [{ id: "q", label: "질문", placeholder: "예: 이 방법의 한계는?" }],
      run: async (c, io, v) => {
        if (!v.q.trim()) throw new Error("질문을 적어 주세요.");
        const hits = bm25(L.paras(), v.q, 7); const ctx = hits.map((h, i) => "[" + (i + 1) + "] (" + (h.h || "본문") + ") " + h.text).join("\n\n") || clip(L.all(), 6000);
        io.busy("근거를 찾아 답하는 중…");
        const a = await TK.ai({ sys: SYS_LIB + " 답의 문장마다 근거 번호 [1] 처럼 붙이세요.", user: "질문: " + v.q + "\n\n[근거 문단]\n" + ctx }, (f) => io.stream(f));
        io.md(a + "\n\n---\n**근거 문단**\n" + hits.map((h, i) => "[" + (i + 1) + "] *" + (h.h || "본문") + "* — " + h.text.slice(0, 160) + "…").join("\n"), "질문: " + v.q);
        hits.forEach((h, i) => { try { h.el.classList.add("tk-cite-hl"); setTimeout(() => h.el.classList.remove("tk-cite-hl"), 8000); } catch (e) { /* 계속 */ } });
        io.note("문서 안의 근거 문단에 잠시 표시해 두었어요.");
      } },
    { id: "socratic", group: "이해하기", ico: "🤔", name: "소크라테스 튜터", desc: "답 대신 질문으로 이끌어요 — 내 답을 쓰면 다음 질문", ai: true, inputs: [{ id: "a", label: "내 생각(처음엔 비워 두고 실행)", type: "textarea", rows: 3 }],
      run: async (c, io, v) => {
        const hist = TK.store.get(L.key("socr"), []); if (!v.a.trim()) hist.length = 0; else hist.push({ role: "user", content: v.a });
        const t = L.text(v.scope, 6000); io.busy("질문을 고르는 중…");
        const msgs = [{ role: "system", content: SYS_LIB + " 당신은 소크라테스식 튜터입니다. 정답을 바로 말하지 말고, 학습자가 스스로 깨닫도록 한 번에 질문 하나만 하세요. 학습자의 답이 틀렸으면 어디가 걸리는지 힌트를 주고 다시 묻고, 맞으면 짧게 확인한 뒤 더 깊은 질문으로. 다섯 번째 문답에서는 정리해 주세요.\n[자료]\n" + t }].concat(hist);
        if (!hist.length) msgs.push({ role: "user", content: "시작해 주세요." });
        await TK.ai({ sys: msgs[0].content, user: msgs.slice(1).map((m) => (m.role === "user" ? "학습자: " : "튜터: ") + m.content).join("\n") }, (f) => io.stream(f)).then((a) => { hist.push({ role: "assistant", content: a }); TK.store.set(L.key("socr"), hist.slice(-12)); io.md(hist.map((m) => (m.role === "user" ? "**나:** " : "**튜터:** ") + m.content).join("\n\n"), "소크라테스 문답"); });
        const box = document.querySelector('[data-tk-in="a"]'); if (box) box.value = "";
      } },
    { id: "skim", group: "이해하기", ico: "🔦", name: "훑어 읽기 표시", desc: "목표·방법·결과·주장·근거 문장을 찾아 문서에 색으로 표시", ai: true,
      run: async (c, io, v) => {
        const ps = L.paras().slice(0, 120); if (!ps.length) throw new Error("문서를 먼저 열어 주세요.");
        io.busy("핵심 문장을 고르는 중…");
        const r = await TK.aiJSON({ user: "다음 번호 붙은 문단에서 훑어 읽기에 중요한 것을 고르세요(최대 15개). 종류: 목표, 방법, 결과, 주장, 근거, 정의.\n\n" + ps.map((p, i) => i + ": " + p.text.slice(0, 260)).join("\n"), shape: '{"marks":[{"i":0,"kind":"목표","why":"한 줄"}]}', tokens: 1600 });
        const cls = { 목표: "g", 방법: "m", 결과: "r", 주장: "c", 근거: "e", 정의: "d" };
        arr(r.marks).forEach((m) => { const p = ps[+m.i]; if (p && p.el) { p.el.classList.add("tk-skim", "tk-skim-" + (cls[m.kind] || "c")); p.el.setAttribute("data-skim", m.kind); } });
        try { const d = L.doc(); if (d && !d.getElementById("tkSkimCss")) { const st = d.createElement("style"); st.id = "tkSkimCss"; st.textContent = ".tk-skim{border-left:4px solid;padding-left:8px;position:relative}.tk-skim::before{content:attr(data-skim);font:700 11px sans-serif;position:absolute;left:-2px;top:-14px;padding:0 4px;border-radius:4px;color:#fff}.tk-skim-g{border-color:#2563eb}.tk-skim-g::before{background:#2563eb}.tk-skim-m{border-color:#7c3aed}.tk-skim-m::before{background:#7c3aed}.tk-skim-r{border-color:#059669}.tk-skim-r::before{background:#059669}.tk-skim-c{border-color:#d97706}.tk-skim-c::before{background:#d97706}.tk-skim-e{border-color:#0891b2}.tk-skim-e::before{background:#0891b2}.tk-skim-d{border-color:#db2777}.tk-skim-d::before{background:#db2777}.tk-cite-hl{background:#fff3b0!important;transition:background .5s}"; d.head.appendChild(st); } } catch (e) { /* 계속 */ }
        io.table([["kind", "종류"], ["text", "문장"], ["why", "왜 중요"]], arr(r.marks).map((m) => ({ kind: m.kind, text: (ps[+m.i] || {}).text ? ps[+m.i].text.slice(0, 200) : "", why: m.why })), "훑어 읽기 — " + L.title());
      } },
    // 정리하기
    { id: "mindmap", group: "정리하기", ico: "🗺", name: "마인드맵", desc: "문서 구조를 가지 그림으로", ai: true,
      run: async (c, io, v) => { const t = L.text(v.scope, 12000); io.busy(); const r = await TK.aiJSON({ user: "다음 자료의 핵심 구조를 마인드맵으로. 깊이 3단계까지, 가지마다 4~7자 키워드 + note(짧은 설명).\n\n" + t, shape: '{"title":"중심 주제","children":[{"title":"","note":"","children":[]}]}', tokens: 2200 }); io.tree(r, "마인드맵 — " + L.title()); } },
    { id: "cornell", group: "정리하기", ico: "📒", name: "코넬 노트", desc: "단서 질문 · 노트 · 요약 세 칸", ai: true,
      run: async (c, io, v) => { const t = L.text(v.scope, 10000); io.busy(); const r = await TK.aiJSON({ user: "다음 자료로 코넬 노트를 만드세요. 행마다 왼쪽 '단서(질문·키워드)', 오른쪽 '노트(핵심 내용)'. 마지막에 전체 요약 3문장.\n\n" + t, shape: '{"rows":[{"cue":"","note":""}],"summary":""}', tokens: 2200 }); io.table([["cue", "단서"], ["note", "노트"]], arr(r.rows), "코넬 노트 — " + L.title(), { after: '<div class="tk-md"><h4>요약</h4><p>' + esc(r.summary || "") + "</p></div>" }); } },
    { id: "glossary", group: "정리하기", ico: "📖", name: "용어집", desc: "핵심 용어·뜻·문서 속 예문을 표로", ai: true,
      run: async (c, io, v) => {
        const t = L.text(v.scope, 12000); io.busy(); const r = await TK.aiJSON({ user: "다음 자료에서 학습자가 알아야 할 핵심 용어 10~20개를 뽑아 쉬운 한국어 뜻과 원문 예문을 붙이세요.\n\n" + t, shape: '{"terms":[{"word":"","meaning":"","example":"원문 그대로"}]}', tokens: 2400 });
        const terms = arr(r.terms); io.table([["word", "용어"], ["meaning", "뜻"], ["example", "문서 속 예문"]], terms, "용어집 — " + L.title());
      } },
    { id: "faq", group: "정리하기", ico: "❔", name: "FAQ", desc: "자주 물을 질문과 답", ai: true,
      run: async (c, io, v) => { const t = L.text(v.scope, 12000); io.busy(); io.md(await TK.ai({ sys: SYS_LIB, user: "다음 자료로 FAQ 8~12개를 만드세요. 형식: **Q.** 질문 / A. 2~3문장 답.\n\n" + t, tokens: 2200 }, (f) => io.stream(f)), "FAQ — " + L.title()); } },
    { id: "timeline", group: "정리하기", ico: "🕒", name: "순서·절차·연표", desc: "단계·절차·시간 순서를 표로", ai: true,
      run: async (c, io, v) => { const t = L.text(v.scope, 12000); io.busy(); const r = await TK.aiJSON({ user: "다음 자료에서 시간 순서·절차·단계를 순서대로 뽑으세요(없으면 논리 순서).\n\n" + t, shape: '{"steps":[{"when":"시점·단계","what":"내용","note":"주의·근거"}]}' }); io.table([["when", "시점·단계"], ["what", "내용"], ["note", "비고"]], arr(r.steps), "순서·절차 — " + L.title()); } },
    { id: "compare", group: "정리하기", ico: "⚖", name: "개념 비교표", desc: "비슷한 개념을 기준별로 나란히", ai: true, inputs: [{ id: "items", label: "비교할 것(비우면 AI 가 고름)", placeholder: "예: RDF, OWL, SHACL" }],
      run: async (c, io, v) => { const t = L.text(v.scope, 12000); io.busy(); const r = await TK.aiJSON({ user: "다음 자료에 나오는 " + (v.items || "헷갈리기 쉬운 비슷한 개념 3~5개") + "를 4~6개 기준으로 비교하세요.\n\n" + t, shape: '{"criteria":["기준1"],"items":[{"name":"개념","values":["기준1 값"]}]}', tokens: 2000 }); const cr = arr(r.criteria); io.table([["name", "개념"]].concat(cr.map((x, i) => ["c" + i, x])), arr(r.items).map((it) => { const o = { name: it.name }; arr(it.values).forEach((x, i) => { o["c" + i] = x; }); return o; }), "비교표 — " + L.title()); } },
    // 기억하기
    { id: "quiz", group: "기억하기", ico: "❓", name: "퀴즈", desc: "객관식 5~10문항 → 바로 채점·해설·학습 기록", ai: true, inputs: [{ id: "n", label: "문항 수", type: "select", options: [["5", "5문항"], ["8", "8문항"], ["10", "10문항"]] }, { id: "lv", label: "난이도", type: "select", options: [["기본 이해", "기본"], ["적용·응용", "응용"], ["헷갈리는 함정 위주", "함정"]] }],
      run: async (c, io, v) => { const t = L.text(v.scope, 12000); io.busy(); const r = await TK.aiJSON({ user: "다음 자료로 " + v.lv + " 객관식 " + v.n + "문항(보기 4개)을 만드세요. answer 는 정답 보기 번호(0부터). why 는 왜 정답인지 + 다른 보기가 틀린 이유 1문장.\n\n" + t, shape: '{"qs":[{"q":"","choices":["","","",""],"answer":0,"why":""}]}', tokens: 3000 }); quizRun(io, arr(r.qs), "퀴즈 — " + L.title()); } },
    { id: "cards", group: "기억하기", ico: "🃏", name: "플래시카드", desc: "앞(질문)·뒤(답) 카드 — 눌러 뒤집기", ai: true, inputs: [{ id: "kind", label: "카드 종류", type: "select", options: [["qa", "질문 → 답"], ["cloze", "빈칸 채우기(cloze)"], ["term", "용어 → 정의"]] }],
      run: async (c, io, v) => {
        const t = L.text(v.scope, 12000); io.busy();
        const how = { qa: "질문→답 카드(답은 1~2문장)", cloze: "원문 핵심 문장에서 중요한 단어 하나를 ____ 로 가린 빈칸 카드(back 은 가린 단어 + 원문 문장)", term: "용어→정의 카드" }[v.kind];
        const r = await TK.aiJSON({ user: "다음 자료로 " + how + " 10~15장을 만드세요. 한 카드엔 하나의 사실만.\n\n" + t, shape: '{"cards":[{"front":"","back":""}]}', tokens: 2400 });
        const cards = arr(r.cards);
        io.html(cardsHtml(cards), cards.map((x) => "- **" + x.front + "** — " + x.back).join("\n"), "플래시카드 — " + L.title());
        io.el.addEventListener("click", (e) => { const f = e.target.closest(".tk-fc"); if (f) f.classList.toggle("flip"); });
      } },
    { id: "precheck", group: "기억하기", ico: "🎯", name: "읽기 전 질문", desc: "읽기 전에 답을 예상해 보는 질문(사전 질문 효과)", ai: true,
      run: async (c, io, v) => { const t = L.text(v.scope, 9000); io.busy(); io.md(await TK.ai({ sys: SYS_LIB, user: "학습자가 아래 자료를 읽기 전에 스스로 답을 예상해 볼 질문 4개를 만드세요. 답은 쓰지 말고, 마지막 줄에 '읽은 뒤 [퀴즈]로 확인해 보세요'.\n\n" + t, tokens: 700 }, (f) => io.stream(f)), "읽기 전 질문"); } },
    { id: "feynman", group: "기억하기", ico: "🗣", name: "내 말로 설명하기", desc: "내가 쓴 설명을 AI 가 빠진 점·틀린 점으로 피드백(파인만 기법)", ai: true, inputs: [{ id: "mine", label: "읽은 내용을 내 말로 설명해 보세요", type: "textarea", rows: 6 }],
      run: async (c, io, v) => { if (v.mine.trim().length < 30) throw new Error("설명을 조금 더(30자 이상) 써 주세요."); const t = L.text(v.scope, 9000); io.busy("피드백 쓰는 중…"); io.md(await TK.ai({ sys: SYS_LIB, user: "학습자가 자료를 자기 말로 설명했습니다. 1) 잘 이해한 점 2) 빠진 핵심 3) 틀리거나 모호한 표현(자료 근거와 함께) 4) 점수(10점 만점)와 다음에 볼 부분을 알려 주세요.\n\n[자료]\n" + t + "\n\n[학습자 설명]\n" + v.mine, tokens: 1400 }, (f) => io.stream(f)), "내 말로 설명 — 피드백"); } },
    // 듣기
    { id: "audio", group: "듣기", ico: "🎧", name: "오디오 개요", desc: "두 진행자가 대화로 풀어 주는 라디오 — 읽어 주기로 재생", ai: true,
      run: async (c, io, v) => {
        const t = L.text(v.scope, 10000); io.busy("대본 쓰는 중…");
        const r = await TK.aiJSON({ user: "다음 자료를 두 진행자(A: 질문하는 학습자, B: 설명하는 전문가)의 4~6분 분량 한국어 대화로 바꾸세요. 쉬운 비유와 핵심 정리를 넣고 마지막은 '오늘의 세 가지'.\n\n" + t, shape: '{"lines":[{"sp":"A","text":""}]}', tokens: 3000 });
        const lines = arr(r.lines);
        io.html('<div class="lb-row"><button type="button" class="primary small-btn" id="tkAuPlay">▶ 재생</button><button type="button" class="ghost-btn small-btn" id="tkAuStop">■ 멈춤</button><select id="tkAuRate" aria-label="속도"><option value="1">1배</option><option value="1.25">1.25배</option><option value="1.5">1.5배</option><option value="0.85">0.85배</option></select></div><div class="tk-dialog">' + lines.map((l, i) => '<p data-li="' + i + '" class="sp-' + (l.sp === "B" ? "b" : "a") + '"><b>' + (l.sp === "B" ? "🎓 B" : "🙋 A") + "</b> " + esc(l.text) + "</p>").join("") + "</div>", lines.map((l) => l.sp + ": " + l.text).join("\n"), "오디오 개요 — " + L.title());
        const synth = window.speechSynthesis; const voices = () => synth.getVoices().filter((x) => /ko/i.test(x.lang));
        $("tkAuPlay").onclick = () => { synth.cancel(); const vs = voices(); lines.forEach((l, i) => { const u = new SpeechSynthesisUtterance(l.text); u.lang = "ko-KR"; u.rate = +$("tkAuRate").value; if (vs.length) u.voice = vs[(l.sp === "B" ? 1 : 0) % vs.length]; u.pitch = l.sp === "B" ? 0.9 : 1.15; u.onstart = () => { io.el.querySelectorAll("[data-li]").forEach((p) => p.classList.toggle("on", +p.dataset.li === i)); }; synth.speak(u); }); };
        $("tkAuStop").onclick = () => synth.cancel();
      } },
    // 도구(AI 아님)
    { id: "notes", group: "도구", ico: "🗒", name: "문서 노트", desc: "이 문서 전용 메모 — 자동 저장(계정에 실시간)", go: "💾 저장", inputs: [{ id: "t", label: "노트(마크다운)", type: "textarea", rows: 12 }],
      run: async (c, io, v) => { TK.store.set(L.key("notes"), { t: v.t, at: Date.now() }); io.md(v.t || "_비어 있음_", "노트 — " + L.title()); io.note("저장했어요."); } },
    { id: "bookmarks", group: "도구", ico: "🔖", name: "북마크", desc: "지금 위치를 이름 붙여 저장 → 눌러서 그 자리로", inputs: [{ id: "label", label: "이름(비우면 지금 절 제목)", placeholder: "예: 다시 볼 예제" }], go: "＋ 지금 위치 저장",
      run: async (c, io, v) => {
        const d = L.doc(); if (!d) throw new Error("문서를 먼저 열어 주세요.");
        const bm = TK.store.get(L.key("bm"), []); const y = (d.scrollingElement || d.documentElement).scrollTop;
        if (v.label !== undefined) bm.push({ label: v.label || (L.section().split("\n")[0] || "위치").slice(0, 60), y: y, at: Date.now() });
        TK.store.set(L.key("bm"), bm);
        io.html('<ul class="tk-list">' + bm.map((b, i) => '<li><button type="button" class="ghost-btn small-btn" data-bm="' + i + '">↪ ' + esc(b.label) + '</button><button type="button" class="icon-mini" data-bmdel="' + i + '" aria-label="지우기">✕</button></li>').join("") + "</ul>", bm.map((b) => "- " + b.label).join("\n"), "북마크");
        io.el.onclick = (e) => { const g = e.target.closest("[data-bm]"); if (g) (d.scrollingElement || d.documentElement).scrollTo({ top: bm[+g.dataset.bm].y, behavior: "smooth" }); const x = e.target.closest("[data-bmdel]"); if (x) { bm.splice(+x.dataset.bmdel, 1); TK.store.set(L.key("bm"), bm); x.parentElement.remove(); } };
      } },
    { id: "highlights", group: "도구", ico: "🖍", name: "형광펜 모아 내보내기", desc: "리딩 메이트로 칠한 문장 + 노트를 마크다운으로",
      run: async (c, io) => { let hl = []; try { hl = JSON.parse(localStorage.getItem("study.reader.hl." + L.id()) || "[]"); } catch (e) { hl = []; } const n = TK.store.get(L.key("notes"), null); const md = "## 형광펜\n" + (hl.length ? hl.map((h) => "> " + (h.text || h.t || h)).join("\n\n") : "_없음 — 리딩 메이트의 🖍 형광펜으로 칠해 보세요_") + (n && n.t ? "\n\n## 노트\n" + n.t : ""); io.md(md, "형광펜·노트 — " + L.title()); } },
    { id: "find", group: "도구", ico: "🔍", name: "문서 안 찾기", desc: "단어를 모두 표시하고 하나씩 이동", inputs: [{ id: "q", label: "찾을 말" }], go: "찾기",
      run: async (c, io, v) => {
        const d = L.doc(); const r = L.root(); if (!d || !r) throw new Error("문서를 먼저 열어 주세요.");
        d.querySelectorAll("mark.tk-find").forEach((m) => { m.replaceWith(d.createTextNode(m.textContent)); }); r.normalize();
        if (!v.q.trim()) { io.md("표시를 지웠어요."); return; }
        const rx = new RegExp(v.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"); const hits = [];
        const walk = d.createTreeWalker(r, NodeFilter.SHOW_TEXT); const nodes = []; while (walk.nextNode()) nodes.push(walk.currentNode);
        nodes.forEach((n) => { const t = n.nodeValue; if (!rx.test(t)) return; rx.lastIndex = 0; const frag = d.createDocumentFragment(); let last = 0, m; while ((m = rx.exec(t))) { frag.appendChild(d.createTextNode(t.slice(last, m.index))); const mk = d.createElement("mark"); mk.className = "tk-find"; mk.textContent = m[0]; frag.appendChild(mk); hits.push(mk); last = m.index + m[0].length; } frag.appendChild(d.createTextNode(t.slice(last))); n.parentNode.replaceChild(frag, n); });
        let k = 0; const go = () => { if (hits[k]) hits[k].scrollIntoView({ block: "center", behavior: "smooth" }); };
        io.html('<p><b>' + hits.length + "곳</b> 찾음 " + '<button type="button" class="ghost-btn small-btn" id="tkFp">◀ 이전</button> <button type="button" class="ghost-btn small-btn" id="tkFn">다음 ▶</button></p>', v.q + ": " + hits.length + "곳");
        $("tkFn").onclick = () => { k = (k + 1) % Math.max(1, hits.length); go(); }; $("tkFp").onclick = () => { k = (k - 1 + hits.length) % Math.max(1, hits.length); go(); }; go();
      } },
    { id: "typo", group: "도구", ico: "🔠", name: "읽기 설정 · 읽기 자", desc: "글자 크기·줄 간격·본문 폭, 줄 따라가는 읽기 자", inputs: [{ id: "fs", label: "글자 크기", type: "select", options: [["", "그대로"], ["15px", "작게"], ["17px", "보통"], ["19px", "크게"], ["22px", "아주 크게"]] }, { id: "lh", label: "줄 간격", type: "select", options: [["", "그대로"], ["1.6", "보통"], ["1.9", "넓게"], ["2.2", "아주 넓게"]] }, { id: "w", label: "본문 폭", type: "select", options: [["", "그대로"], ["680px", "좁게(읽기 편함)"], ["860px", "보통"], ["none", "넓게"]] }, { id: "ruler", label: "읽기 자", type: "select", options: [["off", "끄기"], ["on", "켜기(마우스 줄 강조)"]] }], go: "적용",
      run: async (c, io, v) => {
        const d = L.doc(); if (!d) throw new Error("문서를 먼저 열어 주세요.");
        let st = d.getElementById("tkTypo"); if (!st) { st = d.createElement("style"); st.id = "tkTypo"; d.head.appendChild(st); }
        st.textContent = (v.fs ? "body,main,article{font-size:" + v.fs + "!important}" : "") + (v.lh ? "p,li{line-height:" + v.lh + "!important}" : "") + (v.w ? "main,article{max-width:" + v.w + "!important;margin-left:auto!important;margin-right:auto!important}" : "") + "#tkRuler{position:fixed;left:0;right:0;height:2.1em;background:rgba(255,230,120,.28);pointer-events:none;z-index:9999;mix-blend-mode:multiply}";
        let ru = d.getElementById("tkRuler");
        if (v.ruler === "on") { if (!ru) { ru = d.createElement("div"); ru.id = "tkRuler"; d.body.appendChild(ru); d.addEventListener("mousemove", (e) => { const x = d.getElementById("tkRuler"); if (x) x.style.top = (e.clientY - 14) + "px"; }); } } else if (ru) ru.remove();
        TK.store.set("lib.typo", v); io.md("적용했어요. (이 설정은 다음 문서에도 [적용]을 누르면 같은 값으로 쓸 수 있어요)");
      } },
    { id: "stats", group: "도구", ico: "📈", name: "읽기 통계", desc: "분량·예상 시간·진행률·읽은 시간",
      run: async (c, io) => {
        const t = L.all(); const d = L.doc(); if (!t) throw new Error("문서를 먼저 열어 주세요.");
        const ko = (t.match(/[가-힣]/g) || []).length, words = (t.match(/[A-Za-z]+/g) || []).length;
        const min = Math.max(1, Math.round(ko / 500 + words / 220));
        const se = d.scrollingElement || d.documentElement; const pct = Math.min(100, Math.round((se.scrollTop + se.clientHeight) / se.scrollHeight * 100));
        let read = 0; try { read = +localStorage.getItem("study.reader.time." + L.id()) || 0; } catch (e) { read = 0; }
        const pomo = TK.store.get("pomo", []).filter((p) => Date.now() - p.t < 7 * 864e5).length;
        io.table([["k", "항목"], ["v", "값"]], [{ k: "글자 수", v: t.length.toLocaleString() + "자 (한글 " + ko.toLocaleString() + " · 영단어 " + words.toLocaleString() + ")" }, { k: "예상 읽기 시간", v: "약 " + min + "분" }, { k: "지금 진행률", v: pct + "%" }, { k: "이 문서 읽은 시간", v: Math.round(read / 60) + "분" }, { k: "최근 7일 뽀모도로", v: pomo + "회" }], "읽기 통계 — " + L.title());
      } },
    { id: "pomo", group: "도구", ico: "🍅", name: "뽀모도로 타이머", desc: "25분 집중 · 5분 휴식, 화면 구석에 떠 있어요", inputs: [{ id: "m", label: "집중 시간", type: "select", options: [["25", "25분"], ["50", "50분"], ["15", "15분"]] }], go: "▶ 시작",
      run: async (c, io, v) => { TK.pomo(+v.m, "focus"); io.md("타이머를 시작했어요 — 오른쪽 아래에 떠 있어요. 끝나면 알려 드려요."); } },
    { id: "cite", group: "도구", ico: "❝", name: "인용 복사", desc: "선택한 문장을 출처(제목·날짜)와 함께 복사",
      run: async (c, io) => { const s = L.sel(); if (!s) throw new Error("문서에서 인용할 문장을 드래그해 고르세요."); const t = "“" + s + "”\n— " + L.title() + " (ScholarFlow 학습 자료, " + new Date().toLocaleDateString("ko-KR") + " 확인)"; await TK.copy(t); io.md("복사했어요:\n\n> " + s + "\n\n— " + L.title()); } },
    { id: "print", group: "도구", ico: "🖨", name: "인쇄 · PDF 저장", desc: "본문만 인쇄(브라우저 인쇄 → PDF로 저장 가능)",
      run: async (c, io) => { try { lb.frame.contentWindow.focus(); lb.frame.contentWindow.print(); io.md("인쇄 창을 열었어요. 대상에서 'PDF로 저장'을 고르면 파일로 남아요."); } catch (e) { throw new Error("인쇄 창을 열지 못했어요."); } } },
    { id: "export", group: "도구", ico: "📦", name: "이 문서 학습 묶음 내보내기", desc: "노트·북마크·형광펜을 마크다운 한 파일로",
      run: async (c, io) => { let hl = []; try { hl = JSON.parse(localStorage.getItem("study.reader.hl." + L.id()) || "[]"); } catch (e) { hl = []; } const n = TK.store.get(L.key("notes"), null), bm = TK.store.get(L.key("bm"), []); const md = "# " + L.title() + "\n\n## 노트\n" + ((n && n.t) || "_없음_") + "\n\n## 형광펜\n" + (hl.map((h) => "> " + (h.text || h.t || h)).join("\n\n") || "_없음_") + "\n\n## 북마크\n" + (bm.map((b) => "- " + b.label).join("\n") || "_없음_"); TK.download(TK.slug(L.title()) + "-학습묶음.md", md); io.md(md, "학습 묶음 — " + L.title()); } },
  ];
  // 노트 도구를 열면 저장된 노트를 채운다
  document.addEventListener("click", (e) => { const t = e.target.closest && e.target.closest('[data-tk-tool="notes"]'); if (t) setTimeout(() => { const n = TK.store.get(L.key("notes"), null); const x = document.querySelector('[data-tk-in="t"]'); if (x && n) x.value = n.t || ""; }, 30); });

  let drawer = null;
  function openLib(toolId) {
    if (!drawer) {
      drawer = document.createElement("aside"); drawer.className = "tk-drawer"; drawer.id = "tkDrawer"; drawer.setAttribute("aria-label", "학습 도구함");
      drawer.innerHTML = '<button type="button" class="tk-x" data-tkd="close" aria-label="닫기">✕</button><div class="tk-body"></div>';
      document.body.appendChild(drawer);
      drawer.addEventListener("click", (e) => { if (e.target.closest('[data-tkd="close"]')) drawer.classList.remove("on"); });
      drawer._tk = TK.mount(drawer.querySelector(".tk-body"), { id: "lib", title: "🧰 학습 도구함", intro: "범위를 고르고 도구를 누르세요. AI 도구는 자료에 있는 내용만 근거로 써요.", scopes: [["sec", "지금 읽는 부분"], ["all", "문서 전체"], ["sel", "선택한 부분"]], tools: LIB_TOOLS, ctx: L, pinsDefault: ["recall", "gloss", "inlinetr", "quiz"], pinHint: "고정한 도구는 리딩 메이트 막대에도 나와요", onPins: () => { if (window.TOOLSETS && TOOLSETS.paintRmPins) TOOLSETS.paintRmPins(); },
        actions: [{ label: "🗒 노트에 붙이기", run: (last) => { const n = TK.store.get(L.key("notes"), { t: "" }); n.t = (n.t ? n.t + "\n\n" : "") + "## " + last.title + "\n" + last.md; n.at = Date.now(); TK.store.set(L.key("notes"), n); if (window.SERVER && SERVER.notice) SERVER.notice("이 문서 노트에 붙였어요."); } }] });
    }
    drawer.classList.add("on");
    if (toolId) drawer._tk.open(toolId);
  }
  document.addEventListener("click", (e) => { const b = e.target.closest && e.target.closest('[data-rm="tk"]'); if (b) { e.stopPropagation(); openLib(); } }, true);
  // 리딩 메이트 막대에 [🧰 도구함] 버튼 넣기
  // (v95) 막대가 넘치면 좌우 화살표(◀ ▶) · 휠로 가로 이동
  function rmArrows(bar) {
    if (!bar.querySelector(".rm-arrow")) {
      const l = document.createElement("button"); l.type = "button"; l.className = "rm-arrow l"; l.textContent = "◀"; l.setAttribute("aria-label", "왼쪽으로");
      const r = document.createElement("button"); r.type = "button"; r.className = "rm-arrow r"; r.textContent = "▶"; r.setAttribute("aria-label", "오른쪽으로");
      bar.insertBefore(l, bar.firstChild); bar.appendChild(r);
      l.onclick = (e) => { e.stopPropagation(); bar.scrollBy({ left: -Math.max(160, bar.clientWidth * 0.6) }); };
      r.onclick = (e) => { e.stopPropagation(); bar.scrollBy({ left: Math.max(160, bar.clientWidth * 0.6) }); };
      bar.addEventListener("scroll", () => rmEdge(bar), { passive: true });
      bar.addEventListener("wheel", (e) => { if (bar.scrollWidth > bar.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.preventDefault(); bar.scrollLeft += e.deltaY; } }, { passive: false });
      if (window.ResizeObserver) { const ro = new ResizeObserver(() => rmEdge(bar)); ro.observe(bar); if (bar.parentElement) ro.observe(bar.parentElement); }
    }
    const r = bar.querySelector(".rm-arrow.r"); if (r && r !== bar.lastElementChild) bar.appendChild(r);   // 나중에 붙은 버튼 뒤로
    rmEdge(bar);
  }
  function rmEdge(bar) {
    // 글자까지 다 펴면 넘치는가 → 아이콘만(rm-compact). 넓어져서 다 들어가면 다시 글자 표시.
    const dock = bar.parentElement, avail = dock ? dock.clientWidth : bar.clientWidth;
    if (!bar.classList.contains("rm-compact")) { bar._full = bar.scrollWidth; if (bar.scrollWidth > avail + 2) bar.classList.add("rm-compact"); }
    else if (bar._full && bar._full <= avail - 4) bar.classList.remove("rm-compact");
    const over = bar.scrollWidth > bar.clientWidth + 2;
    bar.classList.toggle("can-l", over && bar.scrollLeft > 4); bar.classList.toggle("can-r", over && bar.scrollLeft + bar.clientWidth < bar.scrollWidth - 4);
  }
  // (v98) 고정한 도구(☆)를 리딩 메이트 막대에 바로 — 도구함을 열지 않고 한 번에
  function paintRmPins() {
    const bar = document.querySelector("#rmDock .rm-bar"); if (!bar) return;
    const ids = TK.store.get("pins.lib", ["recall", "gloss", "inlinetr", "quiz"]).slice(0, 5), key = ids.join(",");
    if (bar.dataset.pins === key && bar.querySelector(".rm-pin, .rm-tk")) return;
    bar.querySelectorAll(".rm-pin").forEach((x) => x.remove()); bar.dataset.pins = key;
    const after = bar.querySelector('[data-rm="tk"]'); let ref = after ? after.nextSibling : bar.querySelector(".rm-time");
    ids.map((id) => LIB_TOOLS.filter((t) => t.id === id)[0]).filter(Boolean).forEach((t) => { const b = document.createElement("button"); b.type = "button"; b.className = "rm-b rm-pin"; b.dataset.rmPin = t.id; b.title = t.name + " — " + t.desc; b.innerHTML = "<span>" + t.ico + "</span><em>" + esc(t.name) + "</em>"; bar.insertBefore(b, ref || null); });
    rmArrows(bar);
  }
  document.addEventListener("click", (e) => { const b = e.target.closest && e.target.closest("[data-rm-pin]"); if (b) { e.stopPropagation(); openLib(b.dataset.rmPin); } }, true);
  setInterval(() => { const bar = document.querySelector("#rmDock .rm-bar"); if (bar && !bar.querySelector('[data-rm="tk"]')) { const b = document.createElement("button"); b.type = "button"; b.className = "rm-b rm-tk"; b.dataset.rm = "tk"; b.title = "학습 도구함(40여 가지)"; b.innerHTML = "<span>🧰</span><em>도구함</em>"; const t = bar.querySelector(".rm-time"); bar.insertBefore(b, t || null); bar.dataset.pins = ""; } if (bar) { paintRmPins(); rmArrows(bar); } }, 1500);

  /* =====================================================================
   * B. 연구지원
   * =================================================================== */
  const SYS_R = "당신은 연구개발계획서·논문·보고서를 분석하는 꼼꼼한 연구 보조원입니다. 한국어로, 근거 발췌만 사용하고 인용은 (파일명 p.쪽) 형식. 발췌에 없는 것은 '자료에 없음'.";
  const C = () => (window.RND && RND.ctx) ? RND.ctx() : null;
  async function ground(q, k, max) { const c = C(); if (!c) throw new Error("연구 프로젝트를 먼저 여세요."); const ch = q ? await c.retrieve(q, k || 10, max || 9000) : await c.head(max || 9000); if (!ch.length) throw new Error("근거로 쓸 자료가 없어요. 📎 자료 칸에 PDF·문서를 올리거나 폴더 자료를 체크하세요."); return c.ground(ch); }
  const fileOpts = () => { const c = C(); return c ? c.files().filter((f) => f.chars !== 0).map((f) => [f.id, f.name]) : []; };
  const RND_TOOLS = [
    // 검토·검증
    { id: "reqmap", group: "검토·검증", ico: "📌", name: "요구사항·평가항목 매핑", desc: "공고/평가기준의 항목마다 계획서 어디서 충족하는지(쪽)·부족한 점", ai: true,
      inputs: [{ id: "crit", label: "기준 자료(공고·평가표) — 파일을 고르거나 아래에 붙여 넣기", type: "select", options: [["", "(붙여 넣은 글 사용)"]] }, { id: "paste", label: "기준 글 붙여 넣기(선택)", type: "textarea", rows: 4 }],
      run: async (c, io, v) => {
        let crit = v.paste.trim(); const cx = C();
        if (!crit && v.crit) crit = clip((await cx.fileText(v.crit)), 8000);
        if (!crit) throw new Error("기준 자료를 고르거나 붙여 넣으세요.");
        io.busy("기준 항목을 뽑는 중…");
        const items = arr((await TK.aiJSON({ user: "다음 공고/평가 기준에서 평가·요구 항목을 10~25개로 뽑으세요(배점 있으면 포함).\n\n" + crit, shape: '{"items":[{"item":"항목","points":"배점 또는 빈칸"}]}', tokens: 1600 })).items);
        const rows = [];
        for (let i = 0; i < items.length; i++) {
          io.busy("항목 " + (i + 1) + "/" + items.length + " 확인 중: " + items[i].item);
          const g = await cx.retrieve(items[i].item, 4, 2600); const gb = cx.ground(g.filter((x) => x.fid !== v.crit));
          const r = await TK.aiJSON({ cost: 1, user: "평가 항목: " + items[i].item + "\n이 항목을 아래 계획서 발췌가 얼마나 충족하는지 판단하세요." + gb, shape: '{"where":"계획서의 해당 내용 요약과 (파일 p.쪽)","level":"충족|부분|부족|없음","fix":"보완 제안 1문장"}', tokens: 500 });
          rows.push({ item: items[i].item, points: items[i].points || "", where: r.where, level: r.level, fix: r.fix });
        }
        const sum = { 충족: 0, 부분: 0, 부족: 0, 없음: 0 }; rows.forEach((r) => { sum[r.level] = (sum[r.level] || 0) + 1; });
        io.table([["item", "평가 항목"], ["points", "배점"], ["level", "충족도"], ["where", "계획서 근거"], ["fix", "보완 제안"]], rows, "요구사항 매핑", { before: '<p class="tk-sum">✅ 충족 ' + sum.충족 + " · 🟡 부분 " + sum.부분 + " · 🔴 부족 " + sum.부족 + " · ⚪ 없음 " + sum.없음 + "</p>" });
      } },
    { id: "consistency", group: "검토·검증", ico: "🔢", name: "수치·용어 일관성 검사", desc: "같은 지표·금액·기간·약어가 자료마다 다르게 쓰였는지", ai: true,
      run: async (c, io) => { const g = await ground("예산 금액 목표 지표 기간 인원 약어 수치 %", 14, 11000); io.busy(); const r = await TK.aiJSON({ sys: SYS_R, user: "발췌에서 서로 어긋나는 수치·기간·명칭·약어 표기를 찾으세요. 없으면 빈 목록." + g, shape: '{"issues":[{"what":"대상","a":"표기1 (파일 p.)","b":"표기2 (파일 p.)","fix":"맞추는 방법"}]}', tokens: 1800 }); io.table([["what", "대상"], ["a", "표기 ①"], ["b", "표기 ②"], ["fix", "맞추기"]], arr(r.issues), "일관성 검사"); } },
    { id: "risk", group: "검토·검증", ico: "⚠", name: "약점·위험 · SWOT", desc: "평가자 관점의 약점, 실행 위험, SWOT", ai: true,
      run: async (c, io) => { const g = await ground("목표 방법 추진체계 위험 한계 기대효과 차별성", 12, 10000); io.busy(); io.md(await TK.ai({ sys: SYS_R, user: "평가위원 관점에서 분석하세요.\n## 약점 TOP 5(근거 쪽·보완책)\n## 실행 위험(발생 가능성·영향·대응)\n## SWOT 표\n## 질의응답 대비 한 줄 답변" + g, tokens: 2200 }, (f) => io.stream(f)), "약점·위험 분석"); } },
    { id: "review", group: "검토·검증", ico: "🩺", name: "현재 문서 품질 검토", desc: "[문서] 탭에서 쓰는 문서의 논리·근거·문장·분량 점검", ai: true,
      run: async (c, io) => { const d = C().docText(); if (!d) throw new Error("[📝 문서] 탭에서 문서를 먼저 열거나 만드세요."); io.busy(); io.md(await TK.ai({ sys: SYS_R, user: "다음 문서를 검토하세요: 1) 절별 논리·근거 부족 2) 모호하거나 과장된 표현(고친 문장 제안) 3) 중복 4) 빠진 절 5) 총평과 우선순위 3개.\n\n" + clip(d, 12000), tokens: 2200 }, (f) => io.stream(f)), "문서 품질 검토"); } },
    { id: "citecheck", group: "검토·검증", ico: "🔗", name: "문장별 근거 찾기", desc: "현재 문서의 절마다 자료에서 가장 가까운 근거(쪽)를 붙여요(AI 없이)",
      run: async (c, io) => { const cx = C(); const doc = cx.doc(); if (!doc) throw new Error("[📝 문서] 탭에서 문서를 먼저 열거나 만드세요."); const rows = []; for (const s of doc.sections) { const body = (s.body || "").trim(); if (!body) continue; const g = await cx.retrieve(s.h + " " + body.slice(0, 300), 2, 1600); rows.push({ h: s.h, src: g.map((x) => x.name + (x.p ? " p." + x.p : "")).join(" · ") || "(못 찾음)", ex: g[0] ? g[0].text.slice(0, 160) + "…" : "" }); } io.table([["h", "절"], ["src", "가까운 근거"], ["ex", "근거 발췌"]], rows, "문장별 근거"); } },
    // 추출·정리
    { id: "compare", group: "추출·정리", ico: "🧮", name: "자료 비교표", desc: "내가 정한 열(항목)로 자료들을 나란히 — 칸마다 출처", ai: true, inputs: [{ id: "cols", label: "비교 항목(쉼표로)", value: "목적, 방법, 기간, 예산, 기대 효과" }],
      run: async (c, io, v) => { const cx = C(); const cols = v.cols.split(/[,，]/).map((x) => x.trim()).filter(Boolean).slice(0, 8); const files = cx.files().filter((f) => f.chars !== 0 && cx.inCtx(f.id)).slice(0, 8); if (files.length < 1) throw new Error("비교할 자료를 체크하세요."); const rows = []; for (const f of files) { io.busy(f.name + " 읽는 중…"); const g = await cx.retrieveIn(f.id, cols.join(" "), 6, 5000); const r = await TK.aiJSON({ sys: SYS_R, user: "자료 '" + f.name + "'에서 다음 항목의 값을 찾으세요(없으면 '자료에 없음'): " + cols.join(", ") + cx.ground(g), shape: '{"values":{"항목":"값 (p.쪽)"}}', tokens: 900 }); const o = { file: f.name }; cols.forEach((k, i) => { o["c" + i] = (r.values || {})[k] || ""; }); rows.push(o); } io.table([["file", "자료"]].concat(cols.map((k, i) => ["c" + i, k])), rows, "자료 비교표"); } },
    { id: "kpi", group: "추출·정리", ico: "📊", name: "성과지표·수치 표", desc: "KPI·목표치·측정 방법·근거 쪽", ai: true,
      run: async (c, io) => { const g = await ground("성과지표 KPI 목표 정량 측정 달성 기준", 12, 10000); io.busy(); const r = await TK.aiJSON({ sys: SYS_R, user: "발췌에서 성과지표를 표로." + g, shape: '{"rows":[{"kpi":"지표","target":"목표치","how":"측정 방법","when":"시점","src":"(파일 p.)"}]}' }); io.table([["kpi", "지표"], ["target", "목표치"], ["how", "측정"], ["when", "시점"], ["src", "근거"]], arr(r.rows), "성과지표"); } },
    { id: "budget", group: "추출·정리", ico: "💰", name: "예산표 · 검산", desc: "비목·금액을 뽑고 합계가 맞는지 확인", ai: true,
      run: async (c, io) => { const g = await ground("예산 비목 인건비 연구활동비 직접비 간접비 합계 천원 백만원", 12, 10000); io.busy(); const r = await TK.aiJSON({ sys: SYS_R, user: "발췌의 예산을 비목별로 뽑으세요. amount 는 원 단위 숫자(모르면 null), unit 원문 단위, stated_total 은 자료에 적힌 총액(원)." + g, shape: '{"rows":[{"item":"비목","year":"연차","amount":0,"unit":"","src":"(파일 p.)"}],"stated_total":0}' }); const rows = arr(r.rows); const sum = rows.reduce((a, x) => a + (+x.amount || 0), 0); const st = +r.stated_total || 0; io.table([["item", "비목"], ["year", "연차"], ["amount", "금액(원)"], ["unit", "원문 단위"], ["src", "근거"]], rows.map((x) => Object.assign({}, x, { amount: x.amount != null ? Number(x.amount).toLocaleString() : "" })), "예산표", { after: '<p class="tk-sum">합계(뽑은 값) <b>' + sum.toLocaleString() + "원</b>" + (st ? " · 자료의 총액 " + st.toLocaleString() + "원 → " + (Math.abs(sum - st) <= st * 0.005 ? "✅ 맞음" : "⚠ 차이 " + (sum - st).toLocaleString() + "원") : "") + "</p>" }); } },
    { id: "schedule", group: "추출·정리", ico: "🗓", name: "일정·마일스톤 + 간트", desc: "연차·월별 일정을 표와 막대 그림으로", ai: true,
      run: async (c, io) => { const g = await ground("추진 일정 마일스톤 단계 연차 월 착수 완료 개월", 12, 10000); io.busy(); const r = await TK.aiJSON({ sys: SYS_R, user: "발췌의 일정을 과업 단위로 뽑으세요. start/end 는 YYYY-MM(연도를 모르면 1차년도=2027 로 가정하고 note 에 적기)." + g, shape: '{"rows":[{"name":"과업","start":"2027-01","end":"2027-06","owner":"담당","src":"(파일 p.)","note":""}]}' }); const rows = arr(r.rows); io.table([["name", "과업"], ["start", "시작"], ["end", "끝"], ["owner", "담당"], ["src", "근거"]], rows, "일정·마일스톤", { before: TK.ganttHtml(rows) }); } },
    { id: "glossary", group: "추출·정리", ico: "🔤", name: "용어·약어집", desc: "전문 용어와 약어 풀이(처음 나온 쪽)", ai: true,
      run: async (c, io) => { const g = await ground("", 0, 11000); io.busy(); const r = await TK.aiJSON({ sys: SYS_R, user: "발췌의 전문 용어·약어 15~30개를 풀이하세요." + g, shape: '{"rows":[{"term":"","full":"원어/풀이","meaning":"뜻","src":"(파일 p.)"}]}', tokens: 2400 }); io.table([["term", "용어"], ["full", "원어"], ["meaning", "뜻"], ["src", "근거"]], arr(r.rows), "용어·약어집"); } },
    { id: "mindmap", group: "추출·정리", ico: "🗺", name: "구조 마인드맵", desc: "목표–전략–과제–성과 구조를 가지 그림으로", ai: true,
      run: async (c, io) => { const g = await ground("최종목표 세부목표 추진전략 과제 내용 성과", 12, 10000); io.busy(); const r = await TK.aiJSON({ sys: SYS_R, user: "발췌로 과제 구조 마인드맵(깊이 3)을 만드세요." + g, shape: '{"title":"과제명","children":[{"title":"","note":"","children":[]}]}', tokens: 2000 }); io.tree(r, "구조 마인드맵"); } },
    { id: "logic", group: "추출·정리", ico: "🧩", name: "로직 모델", desc: "투입–활동–산출–성과–영향 표", ai: true,
      run: async (c, io) => { const g = await ground("투입 인력 예산 활동 산출물 성과 파급효과 영향", 12, 10000); io.busy(); const r = await TK.aiJSON({ sys: SYS_R, user: "발췌로 로직 모델을 만드세요(단계별 2~5개)." + g, shape: '{"rows":[{"stage":"투입|활동|산출|성과|영향","item":"","src":"(파일 p.)"}]}' }); io.table([["stage", "단계"], ["item", "내용"], ["src", "근거"]], arr(r.rows), "로직 모델"); } },
    { id: "refs", group: "추출·정리", ico: "📚", name: "참고문헌 뽑기", desc: "자료 속 참고문헌 목록 → 참고문헌 관리에 넣기", ai: true,
      run: async (c, io) => { const g = await ground("참고문헌 References 문헌 저널 Journal Proceedings et al doi", 12, 10000); io.busy(); const r = await TK.aiJSON({ user: "발췌의 참고문헌을 구조화하세요(발췌에 있는 것만)." + g, shape: '{"refs":[{"authors":"","year":"","title":"","venue":"","doi":""}]}', tokens: 2400 }); const refs = arr(r.refs); io.table([["authors", "저자"], ["year", "연도"], ["title", "제목"], ["venue", "학술지"], ["doi", "DOI"]], refs, "참고문헌", { before: '<div class="lb-row"><button type="button" class="primary small-btn" id="tkRefAdd">＋ 참고문헌 관리에 모두 넣기</button></div>' }); $("tkRefAdd").onclick = (e) => { const k = "rnd.bib." + C().pid; const l = TK.store.get(k, []); refs.forEach((x) => { if (!l.some((y) => y.title === x.title)) l.push(x); }); TK.store.set(k, l); e.target.textContent = "✓ 넣었어요(" + l.length + "건)"; }; } },
    // 글쓰기
    { id: "abstract", group: "글쓰기", ico: "✍", name: "초록·제목 만들기", desc: "국문·영문 초록 + 제목 후보 5개", ai: true, inputs: [{ id: "len", label: "초록 길이", type: "select", options: [["300자 내외", "짧게(300자)"], ["600자 내외", "보통(600자)"], ["1,000자 내외", "길게(1,000자)"]] }],
      run: async (c, io, v) => { const g = await ground("목적 필요성 방법 내용 결과 기대효과", 12, 10000); io.busy(); io.md(await TK.ai({ sys: SYS_R, user: "발췌로 ## 국문 초록(" + v.len + ") ## 영문 Abstract ## 키워드(국/영 5개) ## 제목 후보 5개(국문 + 영문)." + g, tokens: 2200 }, (f) => io.stream(f)), "초록·제목"); } },
    { id: "translate", group: "글쓰기", ico: "🌐", name: "번역(국↔영)", desc: "붙여 넣은 글이나 현재 문서를 학술 문체로", ai: true, inputs: [{ id: "src", label: "번역할 글(비우면 현재 문서)", type: "textarea", rows: 6 }, { id: "to", label: "방향", type: "select", options: [["영어", "→ 영어"], ["한국어", "→ 한국어"]] }],
      run: async (c, io, v) => { const t = v.src.trim() || C().docText(); if (!t) throw new Error("번역할 글을 넣거나 문서를 여세요."); io.busy(); io.md(await TK.ai({ user: "다음 글을 학술·보고서 문체의 " + v.to + "로 번역하세요. 용어는 일관되게, 고유명사·수치는 그대로.\n\n" + clip(t, 9000), tokens: 3500 }, (f) => io.stream(f)), "번역"); } },
    { id: "qa", group: "글쓰기", ico: "🎤", name: "발표 예상 질문·답변", desc: "평가위원 질문 10개 + 30초 모범 답변", ai: true,
      run: async (c, io) => { const g = await ground("목표 차별성 방법 예산 일정 위험 성과 활용", 12, 10000); io.busy(); io.md(await TK.ai({ sys: SYS_R, user: "발표 심사에서 나올 날카로운 질문 10개와 각 30초 모범 답변(근거 쪽)을 쓰세요." + g, tokens: 2600 }, (f) => io.stream(f)), "예상 질문·답변"); } },
    { id: "minutes", group: "글쓰기", ico: "📝", name: "메모·회의록 정리", desc: "막 적은 메모를 결정 사항·할 일·쟁점으로", ai: true, inputs: [{ id: "raw", label: "메모·회의 내용 붙여 넣기", type: "textarea", rows: 8 }],
      run: async (c, io, v) => { if (!v.raw.trim()) throw new Error("메모를 붙여 넣으세요."); io.busy(); io.md(await TK.ai({ user: "다음 메모를 정리하세요: ## 요약(3줄) ## 결정 사항 ## 할 일(담당·기한 표) ## 남은 쟁점 ## 다음 회의 안건\n\n" + clip(v.raw, 10000), tokens: 1600 }, (f) => io.stream(f)), "회의록"); } },
    { id: "boiler", group: "글쓰기", ico: "🧱", name: "표준 문단 만들기", desc: "기관 소개·추진 실적·연구진 역량 등 재사용 문단 → 보관함", ai: true, inputs: [{ id: "kind", label: "문단 종류", type: "select", options: [["기관(연구팀) 소개", "기관 소개"], ["유사 과제 추진 실적", "추진 실적"], ["연구진 역량·역할", "연구진 역량"], ["보안·윤리 관리 계획", "보안·윤리"], ["성과 활용·확산 계획", "활용·확산"]] }],
      run: async (c, io, v) => { const g = await ground(v.kind, 8, 7000); io.busy(); const t = await TK.ai({ sys: SYS_R, user: "발췌를 근거로 '" + v.kind + "' 표준 문단(400~700자)을 쓰세요. 근거가 없는 부분은 [채울 곳] 으로 남기세요." + g, tokens: 1400 }, (f) => io.stream(f)); const k = "rnd.snip"; const l = TK.store.get(k, []); l.unshift({ kind: v.kind, text: t, at: Date.now(), project: C().name }); TK.store.set(k, l.slice(0, 100)); io.md(t, v.kind); io.note("[🧱 표준 문단 보관함]에 저장했어요 — 다른 프로젝트에서도 꺼내 쓸 수 있어요."); } },
    // 도구(AI 아님)
    { id: "notes", group: "도구", ico: "🗒", name: "프로젝트 메모", desc: "이 프로젝트 전용 메모 — 계정에 실시간 저장", go: "💾 저장", inputs: [{ id: "t", label: "메모(마크다운)", type: "textarea", rows: 12 }],
      run: async (c, io, v) => { TK.store.set("rnd.notes." + C().pid, { t: v.t, at: Date.now() }); io.md(v.t || "_비어 있음_", "프로젝트 메모"); io.note("저장했어요."); } },
    { id: "todo", group: "도구", ico: "✅", name: "할 일 · 마일스톤", desc: "기한이 있는 할 일 — 지난 것은 빨갛게", inputs: [{ id: "what", label: "할 일", placeholder: "예: 2장 예산 근거 보완" }, { id: "due", label: "기한(YYYY-MM-DD)", placeholder: "2026-11-30" }], go: "＋ 추가",
      run: async (c, io, v) => {
        const k = "rnd.todo." + C().pid; const l = TK.store.get(k, []); if (v.what.trim()) l.push({ what: v.what.trim(), due: v.due.trim(), done: false, at: Date.now() }); TK.store.set(k, l);
        const today = new Date().toISOString().slice(0, 10);
        const paint = () => { io.html('<ul class="tk-list">' + l.map((x, i) => '<li class="' + (x.done ? "done" : x.due && x.due < today ? "late" : "") + '"><label><input type="checkbox" data-td="' + i + '"' + (x.done ? " checked" : "") + "> " + esc(x.what) + "</label>" + (x.due ? "<small>" + esc(x.due) + "</small>" : "") + '<button type="button" class="icon-mini" data-tddel="' + i + '" aria-label="지우기">✕</button></li>').join("") + "</ul>", l.map((x) => "- [" + (x.done ? "x" : " ") + "] " + x.what + (x.due ? " (" + x.due + ")" : "")).join("\n"), "할 일"); };
        paint();
        io.el.onchange = (e) => { const t = e.target.closest("[data-td]"); if (t) { l[+t.dataset.td].done = t.checked; TK.store.set(k, l); paint(); } };
        io.el.onclick = (e) => { const t = e.target.closest("[data-tddel]"); if (t) { l.splice(+t.dataset.tddel, 1); TK.store.set(k, l); paint(); } };
      } },
    { id: "biblio", group: "도구", ico: "📇", name: "참고문헌 관리", desc: "DOI 로 채우기(Crossref) · 논문 검색(OpenAlex) · APA/IEEE/BibTeX", inputs: [{ id: "q", label: "DOI 또는 검색어(비우면 목록만)", placeholder: "10.1145/3544548.3581388 또는 prompt engineering education" }, { id: "fmt", label: "형식", type: "select", options: [["apa", "APA"], ["ieee", "IEEE"], ["bibtex", "BibTeX"]] }], go: "조회·검색",
      run: async (c, io, v) => {
        const k = "rnd.bib." + C().pid; const l = TK.store.get(k, []); const q = v.q.trim(); let found = [];
        if (/^(https?:\/\/(dx\.)?doi\.org\/)?10\.\d{4,}\//.test(q)) { io.busy("DOI 조회 중(Crossref)…"); const r = await TK.BIB.doi(q); if (!l.some((x) => x.doi === r.doi)) l.push(r); TK.store.set(k, l); }
        else if (q) { io.busy("논문 검색 중(OpenAlex)…"); found = await TK.BIB.search(q); }
        const fmt = (r, i) => v.fmt === "bibtex" ? "<pre>" + esc(TK.BIB.bibtex(r)) + "</pre>" : "<p>" + TK.BIB[v.fmt](Object.fromEntries(Object.entries(r).map(([a, b]) => [a, esc(b)])), i) + "</p>";
        io.html((found.length ? "<h4>검색 결과 — 눌러서 목록에 넣기</h4>" + found.map((r, i) => '<div class="tk-ref"><button type="button" class="ghost-btn small-btn" data-addref="' + i + '">＋</button><div><b>' + esc(r.title) + "</b><small>" + esc(r.authors) + " · " + esc(r.year) + " · " + esc(r.venue) + (r.cited != null ? " · 인용 " + r.cited : "") + (r.oa ? ' · <a href="' + esc(r.oa) + '" target="_blank" rel="noopener">무료 원문</a>' : "") + "</small></div></div>").join("") : "") +
          "<h4>이 프로젝트 참고문헌 " + l.length + "건</h4>" + (l.map((r, i) => '<div class="tk-ref"><button type="button" class="icon-mini" data-delref="' + i + '" aria-label="지우기">✕</button><div>' + fmt(r, i) + "</div></div>").join("") || '<p class="sh-muted">비어 있어요.</p>'),
          l.map((r, i) => v.fmt === "bibtex" ? TK.BIB.bibtex(r) : TK.BIB[v.fmt](r, i).replace(/<\/?i>/g, "*")).join("\n\n"), "참고문헌");
        io.el.onclick = (e) => { const a = e.target.closest("[data-addref]"); if (a) { const r = found[+a.dataset.addref]; if (!l.some((x) => x.title === r.title)) { l.push(r); TK.store.set(k, l); } a.textContent = "✓"; } const d = e.target.closest("[data-delref]"); if (d) { l.splice(+d.dataset.delref, 1); TK.store.set(k, l); d.closest(".tk-ref").remove(); } };
      } },
    { id: "count", group: "도구", ico: "🔢", name: "분량 계산", desc: "현재 문서의 글자·단어·원고지·쪽 수(절별)",
      run: async (c, io) => { const d = C().doc(); if (!d) throw new Error("[📝 문서] 탭에서 문서를 먼저 여세요."); const rows = d.sections.map((s) => { const t = s.body || ""; return { h: s.h, ch: t.length.toLocaleString(), nos: t.replace(/\s/g, "").length.toLocaleString(), w: (t.trim().split(/\s+/).filter(Boolean).length).toLocaleString(), pg: (t.length / 1800).toFixed(1) }; }); const all = d.sections.map((s) => s.body || "").join("\n"); rows.push({ h: "합계", ch: all.length.toLocaleString(), nos: all.replace(/\s/g, "").length.toLocaleString(), w: all.trim().split(/\s+/).filter(Boolean).length.toLocaleString(), pg: (all.length / 1800).toFixed(1) + " (원고지 " + Math.ceil(all.replace(/\n/g, "").length / 200) + "매)" }); io.table([["h", "절"], ["ch", "글자"], ["nos", "공백 제외"], ["w", "어절"], ["pg", "A4(약)"]], rows, "분량"); } },
    { id: "diff", group: "도구", ico: "🆚", name: "버전 비교", desc: "문서의 두 버전에서 바뀐 곳(추가·삭제) 표시", inputs: [{ id: "a", label: "이전 버전 번호", placeholder: "1" }, { id: "b", label: "나중 버전 번호(비우면 최신)", placeholder: "" }], go: "비교",
      run: async (c, io, v) => { const cx = C(); if (!cx.did()) throw new Error("저장된 문서를 [📝 문서] 탭에서 먼저 여세요."); io.busy("버전 불러오는 중…"); const A = await cx.docVersion(+v.a || 1), B = await cx.docVersion(v.b ? +v.b : null); const txt = (d) => (d.sections || []).map((s) => "## " + s.h + "\n" + (s.body || "")).join("\n\n"); const r = TK.diffHtml(txt(A), txt(B)); io.html('<p class="tk-sum">추가 ' + r.add + " · 삭제 " + r.del + " (v" + (A.v || v.a) + " → v" + (B.v || "최신") + ")</p>" + r.html, "v" + v.a + " → v" + (v.b || "최신") + " 비교 (추가 " + r.add + ", 삭제 " + r.del + ")", "버전 비교"); } },
    { id: "search", group: "도구", ico: "🔍", name: "프로젝트 전체 검색", desc: "자료 본문·대화·문서에서 한 번에 찾기", inputs: [{ id: "q", label: "찾을 말" }], go: "찾기",
      run: async (c, io, v) => { const cx = C(); const q = v.q.trim(); if (!q) throw new Error("찾을 말을 넣으세요."); io.busy("찾는 중…"); const res = await cx.searchAll(q); io.table([["where", "어디"], ["text", "내용"]], res, "검색: " + q); } },
    { id: "snips", group: "도구", ico: "🧱", name: "표준 문단 보관함", desc: "저장해 둔 재사용 문단 — 복사하거나 문서에 넣기",
      run: async (c, io) => { const l = TK.store.get("rnd.snip", []); io.html(l.length ? l.map((s, i) => '<div class="tk-snip"><b>' + esc(s.kind) + "</b> <small>" + esc(s.project || "") + " · " + new Date(s.at).toLocaleDateString("ko-KR") + '</small><div class="tk-md">' + TK.md(s.text) + '</div><button type="button" class="ghost-btn small-btn" data-snipdoc="' + i + '">📝 문서에 넣기</button></div>').join("") : '<p class="sh-muted">비어 있어요 — [🧱 표준 문단 만들기]로 채워요.</p>', l.map((s) => "## " + s.kind + "\n" + s.text).join("\n\n"), "표준 문단"); io.el.onclick = (e) => { const b = e.target.closest("[data-snipdoc]"); if (b) { const s = l[+b.dataset.snipdoc]; C().toDoc(s.kind, s.text); } }; } },
    { id: "templates", group: "도구", ico: "📋", name: "양식으로 새 문서", desc: "국가R&D 계획서·결과보고서·논문·제안요약 양식", inputs: [{ id: "tpl", label: "양식", type: "select", options: [["rnd", "국가R&D 연구개발계획서(표준)"], ["final", "연구 결과보고서"], ["paper", "학술 논문(IMRaD)"], ["onepage", "1쪽 제안 요약"], ["review", "과제 평가 의견서"]] }], go: "📝 이 양식으로 새 문서",
      run: async (c, io, v) => { const T = { rnd: ["연구개발과제의 개요", "연구개발의 필요성", "연구개발의 최종 목표 및 내용", "연차별 목표 및 내용", "추진 전략·방법 및 추진 체계", "연구개발 성과의 활용 방안 및 기대 효과", "연구시설·장비 구축·운영 계획", "연구개발비 사용 계획", "보안·안전 및 연구윤리 관리 계획", "참고문헌"], final: ["요약문", "연구개발 개요", "국내외 기술개발 현황", "연구개발 수행 내용 및 결과", "목표 달성도 및 관련 분야 기여도", "연구개발 성과 및 활용 계획", "연구개발 과정에서 수집한 해외 과학기술 정보", "참고문헌"], paper: ["Abstract", "1. Introduction", "2. Related Work", "3. Method", "4. Results", "5. Discussion", "6. Conclusion", "References"], onepage: ["과제명·한 줄 요약", "문제와 필요성", "해결 방법(차별성)", "목표·성과지표", "일정·예산 개요", "기대 효과"], review: ["총평", "목표의 명확성", "방법의 적절성", "추진 체계·역량", "예산의 타당성", "성과·활용", "보완 요구 사항", "종합 점수"] }[v.tpl]; C().newDocFrom(T); io.md("새 문서를 만들었어요 — [📝 문서] 탭에서 이어서 쓰세요. ✨ AI 초안 으로 자료를 근거로 채울 수 있어요."); } },
    { id: "bundle", group: "도구", ico: "📦", name: "프로젝트 묶음 내려받기", desc: "자료·문서 전 버전·대화 이력·내보낸 파일을 zip 한 개로",
      run: async (c, io) => { const cx = C(); io.busy("묶는 중…"); const r = await cx.WS.req("bundle", { pid: cx.pid }, {}); const resp = await fetch(cx.WS.url("out", { pid: cx.pid, name: r.name }), { credentials: "same-origin" }); const b = await resp.blob(); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = r.name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); io.md("내려받았어요: **" + r.name + "** (" + Math.round(r.size / 1024) + "KB)"); } },
    { id: "pomo", group: "도구", ico: "🍅", name: "뽀모도로 타이머", desc: "25분 집중 · 5분 휴식", inputs: [{ id: "m", label: "집중 시간", type: "select", options: [["25", "25분"], ["50", "50분"], ["90", "90분(딥 워크)"]] }], go: "▶ 시작",
      run: async (c, io, v) => { TK.pomo(+v.m, "focus"); io.md("타이머를 시작했어요 — 오른쪽 아래."); } },
  ];
  // 메모 도구를 열면 저장된 메모를, 기준 자료 칸에는 파일 목록을 채운다
  document.addEventListener("click", (e) => {
    const t = e.target.closest && e.target.closest("[data-tk-tool]"); if (!t || !t.closest("#rnTools")) return;
    setTimeout(() => {
      if (t.dataset.tkTool === "notes") { const n = TK.store.get("rnd.notes." + C().pid, null); const x = document.querySelector('#rnTools [data-tk-in="t"]'); if (x && n) x.value = n.t || ""; }
      if (t.dataset.tkTool === "reqmap") { const s = document.querySelector('#rnTools [data-tk-in="crit"]'); if (s) s.innerHTML += fileOpts().map((f) => '<option value="' + esc(f[0]) + '">' + esc(f[1]) + "</option>").join(""); }
    }, 30);
  });
  // (v98) 확장 도구(toolsets2.js)가 같은 도우미로 도구를 더할 수 있게 — 도구함은 처음 열 때 만들어지므로 그 전에 넣으면 된다
  window.TOOLSETS = { LIB_TOOLS: LIB_TOOLS, RND_TOOLS: RND_TOOLS, L: L, bm25: bm25, cardsHtml: cardsHtml, quizRun: quizRun,
    ground: ground, C: C, SYS_LIB: SYS_LIB, SYS_R: SYS_R, clip: clip, arr: arr, openLib: openLib, paintRmPins: () => { const b = document.querySelector("#rmDock .rm-bar"); if (b) b.dataset.pins = ""; paintRmPins(); } };
  window.RNDTOOLS = {
    paint(el) { if (el._tk) return; el._tk = TK.mount(el, { id: "rnd", title: "🧰 연구 도구", intro: "근거는 왼쪽에서 체크한 자료예요. 결과는 복사·MD·CSV 로 저장하거나 [📝 문서에 넣기].", tools: RND_TOOLS, ctx: null,
      pinsDefault: ["panel", "reqmap", "citecheck", "search"], pinHint: "고정한 도구는 대화·자료 보기 탭 옆에도 나와요", onPins: () => { if (window.RND && RND.paintPins) RND.paintPins(); },
      actions: [{ label: "📝 문서에 넣기", run: (last) => C().toDoc(last.title, last.md) }] }); },
  };
})();
