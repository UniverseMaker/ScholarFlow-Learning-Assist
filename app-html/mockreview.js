(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const P = (k, d) => (window.TK ? TK.store.get(k, d) : d), PS = (k, v) => { if (window.TK) TK.store.set(k, v); };
  const fmtT = (t) => new Date(t).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  function toast(t, ms) { let el = $("mrToast"); if (!el) { el = document.createElement("div"); el.id = "mrToast"; el.className = "pp-toast"; document.body.appendChild(el); } el.textContent = t; el.classList.add("on"); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("on"), ms || 2600); }
  const RUBRICS = [
    { id: "rnd", name: "국가 R&D 과제 선정평가", crit: [["연구 필요성·시급성", 20], ["목표의 도전성·타당성", 20], ["연구 내용·방법의 적정성", 25], ["수행 체계·역량", 15], ["활용 계획·파급 효과", 20]] },
    { id: "mid", name: "중간·단계 평가", crit: [["계획 대비 달성도", 35], ["성과의 질", 25], ["문제 대응", 15], ["다음 단계 계획", 25]] },
    { id: "paper", name: "학회·학술지 논문 심사", crit: [["독창성·기여", 30], ["방법의 엄밀성", 30], ["결과의 타당성", 25], ["글의 명료성", 15]] },
    { id: "thesis", name: "학위논문 심사", crit: [["문제 설정", 20], ["선행연구 이해", 20], ["방법론", 25], ["결과 해석", 20], ["학문적 기여", 15]] },
    { id: "policy", name: "정책·기획 보고 검토", crit: [["문제 진단", 25], ["대안의 실행 가능성", 30], ["근거의 충실성", 25], ["기대 효과·재정", 20]] },
  ];
  const PANEL = [
    ["domain", "🧑‍🔬", "분야 전문가", "이 분야 최신 연구를 잘 아는 교수. 기술 수준과 독창성을 깐깐하게 본다."],
    ["method", "📐", "방법론 전문가", "통계·실험 설계 전문가. 표본, 평가 방법, 재현성의 빈틈을 찾는다."],
    ["fund", "💰", "기획·예산 심사관", "재정 담당 관료. 정량 목표, 일정, 예산 대비 효과, 중복 여부를 따진다."],
    ["skeptic", "🦅", "회의론자", "무조건 반대편에서 본다. 가장 약한 논리와 과장된 주장을 공격한다."],
    ["field", "🏗", "현장 실무자", "실제 쓸 사람. 현장 적용성, 비용, 유지 관리, 법·제도 장벽을 묻는다."],
  ];
  const S = { pid: "", list: [], docs: [], did: "", rub: P("mr.rub", "rnd"), crit: null, panel: P("mr.panel", ["domain", "method", "fund", "skeptic"]), tab: "setup", cur: null, busy: false, area: null, qa: null };
  const key = () => "rnd.review." + S.pid; const hist = () => ((P(key(), null) || {}).list) || [];
  const critOf = () => S.crit || RUBRICS.find((r) => r.id === S.rub).crit.map((c) => c.slice());

  async function paint(area) {
    S.area = area;
    try { S.list = (await RND.ws.req("projects")).list || []; } catch (e) { area.innerHTML = '<p class="lb-warn">' + esc(e.message) + "</p>"; return; }
    if (!S.list.length) { area.innerHTML = '<div class="sv hub"><div class="hub-head"><div><h2>심사·평가 대비</h2></div></div><p class="sh-muted">연구 프로젝트를 먼저 만드세요.</p></div>'; return; }
    let pid = P("hub.rnd", "") || (RND.cur && RND.cur()) || S.list[0].id; if (!S.list.some((p) => p.id === pid)) pid = S.list[0].id;
    if (pid !== S.pid) { S.pid = pid; S.cur = hist()[0] || null; S.did = ""; }
    try { S.docs = (await RND.ws.req("docs", { pid: S.pid })).list || []; } catch (e) { S.docs = []; }
    if (!S.docs.some((d) => d.id === S.did)) S.did = (S.docs[0] || {}).id || "";
    const TABS = [["setup", "⚙ 심사 준비"], ["board", "📊 점수판"], ["fix", "🛠 수정 목록"], ["qa", "🎤 질의응답 리허설"], ["hist", "📈 회차별 추이"]];
    area.innerHTML = '<div class="sv ll mr" id="mr"><div class="ll-top"><div class="ll-t1"><b>🎯 모의 심사실</b><select id="mrProj" class="pp-proj">' + S.list.map((p) => '<option value="' + esc(p.id) + '"' + (p.id === S.pid ? " selected" : "") + ">" + esc(p.name) + '</option>').join("") + '</select><span class="ll-cnt">' + (S.cur ? "최근 " + S.cur.total + "점 · " + fmtT(S.cur.t) : "아직 심사 전") + '</span></div><nav class="ll-tabs">' + TABS.map((t) => '<button type="button" data-mt="' + t[0] + '">' + t[1] + "</button>").join("") + '</nav></div><div id="mrMain"></div></div>';
    $("mrProj").addEventListener("change", (e) => { PS("hub.rnd", e.target.value); paint(area); });
    if (window.AITASK) {   // (v124) 심사를 서버 작업으로 — 화면을 닫아도 끝까지 돌고 수정본은 카드로 나온다
      area.querySelector(".ll-t1").insertAdjacentHTML("beforeend", '<button type="button" class="ghost-btn small-btn" id="mrAiTask">AI 심사 반복</button>');
      $("mrAiTask").onclick = async () => { if (!S.did) return alert("심사할 문서가 없어요."); try { const j = await AITASK.start("review", S.pid, S.did); AITASK.open(j.id); } catch (e) { alert(e.message); } };
    }
    area.onclick = onClick; tab();
  }
  function tab() {
    document.querySelectorAll("#mr [data-mt]").forEach((b) => b.classList.toggle("on", b.dataset.mt === S.tab)); const m = $("mrMain"); if (!m) return;
    ({ setup: pSetup, board: pBoard, fix: pFix, qa: pQa, hist: pHist })[S.tab](m);
  }
  function pSetup(m) {
    const c = critOf(), sum = c.reduce((a, x) => a + (+x[1] || 0), 0);
    m.innerHTML = '<div class="mr-grid"><section class="mr-card"><h4>1. 심사받을 문서</h4>' + (S.docs.length ? '<select id="mrDoc">' + S.docs.map((d) => '<option value="' + esc(d.id) + '"' + (d.id === S.did ? " selected" : "") + ">" + esc(d.title) + " (v" + d.v + ")</option>").join("") + "</select>" : '<p class="sh-muted">이 프로젝트에 문서가 없어요. 📝 보고서 작성·보조에서 만드세요.</p>') +
      '<h4>2. 평가 종류</h4><div class="mr-rub">' + RUBRICS.map((r) => '<button type="button" data-rub="' + r.id + '" class="' + (S.rub === r.id ? "on" : "") + '">' + esc(r.name) + "</button>").join("") + '</div><h4>배점표 <small class="' + (sum === 100 ? "" : "bad") + '">합계 ' + sum + '점</small></h4><div class="mr-crit">' + c.map((x, i) => '<div><input data-cn="' + i + '" value="' + esc(x[0]) + '"><input type="number" min="0" max="100" data-cw="' + i + '" value="' + x[1] + '"><button type="button" class="pp-ib" data-cdel="' + i + '" aria-label="지우기">✕</button></div>').join("") + '</div><button type="button" class="ghost-btn small-btn" data-m="cadd">＋ 항목</button></section>' +
      '<section class="mr-card"><h4>3. 심사위원단</h4><div class="mr-panel">' + PANEL.map((p) => '<button type="button" data-pn="' + p[0] + '" class="' + (S.panel.indexOf(p[0]) >= 0 ? "on" : "") + '"><i>' + p[1] + "</i><b>" + p[2] + "</b><small>" + p[3] + "</small></button>").join("") + '</div><button type="button" class="primary mr-go" data-m="run"' + (S.docs.length ? "" : " disabled") + ">▶ 심사 시작</button><p class=\"sh-muted\">위원마다 문서를 따로 읽고 채점해요. 프로젝트 자료는 쓰지 않고 문서에 쓰인 내용만 봐요 — 실제 심사처럼요.</p><div id=\"mrProg\"></div></section></div>";
    const d = $("mrDoc"); if (d) d.addEventListener("change", (e) => { S.did = e.target.value; });
    m.oninput = (e) => { const t = e.target; const c2 = critOf(); if (t.dataset.cn != null) c2[+t.dataset.cn][0] = t.value; else if (t.dataset.cw != null) c2[+t.dataset.cw][1] = +t.value || 0; else return; S.crit = c2; };
  }
  async function docText() { const d = (await RND.ws.req("doc", { pid: S.pid, did: S.did })).doc; return { title: d.title, v: d.v, text: d.sections.map((s) => "## " + s.h + "\n" + (s.body || "")).join("\n\n").slice(0, 32000) }; }
  async function run() {
    if (S.busy) return; const pan = PANEL.filter((p) => S.panel.indexOf(p[0]) >= 0); if (pan.length < 2) return toast("심사위원을 2명 이상 고르세요"); const crit = critOf();
    S.busy = true; const box = $("mrProg"); const mark = (id, t) => { const el = $("mrP_" + id); if (el) el.textContent = t; };
    box.innerHTML = pan.map((p) => '<div class="mr-pr"><i>' + p[1] + "</i><b>" + p[2] + '</b><span id="mrP_' + p[0] + '">대기</span></div>').join("");
    try {
      const doc = await docText(); const shape = '{"scores":[{"c":"항목 이름","s":0~100 정수,"why":"근거(문서의 어느 대목 때문인지 한 문장)"}],"good":["강점"],"bad":[{"t":"약점","where":"문서 어디","fix":"고칠 방법"}],"questions":["심사장에서 던질 질문"]}';
      const reviews = await Promise.all(pan.map(async (p) => {
        mark(p[0], "읽는 중…");
        const r = await TK.aiJSON({ sys: "당신은 " + p[2] + "입니다. " + p[3] + " 공정하지만 후하지 않게 채점합니다(보통 수준 = 70). 문서에 없는 내용은 없는 것으로 칩니다. 한국어로.", user: "평가: " + RUBRICS.find((x) => x.id === S.rub).name + "\n항목(배점): " + crit.map((c) => c[0] + "(" + c[1] + ")").join(", ") + "\n\n[문서: " + doc.title + "]\n" + doc.text + "\n\n항목마다 100점 만점으로 채점하고, 강점 2개·약점 3개·질문 3개를 내세요.", shape: shape, tokens: 2200 });
        mark(p[0], "완료"); return { who: p[0], r: r };
      }));
      const avg = crit.map((c) => { const v = reviews.map((x) => { const f = (x.r.scores || []).find((s) => s.c === c[0]); return f ? +f.s || 0 : null; }).filter((n) => n != null); const a = v.length ? v.reduce((m, n) => m + n, 0) / v.length : 0; return { c: c[0], w: +c[1] || 0, avg: Math.round(a), min: v.length ? Math.min(...v) : 0, max: v.length ? Math.max(...v) : 0 }; });
      const W = avg.reduce((a, x) => a + x.w, 0) || 1; const total = Math.round(avg.reduce((a, x) => a + x.avg * x.w, 0) / W * 10) / 10;
      mark(pan[0][0], "완료"); box.insertAdjacentHTML("beforeend", '<div class="mr-pr"><i>🧾</i><b>위원장 종합</b><span id="mrP_chair">정리 중…</span></div>');
      const brief = reviews.map((x) => { const p = PANEL.find((q) => q[0] === x.who); return "[" + p[2] + "] 약점: " + (x.r.bad || []).map((b) => b.t + " (" + (b.where || "") + ")").join("; ") + " / 강점: " + (x.r.good || []).join("; "); }).join("\n");
      const ch = await TK.aiJSON({ sys: "당신은 심사위원장입니다. 위원 의견을 묶어 지원자가 바로 고칠 수 있게 우선순위를 냅니다. 한국어로.", user: "평균 점수: " + avg.map((a) => a.c + " " + a.avg).join(", ") + "\n\n" + brief, shape: '{"verdict":"한 문장 총평","fatal":["치명적 약점 최대 3"],"fixes":[{"title":"고칠 일","why":"왜","where":"문서 어디","gain":"예상 효과(어느 항목)","prompt":"AI 편집자에게 줄 구체적 지시 한 문장"}]}', tokens: 1600 });
      mark("chair", "완료");
      S.cur = { id: Date.now().toString(36), t: Date.now(), did: S.did, title: doc.title, v: doc.v, rub: RUBRICS.find((x) => x.id === S.rub).name, total: total, avg: avg, reviews: reviews, chair: ch, done: {} };
      const l = hist(); l.unshift(S.cur); PS(key(), { list: l.slice(0, 30) }); S.tab = "board"; tab(); const cnt = document.querySelector("#mr .ll-cnt"); if (cnt) cnt.textContent = "최근 " + total + "점 · " + fmtT(S.cur.t);
    } catch (e) { box.insertAdjacentHTML("beforeend", '<p class="lb-warn">' + esc(e.message) + "</p>"); }
    S.busy = false;
  }
  function radar(a) {
    const n = a.length, R = 112, cx = 170, cy = 145, pt = (i, v) => { const t = -Math.PI / 2 + i / n * 6.283; return [cx + Math.cos(t) * R * v / 100, cy + Math.sin(t) * R * v / 100]; };
    let g = '<svg viewBox="0 0 340 290" class="mr-radar">'; [25, 50, 75, 100].forEach((v) => { g += '<polygon points="' + a.map((_, i) => pt(i, v).join(",")).join(" ") + '" fill="none" stroke="var(--line)"/>'; });
    a.forEach((x, i) => { const p = pt(i, 100), q = pt(i, 122); g += '<line x1="' + cx + '" y1="' + cy + '" x2="' + p[0] + '" y2="' + p[1] + '" stroke="var(--line)"/><text x="' + q[0] + '" y="' + (q[1] + 4) + '" text-anchor="' + (q[0] < cx - 8 ? "end" : q[0] > cx + 8 ? "start" : "middle") + '" font-size="10.5" fill="var(--muted)">' + esc(x.c.slice(0, 9)) + "</text>"; });
    g += '<polygon points="' + a.map((x, i) => pt(i, x.avg).join(",")).join(" ") + '" fill="color-mix(in srgb, var(--accent) 22%, transparent)" stroke="var(--accent)" stroke-width="2"/>' + a.map((x, i) => { const p = pt(i, x.avg); return '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="3.5" fill="var(--accent)"/>'; }).join("");
    return g + "</svg>";
  }
  const empty = (t) => '<div class="ll-empty"><span>🎯</span><b>' + t + "</b><p>⚙ 심사 준비에서 문서와 위원단을 고르고 심사를 시작하세요.</p></div>";
  function pBoard(m) {
    const c = S.cur; if (!c) { m.innerHTML = empty("아직 심사 결과가 없어요"); return; }
    const grade = c.total >= 85 ? ["선정 유력", "ok"] : c.total >= 75 ? ["경합", "mid"] : c.total >= 65 ? ["보완 필요", "warn"] : ["탈락 위험", "bad"];
    m.innerHTML = '<div class="mr-top"><section class="mr-card mr-score"><div class="mr-num ' + grade[1] + '"><b>' + c.total + "</b><small>/ 100</small></div><em class=\"" + grade[1] + '">' + grade[0] + "</em><p>" + esc((c.chair || {}).verdict || "") + "</p><small class=\"sh-muted\">" + esc(c.title) + " v" + c.v + " · " + esc(c.rub) + " · " + fmtT(c.t) + '</small></section><section class="mr-card">' + radar(c.avg) + '</section><section class="mr-card"><h4>항목별 점수 <small>막대 = 위원 최저~최고, 점 = 평균 · 넓으면 의견이 갈림</small></h4>' + c.avg.map((a) => '<div class="mr-row"><span title="' + esc(a.c) + '">' + esc(a.c) + '</span><div class="mr-range"><i style="left:' + a.min + "%;width:" + Math.max(1, a.max - a.min) + '%"></i><u style="left:' + a.avg + '%"></u></div><b>' + a.avg + "</b>" + (a.max - a.min >= 20 ? '<em title="위원 의견이 크게 갈려요">갈림</em>' : "") + "</div>").join("") + "</section></div>";
    const fatal = (c.chair || {}).fatal || [];
    m.insertAdjacentHTML("beforeend", (fatal.length ? '<section class="mr-card mr-fatal"><h4>🚨 치명적 약점</h4><ul>' + fatal.map((f) => "<li>" + esc(f) + "</li>").join("") + "</ul></section>" : "") + '<div class="mr-rev">' + c.reviews.map((x) => { const p = PANEL.find((q) => q[0] === x.who) || ["", "🧑", x.who]; const t = (x.r.scores || []).reduce((a, s) => { const w = (c.avg.find((v) => v.c === s.c) || {}).w || 0; return a + (+s.s || 0) * w; }, 0) / (c.avg.reduce((a, v) => a + v.w, 0) || 1); return '<details class="mr-card"><summary><i>' + p[1] + "</i><b>" + esc(p[2]) + "</b><em>" + Math.round(t) + "점</em></summary>" + (x.r.scores || []).map((s) => '<div class="mr-sc"><b>' + (+s.s || 0) + "</b><span><u>" + esc(s.c) + "</u> " + esc(s.why || "") + "</span></div>").join("") + '<h5>강점</h5><ul>' + (x.r.good || []).map((g) => "<li>" + esc(g) + "</li>").join("") + "</ul><h5>약점</h5><ul>" + (x.r.bad || []).map((b) => "<li>" + esc(b.t) + (b.where ? " <small>(" + esc(b.where) + ")</small>" : "") + (b.fix ? "<br><small>→ " + esc(b.fix) + "</small>" : "") + "</li>").join("") + "</ul></details>"; }).join("") + "</div>");
  }
  function pFix(m) {
    const c = S.cur; if (!c) { m.innerHTML = empty("수정 목록이 아직 없어요"); return; } const fx = (c.chair || {}).fixes || [];
    m.innerHTML = '<div class="ll-lbar"><b>우선순위대로 고쳐요</b><span class="sh-muted">' + esc(c.title) + ' — 누르면 보고서 편집기가 열리고 AI 가 그 부분을 고쳐요(되돌리기 가능)</span></div><div class="mr-fix">' + fx.map((f, i) => '<article class="mr-card' + (c.done && c.done[i] ? " done" : "") + '"><i>' + (i + 1) + "</i><div><b>" + esc(f.title) + "</b><p>" + esc(f.why || "") + "</p><small>📍 " + esc(f.where || "") + (f.gain ? " · 📈 " + esc(f.gain) : "") + '</small></div><div class="mr-fa"><button type="button" class="primary small-btn" data-fx="' + i + '">✨ 보고서에서 고치기</button><button type="button" class="ghost-btn small-btn" data-fd="' + i + '">' + (c.done && c.done[i] ? "다시 열기" : "✓ 끝") + "</button></div></article>").join("") + '</div><div class="lb-row" style="margin-top:10px"><button type="button" class="ghost-btn small-btn" data-m="redo">↻ 고친 뒤 다시 심사</button></div>';
  }
  function pQa(m) {
    const c = S.cur; if (!c) { m.innerHTML = empty("예상 질문이 아직 없어요"); return; }
    const Q = S.qa && S.qa.id === c.id ? S.qa : (S.qa = { id: c.id, list: [].concat(...c.reviews.map((x) => (x.r.questions || []).map((q) => ({ q: q, who: x.who })))), i: 0, res: [], limit: 60 });
    if (Q.i >= Q.list.length) { const av = Q.res.length ? Math.round(Q.res.reduce((a, r) => a + (r.s || 0), 0) / Q.res.length) : 0; m.innerHTML = '<div class="mr-card mr-qaend"><b>리허설 끝 — 평균 ' + av + '점</b>' + Q.res.map((r) => '<details><summary>' + (r.s || 0) + "점 · " + esc(r.q) + "</summary><p><b>내 답</b> " + esc(r.a) + "</p><p><b>평가</b> " + esc(r.fb || "") + "</p><p><b>더 나은 답</b> " + esc(r.best || "") + "</p></details>").join("") + '<button type="button" class="ghost-btn small-btn" data-m="qareset">처음부터</button></div>'; return; }
    const cur = Q.list[Q.i], p = PANEL.find((x) => x[0] === cur.who) || ["", "🧑", "위원"];
    m.innerHTML = '<div class="mr-qa"><div class="mr-qh"><span>' + (Q.i + 1) + " / " + Q.list.length + '</span><label>답변 시간 <select id="mrLim"><option value="30">30초</option><option value="60">1분</option><option value="120">2분</option></select></label><b id="mrTm">—</b></div><div class="mr-qq"><i>' + p[1] + "</i><div><small>" + esc(p[2]) + "</small><b>" + esc(cur.q) + '</b></div></div><textarea id="mrAns" rows="6" placeholder="실제로 말하듯 답하세요. 🎙 로 말해도 돼요."></textarea><div class="lb-row"><button type="button" class="ghost-btn small-btn" data-m="say">🔊 질문 듣기</button><button type="button" class="ghost-btn small-btn" data-m="mic">🎙 말로 답하기</button><span style="flex:1"></span><button type="button" class="ghost-btn small-btn" data-m="skip">건너뛰기</button><button type="button" class="primary small-btn" data-m="grade">답변 제출</button></div><div id="mrFb"></div></div>';
    $("mrLim").value = String(Q.limit); clearInterval(S._tm); const t0 = Date.now(); const tick = () => { const el = $("mrTm"); if (!el) { clearInterval(S._tm); return; } const left = Q.limit - Math.floor((Date.now() - t0) / 1000); el.textContent = left >= 0 ? left + "초" : "시간 초과 +" + (-left) + "초"; el.classList.toggle("over", left < 0); }; tick(); S._tm = setInterval(tick, 500);
    $("mrLim").addEventListener("change", (e) => { Q.limit = +e.target.value; });
  }
  async function grade() {
    const Q = S.qa, cur = Q.list[Q.i], ans = ($("mrAns").value || "").trim(); if (!ans) return toast("답을 쓰거나 말해 주세요"); clearInterval(S._tm); const fb = $("mrFb"); fb.innerHTML = '<p class="sh-muted"><span class="lb-dots"><i></i><i></i><i></i></span> 채점 중…</p>';
    try {
      const d = await docText(); const r = await TK.aiJSON({ sys: "당신은 심사위원입니다. 답변을 채점하고 더 나은 답을 제시합니다. 문서에 있는 사실만 써서 모범 답을 만듭니다. 한국어로.", user: "[문서]\n" + d.text.slice(0, 16000) + "\n\n[질문] " + cur.q + "\n[답변] " + ans, shape: '{"s":0~100,"fb":"평가(잘한 점·빠진 점)","best":"30초 분량의 더 나은 답"}', tokens: 900 });
      Q.res.push({ q: cur.q, a: ans, s: +r.s || 0, fb: r.fb, best: r.best }); fb.innerHTML = '<div class="mr-card mr-fbk"><b>' + (+r.s || 0) + "점</b><p>" + esc(r.fb || "") + "</p><p><b>더 나은 답</b> " + esc(r.best || "") + '</p><button type="button" class="primary small-btn" data-m="next">다음 질문</button></div>';
    } catch (e) { fb.innerHTML = '<p class="lb-warn">' + esc(e.message) + "</p>"; }
  }
  function pHist(m) {
    const l = hist(); if (!l.length) { m.innerHTML = empty("아직 기록이 없어요"); return; } const s = l.slice().reverse();
    const W = 720, H = 200, x = (i) => 40 + i * (W - 70) / Math.max(1, s.length - 1), y = (v) => H - 26 - (v - 40) / 60 * (H - 50);
    m.innerHTML = '<section class="mr-card"><h4>회차별 총점</h4><svg viewBox="0 0 ' + W + " " + H + '" class="mr-trend">' + [50, 70, 90].map((v) => '<line x1="36" x2="' + (W - 20) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--line)"/><text x="30" y="' + (y(v) + 4) + '" text-anchor="end" font-size="11" fill="var(--muted)">' + v + "</text>").join("") + '<polyline fill="none" stroke="var(--accent)" stroke-width="2.5" points="' + s.map((r, i) => x(i) + "," + y(r.total)).join(" ") + '"/>' + s.map((r, i) => '<circle cx="' + x(i) + '" cy="' + y(r.total) + '" r="4.5" fill="var(--accent)"/><text x="' + x(i) + '" y="' + (y(r.total) - 10) + '" text-anchor="middle" font-size="11.5" font-weight="700" fill="var(--ink)">' + r.total + "</text>").join("") + '</svg></section><table class="rh-tbl" style="margin-top:12px"><thead><tr><th>문서</th><th>평가</th><th>총점</th><th>때</th><th></th></tr></thead><tbody>' + l.map((r, i) => '<tr><td class="t"><b>' + esc(r.title) + "</b> v" + r.v + "</td><td>" + esc(r.rub) + "</td><td>" + r.total + "</td><td>" + fmtT(r.t) + '</td><td><button type="button" class="ghost-btn small-btn" data-hs="' + i + '">보기</button></td></tr>').join("") + "</tbody></table>";
  }
  async function onClick(e) {
    const t = e.target; let b;
    if ((b = t.closest("[data-mt]"))) { S.tab = b.dataset.mt; tab(); return; }
    if ((b = t.closest("[data-rub]"))) { S.rub = b.dataset.rub; S.crit = null; PS("mr.rub", S.rub); tab(); return; }
    if ((b = t.closest("[data-pn]"))) { const k = b.dataset.pn, i = S.panel.indexOf(k); if (i >= 0) S.panel.splice(i, 1); else S.panel.push(k); PS("mr.panel", S.panel); tab(); return; }
    if ((b = t.closest("[data-cdel]"))) { const c = critOf(); c.splice(+b.dataset.cdel, 1); S.crit = c; tab(); return; }
    if ((b = t.closest("[data-hs]"))) { S.cur = hist()[+b.dataset.hs]; S.tab = "board"; tab(); return; }
    if ((b = t.closest("[data-fd]"))) { const c = S.cur; c.done = c.done || {}; c.done[b.dataset.fd] = !c.done[b.dataset.fd]; const l = hist(); const i = l.findIndex((x) => x.id === c.id); if (i >= 0) { l[i] = c; PS(key(), { list: l }); } tab(); return; }
    if ((b = t.closest("[data-fx]"))) { const f = S.cur.chair.fixes[+b.dataset.fx]; if (window.REPORT && REPORT.goFix) REPORT.goFix(S.pid, S.cur.did, "심사 지적을 반영해 고쳐 줘: " + f.title + (f.where ? " (" + f.where + ")" : "") + ". " + (f.prompt || f.why || "")); return; }
    if ((b = t.closest("[data-m]"))) {
      const k = b.dataset.m;
      if (k === "run") run();
      if (k === "cadd") { const c = critOf(); c.push(["새 항목", 10]); S.crit = c; tab(); }
      if (k === "redo") { S.tab = "setup"; tab(); }
      if (k === "grade") grade();
      if (k === "next" || k === "skip") { S.qa.i++; tab(); }
      if (k === "qareset") { S.qa = null; tab(); }
      if (k === "say") { try { TOOLSETS.X2.speak(S.qa.list[S.qa.i].q); } catch (er) { /* 계속 */ } }
      if (k === "mic") { const ta = $("mrAns"); const base = ta.value; if (S._rec) { S._rec.stop(); S._rec = null; b.textContent = "🎙 말로 답하기"; return; } const rec = TOOLSETS.X2.stt((f, i) => { ta.value = (base ? base + " " : "") + f + (i || ""); }); if (!rec) { toast("이 브라우저는 음성 입력을 못 써요"); return; } S._rec = rec; rec.start(); b.textContent = "⏹ 그만"; }
    }
  }
  function build() {
    const content = document.querySelector("main.content"); if (!content || typeof EXT_VIEWS === "undefined") return;
    let a = $("hub_rx_review"); if (!a) { a = document.createElement("section"); a.id = "hub_rx_review"; a.className = "hidden"; content.appendChild(a); }
    EXT_VIEWS.rx_review = { area: a, open: () => paint(a).catch((er) => { a.innerHTML = '<p class="lb-warn">' + esc(er.message) + "</p>"; }) };
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(build, 0)); else setTimeout(build, 30);
})();
