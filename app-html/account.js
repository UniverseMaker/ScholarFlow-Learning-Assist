(function (global) {
  "use strict";
  const S = global.SERVER;
  if (!S) return;
  S.hooks = S.hooks || {};
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $id = (id) => document.getElementById(id);
  const fmtMs = (ms) => { if (!ms) return "-"; const d = new Date(ms); return (d.getMonth() + 1) + "/" + d.getDate() + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
  const _set = Storage.prototype.setItem, _rem = Storage.prototype.removeItem;

  /* =====================================================================
   * 1. 실시간 저장 — 바뀌는 순간 그 항목만 서버로(api.php?r=kv). 서버가 기준, 브라우저(localStorage)는 캐시.
   *    · 쓰기: localStorage 에 쓰는 순간(0.2초 안에 묶어) 서버에 put. 실패하면 대기열(study.kv.outbox.<uid>)에 남겨 다시 보낸다.
   *    · 읽기: 시작·로그인 때 서버 전체(all)를 받아 캐시를 맞춘다 — 서버에 없는 이 브라우저 값은 올리고, 다른 기기가 지운 값은 지운다.
   *      서버 값으로 덮기 전 이 브라우저에만 있던 다른 값은 서버 사본(kvsnap)으로 남긴다(유실 없음).
   *    · 다른 기기: 15초마다(화면을 보고 있을 때) 바뀐 것만(since) 받아 반영.
   *    · 빼는 것: 다른 계정 데이터 · AI 연결(키) · 계정 목록/세션 · 관리자 전역 설정 · 보내기 대기열
   * =================================================================== */
  const EXCL = new Set(["rui_prefs", "study.users", "study.session", "study.llm", "study.system",
    "study.progress", "study.device",
    "study.shell.mode"]);   // 지금 모드는 이 화면의 상태 — 동기화하면 그려진 메뉴와 어긋난다(로그인하면 늘 연구지원부터)
  const EXCL_PRE = ["ui_list_", "study.domaindata.", "study.ws.outbox.", "study.sync.", "study.kv."];
  const localUid = () => { try { const s = JSON.parse(localStorage.getItem("study.session") || "null"); return s && s.user_id; } catch (e) { return null; } };
  function kind(k, uid) {
    if (!k || EXCL.has(k) || EXCL_PRE.some((p) => k.indexOf(p) === 0) || /llm/i.test(k)) return null;
    if (k.indexOf("study.user.") === 0) return uid && k.indexOf("study.user." + uid + ".") === 0 ? "u" : null;
    return "g";
  }
  const skey = (k, uid) => kind(k, uid) === "u" ? "u:" + k.slice(("study.user." + uid + ".").length) : "g:" + k;   // 서버 키
  const lkey = (s, uid) => s.indexOf("u:") === 0 ? "study.user." + uid + "." + s.slice(2) : s.slice(2);            // 브라우저 키
  function deviceId() {
    let d = null; try { d = localStorage.getItem("study.device"); } catch (e) { /* 계속 */ }
    if (!d) { d = "d" + Math.random().toString(36).slice(2, 10); try { _set.call(localStorage, "study.device", d); } catch (e) { /* 계속 */ } }
    const ua = navigator.userAgent; const b = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "브라우저";
    return b + " · " + (/Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac/.test(ua) ? "macOS" : "기기") + " · " + d.slice(1, 5);
  }
  const K = { ready: false, pending: {}, sending: false, timer: null, t: 0, last: 0, fail: 0, status: "idle", remote: 0 };
  let applying = false;
  const obKey = () => "study.kv.outbox." + (S.user ? S.user.id : "-");

  function touched(k) {
    if (applying || !S.on || !S.user || !K.ready) return;          // 준비(서버 전체 받기) 전 쓰기는 loadAll 이 비교해서 올린다
    const uid = localUid(); if (!kind(k, uid)) return;
    K.pending[skey(k, uid)] = localStorage.getItem(k);            // 지웠으면 null
    schedule(200);
  }
  Storage.prototype.setItem = function (k) { const r = _set.apply(this, arguments); if (this === global.localStorage) touched(k); return r; };
  Storage.prototype.removeItem = function (k) { const r = _rem.apply(this, arguments); if (this === global.localStorage) touched(k); return r; };

  function schedule(ms) { clearTimeout(K.timer); K.timer = setTimeout(() => flush(false), ms); }
  function saveOutbox() { try { if (Object.keys(K.pending).length) _set.call(localStorage, obKey(), JSON.stringify(K.pending)); else _rem.call(localStorage, obKey()); } catch (e) { /* 저장 공간 부족 — 메모리에만 */ } }
  async function flush(leave) {
    if (K.sending || !S.user || !Object.keys(K.pending).length) return true;
    const ops = Object.keys(K.pending).map((k) => ({ k: k, v: K.pending[k] }));
    K.pending = {};
    const body = JSON.stringify({ dev: deviceId(), ops: ops });
    K.sending = true; setStatus("saving");
    try {
      const r = await fetch("api.php?r=kv&op=put", { method: "POST", credentials: "same-origin", cache: "no-store", keepalive: !!leave && body.length < 60000,
        headers: { "Content-Type": "application/json", "X-Study-Vault": "1" }, body: body });
      const d = await r.json().catch(() => null);
      if (r.status === 401 && S.expired) S.expired();
      if (!d || !d.ok) throw new Error("HTTP " + r.status);
      K.last = Date.now(); K.fail = 0; if (d.t) K.t = Math.max(K.t, d.t);
      saveOutbox(); setStatus("ok");
      return true;
    } catch (e) {
      ops.forEach((o) => { if (!(o.k in K.pending)) K.pending[o.k] = o.v; });   // 그 사이 새로 바뀐 값이 우선
      saveOutbox(); K.fail++; setStatus("fail");
      schedule(Math.min(30000, 1000 * Math.pow(2, K.fail)));
      return false;
    } finally {
      K.sending = false;
      if (Object.keys(K.pending).length && K.status === "ok") schedule(150);
    }
  }
  function setStatus(s) { K.status = s; paintStatus(); }
  function statusText() {
    if (!S.on || !S.user) return "";
    const n = Object.keys(K.pending).length;
    if (K.status === "fail") return "⚠ 서버 저장 실패 — 다시 보내는 중" + (n ? " (" + n + "건 대기)" : "");
    if (K.status === "saving" || n) return "☁ 저장 중…";
    if (K.last) { const d = new Date(K.last); return "☁ 실시간 저장됨 " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0") + ":" + String(d.getSeconds()).padStart(2, "0"); }
    return K.ready ? "☁ 서버와 연결됨 · 바뀌면 바로 저장" : "☁ 서버에서 불러오는 중…";
  }
  function paintStatus() { document.querySelectorAll("[data-kv-status]").forEach((el) => { el.textContent = statusText(); el.classList.toggle("bad", K.status === "fail"); }); }

  function localMap(uid) {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (kind(k, uid)) out[skey(k, uid)] = localStorage.getItem(k); }
    return out;
  }
  function isFresh(uid) {   // 이 브라우저의 로컬 계정이 방금 생겼나(새 브라우저 — 앱이 켜지며 만든 기본값뿐)
    try { const us = JSON.parse(localStorage.getItem("study.users") || "[]"); const lu = us.filter((x) => x.id === uid)[0]; return !lu || Date.now() - (lu.created || 0) < 10 * 60 * 1000; } catch (e) { return false; }
  }
  // 서버 전체를 받아 캐시를 맞춘다 → 화면에 이미 그려진 값이 바뀌었으면 true(새로고침 필요)
  async function loadAll() {
    const uid = localUid(); if (!uid || !S.user) return false;
    const d = await S.api("kv", "all");
    if (!d.ok) { K.ready = true; setStatus("fail"); return false; }
    const srv = d.items || {}, gone = new Set(d.gone || []);
    const local = localMap(uid);
    let outbox = {}; try { outbox = JSON.parse(localStorage.getItem(obKey()) || "{}") || {}; } catch (e) { outbox = {}; }
    // 서버 값으로 덮이기 전, 이 브라우저에만 있던 다른 값은 서버 사본으로 보관
    const differ = Object.keys(local).some((k) => k.indexOf("u:") === 0 && srv[k] !== undefined && srv[k] !== local[k] && !(k in outbox));
    if (differ && !isFresh(uid)) await S.api("kv", "archive", { dev: deviceId(), items: local });
    let changed = false; const up = [];
    applying = true;
    try {
      Object.keys(srv).forEach((k) => { if (k in outbox) return; const lk = lkey(k, uid); if (!kind(lk, uid)) return; if (localStorage.getItem(lk) !== srv[k]) { try { _set.call(localStorage, lk, srv[k]); changed = true; } catch (e) { /* 계속 */ } } });
      Object.keys(local).forEach((k) => { if (srv[k] !== undefined || k in outbox) return; if (gone.has(k)) { _rem.call(localStorage, lkey(k, uid)); changed = true; } else up.push(k); });
    } finally { applying = false; }
    K.t = d.t || Date.now(); K.ready = true;
    up.forEach((k) => { K.pending[k] = local[k]; });                  // 서버에 없던 이 브라우저 값(처음 쓰는 계정·새 기본값)
    Object.keys(outbox).forEach((k) => { K.pending[k] = outbox[k]; }); // 지난번에 못 보낸 변경
    if (Object.keys(K.pending).length) await flush(false); else setStatus("ok");
    return changed;
  }
  S.hooks.afterLogin = async () => ((await loadAll()) ? "reload" : null);   // 로그인 화면 뒤 — 이미 읽힌 값이 있으면 새로고침
  S.hooks.boot = async () => { await loadAll(); return null; };           // 시작 — 앱이 읽기 전이라 새로고침 필요 없음
  S.hooks.beforeLogout = async () => { flushAct(); await flush(false); };
  S.syncNow = () => flush(false);

  // 다른 기기에서 바뀐 것 받기
  async function poll() {
    if (!K.ready || !S.user || document.visibilityState !== "visible" || K.sending) return;
    const uid = localUid(); if (!uid) return;
    const d = await S.api("kv", "since", undefined, { t: K.t });
    if (!d.ok) return;
    const me = deviceId(); let n = 0;
    applying = true;
    try {
      Object.keys(d.items || {}).forEach((k) => {
        const it = d.items[k]; if (it.dev === me || k in K.pending) return;
        const lk = lkey(k, uid); if (!kind(lk, uid)) return; const cur = localStorage.getItem(lk);
        if (it.v == null) { if (cur != null) { _rem.call(localStorage, lk); n++; } }
        else if (cur !== it.v) { try { _set.call(localStorage, lk, it.v); n++; } catch (e) { /* 계속 */ } }
      });
    } finally { applying = false; }
    K.t = Math.max(K.t, d.t || 0);
    if (n) { K.remote += n; showRemoteBar(); }
  }
  setInterval(poll, 15000);
  document.addEventListener("visibilitychange", () => {
    if (!S.on || !S.user) return;
    if (document.visibilityState === "hidden") { flushAct(); flush(false); } else poll();
  });
  global.addEventListener("pagehide", () => { flushAct(true); flush(true); });
  function showRemoteBar() {
    let b = $id("syncBar");
    if (!b) { b = document.createElement("div"); b.id = "syncBar"; b.className = "sv-banner sync"; document.body.appendChild(b); }
    b.innerHTML = "☁ 다른 기기에서 바뀐 " + K.remote + "개 항목을 받았어요. <button type=\"button\" data-acm=\"reload\">새로고침해서 보기</button><button type=\"button\" class=\"x\" data-acm=\"pull-x\" aria-label=\"닫기\">×</button>";
  }

  // [계정 · 보안] 화면의 '실시간 저장' 카드
  async function paintSync() {
    const box = $id("svSync"); if (!box || !S.user) return;
    const [info, sn] = await Promise.all([S.api("kv", "info"), S.api("kv", "snaps")]);
    const kindKo = { daily: "하루 사본", browser: "이 브라우저 값 보관", before: "되돌리기 직전" };
    box.innerHTML = '<p class="sv-live" data-kv-status></p><dl class="sv-dl"><dt>이 브라우저</dt><dd>' + esc(deviceId()) + "</dd><dt>서버에 저장된 항목</dt><dd>" +
      (info.ok ? info.keys + "개 · " + Math.round((info.bytes || 0) / 1024) + "KB · 마지막 변경 " + fmtMs(info.last) : "-") + "</dd></dl>" +
      '<div class="llm-tools"><button type="button" class="big-btn ghost-btn" data-acm="pull">서버에서 다시 불러오기</button></div>' +
      '<p class="set-desc">설정·화면 상태·연구지원 작업 위치는 <b>바뀌는 순간 서버의 내 계정에 저장</b>돼요(브라우저는 임시 보관만). 다른 브라우저에서 로그인하면 그대로 이어지고, 다른 기기에서 바뀐 것도 15초 안에 받아요. 아래는 서버가 남긴 사본이에요 — 하루 한 장 + 덮어쓰기 전 보관.</p>' +
      (sn.ok && sn.list.length ? '<table class="sv-tbl"><thead><tr><th>시각</th><th>종류</th><th>항목</th><th></th></tr></thead><tbody>' + sn.list.slice(0, 30).map((x) =>
        "<tr><td>" + fmtMs(x.saved) + "</td><td>" + esc(kindKo[x.kind] || x.kind || "") + (x.dev ? "<br><small>" + esc(x.dev) + "</small>" : "") + "</td><td>" + x.keys + "개 · " + Math.round(x.size / 1024) + "KB</td><td><button type=\"button\" class=\"mini-btn\" data-acm=\"restore\" data-name=\"" + esc(x.name) + "\">이 시점으로 되돌리기</button></td></tr>").join("") + "</tbody></table>" : '<p class="set-desc">아직 사본이 없어요(하루 첫 저장 때 생겨요).</p>');
    paintStatus();
  }
  S.hooks.paintSync = paintSync;
  async function pullNow() { if (await loadAll()) location.reload(); else if (S.notice) S.notice("서버와 같은 상태예요."); }

  /* =====================================================================
   * 2. 조작 감사
   * =================================================================== */
  const AQ = [];
  let actT = null;
  const curView = () => { try { return state.nav; } catch (e) { return ""; } };
  const curMode = () => { try { return global.SHELL && SHELL.mode ? SHELL.mode() : ""; } catch (e) { return ""; } };
  function act(a, f) {
    if (!S.on || !S.user) return;
    AQ.push(Object.assign({ a: a, t: Date.now(), v: curView(), m: curMode() }, f || {}));
    if (AQ.length >= 40) flushAct(); else { clearTimeout(actT); actT = setTimeout(flushAct, 4000); }
  }
  S.act = act;
  function flushAct(leave) {
    if (!AQ.length) return;
    const items = AQ.splice(0, 80);
    const body = JSON.stringify({ items: items });
    try { fetch("api.php?r=log&op=activity", { method: "POST", credentials: "same-origin", keepalive: !!leave && body.length < 60000, headers: { "Content-Type": "application/json", "X-Study-Vault": "1" }, body: body }).catch(() => {}); } catch (e) { /* 계속 */ }
  }
  const clean = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n || 60);
  function labelOf(el) {
    if (!el) return "";
    const a = el.getAttribute("aria-label") || el.getAttribute("title");
    if (a) return clean(a);
    if (el.id) { const l = document.querySelector('label[for="' + el.id + '"]'); if (l) return clean(l.textContent); }
    const pl = el.closest("label"); if (pl && pl !== el) return clean(pl.textContent);
    return clean(el.innerText || el.value || el.placeholder || el.name || el.className);
  }
  function dataOf(el) {
    const d = {}; let n = 0;
    Object.keys(el.dataset || {}).forEach((k) => { const v = el.dataset[k]; if (n < 4 && v != null && String(v).length <= 60) { d[k] = v; n++; } });
    return n ? d : undefined;
  }
  document.addEventListener("click", (e) => {
    const el = e.target.closest && e.target.closest("button, a, [role=button], [role=tab], [role=option], [data-nav], [data-sh-go], summary, .nav-item, input[type=checkbox], input[type=radio]");
    if (!el || (el.matches && el.matches("input[type=checkbox], input[type=radio]"))) return;   // 체크는 change 에서
    act("click", { l: labelOf(el), id: el.id || undefined, d: dataOf(el) });
  }, true);
  document.addEventListener("change", (e) => {
    const el = e.target; if (!el || !el.tagName) return;
    const tp = (el.type || "").toLowerCase();
    if (tp === "password") { act("input", { id: el.id || undefined, l: labelOf(el), val: "(비밀번호 입력함)" }); return; }
    if (tp === "file") { act("file", { id: el.id || undefined, l: labelOf(el), val: Array.from(el.files || []).map((f) => f.name + " (" + Math.round(f.size / 1024) + "KB)").join(", ").slice(0, 160) }); return; }
    if (tp === "checkbox" || tp === "radio") { act("change", { id: el.id || undefined, l: labelOf(el), val: el.checked ? "켬" : "끔", d: dataOf(el) }); return; }
    if (el.tagName === "SELECT") { const o = el.options[el.selectedIndex]; act("change", { id: el.id || undefined, l: labelOf(el), val: clean(o ? o.text : el.value), d: dataOf(el) }); return; }
    if (tp === "range" || tp === "number" || tp === "date" || tp === "color") { act("change", { id: el.id || undefined, l: labelOf(el), val: String(el.value).slice(0, 40) }); return; }
    act("input", { id: el.id || undefined, l: labelOf(el), n: String(el.value || "").length });   // 글 내용은 남기지 않는다
  }, true);
  document.addEventListener("submit", (e) => { act("submit", { id: (e.target && e.target.id) || undefined }); }, true);
  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.altKey || e.metaKey) || ["Control", "Alt", "Meta", "Shift"].indexOf(e.key) >= 0) return;
    act("key", { k: (e.ctrlKey ? "Ctrl+" : "") + (e.altKey ? "Alt+" : "") + (e.metaKey ? "Meta+" : "") + (e.shiftKey ? "Shift+" : "") + String(e.key).slice(0, 12) });
  }, true);
  global.addEventListener("study:mode", (e) => act("mode", { val: e.detail }));
  // 화면 열기 — navTo 를 감싼다(app.js 가 로드된 뒤)
  function wrapNav() {
    if (typeof global.navTo !== "function" || global.navTo._acm) return;
    const orig = global.navTo;
    const w = function (nav) {
      try { act("view", { val: String(nav).slice(0, 40) }); } catch (e) { /* 계속 */ }
      const r = orig.apply(this, arguments);
      if (nav === "library" && !libResumed) {                    // 자료 학습: 처음 들어올 때 마지막으로 읽던 문서를 다시 연다
        libResumed = true;
        const k = uk("lib_last"); let last = null; try { last = k && JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { last = null; }
        setTimeout(() => { let cur = ""; try { cur = libState.docId; } catch (e) { cur = ""; } if (last && !cur && typeof global.libOpen === "function") global.libOpen(last); }, 700);
      }
      return r;
    };
    w._acm = true; global.navTo = w;
  }
  // 학습 자료 문서 · 연구 프로젝트 열람(화면 안에서 바뀌는 것)
  let lastDoc = "", libResumed = false;
  const uk = (s) => { const u = localUid(); return u ? "study.user." + u + "." + s : null; };
  setInterval(() => {
    if (!S.user) return;
    let d = ""; try { d = libState.docId || ""; } catch (e) { d = ""; }
    if (d && d !== lastDoc) {
      const t = $id("libDocTitle"); act("doc_open", { doc: d, l: t ? clean(t.textContent) : undefined });
      const mk = uk("tk.lib.meta." + d);   // 서버의 library/<문서>/_document — 폴더만 열어 봐도 어떤 문서인지 알게
      try { if (mk && t && !localStorage.getItem(mk)) localStorage.setItem(mk, JSON.stringify({ title: clean(t.textContent, 200), first: Date.now() })); } catch (e) { /* 계속 */ }
    }
    if (d !== lastDoc) { const k = uk("lib_last"); if (k) { try { if (d) localStorage.setItem(k, JSON.stringify(d)); else if (lastDoc && state.nav === "library") localStorage.removeItem(k); } catch (e) { /* 계속 */ } } }
    lastDoc = d;
  }, 2500);

  /* =====================================================================
   * 3. 계정 메뉴
   * =================================================================== */
  function paintAcct() {
    const head = $id("acmHead"); if (!head) return;
    let lu = null; try { const s = JSON.parse(localStorage.getItem("study.session") || "null"); const us = JSON.parse(localStorage.getItem("study.users") || "[]"); lu = us.filter((x) => s && x.id === s.user_id)[0]; } catch (e) { lu = null; }
    const su = S.user;
    const name = (su && su.username) || (lu && lu.username) || "사용자";
    const role = ((su && su.role) || (lu && lu.role)) === "admin" ? "관리자" : "사용자";
    $id("acmName").textContent = name;
    $id("acmAva").textContent = name.slice(0, 1).toUpperCase();
    $id("acmSub").textContent = role + " · " + (S.on ? "서버 계정" + (S.remote ? " · 원격 접속" : " · 이 PC") : "이 브라우저 계정");
    const meta = $id("acmMeta");
    if (meta) {
      const bits = [];
      if (su && su.last_login) bits.push("최근 로그인 " + fmtMs(su.last_login * 1000));
      if (S.on && su) bits.push('<span data-kv-status>' + esc(statusText()) + "</span>");
      if (su && (su.default_pw || su.must_change)) bits.push('<b class="acm-warn">⚠ ' + (su.default_pw ? "초기 비밀번호 사용 중" : "임시 비밀번호") + "</b>");
      meta.innerHTML = bits.map((b) => b.indexOf("<") === 0 ? b : "<span>" + esc(b) + "</span>").join("");
    }
    const isAdm = role === "관리자";
    const L = [];
    if (S.on) {
      L.push(["security", "👤", "내 계정 · 비밀번호", "아이디·역할 보기, 비밀번호 바꾸기"]);
      L.push(["security#sess", "💻", "로그인된 기기", "다른 기기 로그아웃 · 실시간 저장 · 되돌리기"]);
    }
    L.push(["settings#llm", "🤖", "AI 연결", "AI 서버·Claude CLI 연결 고르기"]);
    L.push(["settings", "⚙", "설정", "테마·글꼴·화면 폭"]);
    if (isAdm && S.on) L.push(["srvadmin", "🛡", "계정 · 서버 관리", "계정 만들기·잠금·보안 정책·로그·감사"]);
    L.push(["help", "📘", "도움말", "메뉴 지도 · 자주 묻는 질문"]);
    $id("acmLinks").innerHTML = L.map((x) => '<button type="button" class="acm-link" data-acm-go="' + x[0] + '"><span class="acm-li">' + x[1] + "</span><span><b>" + esc(x[2]) + "</b><small>" + esc(x[3]) + "</small></span></button>").join("");
  }
  S.paintAcct = paintAcct;

  document.addEventListener("click", async (e) => {
    const t = e.target.closest && e.target.closest("[data-acm], [data-acm-go], #userChip");
    if (!t) return;
    if (t.id === "userChip") { setTimeout(paintAcct, 0); return; }
    const right = $id("topRight"); const close = () => { if (right) right.classList.remove("sh-acct-open", "open"); };
    if (t.dataset.acmGo) {
      const [nav, part] = t.dataset.acmGo.split("#");
      close();
      try { navTo(nav); } catch (er) { /* 계속 */ }
      if (part) setTimeout(() => { const el = part === "llm" ? $id("llmList") : part === "sess" ? $id("svSess") : null; if (el) el.scrollIntoView({ behavior: "smooth", block: "center" }); }, 700);
      return;
    }
    const k = t.dataset.acm;
    if (k === "pull") { t.disabled = true; await flush(false); await pullNow(); t.disabled = false; return; }
    if (k === "reload") { location.reload(); return; }
    if (k === "pull-x") { const b = $id("syncBar"); if (b) b.remove(); return; }
    if (k === "restore") {
      if (!confirm("계정의 진행 상태를 이 시점으로 되돌릴까요? 지금 상태도 보관 기록에 남아요.")) return;
      await flush(false);
      const d = await S.api("kv", "restore", { name: t.dataset.name });
      if (d.ok) { await loadAll(); location.reload(); } else if (S.notice) S.notice("되돌리지 못했어요: " + (d.message || ""), true);
      return;
    }
  });

  function init() {
    wrapNav();
    paintAcct();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(init, 0)); else setTimeout(init, 0);
  global.addEventListener("load", () => { wrapNav(); paintAcct(); });
})(typeof window !== "undefined" ? window : this);
