/* dashboard.js (v130) — 연구지원 첫 화면. 숫자 대신 지금 할 일과 그 근거를 보여 준다.
 *   판정은 서버(tools/dash_api.py)가 하고, 이 파일은 그린다. 모든 줄은 근거 항목으로 이동한다.
 *   쓰기는 확인 카드를 거친다: 자료 정리는 카드에서 시작하고, 저장은 AI 작업의 결과 카드에서 또 확인한다. */
(function () {
  let area = null, data = null;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = async (op, post) => {
    const r = await fetch("api.php?r=dash&op=" + op, post ? { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-Study-Vault": "1" }, body: "{}" } : { credentials: "same-origin", cache: "no-store" });
    const d = await r.json().catch(() => null);
    if (!d) throw new Error("HTTP " + r.status);
    if (r.status >= 400 || (!post && d.ok === false)) throw new Error(d.message || "HTTP " + r.status);
    return d;
  };
  const links = [];
  const go = (l) => { links.push(l); return ' data-dx-go="' + (links.length - 1) + '"'; };
  const delta = (a, b) => { const d = a - b; return d ? '<small class="' + (d > 0 ? "up" : "down") + '">지난주보다 ' + (d > 0 ? "+" : "") + d + "</small>" : "<small>지난주와 같음</small>"; };
  const rowBtn = (l, main, sub, tail, cls) => '<button type="button" class="dx-row ' + (cls || "") + '"' + go(l) + '><span class="dx-m"><b>' + esc(main) + "</b>" + (sub ? "<small>" + esc(sub) + "</small>" : "") + "</span>" + (tail ? '<span class="dx-t">' + tail + "</span>" : "") + "</button>";
  const sec = (title, n, body, more) => '<section class="dx-sec"><header><h3>' + esc(title) + "</h3>" + (n ? "<em>" + n + "</em>" : "") + (more || "") + "</header>" + body + "</section>";
  const none = (t) => '<p class="dx-none">' + esc(t) + "</p>";

  /* (v181) 불러오는 동안 빈 공간 대신 칸 모양 그대로의 뼈대(반짝임)와 진행 막대 */
  function skRows(n, big) { let h = ""; for (let i = 0; i < n; i++) h += '<div class="dx-sk-row' + (big ? " big" : "") + '"><i class="dx-sk dx-sk-dot"></i><span><i class="dx-sk dx-sk-l1"></i><i class="dx-sk dx-sk-l2"></i></span></div>'; return h; }
  function skCard(title, rows) { return '<section class="dx-sec dx-sk-sec"><header><h3>' + esc(title) + "</h3></header>" + skRows(rows || 3) + "</section>"; }
  function progStrip(label, done, total) {
    const det = total > 0, pct = det ? Math.max(4, Math.round(100 * done / total)) : 0;
    return '<div class="dx-prog" role="progressbar" aria-label="' + esc(label) + '"' + (det ? ' aria-valuemin="0" aria-valuemax="' + total + '" aria-valuenow="' + done + '"' : "") + '><span class="dx-prog-t"><i class="dx-spin" aria-hidden="true"></i>' + esc(label) + (det ? " <b>" + done + " / " + total + "</b>" : "") + '</span><span class="dx-prog-bar' + (det ? "" : " ind") + '"><i style="width:' + (det ? pct : 35) + '%"></i></span></div>';
  }
  function skeleton() {
    const k = '<div class="dx-sk-kpi"><i class="dx-sk dx-sk-l2"></i><i class="dx-sk dx-sk-num"></i><i class="dx-sk dx-sk-l2"></i></div>';
    return '<div class="sv dx dx-loading" aria-busy="true"><div class="dx-top"><div><i class="dx-sk dx-sk-l2" style="width:180px"></i><i class="dx-sk dx-sk-h"></i></div></div>' +
      progStrip("연구 현황을 모으는 중 — 프로젝트·문서·대화 기록을 읽고 있습니다", 0, 0) +
      '<div class="dx-hero"><h3 class="dx-h1">지금 할 일 세 가지</h3><h3 class="dx-h2">AI 브리핑</h3><div class="dx-now">' + skRows(3, true) + '</div><section class="dx-brief">' + skRows(2) + "</section></div>" +
      '<div class="dx-sk-kpis">' + k + k + k + k + k + "</div>" +
      '<div class="dx-viz">' + skCard("활동 지도", 4) + skCard("프로젝트 상태", 4) + skCard("어디에 시간을 썼나", 4) + "</div>" +
      '<div class="dx-grid">' + skCard("멈춘 프로젝트와 이유") + skCard("다가오는 기한") + skCard("최근 활동") + "</div></div>";
  }
  function nowCards(d) {
    return '<div class="dx-now">' + d.now.map((x, i) => '<article class="dx-do"><span class="dx-no">' + (i + 1) + "</span><div><b>" + esc(x.title) + "</b><p>" + esc(x.why) + '</p></div><button type="button" class="ghost-btn small-btn"' + (x.action ? ' data-dx-act="' + esc(JSON.stringify(x.action)) + '"' : go(x.link)) + ">" + esc(x.go) + "</button></article>").join("") + (d.now.length ? "" : d.scanning ? skRows(3, true) : none("지금 급한 일이 없습니다.")) + "</div>";
  }
  function brief(d) {
    const b = d.brief, st = d.status || {}, sk = d.activeRun || {};
    const pill = (v, l, cls) => '<span class="dx-pill ' + (cls || "") + '"><b>' + v + "</b>" + esc(l) + "</span>";
    return '<section class="dx-brief" id="dxBrief"><div class="dx-pills">' + pill(st.active || 0, "진행 중") + pill((sk.cur || 0) + "일", "연속 기록", sk.cur >= 3 ? "ok" : "") + pill(d.piledN || 0, "정리 대기", d.piledN ? "warn" : "") + pill(d.deadlines.filter((x) => x.days >= 0 && x.days <= 30).length, "30일 안 기한") + "</div>" +
      (b ? "<p>" + esc(b.text) + '</p><small>AI 요약 · ' + esc(b.model || "") + " · 판단은 아래 근거를 기준으로 합니다</small>" : '<p class="dx-muted">' + (d.aiReady ? "코드가 판정한 결과를 AI 가 세 문장으로 요약합니다." : "AI 연결이 없어도 아래 판정은 그대로 동작합니다.") + "</p>") +
      '<div class="dx-bb">' + (!b && d.aiReady ? '<button type="button" class="primary small-btn" data-dx="brief">AI 브리핑 받기</button>' : "") + (!d.aiReady ? '<button type="button" class="ghost-btn small-btn" data-dx="aiconn">AI 연결</button>' : "") + '<button type="button" class="ghost-btn small-btn" data-dx="ask">이 화면으로 묻기</button></div></section>';
  }
  /* 작은 그림들 — 색은 강조색 하나를 진하기만 바꿔 쓴다 */
  function spark(arr) {
    const n = arr.length, max = Math.max(1, ...arr), W = 120, H = 30;
    const pts = arr.map((v, i) => [Math.round(i * W / (n - 1)), Math.round(H - 3 - (H - 6) * v / max)]);
    const line = pts.map((p) => p.join(",")).join(" ");
    return '<svg class="dx-spark" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" aria-hidden="true"><polygon points="0,' + H + " " + line + " " + W + "," + H + '" /><polyline points="' + line + '" /><circle cx="' + pts[n - 1][0] + '" cy="' + pts[n - 1][1] + '" r="2.6" /></svg>';
  }
  function ring(pct, label) {
    const r = 17, c = 2 * Math.PI * r, v = pct == null ? 0 : pct;
    return '<svg class="dx-ring" viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="' + r + '" class="bg"/><circle cx="22" cy="22" r="' + r + '" class="fg" stroke-dasharray="' + (c * v / 100).toFixed(1) + " " + c.toFixed(1) + '"/><text x="22" y="26">' + esc(label) + "</text></svg>";
  }
  function kpis(d) {
    const w = d.week, m = d.meeting, t = d.trend || { docs: [], files: [], chats: [] }, sk = d.activeRun || {};
    const k = (l, v, sub, vis) => '<div class="dx-k"><span>' + esc(l) + '</span><div class="dx-kv"><b>' + v + "</b>" + (vis || "") + "</div>" + sub + "</div>";
    return '<div class="dx-ks">' + k("이번 주 문서 저장", w.docs, delta(w.docs, w.docsPrev), spark(t.docs)) + k("이번 주 새 자료", w.files, delta(w.files, w.filesPrev), spark(t.files)) + k("AI 와 나눈 질문", w.chats, delta(w.chats, w.chatsPrev), spark(t.chats)) +
      k("연속 기록", (sk.cur || 0) + "<small>일</small>", "<small>12주 최장 " + (sk.best || 0) + "일 · 4주 중 " + (sk.days28 || 0) + "일 활동</small>", '<span class="dx-dots">' + (d.heat || []).slice(-14).map((n) => "<i" + (n ? ' class="on"' : "") + "></i>").join("") + "</span>") +
      k("회의 할 일 이행", m.rate == null ? "-" : m.rate + "<small>%</small>", "<small>" + (m.total ? "전체 " + m.total + "건 · 남음 " + m.open + "건" : "기록 없음") + "</small>", ring(m.rate, m.total ? m.done + "/" + m.total : "-")) + "</div>";
  }
  const LV = { warn: ["주의", "!"], ok: ["좋음", "✓"], info: ["참고", "i"] };
  function insights(d) {
    if (!d.insights.length) return "";
    return '<section class="dx-ins"><header><h3>인사이트</h3><em>' + d.insights.length + '</em><small>기록에서 코드가 찾은 패턴 · 누르면 근거로 갑니다</small></header><div class="dx-insg">' +
      d.insights.map((x) => '<button type="button" class="dx-in lv-' + esc(x.level) + '"' + go(x.link) + '><span class="dx-ib">' + (LV[x.level] || LV.info)[1] + "</span><span><small>" + (LV[x.level] || LV.info)[0] + "</small>" + esc(x.text) + "</span></button>").join("") + "</div></section>";
  }
  function heatCard(d) {
    const h = d.heat || []; if (!h.length) return "";
    const start = new Date(d.heatStart + "T00:00:00"), off = (start.getDay() + 6) % 7, max = Math.max(1, ...h);
    const lv = (n) => (n ? Math.min(4, 1 + Math.floor(3.999 * n / max)) : 0);
    let cells = ""; for (let i = 0; i < off; i++) cells += '<i class="pad"></i>';
    let months = "", lastM = -1;
    h.forEach((n, i) => {
      const dt = new Date(start.getTime() + i * 864e5);
      cells += '<i class="l' + lv(n) + '" title="' + (dt.getMonth() + 1) + "월 " + dt.getDate() + "일 · " + n + '건"></i>';
      const col = Math.floor((i + off) / 7);
      if (dt.getMonth() !== lastM && dt.getDate() <= 7) { months += '<span style="grid-column:' + (col + 1) + '">' + (dt.getMonth() + 1) + "월</span>"; lastM = dt.getMonth(); }
    });
    const cols = Math.ceil((h.length + off) / 7);
    const total = h.reduce((a, b) => a + b, 0), days = h.filter((n) => n).length, bi = h.indexOf(Math.max(...h));
    const bd = new Date(start.getTime() + bi * 864e5);
    const hr = d.hours || [], hm = Math.max(1, ...hr);
    const hours = '<div class="dx-hours" aria-label="시간대별 기록">' + hr.map((n, i) => '<i style="height:' + (n ? 15 + Math.round(85 * n / hm) : 4) + '%" title="' + i + "시 · " + n + '건"' + (n ? "" : ' class="z"') + "></i>").join("") + '</div><div class="dx-hax"><span>0시</span><span>6시</span><span>12시</span><span>18시</span><span>24시</span></div>';
    return '<section class="dx-sec dx-v dx-heatc"><header><h3>활동 지도</h3><small>최근 12주 · 문서·자료·대화·연결 폴더 변화</small></header><div class="dx-heatw"><div class="dx-heatm" style="--cols:' + cols + '"><div class="dx-mon">' + months + '</div><div class="dx-wd"><span>월</span><span></span><span>수</span><span></span><span>금</span><span></span><span></span></div><div class="dx-heat">' + cells + "</div></div>" +
      '<dl class="dx-hs"><div><dt>12주 기록</dt><dd>' + total + "</dd></div><div><dt>활동한 날</dt><dd>" + days + "<small>/84</small></dd></div><div><dt>가장 바빴던 날</dt><dd>" + (h[bi] ? bd.getMonth() + 1 + "." + bd.getDate() : "-") + "<small>" + (h[bi] ? " · " + h[bi] + "건" : "") + "</small></dd></div><div><dt>연속 기록</dt><dd>" + ((d.activeRun || {}).cur || 0) + "<small>일</small></dd></div></dl></div>" +
      '<div class="dx-hourw"><h4>하루 중 언제 일했나</h4>' + hours + '</div><div class="dx-lg"><span>적음</span><i class="l0"></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i><span>많음</span></div></section>';
  }
  function donutCard(d) {
    const st = d.status || {}, segs = [["active", "진행 중", "a"], ["stalled", "멈춤", "w"], ["old", "오래 멈춤", "m"], ["over", "기간 끝남", "c"]];
    const tot = segs.reduce((a, s) => a + (st[s[0]] || 0), 0); if (!tot) return "";
    const r = 42, c = 2 * Math.PI * r; let acc = 0, arcs = "";
    segs.forEach((s) => { const v = st[s[0]] || 0; if (!v) return; const len = c * v / tot; arcs += '<circle cx="60" cy="60" r="' + r + '" class="sg-' + s[2] + '" stroke-dasharray="' + Math.max(0, len - 1.5).toFixed(1) + " " + c.toFixed(1) + '" stroke-dashoffset="' + (-acc).toFixed(1) + '"/>'; acc += len; });
    return '<section class="dx-sec dx-v"><header><h3>프로젝트 상태</h3><small>마지막 활동 기준</small></header><div class="dx-donw"><svg class="dx-don" viewBox="0 0 120 120" role="img" aria-label="프로젝트 ' + tot + '개"><circle cx="60" cy="60" r="' + r + '" class="bg"/>' + arcs + '<text x="60" y="58" class="n">' + tot + '</text><text x="60" y="76" class="l">프로젝트</text></svg><ul class="dx-leg">' +
      segs.map((s) => '<li><button type="button"' + go({ view: "rnd" }) + '><i class="sg-' + s[2] + '"></i><span>' + s[1] + "</span><b>" + (st[s[0]] || 0) + "</b><small>" + Math.round((st[s[0]] || 0) * 100 / tot) + "%</small></button></li>").join("") + "</ul></div>" +
      (st.unstarted ? '<p class="dx-cap">그중 ' + st.unstarted + "개는 연결만 하고 아직 기록이 없습니다.</p>" : "") + "</section>";
  }
  function focusCard(d) {
    const f = d.focus || []; if (!f.length) return "";
    return '<section class="dx-sec dx-v"><header><h3>어디에 시간을 썼나</h3><small>최근 4주 · ' + d.focusTotal + '건</small></header><div class="dx-stack">' + f.map((x, i) => '<i class="f' + i + '" style="width:' + Math.max(2, x.pct) + '%" title="' + esc(x.project) + " " + x.pct + '%"></i>').join("") + '</div><ul class="dx-fl">' +
      f.map((x, i) => '<li><button type="button"' + go(x.link) + '><i class="f' + i + '"></i><span>' + esc(x.project) + "</span><b>" + x.pct + "%</b><small>" + x.n + "건</small></button></li>").join("") + "</ul></section>";
  }
  function periodCard(d) {
    const ps = d.periods || []; if (!ps.length) return "";
    const fmt = (iso) => iso.slice(2).replace(/-/g, ".");
    return '<section class="dx-sec dx-v dx-perc"><header><h3>과제 기간과 진행</h3><em>' + ps.length + '</em><small>막대 = 기간이 지난 비율 · 문서가 없으면 주의</small></header><div class="dx-pers">' + ps.map((x) => {
      const warn = x.pct >= 50 && !x.docs;
      return '<button type="button" class="dx-per' + (warn ? " warn" : "") + '"' + go(x.link) + '><span class="dx-pn2"><b>' + esc(x.project) + "</b><small>" + fmt(x.start) + " ~ " + fmt(x.end) + '</small></span><span class="dx-ptw"><span class="dx-ptr"><i style="width:' + x.pct + '%"></i></span><small>' + x.pct + '% 지남</small></span><span class="dx-pst"><span><b>' + x.docs + "</b>문서</span><span><b>" + x.files + "</b>자료</span><span><b>" + x.act + "</b>4주 활동</span>" + (warn ? '<span class="dx-pw">문서 없음</span>' : "") + '</span><span class="dx-pd' + (x.left <= 30 ? " soon" : "") + '">D-' + x.left + "</span></button>";
    }).join("") + "</div></section>";
  }
  const RK = { doc: ["문서", "doc"], file: ["자료", "file"], chat: ["질문", "chat"], export: ["내보내기", "out"], ai: ["AI", "ai"], job: ["AI 작업", "ai"] };
  function ago(t) {
    const m = Math.max(0, Math.round((Date.now() - t) / 60000));
    return m < 1 ? "방금" : m < 60 ? m + "분 전" : m < 1440 ? Math.round(m / 60) + "시간 전" : Math.round(m / 1440) + "일 전";
  }
  function recentRows(d) {
    return (d.recent || []).map((x) => { const k = RK[x.kind] || ["기록", "doc"]; return '<button type="button" class="dx-rc"' + go(x.link) + '><span class="dx-rk k-' + k[1] + '">' + k[0] + '</span><span class="dx-m"><b>' + esc(x.text) + "</b><small>" + esc(x.project || "") + '</small></span><span class="dx-t">' + ago(x.t) + "</span></button>"; }).join("");
  }
  /* 아래 목록: 가장 짧은 기둥부터 채우고, 남는 높이는 '최근 활동'으로 채운다 */
  function layoutGrid() {
    const g = area && area.querySelector(".dx-grid"); if (!g || !g.offsetWidth) return;
    const secs = [...g.querySelectorAll(":scope > .dx-col > .dx-sec, :scope > .dx-sec")];
    const n = g.offsetWidth >= 1100 ? 3 : g.offsetWidth >= 700 ? 2 : 1;
    g.innerHTML = ""; g.style.setProperty("--dx-cols", n); g.classList.add("dx-measure");
    const cols = Array.from({ length: n }, () => { const c = document.createElement("div"); c.className = "dx-col"; g.appendChild(c); return c; });
    const feed = secs.find((x) => x.classList.contains("dx-feed"));
    secs.filter((x) => x !== feed).forEach((x) => cols.reduce((a, b) => (b.offsetHeight < a.offsetHeight ? b : a)).appendChild(x));
    if (!feed) return g.classList.remove("dx-measure");
    const short = cols.reduce((a, b) => (b.offsetHeight < a.offsetHeight ? b : a));
    short.appendChild(feed);
    const rows = [...feed.querySelectorAll(".dx-rc")]; rows.forEach((r) => (r.hidden = false));
    const tall = Math.max(...cols.map((c) => (c === short ? 0 : c.offsetHeight)));
    if (n > 1 && tall) { for (let i = rows.length - 1; i >= 3 && short.offsetHeight > tall; i--) rows[i].hidden = true; }
    else rows.forEach((r, i) => (r.hidden = i >= 8));
    g.classList.remove("dx-measure");
  }
  function bars(p) {
    const max = Math.max(1, ...p.bars);
    return '<span class="dx-pulse" aria-hidden="true">' + p.bars.map((n) => '<i style="height:' + (n ? 18 + Math.round(82 * n / max) : 6) + "%" + (n ? "" : ";opacity:.35") + '"></i>').join("") + "</span>";
  }
  function paint() {
    const d = data; links.length = 0;
    const quiet = [];
    const box = (title, n, body, empty, more, scanDep) => { if (empty && scanDep && d.scanning) return skCard(title, 2); if (empty) { quiet.push(empty); return ""; } return sec(title, n, body, more); };
    const stall = d.stalled.map((x) => '<div class="dx-st"><button type="button" class="dx-sth"' + go(x.link) + "><b>" + esc(x.project) + "</b><em>" + x.idle + '일째</em></button><div class="dx-chips">' + x.reasons.map((r) => '<button type="button" class="dx-chip r-' + esc(r.code) + '"' + go(r.link) + ">" + esc(r.text) + "</button>").join("") + "</div></div>").join("");
    const pmax = Math.max(1, ...d.piled.map((x) => x.unsorted));
    const pile = d.piled.map((x) => '<div class="dx-pl"><button type="button" class="dx-row"' + go(x.link) + '><span class="dx-m"><b>' + esc(x.project) + "</b><small>" + esc((x.names || []).join(", ")) + (x.unsorted > 3 ? " 외" : "") + '</small><span class="dx-pb"><i style="width:' + Math.max(3, Math.round(100 * x.unsorted / pmax)) + '%"></i></span></span><span class="dx-t"><b>' + x.unsorted + "</b>개 · " + x.oldest + '일째</span></button><button type="button" class="ghost-btn small-btn" data-dx-act="' + esc(JSON.stringify(x.action)) + '">정리</button></div>').join("");
    const m = d.meeting;
    const meet = (m.total ? '<div class="dx-bar" role="img" aria-label="이행률 ' + m.rate + '%"><i style="width:' + m.rate + '%"></i></div><p class="dx-cap">완료 ' + m.done + " · 남음 " + m.open + (m.late ? ' · <b class="late">기한 지남 ' + m.late + "</b>" : "") + (m.nobody ? " · 담당 없음 " + m.nobody : "") + "</p>" : "") + (m.items.length ? m.items.map((a) => rowBtn(a.link, a.task, a.project + " · " + a.from + (a.who ? " · " + a.who : ""), a.due ? '<span class="' + (a.late ? "late" : "") + '">' + esc(a.due.slice(5)) + "</span>" : "", a.late ? "is-late" : "")).join("") : none("남은 할 일이 없습니다."));
    const read = d.reread.map((r) => rowBtn(r.link, r.title, r.why, r.due ? '<span class="' + (r.late ? "late" : "") + '">' + esc(String(r.due).slice(5)) + "</span>" : "", "")).join("");
    const dl = d.deadlines.map((x) => rowBtn(x.link, x.title, x.project + " · " + x.kind, '<span class="dx-dd ' + (x.days < 0 ? "late" : x.days <= 7 ? "soon" : "") + '">' + (x.days < 0 ? x.days * -1 + "일 지남" : x.days === 0 ? "오늘" : "D-" + x.days) + "</span>")).join("");
    const pulse = d.pulse.map((p) => '<button type="button" class="dx-pr"' + go(p.link) + '><span class="dx-pn">' + esc(p.project) + "</span>" + bars(p) + '<span class="dx-t">' + (p.idle ? p.idle + "일 전" : "오늘") + "</span></button>").join("");
    const grid = box("멈춘 프로젝트와 이유", d.stalledN, stall, d.stalled.length ? "" : "멈춘 프로젝트 없음", null, true) +
      box("쌓였지만 정리 안 된 자료", d.piledN, pile, d.piled.length ? "" : "정리 기다리는 자료 없음", null, true) +
      box("다가오는 기한", d.deadlines.length, dl, d.deadlines.length ? "" : "30일 안 기한 없음", null, true) +
      box("회의 할 일 이행", m.open, meet, m.total ? "" : "회의 기록 없음") +
      (d.pending.length ? sec("AI 가 확인을 기다리는 일", d.pendingN, d.pending.map((x) => rowBtn(x.link, x.title, x.project, "<b>" + x.pending + "</b>건")).join("")) : "") +
      box("이번 주 다시 볼 자료", d.reread.length, read, d.reread.length ? "" : "다시 볼 자료 없음") +
      box("연구 맥박 (최근 4주)", 0, pulse, d.pulse.length ? "" : "프로젝트 없음") +
      (d.changes.length ? sec("이번 주 변화", d.changes.length, d.changes.map((c) => rowBtn(c.link, c.text, c.project, "")).join("")) : "") +
      ((d.recent || []).length ? '<section class="dx-sec dx-feed"><header><h3>최근 활동</h3><em>' + d.recent.length + "</em><small>문서·자료·질문·AI 작업</small></header>" + recentRows(d) + "</section>" : "");
    const day = new Date(d.at), hh = day.getHours();
    area.innerHTML = '<div class="sv dx"><div class="dx-top"><div><p class="dx-kick">' + esc(day.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "long" })) + (d.scanning ? " · 연결 폴더를 살피는 중" : "") + "</p><h2>" + (hh < 12 ? "좋은 아침입니다" : hh < 18 ? "오늘의 연구" : "오늘 하루 정리") + ' <span>프로젝트 ' + d.projects + "개 · 진행 중 " + ((d.status || {}).active || 0) + '개</span></h2></div><button type="button" class="ghost-btn small-btn" data-dx="reload">새로고침</button></div>' +
      (d.scanning ? progStrip("연결 폴더와 연구행정 일정을 살피는 중 — 끝나면 멈춤·정리 대기·기한이 채워집니다", (d.scanProg || [0, 0])[0], (d.scanProg || [0, 0])[1]) : "") +
      '<div class="dx-hero"><h3 class="dx-h1">지금 할 일 세 가지</h3><h3 class="dx-h2">AI 브리핑</h3>' + nowCards(d) + brief(d) + "</div>" + kpis(d) + insights(d) +
      '<div class="dx-viz">' + heatCard(d) + donutCard(d) + focusCard(d) + periodCard(d) + "</div>" +
      '<div class="dx-grid">' + grid + "</div>" + (quiet.length ? '<p class="dx-quiet"><b>조용한 곳</b>' + quiet.map((q) => "<span>" + esc(q) + "</span>").join("") + "</p>" : "") + "</div>";
    layoutGrid();
    if (!paint.ro && window.ResizeObserver) { let w0 = 0; paint.ro = new ResizeObserver(() => { const g = area.querySelector(".dx-grid"); if (g && Math.abs(g.offsetWidth - w0) > 30) { w0 = g.offsetWidth; layoutGrid(); } }); paint.ro.observe(area); }
  }
  const SOON_NONE = "30일 안의 기한이 없습니다.";

  async function follow(l) {
    if (!l) return;
    if (l.hash) { location.hash = l.hash; return; }
    if (l.job && window.AITASK) return AITASK.open(l.job);
    if (l.lib) { await navTo("library"); if (typeof libOpen === "function") libOpen(l.lib); return; }
    if (l.view) { if (l.pid && window.TK) TK.store.set("hub.rnd", l.pid); return navTo(l.view); }
  }
  function confirmCard(a) {
    const box = document.createElement("div"); box.className = "dx-confirm";
    const name = (data.piled.filter((x) => x.pid === a.pid)[0] || {}).project || "";
    box.innerHTML = "<b>'" + esc(name) + "' 자료 " + a.n + '개를 AI 가 정리합니다</b><p>자료를 읽고 종류를 나눠 요약합니다. 문서 초안은 제안 카드로 나오며, 확인 전에는 저장되지 않습니다.</p><div><button type="button" class="primary small-btn" data-c="go">시작</button><button type="button" class="ghost-btn small-btn" data-c="no">취소</button></div>';
    const old = area.querySelector(".dx-confirm"); if (old) old.remove();
    area.querySelector(".dx-hero").after(box); box.scrollIntoView({ block: "nearest", behavior: "instant" });
    box.onclick = async (e) => {
      const b = e.target.closest("[data-c]"); if (!b) return;
      if (b.dataset.c === "no") return box.remove();
      b.disabled = true;
      try { const r = await AITASK.start(a.kind, a.pid); box.remove(); if (r && r.id) AITASK.open(r.id); } catch (er) { b.disabled = false; box.querySelector("p").textContent = "⚠ " + er.message; }
    };
  }
  async function onClick(e) {
    const act = e.target.closest("[data-dx-act]");
    if (act) return confirmCard(JSON.parse(act.dataset.dxAct));
    const g = e.target.closest("[data-dx-go]");
    if (g) return follow(links[+g.dataset.dxGo]);
    const b = e.target.closest("[data-dx]"); if (!b) return;
    const k = b.dataset.dx;
    if (k === "reload") return load();
    if (k === "aiconn") return navTo("aiconn");
    if (k === "ask") { const f = document.querySelector("#askFab,.ask-fab"); if (f) f.click(); return; }
    if (k === "brief") {
      b.disabled = true; b.textContent = "요약 중…";
      try { const r = await api("brief", true); if (r.brief) { data.brief = r.brief; paint(); } else { b.disabled = false; b.textContent = "AI 브리핑 받기"; document.querySelector("#dxBrief p").textContent = r.message || "요약하지 못했습니다."; } }
      catch (er) { b.disabled = false; b.textContent = "AI 브리핑 받기"; document.querySelector("#dxBrief p").textContent = "⚠ " + er.message; }
    }
  }
  async function load() {
    if (!area.firstChild || !data) area.innerHTML = skeleton();
    try { data = await api("summary"); paint(); clearTimeout(load.t); if (data.scanning) load.t = setTimeout(() => { if (area.offsetHeight) load(); }, 2000); } catch (e) { area.innerHTML = '<div class="sv dx"><p class="lb-warn">' + esc(e.message) + "</p></div>"; }
  }
  /* 물어보기가 이 화면을 맥락으로 쓴다 */
  function context() {
    if (!data) return "";
    const d = data, L = [];
    d.now.forEach((x, i) => L.push("지금 할 일 " + (i + 1) + ": " + x.title + " (" + x.why + ")"));
    d.stalled.forEach((x) => L.push("멈춤: " + x.project + " " + x.idle + "일째, " + x.reasons.map((r) => r.text).join(", ")));
    d.piled.forEach((x) => L.push("정리 안 된 자료: " + x.project + " " + x.unsorted + "개"));
    if (d.meeting.total) L.push("회의 할 일: 이행률 " + d.meeting.rate + "%, 남음 " + d.meeting.open + ", 기한 지남 " + d.meeting.late);
    d.deadlines.forEach((x) => L.push("기한: " + x.project + " " + x.title + " " + x.date));
    d.insights.forEach((x) => L.push("해석: " + x.text));
    return "[오늘 연구 대시보드]\n" + L.join("\n") + "\n";
  }
  function init() {
    const content = document.querySelector("main.content"); if (!content || typeof EXT_VIEWS === "undefined" || EXT_VIEWS.rx_dash) return;
    area = document.createElement("section"); area.id = "hub_rx_dash"; area.className = "hidden"; content.appendChild(area);
    area.addEventListener("click", onClick);
    EXT_VIEWS.rx_dash = { area: area, open: () => load() };
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
  window.DASHBOARD = { context: context, reload: () => load() };
})();
