(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const HUB = {
    rx_report: ["rnd", "보고서 작성·보조", "양식으로 새 보고서, 초록·표준 문단, 품질 검토·고쳐 쓰기(수락/거절)·근거 신호등·수치 충돌·루브릭 점수·독자 반응까지 — 작업 문서를 골라 바로", ["templates", "abstract", "boiler", "snips", "review", "suggest", "confid", "claimmap", "consistency", "conflict", "rubric", "reader", "prose", "briefs", "count", "diff"]],
    rx_lit: ["rnd", "문헌·선행연구", "논문 지형·연구 공백·검색 포화도·신규성을 보고, 쓰는 글에 맞는 논문을 찾아 참고문헌으로", ["landscape", "gapgrid", "satur", "novelty", "recopap", "compare", "refs", "biblio"]],
    rx_review: ["rnd", "심사·평가 대비", "모의 평가위원회·5관점 동료 심사·루브릭 예상 점수·재지원 대응표·독자 반응으로 제출 전에 미리 심사받기", ["panel", "peer5", "rubric", "rebut", "reader", "reqmap", "risk", "qadrill", "qa"]],
    rx_write: ["rnd", "글 검토·다듬기", "작업 문서를 고쳐 쓰기(수락/거절)·근거 신호등·주장-근거·수치 충돌·문장 진단으로 다듬기", ["suggest", "review", "confid", "claimmap", "citecheck", "consistency", "conflict", "prose", "abstract", "translate", "count", "diff", "boiler", "snips", "templates"]],
    rx_data: ["rnd", "수치·일정·예산", "성과지표·예산 검산·일정 간트·로직 모델·용어집을 자료에서 뽑아 표로", ["kpi", "budget", "schedule", "logic", "glossary"]],
    rx_present: ["rnd", "발표 준비", "발표 대본·타이머 리허설(말 빠르기·군말)·길이별 브리핑·오디오 브리핑·질의응답 연습", ["rehearse", "briefs", "audio", "qadrill", "qa"]],
    rx_deep: ["rnd", "심층 조사·지식맵", "조사 계획을 고쳐 프로젝트 자료+논문으로 심층 보고서, 지식 그래프·마인드맵·전체 검색·폴더 변화", ["deepres", "kgraph", "mindmap", "search", "watch"]],
    rx_meet: ["rnd", "회의·설문·메모", "내 메모+받아쓰기를 합친 회의 노트, 설문 시뮬레이터, 회의록 정리, 메모·할 일, 프로젝트 묶음", ["enhance", "minutes", "survey", "notes", "todo", "bundle"]],
    lx_read: ["lib", "읽기 도우미", "어려운 단어 풀이·문단 아래 번역·빠른 읽기·쉽게 풀어 설명·학습 가이드 — 고른 자료를 열어 바로", ["gloss", "inlinetr", "bionic", "skim", "eli5", "guide", "translate", "typo", "find"]],
    lx_memory: ["lib", "기억·복습", "기억 가림판·다시 읽기 일정·이해도 지도·퀴즈·플래시카드·내 말로 설명·짝 맞추기로 오래 남기기", ["recall", "reread", "umap", "quiz", "cards", "precheck", "feynman", "arcade"]],
    lx_notes: ["lib", "노트 허브", "모든 자료의 내 노트·형광펜에 묻기, 증강 읽기(관련 옛 메모), 고른 메모만 질문, 학습 일지, 노트·형광펜 내보내기", ["noteqa", "augread", "pickask", "journal", "notes", "highlights", "bookmarks", "export", "cite"]],
    lx_write: ["lib", "쓰기·서술형", "직접 해 보기 칸·루브릭 서술형 채점·단계별 글쓰기 코치·코넬 노트·반론 연습", ["tryit", "rubricw", "wcoach", "cornell", "debate"]],
    lx_speak: ["lib", "말하기·듣기", "말로 설명하기·듣다가 말로 묻기·받아쓰기 강의 노트·오디오 개요·이야기책", ["voiceback", "listenask", "lecture", "audio", "storybook"]],
    lx_chat: ["lib", "대화·상황극", "저자·역사 인물·상황 속 상대와 대화하고 평가받기, 소크라테스 튜터, 이 문서에 질문", ["persona", "socratic", "ask"]],
    lx_lab: ["lib", "정리·시각화", "개념 인터랙티브 모듈·흐름도·마인드맵·연표·비교표·용어집·FAQ", ["interactive", "diagram", "mindmap", "timeline", "compare", "glossary", "faq"]],
    lx_plan: ["lib", "학습 계획·출제", "출제 예측과 날짜별 계획, 목표로 짜는 학습 경로, 관심사 맞춤 다시 쓰기, 읽기 통계", ["examprep", "path", "interest", "stats"]],
  };
  // 문서 화면(뷰어)에서만 되는 자료 도구 — 문서에 직접 칠하거나 보이는 위치를 쓴다
  const READER = { recall: 1, gloss: 1, inlinetr: 1, bionic: 1, umap: 1, skim: 1, typo: 1, find: 1, notes: 1, bookmarks: 1, highlights: 1, cite: 1, stats: 1, export: 1 };
  const P = (k, d) => (window.TK ? TK.store.get("hub." + k, d) : d), PS = (k, v) => { if (window.TK) TK.store.set("hub." + k, v); };

  /* ---------------- 자료: 고른 문서를 뒤에서 불러오기 ---------------- */
  async function libDocs() { try { if (typeof libCatalog === "function") await libCatalog(); if (window.LIB2 && LIB2.markLegacy) LIB2.markLegacy(); } catch (e) { /* 계속 */ } return ((typeof libState !== "undefined" && libState.catalog) || {}).docs || []; }
  async function ensureLibDoc(id) {
    if (!id) throw new Error("위에서 자료를 먼저 고르세요.");
    const d = (await libDocs()).find((x) => x.id === id); if (!d || !d.path) throw new Error("그 자료를 불러오지 못했어요(앱에서 올린 자료는 문서 화면에서 열어 주세요).");
    const f = lb.frame;
    if (f && f.dataset.hubId === id && libState.docId === id && f.contentDocument && f.contentDocument.body && f.contentDocument.body.textContent.length > 50) return d;
    await new Promise((res) => { const t = setTimeout(res, 12000); f.onload = () => { clearTimeout(t); res(); }; f.src = d.path; });
    libState.docId = id; f.dataset.hubId = id; const tt = $("libDocTitle"); if (tt) tt.textContent = d.title;
    return d;
  }
  async function openInReader(id, toolId) {
    if (!id) throw new Error("위에서 자료를 먼저 고르세요.");
    navTo("library"); await new Promise((r) => setTimeout(r, 350));
    if (window.libOpen) await libOpen(id);
    setTimeout(() => { try { TOOLSETS.openLib(toolId); } catch (e) { /* 계속 */ } }, 900);
  }

  /* ---------------- 그리기 ---------------- */
  async function paint(key, area) {
    const h = HUB[key], isR = h[0] === "rnd";
    const pool = isR ? TOOLSETS.RND_TOOLS : TOOLSETS.LIB_TOOLS;
    const tools = h[3].map((id) => pool.find((t) => t.id === id)).filter(Boolean);
    area.innerHTML = '<div class="sv hub"><div class="hub-head"><div><h2>' + esc(h[1]) + '</h2><p class="sh-muted">' + esc(h[2]) + '</p></div><span class="hub-n">도구 ' + tools.length + '개</span></div><div class="hub-ctx" id="hubCtx_' + key + '"><span class="lb-dots"><i></i><i></i><i></i></span></div><div class="hub-body" id="hubBody_' + key + '"></div></div>';
    const ctx = $("hubCtx_" + key);
    if (isR) await ctxRnd(ctx, key); else await ctxLib(ctx, key);
    const wrapped = tools.map((t) => {
      if (isR) return Object.assign({}, t, { run: async (c, io, v) => { await readyRnd(key); return t.run(c, io, v); } });
      if (READER[t.id]) return Object.assign({}, t, { inputs: [], ai: false, desc: t.desc + " · 문서 화면에서 열어요", run: async () => { await openInReader(P("lib", ""), t.id); } });
      return Object.assign({}, t, { run: async (c, io, v) => { await ensureLibDoc(P("lib", "")); v.scope = "all"; return t.run(c, io, v); } });
    });
    const body = $("hubBody_" + key);
    TK.mount(body, { id: "hub." + key, title: "", intro: "", tools: wrapped, ctx: isR ? null : TOOLSETS.L,
      actions: isR ? [{ label: "📝 작업 문서에 넣기", run: async (last) => { await readyRnd(key); RND.ctx().toDoc(last.title, last.md); try { await RND.saveDoc("메뉴 도구에서"); if (window.SERVER && SERVER.notice) SERVER.notice("작업 문서에 넣고 저장했어요."); } catch (e) { /* 계속 */ } } }]
        : [{ label: "🗒 이 자료 노트에 붙이기", run: (last) => { const k = TOOLSETS.L.key("notes"), n = TK.store.get(k, { t: "" }); n.t = (n.t ? n.t + "\n\n" : "") + "## " + last.title + "\n" + last.md; n.at = Date.now(); TK.store.set(k, n); if (window.SERVER && SERVER.notice) SERVER.notice("이 자료 노트에 붙였어요."); } }] });
    const hd = body.querySelector(".tk-head > div"); if (hd && !hd.textContent.trim()) hd.remove();
  }
  // 연구: 프로젝트 · 작업 문서 고르기
  async function ctxRnd(el, key) {
    let list = []; try { list = (await RND.ws.req("projects")).list || []; } catch (e) { el.innerHTML = '<p class="lb-warn">' + esc(e.message) + "</p>"; return; }
    if (!list.length) { el.innerHTML = '<p class="sh-muted">연구 프로젝트가 없어요. <button type="button" class="ghost-btn small-btn" data-hub="newproj">＋ 프로젝트 만들기</button></p>'; return; }
    let pid = P("rnd", "") || RND.cur() || list[0].id; if (!list.some((p) => p.id === pid)) pid = list[0].id; PS("rnd", pid);
    el.innerHTML = '<label>프로젝트 <select id="hubP_' + key + '">' + list.map((p) => '<option value="' + esc(p.id) + '"' + (p.id === pid ? " selected" : "") + ">" + esc(p.name) + "</option>").join("") + '</select></label><label>작업 문서 <select id="hubD_' + key + '"><option value="">(없음 — 자료만)</option></select></label><span class="hub-st" id="hubS_' + key + '"></span><button type="button" class="ghost-btn small-btn" data-hub="openproj">작업실 열기 →</button>';
    const ps = $("hubP_" + key), ds = $("hubD_" + key);
    const fill = async () => {
      $("hubS_" + key).textContent = "불러오는 중…";
      try { await RND.prepare(ps.value); } catch (e) { $("hubS_" + key).textContent = "⚠ " + e.message; return; }
      const docs = RND.docs() || [], did = P("did." + ps.value, "");
      ds.innerHTML = '<option value="">(없음 — 자료만)</option>' + docs.map((d) => '<option value="' + esc(d.id) + '"' + (d.id === did ? " selected" : "") + ">" + esc(d.title) + " · v" + d.v + "</option>").join("");
      if (did && docs.some((d) => d.id === did)) await RND.useDoc(did); else await RND.useDoc("");
      const c = RND.ctx(); $("hubS_" + key).textContent = c ? "자료 " + c.files().filter((f) => !f.hidden).length + "개 · 근거로 쓰는 자료 " + c.files().filter((f) => c.inCtx(f.id)).length + "개" : "";
    };
    ps.addEventListener("change", () => { PS("rnd", ps.value); fill(); });
    ds.addEventListener("change", async () => { PS("did." + ps.value, ds.value); await RND.useDoc(ds.value); });
    await fill();
  }
  async function readyRnd(key) { const pid = P("rnd", ""); if (!pid) throw new Error("위에서 프로젝트를 고르세요."); await RND.prepare(pid); const did = P("did." + pid, ""); await RND.useDoc(did); }
  // 자료: 학습 자료 고르기(새 문서 먼저, 레거시는 아래)
  async function ctxLib(el, key) {
    const docs = await libDocs(); if (!docs.length) { el.innerHTML = '<p class="sh-muted">학습 자료가 없어요.</p>'; return; }
    let cur = P("lib", "") || (typeof libState !== "undefined" && libState.docId) || ""; if (!docs.some((d) => d.id === cur)) cur = (docs.find((d) => !d.legacy) || docs[0]).id; PS("lib", cur);
    const nw = docs.filter((d) => !d.legacy && !(d.status === "legacy")), lg = docs.filter((d) => d.legacy || d.status === "legacy");
    el.innerHTML = '<label>학습 자료 <select id="hubL_' + key + '">' + (nw.length ? '<optgroup label="✨ 새 자료">' + nw.map((d) => '<option value="' + esc(d.id) + '"' + (d.id === cur ? " selected" : "") + ">" + esc(d.title) + "</option>").join("") + "</optgroup>" : "") + (lg.length ? '<optgroup label="레거시">' + lg.map((d) => '<option value="' + esc(d.id) + '"' + (d.id === cur ? " selected" : "") + ">" + esc(d.title) + "</option>").join("") + "</optgroup>" : "") + '</select></label><span class="hub-st">AI 도구는 고른 자료 전체를 근거로 써요</span><button type="button" class="ghost-btn small-btn" data-hub="openlib">📖 이 자료 읽기 →</button>';
    $("hubL_" + key).addEventListener("change", (e) => PS("lib", e.target.value));
  }

  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-hub]"); if (!b) return;
    const k = b.dataset.hub;
    if (k === "openproj") RND.open(P("rnd", ""));
    if (k === "newproj") navTo("rnd");
    if (k === "openlib") openInReader(P("lib", ""), null).catch((er) => alert(er.message));
  });

  function build() {
    const content = document.querySelector("main.content"); if (!content || typeof EXT_VIEWS === "undefined" || EXT_VIEWS.rx_lit) return;
    Object.keys(HUB).forEach((k) => {
      const a = document.createElement("section"); a.id = "hub_" + k; a.className = "hidden"; content.appendChild(a);
      EXT_VIEWS[k] = { area: a, open: () => paint(k, a).catch((er) => { a.innerHTML = '<p class="lb-warn">' + esc(er.message) + "</p>"; }) };
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build); else setTimeout(build, 0);
  window.HUBS = { list: HUB };
})();
