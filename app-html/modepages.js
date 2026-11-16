(function () {
  "use strict";
  const esc = (s) => escapeHtml(String(s == null ? "" : s));
  const $ = (id) => document.getElementById(id);
  const isAdmin = () => !!(window.SERVER && SERVER.user && SERVER.user.role === "admin");
  const card = (title, body, id) => '<section class="card sv-card"' + (id ? ' id="' + id + '"' : "") + "><h3>" + title + "</h3>" + body + "</section>";
  const head = (t, p) => '<div class="sv-head"><h2>' + esc(t) + "</h2><p>" + p + "</p></div>";
  const get = (k, d) => (window.TK ? TK.store.get(k, d) : d);
  const set = (k, v) => { if (window.TK) TK.store.set(k, v); };
  const ws = () => window.RND && RND.ws;
  const views = {};

  /* ---------------- 연구지원 설정 ---------------- */
  async function rndset(area) {
    const st = Object.assign({ k: 8, max: 8000 }, get("rnd.settings", {}));
    area.innerHTML = '<div class="sv">' + head("연구지원 설정", "연구 프로젝트 작업에만 쓰는 설정이에요. 테마·글꼴·AI 연결 같은 공통 설정은 [설정]에 있어요.") +
      card("📋 FlowBoard(칸반) 연결", '<div id="msKb"><p class="sh-muted">불러오는 중…</p></div><p class="set-desc">연결하면 연구 프로젝트를 FlowBoard 에픽과 이어서 상태·하위 작업을 보고, 진행 기록을 에픽 댓글로 남길 수 있어요. 연결하지 않아도 프로젝트는 직접 만들어 쓸 수 있어요.</p>') +
      card("🏛 연구행정관리시스템 연결", '<div id="msRnd"><p class="sh-muted">불러오는 중…</p></div><p class="set-desc">과제 정보·일정·인력·예산은 연구행정관리시스템에서 받아 와요. 토큰은 이 서버에 암호화해 두고 브라우저로 내려보내지 않아요.</p>') +
      card("💬 대화 근거 분량", '<div class="sv-grid"><label>질문마다 찾는 발췌 수<select id="msK">' + [4, 6, 8, 12, 16].map((n) => '<option value="' + n + '"' + (n === st.k ? " selected" : "") + ">" + n + "곳</option>").join("") + '</select></label><label>근거 글자 수 상한<select id="msMax">' + [4000, 8000, 12000, 16000, 24000].map((n) => '<option value="' + n + '"' + (n === st.max ? " selected" : "") + ">" + n.toLocaleString() + "자</option>").join("") + '</select></label></div><p class="set-desc">많을수록 답이 꼼꼼하지만 느려지고 AI 사용량이 늘어요. 긴 계획서 여러 개면 12곳·12,000자를 권해요.</p><div class="llm-tools"><button type="button" class="primary big-btn" data-ms="rnd-save">저장</button><span class="sv-msg" id="msMsg"></span></div>') + "</div>";
    if (window.RNDLINK) RNDLINK.connectForm($("msKb"));
    if (window.PINFO) PINFO.connectForm($("msRnd"));
  }
  /* ---------------- 연구지원 관리 ---------------- */
  async function rndadmin(area) {
    if (!isAdmin()) { area.innerHTML = '<div class="sv"><p class="lb-warn">관리자만 볼 수 있어요.</p></div>'; return; }
    area.innerHTML = '<div class="sv">' + head("연구지원 관리", "연구 저장소와 서버 PC 의 폴더 연결을 관리해요. 모든 작업은 감사 기록에 남아요.") +
      card("🗄 저장소", '<div id="msWs">불러오는 중…</div>') +
      card("🔌 연구 허브 AI 게이트웨이", '<div id="msHub">불러오는 중…</div>') +
      card("백업에서 되살리기", '<div id="msBak"><p class="sh-muted">불러오는 중…</p></div><p class="set-desc">프로젝트 하나를 그날 백업 상태로 되돌려요. 지금 내용은 _trash 로 옮겨 두고, 연결된 PC 폴더는 건드리지 않아요.</p>') +
      card("📁 로컬 폴더 · 🗂 마스터 폴더", '<div class="llm-tools"><button type="button" class="ghost-btn big-btn" data-ms="folder">📁 로컬 폴더 연결</button><button type="button" class="ghost-btn big-btn" data-ms="master">🗂 마스터 폴더 등록</button></div><div id="msMasters"></div><p class="set-desc">로컬 폴더는 복사하지 않고 그 자리의 파일 구조 그대로 프로젝트 자료가 돼요(읽기만). 마스터 폴더를 등록하면 하위 폴더 하나하나가 프로젝트가 되고, 새로 생긴 하위 폴더는 [동기화]로 추가해요.</p>') +
      card("📂 전체 프로젝트(이 계정)", '<div id="msProj">불러오는 중…</div>') + "</div>";
    try {
      const h = await ws().req("health");
      $("msWs").innerHTML = '<dl class="sv-dl"><dt>데이터 폴더</dt><dd><code>' + esc(h.dir) + "</code></dd><dt>파이썬</dt><dd><code>" + esc(h.py) + "</code></dd><dt>라이브러리</dt><dd>" + Object.keys(h.libs || {}).map((k) => (h.libs[k] ? "✓ " : "✗ ") + k).join(" · ") + "</dd><dt>백업 스냅숏</dt><dd>" + (h.backups || 0) + "개" + (h.last_backup ? " · 최근 " + esc(h.last_backup) : "") + "</dd><dt>남은 공간</dt><dd>" + (h.free_gb != null ? h.free_gb + "GB" : "-") + '</dd></dl><div class="llm-tools"><button type="button" class="ghost-btn big-btn" data-ms="backup">지금 백업</button><button type="button" class="ghost-btn big-btn" data-acm-go="rndlog">작업 이력 보기</button></div>';
    } catch (e) { $("msWs").innerHTML = '<p class="lb-warn">' + esc(e.message) + "</p>"; }
    if (window.RNDLINK) RNDLINK.paintMasters($("msMasters"), () => rndadmin(area));
    if (window.PINFO) PINFO.hubAdmin($("msHub"));
    backupCard($("msBak"));
    try {
      const pl = (await ws().req("projects")).list || [];
      $("msProj").innerHTML = pl.length ? '<table class="sv-tbl"><thead><tr><th>프로젝트</th><th>연결</th><th>자료·문서</th><th>수정</th><th></th></tr></thead><tbody>' + pl.map((p) => "<tr><td><b>" + esc(p.name) + "</b></td><td>" + (p.source ? '<span class="sv-chip" title="' + esc(p.source.path) + '">📁 ' + esc(String(p.source.path).split(/[\\/]/).pop()) + "</span>" : "") + (p.epic ? '<span class="sv-chip">📋 ' + esc(p.epic.key) + "</span>" : "") + "</td><td>" + ((p.counts || {}).files || 0) + " · " + ((p.counts || {}).docs || 0) + "</td><td>" + new Date(p.updated || 0).toLocaleDateString("ko-KR") + '</td><td class="sv-acts"><button type="button" class="mini-btn" data-ms="open" data-id="' + esc(p.id) + '">열기</button><button type="button" class="mini-btn danger-btn" data-ms="trash" data-id="' + esc(p.id) + '" data-name="' + esc(p.name) + '">휴지통</button></td></tr>').join("") + "</tbody></table>" : '<p class="sh-muted">프로젝트가 없어요.</p>';
    } catch (e) { $("msProj").innerHTML = '<p class="lb-warn">' + esc(e.message) + "</p>"; }
  }
  /* ---------------- 자료 학습 설정 ---------------- */
  function libset(area) {
    const st = Object.assign({ scope: "sec", autoTypo: false, hideDock: false }, get("lib.settings", {}));
    area.innerHTML = '<div class="sv">' + head("자료 학습 설정", "학습 자료 읽기·도구함에만 쓰는 설정이에요. 공통 설정은 [설정]에 있어요.") +
      card("🧰 학습 도구함", '<div class="sv-grid"><label>도구 기본 범위<select id="msScope">' + [["sec", "지금 읽는 부분"], ["all", "문서 전체"], ["sel", "선택한 부분"]].map((o) => '<option value="' + o[0] + '"' + (o[0] === st.scope ? " selected" : "") + ">" + o[1] + "</option>").join("") + "</select></label></div>" +
        '<label class="sv-row"><input type="checkbox" id="msTypo"' + (st.autoTypo ? " checked" : "") + '><span><b>문서를 열 때 내 읽기 설정 자동 적용</b><small>도구함 › 읽기 설정에서 마지막으로 적용한 글자 크기·줄 간격·폭</small></span></label>' +
        '<label class="sv-row"><input type="checkbox" id="msDock"' + (st.hideDock ? " checked" : "") + '><span><b>리딩 메이트 막대 숨기기</b><small>뷰어 아래 막대를 숨겨요(도구함은 Alt+T 로 열기)</small></span></label>' +
        '<div class="llm-tools"><button type="button" class="primary big-btn" data-ms="lib-save">저장</button><span class="sv-msg" id="msMsg"></span></div>') + "</div>";
  }
  /* ---------------- 자료 학습 관리 ---------------- */
  async function libadmin(area) {
    if (!isAdmin()) { area.innerHTML = '<div class="sv"><p class="lb-warn">관리자만 볼 수 있어요.</p></div>'; return; }
    area.innerHTML = '<div class="sv">' + head("자료 학습 관리", "학습 자료 현황을 봐요. 자료는 app-html/library/catalog.json 과 library/docs/ 에 둡니다(도움말 '학습 자료 추가').") + card("📚 학습 자료 현황", '<div id="msLib">불러오는 중…</div>') + "</div>";
    try {
      if (typeof libCatalog === "function") await libCatalog();
      const c = (typeof libState !== "undefined" && libState.catalog) || { docs: [] }; const docs = c.docs || [];
      const by = {}; docs.forEach((d) => { const k = d.domain || "기타"; by[k] = (by[k] || 0) + 1; });
      $("msLib").innerHTML = "<p>문서 <b>" + docs.length + "</b>편</p>" + window.TK.tableHtml([["k", "분류"], ["n", "문서 수"]], Object.keys(by).sort((a, b) => by[b] - by[a]).map((k) => ({ k: k, n: by[k] })));
    } catch (e) { $("msLib").innerHTML = '<p class="lb-warn">' + esc(e.message) + "</p>"; }
  }

  /* ---------------- 자료 학습: 내 학습 폴더 ----------------
   *   문서를 학습 주제별 폴더로 묶고, 문서마다 쌓인 내 데이터(노트·형광펜·북마크·읽은 시간·문답)를 한 표로.
   *   저장: 폴더 구성 = study.user.<id>.tk.lib.folders(서버 library/_folders), 문서 데이터 = 서버 library/<문서 id>/ 폴더. */
  const LF = { sel: "_read", q: "" };
  function docData(id) {
    let hl = []; try { hl = JSON.parse(localStorage.getItem("study.reader.hl." + id) || "[]"); } catch (e) { hl = []; }
    const n = get("lib.notes." + id, null), bm = get("lib.bm." + id, []), so = get("lib.socr." + id, []);
    let sec = 0; try { sec = +localStorage.getItem("study.reader.time." + id) || 0; } catch (e) { sec = 0; }
    return { notes: n && n.t ? n.t.length : 0, noteText: n && n.t || "", hl: hl.length, hlList: hl, bm: bm.length, min: Math.round(sec / 60), socr: so.length };
  }
  // (v102) 오른쪽 칸 — 오늘 다시 읽을 문서 · 다음 읽을 추천(새 문서 먼저) · 최근 학습 일지 · 바로 가기
  function lfAside(docs, used, byId) {
    const today = new Date().toISOString().slice(0, 10), rr = get("lib.reread", {}) || {}, J = get("lib.journal", {}) || {};
    const due = Object.keys(rr).filter((id) => rr[id].due <= today && byId[id]).slice(0, 6);
    const next = docs.filter((d) => used.indexOf(d.id) < 0).sort((a, b) => (a.legacy ? 1 : 0) - (b.legacy ? 1 : 0) || String(b.updated || "").localeCompare(String(a.updated || ""))).slice(0, 6);
    const jd = Object.keys(J).sort().reverse()[0];
    const li = (id, t, sub) => '<button type="button" class="lf-li" data-lf="open" data-id="' + esc(id) + '"><b>' + esc(t) + "</b>" + (sub ? "<small>" + esc(sub) + "</small>" : "") + "</button>";
    return '<aside class="lf-aside">' +
      '<section class="lf-card"><h4>🔁 오늘 다시 읽을 문서 <small>' + due.length + "</small></h4>" + (due.length ? due.map((id) => li(id, byId[id].title, (rr[id].step + 1) + "번째 복습")).join("") : '<p class="sh-muted">오늘은 없어요. 문서를 읽고 도구함의 🔁 다시 읽기 일정에 넣으면 1·3·7·14·30일 뒤에 여기 떠요.</p>') + "</section>" +
      '<section class="lf-card"><h4>✨ 다음에 읽을 추천</h4>' + (next.length ? next.map((d) => li(d.id, d.title, (d.legacy ? "레거시 · " : "") + (d.minutes ? "약 " + d.minutes + "분" : ""))).join("") : '<p class="sh-muted">모두 읽었어요 🎉</p>') + "</section>" +
      '<section class="lf-card"><h4>📓 최근 학습 일지</h4>' + (jd ? '<p class="lf-j"><b>' + esc(jd) + "</b><br>" + esc(String(J[jd].t || "").replace(/[#*]/g, "").slice(0, 220)) + "…</p>" : '<p class="sh-muted">도구함의 📓 오늘의 학습 일지를 누르면 날짜별로 쌓여요.</p>') + "</section>" +
      '<section class="lf-card"><h4>🧭 바로 가기</h4><div class="lf-go">' + [["lx_memory", "🧠 기억·복습"], ["lx_notes", "🗒 노트 허브"], ["lx_plan", "🎯 학습 계획"], ["lx_speak", "🗣 말하기·듣기"]].map((x) => '<button type="button" class="ghost-btn small-btn" data-lf="go" data-id="' + x[0] + '">' + x[1] + "</button>").join("") + "</div></section></aside>";
  }
  // 이 목록 문서들의 최근 형광펜·노트 모아 보기
  function recentMarks(ids, byId) {
    const out = []; ids.filter((id) => byId[id]).forEach((id) => { const x = docData(id); x.hlList.slice(-3).forEach((h) => out.push({ id: id, t: h.text || h.t || String(h), k: "🖍" })); if (x.noteText) out.push({ id: id, t: x.noteText.split(/\n{2,}/).pop().slice(0, 200), k: "🗒" }); });
    if (!out.length) return "";
    return '<h4 class="lf-sub">최근 형광펜·노트</h4><div class="lf-marks">' + out.slice(-12).reverse().map((m) => '<button type="button" class="lf-mark" data-lf="open" data-id="' + esc(m.id) + '"><span>' + m.k + "</span><span>" + esc(String(m.t).slice(0, 160)) + "<small>" + esc(byId[m.id].title) + "</small></span></button>").join("") + "</div>";
  }
  async function libfolders(area) {
    try { if (typeof libCatalog === "function") await libCatalog(); if (window.LIB2 && LIB2.markLegacy) LIB2.markLegacy(); } catch (e) { /* 계속 */ }
    const docs = ((typeof libState !== "undefined" && libState.catalog) || {}).docs || [];
    const byId = {}; docs.forEach((d) => { byId[d.id] = d; });
    const folders = get("lib.folders", []);
    const used = docs.filter((d) => { const x = docData(d.id); return x.notes || x.hl || x.bm || x.min || x.socr; }).map((d) => d.id);
    const cur = LF.sel === "_read" ? { id: "_read", name: "📖 내가 공부한 자료(자동)", docs: used, auto: true } : folders.filter((f) => f.id === LF.sel)[0] || { id: "_read", name: "📖 내가 공부한 자료(자동)", docs: used, auto: true };
    const rows = cur.docs.filter((id) => byId[id]).map((id) => { const d = byId[id], x = docData(id); return { id: id, title: d.title, cat: d.subject || d.category || "", x: x }; });
    const hits = LF.q ? docs.filter((d) => (d.title + " " + (d.subject || "") + " " + (d.tags || []).join(" ")).toLowerCase().indexOf(LF.q.toLowerCase()) >= 0 && cur.docs.indexOf(d.id) < 0).slice(0, 12) : [];
    area.innerHTML = '<div class="sv lf">' + head("내 학습 폴더", "학습 자료를 주제별 폴더로 묶어 관리해요. 문서마다 쌓인 내 데이터(노트·형광펜·북마크·읽은 시간)는 서버의 <code>library/&lt;문서&gt;/</code> 폴더에 문서별로 저장돼요.") +
      '<div class="lf-wrap"><aside class="lf-side"><button type="button" class="lf-f' + (cur.id === "_read" ? " on" : "") + '" data-lf="sel" data-id="_read">📖 공부한 자료 <small>' + used.length + "</small></button>" +
      folders.map((f) => '<button type="button" class="lf-f' + (cur.id === f.id ? " on" : "") + '" data-lf="sel" data-id="' + esc(f.id) + '">📁 ' + esc(f.name) + " <small>" + f.docs.length + "</small></button>").join("") +
      '<div class="lf-new"><input id="lfName" type="text" placeholder="새 폴더 이름"><button type="button" class="primary big-btn" data-lf="new">＋</button></div></aside>' +
      '<section class="lf-main"><div class="lf-h"><b>' + esc(cur.name) + "</b><span>" + (cur.auto ? "" : '<button type="button" class="ghost-btn small-btn" data-lf="rename">이름 바꾸기</button><button type="button" class="ghost-btn small-btn" data-lf="del">폴더 지우기</button>') + '<button type="button" class="ghost-btn small-btn" data-lf="export">⬇ 폴더 학습 묶음(MD)</button></span></div>' +
      (cur.auto ? "" : '<div class="lf-add"><input id="lfQ" type="search" placeholder="이 폴더에 넣을 문서 찾기(제목·분류·태그)" value="' + esc(LF.q) + '">' + (hits.length ? '<div class="lf-hits">' + hits.map((d) => '<button type="button" data-lf="add" data-id="' + esc(d.id) + '">＋ ' + esc(d.title) + " <small>" + esc(d.subject || "") + "</small></button>").join("") + "</div>" : "") + "</div>") +
      (rows.length ? '<table class="sv-tbl"><thead><tr><th>문서</th><th>노트</th><th>형광펜</th><th>북마크</th><th>읽은 시간</th><th></th></tr></thead><tbody>' + rows.map((r) => "<tr><td><b>" + esc(r.title) + "</b><br><small>" + esc(r.cat) + "</small></td><td>" + (r.x.notes ? r.x.notes + "자" : "-") + "</td><td>" + (r.x.hl || "-") + "</td><td>" + (r.x.bm || "-") + "</td><td>" + (r.x.min ? r.x.min + "분" : "-") + '</td><td class="sv-acts"><button type="button" class="mini-btn" data-lf="open" data-id="' + esc(r.id) + '">열기</button>' + (cur.auto ? "" : '<button type="button" class="mini-btn" data-lf="out" data-id="' + esc(r.id) + '">빼기</button>') + "</td></tr>").join("") + "</tbody></table>"
        : '<p class="sh-muted">' + (cur.auto ? "아직 공부한 자료가 없어요 — 학습 자료를 열어 노트·형광펜을 남기면 여기 모여요." : "비어 있어요 — 위에서 문서를 찾아 넣으세요.") + "</p>") +
      (cur.auto ? "" : '<div class="lf-move"><span>공부한 자료 중 이 폴더에 없는 것: </span>' + used.filter((id) => cur.docs.indexOf(id) < 0 && byId[id]).slice(0, 8).map((id) => '<button type="button" class="ghost-btn small-btn" data-lf="add" data-id="' + esc(id) + '">＋ ' + esc(byId[id].title) + "</button>").join("") + "</div>") +
      recentMarks(cur.docs, byId) + "</section>" + lfAside(docs, used, byId) + "</div></div>";
    // (v102) 위쪽 요약 줄 — 빈 공간 없이 한눈에
    const tot = used.reduce((a, id) => { const x = docData(id); a.min += x.min; a.notes += x.notes ? 1 : 0; a.hl += x.hl; a.bm += x.bm; return a; }, { min: 0, notes: 0, hl: 0, bm: 0 });
    const hd = area.querySelector(".sv-head, .lb-hero, h2"); const sum = document.createElement("div"); sum.className = "lf-sum";
    sum.innerHTML = [["📖", used.length + "편", "공부한 문서"], ["⏱", (tot.min >= 60 ? Math.floor(tot.min / 60) + "시간 " : "") + (tot.min % 60) + "분", "읽은 시간"], ["🗒", tot.notes + "편", "노트 쓴 문서"], ["🖍", tot.hl + "개", "형광펜"], ["🔖", tot.bm + "개", "북마크"], ["📁", folders.length + "개", "내 폴더"]].map((s) => "<div><span>" + s[0] + "</span><b>" + s[1] + "</b><small>" + s[2] + "</small></div>").join("");
    const wrap = area.querySelector(".lf-wrap"); if (wrap) wrap.parentNode.insertBefore(sum, wrap); else if (hd) hd.after(sum);
    const q = $("lfQ"); if (q) { q.oninput = () => { LF.q = q.value; clearTimeout(q._t); q._t = setTimeout(() => { libfolders(area); setTimeout(() => { const x = $("lfQ"); if (x) { x.focus(); x.setSelectionRange(x.value.length, x.value.length); } }, 0); }, 250); }; }
    area.onclick = async (e) => {
      const b = e.target.closest("[data-lf]"); if (!b) return;
      const k = b.dataset.lf, fs = get("lib.folders", []);
      const f = fs.filter((x) => x.id === LF.sel)[0];
      if (k === "sel") { LF.sel = b.dataset.id; LF.q = ""; }
      if (k === "new") { const n = ($("lfName").value || "").trim(); if (!n) return; const id = "lf" + Date.now().toString(36); fs.push({ id: id, name: n.slice(0, 40), docs: [], created: Date.now() }); set("lib.folders", fs); LF.sel = id; }
      if (k === "rename" && f) { const n = prompt("폴더 이름", f.name); if (!n) return; f.name = n.slice(0, 40); set("lib.folders", fs); }
      if (k === "del" && f) { if (!confirm("'" + f.name + "' 폴더를 지울까요? (문서와 문서별 데이터는 그대로 남아요)")) return; set("lib.folders", fs.filter((x) => x.id !== f.id)); LF.sel = "_read"; }
      if (k === "add" && f) { if (f.docs.indexOf(b.dataset.id) < 0) f.docs.push(b.dataset.id); set("lib.folders", fs); }
      if (k === "out" && f) { f.docs = f.docs.filter((x) => x !== b.dataset.id); set("lib.folders", fs); }
      if (k === "open") { try { navTo("library"); setTimeout(() => window.libOpen && libOpen(b.dataset.id), 400); } catch (er) { /* 계속 */ } return; }
      if (k === "go") { navTo(b.dataset.id); return; }
      if (k === "export") {
        const name = (f && f.name) || "공부한 자료"; const ids = f ? f.docs : used;
        const md = "# " + name + "\n\n" + ids.filter((id) => byId[id]).map((id) => { const x = docData(id); return "## " + byId[id].title + "\n\n### 노트\n" + (x.noteText || "_없음_") + "\n\n### 형광펜\n" + (x.hlList.map((h) => "> " + (h.text || h.t || h)).join("\n\n") || "_없음_") + "\n\n- 읽은 시간: " + x.min + "분"; }).join("\n\n---\n\n");
        TK.download(TK.slug(name) + "-학습묶음.md", md); return;
      }
      libfolders(area);
    };
  }

  /* (v124) 백업 복원 — 날짜를 고르면 그 백업의 프로젝트가 나오고, 고른 것 하나만 되살린다 */
  async function backupCard(el) {
    if (!el) return;
    let ls = []; try { ls = (await ws().req("backups")).list || []; } catch (e) { el.innerHTML = '<p class="lb-warn">' + esc(e.message) + "</p>"; return; }
    if (!ls.length) { el.innerHTML = '<p class="sh-muted">아직 백업이 없어요. 위의 [지금 백업]으로 만들 수 있어요.</p>'; return; }
    el.innerHTML = '<div class="set-row"><span class="set-label">백업 날짜</span><select id="msBakZ">' + ls.map((b) => '<option value="' + esc(b.name) + '">' + esc(b.name.slice(3, 7) + "-" + b.name.slice(7, 9) + "-" + b.name.slice(9, 11)) + " · " + Math.round(b.size / 1048576) + "MB</option>").join("") + '</select></div><div id="msBakL"></div>';
    const load = async () => {
      const box = $("msBakL"), name = $("msBakZ").value; box.textContent = "읽는 중…";
      let it = []; try { it = (await ws().req("backupitems", { name: name })).list || []; } catch (e) { box.textContent = "⚠ " + e.message; return; }
      box.innerHTML = it.length ? it.map((p) => '<div class="set-row"><span class="set-label">' + esc(p.name || p.pid) + '</span><button type="button" class="ghost-btn small-btn" data-bak="' + esc(p.pid) + '" data-bakn="' + esc(p.name || "") + '">되살리기</button></div>').join("") : '<p class="sh-muted">이 백업에 내 프로젝트가 없어요.</p>';
    };
    $("msBakZ").onchange = load; load();
    el.onclick = async (e) => {
      const b = e.target.closest("[data-bak]"); if (!b) return;
      if (!confirm("'" + b.dataset.bakn + "' 프로젝트를 " + $("msBakZ").value + " 상태로 되돌릴까요?\n\n지금 내용은 _trash 로 옮겨 둡니다.")) return;
      b.disabled = true;
      try { await ws().req("backuprestore", {}, { name: $("msBakZ").value, pid: b.dataset.bak }); b.textContent = "✓ 되살렸어요"; } catch (er) { b.disabled = false; alert(er.message); }
    };
  }

  document.addEventListener("click", async (e) => {
    const b = e.target.closest && e.target.closest("[data-ms]"); if (!b) return;
    const k = b.dataset.ms;
    if (k === "rnd-save") { set("rnd.settings", { k: +$("msK").value, max: +$("msMax").value }); $("msMsg").textContent = "✓ 저장했어요."; }
    if (k === "lib-save") { set("lib.settings", { scope: $("msScope").value, autoTypo: $("msTypo").checked, hideDock: $("msDock").checked }); document.body.classList.toggle("rm-hide", $("msDock").checked); $("msMsg").textContent = "✓ 저장했어요."; }
    if (k === "folder" && window.RNDLINK) RNDLINK.folderDialog("folder", () => rndadmin(views.rndadmin));
    if (k === "master" && window.RNDLINK) RNDLINK.folderDialog("master", () => rndadmin(views.rndadmin));
    if (k === "backup") { b.disabled = true; try { await ws().req("backup", {}, {}); b.textContent = "✓ 백업했어요"; } catch (er) { b.textContent = "⚠ " + er.message; } }
    if (k === "open") RND.open(b.dataset.id);
    if (k === "trash" && confirm("'" + b.dataset.name + "' 프로젝트를 휴지통으로 옮길까요? (서버의 _trash 에서 되살릴 수 있어요. 연결된 로컬 폴더는 건드리지 않아요)")) { await ws().req("trash", { pid: b.dataset.id }, {}); rndadmin(views.rndadmin); }
  });
  // 리딩 메이트 숨기기 · Alt+T 도구함
  try { if ((get("lib.settings", {}) || {}).hideDock) document.body.classList.add("rm-hide"); } catch (e) { /* 계속 */ }
  document.addEventListener("keydown", (e) => { if (e.altKey && (e.key === "t" || e.key === "T")) { const b = document.querySelector('[data-rm="tk"]'); if (b) b.click(); } });

  function build() {
    const content = document.querySelector("main.content"); if (!content || views.rndset || typeof EXT_VIEWS === "undefined") return;
    /* (v125) 설정·관리 안에 묻힌 기능을 메뉴로 꺼낸다. 화면은 그대로 두고 그 칸으로 바로 간다 */
    const go = (id) => setTimeout(() => { const e = $(id); if (e) { e.scrollIntoView({ block: "start", behavior: "instant" }); const c = e.closest(".lf-card,.sv-card,.card,section"); if (c) { c.classList.add("ms-hit"); setTimeout(() => c.classList.remove("ms-hit"), 1600); } } }, 200);   // 화면 전환이 맨 위로 올린 뒤에
    setTimeout(() => {
      [["rndconn", "msRnd"], ["gateway", "msHub"], ["backups", "msBak"]].forEach(([k, id]) => { EXT_VIEWS[k] = { area: views.rndadmin, avail: isAdmin, open: async () => { await rndadmin(views.rndadmin); go(id); } }; });
      const sa = document.getElementById("settingsArea");
      if (sa) EXT_VIEWS.aiconn = { area: sa, open: async () => { try { if (typeof syncSettingsUI === "function") syncSettingsUI(); if (typeof renderLlmSettings === "function") await renderLlmSettings(); } catch (e) { /* 계속 */ } go("setLlmH"); } };
      if (window.SHELL && SHELL.repaintMenu) SHELL.repaintMenu();
    }, 0);
    [["rndset", rndset], ["rndadmin", rndadmin], ["libset", libset], ["libadmin", libadmin], ["libfolders", libfolders]].forEach(([k, fn]) => {
      const a = document.createElement("section"); a.id = "ms_" + k; a.className = "hidden"; content.appendChild(a); views[k] = a;
      EXT_VIEWS[k] = { area: a, open: () => fn(a), avail: k.indexOf("admin") > 0 ? isAdmin : () => true };
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build); else build();
})();
