(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => escapeHtml(String(s == null ? "" : s));
  const NEW = ["app", "apptop", "command"];
  const layout = () => document.documentElement.getAttribute("data-layout") || "sidebar";
  const on = () => NEW.indexOf(layout()) >= 0;
  const isApp = (L) => { L = L || layout(); return L === "app" || L === "apptop"; };   // 학습 앱형(왼쪽 메뉴 / 위 메뉴)
  const LS = { tabs: "study.shell.tabs", tree: "study.shell.tree", insp: "study.shell.insp", itab: "study.shell.itab", focus: "study.shell.focus", menu: "study.shell.menu", dock: "study.shell.dock", rail: "study.shell.rail", mini: "study.shell.mini", mig: "study.ui.shell.v1" };
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 계속 */ } };

  /* ---- 메뉴 묶음(두 레이아웃 공통) ---- */
  const HUBS = [
    { id: "today", label: "홈", ico: "i-home", items: [] },
    { id: "rnd", label: "연구", ico: "i-flask", items: ["rx_dash", "rnd", "rx_tasks", "rx_proj", "rx_paper", "rx_report", "rx_present", "rx_lit", "rx_review", "rx_deep", "rx_meet", "rndlog"] },
    { id: "lib", label: "자료", ico: "i-library", items: ["library", "libfolders", "lx_memory", "lx_notes", "lx_write", "lx_chat", "lx_lab", "lx_plan"] },
    { id: "set", label: "설정", ico: "i-gear", items: ["settings", "aiconn", "links", "rndset", "libset", "security", "help"] },
    { id: "admin", label: "관리자", ico: "i-shield", items: ["srvadmin", "rndadmin", "rndconn", "gateway", "backups", "libadmin", "sysconfig"] },
    // 휴대폰 아래 탭바 전용 묶음(자리가 모자라 설정·관리자를 한 칸에) — 데스크톱 메뉴엔 안 나온다
    { id: "me", label: "더보기", ico: "sh-user", mobile: true, items: ["settings", "rndset", "libset", "security", "help", "srvadmin", "rndadmin", "libadmin", "sysconfig"],
      groups: [["설정·도움", ["settings", "rndset", "libset", "security", "links", "help"]], ["관리자", ["srvadmin", "rndadmin", "libadmin", "sysconfig"]]] },
  ];
  const DESC = { library: "교재·자료 문서 읽기", settings: "테마 · 글꼴 · 화면 · AI 연결", help: "사용 가이드",
    rnd: "PDF·문서를 올려 AI 와 읽고 요약본·검토서·발표자료를 만들어 DOCX·PPTX 로", rndlog: "모든 프로젝트의 대화·문서·내보내기 이력 · 저장소 상태 · 실시간 저장",
    aiconn: "LLM 서버·Claude CLI 연결 · 가져오기 · 내보내기", rndconn: "연구행정관리시스템 토큰 연결", gateway: "다른 시스템이 쓰는 AI·검색 토큰", backups: "프로젝트를 백업 시점으로 되살리기", rx_tasks: "자료 정리·문헌 검토·심사 반복·제출 전 점검을 서버에서 끝까지", links: "계정 연결 · 통합 메뉴", security: "비밀번호 · 로그인된 기기 · 내 보안 기록", rndset: "FlowBoard 연결 · 대화 근거 분량", rndadmin: "저장소 · 로컬 폴더 · 마스터 폴더 · 전체 프로젝트",
    libset: "도구함 기본 범위 · 읽기 설정 · 리딩 메이트", libadmin: "자료 현황 · 학습 연구 데이터 · 도구 근거 조사", libfolders: "자료를 주제별 폴더로 묶고 문서별 내 데이터 관리", srvadmin: "서버 계정 만들기·잠금 · 보안 정책 · 서버 상태 · 로그 보기", sysconfig: "브랜딩 · 메뉴 · 전역 스위치",
  };
  const hubOf = (nav) => {
    if (nav === "today" || nav === "home") return "today";
    if (String(nav).indexOf("hub-") === 0) return nav.slice(4);
    const h = HUBS.filter((x) => x.items.indexOf(nav) >= 0)[0];
    return h ? h.id : null;
  };
  const hubById = (id) => HUBS.filter((x) => x.id === id)[0];
  function navNode(k) { return document.querySelector('.side-nav .nav-item[data-nav="' + k + '"]'); }
  // 원래 내비에 없는 확장 화면(EXT_VIEWS 로만 존재) — 메뉴에 그대로 보인다
  const EXTRA = { rx_dash: { label: "오늘 연구", ico: "i-home" }, rnd: { label: "연구 프로젝트", ico: "i-flask" }, rndlog: { label: "작업 이력 · 저장소", ico: "i-clipcheck" }, security: { label: "계정 · 보안", ico: "i-shield" }, srvadmin: { label: "계정 · 서버 관리", ico: "i-sliders" },
    aiconn: { label: "AI 연결", ico: "i-spark" }, rndconn: { label: "연구행정 연결", ico: "i-flask" }, gateway: { label: "AI 게이트웨이", ico: "i-spark" }, backups: { label: "백업 복원", ico: "i-shield" }, links: { label: "시스템 연동", ico: "i-shield" }, rx_tasks: { label: "AI 작업", ico: "i-spark" }, rndset: { label: "연구지원 설정", ico: "i-flask" }, rndadmin: { label: "연구지원 관리", ico: "i-flask" }, libset: { label: "자료 학습 설정", ico: "i-library" }, libadmin: { label: "자료 학습 관리", ico: "i-library" }, libfolders: { label: "내 학습 폴더", ico: "i-folder" },
    // (v102) 기능 메뉴 — 도구함 안에 숨어 있던 도구를 주제별 화면으로 꺼냄(hubs.js)
    rx_proj: { label: "프로젝트 정보·관리", ico: "i-board" }, rx_paper: { label: "논문 작성·보조", ico: "i-paper" }, rx_report: { label: "보고서 작성·보조", ico: "i-pen" },
    rx_lit: { label: "문헌·선행연구", ico: "i-book" }, rx_review: { label: "심사·평가 대비", ico: "i-clipcheck" }, rx_write: { label: "글 검토·다듬기", ico: "i-pen" }, rx_data: { label: "수치·일정·예산", ico: "i-chart" }, rx_present: { label: "발표자료 작성·보조", ico: "i-mic" }, rx_deep: { label: "심층 조사·지식맵", ico: "i-compass" }, rx_meet: { label: "회의·설문·메모", ico: "i-list" },
    lx_read: { label: "읽기 도우미", ico: "i-bookopen" }, lx_memory: { label: "복습 카드", ico: "i-rotate" }, lx_notes: { label: "노트 허브", ico: "i-stack" }, lx_write: { label: "서술형 연습", ico: "i-pencil" }, lx_speak: { label: "말하기·듣기", ico: "i-mic" }, lx_chat: { label: "대화·말하기", ico: "i-chat" }, lx_lab: { label: "개념 지도", ico: "i-bolt" }, lx_plan: { label: "학습 계획", ico: "i-target" } };
  // (v93) 모드 특화 화면 — 그 모드에서만 메뉴에 보인다(공통 설정·관리 화면은 모든 모드)
  const ITEM_MODE = { rndset: "research", rndadmin: "research", rndconn: "research", gateway: "research", backups: "research", libset: "library", libadmin: "library", libfolders: "library" };
  const MODES = [["research", "🔬", "연구지원", ["rnd"], "rx_dash"], ["library", "📚", "자료 학습", ["lib"], "library"]];
  const MODE_COMMON = ["set", "admin", "me"];
  const LS_MODE = "study.shell.mode";
  // (v113) 모드는 탭마다 따로 — localStorage 는 모든 탭이 같이 쓰므로, 다른 탭에서 자료 학습으로 바꾸면 이 탭의 모드 칩까지 바뀌었다.
  //   이 탭의 값은 sessionStorage(+메모리), localStorage 는 '마지막으로 쓴 모드'(새 탭이 거기서 시작)로만 쓴다.
  const ssGet = () => { try { const v = sessionStorage.getItem(LS_MODE); return v == null ? null : JSON.parse(v); } catch (e) { return null; } };
  let CUR_MODE = ssGet() || lsGet(LS_MODE, "research");
  // (v143) 계정별 기능 권한 — 서버가 준 user.modes 에 있는 모드만(관리자는 전부). 값이 없으면(옛 서버) 전부
  function allowedModes() {
    const u = window.SERVER && SERVER.user, ms = u && Array.isArray(u.modes) ? u.modes : null;
    return ms ? MODES.map((x) => x[0]).filter((m) => ms.indexOf(m) >= 0) : MODES.map((x) => x[0]);
  }
  function mode() { const m = MODES.some((x) => x[0] === CUR_MODE) ? CUR_MODE : "research", ok = allowedModes(); return ok.indexOf(m) >= 0 || !ok.length ? m : ok[0]; }
  function putMode(m) { CUR_MODE = m; try { sessionStorage.setItem(LS_MODE, JSON.stringify(m)); } catch (e) { /* 계속 */ } lsSet(LS_MODE, m); }
  function modeOf(m) { return MODES.filter((x) => x[0] === m)[0]; }
  function modeOfHub(hid) { const x = MODES.filter((m) => m[3].indexOf(hid) >= 0)[0]; return x ? x[0] : null; }
  function hubInMode(hid, m) { return MODE_COMMON.indexOf(hid) >= 0 || (modeOf(m || mode())[3]).indexOf(hid) >= 0; }
  function setMode(m, go) {
    if (!modeOf(m) || allowedModes().indexOf(m) < 0) return;
    const changed = m !== mode();
    putMode(m); paintMode();
    if (changed) { try { window.dispatchEvent(new CustomEvent("study:mode", { detail: m })); } catch (e) { /* 계속 */ } }
    const bar = document.querySelector(".sh-rail-hubs"); if (bar) bar.innerHTML = hubsBarHtml();
    if (go !== false && (changed || go === true)) {
      const cur = typeof state !== "undefined" ? state.nav : ""; const h = hubOf(cur);
      if (!h || !hubInMode(h, m) || go === true) navTo(modeOf(m)[4]);
      else syncNav(cur);
    } else schedule();
  }
  function paintMode() {
    const m = mode(), ok = allowedModes();
    document.documentElement.setAttribute("data-smode", m);
    document.querySelectorAll("#shMode button").forEach((b) => { b.classList.toggle("on", b.dataset.shMode === m); b.hidden = ok.indexOf(b.dataset.shMode) < 0; });
    const me = document.getElementById("shMode"); if (me) me.hidden = ok.length <= 1;     // 기능이 하나뿐이면 모드 버튼 자체를 숨긴다
    noFeature(!ok.length);
  }
  // 허용된 기능이 하나도 없는 계정(통합로그인이 비워 보낸 경우) — 화면을 덮고 안내만
  function noFeature(on) {
    let el = document.getElementById("shNoFeat");
    if (!on) { if (el) el.remove(); return; }
    if (el) return;
    el = document.createElement("div"); el.id = "shNoFeat"; el.className = "sh-nofeat"; el.setAttribute("role", "alert");
    el.innerHTML = "<div><h2>이용할 수 있는 기능이 없습니다</h2><p>이 계정에는 연구지원·자료 학습 중 허용된 기능이 없습니다. 관리자에게 권한을 요청하세요.</p></div>";
    document.body.appendChild(el);
  }
  // 권한이 바뀌었을 때(로그인·상태 갱신): 지금 모드가 막혔으면 허용된 첫 모드로
  window.addEventListener("slc:user", () => {
    paintMode();
    const ok = allowedModes();
    if (ok.length && ok.indexOf(CUR_MODE) < 0) { putMode(ok[0]); setMode(ok[0], true); }
  });
  function hubsBarHtml() { return HUBS.filter((h) => mobileHubs().indexOf(h.id) >= 0).map((h) => '<button type="button" class="sh-rail-btn" data-sh-hub="' + h.id + '">' + ico(h.ico) + "<span>" + h.label + "</span></button>").join(""); }
  function avail(k) {
    if (ITEM_MODE[k] && ITEM_MODE[k] !== mode()) return false;
    if (EXTRA[k]) return !!(EXT_VIEWS && EXT_VIEWS[k]) && (!EXT_VIEWS[k].avail || !!EXT_VIEWS[k].avail());
    const n = navNode(k);
    if (!n || n.classList.contains("hidden") || n.closest(".hidden")) return false;
    try { if (typeof navDisabled === "function" && navDisabled(k)) return false; } catch (e) { /* 계속 */ }
    return true;
  }
  function label(k) {
    if (k === "today") return "오늘";
    if (String(k).indexOf("hub-") === 0) { const h = hubById(k.slice(4)); return h ? h.label : k; }
    if (EXTRA[k]) return EXTRA[k].label;
    try { if (NAV_MENU_LABEL[k]) return NAV_MENU_LABEL[k]; } catch (e) { /* 계속 */ }
    const n = navNode(k); return n ? n.textContent.trim() : k;
  }
  function icoOf(k) {
    if (EXTRA[k]) return '<svg class="nav-ico" aria-hidden="true"><use href="#' + EXTRA[k].ico + '"></use></svg>';
    const n = navNode(k), i = n && n.querySelector(".nav-ico");
    return i ? i.outerHTML : '<svg class="nav-ico" aria-hidden="true"><use href="#i-spark"></use></svg>';
  }
  const ico = (id, cls) => '<svg class="sh-ico ' + (cls || "") + '" aria-hidden="true"><use href="#' + id + '"></use></svg>';
  function badgeOf(k) {
    const n = navNode(k), b = n && n.querySelector(".nav-badge");
    return b && !b.classList.contains("hidden") && b.textContent.trim() && b.textContent.trim() !== "0" ? b.textContent.trim() : "";
  }

  /* ---- 추가 아이콘 ---- */
  function sprite() {
    const S = {
      "sh-user": '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
      "sh-search": '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
      "sh-panel": '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
      "sh-tree": '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
      "sh-focus": '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
      "sh-play": '<path d="M7 4.5v15l12-7.5z"/>',
      "sh-trap": '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17.5v.01"/>',
      "sh-repeat": '<path d="M4 12a8 8 0 0 1 14-5.3L20 9"/><path d="M20 4v5h-5"/><path d="M20 12a8 8 0 0 1-14 5.3L4 15"/><path d="M4 20v-5h5"/>',
      "sh-layers": '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
      "sh-flame": '<path d="M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-3-1-5 1-8.5z"/>',
      "sh-check": '<path d="m5 12.5 4.5 4.5L19 7"/>',
      "sh-cmd": '<path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z"/>',
      "sh-chevd": '<path d="m6 9 6 6 6-6"/>',
      "sh-chevl": '<path d="m15 6-6 6 6 6"/>',
      "sh-x": '<path d="M6 6l12 12M18 6 6 18"/>',
    };
    const box = document.createElement("div");
    box.style.display = "none";
    box.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg">' + Object.keys(S).map((k) => '<symbol id="' + k + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + S[k] + "</symbol>").join("") + "</svg>";
    document.body.appendChild(box);
  }

  /* ================================================================== *
   * 학습 앱형 — 오늘 · 묶음 첫 화면 · 레일 · 알약 탭 · 집중 모드
   * ================================================================== */
  let todayArea = null, hubArea = null;
  function areas() {
    const content = document.querySelector("main.content");
    if (!content || todayArea) return;
    todayArea = document.createElement("section"); todayArea.id = "shTodayArea"; todayArea.className = "hidden sh-today";
    hubArea = document.createElement("section"); hubArea.id = "shHubArea"; hubArea.className = "hidden sh-hub";
    content.appendChild(todayArea); content.appendChild(hubArea);
    EXT_VIEWS.today = { area: todayArea, open: renderToday };
    HUBS.forEach((h) => { if (h.id !== "today") EXT_VIEWS["hub-" + h.id] = { area: hubArea, open: () => renderHub(h.id) }; });
  }
  async function renderToday() {
    // 홈은 지금 모드의 첫 화면으로(연구지원 = 오늘 연구, 자료 학습 = 학습 자료)
    navTo(modeOf(mode())[4]);
  }
  function mini(i, lab, val, sub, go) {
    return '<button type="button" class="sh-mini" data-sh-go="' + go + '"><span class="lab">' + ico(i) + " " + lab + '</span><span class="val">' + val + '</span><span class="sub">' + esc(sub) + "</span></button>";
  }
  function tile(k) {
    const b = badgeOf(k);
    return '<button type="button" class="sh-tile" data-sh-go="' + k + '"><span class="sh-tile-i">' + icoOf(k) + "</span><b>" + esc(label(k)) + "</b><p>" + esc(DESC[k] || "") + "</p>" + (b ? '<span class="sh-chip c-bad">' + esc(b) + "</span>" : "") + "</button>";
  }
  async function renderHub(id) {
    if (!hubArea) return;
    const h = hubById(id); if (!h) return;
    let html = "";
    if (h.groups) {
      h.groups.forEach((gr) => {
        const ks = gr[1].filter(avail);
        if (ks.length) html += '<h3 class="sh-group">' + esc(gr[0]) + '</h3><div class="sh-tiles">' + ks.map(tile).join("") + "</div>";
      });
      html += '<div class="sh-acct-row"><button type="button" class="ghost-btn" data-sh-logout>로그아웃</button></div>';
    } else {
      const ks = h.items.filter(avail);
      html += '<div class="sh-tiles">' + ks.map(tile).join("") + "</div>";
    }
    hubArea.innerHTML = html;
  }

  /* ---- 왼쪽 메뉴(화면을 앱처럼 바로) · 알약 탭(휴대폰) ----
   *   데스크톱: 묶음 소제목(누르면 묶음 화면) 아래에 화면들을 아이콘+이름으로 바로 꺼내 둔다. « 로 아이콘만(좁게).
   *   휴대폰: 아래 탭바(묶음 6개) + 화면 위 알약 탭. */
  const HUB_TONE = { rnd: "#0f766e", today: "#3355ff", lib: "#11914a", set: "#6b7180", admin: "#c2410c", me: "#6b7180" };
  const MENU_HUBS = () => HUBS.filter((h) => !h.mobile && hubInMode(h.id));   // 데스크톱 메뉴(왼쪽·위·트리·명령창) — 지금 모드의 묶음만
  const mobileHubs = () => ({ research: ["rnd", "me"], library: ["lib", "me"] })[mode()] || ["rnd", "me"];   // 휴대폰 아래 탭바
  function buildRail() {
    if ($("shRail")) return;
    const r = document.createElement("nav");
    r.id = "shRail"; r.className = "sh-rail side"; r.setAttribute("aria-label", "주요 메뉴");   // side: 공용 점검(RUI.audit)이 타이틀·띠를 재는 표시
    r.innerHTML = '<div class="sh-rail-head side-head"><button type="button" class="sh-rail-mark logo" data-sh-go="today" title="오늘">' + ico("i-spark") + '</button><span class="sh-rail-name side-title"></span>' +
      '<button type="button" class="sh-rail-mini" data-sh-mini title="메뉴 좁게/넓게">' + ico("sh-chevl") + "</button></div>" +
      '<div class="sh-rail-list" id="shRailList"></div>' +
      '<div class="sh-rail-hubs">' + hubsBarHtml() + "</div>";
    const shell = document.querySelector(".app-shell");
    shell.insertBefore(r, shell.firstChild);
  }
  function hubTarget(id) { return id === "today" ? "today" : "hub-" + id; }
  function railRow(k, txt, icon, hub, isOn) {
    const b = badgeOf(k);
    return '<button type="button" class="sh-ri' + (isOn ? " on" : "") + '" data-sh-go="' + k + '" title="' + esc(txt) + '" style="--hue:' + HUB_TONE[hub] + '"><span class="sh-ri-i">' + icon + '</span><span class="sh-ri-t">' + esc(txt) + "</span>" + (b ? '<i class="sh-ri-b">' + esc(b) + "</i>" : "") + "</button>";
  }
  /* (v125) 새 테마 메뉴 — 공용 RUI.navHtml·navSystem·navFit·navMark 로 그린다(세 시스템 같은 구조). 이전 테마는 아래 예전 코드 그대로 */
  const ruiNav = () => !!(window.RUIAPP && RUIAPP.on() && window.RUI && RUI.navHtml);
  /* (v131) 왼쪽 메뉴 접기는 공용 코드(RUI.sideButton·sideMark, Ctrl+B). 버튼은 위쪽 줄 맨 왼쪽. 예전 3단 접기는 이전 테마에서만 쓴다 */
  /* (v146, G13) 위쪽 띠 넘침 막기 — 띠 폭(물어보기 칸이 붙으면 줄어든다)에 맞춰 단계적으로 줄인다.
     1 모드 버튼 글자 숨김 · 2 상태 칩은 점만·뽀모도로·폭 버튼 숨김 · 3 계정 이름·역할 숨김 · 4 찾기 버튼 숨김(Ctrl+K 로) */
  const TB_LV = ["tb-t1", "tb-t2", "tb-t3", "tb-t4"];
  function fitTopbar() {
    const tb = document.querySelector(".topbar"); if (!tb || !tb.offsetWidth) return;
    const br = tb.querySelector(".sh-brand");            // (v159, G24) 브랜드 칸 표식은 보일 때만 — 왼쪽 메뉴 모드에서 숨은 브랜드를 audit 가 기준으로 잡지 않게
    if (br) br.toggleAttribute("data-rui-brand", br.getClientRects().length > 0);
    TB_LV.forEach((c) => tb.classList.remove(c));
    for (let i = 0; i < TB_LV.length && tb.scrollWidth > tb.clientWidth + 1; i++) tb.classList.add(TB_LV[i]);
  }
  // (v162) 위쪽 메뉴 세로 휠 → 가로 이동은 공용 rui-theme.js(G27, [data-rui-topbar] .nav)가 한다
  let tbRO = null;
  function watchTopbar() {
    const tb = document.querySelector(".topbar"); if (!tb || tbRO || !window.ResizeObserver) return;
    let raf = 0; tbRO = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(fitTopbar); });
    tbRO.observe(tb);
    document.addEventListener("rui:change", () => setTimeout(fitTopbar, 50));
  }
  function sideBtn() {
    const tb = document.querySelector(".topbar"); if (!tb) return;
    watchTopbar(); setTimeout(fitTopbar, 0);
    const on = ruiNav(), b = tb.querySelector("[data-rui-side-toggle]");
    tb.classList.toggle("main-bar", on && layout() === "app");   // 위쪽 메뉴 형태에서는 왼쪽 타이틀 칸이 없어 띠를 맞출 짝이 없다
    if (on && !b) tb.insertAdjacentHTML("afterbegin", RUI.sideButton()); else if (!on && b) b.remove();
    if (on) RUI.sideMark();
    sideMe(on);
    sysLinks(on);
  }
  /* (v138, G9) 시스템 바로 가기 — 공용 부품 하나(RUI.SYSTEMS). 위쪽 띠 버튼 + 왼쪽 메뉴 아래 한 줄. 위쪽 메뉴 형태에서는 띠 버튼 하나로 합쳐진다 */
  function sysLinks(on) {
    const tr = document.getElementById("topRight"), r = document.getElementById("shRail");
    if (!on || !RUI.sysButton) { document.querySelectorAll(".rui-sysbtn, .side-links.sh-sys").forEach((x) => x.remove()); if (RUI.sysClose) RUI.sysClose(); return; }
    RUI.sysInit({ self: "slc", jump: (id, win, url) => (window.HUBLINK ? HUBLINK.jumpWin(id, win, url) : window.open(url, win || "_blank")) });   // (v142, G11) 연결된 시스템은 자동 로그인
    if (tr && !tr.querySelector(".rui-sysbtn")) tr.insertAdjacentHTML("afterbegin", RUI.sysButton());
    if (r && !r.querySelector(".side-links.sh-sys")) {
      const me = r.querySelector(".side-me"), d = document.createElement("div");
      d.className = "side-links sh-sys"; d.innerHTML = RUI.sysRow();
      r.insertBefore(d, me || null);
    }
    sysState();
  }
  // 연동 상태(계정 연결된 시스템 = on)와 받은 공개 주소를 목록에 얹는다(선택)
  function sysState() {
    if (!window.RUI || !RUI.sysSet || !window.HUBLINK || !(window.SERVER && SERVER.user)) return;
    const status = {}, url = {};
    (HUBLINK.raw() || []).forEach((s) => { status[s.system] = "on"; });
    ["admin", "kanban", "aioffice", "aimgmt"].forEach((k) => { const u = HUBLINK.pub(k); if (u) url[k] = u; });
    RUI.sysSet({ self: "slc", status: status, url: url });
    // (v142, G11) 이 계정이 연결된 시스템 → 자동 로그인, 통합로그인이 켜져 있고 등록이 끝났으면 나머지는 /sso/start
    if (!sysState.busy) {
      sysState.busy = true;
      Promise.all([HUBLINK.myLinks ? HUBLINK.myLinks() : {}, fetch("api.php?r=sso&op=status", { credentials: "same-origin", cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
        fetch("api.php?r=sso&op=services", { credentials: "same-origin", cache: "no-store" }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}))]).then(([lk, ss, sv]) => {
        // (v178) G35 — 통합로그인이 준 이 계정의 서비스 접근(services)을 그대로 넘긴다. 공용 테마가 false·없는 서비스를 바로 가기에서 숨긴다(통합로그인 계정이 아니면 넘기지 않음)
        const o = { linked: lk || {}, sso: !!(ss && ss.mode && ss.mode !== "off" && ss.ready) };
        if (sv && sv.services && typeof sv.services === "object") o.services = sv.services;
        RUI.sysSet(o);
      }).finally(() => { sysState.busy = false; });
    }
  }
  /* 왼쪽 아래 계정 줄: 아바타, 이름, 역할, 화면 설정, 로그아웃(G1 5-1) */
  function sideMe(on) {
    const r = document.getElementById("shRail"); if (!r) return;
    let me = r.querySelector(".side-me");
    if (!on) { if (me) me.remove(); return; }
    const n = ((document.getElementById("userName") || {}).textContent || "").trim() || "사용자";
    const role = ((document.getElementById("userRole") || {}).textContent || "").trim() || "구성원";
    if (!me) {
      r.insertAdjacentHTML("beforeend", '<div class="side-me"><span class="avatar" aria-hidden="true"></span><div><b></b><small></small></div><button type="button" class="icon-btn" data-sh-pick aria-label="화면 설정" title="화면 설정">' + RUI.icon("gear") + '</button><button type="button" class="icon-btn" data-sh-out aria-label="로그아웃" title="로그아웃">' + RUI.icon("send") + "</button></div>");
      me = r.querySelector(".side-me");
      me.querySelector("[data-sh-pick]").onclick = () => {
        UI.drawer("화면 설정", "", '<div id="shPick"></div>');
        RUI.picker(document.getElementById("shPick"), { legacy: RUIAPP.toLegacy, unified: { linked: RUIAPP.linked || 0 } });
      };
      me.querySelector("[data-sh-out]").onclick = () => { const o = document.getElementById("logoutBtn"); if (o) o.click(); };
    }
    me.querySelector(".avatar").textContent = n.slice(0, 1);
    me.querySelector("b").textContent = n;
    me.querySelector("small").textContent = role;
  }
  document.addEventListener("rui:change", sideBtn);
  document.documentElement.addEventListener("keydown", (e) => {   // 글 쓰는 칸의 Ctrl+B 는 굵게다. 공용 단축키(document)까지 올라가지 않게 막는다
    if ((e.ctrlKey || e.metaKey) && e.key && e.key.toLowerCase() === "b" && e.target.closest && e.target.closest("input, textarea, select, [contenteditable]")) e.stopPropagation();
  });
  /* 위쪽 메뉴의 세부 카테고리. 큰 묶음을 나눠 이름을 붙이고, 세부 카테고리마다 드롭다운 하나. 모든 항목이 어느 드롭다운에 들어간다 */
  const NAV_SUBS = {
    rnd: [["과제", ["rx_dash", "rnd", "rx_tasks", "rx_proj"]], ["문서 작성", ["rx_paper", "rx_report", "rx_present"]], ["조사·심사", ["rx_lit", "rx_review", "rx_deep"]], ["회의·이력", ["rx_meet", "rndlog"]]],
    lib: [["자료", ["library", "libfolders"]], ["기억·노트", ["lx_memory", "lx_notes", "lx_plan"]], ["쓰기·대화", ["lx_write", "lx_chat", "lx_lab"]]],
    set: [["내 설정", ["settings", "security"]], ["연결", ["aiconn", "links", "rndset", "libset"]], ["도움", ["help"]]],
    admin: [["서버·계정", ["srvadmin", "sysconfig"]], ["연구지원 관리", ["rndadmin", "rndconn", "gateway", "backups"]], ["자료", ["libadmin"]]],
  };
  /* (G1) 메뉴 아이콘은 한 모드 화면 안에서 서로 다르다. 앞이 RUI.ICONS 이름, i- 로 시작하면 공용에 없어 앱 그림을 쓴 것 */
  const NAV_ICON = { rx_dash: "chart", rnd: "flask", rx_tasks: "bulb", rx_proj: "card", rx_paper: "pencil", rx_report: "report", rx_present: "layers", rx_lit: "book", rx_review: "award", rx_deep: "search", rx_meet: "calendar", rndlog: "clock",
    library: "folder", libfolders: "box", lx_memory: "cap", lx_notes: "file", lx_write: "pencil", lx_chat: "chat", lx_lab: "flask", lx_plan: "calendar",
    links: "link", aiconn: "plug", rndconn: "send", gateway: "box", srvadmin: "users", security: "shield", backups: "archive", settings: "gear", rndset: "target", libset: "target", rndadmin: "idcard", libadmin: "idcard", sysconfig: "caltask", help: "help",};
  const NAV_NAME = { srvadmin: "계정·권한" };
  const MANAGE = [["연동·AI", ["links", "aiconn", "rndconn", "gateway"]], ["운영", ["srvadmin", "security", "backups", "settings", "sysconfig", "rndset", "libset", "rndadmin", "libadmin", "help"]]];
  function navIco(k) {
    const n = NAV_ICON[k];
    if (!n) return icoOf(k);
    return n.indexOf("i-") === 0 ? '<svg class="nav-ico" aria-hidden="true"><use href="#' + n + '"></use></svg>' : RUI.icon(n);
  }
  function navGroups() {
    const out = [];
    const item = (k) => ({ key: k, label: NAV_NAME[k] || label(k), ico: navIco(k) });
    const keys = {};
    MENU_HUBS().forEach((h) => {
      if (h.id === "today") return;
      if (h.id === "set" || h.id === "admin") { h.items.forEach((k) => { keys[k] = 1; }); return; }   // 마지막 묶음 '관리' 로 모은다(G1 5-1)
      const items = h.items.filter(avail).map(item);
      if (items.length) out.push({ title: h.label, items: items, subs: (NAV_SUBS[h.id] || []).map((c) => ({ title: c[0], keys: c[1] })) });
    });
    const all = MANAGE.reduce((a, c) => a.concat(c[1]), []).filter((k) => keys[k] && avail(k));
    if (all.length) out.push({ title: "관리", items: all.map(item), subs: MANAGE.map((c) => ({ title: c[0], keys: c[1].filter((k) => all.indexOf(k) >= 0) })).filter((c) => c.keys.length) });
    return out;
  }
  function navLink(m) {
    const b = badgeOf(m.key);
    return '<a href="#/' + m.key + '" data-key="' + m.key + '" data-sh-go="' + m.key + '" title="' + esc(m.label) + '"><span class="sh-ri-i">' + (m.ico || "") + "</span><span>" + esc(m.label) + "</span>" + (b ? '<em class="count">' + b + "</em>" : "") + "</a>";
  }
  function paintNav(el, nav) {
    const y = el.scrollTop;
    let h = RUI.navHtml(navGroups(), navLink, { down: ico("sh-chevd") });
    const ext = (m, sys, lab) => '<a href="#" data-hub-jump="' + esc(sys) + '" data-to="#/' + esc(m.key) + '" title="' + esc(lab + " · " + m.label) + '"><span class="sh-ri-i" data-rui-center>' + RUI.icon(m.icon) + "</span><span>" + esc(m.label) + "</span></a>";   // (G8) 받은 아이콘 그대로
    (window.HUBLINK ? HUBLINK.raw() : []).forEach((s) => { h += RUI.navSystem(s, (m) => ext(m, s.system, s.label), { down: ico("sh-chevd") }); });
    el.innerHTML = h;
    RUI.navMark(el, nav); RUI.navFit(el); sideBtn();
    el.scrollTop = y;
  }
  let railNav = null;
  function paintRail(nav) {
    if (ruiNav()) { const r = $("shRail"), l = $("shRailList"); if (r) r.classList.add("rui"); if (l) { l.classList.add("nav"); paintNav(l, nav); } return; }
    const hub = hubOf(nav);
    const mob = ["subj", "set", "admin"].indexOf(hub) >= 0 ? "me" : hub;
    document.querySelectorAll("[data-sh-hub]").forEach((b) => b.classList.toggle("on", b.dataset.shHub === hub || b.dataset.shHub === mob));
    const list = $("shRailList"); if (!list) return;
    const closed = lsGet(LS.rail, {});
    // 다른 화면으로 옮겨 갔는데 그 화면의 묶음이 접혀 있으면 펼친다(직접 접은 건 그대로 둔다)
    if (nav !== railNav) {
      MENU_HUBS().forEach((h) => { if (closed[h.id] && h.items.indexOf(nav) >= 0) { closed[h.id] = false; lsSet(LS.rail, closed); } });
      railNav = nav;
    }
    const y = list.scrollTop;
    let html = "";
    MENU_HUBS().forEach((h) => {
      if (h.id === "today") return;
      const ks = h.items.filter(avail); if (!ks.length) return;
      const shut = !!closed[h.id];
      html += '<div class="sh-rg' + (shut ? " closed" : "") + '"><div class="sh-rg-h"><button type="button" class="sh-rg-t' + (nav === "hub-" + h.id ? " on" : "") + '" data-sh-go="hub-' + h.id + '" title="' + esc(h.label) + ' 한눈에 보기">' + esc(h.label) + "</button>" +
        '<button type="button" class="sh-rg-x" data-sh-rg="' + h.id + '" aria-label="' + esc(h.label) + ' 펼치기/접기" aria-expanded="' + !shut + '">' + ico("sh-chevd") + "</button></div>" +
        '<div class="sh-rg-b">' + ks.map((k) => railRow(k, label(k), icoOf(k), h.id, k === nav)).join("") + "</div></div>";
    });
    (window.HUBLINK ? HUBLINK.menus() : []).forEach((s) => {   // (v120) 통합 메뉴 — 다른 시스템 묶음
      const id = "ext-" + s.system, shut = !!closed[id];
      html += '<div class="sh-rg' + (shut ? " closed" : "") + '"><div class="sh-rg-h"><span class="sh-rg-t">' + esc(s.label + (s.reachable ? "" : " · 응답 없음")) + '</span><button type="button" class="sh-rg-x" data-sh-rg="' + id + '" aria-label="' + esc(s.label) + ' 펼치기/접기" aria-expanded="' + !shut + '">' + ico("sh-chevd") + '</button></div><div class="sh-rg-b">' +
        s.items.map((m) => '<button type="button" class="sh-ri" data-hub-jump="' + esc(s.system) + '" data-to="#/' + esc(m.key) + '" title="' + esc(s.label + " · " + m.label) + '"><span class="sh-ri-i">↗</span><span class="sh-ri-t">' + esc(m.label) + "</span></button>").join("") + "</div></div>";
    });
    list.innerHTML = html;
    list.scrollTop = y;
    const act = list.querySelector(".sh-ri.on");
    if (act) { const a = act.getBoundingClientRect(), l = list.getBoundingClientRect(); if (a.top < l.top || a.bottom > l.bottom) list.scrollTop += a.top - l.top - l.height / 3; }
  }
  /* 왼쪽 메뉴 모양 — list(목록, 넓게) · rail(아이콘 아래 이름, 세로 레일) · icon(아이콘만) */
  const MENU_MODES = [["list", "목록"], ["rail", "아이콘+이름"], ["icon", "아이콘만"]];
  function menuMode() {
    const m = lsGet(LS.menu, null);
    if (m === "list" || m === "rail" || m === "icon") return m;
    return lsGet(LS.mini, false) ? "icon" : "list";   // 예전 '좁게' 설정 이어받기
  }
  function setMenu(m, keep) {
    if ((m !== "rail" && m !== "icon") || ruiNav()) m = "list";
    const app = layout() === "app";
    document.body.classList.toggle("sh-mini", app && m === "icon");
    document.body.classList.toggle("sh-railm", app && m === "rail");
    if (!keep) lsSet(LS.menu, m);
    const b = document.querySelector("[data-sh-mini]");
    if (b) b.title = "메뉴 모양 바꾸기 — 지금: " + (MENU_MODES.filter((x) => x[0] === m)[0] || MENU_MODES[0])[1];
    paintSettingsExt();
  }

  /* 설정 화면에 두 줄 덧붙이기 — 왼쪽 메뉴 모양 · AI 물어보기 표시 방식 */
  function buildSettingsExt() {
    if ($("shSetMenuRow")) return;
    const lay = $("setLayoutSeg"), row = lay && lay.closest(".set-row");
    if (!row) return;
    const mk = (id, label, desc, segId, attr, opts) => {
      const r = document.createElement("div");
      r.className = "set-row"; r.id = id;
      r.innerHTML = '<span class="set-label">' + label + '<br><span class="set-desc" style="margin:0">' + desc + '</span></span><div class="seg" id="' + segId + '">' +
        opts.map((o) => '<button type="button" class="seg-btn" ' + attr + '="' + o[0] + '">' + o[1] + "</button>").join("") + "</div>";
      return r;
    };
    const askRow = mk("shSetAskRow", "AI 물어보기", "넓은 화면(1280px 이상)에서 — 오른쪽에 늘 펼쳐 두거나, 오른쪽 아래 떠 있는 버튼으로 필요할 때만 열기", "shAskSeg", "data-sha", [["dock", "오른쪽에 펼쳐 두기"], ["fab", "떠 있는 버튼"]]);
    const menuRow = mk("shSetMenuRow", "왼쪽 메뉴 모양", "목록(아이콘+이름 가로) · 아이콘 아래 이름(세로 레일) · 아이콘만. 메뉴 위 « 버튼으로도 바꿔요", "shMenuSeg", "data-shm", MENU_MODES);
    row.parentNode.insertBefore(askRow, row.nextSibling);
    row.parentNode.insertBefore(menuRow, row.nextSibling);
    paintSettingsExt();
  }
  function paintSettingsExt() {
    const m = menuMode(), d = lsGet(LS.dock, true) ? "dock" : "fab";
    document.querySelectorAll("#shMenuSeg [data-shm]").forEach((b) => b.classList.toggle("active", b.dataset.shm === m));
    document.querySelectorAll("#shAskSeg [data-sha]").forEach((b) => b.classList.toggle("active", b.dataset.sha === d));
  }
  function paintSubnav(nav) {
    let sn = $("shSubnav");
    const content = document.querySelector("main.content");
    if (!sn && content) { sn = document.createElement("nav"); sn.id = "shSubnav"; sn.className = "sh-subnav"; content.insertBefore(sn, content.firstChild); }
    if (!sn) return;
    const hub = hubOf(nav), h = hubById(hub);
    const inItem = h && h.id !== "today" && String(nav).indexOf("hub-") !== 0;
    if (!isApp() || !inItem) { sn.classList.add("hidden"); sn.innerHTML = ""; return; }
    const ks = h.items.filter(avail);
    sn.classList.remove("hidden");
    sn.innerHTML = '<button type="button" class="sh-sub-hub" data-sh-go="hub-' + h.id + '">' + esc(h.label) + "</button>" +
      ks.map((k) => '<button type="button" class="sh-pill' + (k === nav ? " on" : "") + '" data-sh-go="' + k + '">' + esc(label(k)) + (badgeOf(k) ? " <i>" + esc(badgeOf(k)) + "</i>" : "") + "</button>").join("");
    const act = sn.querySelector(".sh-pill.on");
    if (act && act.scrollIntoView) { try { act.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch (e) { /* 계속 */ } }
  }
  function setFocus(v) {
    document.body.classList.toggle("sh-focus", !!v);
    lsSet(LS.focus, !!v);
    const b = $("shFocusBtn"); if (b) b.setAttribute("aria-pressed", v ? "true" : "false");
  }

  /* ================================================================== *
   * 커맨드 센터형 — 트리 · 탭 · 오른쪽 패널 · 상태줄
   * ================================================================== */
  function buildCommand() {
    if ($("shTree")) return;
    const shell = document.querySelector(".app-shell");
    const t = document.createElement("nav"); t.id = "shTree"; t.className = "sh-tree"; t.setAttribute("aria-label", "탐색");
    const tabs = document.createElement("div"); tabs.id = "shTabs"; tabs.className = "sh-tabs"; tabs.setAttribute("role", "tablist");
    const insp = document.createElement("aside"); insp.id = "shInsp"; insp.className = "sh-insp";
    insp.innerHTML = '<div class="sh-itabs" id="shItabs"></div><div class="sh-ibody" id="shIbody"></div>';
    const st = document.createElement("footer"); st.id = "shStatus"; st.className = "sh-status";
    const scrim = document.createElement("div"); scrim.className = "sh-tree-scrim"; scrim.addEventListener("click", () => document.body.classList.remove("sh-tree-open"));
    [t, tabs, insp, st, scrim].forEach((n) => shell.appendChild(n));
  }
  function paintTree() {
    const t = $("shTree"); if (!t) return;
    const closed = lsGet(LS.tree, {});
    const cur = state.nav;
    let html = "";
    MENU_HUBS().forEach((h) => {
      const ks = h.id === "today" ? [] : h.items.filter(avail);
      if (!ks.length) return;
      html += '<div class="sh-sec' + (closed[h.id] ? " closed" : "") + '"><button type="button" class="sh-sec-h" data-sh-sec="' + h.id + '">' + ico("sh-chevd") + esc(h.label) + "</button><div class=\"sh-sec-b\">" +
        ks.map((k) => '<button type="button" class="sh-node' + (k === cur ? " on" : "") + '" data-sh-go="' + k + '">' + icoOf(k) + "<span>" + esc(label(k)) + "</span></button>").join("") + "</div></div>";
    });
    t.innerHTML = html;
  }
  // 예전 홈(home)은 탭에 두지 않는다 — 시작할 때 잠깐 거쳐 가는 자리라서
  function tabsList() { return lsGet(LS.tabs, []).filter((k) => k !== "home" && (k === "today" || String(k).indexOf("hub-") === 0 || avail(k))); }
  function paintTabs(nav) {
    const el = $("shTabs"); if (!el) return;
    let list = tabsList();
    if (nav && nav !== "home" && list.indexOf(nav) < 0) { list.push(nav); if (list.length > 9) list = list.filter((k, i) => k === nav || i >= list.length - 9); }
    lsSet(LS.tabs, list);
    el.innerHTML = list.map((k) => '<div class="sh-tab' + (k === nav ? " on" : "") + '" role="tab" aria-selected="' + (k === nav) + '" data-sh-go="' + k + '">' + (k === "today" ? ico("i-home", "nav-ico") : String(k).indexOf("hub-") === 0 ? ico((hubById(k.slice(4)) || {}).ico || "i-spark", "nav-ico") : icoOf(k)) + "<span>" + esc(label(k)) + '</span><button type="button" class="sh-tab-x" data-sh-close="' + k + '" title="탭 닫기" aria-label="탭 닫기">' + ico("sh-x") + "</button></div>").join("") +
      '<button type="button" class="sh-tab-add" data-sh-pal title="화면 열기 (Ctrl+K)">' + ico("sh-search") + "</button>";
    const act = el.querySelector(".sh-tab.on");
    if (act && act.scrollIntoView) { try { act.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch (e) { /* 계속 */ } }
  }
  function closeTab(k) {
    let list = tabsList(); const i = list.indexOf(k);
    list = list.filter((x) => x !== k); lsSet(LS.tabs, list);
    if (k === state.nav) navTo(list[Math.max(0, i - 1)] || "today");
    else paintTabs(state.nav);
  }
  function paintInsp() {
    const tabsEl = $("shItabs"), body = $("shIbody"); if (!tabsEl || !body) return;
    tabsEl.innerHTML = '<button type="button" class="sh-ask" data-sh-ask title="물어보기 (Alt+A)">' + ico("i-spark") + " 물어보기</button>";
    body.innerHTML = '<div class="sh-blk"><h5>지금 화면</h5><p>' + esc(label(state.nav)) + '</p><p class="sh-muted">Ctrl+K 로 메뉴·프로젝트·문서를 찾고, Alt+A 로 이 화면에 대해 AI 에게 물어요.</p></div>';
  }
  function paintStatus() {
    const st = $("shStatus"); if (!st) return;
    const txt = ($("statusText") || {}).textContent || "", model = ($("statusModel") || {}).textContent || "";
    const dot = $("statusDot"), ok = dot && dot.classList.contains("ok");
    st.innerHTML = '<button type="button" data-sh-go="settings"><span class="dot ' + (ok ? "ok" : dot && dot.classList.contains("bad") ? "bad" : "") + '"></span>' + esc(txt) + (model ? " · " + esc(model) : "") + "</button>" +
      '<span class="sh-grow"></span><button type="button" data-sh-pal>' + ico("sh-cmd") + " Ctrl+K 명령</button><span>Alt+A 물어보기</span>";
  }
  function setInsp(open) {
    document.body.classList.toggle("sh-noinsp", !open);
    lsSet(LS.insp, !!open);
  }

  /* ================================================================== *
   * 학습 앱형(위 메뉴) — 첫 줄 묶음 메뉴(누르면 앱 카드 펼침) · 둘째 줄 지금 묶음의 화면 칩
   * ================================================================== */
  const QUICK_TODAY = ["rx_dash", "rnd", "library", "settings"];
  function paintTopMenu(nav) {
    const m = $("shHubMenu"), sub = $("shTopSub");
    if (!m || !sub) return;
    if (ruiNav()) { const tb = document.querySelector(".topbar"); if (tb) tb.classList.add("rui"); m.classList.add("nav"); sub.innerHTML = ""; paintNav(m, nav); return; }
    const hub = hubOf(nav);
    m.innerHTML = '<button type="button" class="sh-hm' + (hub === "today" ? " on" : "") + '" data-sh-go="today" style="--hue:' + HUB_TONE.today + '">' + ico("i-home") + "<span>오늘</span></button>" +
      MENU_HUBS().filter((h) => h.id !== "today" && h.items.some(avail)).map((h) => {
        const n = h.items.filter((k) => avail(k) && badgeOf(k)).length;
        return '<button type="button" class="sh-hm' + (hub === h.id ? " on" : "") + '" data-sh-mega="' + h.id + '" aria-haspopup="true" aria-expanded="false" style="--hue:' + HUB_TONE[h.id] + '">' + ico(h.ico) + "<span>" + esc(h.label) + "</span>" + (n ? '<i class="sh-hm-dot"></i>' : "") + ico("sh-chevd", "sh-hm-cv") + "</button>";
      }).join("") + (window.HUBLINK ? HUBLINK.menus() : []).map((s) => '<button type="button" class="sh-hm" data-sh-mega="ext-' + esc(s.system) + '" aria-haspopup="true" aria-expanded="false">' + "<span>" + esc(s.label) + "</span></button>").join("");
    const h = hubById(hub);
    const home = hub === "today" || !h;
    const ks = home ? QUICK_TODAY.filter(avail) : h.items.filter(avail);
    sub.innerHTML = '<button type="button" class="sh-ts-h" data-sh-go="' + (home ? "today" : "hub-" + h.id) + '">' + esc(home ? "자주 쓰는 화면" : h.label) + "</button>" +
      ks.map((k) => { const hh = hubOf(k); return railRow(k, label(k), icoOf(k), hh && HUB_TONE[hh] ? hh : "today", k === nav).replace('class="sh-ri', 'class="sh-chipapp sh-ri'); }).join("");
    const act = sub.querySelector(".sh-ri.on");
    if (act) { const a = act.getBoundingClientRect(), r = sub.getBoundingClientRect(); if (a.left < r.left || a.right > r.right) sub.scrollLeft += a.left - r.left - 40; }
  }
  let MEGA = null, megaHub = null;
  function megaOpen(id, btn) {
    const ext = String(id).indexOf("ext-") === 0 && window.HUBLINK ? HUBLINK.menus().filter((s) => "ext-" + s.system === id)[0] : null;
    const h = hubById(id); if (!h && !ext) return;
    if (!MEGA) { MEGA = document.createElement("div"); MEGA.id = "shMega"; MEGA.className = "sh-mega hidden"; document.body.appendChild(MEGA); }
    if (megaHub === id && !MEGA.classList.contains("hidden")) { megaClose(); return; }
    megaHub = id;
    const ks = ext ? ext.items : h.items.filter(avail);
    MEGA.style.setProperty("--hue", HUB_TONE[id] || "var(--accent)");
    MEGA.innerHTML = ext ? '<div class="sh-mega-h"><b>' + esc(ext.label + (ext.reachable ? "" : " · 응답 없음")) + '</b></div><div class="sh-mega-g">' + ext.items.map((m) => '<button type="button" class="sh-mega-it" data-hub-jump="' + esc(ext.system) + '" data-to="#/' + esc(m.key) + '"><span class="sh-ri-i">↗</span><span><b>' + esc(m.label) + "</b></span></button>").join("") + "</div>" : '<div class="sh-mega-h"><b>' + esc(h.label) + '</b><button type="button" class="sh-link" data-sh-go="hub-' + id + '">한눈에 보기 →</button></div><div class="sh-mega-g">' +
      ks.map((k) => '<button type="button" class="sh-mega-it' + (k === state.nav ? " on" : "") + '" data-sh-go="' + k + '" style="--hue:' + HUB_TONE[id] + '"><span class="sh-ri-i">' + icoOf(k) + "</span><span><b>" + esc(label(k)) + (badgeOf(k) ? ' <i class="sh-ri-b">' + esc(badgeOf(k)) + "</i>" : "") + "</b><small>" + esc(DESC[k] || "") + "</small></span></button>").join("") + "</div>";
    MEGA.classList.remove("hidden");
    const b = btn.getBoundingClientRect(), w = Math.min(ks.length > 4 ? 600 : 420, window.innerWidth - 24);
    MEGA.style.width = w + "px";
    MEGA.style.top = Math.round(b.bottom + 8) + "px";
    MEGA.style.left = Math.max(12, Math.min(window.innerWidth - w - 12, Math.round(b.left - 12))) + "px";
    document.querySelectorAll("[data-sh-mega]").forEach((x) => x.setAttribute("aria-expanded", x === btn ? "true" : "false"));
  }
  function megaClose() { if (MEGA) MEGA.classList.add("hidden"); megaHub = null; document.querySelectorAll("[data-sh-mega]").forEach((x) => x.setAttribute("aria-expanded", "false")); }

  /* ================================================================== *
   * AI 붙박이 — 넓은 화면의 학습 앱형에선 물어보기를 오른쪽에 늘 펼쳐 둔다(닫으면 기억)
   *   app.js askSetOpen·toolsSetOpen 을 감싸 사용자가 닫았는지 기억한다(대화 화면·학습 도구로 잠시 닫힌 건 제외).
   * ================================================================== */
  let dockAuto = false;
  const dockWide = () => window.innerWidth >= 1280;
  function setDock(v) {
    lsSet(LS.dock, !!v);
    setTimeout(paintSettingsExt, 0);
    if (v) ensureDock(state.nav, true);
    else if (askState.open) { dockAuto = true; try { askSetOpen(false); } finally { dockAuto = false; } }
  }
  // (v116) 화면 안에 자기 AI 대화가 있는 곳 — 붙박이 물어보기 칸을 접는다(사용자가 직접 꺼내면 그 화면에 있는 동안은 그대로)
  const OWN_AI = { rnd: 1, rx_paper: 1, rx_report: 1, rx_present: 1, lx_chat: 1 };
  let askManualNav = null;
  function ensureDock(nav, force) {
    if (typeof askState === "undefined") return;
    if (OWN_AI[nav]) {
      if (askState.open && askManualNav !== nav) { dockAuto = true; try { askSetOpen(false); } finally { dockAuto = false; } }
      return;
    }
    askManualNav = null;
    if (!isApp() || askState.open) return;
    if (!lsGet(LS.dock, true) || !dockWide()) return;
    if (document.body.classList.contains("auth-visible")) return;
    if (!force && document.body.classList.contains("sh-focus")) return;
    const ae = document.activeElement;
    dockAuto = true;
    try { askSetOpen(true); } finally { dockAuto = false; }
    // 붙박이로 펼칠 땐 입력칸이 포커스를 가져가지 않게(문제 풀이 1~4 키가 그대로 동작)
    try { if (ak.input && document.activeElement === ak.input) { ak.input.blur(); if (ae && ae !== document.body && ae.focus) ae.focus(); } } catch (e) { /* 계속 */ }
  }
  const origAskOpen = window.askSetOpen;
  if (typeof origAskOpen === "function") {
    window.askSetOpen = function (v) {
      const r = origAskOpen.apply(this, arguments);
      const toolsOn = false;
      if (!dockAuto && OWN_AI[state.nav]) { askManualNav = v ? state.nav : null; return r; }   // 자체 AI 화면에서 열고 닫은 것은 붙박이 설정을 바꾸지 않는다
      if (!dockAuto && isApp() && dockWide() && !toolsOn) lsSet(LS.dock, !!v);
      return r;
    };
  }
  let dockT = null;
  window.addEventListener("resize", () => { clearTimeout(dockT); dockT = setTimeout(() => { if (on()) ensureDock(state.nav); }, 300); });

  /* ================================================================== *
   * 공통 — 위 막대 버튼 · 명령창 · 계정 드롭다운
   * ================================================================== */
  function buildTop() {
    const top = document.querySelector(".topbar");
    if (!top || $("shSearch")) return;
    const brand = document.createElement("button");
    brand.type = "button"; brand.id = "shBrand"; brand.className = "sh-brand"; brand.dataset.shGo = "today"; brand.setAttribute("data-rui-brand", "");   // (v159, G24) 공용 audit 가 위쪽 띠 브랜드 칸으로 잰다
    brand.innerHTML = '<span class="sh-brand-m">' + ico("i-spark") + '</span><span class="sh-brand-t"></span>';
    const tree = document.createElement("button");
    tree.type = "button"; tree.id = "shTreeBtn"; tree.className = "sh-topbtn sh-only-cmd"; tree.title = "탐색 트리"; tree.innerHTML = ico("sh-tree");
    tree.addEventListener("click", () => document.body.classList.toggle("sh-tree-open"));
    const search = document.createElement("button");
    search.type = "button"; search.id = "shSearch"; search.className = "sh-search"; search.dataset.shPal = "1";
    search.innerHTML = ico("sh-search") + "<span>메뉴·명령 검색</span><kbd>Ctrl K</kbd>";
    const focus = document.createElement("button");
    focus.type = "button"; focus.id = "shFocusBtn"; focus.className = "sh-topbtn sh-only-app"; focus.title = "집중 모드 — 메뉴를 숨기고 화면만 (Esc 로 나가기)"; focus.innerHTML = ico("sh-focus");
    focus.addEventListener("click", () => setFocus(!document.body.classList.contains("sh-focus")));
    const insp = document.createElement("button");
    insp.type = "button"; insp.id = "shInspBtn"; insp.className = "sh-topbtn sh-only-cmd"; insp.title = "오른쪽 패널(모델·오늘)"; insp.innerHTML = ico("sh-panel");
    insp.addEventListener("click", () => setInsp(document.body.classList.contains("sh-noinsp")));
    const hubs = document.createElement("nav");
    hubs.id = "shHubMenu"; hubs.className = "sh-hubmenu"; hubs.setAttribute("aria-label", "주요 메뉴");
    const sub = document.createElement("div");
    sub.id = "shTopSub"; sub.className = "sh-topsub";
    top.insertBefore(tree, top.firstChild);
    const modeEl = document.createElement("div");
    modeEl.id = "shMode"; modeEl.className = "sh-mode"; modeEl.setAttribute("role", "tablist"); modeEl.setAttribute("aria-label", "작업 모드");
    modeEl.innerHTML = MODES.map((m) => '<button type="button" data-sh-mode="' + m[0] + '" title="' + m[2] + '"><span class="sh-mode-e">' + m[1] + '</span><span class="sh-mode-t">' + m[2] + "</span></button>").join("");
    modeEl.addEventListener("click", (e) => { const b = e.target.closest("[data-sh-mode]"); if (b) setMode(b.dataset.shMode, true); });
    top.insertBefore(brand, tree.nextSibling);
    top.insertBefore(modeEl, brand.nextSibling);
    top.insertBefore(hubs, modeEl.nextSibling);
    paintMode();
    top.appendChild(sub);
    const right = $("topRight");
    top.insertBefore(search, right);
    top.insertBefore(focus, right);
    top.appendChild(insp);
  }
  function paintBrand() {
    let name = "ScholarFlow"; try { name = brandTitleText(); } catch (e) { /* 기본값 */ }
    document.querySelectorAll(".sh-brand-t, .sh-rail-name").forEach((t) => { t.textContent = name; });
  }

  // 명령창
  let PAL = null, palSel = 0, palList = [];
  /* (v122) 명령창에서 프로젝트·문서도 찾는다. 창을 열 때 한 번 읽고, 못 읽으면 메뉴만 보인다 */
  let PAL_DATA = [];
  async function palLoad() {
    if (!window.RND || !RND.ws) return;
    try {
      const ps = ((await RND.ws.req("projects")).list || []).filter((p) => !p.archived), out = [];
      ps.forEach((p) => out.push({ g: "프로젝트", t: p.name, fn: () => { location.hash = "#/p/" + p.id; }, kw: "project 프로젝트 " + (p.goal || ""), ico: ico("i-flask", "nav-ico") }));
      const cur = [RND.cur && RND.cur(), window.TK ? TK.store.get("hub.rnd", "") : ""].filter((x, i, l) => x && l.indexOf(x) === i && ps.some((p) => p.id === x));   // 지금 프로젝트의 문서만
      for (const pid of cur) { const ds = (await RND.ws.req("docs", { pid: pid })).list || []; ds.slice(0, 80).forEach((d) => out.push({ g: "문서", t: d.title, fn: () => { location.hash = "#/p/" + pid + "/report/" + d.id; }, kw: "doc 문서 보고서", ico: ico("i-spark", "nav-ico") })); }
      PAL_DATA = out;
      const inp = $("shPalIn"); if (inp && PAL && !PAL.classList.contains("hidden")) palRender(inp.value, true);
    } catch (e) { /* 메뉴만 보여 준다 */ }
  }
  function palItems() {
    const it = [];
    MODES.forEach((m) => { if (m[0] !== mode() && allowedModes().indexOf(m[0]) >= 0) it.push({ g: "모드", t: m[1] + " " + m[2] + " 모드로", fn: () => setMode(m[0], true), kw: "mode 모드 전환 " + m[2], ico: ico("i-spark", "nav-ico") }); });
    MENU_HUBS().forEach((h) => {
      if (h.id === "today") return;
      const ks = h.items.filter(avail); if (!ks.length) return;
      it.push({ g: "이동", t: h.label + " (묶음)", k: "hub-" + h.id, ico: ico(h.ico, "nav-ico"), kw: ks.map(label).join(" ") });
      ks.forEach((k) => it.push({ g: h.label, t: label(k), k: k, ico: icoOf(k), kw: DESC[k] || "" }));
    });
    PAL_DATA.forEach((x) => it.push(x));
    const dark = document.documentElement.getAttribute("data-mode") === "dark";
    const C = (t, fn, kw, i) => it.push({ g: "명령", t: t, fn: fn, kw: kw || "", ico: ico(i || "sh-cmd", "nav-ico") });
    C(dark ? "라이트 모드로" : "다크 모드로", () => setDisplay({ mode: dark ? "light" : "dark" }), "테마 화면 밝기 dark light");
    C("레이아웃: 학습 앱형(왼쪽 메뉴)", () => setDisplay({ layout: "app" }), "layout 레일 세로");
    C("레이아웃: 학습 앱형(위 메뉴)", () => setDisplay({ layout: "apptop" }), "layout 가로 탑메뉴");
    C("AI 물어보기: 오른쪽에 펼쳐 두기", () => setDock(true), "dock 물어보기 ai 붙박이");
    C("AI 물어보기: 떠 있는 버튼", () => setDock(false), "fab 물어보기 ai 버튼");
    if (!ruiNav()) MENU_MODES.forEach((x) => C("왼쪽 메뉴 모양: " + x[1], () => setMenu(x[0]), "menu 메뉴 레일 아이콘"));
    if (!(window.RUIAPP && RUIAPP.on())) C("레이아웃: 커맨드 센터형", () => setDisplay({ layout: "command" }), "layout 트리 탭 패널");
    if (!(window.RUIAPP && RUIAPP.on())) C("레이아웃: 클래식 사이드바", () => setDisplay({ layout: "sidebar" }), "layout");
    if (!(window.RUIAPP && RUIAPP.on())) C("레이아웃: 클래식 탑메뉴", () => setDisplay({ layout: "topnav" }), "layout");
    [["wide", "와이드"], ["mid", "중간"], ["short", "일반"]].forEach((w) => C("내용 폭: " + w[1], () => setDisplay({ width: w[0] }), "width 폭"));
    if (typeof askToggle === "function") C("AI 에게 물어보기", () => askToggle(), "ask 질문 alt+a", "i-spark");
    if (isApp()) C("집중 모드 켜기/끄기", () => setFocus(!document.body.classList.contains("sh-focus")), "focus 몰입");
    if (layout() === "command") C("오른쪽 패널 열기/닫기", () => setInsp(document.body.classList.contains("sh-noinsp")), "inspector 모델");
    return it;
  }
  function palOpen() {
    if (!PAL) {
      PAL = document.createElement("div");
      PAL.id = "shPal"; PAL.className = "sh-pal-bg hidden";
      PAL.innerHTML = '<div class="sh-pal" role="dialog" aria-label="명령창"><input id="shPalIn" type="text" placeholder="메뉴·명령·프로젝트·문서 검색" autocomplete="off"><div class="sh-pal-res" id="shPalRes" role="listbox"></div><div class="sh-pal-ft"><span>↑↓ 이동</span><span>Enter 열기</span><span>Esc 닫기</span></div></div>';
      document.body.appendChild(PAL);
      PAL.addEventListener("mousedown", (e) => { if (e.target === PAL) palClose(); });
      const inp = $("shPalIn");
      inp.addEventListener("input", () => { palSel = 0; palRender(inp.value); });
      inp.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown") { e.preventDefault(); palSel = Math.min(palList.length - 1, palSel + 1); palRender(inp.value, true); }
        else if (e.key === "ArrowUp") { e.preventDefault(); palSel = Math.max(0, palSel - 1); palRender(inp.value, true); }
        else if (e.key === "Enter") { e.preventDefault(); palRun(palList[palSel]); }
        else if (e.key === "Escape") { e.preventDefault(); palClose(); }
      });
      $("shPalRes").addEventListener("click", (e) => { const b = e.target.closest("[data-pi]"); if (b) palRun(palList[+b.dataset.pi]); });
    }
    PAL.classList.remove("hidden");
    const inp = $("shPalIn"); inp.value = ""; palSel = 0; palRender(""); setTimeout(() => inp.focus(), 0);
    palLoad();
  }
  function palClose() { if (PAL) PAL.classList.add("hidden"); }
  function palRender(q, keep) {
    const qq = String(q || "").trim().toLowerCase().replace(/\s+/g, "");
    const all = palItems();
    const norm = (v) => String(v || "").toLowerCase().replace(/\s+/g, "");
    // 제목에 맞는 것 먼저(같은 그룹끼리 모아서), 설명·그룹명에만 맞는 것은 뒤로
    palList = qq ? all.filter((x) => norm(x.t).indexOf(qq) >= 0).concat(all.filter((x) => norm(x.t).indexOf(qq) < 0 && norm(x.g + (x.kw || "")).indexOf(qq) >= 0))
      : all.filter((x) => x.g === "이동" || x.g === "명령");
    palSel = Math.min(palSel, Math.max(0, palList.length - 1));
    let g = "";
    $("shPalRes").innerHTML = palList.map((x, i) => { const head = x.g !== g ? '<div class="sh-pal-g">' + esc((g = x.g)) + "</div>" : ""; return head + '<button type="button" class="sh-pal-it' + (i === palSel ? " sel" : "") + '" data-pi="' + i + '" role="option">' + x.ico + "<span>" + esc(x.t) + "</span>" + (x.k && DESC[x.k] ? "<small>" + esc(DESC[x.k]) + "</small>" : "") + "</button>"; }).join("") || '<p class="sh-muted" style="padding:14px">찾는 메뉴·명령이 없어요.</p>';
    if (keep) { const s = $("shPalRes").querySelector(".sel"); if (s) s.scrollIntoView({ block: "nearest" }); }
  }
  function palRun(x) { if (!x) return; palClose(); if (x.fn) x.fn(); else if (x.k) navTo(x.k); }
  function logout() { const b = $("logoutBtn"); if (b) b.click(); }

  /* ================================================================== *
   * 연결 — navTo · setActiveNav · navTitle · saveProgress 감싸기
   * ================================================================== */
  let ready = false, forceHome = false, rTimer = null;
  const origNav = window.navTo;
  window.navTo = function (nav) {
    const args = Array.prototype.slice.call(arguments);
    if (!ready) { migrate(); ready = true; setTimeout(schedule, 2500); }
    if (nav === "home" && on() && !forceHome) args[0] = "today";
    // (v93) 연구지원·자료 학습 모드에서 '오늘/홈'은 들어가기 전에 그 모드의 첫 화면으로 바꾼다
    //   (예전엔 setActiveNav→syncNav 안에서 다시 이동해, 바깥 이동이 끝나며 '오늘' 화면이 위에 그려졌다)
    if ((args[0] === "today" || args[0] === "home") && on()) args[0] = modeOf(mode())[4];
    if ((nav === "today" || String(nav).indexOf("hub-") === 0) && !on()) args[0] = "home";
    forceHome = false;
    return origNav.apply(this, args);
  };
  const origTitle = window.navTitle;
  window.navTitle = function (nav) {
    if (nav === "today") return "오늘";
    if (EXTRA[nav]) return EXTRA[nav].label;
    if (String(nav).indexOf("hub-") === 0) { const h = hubById(nav.slice(4)); if (h) return h.label; }
    return origTitle.apply(this, arguments);
  };
  const origActive = window.setActiveNav;
  window.setActiveNav = function (nav) {
    const r = origActive.apply(this, arguments);
    try { syncNav(nav); } catch (e) { console.error("shell", e); }
    return r;
  };
  function syncNav(nav) {
    if (!on()) return;
    // 연구지원·자료 학습 모드에서 '오늘'(부팅 기본 화면·브랜드 버튼)은 그 모드의 첫 화면으로
    // (v111) 부팅 중에는 옮기지 않는다 — 화면 등록 전에 navTo 하면 홈이 그려진다(첫 화면은 startApp 이 고른다)
    if (nav === "today" || nav === "home") { if (document.body.classList.contains("booting")) return; navTo(modeOf(mode())[4]); return; }
    // 다른 모드의 화면으로 바로 왔으면(명령창·링크·오늘 카드) 그 모드로 조용히 넘어간다('오늘'은 모드를 바꾸지 않는다)
    const hid = hubOf(nav); const hm = hid && hid !== "today" ? modeOfHub(hid) : null;
    if (hm && allowedModes().indexOf(hm) < 0) { if (!document.body.classList.contains("booting")) navTo(modeOf(mode())[4]); return; }   // (v143) 권한 없는 기능의 화면 → 내 첫 화면
    if (hm && hm !== mode()) { putMode(hm); paintMode(); try { window.dispatchEvent(new CustomEvent("study:mode", { detail: hm })); } catch (e) { /* 계속 */ } const bar = document.querySelector(".sh-rail-hubs"); if (bar) bar.innerHTML = hubsBarHtml(); }
    paintRail(nav);
    paintSubnav(nav);
    if (layout() === "apptop") paintTopMenu(nav);
    else { const hm0 = $("shHubMenu"); if (hm0 && hm0.childElementCount) hm0.innerHTML = ""; }   // (v144) 왼쪽 메뉴일 때 숨은 위쪽 메뉴에 옛 모드 항목이 남지 않게
    if (nav === "settings") { buildSettingsExt(); paintSettingsExt(); }
    megaClose();
    ensureDock(nav);
    if (layout() === "command") {
      paintTabs(nav);
      document.querySelectorAll("#shTree .sh-node[data-sh-go]").forEach((n) => n.classList.toggle("on", n.dataset.shGo === nav));
    }
    schedule();
  }
  function schedule() {
    if (!on()) return;
    clearTimeout(rTimer);
    rTimer = setTimeout(refresh, 250);
  }
  async function refresh() {
    if (!on()) return;
    paintBrand();
    if (layout() === "command") { paintTree(); paintInsp(); paintStatus(); }
  }

  /* 레이아웃 적용(app.js applyLayoutStructure 가 부른다) */
  function apply(L) {
    const isNew = NEW.indexOf(L) >= 0;
    if (isNew) document.documentElement.setAttribute("data-shell", isApp(L) ? "app" : "command"); else document.documentElement.removeAttribute("data-shell");
    megaClose();
    document.body.classList.toggle("sh-on", isNew);
    if (isNew) {
      areas(); buildTop(); buildRail(); buildCommand(); paintBrand();
      if (isApp(L)) { setFocus(lsGet(LS.focus, false)); setMenu(menuMode(), true); } else document.body.classList.remove("sh-focus", "sh-mini");
      document.body.classList.toggle("sh-dock", isApp(L));
      if (L === "command") setInsp(lsGet(LS.insp, true));
      document.body.classList.remove("sh-tree-open");
    } else {
      document.body.classList.remove("sh-focus", "sh-noinsp", "sh-tree-open", "sh-mini", "sh-railm", "sh-dock");
      const cx = $("shCtx"); if (cx) cx.classList.add("hidden");   // 클래식엔 보드를 붙이지 않는다
    }
    if (!ready || typeof state === "undefined") return;
    if (isNew && state.nav === "home") navTo("today");
    else if (!isNew && (state.nav === "today" || String(state.nav).indexOf("hub-") === 0)) navTo("home");
    else if (isNew) syncNav(state.nav);
  }
  /* 기본 레이아웃을 학습 앱형으로 — 이 브라우저에서 한 번만(그 뒤 직접 고른 레이아웃은 그대로) */
  function migrate() {
    try {
      if (localStorage.getItem(LS.mig)) return;
      localStorage.setItem(LS.mig, "1");
      if (!on() && typeof setDisplay === "function") setDisplay({ layout: "app" });
    } catch (e) { /* 계속 */ }
  }

  /* ---- 이벤트 ---- */
  document.addEventListener("click", (e) => {
    const t = e.target;
    const close = t.closest("[data-sh-close]");
    if (close) { e.stopPropagation(); closeTab(close.dataset.shClose); return; }
    if (t.closest("[data-sh-pal]")) { palOpen(); return; }
    if (t.closest("[data-sh-logout]")) { logout(); return; }
    if (t.closest("[data-sh-ask]")) { if (typeof askToggle === "function") askToggle(); return; }
    const it = t.closest("[data-sh-itab]");
    if (it) { lsSet(LS.itab, it.dataset.shItab); schedule(); return; }
    const mg = t.closest("[data-sh-mega]");
    if (mg) { e.stopPropagation(); megaOpen(mg.dataset.shMega, mg); return; }
    const aq = t.closest("[data-sh-askq]");
    if (aq) { if (!askState.open) askSetOpen(true); askSend(aq.dataset.shAskq); return; }
    if (MEGA && !MEGA.classList.contains("hidden") && !t.closest("#shMega")) megaClose();
    if (t.closest("[data-sh-mini]")) { const order = ["list", "rail", "icon"]; setMenu(order[(order.indexOf(menuMode()) + 1) % 3]); return; }
    const shm = t.closest("[data-shm]");
    if (shm) { setMenu(shm.dataset.shm); return; }
    const sha = t.closest("[data-sha]");
    if (sha) { setDock(sha.dataset.sha === "dock"); paintSettingsExt(); return; }
    const rg = t.closest("[data-sh-rg]");
    if (rg) { const c = lsGet(LS.rail, {}); c[rg.dataset.shRg] = !rg.closest(".sh-rg").classList.contains("closed"); lsSet(LS.rail, c); paintRail(state.nav); return; }
    const sec = t.closest("[data-sh-sec]");
    if (sec) { const c = lsGet(LS.tree, { skills: true }); c[sec.dataset.shSec] = !c[sec.dataset.shSec]; lsSet(LS.tree, c); sec.parentNode.classList.toggle("closed"); return; }
    const hub = t.closest("[data-sh-hub]");
    if (hub) { navTo(hubTarget(hub.dataset.shHub)); return; }
    const gh = t.closest(".nav-gh");      // (v125) 공용 메뉴 묶음 열기
    if (gh) { const box = gh.parentElement, was = box.classList.contains("open"); document.querySelectorAll(".nav-m.open").forEach((x) => x.classList.remove("open")); box.classList.toggle("open", !was); gh.setAttribute("aria-expanded", String(!was)); return; }
    if (!t.closest(".nav-gi")) document.querySelectorAll(".nav-m.open").forEach((x) => x.classList.remove("open"));
    const go = t.closest("[data-sh-go]");
    if (go) { e.preventDefault(); document.body.classList.remove("sh-tree-open"); navTo(go.dataset.shGo); return; }
    // 계정 드롭다운(새 레이아웃)
    const right = $("topRight");
    if (on() && right) {
      if (t.closest("#userChip") && !t.closest("#logoutBtn")) { right.classList.toggle("sh-acct-open"); return; }
      if (!t.closest("#topRight")) right.classList.remove("sh-acct-open");
    }
  });
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === "k" || e.key === "K")) {
      if (document.body.classList.contains("auth-visible")) return;
      e.preventDefault();
      if (PAL && !PAL.classList.contains("hidden")) palClose(); else palOpen();
      return;
    }
    if (e.key === "Escape" && MEGA && !MEGA.classList.contains("hidden")) { megaClose(); return; }
    if (e.key === "Escape" && document.body.classList.contains("sh-focus") && !(PAL && !PAL.classList.contains("hidden"))) {
      const tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag !== "INPUT" && tag !== "TEXTAREA" && !document.body.classList.contains("ask-open")) setFocus(false);
    }
  });
  window.addEventListener("focus", schedule);
  setInterval(() => { if (on() && layout() === "command" && document.visibilityState === "visible") schedule(); }, 15000);

  function init() {
    sprite();
    apply(layout());
  }
  window.SHELL = { apply: apply, on: on, open: palOpen, hubs: HUBS, refresh: schedule, dock: setDock, mode: mode, setMode: setMode, repaintMenu: () => { if (on()) { paintRail(state.nav); paintTopMenu(state.nav); } } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
