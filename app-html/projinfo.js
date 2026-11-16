/* =============================================================================
 * projinfo.js (v114) — 🗂 프로젝트 정보·관리 (rx_proj)
 *   연구개발계획서(표지·요약문)의 내용을 구조화해 보여 주고 관리한다.
 *   ※ (v117) 정식 등록·수정은 연구행정관리시스템에서 한다(1순위 r=rnd bundle, FlowBoard 에픽은 대체 경로). 규격: adminv41/docs/RESEARCH-HUB.md. 여기는 그 데이터를 받아(연동) 보여 주는 곳.
 *     연동 전에는 계획서 파일에서 AI 로 미리 채우거나 JSON 을 불러와 '임시 자료'로 둘 수 있고, 연동되면 임시 자료를 덮는다.
 *   저장: TK.store("rnd.pinfo.<pid>") → 서버 projects/<pid>/pinfo (kv_api)
 *   연동 규격: docs/PROJECT-INFO-SYNC.md
 * ========================================================================== */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const P = (k, d) => (window.TK ? TK.store.get(k, d) : d), PS = (k, v) => { if (window.TK) TK.store.set(k, v); };
  const fmtT = (t) => t ? new Date(t).toLocaleString("ko-KR", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  const num = (v) => { const n = parseFloat(String(v == null ? "" : v).replace(/[^\d.\-]/g, "")); return isNaN(n) ? 0 : n; };
  const won = (k) => num(k).toLocaleString("ko-KR");                                   // 천원 그대로
  const eok = (k) => { const v = num(k) / 100000; return (v >= 10 ? v.toFixed(1) : v.toFixed(2)).replace(/\.?0+$/, "") + "억 원"; };   // 천원 → 억 원
  function toast(t, ms) { let el = $("piToast"); if (!el) { el = document.createElement("div"); el.id = "piToast"; el.className = "pp-toast"; document.body.appendChild(el); } el.textContent = t; el.classList.add("on"); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("on"), ms || 2600); }

  /* ---------------- 데이터 모양 ---------------- */
  const person = () => ({ name: "", title: "", phone: "", mobile: "", email: "", rno: "" });
  function blank() {
    return {
      meta: { docType: "신청용", security: "일반", ministry: "", agency: "", program: "", type: "", notice: "", selection: "", totalNo: "", taskNo: "" },
      cls: { ind: [{ name: "", pct: "" }, { name: "", pct: "" }, { name: "", pct: "" }], nat: [{ name: "", pct: "" }, { name: "", pct: "" }, { name: "", pct: "" }] },
      title: { ko: "", en: "" }, umbrella: { ko: "", en: "" },
      org: { name: "", type: "", bizNo: "", corpNo: "", address: "" },
      pi: person(), staff: person(),
      period: { start: "", end: "", years: [] },        // years: [{stage, year, start, end}]
      budget: [],                                        // [{stage, year, gov, oc, ok, xc, xk}] 천원 — oc/ok = 기관부담 현금/현물, xc/xk = 그 외 기관(지자체 등)
      partners: [],                                      // [{name, lead, title, mobile, email, type}]
      summary: { level: "", trlStart: "", trlEnd: "", fee: "", finalGoal: "", years: [], stages: [] },   // years: [{year, goal, content}], stages: [{stage, goal, content}]
      outcome: { plans: "", effects: "" }, keywords: { ko: [], en: [] },
      sync: { source: "", at: 0, ref: "", note: "" }, history: [], bundle: null,
    };
  }
  function norm(d) {
    const b = blank(); d = d && typeof d === "object" ? d : {};
    const merge = (t, s) => { Object.keys(t).forEach((k) => { if (s[k] == null) return; if (Array.isArray(t[k])) t[k] = Array.isArray(s[k]) ? s[k] : t[k]; else if (t[k] && typeof t[k] === "object") merge(t[k], s[k] || {}); else t[k] = s[k]; }); return t; };
    return merge(b, d);
  }
  const has = (d) => !!(d && (d.title.ko || d.org.name || d.budget.length || d.summary.finalGoal));
  const get = (o, path) => path.split(".").reduce((a, k) => (a == null ? a : a[k]), o);
  const set = (o, path, v) => { const ks = path.split("."), last = ks.pop(); const t = ks.reduce((a, k) => (a[k] = a[k] || {}), o); t[last] = v; };
  function flat(o, pre, out) { out = out || {}; Object.keys(o || {}).forEach((k) => { if (k === "sync" || k === "history") return; const v = o[k], p = pre ? pre + "." + k : k; if (v && typeof v === "object" && !Array.isArray(v)) flat(v, p, out); else out[p] = JSON.stringify(v); }); return out; }

  const S = { pid: "", list: [], p: null, d: null, tab: P("pi.tab", "over"), edit: false, area: null };
  const key = () => "rnd.pinfo." + S.pid;
  const locked = () => S.d && (S.d.sync.source === "admin" || S.d.sync.source === "work");                  // 연구행정관리시스템에서 받은 자료는 여기서 고치지 않는다
  function save(src, note, prev) {
    const d = S.d; if (src) { d.sync.source = src; d.sync.at = Date.now(); if (note != null) d.sync.note = note; }
    if (prev) { const a = flat(prev), b = flat(d), ch = Object.keys(Object.assign({}, a, b)).filter((k) => a[k] !== b[k]); d.history = [{ at: Date.now(), source: d.sync.source, note: d.sync.note || "", changed: ch.slice(0, 80), n: ch.length }].concat(d.history || []).slice(0, 20); }
    PS(key(), d);
  }
  const SRC = { admin: ["연구행정관리시스템 연동", "ok"], work: ["FlowBoard 에픽 연동", "ok"], ai: ["계획서에서 AI 로 채운 임시 자료", "tmp"], json: ["JSON 으로 불러온 임시 자료", "tmp"], manual: ["직접 입력한 임시 자료", "tmp"], "": ["비어 있음", "none"] };

  /* ---------------- 기간·예산 계산 ---------------- */
  const pd = (s) => { const m = /(\d{4})\D+(\d{1,2})\D+(\d{1,2})/.exec(String(s || "")); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  function months(a, b) { const x = pd(a), y = pd(b); if (!x || !y) return ""; let m = (y.getFullYear() - x.getFullYear()) * 12 + y.getMonth() - x.getMonth() + (y.getDate() >= x.getDate() - 1 ? 1 : 0); const yy = Math.floor(m / 12), mm = m % 12; return (yy ? yy + "년 " : "") + (mm ? mm + "개월" : "").trim(); }
  const rowSum = (r) => num(r.gov) + num(r.oc) + num(r.ok) + num(r.xc) + num(r.xk);
  function totals(d) { const t = { gov: 0, oc: 0, ok: 0, xc: 0, xk: 0 }; d.budget.forEach((r) => Object.keys(t).forEach((k) => { t[k] += num(r[k]); })); t.cash = t.gov + t.oc + t.xc; t.kind = t.ok + t.xk; t.all = t.cash + t.kind; t.org = t.oc + t.ok; return t; }
  function curYear(d) { const now = new Date(); return d.period.years.findIndex((y) => { const a = pd(y.start), b = pd(y.end); return a && b && now >= a && now <= new Date(b.getTime() + 86400000); }); }

  /* ================================================================== 화면 */
  const TABS = [["over", "📊 한눈에"], ["info", "📄 과제 정보"], ["money", "💰 기간·예산"], ["goal", "🎯 목표·내용"], ["out", "🚀 성과·효과"], ["team", "👥 참여기관"], ["sync", "🔗 업무 연동"]];
  async function paint(area) {
    S.area = area;
    try { S.list = (await RND.ws.req("projects")).list || []; } catch (e) { area.innerHTML = '<p class="lb-warn">' + esc(e.message) + "</p>"; return; }
    if (!S.list.length) { area.innerHTML = '<div class="sv hub"><div class="hub-head"><div><h2>프로젝트 정보·관리</h2></div></div><p class="sh-muted">연구 프로젝트가 없어요.</p></div>'; return; }
    let pid = P("hub.rnd", "") || (RND.cur && RND.cur()) || S.list[0].id; if (!S.list.some((p) => p.id === pid)) pid = S.list[0].id;
    if (pid !== S.pid) { S.edit = false; S.files = null; S.docs = null; S.kb = null; S.autoPull = false; S.pullErr = ""; }
    S.pid = pid; S.p = S.list.find((x) => x.id === pid); S.d = norm(P(key(), null));
    area.onclick = onClick; area.onchange = onChange;
    render(); loadSide();
  }
  // (v115) 오른쪽 칸·시작 화면이 쓰는 프로젝트 자료 — 계획서 후보 파일·문서·FlowBoard 연결 상태
  async function loadSide() {
    const pid = S.pid;
    if (!S.files) {
      let fs = []; try { fs = ((await RND.ws.req("files", { pid: pid })).list || []).map((f) => ({ id: f.id, name: f.name, ext: f.ext, size: f.size, pages: f.pages, chars: f.chars })); } catch (e) { fs = []; }
      if (S.p && S.p.source) { try { const tr = await RND.ws.req("tree", { pid: pid }), hid = (S.p.hidden || []).concat(S.p.removed || []); (tr.list || []).filter((x) => x.doc && !(window.RNDLINK && RNDLINK.isHidden(x.rel, hid))).forEach((x) => fs.push({ id: x.id, name: x.rel, ext: x.ext, size: x.size, pages: x.pages, chars: x.chars, folder: true })); } catch (e) { /* 계속 */ } }
      if (pid !== S.pid) return; S.files = fs;
    }
    if (!S.docs) { try { S.docs = (await RND.ws.req("docs", { pid: pid })).list || []; } catch (e) { S.docs = []; } }
    if (!S.kb && window.RNDLINK && RNDLINK.kb) { try { S.kb = await RNDLINK.kb("status"); } catch (e) { S.kb = { connected: false, error: e.message }; } }
    try { S.rk = await rnd("status"); } catch (e) { S.rk = { connected: false }; }
    if (pid !== S.pid) return;
    paintAside(); if (!has(S.d) && !S.edit && S.tab !== "sync") paintBody();
    // 연결된 과제는 화면을 열 때 조용히 새로 받는다. 끊겨 있으면 마지막 값과 받은 시각을 그대로 보여 준다(규격 1장)
    if (S.p && S.p.rnd && S.rk.connected && !S.autoPull && !S.edit) { S.autoPull = true; pullAdmin(true); }
  }
  const planScore = (f) => (/계획서/.test(f.name) ? 20 : 0) + (/요약문|신청서|제안서|사업계획/.test(f.name) ? 10 : 0) + (/\.pdf$/i.test(f.name) ? 2 : /\.(hwpx?|docx?)$/i.test(f.name) ? 1 : 0) - (/양식|서식|안내|공고문|가이드/.test(f.name) ? 6 : 0);
  const planFiles = () => (S.files || []).filter((f) => /^(pdf|hwp|hwpx|docx?|txt|md)$/i.test(f.ext || "")).sort((a, b) => planScore(b) - planScore(a) || String(a.name).localeCompare(String(b.name), "ko"));
  function adminUrl(tab) { const b = (window.HUBLINK && HUBLINK.pub("admin")) || String((S.rk && S.rk.base) || "").replace(/\/api\.php\/v1\/?$/, ""); return b + "/#/rnd/p/" + encodeURIComponent((S.p.rnd || {}).id || "") + "/" + (tab || "over"); }
  function render() {
    const d = S.d, p = S.p, src = SRC[d.sync.source] || SRC[""];
    S.area.innerHTML = '<div class="sv pi" id="pi"><div class="pi-head"><div class="pi-ht"><div class="sh-kicker">프로젝트 정보·관리</div><h2>' + esc(d.title.ko || p.name) + "</h2>" + (d.title.en ? '<p class="pi-en">' + esc(d.title.en) + "</p>" : "") + "</div>" +
      '<div class="pi-ha"><select id="piSel" class="pp-proj" aria-label="프로젝트">' + S.list.filter((x) => !x.archived || x.id === S.pid).map((x) => '<option value="' + esc(x.id) + '"' + (x.id === S.pid ? " selected" : "") + ">" + esc(x.name) + "</option>").join("") + '</select><button type="button" class="ghost-btn small-btn" data-pi="open">📂 프로젝트 열기</button></div></div>' +
      '<div class="pi-sbar s-' + src[1] + '"><span class="pi-dot"></span><b>' + src[0] + "</b>" + (d.sync.at ? "<small>" + fmtT(d.sync.at) + (d.sync.note ? " · " + esc(d.sync.note) : "") + "</small>" : "<small>입력·수정은 연구행정관리시스템에서 해요. 여기는 받아서 보여 주는 곳이에요.</small>") +
      '<span class="pi-sa">' + (p.rnd && S.rk && S.rk.base ? '<a class="ghost-btn small-btn" href="' + esc(adminUrl("info")) + '" target="_blank" rel="noopener" title="정보를 고치는 곳">연구행정에서 고치기 ↗</a>' : "") + '<button type="button" class="primary small-btn" data-pi="pull">⟳ 연구행정에서 받기</button><button type="button" class="ghost-btn small-btn" data-pi="ai">✨ 계획서에서 채우기</button><button type="button" class="ghost-btn small-btn" data-pi="more">⋯</button>' +
      (S.edit ? '<button type="button" class="primary small-btn" data-pi="done">✓ 고치기 끝</button>' : '<button type="button" class="ghost-btn small-btn" data-pi="edit"' + (locked() && !toAdmin() ? ' title="연구행정관리시스템에서 받은 자료예요 — 그쪽에서 고쳐 주세요"' : "") + ">✎ " + (toAdmin() ? "고치기(연구행정에 저장)" : locked() ? "임시로 고치기" : "고치기") + "</button>") + "</span></div>" +
      '<div class="pi-wrap"><div class="pi-main"><nav class="pi-tabs" role="tablist">' + TABS.map((t) => '<button type="button" role="tab" data-pt="' + t[0] + '"' + (S.tab === t[0] ? ' class="on" aria-selected="true"' : "") + ">" + t[1] + "</button>").join("") + '</nav><div class="pi-body' + (S.edit ? " editing" : "") + '" id="piBody"></div></div><aside class="pi-aside" id="piAside"></aside></div></div>';
    $("piSel").addEventListener("change", (e) => { PS("hub.rnd", e.target.value); paint(S.area); });
    paintBody(); paintAside();
  }
  function paintBody() {
    const el = $("piBody"); if (!el) return; const d = S.d;
    const empty = !has(d) && !S.edit;
    // (v116) 비어 있어도 탭마다 원래 모양(빈 칸)을 보여 준다 — 한눈에는 채우기 시작 칸을 위에, 다른 탭은 얇은 안내 줄
    el.innerHTML = (empty && S.tab === "over" ? emptyHtml() + '<div class="pi-ghw">' + overHtml() + "</div>" : empty && S.tab !== "sync" ? '<div class="pi-nob"><span>아직 받은 과제 정보가 없어서 빈 칸으로 보여요.</span><button type="button" class="ghost-btn small-btn" data-pt="over">✨ 채우기 시작</button><button type="button" class="ghost-btn small-btn" data-pi="edit">✎ 직접 입력</button></div>' : "") + ({ over: overHtml, info: infoHtml, money: moneyHtml, goal: goalHtml, out: outHtml, team: teamHtml, sync: syncHtml }[S.tab] || overHtml)();
    if (S.tab === "sync") paintEpic();
  }
  const FI = (ext) => (window.RNDLINK && RNDLINK.fileIcon ? RNDLINK.fileIcon(String(ext || "").toLowerCase()) : "📄");
  const size = (n) => !n ? "" : n > 1048576 ? (n / 1048576).toFixed(1) + "MB" : Math.max(1, Math.round(n / 1024)) + "KB";
  function emptyHtml() {
    const p = S.p, fs = planFiles(), kb = S.kb, ep = p.epic;
    const files = S.files == null ? '<div class="pi-load"><span class="lb-dots"><i></i><i></i><i></i></span> 프로젝트 자료를 살펴보는 중…</div>'
      : fs.length ? '<div class="pi-fl">' + fs.slice(0, 8).map((f, i) => '<div class="pi-fr' + (i === 0 && planScore(f) >= 10 ? " best" : "") + '"><span class="pi-fi">' + FI(f.ext) + '</span><div><b title="' + esc(f.name) + '">' + esc(String(f.name).split("/").pop()) + "</b><small>" + (i === 0 && planScore(f) >= 10 ? "<em>계획서로 보여요</em>" : "") + esc([f.folder ? String(f.name).split("/").slice(0, -1).join("/") : "", (f.ext || "").toUpperCase(), f.pages ? f.pages + "쪽" : "", size(f.size)].filter(Boolean).join(" · ")) + "</small></div>" + '<button type="button" class="' + (i === 0 ? "primary" : "ghost-btn") + ' small-btn" data-fill="' + esc(f.id) + '">이 파일로 채우기</button></div>').join("") + "</div>" + (fs.length > 8 ? '<button type="button" class="sh-link" data-pi="ai">다른 파일 ' + (fs.length - 8) + "개 더 보기</button>" : "")
      : '<div class="pi-none2"><p>이 프로젝트에 계획서로 쓸 문서(PDF·한글·워드)가 없어요.</p><button type="button" class="ghost-btn small-btn" data-pi="open">📂 연구 프로젝트에서 올리기</button></div>';
    const step = (ok, n, t, sub, act) => '<li class="' + (ok ? "ok" : "") + '"><i>' + (ok ? "✓" : n) + "</i><div><b>" + t + "</b><small>" + sub + "</small>" + (act || "") + "</div></li>";
    const rk = S.rk, conn = rk ? !!rk.connected : null, lk = p.rnd;
    const steps = '<ol class="pi-steps">' +
      step(conn, 1, "연구행정관리시스템 연결", conn == null ? "확인하는 중…" : conn ? "연결됨 · " + esc(rk.base || "") : "아직 연결되지 않았어요", conn ? "" : '<button type="button" class="sh-link" data-pi="link">연결하기 →</button>') +
      step(!!lk, 2, "이 프로젝트를 과제와 연결", lk ? esc((lk.code || "") + " " + (lk.name || "")) : "연구행정관리시스템의 과제를 고르세요", lk || !conn ? "" : '<button type="button" class="sh-link" data-pi="link">과제 고르기 →</button>') +
      step(false, 3, "과제 정보 받기", "정보를 입력·수정하는 곳은 연구행정관리시스템이에요. 여기서는 받아서 보여 줘요.", "") + "</ol>";
    return '<div class="pi-start"><div class="pi-sh"><h3>이 프로젝트의 과제 정보를 채워 주세요</h3><p class="sh-muted">정식 자료는 연구행정관리시스템에서 받아요. 연동 전에는 계획서에서 AI 로 미리 채워 두고, 연동되면 연구행정관리시스템 자료로 바뀌어요.</p></div>' +
      '<div class="pi-sg"><section class="lf-card pi-sc main"><h4>✨ 계획서에서 채우기 <small class="pj-tag">임시 자료</small></h4><p class="sh-muted">표지·요약문이 있는 연구개발계획서를 고르면 AI 가 읽어서 7개 탭을 채워요. 틀린 곳은 ✎ 고치기로 바로잡아요.</p>' + files + "</section>" +
      '<section class="lf-card pi-sc"><h4>⟳ 연구행정에서 받기</h4>' + steps + '<button type="button" class="primary small-btn" data-pi="pull"' + (lk ? "" : " disabled") + '>⟳ 지금 받기</button></section>' +
      '<section class="lf-card pi-sc"><h4>⬆ 직접 넣기</h4><div class="pi-dlist"><button type="button" data-pi="json"><b>⬆ JSON 불러오기</b><small>연구행정관리시스템에서 내보낸 파일이나 다른 프로젝트에서 내보낸 파일</small></button><button type="button" data-pi="tpl"><b>⬇ 빈 양식 내려받기</b><small>rnd-plan/1 모양의 빈 JSON — 채워서 다시 불러오기</small></button><button type="button" data-pi="edit"><b>✎ 직접 입력</b><small>탭마다 칸을 열어 하나씩 적기</small></button></div></section></div>' +
      '<div class="pi-sep"><span>채우면 아래처럼 정리돼요</span></div></div>';
  }
  /* ---- 오른쪽 칸: 과제 요약·지금 연차·프로젝트 현황·바로 가기 ---- */
  /* (v122) 과제 진단 — 받은 과제 정보·일정·의무·산출물·규정 점검을 AI 가 읽어 위험과 오늘 할 일을 뽑는다. 쓰기는 없다 */
  const diagKey = () => "pi.diag." + S.pid;
  function diagHtml() {
    const x = P(diagKey(), null), r = x && x.r, lv = { 좋음: "ok", 주의: "warn", 위험: "bad" };
    return '<section class="lf-card pi-as"><h4>과제 진단</h4>' + (r ? '<p><span class="sh-chip">' + esc(r.level || "") + "</span> " + esc(r.summary || "") + "</p>" +
      ((r.risks || []).length ? "<ul>" + r.risks.map((k) => "<li><b>" + esc(k.title) + "</b> — " + esc(k.why) + (k.do ? "<br><small>→ " + esc(k.do) + "</small>" : "") + "</li>").join("") + "</ul>" : "") +
      ((r.today || []).length ? "<h5>오늘 할 일</h5><ul>" + r.today.map((k) => "<li>" + esc(k) + "</li>").join("") + "</ul>" : "") + '<p class="sh-muted"><small>' + fmtT(x.t) + "</small></p>" : '<p class="sh-muted">일정·예산·산출물·규정 점검을 AI 가 읽어 위험과 오늘 할 일을 뽑아요.</p>') +
      '<button type="button" class="ghost-btn small-btn" data-pi="diag">' + (r ? "다시 진단" : "진단하기") + '</button><p id="piDiagMsg" class="sh-muted"></p></section>';
  }
  async function diagnose() {
    const m = $("piDiagMsg"); if (m) m.textContent = "진단하는 중…";
    try {
      let chk = null; if (S.p.rnd) { try { chk = (await rnd("check", { pid: S.pid })).data; } catch (e) { chk = null; } }
      const d = S.d, B = d.bundle || {}, today = new Date().toISOString().slice(0, 10);
      const src = { 오늘: today, 과제: d.title.ko || S.p.name, 기간: d.period, 예산합계: totals(d), 최종목표: d.summary.finalGoal, 마일스톤: B.milestones, 보고의무: B.obligations, 산출물: B.outputs, 위험: B.risks, 집행: B.budget, 규정점검: chk };
      const r = await TK.aiJSON({ sys: "당신은 국가 R&D 과제 관리 담당자입니다. 주어진 자료에 있는 사실만 근거로 판단합니다. 없는 내용을 지어내지 않습니다. 한국어로 짧게 씁니다.", user: JSON.stringify(src).slice(0, 24000), shape: '{"level":"좋음|주의|위험","summary":"두 문장","risks":[{"title":"위험","why":"근거(날짜·수치)","do":"대응"}],"today":["오늘 할 일"]}', tokens: 1000 });
      PS(diagKey(), { t: Date.now(), r: r }); paintAside();
    } catch (e) { if (m) m.textContent = "⚠ " + e.message; }
  }
  function paintAside() {
    const el = $("piAside"); if (!el || !S.p) return; const d = S.d, p = S.p, ok = has(d), now = new Date();
    let h = diagHtml();
    if (ok) {
      const t = totals(d), cy = curYear(d), y = d.period.years[cy], a = y && pd(y.start), b = y && pd(y.end), all0 = pd(d.period.start), all1 = pd(d.period.end);
      const day = 86400000, dd = (x) => Math.ceil((x - now) / day);
      let cur = "";
      if (y && a && b) { const pr = Math.max(0, Math.min(1, (now - a) / (b - a + day))), r = d.budget[cy], g = d.summary.years[cy];
        cur = '<div class="pi-cur"><div class="pi-curh"><b>' + (cy + 1) + "차년도</b><span>" + esc((y.stage ? y.stage + "단계 " : "") + (y.year ? y.year + "년차" : "")) + '</span><em>D-' + Math.max(0, dd(b)) + '</em></div><div class="pi-pg"><i style="width:' + (pr * 100).toFixed(1) + '%"></i></div><small>' + esc(y.start + " ~ " + y.end) + " · " + Math.round(pr * 100) + "% 지남</small>" +
          (r ? '<div class="pi-cm"><span>올해 연구개발비</span><b>' + eok(rowSum(r)) + "</b><small>정부 " + eok(r.gov) + "</small></div>" : "") + (g && g.goal ? '<div class="pi-cg"><span>이번 연차 목표</span><p>' + esc(g.goal) + "</p></div>" : "") + "</div>"; }
      else if (all0 && now < all0) cur = '<div class="pi-cur"><div class="pi-curh"><b>착수 전</b><em>D-' + dd(all0) + "</em></div><small>" + esc(d.period.start) + " 착수</small></div>";
      else if (all1 && now > all1) cur = '<div class="pi-cur"><div class="pi-curh"><b>종료</b></div><small>' + esc(d.period.end) + " 종료</small></div>";
      h += '<section class="lf-card pi-as"><h4>📌 과제 요약</h4><dl class="pi-adl"><dt>과제번호</dt><dd>' + esc(d.meta.taskNo || "신청 시 공란") + "</dd><dt>주관기관</dt><dd>" + esc(d.org.name || "-") + "</dd><dt>연구책임자</dt><dd>" + esc([d.pi.name, d.pi.title].filter(Boolean).join(" · ") || "-") + "</dd><dt>전문기관</dt><dd>" + esc(d.meta.agency || "-") + "</dd><dt>기간</dt><dd>" + esc(months(d.period.start, d.period.end) || "-") + "</dd><dt>총 사업비</dt><dd><b>" + (t.all ? eok(t.all) : "-") + "</b></dd></dl>" + cur + "</section>";
    } else {
      h += '<section class="lf-card pi-as"><h4>📌 프로젝트</h4><dl class="pi-adl"><dt>이름</dt><dd>' + esc(p.name) + "</dd>" + (p.goal ? "<dt>목표</dt><dd>" + esc(p.goal) + "</dd>" : "") + "<dt>만든 날</dt><dd>" + esc(fmtT(p.created).split(" 오")[0] || "-") + "</dd><dt>연결 폴더</dt><dd>" + esc(p.source ? String(p.source.path).split(/[\\/]/).slice(-2).join("/") : "없음") + "</dd><dt>업무 에픽</dt><dd>" + esc(p.epic ? (p.epic.key || "") + " " + (p.epic.title || "") : "연결 안 됨") + "</dd></dl></section>";
    }
    const fs = S.files, ds = S.docs;
    h += '<section class="lf-card pi-as"><h4>🗃 프로젝트 현황</h4><div class="pi-stat"><div><b>' + (fs ? fs.length : "…") + "</b><span>자료</span></div><div><b>" + (ds ? ds.length : "…") + "</b><span>작업 문서</span></div><div><b>" + (fs ? planFiles().filter((f) => planScore(f) >= 10).length : "…") + "</b><span>계획서 후보</span></div></div>" +
      (ds && ds.length ? '<div class="pi-docs">' + ds.slice().sort((a, b) => (b.saved || 0) - (a.saved || 0)).slice(0, 4).map((x) => '<button type="button" data-pi="open" title="연구 프로젝트에서 열기"><b>' + esc(x.title) + "</b><small>v" + (x.v || 1) + " · " + esc(fmtT(x.saved).split(" 오")[0]) + "</small></button>").join("") + "</div>" : "") + "</section>";
    h += '<section class="lf-card pi-as"><h4>🧭 바로 가기</h4><div class="pi-go">' + [["rnd", "📂", "연구 프로젝트"], ["rx_report", "📝", "보고서 작성"], ["rx_present", "🎬", "발표자료 작성"], ["rx_paper", "📄", "논문 작성"], ["rx_review", "🧑‍⚖️", "심사·평가 대비"], ["rx_lit", "📚", "문헌·선행연구"]].map((x) => '<button type="button" data-go="' + x[0] + '"><span>' + x[1] + "</span>" + x[2] + "</button>").join("") + "</div></section>";
    el.innerHTML = h;
  }
  /* ---- 보기/고치기 공통 칸 ---- */
  function fld(path, label, o) {
    o = o || {}; const v = get(S.d, path); const w = o.w ? " w" + o.w : "";
    if (!S.edit) return '<div class="pi-f' + w + '"><span>' + label + "</span><b" + (o.red && !v ? ' class="pi-none"' : "") + ">" + (v ? esc(v) : "-") + "</b></div>";
    if (o.opts) return '<label class="pi-f' + w + '"><span>' + label + '</span><select data-k="' + path + '"><option value=""></option>' + o.opts.map((x) => "<option" + (x === v ? " selected" : "") + ">" + esc(x) + "</option>").join("") + "</select></label>";
    if (o.long) return '<label class="pi-f' + w + '"><span>' + label + '</span><textarea data-k="' + path + '" rows="' + (o.rows || 3) + '">' + esc(v || "") + "</textarea></label>";
    return '<label class="pi-f' + w + '"><span>' + label + '</span><input data-k="' + path + '" value="' + esc(v || "") + '"' + (o.ph ? ' placeholder="' + esc(o.ph) + '"' : "") + "></label>";
  }
  const card = (t, inner, cls) => '<section class="lf-card pi-c' + (cls ? " " + cls : "") + '"><h4>' + t + "</h4>" + inner + "</section>";
  const bullets = (txt) => { const ls = String(txt || "").split(/\n+/).map((x) => x.replace(/^\s*[ㅇo○•·\-*]\s*/, "").trim()).filter(Boolean); return ls.length ? "<ul class=\"pi-ul\">" + ls.map((x) => { const m = /^([^:：]{2,24})[:：]\s*(.*)$/.exec(x); return "<li>" + (m ? "<b>" + esc(m[1]) + "</b> " + esc(m[2]) : esc(x)) + "</li>"; }).join("") + "</ul>" : '<p class="sh-muted">-</p>'; };

  /* ---- 한눈에 ---- */
  function overHtml() {
    const d = S.d, t = totals(d), ys = d.period.years, cy = curYear(d), s = d.summary;
    const chip = (v, c) => v ? '<span class="sh-chip' + (c ? " " + c : "") + '">' + esc(v) + "</span>" : "";
    const kpi = (v, l, sub) => '<div class="pi-k"><b>' + v + "</b><span>" + l + "</span>" + (sub ? "<small>" + sub + "</small>" : "") + "</div>";
    const trlS = num(s.trlStart), trlE = num(s.trlEnd);
    const trl = '<div class="pi-trl">' + Array.from({ length: 9 }, (_, i) => '<i class="' + (i + 1 < trlS ? "past" : i + 1 <= trlE && i + 1 >= trlS ? "on" : "") + (i + 1 === trlS ? " st" : "") + (i + 1 === trlE ? " en" : "") + '"><em>' + (i + 1) + "</em></i>").join("") + "</div>";
    // 기간 띠
    const a0 = pd(d.period.start), a1 = pd(d.period.end), span = a0 && a1 ? a1 - a0 : 0, now = new Date();
    const G = (n) => Array.from({ length: n }, (_, i) => i);
    const band = !span ? '<div class="pi-band pi-gh">' + G(5).map((i) => '<div class="st1" style="left:' + i * 20 + '%;width:20%"><b>' + (i + 1) + "차년도</b><small>-</small></div>").join("") + "</div>" : span ? '<div class="pi-band">' + ys.map((y, i) => { const x = pd(y.start), z = pd(y.end); if (!x || !z) return ""; return '<div class="st' + (y.stage || 1) + (i === cy ? " cur" : "") + '" style="left:' + ((x - a0) / span * 100).toFixed(2) + "%;width:" + ((z - x) / span * 100).toFixed(2) + '%" title="' + esc(y.stage + "단계 " + y.year + "년차 · " + y.start + " ~ " + y.end) + '"><b>' + (i + 1) + "차년도</b><small>" + esc(String(y.start).slice(0, 4)) + "</small></div>"; }).join("") + (now > a0 && now < a1 ? '<span class="pi-now" style="left:' + ((now - a0) / span * 100).toFixed(2) + '%"><em>오늘</em></span>' : "") + "</div>" : '<p class="sh-muted">기간 정보가 없어요.</p>';
    // 연차별 예산 막대
    const mx = Math.max(1, ...d.budget.map(rowSum));
    const bars = !d.budget.length ? '<div class="pi-bars pi-gh">' + [44, 62, 62, 62, 62].map((h, i) => '<div><span class="pi-bv">-</span><div class="pi-bs"><i class="kg" style="height:' + h + '%"></i></div><small>' + (i + 1) + "차년도</small></div>").join("") + "</div>" : d.budget.length ? '<div class="pi-bars">' + d.budget.map((r, i) => { const h = (k) => (num(r[k]) / mx * 100).toFixed(2) + "%"; return '<div class="' + (i === cy ? "cur" : "") + '"><span class="pi-bv">' + (rowSum(r) / 100000).toFixed(1) + '억</span><div class="pi-bs"><i class="kx" style="height:' + (((num(r.xc) + num(r.xk)) / mx) * 100).toFixed(2) + '%"></i><i class="kk" style="height:' + h("ok") + '"></i><i class="kc" style="height:' + h("oc") + '"></i><i class="kg" style="height:' + h("gov") + '"></i></div><small>' + (i + 1) + "차년도</small></div>"; }).join("") + '</div><div class="pi-leg"><span><i class="kg"></i>정부지원</span><span><i class="kc"></i>기관부담 현금</span><span><i class="kk"></i>기관부담 현물</span>' + (t.xc + t.xk ? '<span><i class="kx"></i>지자체 등</span>' : "") + "</div>" : '<p class="sh-muted">예산 정보가 없어요.</p>';
    const yg = !s.years.length ? '<div class="pi-yg pi-gh">' + G(5).map((i) => "<div><b>" + (i + 1) + "차년도</b><p>연차 목표</p></div>").join("") + "</div>" : s.years.length ? '<div class="pi-yg">' + s.years.map((y, i) => '<div class="' + (i === cy ? "cur" : i < cy ? "past" : "") + '"><b>' + esc(y.year || (i + 1) + "차년도") + (i === cy ? " <em>진행 중</em>" : "") + "</b><p>" + esc(y.goal || "") + "</p></div>").join("") + "</div>" : "";
    return '<div class="pi-over">' +
      '<section class="lf-card pi-hero"><div class="pi-chips">' + chip(d.meta.program, "c-acc") + chip(d.meta.type) + chip(d.summary.level ? "연구개발단계 · " + d.summary.level : "") + chip(d.summary.fee ? "기술료 " + d.summary.fee : "") + chip(d.meta.security ? "보안 " + d.meta.security : "") + chip(d.meta.docType) + "</div>" +
      '<div class="pi-final"><small>최종 목표</small><p' + (s.finalGoal ? "" : ' class="pi-gt"') + ">" + (s.finalGoal ? esc(s.finalGoal.replace(/^\s*[ㅇo○]\s*/, "")) : "과제의 최종 목표가 여기에 들어와요") + "</p></div>" +
      '<div class="pi-kw' + (d.keywords.ko.length ? "" : " pi-gh") + '">' + (d.keywords.ko.length ? "" : G(5).map((i) => "<span><b>핵심어 " + (i + 1) + "</b><small>Keyword</small></span>").join("")) + d.keywords.ko.map((k, i) => '<span><b>' + esc(k) + "</b>" + (d.keywords.en[i] ? "<small>" + esc(d.keywords.en[i]) + "</small>" : "") + "</span>").join("") + "</div></section>" +
      '<div class="pi-kpis">' + kpi(t.all ? eok(t.all) : "-", "총 연구개발비", t.all ? won(t.all) + "천원" : "") + kpi(t.gov ? eok(t.gov) : "-", "정부지원", t.all ? Math.round(t.gov / t.all * 100) + "%" : "") + kpi(t.org ? eok(t.org) : "-", "기관부담", t.all ? "현금 " + eok(t.oc) + " · 현물 " + eok(t.ok) : "") + kpi(months(d.period.start, d.period.end) || "-", "연구개발기간", esc((d.period.start || "") + (d.period.end ? " ~ " + d.period.end : ""))) + '<div class="pi-k"><b>' + (trlS || "-") + " → " + (trlE || "-") + "</b><span>기술준비도(TRL)</span>" + trl + "</div></div>" +
      card("📅 연구개발기간" + (cy >= 0 ? ' <small class="pj-tag">지금 ' + (cy + 1) + "차년도</small>" : ""), band + yg, "pi-w2") +
      card("💰 연차별 연구개발비 <small class=\"pj-tag\">단위 억 원</small>", bars) +
      card("🏢 수행 기관", '<div class="pi-orgs"><div class="pi-o main"><small>주관</small><b>' + esc(d.org.name || "-") + "</b><span>" + esc(d.org.type || "") + "</span><em>" + esc([d.pi.name, d.pi.title].filter(Boolean).join(" · ")) + "</em></div>" + d.partners.map((x) => '<div class="pi-o"><small>공동</small><b>' + esc(x.name) + "</b><span>" + esc(x.type || "") + "</span><em>" + esc([x.lead, x.title].filter(Boolean).join(" · ")) + "</em></div>").join("") + "</div>") +
      "</div>";
  }
  /* ---- 과제 정보 ---- */
  function infoHtml() {
    const d = S.d, cls = (k, t) => '<table class="pi-tb"><thead><tr><th>' + t + "</th><th>분류</th><th class=\"n\">비중</th></tr></thead><tbody>" + d.cls[k].map((c, i) => "<tr><td>" + (i + 1) + "</td><td>" + (S.edit ? '<input data-k="cls.' + k + "." + i + '.name" value="' + esc(c.name) + '">' : esc(c.name || "-")) + '</td><td class="n">' + (S.edit ? '<input data-k="cls.' + k + "." + i + '.pct" value="' + esc(c.pct) + '" class="pi-pct">' : esc(c.pct ? String(c.pct).replace(/%?$/, "%") : "-")) + "</td></tr>").join("") + "</tbody></table>";
    const ppl = (k) => fld(k + ".name", "성명") + fld(k + ".title", "직위") + fld(k + ".phone", "직장전화") + fld(k + ".mobile", "휴대전화") + fld(k + ".email", "전자우편") + fld(k + ".rno", "국가연구자번호");
    return '<div class="pi-grid">' +
      card("과제명", '<div class="pi-fs">' + fld("title.ko", "연구개발과제명(국문)", { w: 2 }) + fld("title.en", "연구개발과제명(영문)", { w: 2 }) + fld("umbrella.ko", "총괄과제명(국문)", { w: 2 }) + fld("umbrella.en", "총괄과제명(영문)", { w: 2 }) + "</div>", "pi-w2") +
      card("사업 정보", '<div class="pi-fs">' + fld("meta.ministry", "중앙행정기관") + fld("meta.agency", "전문기관") + fld("meta.program", "세부사업명") + fld("meta.type", "과제유형") + fld("meta.notice", "공고번호") + fld("meta.selection", "선정방식", { opts: ["지정공모", "품목지정", "자유공모"] }) + fld("meta.totalNo", "총괄 과제번호", { red: 1 }) + fld("meta.taskNo", "연구개발 과제번호", { red: 1 }) + fld("meta.docType", "계획서 구분", { opts: ["신청용", "협약용"] }) + fld("meta.security", "보안등급", { opts: ["일반", "보안"] }) + "</div>") +
      card("연구개발 단계", '<div class="pi-fs">' + fld("summary.level", "연구개발단계", { opts: ["기초", "응용", "개발", "기타"] }) + fld("summary.fee", "기술료", { opts: ["징수", "비징수"] }) + fld("summary.trlStart", "착수시점 TRL") + fld("summary.trlEnd", "종료시점 목표 TRL") + "</div>") +
      card("기술 분류", '<div class="pi-two">' + cls("ind", "산업기술분류") + cls("nat", "국가과학기술표준분류") + "</div>", "pi-w2") +
      card("주관연구개발기관", '<div class="pi-fs">' + fld("org.name", "기관명") + fld("org.type", "기관유형") + fld("org.bizNo", "사업자등록번호") + fld("org.corpNo", "법인등록번호") + fld("org.address", "주소", { w: 2 }) + "</div>") +
      card("연구책임자", '<div class="pi-fs">' + ppl("pi") + "</div>") + card("연구개발과제 실무책임자", '<div class="pi-fs">' + ppl("staff") + "</div>") + "</div>";
  }
  /* ---- 기간·예산 ---- */
  const BCOL = [["gov", "정부지원 현금"], ["oc", "기관부담 현금"], ["ok", "기관부담 현물"], ["xc", "그 외 현금"], ["xk", "그 외 현물"]];
  function moneyHtml() {
    const d = S.d, t = totals(d), cy = curYear(d), E = S.edit;
    const cell = (tb, i, k, v, cls) => E ? '<td' + (cls ? ' class="' + cls + '"' : "") + '><input data-t="' + tb + '" data-r="' + i + '" data-c="' + k + '" value="' + esc(v == null ? "" : v) + '"></td>' : '<td' + (cls ? ' class="' + cls + '"' : "") + ">" + esc(v == null || v === "" ? "-" : v) + "</td>";
    const per = '<table class="pi-tb"><thead><tr><th>단계</th><th>연차</th><th>시작</th><th>끝</th><th>기간</th>' + (E ? "<th></th>" : "") + "</tr></thead><tbody>" + d.period.years.map((y, i) => '<tr class="' + (i === cy ? "cur" : "") + '">' + cell("years", i, "stage", y.stage) + cell("years", i, "year", y.year) + cell("years", i, "start", y.start) + cell("years", i, "end", y.end) + "<td>" + esc(months(y.start, y.end)) + "</td>" + (E ? '<td><button type="button" class="pp-ib" data-del="years" data-r="' + i + '">✕</button></td>' : "") + "</tr>").join("") + (!E && !d.period.years.length ? [1, 1, 2, 2, 3].map((st, i) => '<tr class="pi-ghr"><td>' + st + "</td><td>" + (i % 2 + 1) + "</td><td>-</td><td>-</td><td>-</td></tr>").join("") : "") + "</tbody></table>" + (E ? '<button type="button" class="ghost-btn small-btn" data-add="years">＋ 연차</button>' : "");
    const bud = '<div class="tk-tblw"><table class="pi-tb pi-money"><thead><tr><th>단계</th><th>연도</th>' + BCOL.map((c) => '<th class="n">' + c[1] + "</th>").join("") + '<th class="n">현금 계</th><th class="n">현물 계</th><th class="n">합계</th>' + (E ? "<th></th>" : "") + "</tr></thead><tbody>" +
      d.budget.map((r, i) => '<tr class="' + (i === cy ? "cur" : "") + '">' + cell("budget", i, "stage", r.stage) + cell("budget", i, "year", r.year) + BCOL.map((c) => E ? cell("budget", i, c[0], r[c[0]], "n") : '<td class="n">' + (num(r[c[0]]) ? won(r[c[0]]) : "") + "</td>").join("") + '<td class="n">' + won(num(r.gov) + num(r.oc) + num(r.xc)) + '</td><td class="n">' + won(num(r.ok) + num(r.xk)) + '</td><td class="n"><b>' + won(rowSum(r)) + "</b></td>" + (E ? '<td><button type="button" class="pp-ib" data-del="budget" data-r="' + i + '">✕</button></td>' : "") + "</tr>").join("") +
      (!E && !d.budget.length ? [1, 1, 2, 2, 3].map((st, i) => '<tr class="pi-ghr"><td>' + st + "</td><td>" + (i + 1) + "차년도</td>" + BCOL.map(() => '<td class="n">-</td>').join("") + '<td class="n">-</td><td class="n">-</td><td class="n">-</td></tr>').join("") : "") +
      '</tbody><tfoot><tr><td colspan="2">합계</td>' + BCOL.map((c) => '<td class="n">' + (t[c[0]] ? won(t[c[0]]) : "") + "</td>").join("") + '<td class="n">' + won(t.cash) + '</td><td class="n">' + won(t.kind) + '</td><td class="n"><b>' + won(t.all) + "</b></td>" + (E ? "<td></td>" : "") + "</tr></tfoot></table></div>" + (E ? '<button type="button" class="ghost-btn small-btn" data-add="budget">＋ 연도</button>' : "");
    const share = t.all ? '<div class="pi-share"><i class="kg" style="width:' + (t.gov / t.all * 100).toFixed(2) + '%"></i><i class="kc" style="width:' + (t.oc / t.all * 100).toFixed(2) + '%"></i><i class="kk" style="width:' + (t.ok / t.all * 100).toFixed(2) + '%"></i><i class="kx" style="width:' + ((t.xc + t.xk) / t.all * 100).toFixed(2) + '%"></i></div><div class="pi-leg"><span><i class="kg"></i>정부지원 ' + Math.round(t.gov / t.all * 100) + '%</span><span><i class="kc"></i>기관 현금 ' + Math.round(t.oc / t.all * 100) + '%</span><span><i class="kk"></i>기관 현물 ' + Math.round(t.ok / t.all * 100) + "%</span>" + (t.xc + t.xk ? '<span><i class="kx"></i>지자체 등 ' + Math.round((t.xc + t.xk) / t.all * 100) + "%</span>" : "") + "</div>" : "";
    return '<div class="pi-grid">' + card("📅 연구개발기간", '<div class="pi-fs">' + fld("period.start", "전체 시작", { ph: "2026. 04. 01" }) + fld("period.end", "전체 끝", { ph: "2030. 12. 31" }) + '<div class="pi-f"><span>전체 기간</span><b>' + esc(months(S.d.period.start, S.d.period.end) || "-") + "</b></div></div>" + per) +
      card("📊 재원 구성", '<div class="pi-kpis sm"><div class="pi-k"><b>' + (t.all ? eok(t.all) : "-") + '</b><span>총 연구개발비</span></div><div class="pi-k"><b>' + (t.gov ? eok(t.gov) : "-") + '</b><span>정부지원</span></div><div class="pi-k"><b>' + (t.org ? eok(t.org) : "-") + "</b><span>기관부담</span></div></div>" + share) +
      card("💰 연구개발비 <small class=\"pj-tag\">단위 천원</small>", bud, "pi-w2") + "</div>";
  }
  /* ---- 목표·내용 ---- */
  function goalHtml() {
    const d = S.d, s = d.summary, cy = curYear(d), E = S.edit;
    const item = (tb, i, o, title, cur) => E ? '<div class="pi-gi"><div class="pi-gh"><input data-t="' + tb + '" data-r="' + i + '" data-c="' + (tb === "sy" ? "year" : "stage") + '" value="' + esc(tb === "sy" ? o.year : o.stage) + '"><button type="button" class="pp-ib" data-del="' + tb + '" data-r="' + i + '">✕</button></div><label class="pi-f"><span>목표</span><textarea data-t="' + tb + '" data-r="' + i + '" data-c="goal" rows="2">' + esc(o.goal || "") + '</textarea></label><label class="pi-f"><span>개발 내용</span><textarea data-t="' + tb + '" data-r="' + i + '" data-c="content" rows="4">' + esc(o.content || "") + "</textarea></label></div>"
      : '<div class="pi-gi' + (cur ? " cur" : "") + '"><div class="pi-gh"><b>' + esc(title) + "</b>" + (cur ? '<em>진행 중</em>' : "") + "</div>" + (o.goal ? '<div class="pi-gg"><small>목표</small><p>' + esc(o.goal.replace(/^\s*[ㅇo○]\s*/, "")) + "</p></div>" : "") + (o.content ? '<div class="pi-gc"><small>개발 내용</small>' + metric(o.content) + "</div>" : "") + "</div>";
    const stageOf = (i) => (d.period.years[i] || {}).stage;
    return '<div class="pi-grid">' + card("🎯 최종 목표", fld("summary.finalGoal", "최종 목표", { long: 1, rows: 4, w: 2 }), "pi-w2") +
      card("📆 연차별 목표·내용", '<div class="pi-gl">' + (!E && !s.years.length ? [1, 2, 3, 4, 5].map((n) => ghostGoal(n + "차년도")).join("") : "") + s.years.map((y, i) => item("sy", i, y, (y.year || (i + 1) + "차년도") + (stageOf(i) ? " · " + stageOf(i) + "단계" : ""), i === cy)).join("") + "</div>" + (E ? '<button type="button" class="ghost-btn small-btn" data-add="sy">＋ 연차</button>' : ""), "pi-w2") +
      card("🪜 단계별 목표·내용", '<div class="pi-gl st">' + (!E && !s.stages.length ? [1, 2, 3].map((n) => ghostGoal(n + "단계")).join("") : "") + s.stages.map((x, i) => item("ss", i, x, (x.stage || i + 1) + "단계", cy >= 0 && String(stageOf(cy)) === String(x.stage || i + 1))).join("") + "</div>" + (E ? '<button type="button" class="ghost-btn small-btn" data-add="ss">＋ 단계</button>' : ""), "pi-w2") + "</div>";
  }
  const ghostGoal = (t) => '<div class="pi-gi pi-gh"><div class="pi-gh2"><b>' + t + '</b></div><div class="pi-gg"><small>목표</small><p>-</p></div><div class="pi-gc"><small>개발 내용</small><p>-</p></div></div>';
  // 개발 내용 속 성능 지표(AUC 0.75, QA 65점, 추론지연 500ms 이하 …)를 칩으로 꺼내 보인다
  function metric(txt) {
    const t = String(txt || "").replace(/^\s*[ㅇo○]\s*/, ""), re = /(AUC\s*[\d.]+|QA\s*\d+\s*점|추론\s*지연\s*\d+\s*ms\s*이하|\d+(?:\.\d+)?\s*(?:TB|GB)(?:→\d+(?:\.\d+)?\s*(?:TB|GB))?|\d+\s*개소\s*이상|\d+B\+?)/g, chips = [];
    let m; while ((m = re.exec(t))) if (chips.indexOf(m[1]) < 0) chips.push(m[1]);
    return (chips.length ? '<div class="pi-mx">' + chips.map((c) => "<span>" + esc(c) + "</span>").join("") + "</div>" : "") + "<p>" + esc(t) + "</p>";
  }
  /* ---- 성과·효과 ---- */
  function outHtml() {
    const d = S.d, E = S.edit;
    const kw = E ? '<div class="pi-fs">' + [0, 1, 2, 3, 4].map((i) => '<label class="pi-f"><span>핵심어 ' + (i + 1) + '</span><input data-k="keywords.ko.' + i + '" value="' + esc(d.keywords.ko[i] || "") + '" placeholder="국문"><input data-k="keywords.en.' + i + '" value="' + esc(d.keywords.en[i] || "") + '" placeholder="영문"></label>').join("") + "</div>"
      : '<table class="pi-tb"><thead><tr><th>국문</th><th>영문</th></tr></thead><tbody>' + d.keywords.ko.map((k, i) => "<tr><td><b>" + esc(k) + "</b></td><td>" + esc(d.keywords.en[i] || "") + "</td></tr>").join("") + (d.keywords.ko.length ? "" : [1, 2, 3, 4, 5].map(() => '<tr class="pi-ghr"><td>-</td><td>-</td></tr>').join("")) + "</tbody></table>";
    return '<div class="pi-grid">' + card("🚀 연구개발성과 활용계획", E ? fld("outcome.plans", "한 줄에 하나(ㅇ 로 시작해도 돼요)", { long: 1, rows: 8, w: 2 }) : bullets(d.outcome.plans), "pi-w2") + card("✨ 기대효과", E ? fld("outcome.effects", "한 줄에 하나", { long: 1, rows: 8, w: 2 }) : bullets(d.outcome.effects), "pi-w2") + card("🔑 핵심어 <small class=\"pj-tag\">5개 이내</small>", kw, "pi-w2") + "</div>";
  }
  /* ---- 참여기관 ---- */
  function teamHtml() {
    const d = S.d, E = S.edit, C = [["name", "기관명"], ["lead", "책임자"], ["title", "직위"], ["mobile", "휴대전화"], ["email", "전자우편"], ["type", "기관유형"]];
    const tb = '<div class="tk-tblw"><table class="pi-tb"><thead><tr><th>구분</th>' + C.map((c) => "<th>" + c[1] + "</th>").join("") + (E ? "<th></th>" : "") + '</tr></thead><tbody><tr class="main"><td><b>주관</b></td><td><b>' + esc(d.org.name || "-") + "</b></td><td>" + esc(d.pi.name) + "</td><td>" + esc(d.pi.title) + "</td><td>" + esc(d.pi.mobile) + "</td><td>" + esc(d.pi.email) + "</td><td>" + esc(d.org.type) + "</td>" + (E ? "<td></td>" : "") + "</tr>" +
      d.partners.map((x, i) => "<tr><td>공동</td>" + C.map((c) => E ? '<td><input data-t="partners" data-r="' + i + '" data-c="' + c[0] + '" value="' + esc(x[c[0]] || "") + '"></td>' : "<td>" + esc(x[c[0]] || "") + "</td>").join("") + (E ? '<td><button type="button" class="pp-ib" data-del="partners" data-r="' + i + '">✕</button></td>' : "") + "</tr>").join("") + (!E && !d.partners.length ? '<tr class="pi-ghr"><td>공동</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td></tr>' : "") + "</tbody></table></div>" + (E ? '<button type="button" class="ghost-btn small-btn" data-add="partners">＋ 공동연구개발기관</button>' : "");
    return '<div class="pi-grid">' + card("👥 수행 체계", tb, "pi-w2") + card("연구책임자", personCard(d.pi, d.org.name)) + card("실무책임자", personCard(d.staff, d.org.name)) + "</div>";
  }
  const personCard = (x, org) => !x.name ? '<div class="pi-pc pi-gh"><span class="pi-av">?</span><div><b>성명 <small>직위</small></b><span>' + esc(org || "기관") + "</span><em>☎ -</em><em>✉ -</em></div></div>" : x.name ? '<div class="pi-pc"><span class="pi-av">' + esc(x.name.slice(0, 1)) + '</span><div><b>' + esc(x.name) + " <small>" + esc(x.title) + "</small></b><span>" + esc(org || "") + "</span>" + [["☎", x.phone], ["📱", x.mobile], ["✉", x.email], ["🆔", x.rno]].filter((y) => y[1]).map((y) => "<em>" + y[0] + " " + esc(y[1]) + "</em>").join("") + "</div></div>" : '<p class="sh-muted">-</p>';
  /* ---- 업무 연동 ---- */
  function hubTable(title, cols, rows, foot, tab) {
    const linked = !!(S.p && S.p.rnd), n = cols.length;
    return '<section class="lf-card"><h4>' + title + (linked && S.rk && S.rk.base ? ' <a class="pj-tag" href="' + esc(adminUrl(tab)) + '" target="_blank" rel="noopener">연구행정 ↗</a>' : "") + '</h4><div class="tk-tblw"><table class="sv-tbl"><thead><tr>' + cols.map((c) => "<th>" + c + "</th>").join("") + "</tr></thead><tbody>" +
      (rows.length ? rows.map((r) => "<tr>" + r.map((c) => "<td>" + c + "</td>").join("") + "</tr>").join("") : '<tr><td colspan="' + n + '" class="pj-empty">' + (S.d.bundle ? "등록된 항목이 없어요" : linked ? "[연구행정에서 받기]를 누르면 표시돼요" : "연구행정 과제와 연결하면 표시돼요") + "</td></tr>") + "</tbody>" + (foot ? "<tfoot><tr>" + foot.map((c) => "<td><b>" + c + "</b></td>").join("") + "</tr></tfoot>" : "") + "</table></div></section>";
  }
  function syncHtml() {
    const d = S.d, h = d.history || [], B = d.bundle || {}, p = S.p, rk = S.rk || {}, E = (v) => esc(v == null ? "" : v), bg = B.budget || {}, bt = bg.totals || {};
    const st = (v) => (v ? '<span class="sh-chip">' + E(v) + "</span>" : "");
    const tables = hubTable("📅 일정·마일스톤", ["단계", "내용", "시작", "끝", "담당", "상태"], (B.milestones || []).map((x) => [E(x.stage), E(x.title) + (x.kanbanKey ? ' <small class="sh-muted">' + E(x.kanbanKey) + "</small>" : ""), E(x.start), E(x.end), E(x.owner), st(x.status)]), null, "schedule") +
      hubTable("👥 참여 인력", ["이름", "역할", "참여율", "기관", "연락"], (B.members || []).map((x) => [E(x.name), E(x.role), x.pct != null ? E(x.pct) + "%" : "", E(x.org), E(x.contact)]), null, "members") +
      hubTable("💸 예산 집행" + (bg.year ? ' <small class="sh-muted">' + E(bg.year) + "년 · " + E(bg.unit || "천원") + "</small>" : ""), ["비목", "계획", "집행", "잔액", "증빙"], (bg.lines || []).map((x) => [E(x.cat), won(x.plan), won(x.spent), won(x.balance), x.evidenceMissing ? '<span class="rn-bad">미비 ' + E(x.evidenceMissing) + "건</span>" : "완비"]), (bg.lines || []).length ? ["합계", won(bt.plan), won(bt.spent), won(bt.balance), bt.rate != null ? "집행률 " + E(bt.rate) + "%" : ""] : null, "budget") +
      hubTable("📦 산출물·보고", ["구분", "이름", "기한·날짜", "담당", "상태", "제출처"], (B.obligations || []).map((x) => ["보고", E(x.title), E(x.due), E(x.owner), st(x.status), E(x.submitTo)]).concat((B.outputs || []).map((x) => [E(x.type), E(x.title), E(x.date), "", st(x.status), x.ntis ? "NTIS " + E(x.ntis) : ""])), null, "outputs") +
      hubTable("⚠ 위험·이슈", ["이슈", "영향", "대응", "담당", "상태"], (B.risks || []).map((x) => [E(x.title), E(x.impact), E(x.response), E(x.owner), st(x.status)]), null, "risk");
    return '<div class="pi-grid">' + card("🏛 연구행정관리시스템 연동", '<dl class="pi-dl"><dt>연결</dt><dd>' + (rk.connected ? (S.pullErr ? "⚠ 지금 받을 수 없어요 — 마지막으로 받은 값을 보여 줘요 · " : "연결됨 · ") + E(rk.base) : "연결 안 됨") + "</dd><dt>연결한 과제</dt><dd>" + (p.rnd ? E((p.rnd.code || "") + " " + (p.rnd.name || "")) : "없음") + "</dd><dt>받은 곳</dt><dd>" + E((SRC[d.sync.source] || SRC[""])[0]) + "</dd><dt>받은 때</dt><dd>" + (d.sync.at ? fmtT(d.sync.at) : "-") + (B.generatedAt ? ' <small class="sh-muted">(연구행정 기준 ' + E(B.generatedAt) + ")</small>" : "") + '</dd><dt>규칙</dt><dd>입력·수정은 연구행정관리시스템에서 해요. 받은 자료는 여기서 잠기고, 임시 자료는 받으면 덮여요. 연결이 끊겨도 마지막으로 받은 값을 보여 줘요.</dd></dl><div class="pi-sa2"><button type="button" class="primary small-btn" data-pi="pull">⟳ 지금 받기</button><button type="button" class="ghost-btn small-btn" data-pi="link">' + (p.rnd ? "과제 바꾸기" : rk.connected ? "과제 연결" : "연결하기") + "</button>" + (p.rnd ? '<button type="button" class="ghost-btn small-btn" data-pi="unlink">연결 끊기</button>' : "") + '<button type="button" class="ghost-btn small-btn" data-pi="json">⬆ JSON 불러오기</button><button type="button" class="ghost-btn small-btn" data-pi="export">⬇ JSON 내보내기</button><button type="button" class="ghost-btn small-btn rn-danger" data-pi="clear">🗑 받은 자료 비우기</button></div>') +
      (FLOWBOARD_PLAN ? card("📋 FlowBoard 에픽", '<div id="piEpic"></div>') : "") +
      '<div class="pj-soon pi-w2">' + tables + "</div>" +
      card("🕘 받은 기록", h.length ? '<div class="pi-hist">' + h.map((x) => '<details><summary><b>' + fmtT(x.at) + "</b><span>" + esc((SRC[x.source] || SRC[""])[0]) + "</span><small>바뀐 항목 " + x.n + "개" + (x.note ? " · " + esc(x.note) : "") + "</small></summary><p>" + (x.changed || []).map((k) => "<code>" + esc(k) + "</code>").join(" ") + "</p></details>").join("") + "</div>" : '<p class="sh-muted">아직 받은 기록이 없어요.</p>', "pi-w2") + "</div>";
  }
  function paintEpic() { const el = $("piEpic"); if (!el) return; try { if (window.RNDLINK && RNDLINK.epicPanel) RNDLINK.epicPanel(el, S.p); else el.innerHTML = '<p class="sh-muted">FlowBoard 연결 모듈을 불러오지 못했어요.</p>'; } catch (e) { el.innerHTML = '<p class="lb-warn">' + esc(e.message) + "</p>"; } }

  /* ================================================================== 받기 */
  // 업무관리시스템(FlowBoard) 에픽이 내려 주는 계획 정보 — 필드 rndPlan(객체) 또는 설명 속 ```rnd-plan JSON``` 블록. 규격: docs/PROJECT-INFO-SYNC.md
  async function rnd(op, params, body) {
    let u = "api.php?r=rnd&op=" + op; Object.keys(params || {}).forEach((k) => { if (params[k] != null && params[k] !== "") u += "&" + k + "=" + encodeURIComponent(params[k]); });
    const init = { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store", headers: {} };
    if (body !== undefined) { init.headers["Content-Type"] = "application/json"; init.headers["X-Study-Vault"] = "1"; init.body = JSON.stringify(body); }
    const r = await fetch(u, init); let d = null; try { d = await r.json(); } catch (e) { d = null; }
    if (!d) throw new Error("HTTP " + r.status);
    if (d.ok === false) { const er = new Error(d.message || "연구행정관리시스템 오류"); er.code = d.error || d.code; throw er; }
    return d;
  }
  // 1순위: 연구행정 bundle. 끊겨 있으면 마지막으로 받은 값을 그대로 둔다
  async function pullAdmin(quiet) {
    if (!quiet) toast("연구행정관리시스템에서 받는 중…", 8000);
    let b; try { b = (await rnd("bundle", { pid: S.pid })).bundle || {}; } catch (e) { S.pullErr = e.message || "연결 실패"; if (!quiet) toast("받지 못했어요: " + e.message + (S.d.sync.at ? " — 마지막으로 받은 값을 보여 줘요" : ""), 5000); render(); return; }
    S.pullErr = "";
    const prev = JSON.parse(JSON.stringify(S.d)), keep = { history: S.d.history, sync: S.d.sync };
    if (b.plan && typeof b.plan === "object") S.d = norm(Object.assign({}, b.plan, keep));
    S.d.bundle = { project: b.project, milestones: b.milestones || [], members: b.members || [], budget: b.budget || {}, obligations: b.obligations || [], outputs: b.outputs || [], risks: b.risks || [], generatedAt: b.generatedAt };
    S.d.sync.ref = (b.project && (b.project.code || b.project.id)) || ""; S.edit = false;
    const same = JSON.stringify(flat(prev)) === JSON.stringify(flat(S.d)) && prev.sync.source === "admin";
    if (same) { S.d.sync.at = Date.now(); PS(key(), S.d); } else save("admin", S.d.sync.ref, prev);
    if (!quiet) toast("연구행정관리시스템에서 받았어요");
    if (!quiet || !same) render(); else paintAside();
  }
  async function pull() {
    if (S.p && S.p.rnd) return pullAdmin(false);
    const ep = S.p && S.p.epic;
    if (!FLOWBOARD_PLAN || !ep) { linkDialog(); return; }
    toast("FlowBoard 에픽에서 받는 중…", 8000);
    let r; try { r = await RNDLINK.kb("epic", { ref: ep.key || ep.id }); } catch (e) { toast("받지 못했어요: " + e.message, 5000); return; }
    if (r.error === "not_connected") { toast("FlowBoard 가 연결되지 않았어요 — [연구지원 설정]에서 연결하세요", 5000); return; }
    const e = r.epic || {}; let plan = e.rndPlan || e.plan || (e.fields && (e.fields.rndPlan || e.fields.plan)) || null;
    if (!plan) { const m = /```\s*rnd-plan\s*([\s\S]*?)```/.exec(String(e.description || e.body || "")); if (m) { try { plan = JSON.parse(m[1]); } catch (er) { plan = null; } } }
    if (!plan) { if (confirm("에픽 " + (ep.key || "") + " 에 과제 정보가 없어요.\n연구행정관리시스템의 과제와 연결할까요?")) linkDialog(); return; }
    const prev = JSON.parse(JSON.stringify(S.d)); const keep = { history: S.d.history };
    S.d = norm(Object.assign({}, plan, keep)); S.d.sync.ref = ep.key || ep.id; S.edit = false;
    save("work", "에픽 " + (ep.key || ""), prev); toast("FlowBoard 에픽에서 받았어요"); render();
  }
  async function aiFill(fid0) {
    if (locked() && !confirm("연구행정관리시스템에서 받은 자료가 있어요. 계획서에서 다시 채우면 임시 자료로 바뀌어요(다음 연동 때 다시 덮여요). 계속할까요?")) return;
    if (!S.files) await loadSide();
    const files = planFiles();
    if (!files.length) { alert("프로젝트에 계획서 파일(PDF·한글·워드)이 없어요. 연구 프로젝트에서 먼저 올려 주세요."); return; }
    const pick = files.find((f) => f.id === fid0) || files[0];
    const body = modal("✨ 계획서에서 채우기", '<p class="sh-muted">연구개발계획서(표지·요약문이 있는 파일)를 AI 가 읽어서 항목을 채워요. 채운 자료는 <b>임시 자료</b>로 저장되고, 연구행정관리시스템과 연동되면 그쪽 자료로 덮여요.</p><select id="piFile" class="sd-wide">' + files.map((f) => '<option value="' + esc(f.id) + '"' + (f === pick ? " selected" : "") + ">" + esc(f.name) + "</option>").join("") + '</select><div class="pi-ma"><button type="button" class="primary big-btn" data-m="go">읽고 채우기</button><span id="piMsg" class="sh-muted"></span></div>');
    const run = async (btn) => {
      const msg = $("piMsg"), fid = $("piFile").value; btn.disabled = true; msg.textContent = "계획서를 읽는 중…";
      try {
        let text = (await RND.ws.req("text", { pid: S.pid, fid: fid })).text || ""; if (!text.trim()) throw new Error("이 파일에서 글을 뽑지 못했어요(스캔본이면 OCR 이 필요해요)");
        text = text.slice(0, 40000); msg.textContent = "AI 가 항목을 채우는 중…(1분 안팎)";
        const r = await TK.aiJSON({ sys: "당신은 국가 R&D 연구개발계획서를 구조화하는 행정 담당자입니다. 문서에 적힌 값만 옮기고, 없는 값은 빈 문자열로 두세요. 숫자·날짜·번호는 문서 표기 그대로. 연구개발비는 천원 단위 숫자만. 한 칸에 여러 줄이면 줄바꿈(\\n)으로.", user: "[연구개발계획서 본문]\n" + text, shape: JSON.stringify(blankShape()), tokens: 7000, temp: 0.1 });
        const prev = JSON.parse(JSON.stringify(S.d)); S.d = norm(Object.assign({}, r, { history: S.d.history })); save("ai", "파일: " + String((files.find((f) => f.id === fid) || {}).name || "").split("/").pop(), prev);
        closeModal(); S.edit = false; S.tab = "over"; toast("채웠어요 — 틀린 곳은 ✎ 고치기로 바로잡으세요", 4000); render(); if (toAdmin()) await pushPlan("ScholarFlow 계획서에서 채움");
      } catch (er) { msg.textContent = "⚠ " + er.message; btn.disabled = false; }
    };
    body.onclick = (e) => { const b = e.target.closest('[data-m="go"]'); if (b) run(b); };
    if (fid0) run(body.querySelector('[data-m="go"]'));
  }
  /* ---- 연구행정관리시스템 연결 ---- */
  function connectHtml(st) {
    return st.connected ? '<p>✅ 연결됨 — ' + esc(st.base) + " · 토큰 " + esc(st.token_hint || "") + ' <button type="button" class="ghost-btn small-btn" data-rk="off">연결 끊기</button></p>'
      : '<div class="sv-grid"><label class="w2">주소<input id="rkBase" type="text" value="' + esc(st.base || "") + '"></label><label class="w2">API 토큰<input id="rkTok" type="password" placeholder="mgm_…" autocomplete="off"></label></div><div class="pi-ma"><button type="button" class="primary small-btn" data-rk="on">연결</button>' + (st.localToken ? '<button type="button" class="ghost-btn small-btn" data-rk="local">이 PC 의 토큰 파일에서 가져오기</button>' : "") + '<span id="rkMsg" class="sh-muted"></span></div>';
  }
  async function connectForm(el, after) {
    if (!el) return; let st; try { st = await rnd("status"); } catch (e) { el.innerHTML = '<p class="lb-warn">' + esc(e.message) + "</p>"; return; }
    S.rk = st; el.innerHTML = connectHtml(st);
    el.onclick = async (e) => {
      const b = e.target.closest("[data-rk]"); if (!b) return; const k = b.dataset.rk, m = $("rkMsg");
      try {
        if (k === "off") { if (!confirm("연구행정관리시스템 연결을 끊을까요? 받은 자료는 남아요.")) return; await rnd("disconnect", {}, {}); }
        if (k === "on") { if (m) m.textContent = "확인 중…"; await rnd("connect", {}, { base: $("rkBase").value.trim(), token: $("rkTok").value.trim() }); }
        if (k === "local") { if (m) m.textContent = "가져오는 중…"; await rnd("import_local", {}, {}); }
        connectForm(el, after); if (k !== "off" && after) after();
      } catch (er) { if (m) m.textContent = "⚠ " + er.message; else toast(er.message, 4000); }
    };
  }
  async function linkDialog() {
    const body = modal("🏛 연구행정 과제와 연결", '<div id="rkConn"></div><div id="rkList"></div>');
    const list = async () => {
      const el = $("rkList"); el.innerHTML = '<p class="sh-muted">과제를 불러오는 중…</p>'; let l; try { l = (await rnd("projects")).list || []; } catch (e) { el.innerHTML = '<p class="lb-warn">' + esc(e.message) + "</p>"; return; }
      el.innerHTML = l.length ? '<div class="pi-rl">' + l.map((x) => '<button type="button" data-rid="' + esc(x.id) + '"><b>' + esc(x.name || "") + "</b><small>" + esc([x.code, x.status].filter(Boolean).join(" · ")) + "</small></button>").join("") + "</div>" : '<p class="sh-muted">연구행정관리시스템에 등록된 과제가 없어요.</p>';
      el.onclick = async (e) => { const b = e.target.closest("[data-rid]"); if (!b) return; b.disabled = true; try { const r = await rnd("link", { pid: S.pid }, { rndId: b.dataset.rid }); S.p.rnd = { id: b.dataset.rid, code: r.project && r.project.code, name: r.project && r.project.name }; closeModal(); toast(r.linkedBack ? "과제와 연결했어요" : "연결했어요 — 연구행정 쪽 연결 표시는 못 남겼어요: " + (r.linkMessage || ""), 5000); await pullAdmin(false); } catch (er) { toast(er.message, 5000); b.disabled = false; } };
    };
    await connectForm($("rkConn"), list); void body;
    if (S.rk && S.rk.connected) list();
  }
  const SLC = () => (window.HUBLINK && HUBLINK.pub("slc")) || "https://learning.example.com";   // (G5) 다른 시스템에 남기는 바로 가기는 공개 도메인
  /* ---- 산출물 등록 — 사람이 내용을 확인하고 누른다(규격 1장 원칙 4) ---- */
  async function registerOutput(o) {
    let p = null; try { p = ((await RND.ws.req("projects")).list || []).find((x) => x.id === o.pid); } catch (e) { toast(e.message, 4000); return; }
    if (!p || !p.rnd) { if (confirm("이 프로젝트가 연구행정 과제와 연결되지 않았어요.\n프로젝트 정보·관리에서 연결할까요?")) { PS("hub.rnd", o.pid); S.tab = "sync"; navTo("rx_proj"); } return; }
    if (!o.docId) { toast("문서를 먼저 저장하세요", 3500); return; }
    // 상태 허용값은 연구행정이 주인 — GET /rnd 의 항목 정의에서 읽는다(못 읽으면 어느 판에나 있는 값만)
    let sts = ["작성중", "제출", "완료"], defSt = "작성중";
    try { const ks = ((await rnd("schema")).data || {}).kinds || {}, kd = Array.isArray(ks) ? ks.find((k) => (k.id || k.kind || k.key) === "outputs") : ks.outputs, f = ((kd || {}).fields || []).find((x) => x.key === "status"); if (f && f.opts && f.opts.length) { sts = f.opts; defSt = f.def || sts[0]; } } catch (e) { /* 기본 목록 */ }
    const body = modal("🏛 연구행정에 산출물 등록", '<p class="sh-muted">과제 <b>' + esc((p.rnd.code || "") + " " + (p.rnd.name || "")) + '</b> 에 아래 내용으로 등록해요. 같은 문서를 다시 등록하면 새로 만들지 않고 고쳐요.</p><div class="sv-grid"><label class="w2">제목<input id="roTitle" type="text" value="' + esc(o.title || "") + '"></label><label>종류<select id="roType">' + ["보고서", "논문", "발표자료"].map((t) => "<option" + (t === o.type ? " selected" : "") + ">" + t + "</option>").join("") + '</select></label><label>상태<select id="roSt">' + sts.map((t) => "<option" + (t === defSt ? " selected" : "") + ">" + esc(t) + "</option>").join("") + '</select></label></div><div class="pi-ma"><button type="button" class="primary small-btn" data-ro="go">등록</button><span id="roMsg" class="sh-muted"></span></div>');
    body.onclick = async (e) => { const b = e.target.closest('[data-ro="go"]'); if (!b) return; const m = $("roMsg"); b.disabled = true; m.textContent = "보내는 중…"; try { const rr = await rnd("output", { pid: o.pid }, { type: $("roType").value, title: $("roTitle").value.trim(), status: $("roSt").value, docId: o.docId, url: SLC() + "/#/p/" + o.pid + "/" + o.tab + (o.docId !== "paper" ? "/" + o.docId : "") }); closeModal(); toast(rr.meta && rr.meta.idempotent ? "이미 등록된 산출물이라 내용을 고쳤어요" : "연구행정에 등록했어요"); } catch (er) { m.textContent = "⚠ " + er.message; b.disabled = false; } };
  }
  /* ---- 바로 가기(S6): #/p/<pid> · /info · /report[/<did>] · /paper · /slides[/<id>] · /src/<fid> ---- */
  function route() {
    const m = /^#\/p\/([A-Za-z0-9_\-]{1,64})(?:\/([a-z]+))?(?:\/([A-Za-z0-9_\-]{1,64}))?(?:\/(\d{1,5}))?/.exec(location.hash || ""); if (!m) return null;
    const pid = m[1], tab = m[2], id = m[3], pg = +m[4] || 1; PS("hub.rnd", pid); if (window.SHELL && SHELL.setMode) SHELL.setMode("research", false);
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) { /* 계속 */ }
    if (tab === "info") return navTo("rx_proj");
    if (tab === "report") return Promise.resolve(navTo("rx_report")).then(() => (id && window.REPORT ? new Promise((r) => setTimeout(r, 400)).then(() => REPORT.open(id)) : null));
    if (tab === "paper") return navTo("rx_paper");
    if (tab === "slides") return navTo("rx_present");
    if (tab === "src" && id) return RND.openSrc(pid, id, pg);
    RND.open(pid); return Promise.resolve();
  }
  window.addEventListener("hashchange", () => { if (/^#\/p\//.test(location.hash) && window.RND) route(); });
  /* ---- 연구 허브 AI 게이트웨이(관리자) ---- */
  async function hubAdmin(el) {
    if (!el) return;
    const call = async (op, body) => { const r = await fetch("api.php?r=admin&op=hub_" + op, { method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store", headers: body ? { "Content-Type": "application/json", "X-Study-Vault": "1" } : {}, body: body ? JSON.stringify(body) : undefined }); const d = await r.json(); if (d.ok === false) throw new Error(d.message || "실패"); return d; };
    const draw = (d) => {
      el.innerHTML = '<p>다른 로컬 시스템(연구행정·FlowBoard)이 이 계정의 AI 연결을 OpenAI 호환 주소로 쓰게 해요. 서버 PC 안에서 온 요청만 받고, 인터넷(터널)으로 온 요청은 토큰이 있어도 거절해요. 호출은 감사 기록에 남아요.</p><dl class="sv-dl"><dt>상태</dt><dd>' + (d.enabled ? '<span class="sv-chip ok">켜짐</span>' : '<span class="sv-chip">꺼짐</span>') + "</dd><dt>주소</dt><dd><code>" + esc(d.base) + "</code></dd><dt>토큰 파일</dt><dd><code>" + esc(d.file) + '</code></dd></dl><div class="llm-tools"><button type="button" class="ghost-btn big-btn" data-hb="toggle">' + (d.enabled ? "끄기" : "켜기") + '</button><button type="button" class="ghost-btn big-btn" data-hb="issue">새 서비스 토큰 발급</button></div>' +
        (d.tokens.length ? '<table class="sv-tbl"><thead><tr><th>토큰</th><th>이름</th><th>발급</th><th>마지막 사용</th><th>호출</th><th></th></tr></thead><tbody>' + d.tokens.map((t) => "<tr><td><code>" + esc(t.hint) + "</code></td><td>" + esc(t.name) + "</td><td>" + fmtT(t.created) + "</td><td>" + (t.last_used ? fmtT(t.last_used) : "-") + "</td><td>" + (t.calls || 0) + '</td><td><button type="button" class="ghost-btn small-btn" data-hb="revoke" data-id="' + esc(t.id) + '">폐기</button></td></tr>').join("") + "</tbody></table>" : '<p class="sh-muted">발급한 토큰이 없어요. 발급하면 토큰 원문은 위 파일에만 저장돼요(화면에 나오지 않아요).</p>');
      el.onclick = async (e) => { const b = e.target.closest("[data-hb]"); if (!b) return; const k = b.dataset.hb; try { if (k === "toggle") draw(await call("enable", { on: !d.enabled })); if (k === "issue") { if (!confirm("서비스 토큰을 발급해 서버 PC 의 토큰 파일에 저장할까요?\n이 토큰을 가진 로컬 프로그램은 내 AI 연결을 쓰고 프로젝트 자료를 검색할 수 있어요.")) return; draw(await call("issue", { name: "연구 허브" })); } if (k === "revoke") { if (!confirm("이 토큰을 폐기할까요? 쓰던 시스템은 AI 호출이 막혀요.")) return; draw(await call("revoke", { id: b.dataset.id })); } } catch (er) { toast(er.message, 4000); } };
    };
    try { draw(await call("status")); } catch (e) { el.innerHTML = '<p class="lb-warn">' + esc(e.message) + "</p>"; }
  }
  function blankShape() {
    const b = blank(); delete b.sync; delete b.history;
    b.period.years = [{ stage: 1, year: 1, start: "2026. 04. 01", end: "2026. 12. 31" }];
    b.budget = [{ stage: 1, year: "1차년도", gov: 0, oc: 0, ok: 0, xc: 0, xk: 0 }];
    b.partners = [{ name: "", lead: "", title: "", mobile: "", email: "", type: "" }];
    b.summary.years = [{ year: "1차년도", goal: "", content: "" }]; b.summary.stages = [{ stage: 1, goal: "", content: "" }];
    b.keywords = { ko: [""], en: [""] }; return b;
  }
  function importJson() {
    let i = $("piJson"); if (!i) { i = document.createElement("input"); i.type = "file"; i.id = "piJson"; i.accept = ".json,application/json"; i.hidden = true; document.body.appendChild(i); }
    i.onchange = async () => { const f = i.files[0]; i.value = ""; if (!f) return; try { const o = JSON.parse(await f.text()); const prev = JSON.parse(JSON.stringify(S.d)); S.d = norm(Object.assign({}, o.plan || o, { history: S.d.history })); save("json", "파일: " + f.name, prev); toast("불러왔어요"); render(); } catch (e) { alert("JSON 을 읽지 못했어요: " + e.message); } };
    i.click();
  }
  function modal(title, html) {
    let m = $("piModal"); if (!m) { m = document.createElement("div"); m.id = "piModal"; m.className = "sd-modal"; m.innerHTML = '<div class="sd-mbox" role="dialog" aria-modal="true"><div class="sd-mh"><b id="piMT"></b><button type="button" class="pp-ib" data-mx="1" aria-label="닫기">✕</button></div><div class="sd-mb" id="piMB"></div></div>'; document.body.appendChild(m); m.addEventListener("click", (e) => { if (e.target === m || e.target.closest("[data-mx]")) closeModal(); }); }
    $("piMT").textContent = title; $("piMB").innerHTML = html; m.classList.add("on"); return $("piMB");
  }
  const closeModal = () => { const m = $("piModal"); if (m) m.classList.remove("on"); };

  /* ================================================================== 고치기 */
  const TB = { years: () => S.d.period.years, budget: () => S.d.budget, partners: () => S.d.partners, sy: () => S.d.summary.years, ss: () => S.d.summary.stages };
  const NEW = { years: () => ({ stage: "", year: "", start: "", end: "" }), budget: () => ({ stage: "", year: (S.d.budget.length + 1) + "차년도", gov: "", oc: "", ok: "", xc: "", xk: "" }), partners: () => ({ name: "", lead: "", title: "", mobile: "", email: "", type: "" }), sy: () => ({ year: (S.d.summary.years.length + 1) + "차년도", goal: "", content: "" }), ss: () => ({ stage: S.d.summary.stages.length + 1, goal: "", content: "" }) };
  const FLOWBOARD_PLAN = false;   // (v119) 과제 정보의 주인은 연구행정이다. FlowBoard 에픽 경로는 쓰지 않게만 둔다
  const toAdmin = () => !!(S.p && S.p.rnd && S.rk && S.rk.connected);
  const planOf = (d) => { const o = JSON.parse(JSON.stringify(d)); delete o.sync; delete o.history; delete o.bundle; return o; };
  // 고친 내용을 연구행정으로 보낸다. 실패하면 고친 값은 임시 자료로 남고 이유를 알린다
  async function pushPlan(note) {
    if (!confirm("고친 과제 정보를 연구행정관리시스템에 저장할까요?\n\n과제: " + ((S.p.rnd.code || "") + " " + (S.p.rnd.name || "")).trim())) return false;
    toast("연구행정에 저장하는 중…", 8000);
    try { await rnd("planput", { pid: S.pid }, { plan: planOf(S.d), note: note, ifUpdatedAt: ((S.d.bundle || {}).project || {}).updatedAt || "" }); }
    catch (e) { toast("저장하지 못했어요: " + e.message + " — 고친 값은 임시 자료로 남겨 뒀어요", 6000); return false; }
    await pullAdmin(true); toast("연구행정에 저장했어요", 3500); render(); return true;
  }
  function editStart() {
    if (locked() && !toAdmin() && !confirm("연구행정관리시스템에서 받은 자료예요. 정식 수정은 연구행정관리시스템에서 해 주세요.\n\n여기서 고치면 '임시 자료'가 되고, 다음에 받을 때 연구행정관리시스템 자료로 덮여요. 그래도 고칠까요?")) return;
    S.edit = true; S.before = JSON.parse(JSON.stringify(S.d)); render();
  }
  async function editDone() { S.edit = false; const changed = JSON.stringify(flat(S.before || {})) !== JSON.stringify(flat(S.d)); const prev = S.before; S.before = null; if (changed) save("manual", "직접 고침", prev); render(); if (!changed) return; if (toAdmin()) await pushPlan("ScholarFlow에서 수정"); else toast("저장했어요(임시 자료)"); }
  function onChange(e) {
    const t = e.target;
    if (t.dataset.k) { const ks = t.dataset.k.split("."); if (/^\d+$/.test(ks[ks.length - 1])) { const arr = get(S.d, ks.slice(0, -1).join(".")); arr[+ks[ks.length - 1]] = t.value; } else if (ks.length > 2 && /^\d+$/.test(ks[2])) { get(S.d, ks[0] + "." + ks[1])[+ks[2]][ks[3]] = t.value; } else set(S.d, t.dataset.k, t.value); }
    if (t.dataset.t) { const row = TB[t.dataset.t]()[+t.dataset.r]; if (row) row[t.dataset.c] = t.value; if (t.dataset.t === "budget") { clearTimeout(onChange.t); onChange.t = setTimeout(() => { const y = window.scrollY, f = document.activeElement && document.activeElement.dataset; paintBody(); window.scrollTo(0, y); if (f && f.t) { const n = document.querySelector('[data-t="' + f.t + '"][data-r="' + f.r + '"][data-c="' + f.c + '"]'); if (n) n.focus(); } }, 50); } }
    if (t.id === "piSel") return;
    PS(key(), S.d);
  }
  async function onClick(e) {
    const t = e.target; let b;
    if ((b = t.closest("[data-pt]"))) { S.tab = b.dataset.pt; PS("pi.tab", S.tab); S.area.querySelectorAll(".pi-tabs [data-pt]").forEach((x) => { const on = x.dataset.pt === S.tab; x.classList.toggle("on", on); x.setAttribute("aria-selected", on ? "true" : "false"); }); paintBody(); return; }
    if ((b = t.closest("[data-add]"))) { TB[b.dataset.add]().push(NEW[b.dataset.add]()); PS(key(), S.d); paintBody(); return; }
    if ((b = t.closest("[data-del]"))) { TB[b.dataset.del]().splice(+b.dataset.r, 1); PS(key(), S.d); paintBody(); return; }
    if ((b = t.closest("[data-fill]"))) { aiFill(b.dataset.fill); return; }
    if ((b = t.closest("[data-go]"))) { PS("hub.rnd", S.pid); if (b.dataset.go === "rnd") RND.open(S.pid); else navTo(b.dataset.go); return; }
    if (!(b = t.closest("[data-pi]"))) return;
    const k = b.dataset.pi;
    if (k === "link") { linkDialog(); return; }
    if (k === "unlink") { if (!confirm("이 프로젝트와 연구행정 과제의 연결을 끊을까요? 받은 자료는 남아요.")) return; try { await rnd("unlink", { pid: S.pid }, {}); delete S.p.rnd; render(); } catch (er) { toast(er.message, 4000); } return; }
    if (k === "diag") { diagnose(); return; }
    if (k === "open") RND.open(S.pid); if (k === "pull") pull(); if (k === "ai") aiFill(null); if (k === "json") importJson(); if (k === "edit") editStart(); if (k === "done") editDone();
    if (k === "export") doExport();
    if (k === "tpl") TK.download("과제 정보 빈 양식.json", JSON.stringify({ format: "rnd-plan/1", plan: blankShape() }, null, 2), "application/json");
    if (k === "epic") { if (window.RNDLINK && RNDLINK.epicImport) RNDLINK.epicImport(async () => { try { S.list = (await RND.ws.req("projects")).list || []; S.p = S.list.find((x) => x.id === S.pid) || S.p; } catch (er) { /* 계속 */ } S.kb = null; render(); loadSide(); }, S.pid); }
    if (k === "clear") doClear();
    if (k === "more") { const r = b.getBoundingClientRect(); popMenu([["⬆ JSON 불러오기", importJson], ["⬇ JSON 내보내기", doExport], ["🖨 인쇄·PDF", () => window.print()], "-", ["🗑 받은 자료 비우기", doClear, true]], r.left - 140, r.bottom + 4); }
  }
  function doExport() { TK.download((S.d.title.ko || S.p.name || "과제") + " 과제 정보.json", JSON.stringify({ format: "rnd-plan/1", plan: Object.assign({}, S.d, { history: undefined }) }, null, 2), "application/json"); }
  function doClear() { if (!confirm("받은 과제 정보를 이 화면에서 비울까요? 연구행정관리시스템의 자료는 그대로예요.")) return; const h = S.d.history; S.d = norm({ history: h }); PS(key(), S.d); render(); }
  function popMenu(items, x, y) {
    let el = $("piMenu"); if (!el) { el = document.createElement("div"); el.id = "piMenu"; el.className = "pp-menu"; document.body.appendChild(el); document.addEventListener("mousedown", (e) => { if (!e.target.closest("#piMenu")) el.classList.remove("on"); }); }
    el.innerHTML = items.map((it, i) => (it === "-" ? "<hr>" : '<button type="button" data-mi="' + i + '"' + (it[2] ? ' class="danger"' : "") + ">" + it[0] + "</button>")).join("");
    el.classList.add("on"); el.style.left = Math.max(8, Math.min(window.innerWidth - el.offsetWidth - 8, x)) + "px"; el.style.top = Math.max(8, Math.min(window.innerHeight - el.offsetHeight - 8, y)) + "px";
    el.onclick = (e) => { const b = e.target.closest("[data-mi]"); if (!b) return; el.classList.remove("on"); items[+b.dataset.mi][1](); };
  }

  function build() {
    const content = document.querySelector("main.content"); if (!content || typeof EXT_VIEWS === "undefined") return;
    let a = $("hub_rx_proj"); if (!a) { a = document.createElement("section"); a.id = "hub_rx_proj"; a.className = "hidden"; content.appendChild(a); }
    EXT_VIEWS.rx_proj = { area: a, open: () => paint(a).catch((er) => { a.innerHTML = '<p class="lb-warn">' + esc(er.message) + "</p>"; }) };
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(build, 40)); else setTimeout(build, 60);
  window.PINFO = { get: (pid) => norm(P("rnd.pinfo." + pid, null)), state: S, norm: norm, registerOutput: registerOutput, connectForm: connectForm, hubAdmin: hubAdmin, route: route };
})();
