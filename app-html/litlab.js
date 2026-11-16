/* =============================================================================
 * litlab.js (v107) — 📚 문헌·선행연구 작업실 (rx_lit)
 *   🔎 찾기     OpenAlex 검색(연도·오픈액세스·정렬·인용 수) → 초록 펼쳐 보기 → 서재에 담기
 *   📚 서재     프로젝트 서재(= 참고문헌 관리 rnd.bib.<pid>)를 읽기 상태 보드(읽을 것·읽는 중·읽음·인용함)로, 태그·별점·메모·AI 구조 요약
 *   ▦ 비교표    논문 × 관점(목적·방법·데이터·결과·한계…) 표 — AI 가 초록으로 채우고 사람이 고침 → 연구 공백 찾기 → 보고서·논문으로
 *   🕸 인용 지도  서재 논문끼리 인용 관계 그림 + 서재가 많이 인용하는데 아직 없는 '놓친 핵심 논문'
 *   ✍ 관련 연구  고른 논문으로 관련 연구 절을 써서 논문 원고(LaTeX + .bib) 또는 보고서(작업 문서)에 넣기
 *   오른쪽: 논문 상세(초록·AI 요약·상태·메모·인용/피인용/관련 논문·PDF)
 * ========================================================================== */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const P = (k, d) => (window.TK ? TK.store.get(k, d) : d), PS = (k, v) => { if (window.TK) TK.store.set(k, v); };
  function toast(t, ms) { let el = $("llToast"); if (!el) { el = document.createElement("div"); el.id = "llToast"; el.className = "pp-toast"; document.body.appendChild(el); } el.textContent = t; el.classList.add("on"); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("on"), ms || 2600); }
  const OA = "https://api.openalex.org/works";
  const SEL = "id,display_name,publication_year,authorships,primary_location,doi,cited_by_count,open_access,abstract_inverted_index,referenced_works,related_works,type";
  const STATUS = [["todo", "📥 읽을 것"], ["reading", "📖 읽는 중"], ["read", "✅ 읽음"], ["cited", "❝ 인용함"]];
  const S = { pid: "", list: [], tab: P("ll.tab", "find"), q: P("ll.q", ""), res: [], f: Object.assign({ from: "", oa: false, sort: "relevance" }, P("ll.f", {})), sel: null, pick: {}, area: null, busy: false };
  const bk = () => "rnd.bib." + S.pid, mk = () => "rnd.litmx." + S.pid;
  const lib = () => (P(bk(), []) || []).map(norm), setLib = (l) => PS(bk(), l);
  function norm(r, i) { r = Object.assign({}, r); if (!r.id) r.id = r.oaid || (r.doi ? "doi:" + String(r.doi).toLowerCase() : "t:" + String(r.title || "").toLowerCase().replace(/\W+/g, "").slice(0, 40)); r.status = r.status || "todo"; r.tags = r.tags || []; return r; }
  function fromOA(w) {
    const abs = w.abstract_inverted_index ? (() => { const a = []; Object.keys(w.abstract_inverted_index).forEach((k) => w.abstract_inverted_index[k].forEach((i) => { a[i] = k; })); return a.join(" "); })() : "";
    const src = ((w.primary_location || {}).source || {});
    return { id: w.id, oaid: w.id, title: w.display_name || "", authors: (w.authorships || []).slice(0, 8).map((a) => (a.author || {}).display_name).filter(Boolean).join(", ") + ((w.authorships || []).length > 8 ? " 외" : ""), authorList: (w.authorships || []).map((a) => (a.author || {}).display_name).filter(Boolean),
      year: w.publication_year, venue: src.display_name || "", doi: (w.doi || "").replace("https://doi.org/", ""), url: (w.primary_location || {}).landing_page_url || w.id, cited: w.cited_by_count || 0, oa: (w.open_access || {}).oa_url || "", abstract: abs, refs: (w.referenced_works || []).slice(0, 200), related: (w.related_works || []).slice(0, 20), type: w.type };
  }
  async function oaQuery(params) { const r = await fetch(OA + "?" + params + "&select=" + SEL); if (!r.ok) throw new Error("OpenAlex 검색 실패(" + r.status + ")"); return ((await r.json()).results || []).map(fromOA); }
  async function oaSearch() {
    const f = []; if (S.f.from) f.push("from_publication_date:" + S.f.from + "-01-01"); if (S.f.oa) f.push("open_access.is_oa:true");
    const sort = S.f.sort === "cited" ? "&sort=cited_by_count:desc" : S.f.sort === "new" ? "&sort=publication_date:desc" : "";
    return oaQuery("per-page=25&search=" + encodeURIComponent(S.q) + (f.length ? "&filter=" + f.join(",") : "") + sort);
  }
  async function oaIds(ids) { const out = []; for (let i = 0; i < ids.length; i += 40) { const chunk = ids.slice(i, i + 40).map((x) => String(x).replace("https://openalex.org/", "")); out.push(...await oaQuery("per-page=50&filter=openalex:" + chunk.join("|"))); } return out; }
  function inLib(w) { const l = lib(); return l.find((x) => x.id === w.id || (w.doi && x.doi && x.doi.toLowerCase() === w.doi.toLowerCase()) || (x.title && w.title && x.title.toLowerCase() === w.title.toLowerCase())); }
  function addLib(w) { const l = lib(); if (inLib(w)) return false; l.unshift(Object.assign({}, w, { status: "todo", tags: [], added: Date.now() })); setLib(l); return true; }
  function upd(id, patch) { const l = lib(); const i = l.findIndex((x) => x.id === id); if (i < 0) return; l[i] = Object.assign(l[i], patch); setLib(l); return l[i]; }

  /* ================================================================== 화면 */
  async function paint(area) {
    S.area = area;
    try { S.list = (await RND.ws.req("projects")).list || []; } catch (e) { area.innerHTML = '<p class="lb-warn">' + esc(e.message) + "</p>"; return; }
    if (!S.list.length) { area.innerHTML = '<div class="sv hub"><div class="hub-head"><div><h2>문헌·선행연구</h2></div></div><p class="sh-muted">연구 프로젝트를 먼저 만드세요 — 서재는 프로젝트마다 따로예요.</p></div>'; return; }
    let pid = P("hub.rnd", "") || (RND.cur && RND.cur()) || S.list[0].id; if (!S.list.some((p) => p.id === pid)) pid = S.list[0].id; S.pid = pid;
    const TABS = [["find", "🔎 찾기"], ["lib", "📚 서재"], ["mx", "▦ 비교표"], ["map", "🕸 인용 지도"], ["rw", "✍ 관련 연구 쓰기"]];
    area.innerHTML = '<div class="sv ll" id="ll"><div class="ll-top"><div class="ll-t1"><b>📚 문헌·선행연구 작업실</b><select id="llProj" class="pp-proj">' + S.list.map((p) => '<option value="' + esc(p.id) + '"' + (p.id === S.pid ? " selected" : "") + ">" + esc(p.name) + '</option>').join("") + '</select><span class="ll-cnt" id="llCnt"></span></div>' +
      '<nav class="ll-tabs">' + TABS.map((t) => '<button type="button" data-lt="' + t[0] + '" class="' + (S.tab === t[0] ? "on" : "") + '">' + t[1] + "</button>").join("") + "</nav></div>" +
      '<div class="ll-body"><main class="ll-main" id="llMain"></main><aside class="ll-det" id="llDet"></aside></div></div>';
    $("llProj").addEventListener("change", (e) => { PS("hub.rnd", e.target.value); paint(area); });
    if (window.AITASK) {   // (v124) 주제 하나로 문헌 검토를 서버 작업으로
      area.querySelector(".ll-t1").insertAdjacentHTML("beforeend", '<button type="button" class="ghost-btn small-btn" id="llAiTask">AI 로 한 번에 검토</button>');
      $("llAiTask").onclick = async () => { const p = S.list.find((x) => x.id === S.pid) || {}; const t = prompt("어떤 주제를 검토할까요?", p.goal || p.name || ""); if (t == null || !t.trim()) return; try { const j = await AITASK.start("litreview", S.pid, "", t.trim()); AITASK.open(j.id); } catch (e) { alert(e.message); } };
    }
    area.onclick = onClick; paintTab(); paintDet(); count();
  }
  function count() { const l = lib(); const el = $("llCnt"); if (el) el.innerHTML = "서재 <b>" + l.length + "</b> · 읽음 " + l.filter((x) => x.status === "read" || x.status === "cited").length + " · 인용 " + l.filter((x) => x.status === "cited").length; }
  function paintTab() {
    document.querySelectorAll("#ll [data-lt]").forEach((b) => b.classList.toggle("on", b.dataset.lt === S.tab));
    const m = $("llMain"); if (!m) return;
    if (S.tab === "find") return paintFind(m); if (S.tab === "lib") return paintLib(m); if (S.tab === "mx") return paintMx(m); if (S.tab === "map") return paintMap(m); if (S.tab === "rw") return paintRw(m);
  }
  function card(w, opt) {
    const have = inLib(w); opt = opt || {};
    return '<article class="ll-card' + (S.sel && S.sel.id === w.id ? " on" : "") + '" data-w="' + esc(w.id) + '">' + (opt.check ? '<input type="checkbox" class="ll-ck" data-pk="' + esc(w.id) + '"' + (S.pick[w.id] ? " checked" : "") + ">" : "") +
      '<div class="ll-cb"><b>' + esc(w.title) + "</b><small>" + esc((w.authors || "").split(", ").slice(0, 3).join(", ")) + (String(w.authors || "").split(", ").length > 3 ? " 외" : "") + " · " + esc(w.year || "") + (w.venue ? " · <i>" + esc(w.venue) + "</i>" : "") + "</small>" +
      (opt.abs && w.abstract ? '<p class="ll-abs">' + esc(w.abstract.slice(0, 320)) + (w.abstract.length > 320 ? "…" : "") + "</p>" : "") +
      '<div class="ll-meta">' + (w.cited ? '<em class="c">인용 ' + Number(w.cited).toLocaleString() + "</em>" : "") + (w.oa ? '<em class="oa">PDF 공개</em>' : "") + (w.status && have ? '<em class="st">' + (STATUS.find((s) => s[0] === w.status) || [0, ""])[1] + "</em>" : "") + (w.tags || []).map((t) => '<em class="tg">#' + esc(t) + "</em>").join("") + (w.summary ? '<em class="ai">AI 요약</em>' : "") + "</div></div>" +
      (opt.add !== false ? '<button type="button" class="ll-add' + (have ? " in" : "") + '" data-add="' + esc(w.id) + '">' + (have ? "✓ 서재" : "＋ 서재") + "</button>" : "") + "</article>";
  }
  /* ---------------- 🔎 찾기 ---------------- */
  function paintFind(m) {
    m.innerHTML = '<div class="ll-sbar"><input id="llQ" type="search" placeholder="주제·키워드 (영어가 잘 찾아져요) — 예: graph neural network urban safety" value="' + esc(S.q) + '"><button type="button" class="primary" data-ll="go">찾기</button></div>' +
      '<div class="ll-filt"><label>이후 연도 <input id="llFrom" type="number" min="1950" max="2030" placeholder="예: 2020" value="' + esc(S.f.from) + '"></label><label><input type="checkbox" id="llOa"' + (S.f.oa ? " checked" : "") + "> PDF 공개만</label><label>정렬 <select id=\"llSort\"><option value=\"relevance\">관련도</option><option value=\"cited\">인용 많은 순</option><option value=\"new\">최신 순</option></select></label>" +
      '<span class="ll-hint">🔎 근거 있는 검색: OpenAlex(2억+ 학술 문헌) · 검색어만 보내요</span></div><div id="llRes" class="ll-list"></div>';
    $("llSort").value = S.f.sort;
    $("llQ").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); doSearch(); } });
    ["llFrom", "llOa", "llSort"].forEach((id) => $(id).addEventListener("change", () => { S.f = { from: $("llFrom").value, oa: $("llOa").checked, sort: $("llSort").value }; PS("ll.f", S.f); if (S.q) doSearch(); }));
    paintRes();
  }
  async function doSearch() {
    S.q = ($("llQ").value || "").trim(); PS("ll.q", S.q); if (!S.q) return;
    const box = $("llRes"); box.innerHTML = '<p class="sh-muted"><span class="lb-dots"><i></i><i></i><i></i></span> 찾는 중…</p>';
    try { S.res = await oaSearch(); paintRes(); } catch (e) { box.innerHTML = '<p class="lb-warn">' + esc(e.message) + "</p>"; }
  }
  function paintRes() {
    const box = $("llRes"); if (!box) return;
    if (!S.res.length) { box.innerHTML = S.q ? '<p class="sh-muted">결과가 없어요. 영어 키워드로 바꿔 보세요.</p>' : '<div class="ll-empty"><span>🔎</span><b>주제로 논문을 찾아 서재에 모아요</b><p>담은 논문은 읽기 상태 보드·비교표·인용 지도·관련 연구 쓰기로 이어져요. 프로젝트의 참고문헌 관리와 같은 목록이에요.</p></div>'; return; }
    const yrs = {}; S.res.forEach((w) => { if (w.year) yrs[w.year] = (yrs[w.year] || 0) + 1; }); const ys = Object.keys(yrs).sort(); const mx = Math.max(1, ...Object.values(yrs));
    box.innerHTML = '<div class="ll-rhead"><span>' + S.res.length + '건</span><div class="ll-spark" title="연도별 결과 수">' + ys.map((y) => '<i style="height:' + Math.round(yrs[y] / mx * 100) + '%" title="' + y + ": " + yrs[y] + '건"></i>').join("") + "</div><small>" + (ys[0] || "") + "–" + (ys[ys.length - 1] || "") + "</small></div>" + S.res.map((w) => card(w, { abs: true })).join("");
  }
  /* ---------------- 📚 서재 보드 ---------------- */
  function paintLib(m) {
    const l = lib(); const q = (S.lq || "").toLowerCase(); const tag = S.ltag || "";
    const tags = {}; l.forEach((x) => (x.tags || []).forEach((t) => { tags[t] = (tags[t] || 0) + 1; }));
    const f = l.filter((x) => (!q || (x.title + " " + x.authors + " " + (x.note || "")).toLowerCase().indexOf(q) >= 0) && (!tag || (x.tags || []).indexOf(tag) >= 0));
    m.innerHTML = '<div class="ll-lbar"><input id="llLq" type="search" placeholder="서재에서 거르기 (제목·저자·메모)" value="' + esc(S.lq || "") + '"><span class="ll-tags">' + Object.keys(tags).sort().map((t) => '<button type="button" data-tag="' + esc(t) + '" class="' + (t === tag ? "on" : "") + '">#' + esc(t) + " " + tags[t] + "</button>").join("") + '</span><button type="button" class="ghost-btn small-btn" data-ll="bibtex">⬇ BibTeX</button><button type="button" class="ghost-btn small-btn" data-ll="aisum">✨ 요약 없는 논문 AI 요약</button></div>' +
      (l.length ? '<div class="ll-board">' + STATUS.map((s) => { const col = f.filter((x) => x.status === s[0]); return '<section class="ll-col" data-col="' + s[0] + '"><h4>' + s[1] + " <small>" + col.length + '</small></h4><div class="ll-cards">' + col.map((w) => '<div class="ll-mini' + (S.sel && S.sel.id === w.id ? " on" : "") + '" draggable="true" data-w="' + esc(w.id) + '"><b>' + esc(w.title) + "</b><small>" + esc(String(w.authors || "").split(", ")[0] || "") + " · " + esc(w.year || "") + (w.cited ? " · 인용 " + w.cited : "") + "</small>" + (w.rating ? '<span class="ll-star">' + "★".repeat(w.rating) + "</span>" : "") + ((w.tags || []).length ? '<span class="ll-mt">' + w.tags.map((t) => "#" + esc(t)).join(" ") + "</span>" : "") + "</div>").join("") + "</div></section>"; }).join("") + "</div>" : '<div class="ll-empty"><span>📚</span><b>서재가 비어 있어요</b><p>🔎 찾기에서 논문을 담거나, 연구지원 작업실의 참고문헌 관리에서 넣은 항목이 여기에 보여요.</p></div>');
    const lq = $("llLq"); if (lq) lq.addEventListener("input", () => { S.lq = lq.value; clearTimeout(S._lt); S._lt = setTimeout(() => { paintLib(m); const x = $("llLq"); x.focus(); x.setSelectionRange(x.value.length, x.value.length); }, 200); });
    m.ondragstart = (e) => { const c = e.target.closest("[data-w]"); if (c) e.dataTransfer.setData("text/ll", c.dataset.w); };
    m.ondragover = (e) => { const c = e.target.closest(".ll-col"); if (c) { e.preventDefault(); m.querySelectorAll(".ll-col").forEach((x) => x.classList.toggle("drop", x === c)); } };
    m.ondrop = (e) => { const c = e.target.closest(".ll-col"); const id = e.dataTransfer.getData("text/ll"); m.querySelectorAll(".ll-col").forEach((x) => x.classList.remove("drop")); if (!c || !id) return; e.preventDefault(); upd(id, { status: c.dataset.col }); paintLib(m); count(); if (S.sel && S.sel.id === id) { S.sel = lib().find((x) => x.id === id); paintDet(); } };
  }
  /* ---------------- ▦ 비교표 ---------------- */
  function mx() { const d = P(mk(), null) || {}; d.cols = d.cols || ["연구 목적", "방법", "데이터", "주요 결과", "한계"]; d.cells = d.cells || {}; d.rows = d.rows || []; return d; }
  function paintMx(m) {
    const d = mx(), l = lib(); const rows = (d.rows.length ? d.rows : l.slice(0, 12).map((x) => x.id)).map((id) => l.find((x) => x.id === id)).filter(Boolean);
    m.innerHTML = '<div class="ll-lbar"><b>선행연구 비교표</b><span class="sh-muted">논문 ' + rows.length + " × 관점 " + d.cols.length + '</span><span style="flex:1"></span><button type="button" class="ghost-btn small-btn" data-ll="mxrows">논문 고르기</button><button type="button" class="ghost-btn small-btn" data-ll="mxcol">＋ 관점</button><button type="button" class="primary small-btn" data-ll="mxfill">✨ AI 로 빈 칸 채우기</button><button type="button" class="ghost-btn small-btn" data-ll="gap">🕳 연구 공백 찾기</button><button type="button" class="ghost-btn small-btn" data-ll="mxexp">→ 보고서·논문으로</button></div>' +
      (rows.length ? '<div class="ll-mxw"><table class="ll-mx"><thead><tr><th>논문</th>' + d.cols.map((c, i) => '<th><span contenteditable="true" data-mxh="' + i + '">' + esc(c) + '</span><button type="button" data-mxdel="' + i + '" title="관점 지우기">×</button></th>').join("") + "</tr></thead><tbody>" +
        rows.map((w) => '<tr><th data-w="' + esc(w.id) + '"><b>' + esc(w.title.slice(0, 70)) + "</b><small>" + esc(String(w.authors || "").split(", ")[0] || "") + " " + esc(w.year || "") + "</small></th>" + d.cols.map((c) => '<td contenteditable="true" data-mxc="' + esc(w.id) + "|" + esc(c) + '">' + esc(((d.cells[w.id] || {})[c]) || "") + "</td>").join("") + "</tr>").join("") + "</tbody></table></div>" : '<div class="ll-empty"><span>▦</span><b>서재에 논문을 담으면 비교표를 만들 수 있어요</b></div>') + '<div id="llGap"></div>';
    m.oninput = (e) => { const c = e.target.closest("[data-mxc]"); const h = e.target.closest("[data-mxh]"); const d2 = mx(); if (c) { const [id, col] = c.dataset.mxc.split("|"); (d2.cells[id] = d2.cells[id] || {})[col] = c.textContent; PS(mk(), d2); } if (h) { const i = +h.dataset.mxh, old = d2.cols[i], nw = h.textContent.trim() || old; Object.keys(d2.cells).forEach((id) => { if (d2.cells[id][old] != null) { d2.cells[id][nw] = d2.cells[id][old]; if (nw !== old) delete d2.cells[id][old]; } }); d2.cols[i] = nw; PS(mk(), d2); } };
    if (S.gap) $("llGap").innerHTML = S.gap;
  }
  async function mxFill() {
    const d = mx(), l = lib(); const rows = (d.rows.length ? d.rows : l.slice(0, 12).map((x) => x.id)).map((id) => l.find((x) => x.id === id)).filter(Boolean);
    const todo = rows.filter((w) => d.cols.some((c) => !((d.cells[w.id] || {})[c] || "").trim())); if (!todo.length) return toast("빈 칸이 없어요");
    toast("AI 가 초록을 읽고 채우는 중… (" + todo.length + "편)", 8000);
    for (let i = 0; i < todo.length; i += 4) {
      const part = todo.slice(i, i + 4);
      try {
        const r = await TK.aiJSON({ sys: "당신은 선행연구를 비교 정리하는 연구 조교입니다. 초록에 있는 내용만 한국어로 짧게(칸마다 25자 안팎) 쓰고, 없으면 '초록에 없음'.", user: "관점: " + d.cols.join(", ") + "\n\n" + part.map((w, k) => "[" + (k + 1) + "] id=" + w.id + "\n제목: " + w.title + "\n연도: " + w.year + "\n초록: " + (w.abstract || "(초록 없음 — 제목으로만 추정 금지, '초록에 없음')").slice(0, 1800)).join("\n\n"), shape: '{"rows":[{"id":"","cells":{"관점":"내용"}}]}', tokens: 2200 });
        (r.rows || []).forEach((x) => { const w = part.find((p) => p.id === x.id) || part[(r.rows || []).indexOf(x)]; if (!w) return; d.cells[w.id] = d.cells[w.id] || {}; d.cols.forEach((c) => { if (!(d.cells[w.id][c] || "").trim() && x.cells && x.cells[c]) d.cells[w.id][c] = String(x.cells[c]).slice(0, 200); }); });
        PS(mk(), d); if (S.tab === "mx") paintMx($("llMain"));
      } catch (e) { toast(e.message, 5000); break; }
    }
  }
  async function findGap() {
    const d = mx(), l = lib(); const rows = (d.rows.length ? d.rows : l.slice(0, 12).map((x) => x.id)).map((id) => l.find((x) => x.id === id)).filter(Boolean);
    const tbl = rows.map((w) => "- " + w.title + " (" + w.year + "): " + d.cols.map((c) => c + "=" + ((d.cells[w.id] || {})[c] || "?")).join(" / ")).join("\n");
    let proj = ""; try { const p = S.list.find((x) => x.id === S.pid); proj = p ? p.name + " — " + (p.goal || "") : ""; } catch (e) { /* 계속 */ }
    $("llGap").innerHTML = '<div class="ll-gapbox"><span class="lb-dots"><i></i><i></i><i></i></span> 비교표를 읽고 공백을 찾는 중…</div>';
    try {
      const t = await TK.ai({ sys: "당신은 연구 공백을 찾아내는 시니어 연구자입니다. 비교표에 있는 것만 근거로, 한국어로.", user: "[우리 연구] " + proj + "\n[선행연구 비교표]\n" + tbl + "\n\n다음 형식으로: ## 지금까지 밝혀진 것(3줄) ## 연구 공백 3~5개(각각: 공백 · 근거가 된 논문 · 우리 연구가 채울 수 있는 방법) ## 차별점 한 문장", tokens: 1600 });
      S.gap = '<div class="ll-gapbox"><div class="ll-gaph"><b>🕳 연구 공백</b><button type="button" class="ghost-btn small-btn" data-ll="gapdoc">→ 보고서 작업 문서로</button></div><div class="tk-md">' + TK.md(t) + "</div></div>"; S.gapMd = t; $("llGap").innerHTML = S.gap;
    } catch (e) { $("llGap").innerHTML = '<p class="lb-warn">' + esc(e.message) + "</p>"; }
  }
  function mxMarkdown() { const d = mx(), l = lib(); const rows = (d.rows.length ? d.rows : l.slice(0, 12).map((x) => x.id)).map((id) => l.find((x) => x.id === id)).filter(Boolean); return "<표> 선행연구 비교\n| 논문 | " + d.cols.join(" | ") + " |\n|" + d.cols.map(() => "---|").join("") + "---|\n" + rows.map((w) => "| " + (String(w.authors || "").split(", ")[0] || "").split(" ").pop() + " (" + w.year + ") | " + d.cols.map((c) => ((d.cells[w.id] || {})[c] || "").replace(/\|/g, "/")).join(" | ") + " |").join("\n"); }
  /* ---------------- 🕸 인용 지도 ---------------- */
  async function paintMap(m) {
    const l = lib().filter((x) => x.oaid || /^https:\/\/openalex/.test(x.id));
    m.innerHTML = '<div class="ll-lbar"><b>인용 지도</b><span class="sh-muted">서재 논문 ' + l.length + "편 — 화살표 = 인용, 원 크기 = 인용 수, 색 = 연도</span><span style=\"flex:1\"></span><button type=\"button\" class=\"ghost-btn small-btn\" data-ll=\"refresh\">⟳ 인용 정보 새로</button></div>" + '<div class="ll-mapw"><svg id="llSvg" class="ll-svg"></svg><div class="ll-miss" id="llMiss"></div></div>';
    if (l.length < 2) { $("llSvg").outerHTML = '<div class="ll-empty"><span>🕸</span><b>🔎 찾기로 담은 논문(OpenAlex)이 2편 이상이면 그려져요</b></div>'; return; }
    const need = l.filter((x) => !x.refs); if (need.length) { try { const ws = await oaIds(need.map((x) => x.oaid || x.id)); const L = lib(); ws.forEach((w) => { const i = L.findIndex((x) => (x.oaid || x.id) === w.id); if (i >= 0) { L[i].refs = w.refs; L[i].related = w.related; L[i].cited = w.cited; } }); setLib(L); } catch (e) { /* 계속 */ } }
    const L = lib().filter((x) => x.oaid || /^https:\/\/openalex/.test(x.id)); const idx = {}; L.forEach((x, i) => { idx[x.oaid || x.id] = i; });
    const edges = []; L.forEach((x, i) => (x.refs || []).forEach((r) => { if (idx[r] != null) edges.push([i, idx[r]]); }));
    drawGraph($("llSvg"), L, edges);
    // 놓친 핵심 논문: 서재가 많이 인용하지만 아직 없는 것
    const cnt = {}; L.forEach((x) => (x.refs || []).forEach((r) => { if (idx[r] == null) cnt[r] = (cnt[r] || 0) + 1; }));
    const top = Object.keys(cnt).filter((k) => cnt[k] >= 2).sort((a, b) => cnt[b] - cnt[a]).slice(0, 12);
    const box = $("llMiss"); box.innerHTML = '<h4>🧭 놓친 핵심 논문 <small>서재의 2편 이상이 인용</small></h4>' + (top.length ? '<p class="sh-muted"><span class="lb-dots"><i></i><i></i><i></i></span></p>' : '<p class="sh-muted">아직 없어요 — 서재가 커지면 보여요.</p>');
    if (top.length) { try { const ws = await oaIds(top); ws.sort((a, b) => cnt[b.id] - cnt[a.id]); S.res = S.res.concat(ws.filter((w) => !S.res.some((r) => r.id === w.id))); box.innerHTML = '<h4>🧭 놓친 핵심 논문 <small>서재의 2편 이상이 인용</small></h4>' + ws.map((w) => '<div class="ll-mrow" data-w="' + esc(w.id) + '"><b>' + esc(w.title) + "</b><small>" + esc(w.year || "") + " · 서재 " + cnt[w.id] + "편이 인용 · 전체 인용 " + w.cited + '</small><button type="button" class="ll-add" data-add="' + esc(w.id) + '">＋ 서재</button></div>').join(""); } catch (e) { box.innerHTML += '<p class="lb-warn">' + esc(e.message) + "</p>"; } }
  }
  function drawGraph(svg, L, edges) {
    const W = svg.clientWidth || 700, H = svg.clientHeight || 520; const n = L.length;
    const P2 = L.map((x, i) => ({ x: W / 2 + Math.cos(i / n * 6.283) * W * 0.32, y: H / 2 + Math.sin(i / n * 6.283) * H * 0.32, vx: 0, vy: 0 }));
    for (let it = 0; it < 260; it++) {
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const dx = P2[i].x - P2[j].x, dy = P2[i].y - P2[j].y, d2 = dx * dx + dy * dy + 0.01, f = 2600 / d2; P2[i].vx += dx * f / Math.sqrt(d2); P2[i].vy += dy * f / Math.sqrt(d2); P2[j].vx -= dx * f / Math.sqrt(d2); P2[j].vy -= dy * f / Math.sqrt(d2); }
      edges.forEach(([a, b]) => { const dx = P2[b].x - P2[a].x, dy = P2[b].y - P2[a].y; P2[a].vx += dx * 0.012; P2[a].vy += dy * 0.012; P2[b].vx -= dx * 0.012; P2[b].vy -= dy * 0.012; });
      P2.forEach((p) => { p.vx += (W / 2 - p.x) * 0.004; p.vy += (H / 2 - p.y) * 0.004; p.x += p.vx * 0.5; p.y += p.vy * 0.5; p.vx *= 0.6; p.vy *= 0.6; p.x = Math.max(30, Math.min(W - 30, p.x)); p.y = Math.max(30, Math.min(H - 30, p.y)); });
    }
    const ys = L.map((x) => +x.year || 2000), y0 = Math.min(...ys), y1 = Math.max(...ys); const col = (y) => { const t = y1 > y0 ? (y - y0) / (y1 - y0) : 1; return "hsl(" + Math.round(220 - t * 190) + ",70%,52%)"; };
    const rad = (c) => 7 + Math.min(18, Math.sqrt(c || 0) / 3);
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.innerHTML = '<defs><marker id="llAr" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#94a3b8"/></marker></defs>' +
      edges.map(([a, b]) => { const pa = P2[a], pb = P2[b], dx = pb.x - pa.x, dy = pb.y - pa.y, d = Math.sqrt(dx * dx + dy * dy) || 1, r = rad(L[b].cited) + 2; return '<line x1="' + pa.x + '" y1="' + pa.y + '" x2="' + (pb.x - dx / d * r) + '" y2="' + (pb.y - dy / d * r) + '" stroke="#cbd5e1" stroke-width="1.3" marker-end="url(#llAr)"/>'; }).join("") +
      L.map((x, i) => '<g class="ll-node" data-w="' + esc(x.id) + '"><circle cx="' + P2[i].x + '" cy="' + P2[i].y + '" r="' + rad(x.cited) + '" fill="' + col(+x.year || y0) + '" stroke="#fff" stroke-width="2"><title>' + esc(x.title + " (" + x.year + ", 인용 " + (x.cited || 0) + ")") + '</title></circle><text x="' + P2[i].x + '" y="' + (P2[i].y + rad(x.cited) + 12) + '" text-anchor="middle">' + esc((String(x.authors || "").split(", ")[0] || "").split(" ").pop() + " " + (x.year || "")) + "</text></g>").join("") +
      '<g class="ll-leg"><text x="12" y="' + (H - 12) + '">' + y0 + '</text><rect x="44" y="' + (H - 22) + '" width="90" height="10" rx="5" fill="url(#llG)"/><text x="140" y="' + (H - 12) + '">' + y1 + '</text></g><defs><linearGradient id="llG"><stop offset="0" stop-color="hsl(220,70%,52%)"/><stop offset="1" stop-color="hsl(30,70%,52%)"/></linearGradient></defs>';
  }
  /* ---------------- ✍ 관련 연구 쓰기 ---------------- */
  function paintRw(m) {
    const l = lib(); const picked = l.filter((x) => S.pick[x.id]);
    m.innerHTML = '<div class="ll-rw"><div class="ll-rwl"><div class="ll-lbar"><b>쓸 논문 고르기</b><span class="sh-muted">' + picked.length + "편 고름</span><span style=\"flex:1\"></span><button type=\"button\" class=\"ghost-btn small-btn\" data-ll=\"pickread\">읽음·인용함 모두</button></div><div class=\"ll-list\">" + (l.length ? l.map((w) => card(w, { check: true, add: false })).join("") : '<p class="sh-muted">서재가 비어 있어요.</p>') + "</div></div>" +
      '<div class="ll-rwr"><div class="ll-rwo"><label>글 <select id="llRwLang"><option value="ko">한국어 학술 문체</option><option value="en">English academic</option></select></label><label>묶는 방식 <select id="llRwGroup"><option value="theme">주제별 묶음</option><option value="time">시간 흐름</option><option value="method">방법별</option></select></label><label>보낼 곳 <select id="llRwTo"><option value="paper">논문 원고(LaTeX, \\cite + refs.bib)</option><option value="report">보고서(작업 문서)</option></select></label><button type="button" class="primary" data-ll="rwgo">✨ 관련 연구 쓰기</button></div><div class="ll-rwout tk-md" id="llRwOut"><div class="ll-empty"><span>✍</span><b>고른 논문으로 관련 연구 절을 써요</b><p>초록·AI 요약·내 메모만 근거로 쓰고, 인용 키를 붙여 원고에 바로 넣어요. 비교표·연구 공백이 있으면 함께 반영해요.</p></div></div></div></div>';
  }
  function bibKey(w, used) { const fam = (String((w.authorList || String(w.authors || "").split(", "))[0] || "ref").split(" ").pop() || "ref").toLowerCase().normalize("NFKD").replace(/[^a-z]/g, "") || "ref"; let k = fam + (w.year || "") + ((String(w.title || "").toLowerCase().match(/[a-z]{4,}/) || [""])[0]).slice(0, 6); let kk = k, i = 2; while (used[kk]) kk = k + String.fromCharCode(96 + i++); used[kk] = 1; return kk; }
  function bibOf(w, key) { const al = (w.authorList || String(w.authors || "").replace(/\s외$/, "").split(", ")).filter(Boolean).map((n) => { const p = n.trim().split(/\s+/); return p.length > 1 ? p.pop() + ", " + p.join(" ") : p[0]; }); const t = /proceedings|conference|neurips|icml|iclr|cvpr|acl/i.test(w.venue || "") ? "inproceedings" : w.venue ? "article" : "misc"; return "@" + t + "{" + key + ",\n  title     = {" + w.title + "},\n  author    = {" + al.join(" and ") + "},\n" + (w.venue ? "  " + (t === "inproceedings" ? "booktitle" : "journal  ") + " = {" + w.venue + "},\n" : "") + "  year      = {" + (w.year || "") + "}" + (w.doi ? ",\n  doi       = {" + w.doi + "}" : "") + "\n}"; }
  async function rwGo() {
    const l = lib(); const picked = l.filter((x) => S.pick[x.id]); if (picked.length < 2) return toast("논문을 2편 이상 고르세요");
    const lang = $("llRwLang").value, grp = $("llRwGroup").value, to = $("llRwTo").value; const used = {}; picked.forEach((w) => { w._key = bibKey(w, used); });
    const out = $("llRwOut"); out.innerHTML = '<p class="sh-muted"><span class="lb-dots"><i></i><i></i><i></i></span> 쓰는 중…</p>';
    const d = mx(); const ctx = picked.map((w) => "[" + w._key + "] " + w.title + " (" + w.year + ", " + (w.venue || "") + ")\n초록: " + (w.abstract || "").slice(0, 1200) + (w.summary ? "\n요약: " + JSON.stringify(w.summary) : "") + (w.note ? "\n내 메모: " + w.note : "") + (d.cells[w.id] ? "\n비교표: " + JSON.stringify(d.cells[w.id]) : "")).join("\n\n");
    const fmtRule = to === "paper" ? "LaTeX 본문으로 쓰세요(\\subsection 으로 묶음 제목, 인용은 \\cite{키}). 코드펜스 없이." : "마크다운으로 쓰세요(## 묶음 제목, 문단, 인용은 (저자, 연도) 형식).";
    try {
      let txt = await TK.ai({ sys: "당신은 학술 논문의 관련 연구(Related Work) 절을 쓰는 연구자입니다. 주어진 논문 정보에 있는 내용만 쓰고, 논문을 지어내지 마세요.", user: "언어: " + (lang === "en" ? "영어 학술 문체" : "한국어 학술 문체") + "\n묶는 방식: " + { theme: "주제별", time: "시간 흐름", method: "방법별" }[grp] + "\n" + fmtRule + "\n마지막 문단은 기존 연구의 한계와 본 연구의 차별점으로 끝내세요." + (S.gapMd ? "\n[연구 공백 분석]\n" + S.gapMd.slice(0, 2000) : "") + "\n\n[논문]\n" + ctx, tokens: 3000 }, (full) => { out.innerHTML = '<pre class="ll-pre">' + esc(full) + "</pre>"; });
      txt = String(txt || "").replace(/^```\w*\n?|```\s*$/g, "").trim(); S.rw = { txt: txt, to: to, picked: picked.map((w) => ({ w: w, key: w._key })) };
      out.innerHTML = '<div class="ll-rwbar"><button type="button" class="primary small-btn" data-ll="rwput">' + (to === "paper" ? "📄 논문 원고에 넣기(+ refs.bib)" : "📝 보고서 작업 문서로 만들기") + '</button><button type="button" class="ghost-btn small-btn" data-ll="rwcopy">복사</button></div>' + (to === "paper" ? '<pre class="ll-pre">' + esc(txt) + "</pre>" : TK.md(txt));
    } catch (e) { out.innerHTML = '<p class="lb-warn">' + esc(e.message) + "</p>"; }
  }
  async function rwPut() {
    const r = S.rw; if (!r) return;
    if (r.to === "paper") {
      const bib = r.picked.map((x) => bibOf(x.w, x.key)).join("\n\n");
      const res = window.PAPER && PAPER.importFrom ? await PAPER.importFrom(S.pid, { files: { "sections/related-work.tex": "% 관련 연구 — 문헌 작업실에서 " + new Date().toLocaleString("ko-KR") + "\n" + r.txt + "\n" }, bib: bib }) : null;
      r.picked.forEach((x) => upd(x.w.id, { status: "cited", key: x.key })); count();
      toast(res ? "논문 원고에 sections/related-work.tex 를 넣고 .bib 에 " + r.picked.length + "편을 더했어요 — 본문에 \\input{sections/related-work} 를 넣으세요" : "논문 작업실을 한 번 열어 원고를 만든 뒤 다시 시도하세요", 6000);
    } else {
      const html = window.REPORT && REPORT.md ? REPORT.md(r.txt) : "<p>" + esc(r.txt) + "</p>";
      try { const d = await RND.ws.req("doc", { pid: S.pid }, { title: "관련 연구 — " + new Date().toLocaleDateString("ko-KR"), kind: "report", sections: [{ h: "관련 연구", body: r.txt }], html: html, style: { numbering: "korean" }, note: "문헌 작업실" }); toast("보고서 작업 문서 '" + d.doc.title + "' 를 만들었어요 — 📝 보고서 작성·보조에서 열 수 있어요", 5000); } catch (e) { toast(e.message, 5000); }
    }
  }
  /* ---------------- 오른쪽 상세 ---------------- */
  function findW(id) { return lib().find((x) => x.id === id) || S.res.find((x) => x.id === id) || null; }
  function paintDet() {
    const el = $("llDet"); if (!el) return; const w = S.sel ? (findW(S.sel.id) || S.sel) : null;
    if (!w) { el.innerHTML = '<div class="ll-empty sm"><span>📄</span><p>논문을 누르면 여기에 초록·AI 요약·메모가 보여요.</p></div>'; return; }
    const have = inLib(w); const sm = w.summary;
    el.innerHTML = '<div class="ll-dh"><b>' + esc(w.title) + '</b><button type="button" class="pp-ib" data-ll="detx" aria-label="닫기">✕</button></div><p class="ll-dm">' + esc(w.authors || "") + "<br>" + esc(w.year || "") + (w.venue ? " · <i>" + esc(w.venue) + "</i>" : "") + (w.cited ? " · 인용 " + Number(w.cited).toLocaleString() : "") + "</p>" +
      '<div class="ll-dact">' + (have ? "" : '<button type="button" class="primary small-btn" data-add="' + esc(w.id) + '">＋ 서재에 담기</button>') + (w.oa ? '<a class="ghost-btn small-btn" href="' + esc(w.oa) + '" target="_blank" rel="noopener">📕 PDF</a>' : "") + (w.doi ? '<a class="ghost-btn small-btn" href="https://doi.org/' + esc(w.doi) + '" target="_blank" rel="noopener">DOI</a>' : "") + '<button type="button" class="ghost-btn small-btn" data-ll="cites">인용한 논문</button><button type="button" class="ghost-btn small-btn" data-ll="related">관련 논문</button></div>' +
      (have ? '<div class="ll-dst">' + STATUS.map((s) => '<button type="button" data-st="' + s[0] + '" class="' + (have.status === s[0] ? "on" : "") + '">' + s[1] + "</button>").join("") + '</div><div class="ll-drate">' + [1, 2, 3, 4, 5].map((n) => '<button type="button" data-rate="' + n + '" class="' + ((have.rating || 0) >= n ? "on" : "") + '">★</button>').join("") + '<input id="llTags" placeholder="태그 (쉼표로)" value="' + esc((have.tags || []).join(", ")) + '"></div>' : "") +
      '<details open><summary>초록</summary><p class="ll-dabs">' + esc(w.abstract || "초록이 없어요(출판사가 공개하지 않음).") + "</p></details>" +
      '<details open><summary>✨ AI 구조 요약 ' + (sm ? "" : '<button type="button" class="ghost-btn small-btn" data-ll="sum">만들기</button>') + "</summary>" + (sm ? '<dl class="ll-sum">' + [["problem", "문제"], ["method", "방법"], ["result", "결과"], ["limit", "한계"], ["relation", "우리 연구와"]].map((k) => "<dt>" + k[1] + "</dt><dd>" + esc(sm[k[0]] || "-") + "</dd>").join("") + "</dl>" : '<p class="sh-muted">초록을 문제·방법·결과·한계·우리 연구와의 관계로 정리해요.</p>') + "</details>" +
      (have ? '<details open><summary>📝 내 메모</summary><textarea id="llNote" rows="4" placeholder="읽으며 든 생각, 쓸 만한 문장, 비판…">' + esc(have.note || "") + "</textarea></details>" : "") + '<div id="llMore"></div>';
    const nt = $("llNote"); if (nt) nt.addEventListener("input", () => { clearTimeout(nt._t); nt._t = setTimeout(() => upd(w.id, { note: nt.value }), 400); });
    const tg = $("llTags"); if (tg) tg.addEventListener("change", () => { upd(w.id, { tags: tg.value.split(/[,，]/).map((x) => x.trim().replace(/^#/, "")).filter(Boolean).slice(0, 10) }); if (S.tab === "lib") paintLib($("llMain")); });
  }
  async function aiSum(w) {
    const p = S.list.find((x) => x.id === S.pid);
    const r = await TK.aiJSON({ sys: "당신은 논문을 구조적으로 요약하는 연구 조교입니다. 초록에 있는 것만, 한국어로 짧게.", user: "[우리 연구] " + (p ? p.name + " — " + (p.goal || "") : "") + "\n[논문] " + w.title + " (" + w.year + ")\n초록: " + (w.abstract || "").slice(0, 3000), shape: '{"problem":"","method":"","result":"","limit":"","relation":""}', tokens: 900 });
    return r;
  }

  /* ================================================================== 클릭 */
  async function onClick(e) {
    const t = e.target; let b;
    if ((b = t.closest("[data-lt]"))) { S.tab = b.dataset.lt; PS("ll.tab", S.tab); paintTab(); return; }
    if ((b = t.closest("[data-add]"))) { e.stopPropagation(); const w = findW(b.dataset.add); if (w && addLib(w)) { toast("서재에 담았어요"); b.textContent = "✓ 서재"; b.classList.add("in"); count(); if (S.sel && S.sel.id === w.id) paintDet(); } return; }
    if ((b = t.closest("[data-pk]"))) { S.pick[b.dataset.pk] = b.checked; const n = $("llMain").querySelector(".ll-rwl .sh-muted"); if (n) n.textContent = Object.values(S.pick).filter(Boolean).length + "편 고름"; return; }
    if ((b = t.closest("[data-tag]"))) { S.ltag = S.ltag === b.dataset.tag ? "" : b.dataset.tag; paintLib($("llMain")); return; }
    if ((b = t.closest("[data-st]"))) { upd(S.sel.id, { status: b.dataset.st }); paintDet(); count(); if (S.tab === "lib") paintLib($("llMain")); return; }
    if ((b = t.closest("[data-rate]"))) { upd(S.sel.id, { rating: +b.dataset.rate }); paintDet(); return; }
    if ((b = t.closest("[data-mxdel]"))) { const d = mx(); d.cols.splice(+b.dataset.mxdel, 1); PS(mk(), d); paintMx($("llMain")); return; }
    if ((b = t.closest("[data-ll]"))) {
      const k = b.dataset.ll;
      if (k === "go") doSearch();
      if (k === "detx") { S.sel = null; paintDet(); document.querySelectorAll("#ll .on[data-w]").forEach((x) => x.classList.remove("on")); }
      if (k === "sum") { const w = findW(S.sel.id); b.textContent = "만드는 중…"; try { const r = await aiSum(w); if (inLib(w)) upd(w.id, { summary: r }); else w.summary = r; S.sel = findW(w.id) || w; paintDet(); } catch (er) { toast(er.message, 5000); } }
      if (k === "aisum") { const todo = lib().filter((x) => !x.summary && x.abstract).slice(0, 12); if (!todo.length) return toast("요약할 논문이 없어요(초록이 있는 것만)"); toast(todo.length + "편 요약 중…", 8000); for (const w of todo) { try { upd(w.id, { summary: await aiSum(w) }); } catch (er) { toast(er.message); break; } } toast("요약했어요"); paintLib($("llMain")); }
      if (k === "cites" || k === "related") { const w = findW(S.sel.id); const box = $("llMore"); box.innerHTML = '<p class="sh-muted"><span class="lb-dots"><i></i><i></i><i></i></span></p>'; try { let ws = []; const oid = String(w.oaid || w.id || "").replace("https://openalex.org/", ""); if (!/^W\d+/.test(oid)) throw new Error("OpenAlex 로 찾은 논문만 돼요"); if (k === "cites") ws = await oaQuery("per-page=15&sort=cited_by_count:desc&filter=cites:" + oid); else ws = await oaIds((w.related && w.related.length ? w.related : (await oaIds([oid]))[0].related).slice(0, 15)); S.res = S.res.concat(ws.filter((x) => !S.res.some((r) => r.id === x.id))); box.innerHTML = "<h4>" + (k === "cites" ? "이 논문을 인용한 논문" : "관련 논문") + " " + ws.length + "</h4>" + ws.map((x) => card(x, {})).join(""); } catch (er) { box.innerHTML = '<p class="lb-warn">' + esc(er.message) + "</p>"; } }
      if (k === "bibtex") { const used = {}; const txt = lib().map((w) => bibOf(w, w.key || bibKey(w, used))).join("\n\n"); TK.download("library-" + S.pid + ".bib", txt, "text/plain"); }
      if (k === "mxcol") { const n = prompt("새 관점 이름 (예: 평가 지표, 한국 적용 가능성)", ""); if (!n) return; const d = mx(); if (d.cols.indexOf(n) < 0) d.cols.push(n.trim()); PS(mk(), d); paintMx($("llMain")); }
      if (k === "mxrows") { const l = lib(); const d = mx(); const cur = d.rows.length ? d.rows : l.slice(0, 12).map((x) => x.id); const sel = prompt("비교표에 넣을 논문 번호(쉼표, 서재 순서)\n" + l.slice(0, 40).map((x, i) => (i + 1) + ". " + (cur.indexOf(x.id) >= 0 ? "✓ " : "") + x.title.slice(0, 60)).join("\n"), cur.map((id) => l.findIndex((x) => x.id === id) + 1).filter((n) => n > 0).join(",")); if (sel == null) return; d.rows = sel.split(/[,\s]+/).map((n) => l[+n - 1]).filter(Boolean).map((x) => x.id); PS(mk(), d); paintMx($("llMain")); }
      if (k === "mxfill") mxFill();
      if (k === "gap") findGap();
      if (k === "gapdoc" && S.gapMd) { try { const d = await RND.ws.req("doc", { pid: S.pid }, { title: "연구 공백 분석", kind: "report", sections: [{ h: "연구 공백 분석", body: S.gapMd }], html: window.REPORT ? REPORT.md(S.gapMd) : "", style: { numbering: "korean" }, note: "문헌 작업실" }); toast("작업 문서 '" + d.doc.title + "' 를 만들었어요"); } catch (er) { toast(er.message); } }
      if (k === "mxexp") { const md = mxMarkdown(); try { const d = await RND.ws.req("doc", { pid: S.pid }, { title: "선행연구 비교표", kind: "report", sections: [{ h: "선행연구 비교", body: md }], html: window.REPORT ? REPORT.md(md) : "", style: { numbering: "korean" }, note: "문헌 작업실" }); toast("보고서 작업 문서 '" + d.doc.title + "' 로 보냈어요 — 📝 보고서에서 열어 다듬으세요", 5000); } catch (er) { toast(er.message); } }
      if (k === "refresh") { const L = lib(); L.forEach((x) => { delete x.refs; }); setLib(L); paintMap($("llMain")); }
      if (k === "pickread") { lib().forEach((x) => { if (x.status === "read" || x.status === "cited") S.pick[x.id] = true; }); paintRw($("llMain")); }
      if (k === "rwgo") rwGo();
      if (k === "rwput") rwPut();
      if (k === "rwcopy" && S.rw) { try { navigator.clipboard.writeText(S.rw.txt); toast("복사했어요"); } catch (er) { /* 계속 */ } }
      return;
    }
    const n = t.closest("[data-w]"); if (n && !t.closest("a,input,textarea,[contenteditable]")) { const w = findW(n.dataset.w); if (w) { S.sel = w; paintDet(); document.querySelectorAll("#ll [data-w]").forEach((x) => x.classList.toggle("on", x.dataset.w === w.id)); } }
  }

  function build() {
    const content = document.querySelector("main.content"); if (!content || typeof EXT_VIEWS === "undefined") return;
    let a = $("hub_rx_lit"); if (!a) { a = document.createElement("section"); a.id = "hub_rx_lit"; a.className = "hidden"; content.appendChild(a); }
    EXT_VIEWS.rx_lit = { area: a, open: () => paint(a).catch((er) => { a.innerHTML = '<p class="lb-warn">' + esc(er.message) + "</p>"; }) };
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(build, 0)); else setTimeout(build, 30);
  window.LITLAB = { lib: lib };
})();
