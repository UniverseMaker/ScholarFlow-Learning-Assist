(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => escapeHtml(String(s == null ? "" : s));
  const fmtT = (t) => { const d = new Date(t || 0); return d.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" }) + " " + d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }); };
  const fmtB = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : n > 1024 ? Math.round(n / 1024) + " KB" : n + " B";
  const KINDS = { proposal: "연구개발계획서", paper: "논문·학술", report: "보고서·결과물", policy: "정책·규정·공고", lecture: "강의·교육 자료", other: "기타" };
  const DOC_KINDS = { summary: "요약본", report: "검토 의견서", slides: "발표 자료", brief: "브리핑 노트", free: "자유 문서" };
  const OUTLINES = {
    summary: ["연구 개요", "연구 목표", "연구 내용과 범위", "추진 전략·방법", "일정·마일스톤", "예산 개요", "기대 효과·활용 방안"],
    report: ["총평", "강점", "약점·보완이 필요한 점", "평가 항목별 검토", "질의 사항", "종합 의견"],
    slides: ["연구 배경과 필요성", "연구 목표", "핵심 연구 내용", "추진 체계와 일정", "기대 효과", "한 장 요약"],
    brief: ["한 줄 요지", "핵심 포인트 5개", "숫자로 보는 과제(기간·예산·인력·목표치)", "쟁점·리스크", "다음 할 일"],
    free: [],
  };
  const QUICK = ["핵심 요약 5줄", "연구 목표와 필요성은?", "추진 전략과 체계를 정리해 줘", "연차별 일정·마일스톤", "예산 구성과 근거", "기대 효과와 활용 방안", "평가자 관점의 약점과 보완책", "심사위원 예상 질문 10개"];

  /* =====================================================================
   * 1. 저장소 클라이언트
   * =================================================================== */
  const WS = {
    online: null, info: null, lastPing: 0, pingTimer: null,
    user() { const n = $("userName"); return ((n && n.textContent) || "").trim() || "guest"; },
    owners: {},      // (v178) data-owner/1 — 공유받은 프로젝트 pid → 소유자 계정 id. 요청에 owner 를 붙여 서버가 권한을 확인한다
    url(op, params) { if (params && params.pid && this.owners[params.pid] && params.owner == null) params = Object.assign({}, params, { owner: this.owners[params.pid] }); let u = "api.php?r=ws&op=" + encodeURIComponent(op); Object.keys(params || {}).forEach((k) => { if (params[k] != null && params[k] !== "") u += "&" + k + "=" + encodeURIComponent(params[k]); }); return u; },
    async req(op, params, body, opts) {
      opts = opts || {};
      if (op === "project" && body && body.id && this.owners[body.id]) params = Object.assign({ pid: body.id }, params || {});   // (v178) 공유받은 프로젝트 저장은 소유자 자리로
      const init = { method: body === undefined ? "GET" : "POST", cache: "no-store", headers: {} };   // (v110) X-Study-User 제거 — 서버는 세션만 믿고, 한글 이름이면 fetch 가 헤더 오류로 실패했다
      if (body !== undefined) { init.headers["X-Study-Vault"] = "1"; if (opts.raw) init.body = body; else { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); } }
      let r;
      try { r = await fetch(this.url(op, params), init); } catch (e) { this.setOnline(false); throw new Error("저장소 서버에 연결할 수 없어요(serve.py 가 켜져 있나요?)"); }
      let d = null; try { d = await r.json(); } catch (e) { d = null; }
      if (r.status === 401 && d && d.error === "no_session" && window.SERVER && SERVER.expired) SERVER.expired();   // (v92) 서버 세션이 끝남 → 다시 로그인
      if (r.status === 404 && d && d.message === "없는 API") { this.setOnline(false); throw new Error("이 서버에는 연구 저장소가 없어요(serve.py 최신 버전으로 실행)"); }
      this.setOnline(true);
      if (!r.ok || !d || d.ok === false) throw new Error((d && d.message) || ("HTTP " + r.status));
      if (op === "projects" && Array.isArray(d.list)) { this.owners = {}; d.list.forEach((p) => { if (p && p.shared && p.owner) this.owners[p.id] = p.owner; }); }
      return d;
    },
    async ping() {
      if (window.SERVER && !SERVER.user) return this.online;   // (v93) 로그인 전에는 확인하지 않는다(401 소음)
      try { const r = await fetch("api.php?r=ws&op=health", { cache: "no-store" }); const d = r.ok ? await r.json() : null; this.info = d; this.setOnline(!!(d && d.ok)); }
      catch (e) { this.setOnline(false); }
      this.lastPing = Date.now();
      return this.online;
    },
    setOnline(v) { const was = this.online; this.online = v; if (v && was === false) flushOutbox(); paintStatus(); },
    // 서버가 안 보일 때 쓰기 요청을 쌓아 두는 곳(JSON 쓰기만 — 파일 업로드는 쌓지 않는다)
    obKey() { return "study.ws.outbox." + this.user(); },
    queue(op, params, body) { try { const l = JSON.parse(localStorage.getItem(this.obKey()) || "[]"); l.push({ op: op, params: params, body: body, t: Date.now() }); localStorage.setItem(this.obKey(), JSON.stringify(l.slice(-400))); } catch (e) { /* 계속 */ } paintStatus(); },
    pending() { try { return JSON.parse(localStorage.getItem(this.obKey()) || "[]").length; } catch (e) { return 0; } },
  };
  async function write(op, params, body) {
    try { return await WS.req(op, params, body); }
    catch (e) { if (WS.online === false && ["event", "doc", "project"].indexOf(op) >= 0) { WS.queue(op, params, body); return { ok: false, queued: true }; } throw e; }
  }
  let flushing = false;
  async function flushOutbox() {
    if (flushing) return; flushing = true;
    try {
      let l = []; try { l = JSON.parse(localStorage.getItem(WS.obKey()) || "[]"); } catch (e) { l = []; }
      while (l.length) { const it = l[0]; await WS.req(it.op, it.params, it.body); l.shift(); localStorage.setItem(WS.obKey(), JSON.stringify(l)); }
    } catch (e) { /* 다음 핑 때 다시 */ } finally { flushing = false; paintStatus(); }
  }
  function paintStatus() {
    document.querySelectorAll(".rn-status").forEach((el) => {
      const n = WS.pending();
      el.className = "rn-status " + (WS.online ? "on" : WS.online === false ? "off" : "");
      el.textContent = WS.online ? ("● 저장소 연결됨" + (n ? " · 대기 " + n : "")) : WS.online === false ? ("○ 저장소 꺼짐" + (n ? " · 로컬 대기 " + n : "")) : "… 저장소 확인 중";
    });
  }

  /* =====================================================================
   * 2. 상태 · 화면 틀
   * =================================================================== */
  const R = { pid: null, project: null, projects: [], files: [], docs: [], events: [], tab: "chat", msgs: [], ctx: null, idx: {}, srcFid: null, srcPage: 1, doc: null, did: null, dirty: false, busy: false, gen: null, preview: false, versions: [] };
  /* (v92) 이어서 하기 — 마지막 프로젝트·탭·문서·자료, 보내지 않은 질문, 저장 안 한 문서 수정(초안)을 내 계정 상태(study.user.<id>.rnd*)에 둔다.
   *   account.js 가 이 키들을 서버 계정에 올리므로 다른 브라우저에서 로그인해도 그 자리에서 이어진다. */
  const ukey = (s) => { try { const se = JSON.parse(localStorage.getItem("study.session") || "null"); return se && se.user_id ? "study.user." + se.user_id + "." + s : null; } catch (e) { return null; } };
  const lget = (s) => { const k = ukey(s); try { return k ? JSON.parse(localStorage.getItem(k) || "null") : null; } catch (e) { return null; } };
  const lset = (s, v) => { const k = ukey(s); if (!k) return; try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 계속 */ } };
  let lastPos = "", lastDraft = "", lastQ = "", resumeTo = null;
  function persistPos() { const v = { pid: R.pid, tab: R.tab, did: R.did, src: R.srcFid }; const s = JSON.stringify(v); if (s !== lastPos) { lastPos = s; lset("rnd", R.pid ? v : null); } }
  setInterval(() => {
    if (R.pid && R.doc && R.dirty && !R.did && docBlank(R.doc)) { if (lastDraft) dropDraft(); }
    else if (R.pid && R.doc && R.dirty) { const s = JSON.stringify([R.pid, R.did, R.doc]); if (s !== lastDraft) { lastDraft = s; lset("rnd_draft", { pid: R.pid, did: R.did, doc: R.doc, t: Date.now() }); } }
    const inp = document.getElementById("rnIn");
    if (inp && R.pid) { const v = inp.value; if (v !== lastQ) { lastQ = v; lset("rnd_q", v ? { pid: R.pid, q: v } : null); } }
  }, 2500);
  const note = (t) => { if (window.SERVER && SERVER.notice) SERVER.notice(t); };
  // (v112) 빈 새 문서 — 본문이 하나도 없고 절 제목도 양식 그대로면 문서가 아니다. 미저장으로 붙잡아 두지 않는다
  function docBlank(d) {
    if (!d) return true;
    const o = OUTLINES[d.kind] || [];
    return (d.sections || []).every((x) => !String(x.body || "").trim() && (!String(x.h || "").trim() || o.indexOf(x.h) >= 0));
  }
  const hasUnsaved = () => !!(R.dirty && R.doc && !(!R.did && docBlank(R.doc)));
  function dropDraft() { lset("rnd_draft", null); lastDraft = ""; }
  function dropBlank() { if (R.doc && !R.did && docBlank(R.doc)) { R.doc = null; R.dirty = false; R.versions = []; dropDraft(); return true; } return false; }
  // (v98) 작업실 화면 설정 — 이력 칸·자료 칸 접기, 자료 칸 폭(계정에 저장)
  const VP = () => Object.assign({ hist: true, side: true, sw: 300 }, (window.TK && TK.store.get("rnd.view", {})) || {});
  const vset = (k, v) => { if (!window.TK) return; const o = VP(); o[k] = v; TK.store.set("rnd.view", o); };
  const isHid = (rel) => !!(R.project && R.project.hidden && rel && window.RNDLINK && RNDLINK.isHidden(rel, R.project.hidden));
  function markHidden() { R.files.forEach((f) => { f.hidden = f.folder ? isHid(f.rel) : false; }); }
  let area = null, logArea = null;
  function build() {
    const content = document.querySelector("main.content"); if (!content || area) return;
    area = document.createElement("section"); area.id = "rndArea"; area.className = "hidden rn";
    logArea = document.createElement("section"); logArea.id = "rndLogArea"; logArea.className = "hidden rn";
    content.appendChild(area); content.appendChild(logArea);
    EXT_VIEWS.rnd = { area: area, open: () => {
      if (!R.pid && !R._resumed) { R._resumed = true; const p = lget("rnd"); if (p && p.pid) { resumeTo = p; R.pid = p.pid; } }   // 처음 들어올 때 마지막 자리로
      if (R.pid) openProject(R.pid); else home();
    } };
    EXT_VIEWS.rndlog = { area: logArea, open: renderLog };
    WS.ping(); WS.pingTimer = setInterval(() => { if (document.visibilityState === "visible") WS.ping(); }, 20000);
  }
  const loading = (t) => '<div class="lb-loading"><span class="lb-dots"><i></i><i></i><i></i></span>' + esc(t || "불러오는 중…") + "</div>";
  const warn = (t) => '<p class="lb-warn">' + esc(t) + "</p>";

  /* ---------------- 프로젝트 목록 ---------------- */
  async function home() {
    R.pid = null; R.project = null; persistPos();
    area.innerHTML = '<section class="lb-hero rn-hero"><div><div class="sh-kicker">연구지원</div><h2>자료를 올리고, AI 와 읽고, 문서로 만든다</h2><p>연구개발계획서·논문·보고서 PDF 를 올리면 쪽 단위로 색인해요. 대화로 묻고(근거 쪽 인용), 요약본·검토 의견서·발표 자료를 AI 와 함께 쓰고, DOCX·PPTX·HTML 로 내보내요. 대화·문서 버전·내보낸 파일은 모두 서버 폴더에 남아요.</p></div><span class="rn-status"></span></section>' +
      '<div class="rn-new"><input id="rnName" type="text" placeholder="새 프로젝트 이름 (예: 2027 AI 교육 플랫폼 과제 검토)"><select id="rnKind" class="set-select">' + Object.keys(KINDS).map((k) => '<option value="' + k + '">' + KINDS[k] + "</option>").join("") + '</select><input id="rnGoal" type="text" placeholder="목표 (예: 심사용 요약 2쪽 + 발표 10장)"><button type="button" class="primary big-btn" data-rn="new">＋ 만들기</button></div>' +
      '<div class="rn-link">' + (window.SERVER && SERVER.user && SERVER.user.role === "admin" ? '<button type="button" class="ghost-btn big-btn" data-rn="link-folder">📁 로컬 폴더 연결</button><button type="button" class="ghost-btn big-btn" data-rn="link-master">🗂 마스터 폴더 등록</button>' : "") + '<button type="button" class="ghost-btn big-btn" data-rn="link-epic">📋 FlowBoard 에픽에서 가져오기</button></div><div id="rnMasters"></div>' +
      '<div id="rnList">' + loading("프로젝트를 불러오는 중…") + "</div>";
    paintStatus();
    try { const d = await WS.req("projects"); R.projects = d.list || []; } catch (e) { $("rnList").innerHTML = warn(e.message) + '<p class="sh-muted">프로젝트 폴더에서 <code>python serve.py 18162</code> 로 서버를 켜 주세요. 클라우드플레어 터널로 열어 두면 어디서나 같은 저장소를 써요.</p>'; return; }
    let mnames = {}; try { (await WS.req("masters")).list.forEach((m) => { mnames[m.id] = m.name; }); } catch (e) { mnames = {}; }
    R.grpOf = (p) => p.group || (p.source && p.source.master && mnames[p.source.master] ? "🗂 " + mnames[p.source.master] : "") || "기본";
    try { R.trashN = ((await WS.req("ptrash")).list || []).length; } catch (e) { R.trashN = 0; }
    // (v112) 프로젝트가 있으면 목록이 먼저 — 소개·만들기 칸은 [＋ 새 프로젝트]로 연다
    const hasP = R.projects.length > 0, he = area.querySelector(".rn-hero"), nw = area.querySelector(".rn-new"), lk = area.querySelector(".rn-link");
    if (he) he.classList.toggle("hidden", hasP); if (nw) nw.classList.toggle("hidden", hasP);
    if (lk && hasP && !lk.querySelector('[data-rn="new-open"]')) lk.insertAdjacentHTML("afterbegin", '<button type="button" class="primary big-btn" data-rn="new-open">＋ 새 프로젝트</button>');
    paintProjects();
    try { RNDLINK.paintMasters($("rnMasters"), home); } catch (e) { /* 계속 */ }
  }
  /* (v112) 프로젝트 목록 — 목록형(기본)·카드형, 찾기·정렬, 줄마다 ⋯ 메뉴(숨기기·시스템에서 지우기). 지워도 PC 의 실제 폴더는 건드리지 않는다 */
  const PV = () => (window.TK && TK.store.get("rnd.homeView", "list")) || "list";
  const grpLabel = (g) => g === "기본" ? "📂 기본" : g.indexOf("🗂") === 0 ? g : "📁 " + g;
  function paintProjects() {
    const box = $("rnList"); if (!box) return;
    if (R.showTrash) { paintPTrash(); return; }
    const archN = R.projects.filter((p) => p.archived).length;
    const base = R.projects.filter((p) => !!p.archived === !!R.showArch);
    if (!R.projects.length && !R.trashN) { box.innerHTML = '<div class="sw-empty"><span>📂</span><b>아직 프로젝트가 없어요</b><p class="sh-muted">위에서 이름을 적고 만들기 → PDF 를 끌어다 놓으면 시작돼요. 폴더를 연결하거나 FlowBoard 에픽에서 가져와도 돼요.</p></div>'; return; }
    const names = []; base.forEach((p) => { const g = R.grpOf(p); if (g !== "기본" && g.indexOf("🗂") !== 0 && names.indexOf(g) < 0) names.push(g); });
    const v = PV();
    box.innerHTML = '<div class="rn-gbar rn-lbar"><input id="rnQ" type="search" placeholder="프로젝트 찾기" aria-label="프로젝트 찾기" value="' + esc(R.homeQ || "") + '"><select id="rnSort" class="set-select" aria-label="정렬">' + [["recent", "최근 수정순"], ["name", "이름순"], ["files", "자료 많은 순"], ["made", "만든 순"]].map((x) => '<option value="' + x[0] + '"' + ((R.homeSort || "recent") === x[0] ? " selected" : "") + ">" + x[1] + "</option>").join("") + '</select><span class="sh-muted" id="rnCnt"></span>' +
      '<span class="rn-gr">' + (R.showArch ? '<button type="button" class="sh-link" data-rn="hide-show">← 보이는 프로젝트로</button>' : archN ? '<button type="button" class="sh-link" data-rn="hide-show">숨긴 프로젝트 ' + archN + "개</button>" : "") + (R.trashN ? '<button type="button" class="sh-link" data-rn="trash-show">🗑 휴지통 ' + R.trashN + "개</button>" : "") + '<button type="button" class="ghost-btn small-btn" data-rn="grp-mode">☑ 여러 개 고르기</button><span class="rn-vsw" role="group" aria-label="보기 방식"><button type="button" data-rn-pv="list"' + (v === "list" ? ' class="on"' : "") + '>☰ 목록</button><button type="button" data-rn-pv="card"' + (v === "card" ? ' class="on"' : "") + ">▦ 카드</button></span></span></div>" +
      '<div id="rnPL"></div><div class="rn-gmove hidden" id="rnGMove"><span>고른 프로젝트를</span><input id="rnGName" type="text" list="rnGList" placeholder="폴더 이름(새로 쓰면 새 폴더)"><datalist id="rnGList">' + names.map((g) => '<option value="' + esc(g) + '">').join("") + '</datalist><button type="button" class="primary big-btn" data-rn="grp-move">폴더로 이동</button><button type="button" class="ghost-btn big-btn" data-rn="grp-base">기본으로</button><span class="rn-gsep"></span>' + (R.showArch ? '<button type="button" class="ghost-btn big-btn" data-rn="grp-unhide">👁 다시 보이기</button>' : '<button type="button" class="ghost-btn big-btn" data-rn="grp-hide">🙈 숨기기</button>') + '<button type="button" class="ghost-btn big-btn rn-danger" data-rn="grp-trash">🗑 시스템에서 지우기</button></div>';
    area.classList.remove("rn-gpick");
    $("rnQ").addEventListener("input", (e) => { R.homeQ = e.target.value; paintPL(); });
    $("rnSort").addEventListener("change", (e) => { R.homeSort = e.target.value; paintPL(); });
    paintPL();
  }
  /* (v138, G9) 상태가 있는 목록의 기본 순서: 진행 중 먼저 → 그 안에서 마감 가까운 순(마감 없으면 뒤, 최근 수정 순) → 끝난 것은 최근에 끝난 순 */
  const today = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const pDone = (p) => { const e = (p.period || {}).end || ""; return !!e && e < today(); };
  function pOrder(a, b) {
    const da = pDone(a), db = pDone(b); if (da !== db) return da ? 1 : -1;
    const ea = (a.period || {}).end || "", eb = (b.period || {}).end || "";
    if (da) return eb.localeCompare(ea) || (b.updated || 0) - (a.updated || 0);
    if (!!ea !== !!eb) return ea ? -1 : 1;
    return ea.localeCompare(eb) || (b.updated || 0) - (a.updated || 0);
  }
  function projectLV(box) {   // (v126) 표·카드·트리, 묶는 기준, 표시 옵션, 내려받기
    const link = (p) => [p.rnd ? "연구행정" : "", p.source ? "폴더" : "", p.epic ? "에픽" : "", (p.issues || []).length ? "이슈 " + p.issues.length : ""].filter(Boolean).join(" · ");
    SLCLV.mount(box, { key: "rnd.projects" + (R.showArch ? ".arch" : ""), name: "프로젝트", titleLabel: "프로젝트", placeholder: "프로젝트 찾기", empty: R.showArch ? "숨긴 프로젝트가 없어요." : "찾는 프로젝트가 없어요.",
      rows: R.projects.filter((p) => !!p.archived === !!R.showArch).sort(pOrder),
      title: (p) => p.name, sub: (p) => p.goal || "", search: (p) => p.name + " " + (p.goal || "") + " " + R.grpOf(p),
      columns: [{ k: "pst", label: "상태", get: (p) => (pDone(p) ? "끝남" : "진행 중") }, { k: "pend", label: "마감", get: (p) => ((p.period || {}).end || "") }, { k: "kind", label: "종류", get: (p) => KINDS[p.kind] || p.kind || "" }, { k: "group", label: "폴더", get: (p) => R.grpOf(p) }, { k: "link", label: "연결", get: link }, { k: "share", label: "공유", get: (p) => (p.shared ? "공유받음 · " + (p.ownerName || "") + " · " + (p.perm === "edit" ? "편집" : "보기") : p.sharedN ? "공유 " + p.sharedN + "명" : "") }, { k: "files", label: "자료", get: (p) => (p.counts && p.counts.files) || 0, cls: "n" }, { k: "docs", label: "문서", get: (p) => (p.counts && p.counts.docs) || 0, cls: "n" }, { k: "updated", label: "최근 수정", get: (p) => SLCLV.day(p.updated) }],
      groups: [{ k: "group", label: "폴더", path: (p) => [R.grpOf(p)] }, { k: "kind", label: "종류", path: (p) => [KINDS[p.kind] || p.kind || ""] }, { k: "link", label: "연결", path: (p) => [p.rnd ? (p.rnd.code || "연구행정") : p.source ? "PC 폴더" : "연결 없음"] }],
      action: (p) => '<button type="button" class="rn-pm" data-rn-pm="' + p.id + '" aria-label="' + esc(p.name) + ' 메뉴">⋯</button>',
      open: (p) => openProject(p.id, p) });
  }
  function paintPL() {
    const box = $("rnPL"); if (!box) return;
    if (window.SLCLV && SLCLV.on() && !area.classList.contains("rn-gpick")) return projectLV(box);
    const q = (R.homeQ || "").trim().toLowerCase(), sort = R.homeSort || "recent", v = PV();
    let l = R.projects.filter((p) => !!p.archived === !!R.showArch);
    const cnt = l.length;
    if (q) l = l.filter((p) => (p.name + " " + (p.goal || "") + " " + R.grpOf(p)).toLowerCase().indexOf(q) >= 0);
    const by = { recent: (a, b) => (b.updated || 0) - (a.updated || 0), made: (a, b) => (b.created || 0) - (a.created || 0), name: (a, b) => String(a.name).localeCompare(String(b.name), "ko"), files: (a, b) => ((b.counts && b.counts.files) || 0) - ((a.counts && a.counts.files) || 0) };
    l = l.slice().sort(by[sort] || by.recent);
    const groups = []; l.forEach((p) => { const g = R.grpOf(p); if (groups.indexOf(g) < 0) groups.push(g); });
    groups.sort((a, b) => a === "기본" ? 1 : b === "기본" ? -1 : a.localeCompare(b, "ko"));
    const closed = (window.TK && TK.store.get("rnd.groupsClosed", {})) || {};
    const c = $("rnCnt"); if (c) c.textContent = (R.showArch ? "숨긴 프로젝트 " : "프로젝트 ") + (q ? l.length + " / " : "") + cnt + "개 · 폴더 " + groups.length + "개";
    const link = (p) => (p.source ? '<span class="sh-chip" title="' + esc(p.source.path) + '">📁 폴더' + (p.source.master ? " · 마스터" : "") + "</span>" : "") + (p.epic ? '<span class="sh-chip c-vio">📋 ' + esc(p.epic.key || "에픽") + "</span>" : "");
    const pm = (p) => '<button type="button" class="rn-pm" data-rn-pm="' + p.id + '" title="더 보기" aria-label="' + esc(p.name) + ' 메뉴">⋯</button>';
    const sel = (p) => '<span class="rn-gsel" data-gsel="' + p.id + '" aria-hidden="true"></span>';
    const row = (p) => '<div class="rn-row" role="link" tabindex="0" data-rn-open="' + p.id + '"><span class="rn-rn">' + sel(p) + "<b>" + esc(p.name) + "</b>" + (p.goal ? "<small>" + esc(p.goal) + "</small>" : "") + "</span><span>" + esc(KINDS[p.kind] || p.kind) + '</span><span class="rn-rl">' + (link(p) || '<span class="sh-muted">-</span>') + '</span><span class="n">' + (p.counts ? p.counts.files : 0) + '</span><span class="n">' + (p.counts ? p.counts.docs : 0) + "</span><span>" + fmtT(p.updated) + "</span>" + pm(p) + "</div>";
    const card = (p) => '<div class="rn-card" role="link" tabindex="0" data-rn-open="' + p.id + '"><span class="sh-chip c-acc">' + esc(KINDS[p.kind] || p.kind) + "</span>" + link(p) + "<b>" + esc(p.name) + "</b>" + (p.goal ? "<p>" + esc(p.goal) + "</p>" : "") + "<small>자료 " + (p.counts ? p.counts.files : 0) + " · 문서 " + (p.counts ? p.counts.docs : 0) + " · " + fmtT(p.updated) + "</small>" + sel(p) + pm(p) + "</div>";
    if (!l.length) { box.innerHTML = '<p class="sh-muted rn-none">' + (q ? "찾는 프로젝트가 없어요." : R.showArch ? "숨긴 프로젝트가 없어요." : "보이는 프로젝트가 없어요.") + "</p>"; return; }
    box.innerHTML = (v === "list" ? '<div class="rn-lh"><span>이름</span><span>종류</span><span>연결</span><span class="n">자료</span><span class="n">문서</span><span>최근 수정</span><span></span></div>' : "") +
      groups.map((g) => { const ps = l.filter((p) => R.grpOf(p) === g); return '<details class="rn-grp"' + (closed[g] ? "" : " open") + ' data-grp="' + esc(g) + '"><summary><b>' + esc(grpLabel(g)) + "</b><small>" + ps.length + '개</small><button type="button" class="rn-pm rn-gm" data-rn-gm="' + esc(g) + '" title="이 폴더 메뉴" aria-label="' + esc(g) + ' 폴더 메뉴">⋯</button></summary>' + (v === "list" ? '<div class="rn-rows">' + ps.map(row).join("") + "</div>" : '<div class="rn-grid">' + ps.map(card).join("") + "</div>") + "</details>"; }).join("");
    box.querySelectorAll("details.rn-grp").forEach((d) => d.addEventListener("toggle", () => { if (!window.TK) return; const o = TK.store.get("rnd.groupsClosed", {}) || {}; if (d.open) delete o[d.dataset.grp]; else o[d.dataset.grp] = 1; TK.store.set("rnd.groupsClosed", o); }));
  }
  async function paintPTrash() {
    const box = $("rnList"); box.innerHTML = loading("휴지통을 불러오는 중…");
    let l = []; try { l = (await WS.req("ptrash")).list || []; } catch (e) { box.innerHTML = warn(e.message); return; }
    R.trashN = l.length;
    box.innerHTML = '<div class="rn-gbar rn-lbar"><button type="button" class="sh-link" data-rn="trash-show">← 프로젝트로</button><span class="sh-muted">휴지통 ' + l.length + "개</span></div>" + (l.length ? '<div class="rn-rows">' + l.map((p) => '<div class="rn-row rn-rowt"><span class="rn-rn"><b>' + esc(p.name) + "</b>" + (p.goal ? "<small>" + esc(p.goal) + "</small>" : "") + "</span><span>" + esc(KINDS[p.kind] || p.kind || "") + "</span><span>" + fmtT(p.trashed) + '</span><button type="button" class="ghost-btn small-btn" data-rn-prestore="' + esc(p.tid) + '">되살리기</button></div>').join("") + "</div>" : '<p class="sh-muted rn-none">휴지통이 비어 있어요.</p>');
  }
  function popMenu(items, x, y) {
    let el = $("rnMenu"); if (!el) { el = document.createElement("div"); el.id = "rnMenu"; el.className = "pp-menu"; document.body.appendChild(el); document.addEventListener("mousedown", (e) => { if (!e.target.closest("#rnMenu")) el.classList.remove("on"); }); }
    el.innerHTML = items.map((it, i) => (it === "-" ? "<hr>" : '<button type="button" data-mi="' + i + '"' + (it[2] ? ' class="danger"' : "") + ">" + it[0] + "</button>")).join("");
    el.classList.add("on"); el.style.left = Math.max(8, Math.min(window.innerWidth - el.offsetWidth - 8, x)) + "px"; el.style.top = Math.max(8, Math.min(window.innerHeight - el.offsetHeight - 8, y)) + "px";
    el.onclick = (e) => { const b = e.target.closest("[data-mi]"); if (!b) return; el.classList.remove("on"); items[+b.dataset.mi][1](); };
  }
  async function setHidden(ids, hide) { for (const id of ids) { const p = R.projects.filter((x) => x.id === id)[0]; if (p) await WS.req("project", {}, Object.assign({}, p, { id: id, archived: !!hide })); } }
  async function trashProjects(ids, label) {
    const linked = R.projects.filter((p) => ids.indexOf(p.id) >= 0 && p.source).length;
    if (!confirm(label + " 시스템에서 지울까요?\n\n· 이 프로그램의 목록에서만 사라져요." + (linked ? " 연결한 내 PC 폴더와 파일은 그대로 남아요." : "") + "\n· 대화·문서는 휴지통으로 옮겨서, 목록의 🗑 휴지통에서 되살릴 수 있어요.")) return false;
    for (const id of ids) await WS.req("trash", { pid: id }, {});
    note("프로젝트 " + ids.length + "개를 시스템에서 지웠어요 — 🗑 휴지통에서 되살릴 수 있어요."); return true;
  }
  // (v178) data-owner/1 — 소유자가 계정을 골라 보기·편집 권한으로 공유하고 언제든 거둔다. 공유·회수는 서버 감사 기록에 남는다
  async function openShare(p) {
    let ov = document.getElementById("rnShare"); if (ov) ov.remove();
    ov = document.createElement("div"); ov.id = "rnShare"; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true"); ov.setAttribute("aria-label", "프로젝트 공유");
    ov.style.cssText = "position:fixed;inset:0;z-index:9000;background:rgba(15,23,42,.38);display:flex;align-items:center;justify-content:center;padding:16px";
    document.body.appendChild(ov);
    const close = () => { ov.remove(); document.removeEventListener("keydown", onKey); home(); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    const paint = async (msg) => {
      let list = [], targets = [];
      try { list = (await WS.req("shares", { pid: p.id })).list || []; targets = (await WS.req("share_targets", {})).list || []; } catch (e) { msg = e.message; }
      const have = new Set(list.map((x) => x.uid)), left = targets.filter((t) => !have.has(t.id));
      const opt = (v, cur) => '<option value="' + v + '"' + (v === cur ? " selected" : "") + ">" + (v === "edit" ? "편집" : "보기") + "</option>";
      ov.innerHTML = '<div class="card" style="width:min(540px,100%);max-height:80vh;overflow:auto;margin:0"><h3 style="margin-top:0">프로젝트 공유 · ' + esc(p.name) + '</h3><p class="sh-muted">공유한 계정만 이 프로젝트를 봐요. 보기는 읽기만, 편집은 자료·문서·대화까지 고칠 수 있어요. 언제든 거둘 수 있어요.</p>' +
        (msg ? '<p class="lb-warn">' + esc(msg) + "</p>" : "") +
        (list.length ? '<table class="sv-tbl"><thead><tr><th>계정</th><th>권한</th><th></th></tr></thead><tbody>' + list.map((x) => "<tr><td>" + esc(x.name || x.uid) + '</td><td><select class="input" data-sh-perm="' + esc(x.uid) + '">' + opt("view", x.perm) + opt("edit", x.perm) + '</select></td><td><button type="button" class="ghost-btn small-btn" data-sh-off="' + esc(x.uid) + '">거두기</button></td></tr>').join("") + "</tbody></table>" : '<p class="sh-muted">아직 공유한 계정이 없어요.</p>') +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:12px">' + (left.length ? '<select class="input" id="rnShT" aria-label="공유할 계정">' + left.map((t) => '<option value="' + esc(t.id) + '">' + esc(t.name || t.username) + "</option>").join("") + '</select><select class="input" id="rnShP" aria-label="권한">' + opt("view", "view") + opt("edit", "") + '</select><button type="button" class="primary small-btn" data-sh-add="1">공유</button>' : '<span class="sh-muted">더 공유할 계정이 없어요.</span>') +
        '<span style="flex:1"></span><button type="button" class="ghost-btn small-btn" data-sh-close="1">닫기</button></div></div>';
    };
    const set = async (target, perm) => { try { await WS.req("share", { pid: p.id }, { target: target, perm: perm }); await paint(); } catch (e) { await paint(e.message); } };
    ov.addEventListener("click", async (e) => {
      const b = e.target.closest("button");
      if (e.target === ov || (b && b.dataset.shClose)) { close(); return; }
      if (!b) return;
      if (b.dataset.shAdd) { const t = $("rnShT"); if (t && t.value) await set(t.value, $("rnShP").value); }
      else if (b.dataset.shOff) { if (confirm("공유를 거둘까요? 그 계정은 이 프로젝트를 더 볼 수 없어요.")) await set(b.dataset.shOff, null); }
    });
    ov.addEventListener("change", async (e) => { const sl = e.target.closest("[data-sh-perm]"); if (sl) await set(sl.dataset.shPerm, sl.value); });
    await paint();
  }
  function pMenu(id, x, y) {
    const p = R.projects.filter((q) => q.id === id)[0]; if (!p) return;
    if (p.shared) {     // (v178) 공유받은 프로젝트 — 열기만, 관리(이름·폴더·숨김·지우기·공유)는 소유자만
      popMenu([["📂 열기", () => { R.pid = id; navTo("rnd"); }], "-", ["👤 소유자: " + (p.ownerName || p.owner) + " · " + (p.perm === "edit" ? "편집" : "보기") + " 권한", () => {}]], x, y);
      return;
    }
    const save = async (patch) => { try { await WS.req("project", {}, Object.assign({}, p, { id: id }, patch)); home(); } catch (er) { alert(er.message); } };
    popMenu([
      ["📂 열기", () => { R.pid = id; navTo("rnd"); }],
      ["✎ 이름·목표 고치기", () => { const n = prompt("프로젝트 이름", p.name); if (n == null) return; const g = prompt("목표", p.goal || ""); save({ name: n, goal: g == null ? p.goal : g }); }],
      ["📁 폴더로 옮기기…", () => { const n = prompt("옮길 폴더 이름(비우면 기본으로)", p.group || ""); if (n != null) save({ group: n.trim() }); }],
      ["👥 공유…" + (p.sharedN ? " (" + p.sharedN + "명)" : ""), () => openShare(p)],
      "-",
      p.archived ? ["👁 다시 보이기", () => save({ archived: false })] : ["🙈 숨기기", () => save({ archived: true })],
      ["🗑 시스템에서 지우기", async () => { try { if (await trashProjects([id], "'" + p.name + "' 을(를)")) home(); } catch (er) { alert(er.message); } }, true],
    ], x, y);
  }
  function gMenu(g, x, y) {
    const ps = R.projects.filter((p) => !!p.archived === !!R.showArch && R.grpOf(p) === g), ids = ps.map((p) => p.id), own = g !== "기본" && g.indexOf("🗂") !== 0;
    const items = [];
    if (own) { items.push(["✎ 폴더 이름 바꾸기", async () => { const n = prompt("폴더 이름", g); if (n == null || !n.trim() || n.trim() === g) return; for (const p of ps) await WS.req("project", {}, Object.assign({}, p, { id: p.id, group: n.trim() })); home(); }]); items.push(["📂 폴더만 풀기(프로젝트는 기본으로)", async () => { for (const p of ps) await WS.req("project", {}, Object.assign({}, p, { id: p.id, group: "" })); home(); }]); items.push("-"); }
    items.push(R.showArch ? ["👁 폴더 전체 다시 보이기", async () => { await setHidden(ids, false); home(); }] : ["🙈 폴더 전체 숨기기", async () => { await setHidden(ids, true); note("'" + g + "' 폴더를 숨겼어요 — 숨긴 프로젝트에서 되돌려요."); home(); }]);
    items.push(["🗑 폴더 전체 시스템에서 지우기", async () => { try { if (await trashProjects(ids, "'" + g + "' 폴더의 프로젝트 " + ids.length + "개를")) home(); } catch (er) { alert(er.message); } }, true]);
    popMenu(items, x, y);
  }
  async function createProject() {
    const name = ($("rnName").value || "").trim(); if (!name) { $("rnName").focus(); return; }
    try { const d = await WS.req("project", {}, { name: name, kind: $("rnKind").value, goal: ($("rnGoal").value || "").trim() }); openProject(d.project.id, d.project); }
    catch (e) { alert(e.message); }
  }

  /* ---------------- 작업실 ---------------- */
  async function openProject(pid, meta) {
    R.pid = pid; R.project = meta || R.projects.filter((p) => p.id === pid)[0] || R.project || { id: pid, name: "…" };
    R.files = []; R.docs = []; R.events = []; R.msgs = []; R.ctx = null; R.srcFid = null; R.doc = null; R.did = null; R.dirty = false; R.versions = [];
    area.innerHTML = '<div class="rn-top"><button type="button" class="ghost-btn small-btn" data-rn="home">← 프로젝트</button><div class="rn-title"><b id="rnPName">' + esc(R.project.name) + '</b><span class="sh-muted" id="rnPGoal">' + esc(R.project.goal || "") + '</span></div><span class="rn-status"></span><button type="button" class="icon-mini" data-rn="edit" title="이름·목표 고치기">✎</button>' +
      '<span class="rn-vt"><button type="button" class="ghost-btn small-btn' + (VP().side ? "" : " on") + '" data-rn="vside" title="왼쪽 자료 칸 접기/펴기">◧ 자료 칸</button><button type="button" class="ghost-btn small-btn' + (VP().hist ? " on" : "") + '" data-rn="vhist" title="오른쪽 이력 칸 접기/펴기">🕘 이력</button><button type="button" class="ghost-btn small-btn' + (document.body.classList.contains("rn-big") ? " on" : "") + '" data-rn="vbig" title="크게 보기 — 앱 메뉴·위쪽 막대를 접고 작업실만 (Esc 로 돌아오기)">⤢ 크게</button><button type="button" class="ghost-btn small-btn" data-rn="vfull" title="전체 화면">⛶</button></span></div>' +
      '<div class="rn-ws' + (VP().hist ? "" : " hist-off") + (VP().side ? "" : " side-off") + '" style="--rn-sw:' + (VP().sw || 300) + 'px"><aside class="rn-side" id="rnSide"></aside><div class="rn-sgrip" data-rn-grip="1" title="끌어서 자료 칸 폭 조절" aria-hidden="true"></div><div class="rn-main"><div class="rn-tabbar"><div class="rn-tabs" role="tablist">' + [["chat", "💬 대화"], ["src", "📖 자료 보기"], ["doc", "📝 문서"], ["tools", "🧰 도구"]].map((t) => '<button type="button" class="' + (t[0] === R.tab ? "on" : "") + '" data-rn-tab="' + t[0] + '">' + t[1] + "</button>").join("") + '</div><div class="rn-pins" id="rnPins"></div></div><div class="rn-pane" id="rnPane">' + loading() + '</div></div><aside class="rn-hist" id="rnHist"></aside></div>';
    paintStatus();
    try {
      if (!R.project.created) { try { const pl = await WS.req("projects"); R.projects = pl.list || []; R.project = R.projects.filter((p) => p.id === pid)[0] || R.project; $("rnPName").textContent = R.project.name; } catch (er) { /* 계속 */ } }   // (v93) 목록에 아직 없던 프로젝트(마스터·에픽으로 막 생긴 것)
      const [f, d, e] = await Promise.all([WS.req("files", { pid: pid }), WS.req("docs", { pid: pid }), WS.req("events", { pid: pid, limit: 400 })]);
      R.files = f.list || []; R.docs = d.list || []; R.events = e.list || [];
      if (R.project && R.project.source) {   // (v93) 연결 폴더 — 파일 구조 그대로(문서는 처음 근거로 쓸 때 텍스트 추출·캐시)
        try { const tr = await WS.req("tree", { pid: pid }); R.root = tr.root; R.files = R.files.concat((tr.list || []).map((x) => ({ id: x.id, name: x.rel, rel: x.rel, ext: x.ext, size: x.size, chars: x.doc ? (x.chars == null ? -1 : x.chars) : 0, pages: x.pages, doc: x.doc, folder: true, mtime: x.mtime }))); if (tr.truncated) R.treeTrunc = true; } catch (er) { /* 계속 */ }
        const rm = R.project.removed || []; if (rm.length && window.RNDLINK) R.files = R.files.filter((x) => !x.folder || !RNDLINK.isHidden(x.rel, rm));   // (v112) 시스템에서 지운 폴더·파일(실제 파일은 그대로)
        R.ctx = R.files.filter((x) => !x.folder).map((x) => x.id);   // 폴더 문서는 트리에서 골라 근거로
        markHidden();
      }
      R.msgs = R.events.filter((x) => x.kind === "chat").map((x) => ({ role: x.role, text: x.text, t: x.t, cites: x.cites, via: x.via, where: x.where }));
      if (!R.project.goal && meta === undefined) { try { const pl = await WS.req("projects"); R.projects = pl.list || []; R.project = R.projects.filter((p) => p.id === pid)[0] || R.project; $("rnPName").textContent = R.project.name; $("rnPGoal").textContent = R.project.goal || ""; } catch (er) { /* 계속 */ } }
    } catch (e) { const pn = $("rnPane"); if (pn) pn.innerHTML = warn(e.message); if (resumeTo) { resumeTo = null; lset("rnd", null); } return; }
    paintSide(); paintHist(); paintPane(); paintPins();
    const rs = resumeTo && resumeTo.pid === pid ? resumeTo : null; resumeTo = null;
    const dr = lget("rnd_draft");
    if (dr && dr.pid === pid && docBlank(dr.doc)) dropDraft();   // (v112) 비어 있으면 이어서 열 것이 없다
    else if (dr && dr.pid === pid && dr.doc) {           // 저장 안 한 수정이 있으면 그대로 다시 연다
      R.doc = dr.doc; R.did = dr.did || null; R.dirty = true; R.tab = "doc";
      if (R.did) { try { R.versions = (await WS.req("versions", { pid: pid, did: R.did })).list || []; } catch (e) { /* 계속 */ } }
      paintSide(); paintPane();
      note("저장하지 않은 문서 수정(" + fmtT(dr.t) + ")을 이어서 열었어요 — 💾 저장해야 새 버전으로 남아요.");
    } else if (rs) {
      if (rs.tab === "doc" && rs.did && R.docs.some((d) => d.id === rs.did)) await loadDoc(rs.did);
      else { R.tab = rs.tab || "chat"; if (rs.src && R.files.some((f) => f.id === rs.src)) { R.srcFid = rs.src; if (rs.page) R.srcPage = rs.page; } paintPane(); }
    }
    const qd = lget("rnd_q"); const inp = $("rnIn");
    if (qd && qd.pid === pid && inp && !inp.value) { inp.value = qd.q; lastQ = qd.q; }
  }
  function paintSide() {
    const s = $("rnSide"); if (!s) return;
    const sel = R.ctx;   // null = 전부
    const fN = R.files.filter((f) => !f.folder).length, fdN = R.files.filter((f) => f.folder && !f.hidden).length, cN = ctxFids().length;
    s.innerHTML = '<div class="rn-sum"><span><b>' + (fN + fdN) + "</b>자료</span><span><b>" + cN + "</b>근거</span><span><b>" + R.docs.length + "</b>문서</span><span><b>" + R.msgs.filter((m) => m.role === "user").length + '</b>질문</span><button type="button" class="icon-mini" data-rn="vside" title="자료 칸 접기">◀</button></div>' +
      '<div class="rn-sec"><div class="rn-sec-h"><b>📎 자료</b><label class="rn-up"><input type="file" id="rnUp" multiple>＋ 올리기</label></div>' +
      '<div class="rn-drop" id="rnDrop">' + (R.files.filter((f) => !f.folder).length ? R.files.filter((f) => !f.folder).map((f) => '<div class="rn-file' + (sel && sel.indexOf(f.id) < 0 ? " off" : "") + '" data-rn-file="' + f.id + '"><label title="대화 근거에 넣기/빼기"><input type="checkbox" data-rn-ctx="' + f.id + '"' + (!sel || sel.indexOf(f.id) >= 0 ? " checked" : "") + '></label><button type="button" class="rn-file-b" data-rn-src="' + f.id + '"><b>' + esc(f.name) + "</b><small>" + (f.pages ? f.pages + "쪽 · " : "") + (f.chars ? Math.round(f.chars / 1000) + "k자" : '<i class="rn-bad">텍스트 없음' + (f.extract === "pymupdf-empty" ? "(스캔본)" : "") + "</i>") + " · " + fmtB(f.size) + '</small></button><button type="button" class="icon-mini" data-rn-rmfile="' + f.id + '" title="빼기(휴지통으로)">✕</button></div>').join("") : '<p class="sh-muted rn-drop-hint">PDF·한글·워드·PPT·엑셀·그림·소리·영상 등 무엇이든 끌어다 놓거나 ＋ 올리기</p>') + '</div><div id="rnUpMsg"></div></div>' +
      '<div class="rn-sec"><div class="rn-sec-h"><b>📝 문서</b><button type="button" class="ghost-btn small-btn" data-rn="newdoc">＋ 새 문서</button></div>' +
      (R.docs.length ? R.docs.map((d) => '<div class="rn-docw"><button type="button" class="rn-doc' + (d.id === R.did ? " on" : "") + '" data-rn-doc="' + d.id + '"><b>' + esc(d.title) + "</b><small>" + esc(DOC_KINDS[d.kind] || d.kind) + " · v" + d.v + " · " + fmtT(d.saved) + '</small></button><button type="button" class="rn-docx" data-rn-docrm="' + d.id + '" title="문서 지우기(휴지통)" aria-label="문서 지우기">🗑</button></div>').join("") : '<p class="sh-muted">아직 문서가 없어요. 대화 답변을 "문서에 넣기" 하거나 새 문서 → AI 초안으로 시작해요.</p>') + "</div>";
    bindDrop();
    if (R.project && R.project.source) {
      const t = document.createElement("div"); s.appendChild(t);
      RNDLINK.treePanel(t, R.files, (id) => !R.ctx || R.ctx.indexOf(id) >= 0, R.root || R.project.source.path, {
        hidden: R.project.hidden || [], showHidden: !!R.showHidden,
        onHide: async (rel, hide) => {   // (v98) 숨기기 — 프로젝트 정보(hidden)에 상대 경로만, 실제 파일은 그대로
          const h = (R.project.hidden || []).filter((x) => x !== rel && x.indexOf(rel + "/") !== 0); if (hide) h.push(rel);
          try { const d = await WS.req("project", {}, Object.assign({}, R.project, { id: R.pid, hidden: h })); R.project = d.project; } catch (er) { alert(er.message); return; }
          if (!R.project.hidden) R.project.hidden = [];
          markHidden(); if (hide && R.ctx) R.ctx = R.ctx.filter((id) => !(R.files.filter((f) => f.id === id)[0] || {}).hidden);
          paintSide(); if (R.tab === "src") paintPane();
        },
        onToggleShow: () => { R.showHidden = !R.showHidden; paintSide(); },
        removedN: (R.project.removed || []).length,
        onRemove: async (rel) => {   // (v112) 시스템에서만 지운다 — project.json 에 상대 경로를 적을 뿐, 연결한 폴더에는 손대지 않는다
          if (!confirm("'" + rel.split("/").pop() + "' 을(를) 이 프로젝트에서 지울까요?\n\n이 프로그램에서만 사라지고, PC 의 실제 폴더·파일은 그대로 남아요.")) return;
          const rm = (R.project.removed || []).filter((x) => x !== rel && x.indexOf(rel + "/") !== 0); rm.push(rel);
          try { const d = await WS.req("project", {}, Object.assign({}, R.project, { id: R.pid, removed: rm })); R.project = d.project; } catch (er) { alert(er.message); return; }
          const out = R.files.filter((f) => f.folder && RNDLINK.isHidden(f.rel, [rel])).map((f) => f.id);
          R.files = R.files.filter((f) => out.indexOf(f.id) < 0); if (R.ctx) R.ctx = R.ctx.filter((id) => out.indexOf(id) < 0); if (out.indexOf(R.srcFid) >= 0) R.srcFid = null;
          paintSide(); if (R.tab === "src") paintPane();
        },
        onRestoreAll: async () => {
          const n = (R.project.removed || []).length; if (!confirm("지운 항목 " + n + "개를 다시 넣을까요?")) return;
          try { const d = await WS.req("project", {}, Object.assign({}, R.project, { id: R.pid, removed: [] })); R.project = d.project; } catch (er) { alert(er.message); return; }
          openProject(R.pid, R.project);
        },
      });
    }
    const ep = document.createElement("div"); s.appendChild(ep); RNDLINK.epicPanel(ep, R.project);
    const iss = document.createElement("div"); s.appendChild(iss); RNDLINK.issuePanel(iss, R.project);
  }
  function paintHist() {
    const h = $("rnHist"); if (!h) return;
    const ev = R.events.slice(-30).reverse();
    const ICON = { chat: "💬", doc: "📝", export: "📤", file: "📎", project: "📂" };
    h.innerHTML = '<div class="rn-sec-h"><b>이 프로젝트 이력</b><span><button type="button" class="sh-link" data-rn="log">전체 →</button><button type="button" class="icon-mini" data-rn="vhist" title="이력 칸 접기">▶</button></span></div>' + (ev.length ? '<ol class="rn-tl">' + ev.map((e) => '<li><span>' + (ICON[e.kind] || "•") + "</span><div><b>" + esc(evLine(e)) + "</b><small>" + fmtT(e.t) + "</small></div></li>").join("") + "</ol>" : '<p class="sh-muted">아직 기록이 없어요.</p>');
  }
  function evLine(e) {
    if (e.kind === "chat") return (e.role === "user" ? "질문: " : "답변: ") + String(e.text || "").slice(0, 60);
    if (e.kind === "doc") return "문서 저장 v" + e.v + " · " + e.title + (e.note ? " (" + e.note + ")" : "");
    if (e.kind === "issue") return "이슈 · " + (e.title || e.key || "") + (e.note ? " (" + e.note + ")" : "");
    if (e.kind === "export") return String(e.fmt || "").toUpperCase() + " 내보내기 · " + e.name;
    if (e.kind === "file") return (e.action === "upload" ? "자료 올림 · " : "자료 뺌 · ") + (e.name || e.fid) + (e.pages ? " (" + e.pages + "쪽)" : "");
    if (e.kind === "project") {   // (v98) 폴더 연결·마스터로 생긴 이벤트는 name 이 없다 → 경로 끝 이름
      const act = { create: "만듦", update: "수정", folder_link: "폴더 연결", master: "마스터 폴더에서 만듦", trash: "휴지통으로" }[e.action] || "수정";
      const nm = e.name || (e.path ? String(e.path).split(/[\\/]/).filter(Boolean).pop() : "");
      return "프로젝트 " + act + (nm ? " · " + nm : "");
    }
    if (e.kind === "ai") return "AI 작업 · " + (e.what || "");
    return e.kind;
  }
  const PIN_DEF = ["panel", "reqmap", "citecheck", "search"];
  function paintPins() {   // (v98) 자주 쓰는 연구 도구를 탭 옆에 바로 — [🧰 도구]에서 ☆ 로 고정
    const el = $("rnPins"); if (!el || !window.TK || !window.TOOLSETS) return;
    const ids = TK.store.get("pins.rnd", PIN_DEF), tools = TOOLSETS.RND_TOOLS;
    el.innerHTML = ids.map((id) => tools.filter((t) => t.id === id)[0]).filter(Boolean).slice(0, 6).map((t) => '<button type="button" class="rn-pin" data-rn-tool="' + t.id + '" title="' + esc(t.desc) + '">' + t.ico + " " + esc(t.name) + "</button>").join("") + '<button type="button" class="rn-pin more" data-rn-tab="tools" title="도구 모두 보기 · ☆ 로 여기에 고정">＋</button>';
  }
  function paintPane() {
    if (R._bg) return;   // (v102) 메뉴 페이지(hubs.js)가 뒤에서 프로젝트만 불러올 때는 작업실을 그리지 않는다
    persistPos();
    const ws = document.querySelector("#rndArea .rn-ws"); if (ws) ws.classList.toggle("fit", R.tab === "src");   // (v98) 자료 보기는 화면 높이에 딱 맞춘다(페이지 스크롤 없음)
    document.querySelectorAll("[data-rn-tab]").forEach((b) => b.classList.toggle("on", b.dataset.rnTab === R.tab));
    if (R.tab === "chat") paintChat(); else if (R.tab === "doc") paintDoc(); else if (R.tab === "tools") { $("rnPane").innerHTML = '<div id="rnTools"></div>'; try { RNDTOOLS.paint($("rnTools")); } catch (e) { $("rnPane").innerHTML = warn(e.message); } } else paintSrc();
  }

  /* ---------------- 업로드 ---------------- */
  function bindDrop() {
    const dz = $("rnDrop"), up = $("rnUp"); if (!dz) return;
    ["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("over"); }));
    ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("over"); }));
    dz.addEventListener("drop", (e) => uploadFiles(e.dataTransfer.files));
    if (up) up.addEventListener("change", () => { uploadFiles(up.files); up.value = ""; });
  }
  async function uploadFiles(list) {
    const files = Array.from(list || []); if (!files.length || !R.pid) return;
    const msg = $("rnUpMsg");
    for (const f of files) {
      if (f.size > 80 * 1024 * 1024) { msg.innerHTML = warn(f.name + ": 80MB 까지만"); continue; }
      msg.innerHTML = loading(f.name + " 올리고 텍스트를 뽑는 중…");
      try {
        const d = await WS.req("upload", { pid: R.pid, name: f.name }, f, { raw: true });
        R.files.push(d.file); delete R.idx[d.file.id];
        msg.innerHTML = d.file.chars ? '<p class="sh-muted">✓ ' + esc(f.name) + " — " + d.file.pages + "쪽 · " + Math.round(d.file.chars / 1000) + "k자 색인 준비</p>" : warn(f.name + ": 텍스트를 뽑지 못했어요" + (d.file.extract === "pymupdf-empty" ? " — 스캔본이라 텍스트 레이어가 없어요(OCR 필요)" : " (" + d.file.extract + ")"));
        R.events.push({ kind: "file", action: "upload", name: f.name, pages: d.file.pages, t: Date.now() });
      } catch (e) { msg.innerHTML = warn(f.name + ": " + e.message); }
    }
    paintSide(); paintHist();
    if (R.tab === "chat") paintChat();
    // (v123) 올린 뒤 정리를 권한다. 자동으로 돌리지 않는다(규격 12.8 — 비용이 사용자 모르게 늘지 않게)
    if (window.AITASK && R.files.length && msg && msg.isConnected) { msg.insertAdjacentHTML("beforeend", '<p class="rn-aitask"><button type="button" class="ghost-btn small-btn" data-rn="intake">AI 로 자료 정리</button></p>'); }
  }

  /* =====================================================================
   * 3. 색인 · 검색(BM25) · 근거 블록
   * =================================================================== */
  async function ensureIndex(fid) {
    if (R.idx[fid]) return R.idx[fid];
    const f = R.files.filter((x) => x.id === fid)[0]; if (!f || f.chars === 0) { R.idx[fid] = []; return []; }
    let text = ""; try { text = (await WS.req("text", { pid: R.pid, fid: fid })).text || ""; } catch (e) { text = ""; }
    if (f.folder) f.chars = text.length;
    const chunks = [];
    const pages = text.split(/\n\n\[p\.(\d+)\]\n/);  // ["", "1", 본문, "2", 본문…]
    let p = 1;
    for (let i = 1; i < pages.length; i += 2) {
      p = +pages[i] || p;
      const body = (pages[i + 1] || "").replace(/[ \t]+/g, " ").trim(); if (!body) continue;
      const paras = body.split(/\n{2,}|\n(?=\s*(?:[가-힣]?\d+[.)]|[-•▪○●□■◦◆※]|제\s*\d+\s*[조장절]))/);
      let cur = "";
      paras.forEach((pa) => { pa = pa.trim(); if (!pa) return; if ((cur + "\n" + pa).length > 750 && cur) { chunks.push({ fid: fid, name: f.name, p: p, text: cur }); cur = pa; } else cur = cur ? cur + "\n" + pa : pa; });
      if (cur) chunks.push({ fid: fid, name: f.name, p: p, text: cur });
    }
    if (!pages.length || pages.length === 1) {   // 쪽 표시가 없는 텍스트
      for (let i = 0; i < text.length; i += 700) chunks.push({ fid: fid, name: f.name, p: 0, text: text.slice(i, i + 800) });
    }
    chunks.forEach((c) => { c.tf = {}; const tk = textTokens(c.text); tk.forEach((t) => { c.tf[t] = (c.tf[t] || 0) + 1; }); c.len = tk.length || 1; });
    R.idx[fid] = chunks; return chunks;
  }
  const RS = () => Object.assign({ k: 8, max: 8000 }, (window.TK && TK.store.get("rnd.settings", {})) || {});   // (v93) [연구지원 설정]
  function ctxFids() { return (R.ctx || R.files.map((f) => f.id)).filter((id) => R.files.some((f) => f.id === id && f.chars !== 0)); }
  async function retrieve(query, k, maxChars, only) {
    const fids = only || ctxFids(); if (!fids.length) return [];
    let docs = []; for (const id of fids) docs = docs.concat(await ensureIndex(id));
    if (!docs.length) return [];
    const q = {}; textTokens(query).forEach((t) => { q[t] = 1; }); const terms = Object.keys(q);
    const df = {}; docs.forEach((d) => { Object.keys(d.tf).forEach((t) => { if (q[t]) df[t] = (df[t] || 0) + 1; }); });
    const N = docs.length, avg = docs.reduce((a, d) => a + d.len, 0) / N;
    const scored = docs.map((d) => { let s = 0; const norm = 1.2 * (0.25 + 0.75 * d.len / avg); terms.forEach((t) => { const f = d.tf[t]; if (!f || !df[t]) return; s += Math.log(1 + (N - df[t] + 0.5) / (df[t] + 0.5)) * (f * 2.2) / (f + norm); }); return [s, d]; }).filter((x) => x[0] > 0).sort((a, b) => b[0] - a[0]);
    const out = []; let used = 0;
    for (const [, d] of scored) { if (out.length >= (k || 8) || used + d.text.length > (maxChars || 8000)) break; out.push(d); used += d.text.length; }
    out.sort((a, b) => a.fid === b.fid ? a.p - b.p : a.fid < b.fid ? -1 : 1);
    return out;
  }
  async function headChunks(maxChars) {
    const fids = ctxFids(); const out = []; let used = 0;
    for (const id of fids) { for (const c of await ensureIndex(id)) { if (used + c.text.length > (maxChars || 6000)) return out; out.push(c); used += c.text.length; } }
    return out;
  }
  function groundBlock(chunks, label) {
    if (!chunks.length) return "";
    return "\n\n[" + (label || "자료 발췌") + " — 아래 발췌만 근거로 삼고, 인용할 때 (파일명 p.쪽) 으로 출처를 밝히세요. 발췌에 없는 내용은 '자료에 없음'이라고 구분하세요.]\n" +
      chunks.map((c, i) => "(" + (i + 1) + ") " + c.name + (c.p ? " p." + c.p : "") + "\n" + c.text).join("\n\n");
  }
  function sysPrompt() {
    return "당신은 연구개발계획서·논문·보고서를 함께 읽고 분석하는 연구 보조원입니다. 사용자는 한국의 연구자·평가자입니다. 한국어로, 정확하고 구조적으로(필요하면 번호·표) 답하되 과장하지 않습니다. 자료 발췌가 주어지면 그 내용을 우선 근거로 쓰고 (파일명 p.쪽) 으로 인용합니다. 프로젝트: " + (R.project.name || "") + (R.project.goal ? " / 목표: " + R.project.goal : "");
  }

  /* =====================================================================
   * 4. 대화
   * =================================================================== */
  function paintChat() {
    const pane = $("rnPane"); if (!pane) return;
    const n = ctxFids().length;
    pane.innerHTML = '<div class="rn-chat"><div class="rn-chat-log" id="rnLog">' + (R.msgs.length ? R.msgs.map(bubbleHtml).join("") : '<div class="rn-empty"><b>' + (R.files.length ? "자료에 대해 물어보세요" : "먼저 자료를 올려 주세요") + '</b><p class="sh-muted">' + (R.files.length ? "답변은 올린 자료의 관련 쪽을 찾아 근거로 삼고 (파일 p.N) 으로 인용해요. 마음에 드는 답변은 [문서에 넣기] 로 문서가 돼요." : "📎 자료 칸에 PDF 를 끌어다 놓으면 쪽 단위로 색인돼요.") + "</p></div>") + "</div>" +
      '<div class="rn-quick">' + QUICK.map((q) => '<button type="button" class="lb-pick" data-rn-q="' + esc(q) + '">' + esc(q) + "</button>").join("") + "</div>" +
      '<div class="rn-input"><span class="sh-muted rn-ctxn">근거 자료 ' + n + '개</span><textarea id="rnIn" rows="2" placeholder="자료에 대해 물어보세요 (Enter 보내기 · Shift+Enter 줄바꿈)"></textarea><button type="button" class="primary" data-rn="send" id="rnSend">보내기</button></div></div>';
    const log = $("rnLog"); log.scrollTop = log.scrollHeight;
    const ta = $("rnIn"); ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
  }
  function bubbleHtml(m, i) {
    if (m.role === "user") return '<div class="rn-msg user"><div class="bubble user">' + esc(m.text) + "</div></div>";
    return '<div class="rn-msg bot"><div class="bubble bot">' + chatMarkup(m.text || "…") + "</div>" + (m.text ? '<div class="rn-msg-a"><button type="button" class="ghost-btn small-btn" data-rn-todoc="' + i + '">📝 문서에 넣기</button><button type="button" class="ghost-btn small-btn" data-rn-copy="' + i + '">복사</button></div>' : "") + "</div>";
  }
  async function send(text) {
    const ta = $("rnIn"); text = (text || (ta && ta.value) || "").trim(); if (!text || R.busy) return;
    if (ta) ta.value = "";
    const g = await gateAction({ action: "rnd", cost: 1 }); if (!g.ok) { $("rnLog").insertAdjacentHTML("beforeend", warn(gateMessage(g))); return; }
    R.busy = true; $("rnSend").disabled = true;
    const um = { role: "user", text: text, t: Date.now() }; R.msgs.push(um); write("event", { pid: R.pid }, { kind: "chat", role: "user", text: text });
    const log = $("rnLog"); if (log.querySelector(".rn-empty")) log.innerHTML = "";
    log.insertAdjacentHTML("beforeend", bubbleHtml(um)); log.insertAdjacentHTML("beforeend", '<div class="rn-msg bot"><div class="bubble bot" id="rnCur">근거 쪽을 찾는 중…</div></div>'); log.scrollTop = log.scrollHeight;
    const cur = $("rnCur");
    let acc = "";
    try {
      const chunks = await retrieve(text + " " + R.msgs.filter((m) => m.role === "user").slice(-2, -1).map((m) => m.text).join(" "), RS().k, RS().max);
      const messages = [{ role: "system", content: sysPrompt() + groundBlock(chunks) }];
      R.msgs.slice(-9, -1).forEach((m) => { if (m.text) messages.push({ role: m.role === "user" ? "user" : "assistant", content: m.text.slice(0, 4000) }); });
      messages.push({ role: "user", content: text });
      cur.textContent = chunks.length ? "자료 " + chunks.length + "곳을 근거로 답하는 중…" : "자료 발췌 없이 답하는 중…";
      acc = await llmStreamChat(messages, (d, full) => { if (full) { cur.innerHTML = chatMarkup(full); log.scrollTop = log.scrollHeight; } }, { temperature: 0.3, maxTokens: 1800 });
      if (!acc) acc = "답변을 받지 못했어요.";
      const bm = { role: "assistant", text: acc, t: Date.now(), cites: chunks.map((c) => c.name + (c.p ? " p." + c.p : "")) }; R.msgs.push(bm);
      write("event", { pid: R.pid }, { kind: "chat", role: "assistant", text: acc, cites: bm.cites.slice(0, 12) });
      cur.parentNode.outerHTML = bubbleHtml(bm, R.msgs.length - 1);
      R.events.push({ kind: "chat", role: "user", text: text, t: um.t }, { kind: "chat", role: "assistant", text: acc, t: bm.t }); paintHist();
    } catch (e) { cur.innerHTML = '<span class="lb-err">' + esc(e.message) + "</span>"; }
    finally { R.busy = false; const b = $("rnSend"); if (b) b.disabled = false; log.scrollTop = log.scrollHeight; }
  }
  function toDoc(i) {
    const m = R.msgs[i]; if (!m) return;
    const q = R.msgs.slice(0, i).reverse().filter((x) => x.role === "user")[0];
    if (!R.doc) newDoc("free", false);
    R.doc.sections.push({ h: (q ? q.text : "대화에서").slice(0, 80), body: m.text }); R.dirty = true;
    R.tab = "doc"; paintPane();
  }

  /* =====================================================================
   * 5. 문서 편집 · AI 초안 · 버전 · 내보내기
   * =================================================================== */
  function newDoc(kind, paint, keepTab) {   // keepTab: 자료 보기(읽기 작업대)에서 만들 때는 탭을 옮기지 않는다
    kind = kind || "summary";
    R.did = null; R.versions = [];
    R.doc = { title: (R.project.name || "문서") + " " + (DOC_KINDS[kind] || ""), kind: kind, kicker: KINDS[R.project.kind] || "", meta: "", sections: OUTLINES[kind].map((h) => ({ h: h, body: "" })) };
    R.dirty = true; if (!keepTab) R.tab = "doc"; if (paint !== false) { paintSide(); paintPane(); }
  }
  async function loadDoc(did, v) {
    lset("rnd_draft", null); lastDraft = "";
    try { const d = await WS.req("doc", { pid: R.pid, did: did, v: v }); R.doc = d.doc; R.did = did; R.dirty = !!v && v !== R.docs.filter((x) => x.id === did)[0]?.v; R.versions = (await WS.req("versions", { pid: R.pid, did: did })).list || []; }
    catch (e) { alert(e.message); return; }
    R.tab = "doc"; paintSide(); paintPane();
  }
  function paintDoc() {
    const pane = $("rnPane"); if (!pane) return;
    if (!R.doc) {
      pane.innerHTML = '<div class="rn-empty"><b>문서를 고르거나 새로 만드세요</b><p class="sh-muted">종류를 고르면 그 종류에 맞는 차례가 미리 들어가요. [AI 초안] 을 누르면 올린 자료를 근거로 각 절을 채워요.</p><div class="rn-kinds">' + Object.keys(DOC_KINDS).map((k) => '<button type="button" class="rn-kind" data-rn-newdoc="' + k + '"><b>' + esc(DOC_KINDS[k]) + "</b><small>" + esc(OUTLINES[k].slice(0, 3).join(" · ") || "빈 문서에서 시작") + "</small></button>").join("") + "</div></div>";
      return;
    }
    const d = R.doc;
    pane.innerHTML = '<div class="rn-doc-bar"><input id="rnDTitle" class="rn-dtitle" type="text" value="' + esc(d.title) + '" placeholder="문서 제목"><select id="rnDKind" class="set-select">' + Object.keys(DOC_KINDS).map((k) => '<option value="' + k + '"' + (k === d.kind ? " selected" : "") + ">" + DOC_KINDS[k] + "</option>").join("") + "</select>" +
      '<span class="rn-dstate">' + (R.did ? "v" + (d.v || "?") + (R.dirty ? " · 수정됨" : " · 저장됨") : "새 문서" + (R.dirty ? " · 미저장" : "")) + "</span>" +
      '<button type="button" class="primary" data-rn="save">💾 저장(새 버전)</button>' + (R.did ? '<button type="button" class="ghost-btn" data-rn="versions">버전 ' + R.versions.length + "</button>" : "") +
      '<button type="button" class="ghost-btn rn-danger" data-rn="docdel">🗑 ' + (R.did ? "지우기" : "버리기") + "</button>" +
      '<button type="button" class="ghost-btn" data-rn="preview">' + (R.preview ? "✎ 편집" : "👁 미리보기") + '</button><span class="rn-exp"><b>내보내기</b>' + ["html", "md", "docx", "pptx"].map((f) => '<button type="button" class="ghost-btn small-btn" data-rn-exp="' + f + '">' + f.toUpperCase() + "</button>").join("") + "</span></div>" +
      '<div class="rn-ai-bar"><button type="button" class="primary big-btn" data-rn="draft"' + (R.gen ? " disabled" : "") + '>✨ AI 초안 — 자료로 전체 채우기</button><button type="button" class="ghost-btn" data-rn="outline">📑 차례 다시 제안</button><button type="button" class="ghost-btn" data-rn="addsec">＋ 절 추가</button><span id="rnGen" class="sh-muted">' + (R.gen ? esc(R.gen) : "") + "</span>" + (R.gen ? '<button type="button" class="ghost-btn small-btn" data-rn="cancel">중단</button>' : "") + "</div>" +
      '<div id="rnVers" class="hidden rn-vers"></div>' +
      (R.preview ? '<article class="rn-prev"><div class="sh-kicker">' + esc(d.kicker) + "</div><h1>" + esc(d.title) + "</h1>" + (d.meta ? '<p class="sh-muted">' + esc(d.meta) + "</p>" : "") + d.sections.map((s) => "<h2>" + esc(s.h) + "</h2>" + mdHtml(s.body)).join("") + "</article>"
        : '<div class="rn-secs" id="rnSecs">' + d.sections.map((s, i) => secHtml(s, i)).join("") + "</div>");
    bindDocInputs();
  }
  function secHtml(s, i) {
    const n = R.doc.sections.length;
    return '<div class="rn-s" data-i="' + i + '"><div class="rn-s-h"><span class="rn-s-n">' + (i + 1) + '</span><input type="text" class="rn-s-t" data-rn-sh="' + i + '" value="' + esc(s.h) + '" placeholder="절 제목"><div class="rn-s-tools">' +
      '<select class="set-select rn-s-ai" data-rn-sai="' + i + '"><option value="">AI ▾</option><option value="write">자료로 이 절 쓰기</option><option value="rewrite">다시 쓰기</option><option value="longer">더 자세히</option><option value="shorter">더 짧게</option><option value="bullets">개조식으로</option><option value="formal">격식체로</option><option value="table">표로 정리</option><option value="evidence">근거·쪽 보강</option><option value="questions">예상 질문 3개</option></select>' +
      '<button type="button" class="icon-mini" data-rn-smv="' + i + '|-1" title="위로"' + (i === 0 ? " disabled" : "") + '>↑</button><button type="button" class="icon-mini" data-rn-smv="' + i + '|1" title="아래로"' + (i === n - 1 ? " disabled" : "") + '>↓</button><button type="button" class="icon-mini" data-rn-sdel="' + i + '" title="절 삭제">✕</button></div></div>' +
      '<textarea class="rn-s-b" data-rn-sb="' + i + '" placeholder="내용 (마크다운: **굵게**, - 목록, 1. 번호, | 표 |)">' + esc(s.body) + '</textarea><div class="rn-s-msg" id="rnSMsg' + i + '"></div></div>';
  }
  function mdHtml(md) {
    // 미리보기용 가벼운 변환(표 포함). 내보내기는 서버(ws_api.to_html)가 같은 규칙으로 만든다.
    const lines = String(md || "").replace(/\r/g, "").split("\n"); let out = "", list = null, tbl = [];
    const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
    const flushL = () => { if (list) { out += "</" + list + ">"; list = null; } };
    const flushT = () => { if (tbl.length) { out += "<table>" + tbl.map((r, ri) => "<tr>" + r.map((c) => (ri ? "<td>" : "<th>") + inline(c) + (ri ? "</td>" : "</th>")).join("") + "</tr>").join("") + "</table>"; tbl = []; } };
    lines.forEach((ln) => {
      const t = ln.trim();
      if (t.startsWith("|")) { flushL(); const cells = t.replace(/^\||\|$/g, "").split("|").map((c) => c.trim()); if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) tbl.push(cells); return; }
      flushT();
      let m;
      if ((m = t.match(/^(#{1,4})\s+(.*)/))) { flushL(); out += "<h" + (m[1].length + 2) + ">" + inline(m[2]) + "</h" + (m[1].length + 2) + ">"; }
      else if (/^[-*•·]\s+/.test(t)) { if (list !== "ul") { flushL(); out += "<ul>"; list = "ul"; } out += "<li>" + inline(t.replace(/^[-*•·]\s+/, "")) + "</li>"; }
      else if (/^\d+[.)]\s+/.test(t)) { if (list !== "ol") { flushL(); out += "<ol>"; list = "ol"; } out += "<li>" + inline(t.replace(/^\d+[.)]\s+/, "")) + "</li>"; }
      else if (t.startsWith(">")) { flushL(); out += "<blockquote>" + inline(t.slice(1).trim()) + "</blockquote>"; }
      else if (!t) flushL();
      else { flushL(); out += "<p>" + inline(t) + "</p>"; }
    });
    flushL(); flushT(); return out;
  }
  function bindDocInputs() {
    const t = $("rnDTitle"); if (t) t.addEventListener("input", () => { R.doc.title = t.value; R.dirty = true; });
    const k = $("rnDKind"); if (k) k.addEventListener("change", () => { R.doc.kind = k.value; R.dirty = true; });
    document.querySelectorAll("[data-rn-sh]").forEach((el) => el.addEventListener("input", () => { R.doc.sections[+el.dataset.rnSh].h = el.value; R.dirty = true; }));
    document.querySelectorAll("[data-rn-sb]").forEach((el) => { grow(el); el.addEventListener("input", () => { R.doc.sections[+el.dataset.rnSb].body = el.value; R.dirty = true; grow(el); }); });
    document.querySelectorAll("[data-rn-sai]").forEach((el) => el.addEventListener("change", () => { const v = el.value; el.value = ""; if (v) secAi(+el.dataset.rnSai, v); }));
  }
  function grow(el) { el.style.height = "auto"; el.style.height = Math.min(900, Math.max(96, el.scrollHeight + 4)) + "px"; }
  async function rmDoc(did, title) {
    if (!confirm("'" + title + "' 문서를 지울까요?\n휴지통으로 옮겨요 — 보고서 작성·보조의 🗑 휴지통에서 되살릴 수 있어요.")) return;
    try { await WS.req("docrm", { pid: R.pid, did: did }, {}); } catch (e) { alert(e.message); return; }
    R.docs = R.docs.filter((x) => x.id !== did);
    if (R.did === did) { R.doc = null; R.did = null; R.dirty = false; R.versions = []; dropDraft(); }
    paintSide(); if (R.tab === "doc") paintPane(); note("문서를 휴지통으로 옮겼어요.");
  }
  async function saveDoc(note) {
    if (!R.doc) return;
    const d = Object.assign({}, R.doc, { note: note || "", ifV: R.did && R.doc.v ? R.doc.v : undefined });   // (v122) 동시 수정 감지
    try {
      let r;
      try { r = await write("doc", { pid: R.pid, did: R.did }, d); }
      catch (e) {
        if (!/먼저 저장했어요/.test(e.message)) throw e;
        if (!confirm(e.message + "\n\n[확인] 지금 내용을 새 버전으로 저장해요. 먼저 저장된 버전은 버전 목록에 그대로 남아요.\n[취소] 저장하지 않아요.")) return;
        delete d.ifV; r = await write("doc", { pid: R.pid, did: R.did }, d);
      }
      if (r.queued) { alert("저장소가 꺼져 있어 이 브라우저에 대기시켰어요. 서버가 켜지면 자동으로 저장돼요."); return; }
      R.doc = r.doc; R.did = r.doc.id; R.dirty = false; lset("rnd_draft", null); lastDraft = "";
      R.docs = (await WS.req("docs", { pid: R.pid })).list || []; R.versions = (await WS.req("versions", { pid: R.pid, did: R.did })).list || [];
      R.events.push({ kind: "doc", action: "save", v: r.doc.v, title: r.doc.title, note: note || "", t: Date.now() });
      paintSide(); paintHist();
      if (R.tab === "src") { if (window.RNDREAD && RNDREAD.docChanged) RNDREAD.docChanged(); } else paintPane();   // (v98) 읽기 작업대에서 저장해도 뷰어를 다시 그리지 않는다
    } catch (e) { alert("저장 실패: " + e.message); }
  }
  async function showVersions() {
    const box = $("rnVers"); if (!box) return;
    if (!box.classList.contains("hidden")) { box.classList.add("hidden"); return; }
    box.classList.remove("hidden");
    box.innerHTML = '<b>버전</b> ' + R.versions.slice().reverse().map((v) => '<button type="button" class="lb-pick' + (v.v === R.doc.v ? " on" : "") + '" data-rn-ver="' + v.v + '" title="' + esc(v.title) + '">v' + v.v + " · " + fmtT(v.saved) + (v.note ? " · " + esc(v.note) : "") + "</button>").join("") + '<span class="sh-muted">예전 버전을 열어 저장하면 그 내용이 새 버전으로 들어가요(지워지는 버전은 없어요).</span>';
  }
  async function exportDoc(fmt) {
    if (!R.doc) return;
    if (R.dirty || !R.did) { await saveDoc("내보내기 전 저장"); if (R.dirty || !R.did) return; }
    const bar = document.querySelector(".rn-exp") || document.getElementById("rrMkOut") || document.createElement("span"); const old = bar.innerHTML; bar.innerHTML = loading(fmt.toUpperCase() + " 만드는 중…");
    try {
      const r = await WS.req("export", { pid: R.pid, did: R.did, fmt: fmt, v: R.doc.v }, {});
      const url = WS.url("out", { pid: R.pid, name: r.name });
      bar.innerHTML = old;
      const a = document.createElement("a"); a.href = url; a.download = r.name; a.style.display = "none"; document.body.appendChild(a);
      // 헤더(X-Study-User)가 필요해서 fetch 로 받아 blob 으로 저장
      const resp = await fetch(url); const blob = await resp.blob(); a.href = URL.createObjectURL(blob); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
      R.events.push({ kind: "export", fmt: fmt, name: r.name, t: Date.now() }); paintHist();
    } catch (e) { bar.innerHTML = old; alert("내보내기 실패: " + e.message); }
  }
  /* ---- AI ---- */
  async function ai(user, sys, tokens, temp) {
    const g = await gateAction({ action: "rnd", cost: 1 }); if (!g.ok) throw new Error(gateMessage(g));
    let acc = "";
    acc = await llmStreamChat([{ role: "system", content: sys || sysPrompt() }, { role: "user", content: user }], () => {}, { temperature: temp == null ? 0.3 : temp, maxTokens: tokens || 1600 });
    return (acc || "").trim();
  }
  function docBrief() { return "문서 종류: " + (DOC_KINDS[R.doc.kind] || R.doc.kind) + " / 제목: " + R.doc.title + " / 차례: " + R.doc.sections.map((s) => s.h).join(" · "); }
  async function secAi(i, what) {
    const s = R.doc.sections[i]; if (!s) return;
    const msg = $("rnSMsg" + i); msg.innerHTML = loading("AI 가 '" + s.h + "' 작업 중…");
    try {
      let chunks = [];
      if (["write", "evidence", "longer", "rewrite"].indexOf(what) >= 0) chunks = await retrieve(s.h + " " + (R.project.goal || "") + " " + s.body.slice(0, 300), 8, 7000);
      const style = R.doc.kind === "slides" ? "발표 자료 한 장에 들어갈 개조식(불릿 4~7개, 각 1~2줄)" : R.doc.kind === "brief" ? "브리핑 노트(짧은 개조식)" : "보고서 문단(필요하면 불릿·표)";
      const P = {
        write: "'" + s.h + "' 절을 자료 발췌를 근거로 작성하세요. 형식: " + style + ". 수치·기간·명칭은 자료 그대로, 근거 쪽을 (파일명 p.N) 으로 표기. 자료에 없는 내용은 쓰지 마세요.",
        rewrite: "다음 절을 더 명확하고 읽기 쉽게 다시 쓰세요(내용·수치 유지, 형식: " + style + ").\n\n" + s.body,
        longer: "다음 절을 자료 발췌를 참고해 더 구체적으로 보강하세요(근거 쪽 표기).\n\n" + s.body,
        shorter: "다음 절을 핵심만 남겨 절반 길이로 줄이세요.\n\n" + s.body,
        bullets: "다음 절을 개조식(명사형 종결, 불릿)으로 바꾸세요.\n\n" + s.body,
        formal: "다음 절을 공문·보고서 격식체(…함/…임 또는 …합니다 통일)로 다듬으세요.\n\n" + s.body,
        table: "다음 절의 내용을 마크다운 표(| 항목 | 내용 |)로 정리하고, 표 아래 한 줄 요약을 붙이세요.\n\n" + s.body,
        evidence: "다음 절의 각 주장에 자료 발췌의 근거 쪽 (파일명 p.N) 을 붙이고, 자료와 어긋나는 부분이 있으면 [확인 필요] 로 표시하세요.\n\n" + s.body,
        questions: "다음 절에 대해 심사위원이 던질 만한 날카로운 질문 3개와 각 질문에 대한 답변 방향을 쓰세요.\n\n" + s.body,
      };
      const out = await ai(docBrief() + "\n\n" + P[what] + groundBlock(chunks), sysPrompt() + " 출력은 절 본문만(제목·인사말 없이, 마크다운).", 1600, 0.3);
      if (what === "questions") s.body = (s.body ? s.body + "\n\n" : "") + "**예상 질문**\n" + out; else s.body = out;
      R.dirty = true; write("event", { pid: R.pid }, { kind: "ai", what: what + " · " + s.h });
      const ta = document.querySelector('[data-rn-sb="' + i + '"]'); if (ta) { ta.value = s.body; grow(ta); }
      msg.innerHTML = '<span class="sh-muted">✓ 완료' + (chunks.length ? " · 근거 " + chunks.length + "곳" : "") + "</span>"; setTimeout(() => { if (msg) msg.innerHTML = ""; }, 4000);
    } catch (e) { msg.innerHTML = '<span class="lb-err">' + esc(e.message) + "</span>"; }
  }
  async function draftAll() {
    if (!R.doc || R.gen) return;
    if (!ctxFids().length) { alert("근거로 쓸 자료(텍스트가 있는 파일)가 없어요. 먼저 PDF 를 올려 주세요."); return; }
    const secs = R.doc.sections.filter((s) => !s.body.trim());
    const targets = secs.length ? secs : R.doc.sections;
    if (!targets.length) return;
    if (!secs.length && !confirm("모든 절이 이미 채워져 있어요. 전부 다시 쓸까요?")) return;
    R.gen = "준비 중…"; R.cancel = false; paintDoc();
    try {
      for (let k = 0; k < targets.length; k++) {
        if (R.cancel) break;
        const s = targets[k]; const i = R.doc.sections.indexOf(s);
        R.gen = (k + 1) + "/" + targets.length + " · '" + s.h + "' 작성 중…"; const g = $("rnGen"); if (g) g.textContent = R.gen;
        await secAi(i, "write");
      }
      if (!R.cancel) { R.gen = null; await saveDoc("AI 초안"); return; }
    } catch (e) { alert(e.message); }
    R.gen = null; paintDoc();
  }
  async function suggestOutline() {
    if (!R.doc) return;
    const g = $("rnGen"); if (g) g.innerHTML = loading("자료를 훑어 차례를 제안하는 중…");
    try {
      const chunks = await headChunks(9000);
      const out = await ai("이 문서(" + (DOC_KINDS[R.doc.kind] || "") + ", 목표: " + (R.project.goal || "") + ")에 맞는 차례를 자료 내용에 맞춰 5~9개 제안하세요. 한 줄에 하나, 번호·설명 없이 절 제목만." + groundBlock(chunks, "자료 앞부분"), sysPrompt(), 400, 0.3);
      const heads = out.split("\n").map((x) => x.replace(/^[\s\d.)\-•*]+/, "").trim()).filter((x) => x && x.length < 60);
      if (!heads.length) throw new Error("차례를 받지 못했어요.");
      const keep = R.doc.sections.filter((s) => s.body.trim());
      R.doc.sections = keep.concat(heads.filter((h) => !keep.some((s) => s.h === h)).map((h) => ({ h: h, body: "" }))); R.dirty = true; paintDoc();
    } catch (e) { if (g) g.innerHTML = '<span class="lb-err">' + esc(e.message) + "</span>"; }
  }

  /* =====================================================================
   * 6. 자료 보기
   * =================================================================== */
  function paintSrc() {   // (v98) 읽기 작업대 — 뷰어 | AI 대화 · 수집함 · 주석 (rndread.js · docview.js)
    const pane = $("rnPane"); if (!pane) return;
    try { RNDREAD.paint(pane, INT); } catch (e) { pane.innerHTML = warn("자료 보기를 열지 못했어요: " + e.message); }
  }
  function askSelection() {
    const sel = String(window.getSelection() || "").trim();
    if (!sel) { alert("자료 본문에서 물어볼 부분을 드래그해 주세요."); return; }
    const pg = (() => { try { const n = window.getSelection().anchorNode; const p = n && (n.nodeType === 3 ? n.parentNode : n).closest(".rn-page"); return p && p.id ? p.id.replace("rnP", "") : ""; } catch (e) { return ""; } })();
    R.tab = "chat"; paintPane();
    const ta = $("rnIn"); if (ta) { ta.value = "다음 부분(" + (R.files.filter((x) => x.id === R.srcFid)[0] || {}).name + (pg ? " p." + pg : "") + ")을 설명해 줘:\n“" + sel.slice(0, 1200) + "”\n\n"; ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  }

  /* =====================================================================
   * 7. 작업 이력 · 저장소
   * =================================================================== */
  async function renderLog() {
    logArea.innerHTML = '<section class="lb-hero rn-hero"><div><div class="sh-kicker">연구지원 · 저장소</div><h2>작업 이력 · 저장소 상태</h2><p>모든 프로젝트의 대화·문서 저장·내보내기·자료 올림이 시간순으로 남아요. 저장소는 서버 폴더의 파일이라 폴더를 통째로 복사하면 다른 PC 로 옮겨져요.</p></div><span class="rn-status"></span></section><div id="rnLogBody">' + loading() + "</div>";
    paintStatus();
    await WS.ping();
    const info = WS.info || {};
    let tl = [];
    if (WS.online) { try { tl = (await WS.req("timeline", { limit: 400 })).list || []; } catch (e) { tl = []; } }
    const libs = info.libs || {};
    const ICON = { chat: "💬", doc: "📝", export: "📤", file: "📎", project: "📂", ai: "✨", issue: "🔗" };
    $("rnLogBody").innerHTML = weeklyCard() +
      '<div class="rn-grid2"><div class="lb-card2"><h3>🗄 저장소</h3>' + (WS.online ? '<p><b>연결됨</b> · 폴더 <code>' + esc(info.dir || "") + "</code></p><p>사용자 폴더 " + (info.users || 0) + "개 · 자동 백업 " + (info.backups || 0) + "개" + (info.last_backup ? " (최근 " + esc(info.last_backup) + ")" : "") + (info.free_gb != null ? " · 여유 공간 " + info.free_gb + " GB" : "") + "</p>" +
        '<p class="sh-muted">PDF 추출 ' + (libs.fitz || libs.pypdf ? "가능" : "<b class='rn-bad'>불가(pip install pymupdf)</b>") + " · DOCX " + (libs.docx ? "가능" : "<b class='rn-bad'>불가(pip install python-docx)</b>") + " · PPTX " + (libs.pptx ? "가능" : "<b class='rn-bad'>불가(pip install python-pptx)</b>") + "<br>실행 파이썬: <code>" + esc(info.py || "") + "</code></p>" +
        '<div class="lb-row"><button type="button" class="ghost-btn" data-rn="backup">지금 백업</button><button type="button" class="ghost-btn" data-rn="howmove">다른 PC 로 옮기는 법</button></div><div id="rnHow" class="hidden rn-how"><ol><li>서버를 끄고 ScholarFlow 폴더를 통째로 복사(데이터·백업·암호화 키가 모두 폴더 안).</li><li>새 PC 에서 그 폴더 안에서 <code>python serve.py</code> 한 줄(처음 한 번 <code>python -m pip install -r requirements.txt</code>). 데이터만 따로 옮겼다면 <code>--data-dir="복사한 폴더"</code>.</li><li>끝. 프로젝트·자료·대화·문서 버전·내보낸 파일이 그대로예요. DB 덤프 없음.</li><li>클라우드플레어 터널로 이 서버를 열어 두면 어느 기기에서든 같은 저장소를 써요(서버 쪽 --lan 필요 없음, 터널이 127.0.0.1:18162 로 붙음).</li></ol><p class="sh-muted">안전 장치: 모든 쓰기는 임시 파일 → 교체(쓰다 죽어도 이전 파일 보존), 이력은 추가만 하는 줄 단위 로그, 문서는 저장마다 새 번호, 삭제는 _trash/ 로 이동, 1시간마다 backup/ 에 스냅숏(바뀐 파일만, 시간별 24·일별 14·월별 6 보관, 깨진 파일이 있으면 남기지 않음).</p></div>'
        : '<p class="lb-warn">저장소 서버가 꺼져 있어요. 프로젝트 폴더에서 <code>python serve.py 18162</code> 를 실행해 주세요.</p>' + (WS.pending() ? "<p>이 브라우저에 보내지 못한 쓰기 " + WS.pending() + "건이 대기 중 — 서버가 켜지면 자동으로 보내요.</p>" : "")) + "</div>" +
      '<div class="lb-card2"><h3>☁ 실시간 저장</h3><p class="sh-muted">설정과 연구지원 작업 위치는 <b>바뀌는 순간 서버의 내 계정에 저장</b>돼요(브라우저는 임시 보관만). 다른 브라우저에서 로그인해도 그대로 이어져요.</p><p class="sv-live" data-kv-status></p><div class="lb-row"><button type="button" class="ghost-btn" data-acm-go="security">저장 상태 · 사본 · 되돌리기</button></div></div></div>' +
      tlHtml(tl, ICON);
    bindTl();
  }
  /* (v122) 주간 연구 일지 — 이번 주 이력을 AI 가 프로젝트별로 정리한다 */
  let weekly = null;
  function weeklyCard() {
    const w = weekly || (window.TK ? TK.store.get("rnd.weekly", null) : null);
    return '<div class="lb-card2"><h3>이번 주 연구 일지</h3><p class="sh-muted">지난 7일의 대화·문서·자료 기록을 AI 가 프로젝트별로 정리해요.</p><div class="lb-row"><button type="button" class="primary" data-rn="weekly">' + (w ? "다시 쓰기" : "일지 쓰기") + "</button>" + (w ? '<button type="button" class="ghost-btn" data-rn="weeklydoc">문서로 저장</button>' : "") + '</div><div id="rnWeekly" class="tk-md">' + (w ? TK.md(w.md) : "") + "</div></div>";
  }
  async function weeklyLog() {
    const box = $("rnWeekly"); if (!box) return; box.textContent = "정리하는 중…";
    try {
      const tl = (await WS.req("timeline", { limit: 400 })).list || [], since = Date.now() - 7 * 86400000;
      const rows = tl.filter((e) => (e.t || 0) >= since).map((e) => new Date(e.t).toLocaleDateString("ko-KR") + " | " + (e.pname || "") + " | " + (e.kind || "") + " " + (e.action || "") + " | " + (e.title || e.name || e.note || "")).slice(0, 220);
      if (!rows.length) { box.textContent = "지난 7일 기록이 없어요."; return; }
      const md = await TK.ai({ sys: "당신은 연구실 주간 보고 담당자입니다. 주어진 작업 기록에 있는 사실만 씁니다. 추측하지 않습니다. 한국어로.", user: "[지난 7일 작업 기록]\n" + rows.join("\n") + "\n\n형식: 프로젝트마다 '## 프로젝트 이름' 아래 □ 한 일 / □ 만든 것 / □ 다음에 할 일(기록에서 분명한 것만). 마지막에 '## 한 주 요약' 세 줄.", tokens: 1200 });
      weekly = { t: Date.now(), md: md, pid: (tl.find((e) => (e.t || 0) >= since) || {}).pid }; TK.store.set("rnd.weekly", weekly);
      renderLog();
    } catch (e) { box.textContent = "⚠ " + e.message; }
  }
  async function weeklyDoc() {
    const w = weekly || TK.store.get("rnd.weekly", null); if (!w) return;
    const pid = R.pid || w.pid; if (!pid) return alert("저장할 프로젝트를 먼저 여세요.");
    const title = "주간 연구 일지 " + new Date(w.t).toLocaleDateString("ko-KR");
    try { await WS.req("doc", { pid: pid }, { title: title, kind: "report", sections: [{ h: title, body: w.md }], note: "주간 연구 일지" }); alert("'" + title + "' 문서로 저장했어요."); } catch (e) { alert(e.message); }
  }
  /* (v98) 타임라인 — 날짜별 묶음 · 한 줄 행(종류 아이콘 · 내용 · 프로젝트 칩 · 시각) · 종류 필터(개수) · 찾기 · 같은 순간 프로젝트 이벤트 합치기 */
  const TL_K = [["all", "전체"], ["chat", "대화"], ["doc", "문서"], ["export", "내보내기"], ["file", "자료"], ["project", "프로젝트"], ["issue", "이슈"], ["ai", "AI 작업"]];
  function tlHtml(tl, ICON) {
    const rows = [];
    tl.forEach((e) => {   // 폴더 연결 때 '만듦 + 폴더 연결 + 수정'이 한꺼번에 생긴다 → 한 줄로
      const p = rows[rows.length - 1];
      if (p && e.kind === "project" && p.e.kind === "project" && p.e.pid === e.pid && Math.abs((p.e.t || 0) - (e.t || 0)) < 10000) { if (e.action === "create") p.e = Object.assign({}, p.e, { action: "create", name: p.e.name || e.name }); return; }
      rows.push({ e: e });
    });
    const cnt = {}; rows.forEach((r) => { cnt[r.e.kind] = (cnt[r.e.kind] || 0) + 1; });
    const dayKey = (t) => { const d = new Date(t || 0); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); };
    const dayLabel = (t) => {
      const d = new Date(t || 0), a = new Date(); a.setHours(0, 0, 0, 0); const diff = Math.round((a - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
      return diff === 0 ? "오늘" : diff === 1 ? "어제" : (d.getFullYear() !== a.getFullYear() ? d.getFullYear() + "년 " : "") + (d.getMonth() + 1) + "월 " + d.getDate() + "일 (" + "일월화수목금토"[d.getDay()] + ")";
    };
    const hm = (t) => new Date(t || 0).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
    const days = []; rows.forEach((r) => { const k = dayKey(r.e.t); let g = days[days.length - 1]; if (!g || g.k !== k) { g = { k: k, t: r.e.t, rows: [] }; days.push(g); } g.rows.push(r); });
    return '<div class="rn-tlx-head"><h3 class="rn-h3">타임라인</h3><div class="rn-tlx-tools"><div class="rn-tlx-seg" role="group" aria-label="종류">' +
      TL_K.filter((k) => k[0] === "all" || cnt[k[0]]).map((k) => '<button type="button" class="' + (k[0] === "all" ? "on" : "") + '" data-rn-tlf="' + k[0] + '">' + k[1] + "<i>" + (k[0] === "all" ? rows.length : cnt[k[0]]) + "</i></button>").join("") +
      '</div><input type="search" id="rnTlQ" placeholder="이력 찾기" aria-label="이력 찾기"></div></div>' +
      (rows.length ? '<div class="rn-tlx" id="rnTl">' + days.map((g) => '<section class="rn-tlx-day"><h4>' + esc(dayLabel(g.t)) + "<small>" + g.rows.length + '건</small></h4><ol>' +
        g.rows.map((r) => { const e = r.e; return '<li class="rn-tlx-r" data-k="' + esc(e.kind) + '"><span class="rn-tlx-ic k-' + esc(e.kind) + '" aria-hidden="true">' + (ICON[e.kind] || "•") + '</span><div class="rn-tlx-t"><b>' + esc(evLine(e)) + "</b>" +
          (e.pname ? '<button type="button" class="rn-tlx-p" data-rn-open="' + esc(e.pid) + '" title="이 프로젝트 열기">' + esc(e.pname) + "</button>" : "") + '</div><time datetime="' + new Date(e.t || 0).toISOString() + '">' + hm(e.t) + "</time></li>"; }).join("") + "</ol></section>").join("") + '<p class="sh-muted rn-tlx-none hidden">조건에 맞는 이력이 없어요.</p></div>'
        : '<div class="rn-tlx-empty"><b>아직 기록이 없어요</b><p class="sh-muted">프로젝트를 만들고 자료를 올리거나 대화하면 여기에 시간순으로 쌓여요.</p></div>');
  }
  function bindTl() {
    const box = $("rnTl"), q = $("rnTlQ"); if (!box) return;
    let kind = "all";
    const apply = () => {
      const w = (q && q.value || "").trim().toLowerCase(); let any = 0;
      box.querySelectorAll(".rn-tlx-day").forEach((sec) => { let n = 0; sec.querySelectorAll(".rn-tlx-r").forEach((li) => { const ok = (kind === "all" || li.dataset.k === kind) && (!w || li.textContent.toLowerCase().indexOf(w) >= 0); li.classList.toggle("hidden", !ok); if (ok) n++; }); sec.classList.toggle("hidden", !n); any += n; });
      const none = box.querySelector(".rn-tlx-none"); if (none) none.classList.toggle("hidden", any > 0);
    };
    document.querySelectorAll("[data-rn-tlf]").forEach((b) => b.addEventListener("click", () => { kind = b.dataset.rnTlf; document.querySelectorAll("[data-rn-tlf]").forEach((x) => x.classList.toggle("on", x === b)); apply(); }));
    if (q) { let t = 0; q.addEventListener("input", () => { clearTimeout(t); t = setTimeout(apply, 120); }); }
  }

  /* =====================================================================
   * 8. 이벤트
   * =================================================================== */
  document.addEventListener("click", async (e) => {
    const t = e.target; if (!t.closest) return;
    const pmb = t.closest("[data-rn-pm]"); if (pmb && area.contains(pmb)) { e.preventDefault(); e.stopPropagation(); const r = pmb.getBoundingClientRect(); pMenu(pmb.dataset.rnPm, r.left - 170, r.bottom + 4); return; }
    const gmb = t.closest("[data-rn-gm]"); if (gmb && area.contains(gmb)) { e.preventDefault(); e.stopPropagation(); const r = gmb.getBoundingClientRect(); gMenu(gmb.dataset.rnGm, r.left - 210, r.bottom + 4); return; }
    const pvb = t.closest("[data-rn-pv]"); if (pvb && area.contains(pvb)) { if (window.TK) TK.store.set("rnd.homeView", pvb.dataset.rnPv); paintProjects(); return; }
    const prs = t.closest("[data-rn-prestore]"); if (prs && area.contains(prs)) { try { await WS.req("prestore", { tid: prs.dataset.rnPrestore }, {}); note("프로젝트를 되살렸어요."); R.showTrash = false; home(); } catch (er) { alert(er.message); } return; }
    if (area.classList.contains("rn-gpick") && t.closest(".rn-card,.rn-row")) { e.preventDefault(); const c = t.closest(".rn-card,.rn-row"); c.classList.toggle("picked"); const m = c.querySelector(".rn-gsel"); if (m) m.classList.toggle("on"); return; }
    const op = t.closest("[data-rn-open]"); if (op && (area.contains(op) || logArea.contains(op))) { e.preventDefault(); R.pid = op.dataset.rnOpen; navTo("rnd"); return; }
    if (!area.contains(t) && !logArea.contains(t)) return;
    const a = t.closest("[data-rn]");
    if (a) {
      const k = a.dataset.rn;
      if (k === "new") createProject(); else if (k === "home") { if (hasUnsaved() && !confirm("저장하지 않은 문서 수정이 있어요. 나갈까요?")) return; dropBlank(); home(); }
      else if (k === "edit") { const n = prompt("프로젝트 이름", R.project.name); if (n == null) return; const g = prompt("목표", R.project.goal || ""); try { const d = await WS.req("project", {}, { id: R.pid, name: n, goal: g == null ? R.project.goal : g }); R.project = d.project; $("rnPName").textContent = d.project.name; $("rnPGoal").textContent = d.project.goal || ""; } catch (er) { alert(er.message); } }
      else if (k === "send") send(); else if (k === "grp-mode") { area.classList.toggle("rn-gpick"); $("rnGMove").classList.toggle("hidden"); paintPL(); } else if (k === "grp-move" || k === "grp-base") { const ids = Array.from(area.querySelectorAll(".rn-gsel.on")).map((x) => x.dataset.gsel); const name = k === "grp-base" ? "" : ($("rnGName").value || "").trim(); if (!ids.length || (k === "grp-move" && !name)) return; for (const id of ids) { const p = R.projects.filter((x) => x.id === id)[0]; await WS.req("project", {}, Object.assign({}, p, { id: id, group: name })); } home(); } else if (k === "link-folder") RNDLINK.folderDialog("folder", (p) => { if (p) openProject(p.id, p); else home(); }); else if (k === "link-master") RNDLINK.folderDialog("master", home); else if (k === "link-epic") RNDLINK.epicImport(home); else if (k === "newdoc") { if (hasUnsaved() && !confirm("저장하지 않은 수정이 있어요. 새 문서를 고를까요?")) return; R.doc = null; R.did = null; R.dirty = false; dropDraft(); R.tab = "doc"; paintSide(); paintPane(); }
      else if (k === "docdel") { if (!R.doc) return; if (R.did) rmDoc(R.did, R.doc.title); else { if (!docBlank(R.doc) && !confirm("저장하지 않은 이 문서를 버릴까요? 되돌릴 수 없어요.")) return; R.doc = null; R.dirty = false; R.versions = []; dropDraft(); paintSide(); paintPane(); } }
      else if (k === "new-open") { const nw = area.querySelector(".rn-new"); if (nw) { nw.classList.toggle("hidden"); if (!nw.classList.contains("hidden")) { const i = $("rnName"); if (i) i.focus(); } } }
      else if (k === "trash-show") { R.showTrash = !R.showTrash; paintProjects(); if (!R.showTrash) home(); }
      else if (k === "save") saveDoc(prompt("이 버전 메모(선택)", "") || ""); else if (k === "versions") showVersions(); else if (k === "preview") { R.preview = !R.preview; paintDoc(); }
      else if (k === "draft") draftAll(); else if (k === "outline") suggestOutline(); else if (k === "cancel") R.cancel = true;
      else if (k === "addsec") { R.doc.sections.push({ h: "", body: "" }); R.dirty = true; paintDoc(); const last = document.querySelector('[data-rn-sh="' + (R.doc.sections.length - 1) + '"]'); if (last) last.focus(); }
      else if (k === "asksel") askSelection(); else if (k === "log") navTo("rndlog");
      else if (k === "intake") { a.disabled = true; AITASK.start("intake", R.pid).then((j) => AITASK.open(j.id)).catch((er) => { a.disabled = false; alert(er.message); }); }
      else if (k === "weekly") weeklyLog();
      else if (k === "weeklydoc") weeklyDoc();
      else if (k === "backup") { try { await WS.req("backup", {}, {}); alert("백업 스냅숏을 만들었어요(backup/)."); renderLog(); } catch (er) { alert(er.message); } }
      else if (k === "howmove") $("rnHow").classList.toggle("hidden");
      else if (k === "vhist") { vset("hist", !VP().hist); const w = area.querySelector(".rn-ws"); if (w) w.classList.toggle("hist-off", !VP().hist); const b = area.querySelector('[data-rn="vhist"].ghost-btn'); if (b) b.classList.toggle("on", VP().hist); }
      else if (k === "vside") { vset("side", !VP().side); const w = area.querySelector(".rn-ws"); if (w) w.classList.toggle("side-off", !VP().side); const b = area.querySelector('[data-rn="vside"].ghost-btn'); if (b) b.classList.toggle("on", !VP().side); }
      else if (k === "vbig") { const on = !document.body.classList.contains("rn-big"); document.body.classList.toggle("rn-big", on); a.classList.toggle("on", on); }
      else if (k === "vfull") { if (document.fullscreenElement) document.exitFullscreen(); else if (area.requestFullscreen) area.requestFullscreen(); }
      else if (k === "hide-show") { R.showArch = !R.showArch; paintProjects(); }
      else if (k === "grp-hide" || k === "grp-unhide" || k === "grp-trash") {
        const ids = Array.from(area.querySelectorAll(".rn-gsel.on")).map((x) => x.dataset.gsel); if (!ids.length) { alert("먼저 프로젝트를 눌러 고르세요."); return; }
        if (k === "grp-trash") { if (await trashProjects(ids, "고른 프로젝트 " + ids.length + "개를")) home(); return; }
        await setHidden(ids, k === "grp-hide");
        note(k === "grp-hide" ? "프로젝트 " + ids.length + "개를 숨겼어요 — [숨긴 프로젝트]에서 되돌려요." : "다시 보이게 했어요."); home();
      }
      return;
    }
    const tb = t.closest("[data-rn-tab]"); if (tb) { if (tb.dataset.rnTab !== R.tab && tb.dataset.rnTab !== "doc" && dropBlank()) paintSide(); R.tab = tb.dataset.rnTab; paintPane(); return; }
    const tl = t.closest("[data-rn-tool]"); if (tl) { R.tab = "tools"; paintPane(); const box = $("rnTools"); if (box && box._tk) box._tk.open(tl.dataset.rnTool); return; }
    const q = t.closest("[data-rn-q]"); if (q) { send(q.dataset.rnQ); return; }
    const td = t.closest("[data-rn-todoc]"); if (td) { toDoc(+td.dataset.rnTodoc); return; }
    const cp = t.closest("[data-rn-copy]"); if (cp) { try { await navigator.clipboard.writeText(R.msgs[+cp.dataset.rnCopy].text); cp.textContent = "복사됨"; } catch (er) { /* 계속 */ } return; }
    const nd = t.closest("[data-rn-newdoc]"); if (nd) { newDoc(nd.dataset.rnNewdoc); return; }
    const drm = t.closest("[data-rn-docrm]"); if (drm) { const x = R.docs.filter((q) => q.id === drm.dataset.rnDocrm)[0]; rmDoc(drm.dataset.rnDocrm, x ? x.title : "문서"); return; }
    const dd = t.closest("[data-rn-doc]"); if (dd) { if (hasUnsaved() && !confirm("저장하지 않은 수정이 있어요. 다른 문서를 열까요?")) return; loadDoc(dd.dataset.rnDoc); return; }
    const vv = t.closest("[data-rn-ver]"); if (vv) { loadDoc(R.did, +vv.dataset.rnVer); return; }
    const ex = t.closest("[data-rn-exp]"); if (ex) { exportDoc(ex.dataset.rnExp); return; }
    const mv = t.closest("[data-rn-smv]"); if (mv) { const [i, d] = mv.dataset.rnSmv.split("|").map(Number); const s = R.doc.sections; const j = i + d; if (j < 0 || j >= s.length) return; [s[i], s[j]] = [s[j], s[i]]; R.dirty = true; paintDoc(); return; }
    const sd = t.closest("[data-rn-sdel]"); if (sd) { const i = +sd.dataset.rnSdel; if (R.doc.sections[i].body.trim() && !confirm("이 절을 지울까요?")) return; R.doc.sections.splice(i, 1); R.dirty = true; paintDoc(); return; }
    const sr = t.closest("[data-rn-src]"); if (sr) { R.srcFid = sr.dataset.rnSrc; R.tab = "src"; paintPane(); return; }
    const rf = t.closest("[data-rn-rmfile]"); if (rf) { const f = R.files.filter((x) => x.id === rf.dataset.rnRmfile)[0]; if (!confirm("'" + (f ? f.name : "") + "' 을 프로젝트에서 뺄까요? (휴지통으로 이동)")) return; try { await WS.req("rmfile", { pid: R.pid, fid: rf.dataset.rnRmfile }, {}); R.files = R.files.filter((x) => x.id !== rf.dataset.rnRmfile); delete R.idx[rf.dataset.rnRmfile]; if (R.srcFid === rf.dataset.rnRmfile) R.srcFid = null; paintSide(); if (R.tab !== "doc") paintPane(); } catch (er) { alert(er.message); } return; }
    const tf = t.closest("[data-rn-tf]"); if (tf) { document.querySelectorAll("[data-rn-tf]").forEach((b) => b.classList.toggle("on", b === tf)); const k = tf.dataset.rnTf; document.querySelectorAll("#rnTl li").forEach((li) => { li.style.display = k === "all" || li.dataset.k === k ? "" : "none"; }); return; }
  });
  document.addEventListener("change", (e) => {
    const c = e.target.closest && e.target.closest("[data-rn-ctx]"); if (!c) return;
    const all = R.files.map((f) => f.id); const cur = R.ctx || all.slice();
    const id = c.dataset.rnCtx; const i = cur.indexOf(id); if (c.checked && i < 0) cur.push(id); if (!c.checked && i >= 0) cur.splice(i, 1);
    R.ctx = cur.length === all.length ? null : cur; paintSide(); const n = document.querySelector(".rn-ctxn"); if (n) n.textContent = "근거 자료 " + ctxFids().length + "개";
  });
  window.addEventListener("beforeunload", (e) => { if (hasUnsaved()) { e.preventDefault(); e.returnValue = ""; } });
  document.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches && e.target.matches(".rn-row[data-rn-open],.rn-card[data-rn-open]")) { e.preventDefault(); e.target.click(); } });
  // (v98) 자료 칸 폭 끌어 조절 · 크게 보기는 Esc 로 돌아오기
  document.addEventListener("pointerdown", (e) => {
    const g = e.target.closest && e.target.closest("[data-rn-grip]"); if (!g) return;
    e.preventDefault(); const ws = g.closest(".rn-ws"), x0 = e.clientX, w0 = parseInt(getComputedStyle(ws).getPropertyValue("--rn-sw")) || 300;
    g.setPointerCapture(e.pointerId); ws.classList.add("dragging");
    const mv = (ev) => ws.style.setProperty("--rn-sw", Math.max(220, Math.min(560, w0 + ev.clientX - x0)) + "px");
    g.addEventListener("pointermove", mv);
    g.addEventListener("pointerup", () => { g.removeEventListener("pointermove", mv); ws.classList.remove("dragging"); vset("sw", parseInt(ws.style.getPropertyValue("--rn-sw")) || 300); }, { once: true });
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && document.body.classList.contains("rn-big") && !document.fullscreenElement && !(document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName))) { document.body.classList.remove("rn-big"); const b = document.querySelector('[data-rn="vbig"]'); if (b) b.classList.remove("on"); } });

  // (v93) 연결 패널 동작(에픽 연결·기록, 폴더 트리 모두/없음/새로)
  document.addEventListener("click", async (e) => {
    const t = e.target.closest && e.target.closest("[data-rl-ep], [data-rl-tree]"); if (!t || !area || !area.contains(t)) return;
    if (t.dataset.rlEp === "link") RNDLINK.epicImport(async () => { const pl = await WS.req("projects"); R.projects = pl.list || []; openProject(R.pid); }, R.pid);
    if (t.dataset.rlEp === "note") RNDLINK.epicNote(R.project, "[연구지원] '" + R.project.name + "' 진행 — 자료 " + R.files.filter((f) => !f.folder).length + "개 · 문서 " + R.docs.length + "개(" + R.docs.map((d) => d.title + " v" + d.v).slice(0, 5).join(", ") + ") · 대화 " + R.msgs.length + "턴 · " + new Date().toLocaleString("ko-KR"));
    const tr = t.dataset.rlTree;
    if (tr === "all") { const ids = R.files.filter((f) => (!f.folder || f.doc) && !f.hidden).map((f) => f.id); if (ids.length > 300 && !confirm("문서가 " + ids.length + "개예요. 모두 근거로 쓰면 첫 질문이 느릴 수 있어요. 계속할까요?")) return; R.ctx = ids; paintSide(); }
    if (tr === "none") { R.ctx = R.files.filter((f) => !f.folder).map((f) => f.id); paintSide(); }
    if (tr === "reload") openProject(R.pid);
  });
  async function makeDoc(kind, title, sections, note) {
    if (R.dirty && R.doc && !confirm("저장하지 않은 문서 수정이 있어요. 새 문서를 만들면 그 수정은 초안으로만 남아요. 계속할까요?")) throw new Error("취소했어요.");
    R.did = null; R.versions = [];
    R.doc = { title: String(title || "문서").slice(0, 120), kind: kind || "free", kicker: KINDS[R.project.kind] || "", meta: "", sections: sections };
    R.dirty = true; await saveDoc(note || "수집함에서"); paintSide();
  }
  function toDocMsg(text, head) { if (!R.doc) newDoc("free", false, true); R.doc.sections.push({ h: String(head || "자료 보며 묻기").slice(0, 80), body: text }); R.dirty = true; paintSide(); }
  const INT = {
    get R() { return R; }, WS: WS, retrieve: (q, k, m) => retrieve(q, k, m), retrieveIn: (fid, q, k, m) => retrieve(q, k, m, [fid]), groundBlock: groundBlock, sysPrompt: () => sysPrompt(), write: write,
    inCtx: (id) => ctxFids().indexOf(id) >= 0, makeDoc: makeDoc, exportDoc: (f) => exportDoc(f), paintSide: () => paintSide(), paintHist: () => paintHist(),
    setTab: (t) => { R.tab = t; paintPane(); }, persist: () => persistPos(), toDocMsg: toDocMsg,
    saveDoc: (note) => saveDoc(note), newDoc: (kind) => newDoc(kind || "free", false, true), docKinds: DOC_KINDS, docText: () => docTextOf(R.doc),
  };
  function docTextOf(d) { return d ? (d.title || "") + "\n\n" + d.sections.map((x) => "## " + x.h + "\n" + (x.body || "")).join("\n\n") : ""; }
  // (v102) 메뉴 페이지용 — 작업실을 열지 않고 프로젝트 자료·문서만 준비(도구가 RND.ctx() 로 쓴다)
  async function prepare(pid) {
    if (!pid) return false;
    if (R.pid === pid && R._ready) return true;
    if (!area) build();
    R._bg = true;
    try { if (!R.projects.length) { try { R.projects = (await WS.req("projects")).list || []; } catch (e) { /* 계속 */ } } await openProject(pid, R.projects.filter((p) => p.id === pid)[0]); R._ready = R.pid === pid; }
    finally { R._bg = false; }
    return R._ready;
  }
  async function useDoc(did) {
    if (!did) { R.doc = null; R.did = null; return; }
    if (R.did === did && R.doc) return;
    const d = await WS.req("doc", { pid: R.pid, did: did }); R.doc = d.doc; R.did = did; R.dirty = false;
  }
  window.RND = { open: (pid) => { R.pid = pid || null; navTo("rnd"); }, openSrc: (pid, fid, page) => { R.pid = pid; R._resumed = true; resumeTo = { pid: pid, tab: "src", src: fid, page: page || 1 }; return navTo("rnd"); }, ws: WS, projects: () => R.projects, prepare: prepare, useDoc: useDoc, docs: () => R.docs, cur: () => R.pid, saveDoc: (n) => saveDoc(n), paintPins: () => paintPins(),
    ctx: () => R.pid ? {
      pid: R.pid, name: R.project && R.project.name, WS: WS, files: () => R.files, inCtx: (id) => ctxFids().indexOf(id) >= 0,
      retrieve: (q, k, m) => retrieve(q, k, m), retrieveIn: (fid, q, k, m) => retrieve(q, k, m, [fid]), head: headChunks, ground: groundBlock,
      fileText: async (fid) => (await WS.req("text", { pid: R.pid, fid: fid })).text || "",
      doc: () => R.doc, did: () => R.did, docText: () => docTextOf(R.doc),
      docVersion: async (v) => (await WS.req("doc", { pid: R.pid, did: R.did, v: v || undefined })).doc || {},
      toDoc: (title, md) => { if (!R.doc) newDoc("free", false); R.doc.sections.push({ h: String(title || "도구 결과").slice(0, 80), body: md }); R.dirty = true; R.tab = "doc"; paintSide(); paintPane(); },
      project: () => R.project, msgs: () => R.msgs,
      setSection: (i, body) => { if (!R.doc || !R.doc.sections[i]) return false; R.doc.sections[i].body = body; R.dirty = true; if (R.tab === "doc") paintPane(); return true; },
      addCtx: (ids) => { const cur = R.ctx || R.files.map((f) => f.id); ids.forEach((id) => { if (cur.indexOf(id) < 0) cur.push(id); }); R.ctx = cur; paintSide(); },
      newDocFrom: (heads) => { newDoc("free", false); R.doc.sections = heads.map((h) => ({ h: h, body: "" })); paintSide(); paintPane(); },
      searchAll: async (q) => {
        const out = [], lq = q.toLowerCase(), snip = (t, i) => "…" + t.slice(Math.max(0, i - 60), i + 100).replace(/\s+/g, " ") + "…";
        for (const f of R.files.filter((x) => x.chars !== 0 && (!x.folder || ctxFids().indexOf(x.id) >= 0)).slice(0, 80)) { for (const c of await ensureIndex(f.id)) { const i = c.text.toLowerCase().indexOf(lq); if (i >= 0) { out.push({ where: "📎 " + c.name + (c.p ? " p." + c.p : ""), text: snip(c.text, i) }); if (out.length > 80) return out; } } }
        R.msgs.forEach((m) => { const i = m.text.toLowerCase().indexOf(lq); if (i >= 0) out.push({ where: "💬 대화(" + (m.role === "user" ? "나" : "AI") + ")", text: snip(m.text, i) }); });
        if (R.doc) R.doc.sections.forEach((x) => { const i = ((x.h || "") + " " + (x.body || "")).toLowerCase().indexOf(lq); if (i >= 0) out.push({ where: "📝 " + (R.doc.title || "문서") + " › " + x.h, text: snip(x.h + " " + (x.body || ""), i) }); });
        return out;
      },
    } : null };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build); else build();
})();
