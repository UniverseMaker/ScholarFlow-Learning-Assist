/* hublink.js — 계정 연동 화면, 통합 메뉴, 다른 시스템으로 이동 (hub-link/1).
   연동은 선택 사항이다. 연동이 없거나 상대가 꺼져 있어도 이 시스템은 그대로 동작한다.
   연동 주소가 127.0.0.1 이라 같은 PC 에서 접속할 때만 동작한다 — 외부 주소에서는 다른 시스템 메뉴를 보이지 않는다. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => escapeHtml(String(s == null ? "" : s));
  let pub = null;      // (v125) 등록된 내 공개 주소로 접속해도 연동한다(11.9)
  const isHost = () => /^(127\.0\.0\.1|localhost|\[::1\])$/.test(location.hostname) || (pub && location.origin === pub);
  async function loadPub() { if (pub != null) return; try { pub = ((await fetch("hub/info", { cache: "no-store" }).then((r) => r.json())).data || {}).public || ""; } catch (e) { pub = ""; } }
  const isLocal = isHost;
  /* (G5) 브라우저 링크는 늘 공개 도메인. 서버가 알려 주는 값(/hub/domains)이 먼저고, 아래는 받기 전 기본값 */
  const PUB = { admin: "https://admin.example.com", kanban: "https://task.example.com", slc: "https://learning.example.com", aioffice: "https://office.example.com", aimgmt: "https://manager.example.com",};
  const PORTS = { 8195: "admin", 8194: "kanban", 18162: "slc", 17777: "aioffice",};
  let pubLoaded = false;
  async function loadDomains() {
    if (pubLoaded) return; pubLoaded = true;
    try { (((await op("domains")) || {}).rows || []).forEach((r) => { if (r.system && /^https:\/\//.test(r.public || "")) PUB[r.system] = r.public.replace(/\/+$/, ""); }); } catch (e) { /* 기본값을 쓴다 */ }
  }
  const pubOf = (sys) => PUB[sys] || "";
  function toPublic(u) {   // 127.0.0.1·localhost 주소를 그 시스템의 공개 도메인으로
    const m = /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::(\d+))?(\/.*)?$/i.exec(String(u || ""));
    if (!m) return u || "";
    const sys = PORTS[m[1]]; if (!sys || !PUB[sys]) return u;
    return PUB[sys] + (m[2] || "/");
  }
  let MENUS = [];
  async function op(name, body) {
    const o = { method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store", headers: {} };
    if (body) { o.headers["Content-Type"] = "application/json"; o.headers["X-Study-Vault"] = "1"; o.body = JSON.stringify(body); }
    const r = await fetch("hub/" + name, o); let j = null; try { j = await r.json(); } catch (e) { j = null; }
    if (!j || j.ok === false) throw new Error((j && j.error && j.error.message) || "요청을 처리하지 못했어요.");
    return j.data;
  }
  function postForm(url, fields, target) {
    const f = document.createElement("form"); f.method = "post"; f.action = url; if (target) f.target = target; f.style.display = "none";
    Object.keys(fields).forEach((k) => { const i = document.createElement("input"); i.name = k; i.value = fields[k]; f.appendChild(i); });
    document.body.appendChild(f); f.submit();
    if (target) setTimeout(() => f.remove(), 1000);
  }
  // 다른 시스템의 화면으로 로그인된 채 이동한다. 밝기·색·메뉴 형태도 함께 넘긴다. 표는 주소에 넣지 않는다
  async function jump(system, to) {
    const m = MENUS.filter((x) => x.system === system)[0];
    if (m && m.reachable === false) { alert(m.label + " 이(가) 지금 응답하지 않아요. 켜진 뒤 다시 눌러 주세요."); loadMenus(); return; }
    try {
      const t = (await op("tickets", { system: system, to: to }))[0];
      if (!t) { alert("연동되지 않은 시스템이에요."); return; }
      const p = RUI.get();
      const rui = btoa(JSON.stringify({ theme: p.theme, mode: p.mode, palette: p.palette, layout: p.layout, topnav: p.topnav, toprow: p.toprow, unified: p.unified })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      postForm(t.url, { ticket: t.ticket, rui: rui });
    } catch (e) { alert(e.message); }
  }
  // (v142, G11) 시스템 바로 가기 자동 로그인 — 공용 부품(RUI.sysInit jump)이 누른 순간 연 창(win)으로 표를 보낸다. 표를 못 받으면 그 창을 대체 주소로
  async function jumpWin(system, win, fallback) {
    const send = (u) => { if (win) { const w = window.open("", win); if (w) { w.location.href = u; return; } } window.open(u, "_blank", "noopener"); };
    try {
      const t = (await op("tickets", { system: system, to: "#/" }))[0];
      if (!t) return send(fallback);
      const p = RUI.get();
      const rui = btoa(JSON.stringify({ theme: p.theme, mode: p.mode, palette: p.palette, layout: p.layout, topnav: p.topnav, toprow: p.toprow, unified: p.unified })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      if (win) postForm(t.url, { ticket: t.ticket, rui: rui }, win); else send(fallback);
    } catch (e) { send(fallback); }
  }
  // 이 계정이 연결된 시스템({admin:true, …}) — 다른 계정의 연결은 보지 않는다
  async function myLinks() { try { return await op("mylinks"); } catch (e) { return {}; } }
  // 로그인 뒤 탭마다 한 번, 연동된 시스템에도 조용히 로그인한다. 실패해도 메뉴로 이동할 때 다시 로그인된다
  async function silent() {
    await loadPub(); if (!isLocal()) return;
    try { if (sessionStorage.getItem("hub.silent")) return; sessionStorage.setItem("hub.silent", "1"); } catch (e) { /* 계속 */ }
    try {
      (await op("tickets", {})).forEach((t) => {
        const name = "hub_" + t.system, f = document.createElement("iframe"); f.name = name; f.title = t.system; f.hidden = true;
        document.body.appendChild(f); postForm(t.url, { ticket: t.ticket, silent: "1" }, name);
        setTimeout(() => f.remove(), 5000);
      });
    } catch (e) { /* 연동이 없거나 상대가 꺼져 있다 */ }
  }
  async function loadMenus() {
    loadDomains();
    await loadPub(); MENUS = [];
    if (isLocal() && RUI.get().unified) { try { MENUS = await op("menus"); } catch (e) { MENUS = []; } }
    if (window.SHELL && SHELL.repaintMenu) SHELL.repaintMenu();
  }
  // 통합 메뉴 → 셸이 묶음으로 덧붙인다
  const menus = () => MENUS.map((s) => {
    let items = []; ((s.menu && s.menu.groups) || []).forEach((g) => { items = items.concat(g.items || []); });
    return { system: s.system, label: s.label, reachable: s.reachable, items: items };
  }).filter((s) => s.items.length);

  /* ---- #/<화면> 바로 가기 ---- */
  function route() {
    const m = /^#\/([a-z][a-z0-9_-]{0,40})$/i.exec(location.hash || ""); if (!m) return null;
    const k = m[1];
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) { /* 계속 */ }
    const known = k === "today" || (window.SHELL && SHELL.hubs.some((h) => (h.items || []).indexOf(k) >= 0));
    if (k === "home" || !known) return null;   // 모르는 주소는 첫 화면으로
    return navTo(k);
  }
  window.addEventListener("hashchange", () => { if (/^#\/[a-z]/i.test(location.hash) && !/^#\/p\//.test(location.hash)) route(); });

  /* ---- 연동 화면 ---- */
  async function paint(area) {
    await loadPub();
    if (!isLocal()) {
      area.innerHTML = '<div class="sv"><div class="sh-kicker">설정</div><h2>시스템 연동</h2><div class="card"><p class="sh-muted">계정 연동과 통합 메뉴는 서버 PC 나 등록된 공개 주소(' + esc(pub || "미등록") + ")로 접속했을 때 쓸 수 있어요.</p></div></div>";
      return;
    }
    let list = []; let err = ""; let dm = null;
    try { list = await op("links"); dm = await op("domains"); } catch (e) { err = e.message; }
    const any = list.some((x) => x.linked), un = !!RUI.get().unified;
    area.innerHTML = '<div class="sv"><div class="sh-kicker">설정</div><h2>시스템 연동</h2><p class="sh-muted">계정을 연결하면 한 번의 로그인으로 함께 쓰고, 메뉴도 한곳에 모을 수 있어요. 연결하지 않으면 시스템마다 따로 동작해요.</p>' +
      (err ? '<p class="lb-warn">' + esc(err) + "</p>" : "") +
      '<div class="card"><div class="hl-wrap"><table class="sv-tbl hl-tbl"><thead><tr><th>시스템</th><th>연결 상태</th><th>내부 주소</th><th>공개 주소</th><th>마지막 확인</th><th></th></tr></thead><tbody>' + list.map((s) => "<tr><td><b>" + esc(s.label) + "</b></td><td>" + (s.linked ? "연결됨 · " + esc(s.remoteName) + (s.auto ? '<br><small class="sh-muted">통합로그인 계정 자동 연동</small>' : "") : "연결되어 있지 않습니다" + (s.autoOff ? '<br><small class="sh-muted">직접 해제함 · 자동 연동 안 함</small>' : "")) + (s.reachable ? "" : '<br><small class="lb-warn">응답 없음</small>') + "</td><td><code>" + esc(s.web) + "</code></td><td><code>" + esc(s.public) + "</code></td><td>" + esc(s.checkedAt || "") + '</td><td class="hl-act">' +
        (s.linked ? '<button type="button" class="ghost-btn small-btn" data-hl-go="' + esc(s.system) + '">열기</button><button type="button" class="ghost-btn small-btn" data-hl-off="' + esc(s.system) + '">해제</button>' : '<button type="button" class="primary small-btn" data-hl-on="' + esc(s.system) + '">연결</button>') + "</td></tr>").join("") + "</tbody></table></div></div>" +
      (list.some((x) => x.sso) ? '<div class="card"><h3>통합로그인 계정 자동 연동</h3><p class="sh-muted">같은 통합로그인 계정으로 들어온 시스템끼리는 로그인할 때 저절로 연결돼요. 직접 해제한 시스템은 다시 연결하지 않아요(직접 연결하면 다시 자동).</p><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button type="button" class="ghost-btn small-btn" data-hl-auto="1">지금 맞추기</button><span class="sh-muted" id="hlAutoMsg"></span></div></div>' : "") +
      '<div class="card"><h3>통합 메뉴</h3>' + (any ? '<p class="sh-muted">연동된 시스템의 메뉴를 이 앱 메뉴 뒤에 붙여요. 누르면 그 시스템으로 로그인된 채 이동해요. 이 기기에만 저장돼요.</p><div class="seg"><button type="button" class="seg-btn' + (un ? " active" : "") + '" data-hl-un="1">켜기</button><button type="button" class="seg-btn' + (un ? "" : " active") + '" data-hl-un="0">끄기</button></div>' : '<p class="sh-muted">연결한 시스템이 있으면 켤 수 있어요.</p>') + "</div>" + domainCard(dm) + "</div>";
    area.onclick = async (e) => {
      let b;
      if ((b = e.target.closest("[data-hl-on]"))) { try { location.href = (await op("start", { system: b.dataset.hlOn })).url; } catch (er) { alert(er.message); } return; }
      if ((b = e.target.closest("[data-hl-off]"))) { if (!confirm("이 시스템과의 연결을 해제할까요? 서로 받은 토큰도 폐기돼요.")) return; try { await op("unlink", { system: b.dataset.hlOff }); } catch (er) { alert(er.message); } paint(area); loadMenus(); return; }
      if ((b = e.target.closest("[data-hl-auto]"))) {
        const m = document.getElementById("hlAutoMsg"); b.disabled = true; if (m) m.textContent = "맞추는 중…";
        try {
          const r = await op("autolink", {}); const lab = (k) => (list.find((x) => x.system === k) || {}).label || k;
          const done = Object.keys(r.claimed || {}).filter((k) => r.claimed[k] === "linked").map(lab), sent = Object.keys(r.offered || {}).filter((k) => r.offered[k] === "sent").map(lab);
          if (m) m.textContent = (done.length ? "연결됨: " + done.join(", ") + ". " : "") + (sent.length ? "연결 요청 보냄: " + sent.join(", ") + " — 그 시스템에 통합로그인으로 들어가면 연결돼요." : done.length ? "" : "새로 연결할 시스템이 없어요.");
          if (done.length) { setTimeout(() => { paint(area); loadMenus(); }, 1200); }
        } catch (er) { if (m) m.textContent = er.message; }
        b.disabled = false; return;
      }
      if ((b = e.target.closest("[data-hl-go]"))) { jump(b.dataset.hlGo, "#/"); return; }
      if ((b = e.target.closest("[data-hl-un]"))) { RUI.set({ unified: b.dataset.hlUn === "1" }); paint(area); return; }
      if ((b = e.target.closest("[data-hl-sync]"))) { try { await op("domains", { sync: true }); pub = null; } catch (er) { alert(er.message); } paint(area); return; }
      if ((b = e.target.closest("[data-hl-save]"))) { const d = {}; area.querySelectorAll("[data-hl-dom]").forEach((i) => { d[i.dataset.hlDom] = i.value; }); try { await op("domains", { domains: d }); pub = null; } catch (er) { alert(er.message); } paint(area); }
    };
  }
  function domainCard(dm) {
    if (!dm) return "";
    return '<div class="card"><h3>도메인</h3><p class="sh-muted">서버끼리는 내부 주소로 통신하고, 브라우저는 접속한 쪽에 맞춰 이동해요.</p>' + dm.rows.map((r) => '<div class="set-row"><span class="set-label">' + esc(r.label) + '<br><span class="set-desc" style="margin:0">' + esc(r.local) + "</span></span>" + (dm.canEdit ? '<input type="url" data-hl-dom="' + esc(r.system) + '" value="' + esc(r.public) + '" placeholder="https://도메인" style="min-width:280px">' : "<span>" + esc(r.public) + "</span>") + "</div>").join("") + (dm.canEdit ? '<div class="lb-row"><button type="button" class="primary small-btn" data-hl-save="1">저장</button><button type="button" class="ghost-btn small-btn" data-hl-sync="1">상대에게서 받아 오기</button></div>' : "") + "</div>";
  }
  function init() {
    const content = document.querySelector("main.content"); if (!content || typeof EXT_VIEWS === "undefined" || EXT_VIEWS.links) return;
    const a = document.createElement("section"); a.id = "hub_links"; a.className = "hidden"; content.appendChild(a);
    EXT_VIEWS.links = { area: a, open: () => paint(a) };
  }
  document.addEventListener("click", (e) => { const a = e.target.closest("[data-hub-jump]"); if (!a) return; e.preventDefault(); jump(a.dataset.hubJump, a.dataset.to); });
  document.addEventListener("rui:change", () => { loadMenus(); });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
  window.HUBLINK = { pub: pubOf, toPublic: toPublic, loadDomains: loadDomains, raw: () => MENUS.filter((s) => s.menu), route: route, menus: menus, silent: silent, load: loadMenus, jump: jump, jumpWin: jumpWin, myLinks: myLinks, isLocal: isLocal };
})();
