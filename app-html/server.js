(function (global) {
  "use strict";
  const userChanged = () => setTimeout(() => { try { global.dispatchEvent(new CustomEvent("slc:user")); } catch (e) { /* 계속 */ } }, 0);   // (v143) 기능 권한을 셸에 알림
  const S = global.SERVER = { on: false, user: null, policy: {}, remote: false, llm: { profiles: [], active: null, is_admin: false, cli: {}, policy: {} } };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $id = (id) => document.getElementById(id);
  const fmtT = (sec) => { if (!sec) return "-"; const d = new Date(sec * 1000); return d.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" }) + " " + d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }); };
  const isAdmin = () => !!(S.user && S.user.role === "admin");

  /* ---------------- 요청 ---------------- */
  async function api(r, op, body, params) {
    let u = "api.php?r=" + r + "&op=" + encodeURIComponent(op);
    Object.keys(params || {}).forEach((k) => { if (params[k] != null && params[k] !== "") u += "&" + k + "=" + encodeURIComponent(params[k]); });
    const init = { method: body === undefined ? "GET" : "POST", cache: "no-store", credentials: "same-origin", headers: {} };
    if (body !== undefined) { init.headers["X-Study-Vault"] = "1"; init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
    let resp;
    try { resp = await fetch(u, init); } catch (e) { return { ok: false, http: 0, message: "서버에 연결할 수 없어요(serve.py 가 켜져 있나요?)" }; }
    let d = null; try { d = await resp.json(); } catch (e) { d = null; }
    if (resp.status === 401 && d && (d.error === "no_session" || d.error === "emergency_ended") && S.user && op !== "login") expired(d.error === "emergency_ended" ? d.message : null);   // (v169) 통합로그인 복구 → 비상 세션 끝
    return Object.assign({ http: resp.status }, d || { ok: false, message: "HTTP " + resp.status });
  }
  S.api = api;

  let _exp = false;
  function expired(msg) {
    if (_exp || !S.user) return; _exp = true;
    S.user = null;
    try { global.Api._dropLocalSession(); } catch (e) { /* 계속 */ }
    alert(msg || "서버 로그인이 끝났어요(만료·다른 곳에서 로그아웃·비밀번호 변경). 다시 로그인해 주세요.");
    location.reload();
  }
  S.expired = expired;

  async function detect() {
    if (location.protocol === "file:") return false;
    try {
      const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
      const t = setTimeout(() => ctl && ctl.abort(), 3500);
      const r = await fetch("api.php?r=auth&op=status", { cache: "no-store", credentials: "same-origin", signal: ctl ? ctl.signal : undefined });
      clearTimeout(t);
      if (!r.ok) return false;
      const d = await r.json();
      if (!d || d.auth !== true) return false;
      S.on = true; S.user = d.user || null; S.policy = d.policy || {}; S.remote = !!d.remote; S.emgNotice = d.notice || null; userChanged();
      return true;
    } catch (e) { return false; }
  }

  /* ---------------- 계정 연동 ---------------- */
  async function localUser() { try { return await LOCAL.currentUser.call(global.Api); } catch (e) { return null; } }
  const LOCAL = {};
  async function syncLocal() {
    const A = global.Api;
    if (!S.user) { try { A._dropLocalSession(); } catch (e) { /* 계속 */ } return; }
    const lu = await localUser();
    if (!lu || String(lu.username).toLowerCase() !== String(S.user.username).toLowerCase()) await A._adoptServerUser(S.user);
    else await A._adoptServerUser(S.user);          // 역할 등 최신화(비밀번호 해시는 그대로)
  }

  function install() {
    const A = global.Api;
    if (!A || A.mode === "remote" || A.serverMode) return;
    ["login", "logout", "register", "currentUser", "updateProfile"].forEach((k) => { LOCAL[k] = A[k]; });
    A.serverMode = true;
    A.login = async function (username, password) {
      const d = await api("auth", "login", { username: username, password: password });
      if (!d.ok) return { ok: false, error: d.error, message: d.message || "로그인하지 못했어요." };
      S.user = d.user; _exp = false; userChanged();
      const u = await A._adoptServerUser(d.user, password);
      await refreshLlm();
      try { await migrateLocalLlm(); } catch (e) { /* 계속 */ }
      // (v92) 계정에 저장된 진행 상태 받기(account.js) → 로그인하면 연구지원 모드로 시작
      let reload = false;
      try { reload = S.hooks && S.hooks.afterLogin ? (await S.hooks.afterLogin()) === "reload" : false; } catch (e) { reload = false; }
      startInResearch();
      if (reload) { try { if (S.syncNow) await S.syncNow(); } catch (e) { /* 계속 */ } location.reload(); return new Promise(() => {}); }
      return { ok: true, user: u };
    };
    A.register = async function (username, password) {
      const d = await api("auth", "signup", { username: username, password: password });
      if (!d.ok) return { ok: false, error: d.error, message: d.message || "가입하지 못했어요." };
      S.user = d.user;
      const u = await A._adoptServerUser(d.user, password);
      await refreshLlm();
      return { ok: true, user: u };
    };
    A.logout = async function () {
      try { if (S.hooks && S.hooks.beforeLogout) await S.hooks.beforeLogout(); } catch (e) { /* 계속 */ }
      await api("auth", "logout", {});
      S.user = null;
      try { A._dropLocalSession(); } catch (e) { /* 계속 */ }
      return { ok: true };
    };
    A.currentUser = async function () { if (!S.user) return null; const u = await LOCAL.currentUser.call(A); return u ? Object.assign({}, u, { server: S.user }) : null; };
    A.updateProfile = async function (patch) {
      patch = patch || {};
      if (patch.password != null || patch.username != null) return { ok: false, error: "server_account", message: "서버 계정의 아이디·비밀번호는 [설정 → 계정·보안]에서 바꿔요." };
      return LOCAL.updateProfile.call(A, patch);
    };
    installLlm(A);
  }

  // 로그인 직후 첫 화면 = 🔬 연구지원(요청). 새로고침은 마지막 모드·화면 그대로 이어서.
  function startInResearch() {
    try { if (global.SHELL && SHELL.setMode) SHELL.setMode("research", false); else { localStorage.setItem("study.shell.mode", JSON.stringify("research")); sessionStorage.setItem("study.shell.mode", JSON.stringify("research")); } } catch (e) { /* 계속 */ }
  }
  S.startInResearch = startInResearch;

  /* ---------------- AI 연결(서버 보관 + 프록시) ---------------- */
  async function refreshLlm() {
    if (!S.user) { S.llm.profiles = []; S.llm.active = null; return; }
    const d = await api("llm", "profiles");
    if (d.ok) { S.llm.profiles = d.profiles || []; S.llm.active = d.active || null; S.llm.is_admin = !!d.is_admin; S.llm.cli = d.cli || {}; S.llm.policy = d.policy || {}; }
  }
  S.refreshLlm = refreshLlm;
  const activeP = () => S.llm.profiles.filter((p) => p.ref === S.llm.active)[0] || null;
  const compat = (p) => ({ id: p.ref, service: p.name, model: p.model, base_url: p.provider === "claude-cli" ? "Claude CLI (이 PC)" : p.base_url, api_key: p.has_key ? "(서버 보관)" : "", params: p.params, note: p.note, scope: p.scope, provider: p.provider });

  function installLlm(A) {
    const L = A.llm;
    L._profile = () => { const p = activeP(); return p ? compat(p) : null; };
    L._requireProfile = () => { const p = activeP(); if (!p) { const e = new Error("AI 연결이 선택되어 있지 않아요. 설정 → AI 연결에서 연결을 고르세요."); e.code = "no_llm"; throw e; } return compat(p); };
    L.isConnected = () => !!activeP();
    L.activeInfo = () => { const p = activeP(); return p ? { id: p.ref, service: p.name, model: p.model, base_url: p.provider === "claude-cli" ? "Claude CLI (이 PC)" : p.base_url, provider: p.provider } : null; };
    // 모든 AI 호출이 지나가는 곳 — 키 없이 서버 프록시로. 응답은 OpenAI 형식(JSON / SSE) 그대로라 complete·generate·chat 은 손대지 않는다.
    L.raw = async function (messages, opts) {
      opts = opts || {};
      L._requireProfile();
      const resp = await fetch("api.php?r=llm&op=chat", {
        method: "POST", cache: "no-store", credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-Study-Vault": "1" },
        body: JSON.stringify({ messages: messages, opts: { temperature: opts.temperature, maxTokens: opts.maxTokens, stream: !!opts.stream } }),
      });
      if (!resp.ok) {
        let d = null; try { d = await resp.json(); } catch (e) { d = null; }
        if (resp.status === 401) expired(d && d.error === "emergency_ended" ? d.message : null);
        const e = new Error((d && d.message) || ("AI 서버 오류 (HTTP " + resp.status + ")")); e.status = resp.status; e.code = d && d.error; throw e;
      }
      if (resp.headers.get("X-AI-Emergency") && global.EMG) EMG.aiNotice();     // (v169) AI 관리 접속 불가 — 저장된 연결로 답함
      return resp;
    };
    L.health = async () => { const d = await api("llm", "health"); return !!d.ok; };
    L.profiles = async () => { await refreshLlm(); return { ok: true, profiles: S.llm.profiles.map(compat), active_id: S.llm.active }; };
    L.importProfiles = async (payload) => {
      let p = payload; if (typeof p === "string") { try { p = JSON.parse(p); } catch (e) { return { ok: false, message: "JSON 형식이 아니에요." }; } }
      const d = await api("llm", "import", { payload: p }); await refreshLlm();
      return d.ok ? { ok: true, added: d.added, profiles: S.llm.profiles.map(compat), active_id: S.llm.active, message: d.message } : { ok: false, message: d.message || "불러오지 못했어요." };
    };
    L.setActive = async (id) => { const d = await api("llm", "active", { ref: id || null }); await refreshLlm(); return { ok: !!d.ok, active_id: S.llm.active, message: d.message }; };
    L.removeProfile = async (id) => { const d = await api("llm", "remove", { ref: id }); await refreshLlm(); return { ok: !!d.ok, message: d.message, profiles: S.llm.profiles.map(compat), active_id: S.llm.active }; };
    L.testProfile = async (id) => { const d = await api("llm", "test", { ref: id }); return { ok: !!d.ok, message: d.message || "" }; };
    L.exportProfiles = async (o) => { const d = await api("llm", "export", { withKeys: !!(o && o.withKeys) }); return d.ok ? { ok: true, payload: d.payload } : { ok: false, message: d.message || "내보내지 못했어요." }; };
  }

  // 예전에 이 브라우저에 저장한 AI 연결(키 포함)을 내 서버 계정으로 옮기고 브라우저 사본을 지운다.
  async function migrateLocalLlm() {
    const lu = await localUser(); if (!lu || !S.user) return;
    const key = "study.user." + lu.id + ".llm";
    const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } };
    const st = read(key); const legacy = isAdmin() ? read("study.llm") : null;
    const list = [].concat((st && st.profiles) || [], (legacy && legacy.profiles) || []).filter((p) => p && p.base_url && p.model);
    if (!list.length) { if (st) localStorage.removeItem(key); return; }
    const payload = { type: "llm-lab-profiles", profiles: list.map((p) => ({ service: p.service, base_url: p.base_url, model: p.model, api_key: p.api_key || "", params: p.params, note: p.note })) };
    const d = await api("llm", "import", { payload: payload });
    if (!d.ok) { notice("브라우저에 있던 AI 연결을 서버로 옮기지 못했어요: " + (d.message || "") + " — [설정 → AI 연결]에서 다시 등록해 주세요.", true); return; }
    await refreshLlm();
    const was = st && st.active_id && (st.profiles || []).filter((p) => p.id === st.active_id)[0];
    if (was) {
      const m = S.llm.profiles.filter((p) => p.scope === "user" && p.base_url === String(was.base_url).replace(/\/+$/, "").replace(/\/chat\/completions$/, "") && p.model === was.model)[0];
      if (m && S.llm.active !== m.ref) { await api("llm", "active", { ref: m.ref }); await refreshLlm(); }
    }
    localStorage.removeItem(key);
    if (legacy) localStorage.removeItem("study.llm");
    const vk = "study.user." + lu.id + ".llmvault"; const v = read(vk); if (v && v.plain) localStorage.removeItem(vk);   // 평문 사본만 지운다(암호문은 둔다)
    notice("이 브라우저에 저장돼 있던 AI 연결 " + d.added + "개를 내 계정(서버)으로 옮기고, 브라우저에 있던 키 사본은 지웠어요.");
  }

  /* ---------------- 알림 ---------------- */
  function notice(text, bad) {
    const n = document.createElement("div"); n.className = "sv-toast" + (bad ? " bad" : ""); n.textContent = text;
    document.body.appendChild(n); setTimeout(() => n.classList.add("on"), 20);
    setTimeout(() => { n.classList.remove("on"); setTimeout(() => n.remove(), 400); }, bad ? 9000 : 6500);
  }
  S.notice = notice;
  function paintBanner() {
    if (global.EMG) EMG.sync(S.user);          // (v169) 비상 세션 띠·관리자 「비상 로그인 발생」 강조
    let b = $id("svBanner");
    const need = S.user && (S.user.default_pw || S.user.must_change);
    if (!need) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement("div"); b.id = "svBanner"; b.className = "sv-banner"; document.body.appendChild(b); }
    b.innerHTML = "🔐 " + (S.user.default_pw ? "초기 비밀번호를 쓰고 있어요 — 이 PC 에서만 로그인돼요." : "관리자가 정해 준 임시 비밀번호예요.") + ' <button type="button" data-sv="go-sec">지금 바꾸기</button><button type="button" class="x" data-sv="ban-x" aria-label="닫기">×</button>';
  }

  /* ---------------- 브라우저 오류 → 서버 client.log ---------------- */
  const Q = [], seen = {};
  let flushT = null;
  function report(lvl, msg, src, line, stack) {
    if (!S.on || !msg) return;
    const k = lvl + msg + src + line, now = Date.now();
    if (seen[k] && now - seen[k] < 60000) return; seen[k] = now;
    let view = "", build = "";
    try { view = state.nav; } catch (e) { /* app.js 전 */ }
    try { build = APP_BUILD; } catch (e) { /* 계속 */ }
    Q.push({ lvl: lvl, msg: String(msg).slice(0, 500), src: String(src || "").replace(location.origin, "").slice(0, 160), line: line || 0, stack: String(stack || "").slice(0, 1500), view: view, build: build });
    if (Q.length > 30) Q.splice(0, Q.length - 30);
    clearTimeout(flushT); flushT = setTimeout(flush, 1500);
  }
  function flush() {
    if (!Q.length) return;
    const items = Q.splice(0, 20);
    try { fetch("api.php?r=log&op=client", { method: "POST", keepalive: true, credentials: "same-origin", headers: { "Content-Type": "application/json", "X-Study-Vault": "1" }, body: JSON.stringify({ items: items }) }).catch(() => {}); } catch (e) { /* 계속 */ }
  }
  global.addEventListener("error", (e) => report("error", e.message, e.filename, e.lineno, e.error && e.error.stack));
  global.addEventListener("unhandledrejection", (e) => { const r = e.reason; report("error", "처리 안 된 Promise 오류: " + ((r && r.message) || r), "", 0, r && r.stack); });
  const _ce = console.error;
  console.error = function () { try { const a = Array.from(arguments); const er = a.filter((x) => x instanceof Error)[0]; report("warn", a.map((x) => (x && x.message) || String(x)).join(" ").slice(0, 500), "", 0, er && er.stack); } catch (e) { /* 계속 */ } return _ce.apply(console, arguments); };
  S.report = report;

  /* =====================================================================
   * 화면 1. 설정 → AI 연결 (서버 모드) — app.js renderLlmSettings 가 부른다
   * =================================================================== */
  let editRef = null, formOpen = false;
  S.renderLlmSettings = async function () {
    const list = $id("llmList"); if (!list) return;
    await refreshLlm();
    const vault = $id("llmVault"); if (vault) vault.classList.add("hidden");
    const warn = $id("llmKeyWarn");
    if (warn) warn.innerHTML = "🔒 연결 정보는 <b>서버의 내 계정</b>에 저장돼요 — 어느 브라우저·기기에서 로그인해도 같은 연결을 써요. API 키는 서버에 <b>암호화</b>돼 있고 브라우저로는 오지 않아요(AI 호출은 서버가 대신 해요). 다른 계정은 내 연결을 볼 수 없어요.";
    const state_ = $id("llmStateLine"); const a = activeP();
    if (state_) state_.textContent = a ? "연결됨 — " + (a.name || a.model) + (a.provider === "claude-cli" ? " (Claude CLI)" : "") + " 로 AI 기능이 동작해요." : "AI 연결이 선택되어 있지 않아요. 아래에서 연결을 추가하거나 고르세요.";
    let box = $id("svLlm");
    if (!box) { box = document.createElement("div"); box.id = "svLlm"; list.parentNode.insertBefore(box, list); }
    const pol = S.llm.policy || {}; const adm = S.llm.is_admin;
    const canOwn = adm || pol.user_llm_profiles !== false;
    box.innerHTML = '<div class="llm-tools">' +
      (canOwn ? '<button type="button" class="big-btn primary" data-sv="llm-new">➕ 연결 추가</button>' : "") +
      (adm ? '<button type="button" class="big-btn ghost-btn" data-sv="llm-cli"' + (S.llm.cli.available === false ? " disabled" : "") + '>🤖 Claude CLI 연결' + (S.llm.cli.version ? " <small>" + esc(S.llm.cli.version) + "</small>" : S.llm.cli.available === false ? " <small>(claude 명령 없음)</small>" : "") + "</button>" : "") +
      '<button type="button" class="big-btn ghost-btn" data-sv="aim-open">AI 관리시스템에서 받기</button>' +
      '<button type="button" class="big-btn ghost-btn" data-sv="llm-export">⬇ 내보내기(키 제외)</button>' +
      (adm ? '<button type="button" class="big-btn ghost-btn" data-sv="llm-export-keys">⬇ 키 포함 내보내기</button>' : "") +
      "</div>" + (canOwn ? "" : '<p class="set-desc">관리자가 개인 연결 등록을 막아 두었어요. 관리자가 공유한 연결을 고르세요.</p>') +
      '<div id="svLlmForm" class="sv-form' + (formOpen ? "" : " hidden") + '"></div><div id="svAim" class="sv-form' + (aimOpen ? "" : " hidden") + '"></div>';
    if (formOpen) paintLlmForm();
    if (aimOpen) paintAim();
    list.innerHTML = "";
    if (!S.llm.profiles.length) { list.innerHTML = '<div class="llm-empty">등록된 연결이 없어요. [➕ 연결 추가]' + (adm ? " 또는 [🤖 Claude CLI 연결]" : "") + "로 만들거나, [📂 프로필 불러오기(JSON)]로 예전 파일을 불러오세요(키는 서버에 암호화돼요).</div>"; return; }
    list.innerHTML = S.llm.profiles.map((p) => {
      const on = p.ref === S.llm.active;
      const aim = p.scope === "aim";
      const badges = (on ? '<span class="llm-badge">연결됨</span>' : "") + '<span class="sv-chip">' + (aim ? "AI 관리시스템" + (p.auto ? " · 기본(자동)" : "") + (p.down ? " · 응답 없음(자기 연결로 대신)" : "") : p.scope === "system" ? ((p.allow && p.allow.length) ? "공용 · 관리자 + 허용 " + p.allow.length + "명" : "공용 · 관리자 전용") : "내 연결") + "</span>" + (p.provider === "claude-cli" ? '<span class="sv-chip cli">Claude CLI</span>' : "");
      const host = aim ? "AI 관리시스템 중계(키는 그쪽에만)" : p.provider === "claude-cli" ? "이 PC 의 claude 명령" : (p.base_url || "").replace(/^https?:\/\//, "");
      return '<div class="llm-item' + (on ? " active" : "") + '"><div class="llm-meta"><div class="llm-name">' + esc(p.name || p.model) + " " + badges + '</div><div class="llm-sub">' + esc(p.model) + " · " + esc(host) +
        (p.provider === "claude-cli" || aim ? "" : (p.has_key ? " · 🔑 " + esc(p.key_hint || "보관됨") : " · 키 없음")) + "</div></div>" +
        '<div class="llm-actions">' + (on ? "" : '<button type="button" class="mini-btn" data-sv="llm-use" data-ref="' + esc(p.ref) + '">연결</button>') +
        '<button type="button" class="mini-btn" data-sv="llm-test" data-ref="' + esc(p.ref) + '">테스트</button>' +
        (p.editable ? '<button type="button" class="mini-btn" data-sv="llm-edit" data-ref="' + esc(p.ref) + '">편집</button><button type="button" class="mini-btn danger-btn" data-sv="llm-del" data-ref="' + esc(p.ref) + '">삭제</button>' : "") + "</div></div>";
    }).join("");
  };

  /* (v139) AI 관리시스템에서 받기(ai-registry/1) — 이 계정이 허용받은 프로필. 통합로그인 연결 계정만 */
  let aimOpen = false;
  async function paintAim() {
    const f = $id("svAim"); if (!f) return;
    f.innerHTML = "<h4>AI 관리시스템에서 받기</h4><p class=\"set-desc\">불러오는 중…</p>";
    const d = await api("llm", "aim");
    const rows = (d.profiles || []).map((p) => {
      const on = p.ref === S.llm.active;
      return '<div class="llm-item' + (on ? " active" : "") + '"><div class="llm-meta"><div class="llm-name">' + esc(p.name) + (on ? ' <span class="llm-badge">연결됨</span>' : "") + '</div><div class="llm-sub">' + esc(p.model || "") + " · " + esc(p.provider || "") + '</div></div><div class="llm-actions">' + (on ? "" : '<button type="button" class="mini-btn" data-sv="llm-use" data-ref="' + esc(p.ref) + '">이걸로 쓰기</button>') + "</div></div>";
    }).join("");
    const a = d.admin;
    f.innerHTML = "<h4>AI 관리시스템에서 받기</h4>" +
      (d.message ? '<p class="set-desc">' + esc(d.message) + "</p>" : "") +
      (rows ? '<div class="llm-list">' + rows + '</div><p class="set-desc">고른 프로필은 AI 관리시스템을 거쳐 부릅니다. AI 관리시스템이 응답하지 않으면 마지막으로 쓴 내 연결로 대신합니다.</p>' : "") +
      (a ? '<div class="sv-grid"><label class="w2">AI 관리시스템 주소(서버끼리)<input id="svAimIn" type="url" value="' + esc(a.internal) + '"></label></div>' +
        '<div class="llm-tools"><button type="button" class="big-btn ghost-btn" data-sv="aim-addr">주소 저장</button>' +
        (a.handoff ? '<button type="button" class="big-btn primary" data-sv="aim-handoff">연결 토큰 가져오기</button>' : "") +
        '<span class="sv-msg" id="svAimMsg">' + (a.hasToken ? "연결 토큰 있음" : a.handoff ? "토큰 파일이 와 있습니다" : "연결 토큰 없음") + "</span></div>" : "") +
      '<div class="llm-tools"><button type="button" class="big-btn ghost-btn" data-sv="aim-close">닫기</button></div>';
  }

  function paintLlmForm(preset) {
    const f = $id("svLlmForm"); if (!f) return;
    const p = editRef ? S.llm.profiles.filter((x) => x.ref === editRef)[0] : null;
    const v = Object.assign({ provider: "openai", name: "", base_url: "", model: "", params: { temperature: 0.7, max_tokens: 2048, timeout_ms: 120000 }, note: "", scope: "user", allow: [] }, p || {}, preset || {});
    const adm = S.llm.is_admin; const cli = v.provider === "claude-cli";
    const pr = v.params || {};
    f.innerHTML = '<h4>' + (p ? "연결 고치기" : "새 연결") + "</h4>" +
      '<div class="sv-grid">' +
      '<label>종류<select id="svLp"><option value="openai"' + (cli ? "" : " selected") + '>OpenAI 호환 API (vLLM·Ollama·LM Studio·OpenRouter·OpenAI…)</option>' + (adm ? '<option value="claude-cli"' + (cli ? " selected" : "") + ">Claude CLI — 이 PC 에 로그인된 Claude Code</option>" : "") + "</select></label>" +
      '<label>이름<input id="svLn" type="text" maxlength="80" value="' + esc(v.name) + '" placeholder="예: 연구실 Qwen 서버"></label>' +
      (cli ? "" : '<label class="w2">주소(base_url)<input id="svLu" type="url" value="' + esc(v.base_url) + '" placeholder="https://…/v1"></label>') +
      '<label>모델' + (cli ? '<select id="svLm">' + ["sonnet", "opus", "haiku", "default"].map((m) => '<option value="' + m + '"' + (v.model === m ? " selected" : "") + ">" + { sonnet: "Sonnet (균형)", opus: "Opus (최고 성능)", haiku: "Haiku (빠름)", default: "CLI 기본값" }[m] + "</option>").join("") + "</select>" : '<input id="svLm" type="text" value="' + esc(v.model) + '" placeholder="예: Qwen/Qwen3-32B">') + "</label>" +
      (cli ? "" : '<label>API 키<input id="svLk" type="password" autocomplete="new-password" placeholder="' + (p && p.has_key ? "바꿀 때만 입력 (지금: " + esc(p.key_hint) + ")" : "없으면 비워 두기") + '"></label>') +
      (cli ? "" : '<label>온도<input id="svLt" type="number" step="0.1" min="0" max="2" value="' + esc(pr.temperature) + '"></label><label>최대 토큰<input id="svLx" type="number" min="16" max="64000" value="' + esc(pr.max_tokens) + '"></label>') +
      '<label>시간 제한(초)<input id="svLo" type="number" min="5" max="600" value="' + esc(Math.round((pr.timeout_ms || 120000) / 1000)) + '"></label>' +
      '<label class="w2">메모<input id="svLnote" type="text" maxlength="200" value="' + esc(v.note) + '"></label>' +
      (adm && !cli ? '<label class="chk"><input id="svLs" type="checkbox"' + (v.scope === "system" ? " checked" : "") + (p ? " disabled" : "") + "> 공용 연결로 만들기(관리자 보관)</label>" : "") +
      (adm && (v.scope === "system" || cli || !p) ? '<div class="w2 llm-allow" id="svLallow" data-allow="' + esc(JSON.stringify(v.allow || [])) + '"><b>공용 연결 쓸 수 있는 사람</b> <small>기본 관리자 전용 · 일반 사용자는 사람별로 허용' + (cli ? " — 허용하면 그 사람도 이 PC 의 Claude 구독을 써요" : "") + "</small><div class=\"llm-allow-list\">불러오는 중…</div></div>" : "") +
      "</div>" + (cli ? '<p class="set-desc">서버가 <code>claude -p</code> 를 도구·MCP·설정 없이(빈 작업 폴더) 실행해 답만 받아요. 온도·최대 토큰은 CLI 가 정해요. 한 번에 2개까지 처리해요.</p>' : "") +
      '<div class="llm-tools"><button type="button" class="big-btn primary" data-sv="llm-save">저장</button><button type="button" class="big-btn ghost-btn" data-sv="llm-cancel">취소</button></div>';
    const sel = $id("svLp"); if (sel) sel.onchange = () => paintLlmForm({ provider: sel.value, name: $id("svLn").value });
    const al = $id("svLallow");                   // (v166) 사람별 허용 — 일반 사용자 목록(관리자는 늘 전부 씀)
    if (al) api("auth", "users").then((d) => {
      const box = al.querySelector(".llm-allow-list"); if (!box) return;
      const on = JSON.parse(al.dataset.allow || "[]");
      const us = ((d && d.list) || []).filter((u) => u.role !== "admin");
      box.innerHTML = us.length ? us.map((u) => '<label class="chk"><input type="checkbox" data-allow-uid="' + esc(u.id) + '"' + (on.indexOf(u.id) >= 0 ? " checked" : "") + "> " + esc(u.display || u.username) + " <small>" + esc(u.username) + "</small></label>").join("") : "<small>일반 사용자 없음</small>";
    });
  }
  async function saveLlm() {
    const g = (id) => { const e = $id(id); return e ? e.value : undefined; };
    const prov = g("svLp") || "openai";
    const p = editRef ? S.llm.profiles.filter((x) => x.ref === editRef)[0] : null;
    const body = { id: p ? p.id : null, provider: prov, name: g("svLn"), base_url: g("svLu"), model: g("svLm"), api_key: g("svLk") || "", note: g("svLnote"),
      params: { temperature: g("svLt") != null ? Number(g("svLt")) : undefined, max_tokens: g("svLx") != null ? Number(g("svLx")) : undefined, timeout_ms: Math.round(Number(g("svLo") || 120) * 1000) },
      scope: p ? p.scope : ($id("svLs") && $id("svLs").checked ? "system" : prov === "claude-cli" ? "system" : "user") };
    if ($id("svLallow") && $id("svLallow").querySelector("[data-allow-uid]")) body.allow = [...document.querySelectorAll("[data-allow-uid]")].filter((x) => x.checked).map((x) => x.dataset.allowUid);
    const d = await api("llm", "save", { profile: body });
    if (!d.ok) { msg("⚠️ " + (d.message || "저장하지 못했어요.")); return; }
    formOpen = false; editRef = null;
    msg("✅ 저장했어요" + (body.api_key ? " (키는 서버에 암호화)" : "") + ". [테스트]로 확인해 보세요.");
    after();
  }
  const msg = (t) => { try { llmMsg(t); } catch (e) { /* 계속 */ } };
  const after = () => { try { afterLlmChange(); } catch (e) { S.renderLlmSettings(); } };

  /* =====================================================================
   * 화면 2. 설정 → 계정·보안 (모든 계정)
   * =================================================================== */
  let secArea = null, admArea = null;
  const EV_LABEL = { login: "로그인", login_fail: "로그인 실패", lockout: "잠김", logout: "로그아웃", password_change: "비밀번호 변경", session_revoke: "기기 로그아웃",
    llm_profile_save: "AI 연결 저장", llm_profile_remove: "AI 연결 삭제", user_create: "계정 만듦", user_update: "계정 변경", user_delete: "계정 삭제", policy_change: "보안 정책 변경",
    signup: "가입", seed_admin: "초기 관리자 생성", admin_denied: "관리자 기능 거부", login_rate_limited: "시도 과다 차단" };
  const uaShort = (ua) => { ua = String(ua || ""); const b = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : ua ? ua.slice(0, 24) : "알 수 없음"; const o = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : ""; return b + (o ? " · " + o : ""); };

  async function openSecurity() {
    if (!S.on) { secArea.innerHTML = offMsg(); return; }
    const u = S.user || {};
    secArea.innerHTML = '<div class="sv"><div class="sv-head"><h2>계정 · 보안</h2><p>이 서버(serve.py)의 계정이에요. 비밀번호는 서버에 해시로만 저장되고, 로그인은 이 브라우저의 HttpOnly 쿠키로 유지돼요.</p></div>' +
      (u.default_pw || u.must_change ? '<div class="sv-alert">🔐 ' + (u.default_pw ? "초기 비밀번호를 쓰고 있어요. 이 상태로는 <b>이 PC 에서만</b> 로그인돼요(터널·다른 기기 불가). 아래에서 바꿔 주세요." : "관리자가 정해 준 임시 비밀번호예요. 나만 아는 비밀번호로 바꿔 주세요.") + "</div>" : "") +
      '<section class="card sv-card"><h3>내 계정</h3><dl class="sv-dl"><dt>아이디</dt><dd>' + esc(u.username) + "</dd><dt>역할</dt><dd>" + (u.role === "admin" ? "관리자" : "사용자") + "</dd><dt>마지막 로그인</dt><dd>" + fmtT(u.last_login) + (u.last_ip ? " · " + esc(u.last_ip) : "") + "</dd><dt>지금 접속</dt><dd>" + (S.remote ? "원격(터널·LAN)" : "이 PC") + "</dd></dl></section>" +
      '<section class="card sv-card"><h3>비밀번호 바꾸기</h3><div class="sv-grid"><label>지금 비밀번호<input id="svPc" type="password" autocomplete="current-password"></label><label>새 비밀번호<input id="svPn" type="password" autocomplete="new-password" placeholder="' + (S.policy.min_password || 8) + '자 이상"></label><label>새 비밀번호 확인<input id="svPn2" type="password" autocomplete="new-password"></label></div><div class="llm-tools"><button type="button" class="big-btn primary" data-sv="pw">바꾸기</button><span class="sv-msg" id="svPwMsg"></span></div><p class="set-desc">바꾸면 다른 기기의 로그인은 모두 끊겨요(지금 이 브라우저는 유지).</p></section>' +
      '<section class="card sv-card hidden" id="svSso"><h3>통합로그인</h3><div id="svSsoB"></div></section>' +
      '<section class="card sv-card"><h3>로그인된 기기</h3><div id="svSess">불러오는 중…</div></section>' +
      '<section class="card sv-card"><h3>진행 저장 (계정 동기화)</h3><div id="svSync">불러오는 중…</div></section>' +
      '<section class="card sv-card"><h3>내 보안 기록</h3><div id="svMyAudit">불러오는 중…</div></section>' +
      '<section class="card sv-card"><h3>내 데이터는 어디에</h3><ul class="sv-ul"><li>연구 프로젝트·대화·문서 버전·AI 연결: 서버 데이터 폴더의 <code>users/' + esc(u.id) + "/</code></li><li>설정·학습 자료 읽기 상태: 서버의 내 계정(실시간 저장)</li><li>AI 키: 서버에 AES-256-GCM 으로 암호화 · 브라우저로 내려오지 않음</li></ul></section></div>";
    paintSessions(); paintMyAudit(); paintMySso();
    if (S.hooks && S.hooks.paintSync) S.hooks.paintSync();
  }
  /* (v135) 내 계정 ↔ 통합로그인 계정 전환 */
  async function paintMySso() {
    const sec = $id("svSso"), box = $id("svSsoB"); if (!box) return;
    const d = await api("sso", "status"); const u = S.user || {};
    if (!d.ok || (d.mode === "off" && !u.sso && u.role !== "admin")) { sec.classList.add("hidden"); return; }   // 관리자는 켜기 전에 자기 계정을 먼저 전환한다(잠김 방지)
    sec.classList.remove("hidden");
    if (u.sso) {
      const can = d.mode !== "only" && !(u.role === "admin" && d.mode !== "off");
      box.innerHTML = '<p class="set-desc">통합로그인 계정 <b>' + esc(u.sso_name || "") + "</b> 에 연결되어 있습니다. 로그인은 통합로그인으로 합니다.</p>" +
        (can ? '<div class="sv-grid"><label>새 로컬 비밀번호<input id="svSsoPw" type="password" autocomplete="new-password" placeholder="' + (S.policy.min_password || 8) + '자 이상"></label><label>새 비밀번호 확인<input id="svSsoPw2" type="password" autocomplete="new-password"></label></div>' +
          '<div class="llm-tools"><button type="button" class="big-btn ghost-btn" data-sv="sso-local">로컬 계정으로 전환</button><span class="sv-msg" id="svSsoMsg"></span></div><p class="set-desc">전환하면 통합로그인 계정 연결을 풀고 이 비밀번호로 로그인합니다.</p>'
          : '<p class="set-desc">' + (d.mode === "only" ? "통합로그인 전용 모드라 로컬 계정으로 바꿀 수 없습니다." : "통합로그인을 켠 동안에는 관리자 계정을 로컬로 바꿀 수 없습니다.") + "</p>");
    } else {
      box.innerHTML = '<p class="set-desc">이 계정을 통합로그인 계정에 연결합니다. 연결하면 로컬 비밀번호 로그인은 꺼지고 통합로그인으로 들어옵니다.</p>' +
        (u.role === "admin" ? '<p class="set-desc">관리자 계정은 통합로그인에서 admin 이상인 계정에만 연결됩니다. 연결 뒤 관리자 권한은 통합로그인 역할을 따릅니다.</p>' : "") + '<div class="llm-tools"><a class="big-btn primary" href="/sso/start?link=1">통합로그인 계정으로 전환</a></div>';
    }
  }
  async function paintSessions() {
    const d = await api("auth", "sessions"); const box = $id("svSess"); if (!box) return;
    if (!d.ok) { box.textContent = d.message || "불러오지 못했어요."; return; }
    box.innerHTML = '<table class="sv-tbl"><thead><tr><th>기기</th><th>IP</th><th>마지막 사용</th><th>시작</th><th></th></tr></thead><tbody>' + d.list.map((s) =>
      "<tr><td>" + esc(uaShort(s.ua)) + (s.remote ? ' <span class="sv-chip">원격</span>' : "") + "</td><td>" + esc(s.ip) + "</td><td>" + fmtT(s.last_seen) + "</td><td>" + fmtT(s.created) + "</td><td>" +
      (s.current ? '<span class="sv-chip ok">이 브라우저</span>' : '<button type="button" class="mini-btn" data-sv="revoke" data-key="' + esc(s.key) + '">로그아웃</button>') + "</td></tr>").join("") + "</tbody></table>" +
      (d.list.length > 1 ? '<div class="llm-tools"><button type="button" class="big-btn ghost-btn" data-sv="revoke-all">다른 기기 모두 로그아웃</button></div>' : "");
  }
  async function paintMyAudit() {
    const d = await api("auth", "myaudit"); const box = $id("svMyAudit"); if (!box) return;
    if (!d.ok || !d.list.length) { box.innerHTML = '<p class="set-desc">기록이 아직 없어요.</p>'; return; }
    box.innerHTML = '<ul class="sv-log">' + d.list.slice(0, 30).map((r) => '<li class="' + (r.ok === false ? "bad" : "") + '"><time>' + esc(String(r.ts || "").replace("T", " ").slice(0, 16)) + "</time><b>" + esc(EV_LABEL[r.event] || r.event) + "</b><span>" + esc([r.ip, r.reason, r.profile, r.provider].filter(Boolean).join(" · ")) + "</span></li>").join("") + "</ul>";
  }

  /* =====================================================================
   * 화면 3. 관리자 → 계정 · 서버 관리
   * =================================================================== */
  let admTab = (function () { try { const t = sessionStorage.getItem("svTab"); sessionStorage.removeItem("svTab"); return t || "users"; } catch (e) { return "users"; } })(), logTimer = null;
  document.addEventListener("click", (e) => { if (e.target.closest("[data-sv-ssov]")) { try { sessionStorage.setItem("svTab", "sso"); } catch (er) { /* 계속 */ } } }, true);   // 확인하고 돌아오면 이 탭으로
  async function openAdmin() {
    if (!S.on) { admArea.innerHTML = offMsg(); return; }
    if (!isAdmin()) { admArea.innerHTML = '<div class="sv"><p class="lb-warn">관리자만 볼 수 있어요.</p></div>'; return; }
    clearInterval(logTimer);
    admArea.innerHTML = '<div class="sv"><div class="sv-head"><h2>계정 · 서버 관리</h2><p>serve.py 의 계정·보안 정책·서버 상태·로그. 모든 변경은 감사 기록(audit.log)에 남아요.</p></div>' +
      '<div class="sv-tabs">' + [["users", "계정"], ["policy", "보안 정책"], ["sso", "통합로그인"], ["server", "서버 · 로그"]].map((t) => '<button type="button" data-sv="atab" data-tab="' + t[0] + '" class="' + (admTab === t[0] ? "on" : "") + '">' + t[1] + "</button>").join("") + '</div><div id="svAdm"></div></div>';
    if (admTab === "users") paintUsers(); else if (admTab === "policy") paintPolicy(); else if (admTab === "sso") paintSsoAdmin(); else paintServer();
  }
  const genPw = () => { const c = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"; const a = new Uint32Array(12); crypto.getRandomValues(a); return Array.from(a, (x) => c[x % c.length]).join("").replace(/(.{4})(.{4})(.{4})/, "$1-$2-$3"); };
  async function paintUsers() {
    const box = $id("svAdm"); const d = await api("auth", "users");
    if (!d.ok) { box.innerHTML = '<p class="lb-warn">' + esc(d.message) + "</p>"; return; }
    const st = d.stats || {};
    box.innerHTML = '<p class="set-desc">계정 ' + st.users + "개 · 관리자 " + st.admins + " · 열린 세션 " + st.sessions + "</p>" +
      '<section class="card sv-card"><h3>계정 만들기</h3><div class="sv-grid"><label>아이디<input id="svNu" type="text" maxlength="24" placeholder="2~24자"></label><label>임시 비밀번호<input id="svNp" type="text" value="' + genPw() + '"></label><label>역할<select id="svNr"><option value="user">사용자</option><option value="admin">관리자</option></select></label></div>' +
      '<div class="llm-tools"><button type="button" class="big-btn primary" data-sv="u-create">만들기</button><span class="sv-msg" id="svUMsg"></span></div><p class="set-desc">임시 비밀번호는 다음 로그인 때 바꾸라고 안내해요. 받는 사람에게 안전한 방법으로 전해 주세요.</p></section>' +
      '<table class="sv-tbl"><thead><tr><th>아이디</th><th>역할</th><th>기능</th><th>상태</th><th>마지막 로그인</th><th></th></tr></thead><tbody>' + d.list.map((u) =>
        "<tr><td><b>" + esc(u.username) + "</b>" + (u.sso ? ' <span class="sv-chip ok" title="통합로그인 계정 ' + esc(u.sso_name || "") + '">통합로그인' + (u.migrated ? " 이관" : "") + "</span>" : u.migrated ? ' <span class="sv-chip bad" title="통합로그인 연결이 풀린 계정 — 비번 초기화로 로컬 로그인을 되살린다">연결 해제·비번 없음</span>' : "") + (u.default_pw ? ' <span class="sv-chip bad">초기 비번</span>' : u.must_change ? ' <span class="sv-chip">임시 비번</span>' : "") + (u.id === S.user.id ? ' <span class="sv-chip ok">나</span>' : "") + "</td>" +
        '<td><select data-sv-role="' + esc(u.id) + '"><option value="user"' + (u.role === "user" ? " selected" : "") + '>사용자</option><option value="admin"' + (u.role === "admin" ? " selected" : "") + ">관리자</option></select></td>" +
        "<td>" + featCell(u) + "</td>" +
        "<td>" + (u.status === "locked" ? '<span class="sv-chip bad">잠김(관리자)</span>' : u.locked_until ? '<span class="sv-chip bad">잠김(실패)</span>' : '<span class="sv-chip ok">사용 중</span>') + "</td><td>" + fmtT(u.last_login) + (u.last_ip ? "<br><small>" + esc(u.last_ip) + "</small>" : "") + "</td>" +
        '<td class="sv-acts"><button type="button" class="mini-btn" data-sv="u-reset" data-id="' + esc(u.id) + '" data-name="' + esc(u.username) + '"' + (u.sso && u.migrated ? ' disabled title="통합로그인 이관 계정 — 비밀번호는 통합로그인에서 관리"' : "") + '>비번 초기화</button>' +
        (u.id === S.user.id ? "" : '<button type="button" class="mini-btn" data-sv="u-lock" data-id="' + esc(u.id) + '" data-to="' + (u.status === "locked" || u.locked_until ? "active" : "locked") + '">' + (u.status === "locked" || u.locked_until ? "잠금 풀기" : "잠그기") + '</button><button type="button" class="mini-btn danger-btn" data-sv="u-del" data-id="' + esc(u.id) + '" data-name="' + esc(u.username) + '">삭제</button>') + "</td></tr>").join("") + "</tbody></table>" +
      '<p class="set-desc">삭제해도 그 계정의 데이터 폴더(users/&lt;id&gt;)는 지우지 않아요(보존).</p>';
  }
  const FEATS = [["research", "연구지원"], ["library", "자료 학습"]];
  function featCell(u) {
    if (u.role === "admin") return '<span class="sv-chip ok">전부 · 관리자</span>';
    if (u.modes_src === "ulogin") return FEATS.filter((f) => (u.modes || []).indexOf(f[0]) >= 0).map((f) => '<span class="sv-chip">' + f[1] + "</span>").join(" ") + '<br><small>통합로그인에서 관리</small>';
    return '<span class="sv-feats">' + FEATS.map((f) => '<label><input type="checkbox" data-sv-feat="' + esc(u.id) + '" value="' + f[0] + '"' + ((u.modes || []).indexOf(f[0]) >= 0 ? " checked" : "") + ">" + f[1] + "</label>").join("") + "</span>";
  }
  async function paintPolicy() {
    const box = $id("svAdm"); const d = await api("auth", "policy");
    if (!d.ok) { box.innerHTML = '<p class="lb-warn">' + esc(d.message) + "</p>"; return; }
    const p = d.policy;
    const ck = (k, t, sub) => '<label class="sv-row"><input type="checkbox" data-pol="' + k + '"' + (p[k] ? " checked" : "") + "><span><b>" + t + "</b><small>" + sub + "</small></span></label>";
    box.innerHTML = '<section class="card sv-card"><h3>로그인</h3>' +
      ck("allow_signup", "스스로 가입 허용", "끄면 관리자가 만든 계정만 쓸 수 있어요(권장).") +
      ck("remote_default_pw", "초기 비밀번호 계정의 원격 로그인 허용", "켜면 터널·LAN 으로도 admin 초기 비밀번호가 통해요 — 권장하지 않아요.") +
      '<div class="sv-grid"><label>비밀번호 최소 길이<input type="number" min="6" max="64" data-pol-n="min_password" value="' + p.min_password + '"></label><label>로그인 유지(일)<input type="number" min="1" max="365" data-pol-n="session_days" value="' + p.session_days + '"></label></div></section>' +
      '<section class="card sv-card"><h3>AI 연결</h3>' +
      ck("user_llm_profiles", "일반 사용자가 자기 AI 연결을 등록", "끄면 관리자가 공유한 연결만 고를 수 있어요.") +
      ck("user_llm_private_hosts", "일반 사용자가 사설망·localhost 주소 등록", "서버가 대신 요청하므로 내부망 노출(SSRF) 위험 — 믿을 수 있는 사용자만 있을 때만 켜세요.") +
      '</section><div class="llm-tools"><button type="button" class="big-btn primary" data-sv="pol-save">정책 저장</button><span class="sv-msg" id="svPolMsg"></span></div>';
  }
  /* (v135) 통합로그인 설정 — 현재 상태 → 바꿀 값 → 위험한 동작 순서 */
  const SSO_MODE = { off: ["로컬만", "로컬 아이디·비밀번호로만 로그인합니다."], choice: ["로컬 · 통합로그인 고르기", "로그인 화면에서 고릅니다. 통합로그인 관리자 계정으로 전환한 관리자가 생기면 그때부터 로컬 관리자 계정은 쓰지 않습니다."], only: ["통합로그인만", "통합로그인 계정만 씁니다. 로컬 관리자 계정은 쓰지 않습니다."] };
  function ulinkCard(x) {
    if (!x) return "";
    const t = (s) => (s ? new Date(s * 1000).toLocaleString("ko-KR") : "아직 없음");
    return '<section class="card sv-card"><h3>계정 목록 보내기 · 계정 연결(통합로그인 관리)</h3><p class="set-desc">통합로그인 관리자가 이 목록을 보고 통합로그인 계정과 이 시스템 계정을 연결하거나 풉니다. 비밀번호는 보내지 않습니다. 서버가 켜질 때 한 번, 계정이 바뀌면 1분 안에 자동으로 보냅니다.</p>' +
      '<dl class="sv-dl"><dt>마지막 전체 전송</dt><dd>' + esc(t(x.last_full)) + "</dd><dt>마지막 전송</dt><dd>" + esc(t(x.last_push)) + (x.pending ? " · 보낼 변경 " + x.pending + "건" : "") + "</dd><dt>계정</dt><dd>" + x.accounts + "개</dd>" +
      (x.last_error ? '<dt>마지막 실패</dt><dd><span class="sv-chip bad">' + esc(x.last_error.code) + "</span> " + esc(t(x.last_error.at)) + "</dd>" : "") + "</dl>" +
      '<div class="llm-tools"><button type="button" class="big-btn ghost-btn" data-sv="ulink-push"' + (x.ready ? "" : " disabled") + '>지금 전체 보내기</button><button type="button" class="big-btn ghost-btn" data-sv="ulink-feed"' + (x.ready ? "" : " disabled") + '>연결 변경 받기</button><span class="sv-msg" id="svUlMsg"></span></div></section>';
  }
  /* (v157) 로그·감사 이원화 — 통합로그인 수집 API 로 보내는 상태 */
  function platCard(p) {
    if (!p) return "";
    const t = (s) => (s ? new Date(s * 1000).toLocaleString("ko-KR") : "아직 없음");
    const row = (name, x) => {
      const st = x.unsupported ? '<span class="sv-chip">미지원(통합로그인 v1.9.0 전) · 6시간마다 확인</span>'
        : x.pause_until > Date.now() / 1000 ? '<span class="sv-chip bad">멈춤 ~ ' + esc(t(x.pause_until)) + "</span>" : '<span class="sv-chip ok">보내는 중</span>';
      return "<dt>" + name + "</dt><dd>" + st + " · 대기 " + x.pending + "건 · 보냄 " + (x.accepted + x.duplicate) + "건" + (x.rejected ? " · 거절 " + x.rejected : "") + (x.quarantined ? " · 격리 " + x.quarantined : "") +
        (x.dropped ? " · 버린 로그 " + x.dropped : "") + (x.last_error ? ' <small>마지막 실패: ' + esc(x.last_error.err || "") + "</small>" : "") + (x.alert ? ' <span class="sv-chip bad">감사 스풀 상한 넘음</span>' : "") + "</dd>";
    };
    return '<section class="card sv-card"><h3>로그·감사 이원화(통합로그인)</h3><p class="set-desc">로그·감사는 이 시스템에 먼저 저장하고, 같은 기록을 통합로그인에도 보냄. 보내지 못해도 이 시스템 동작에는 영향 없음</p>' +
      '<dl class="sv-dl">' + row("감사", p.audit) + row("로그(경고 이상)", p.logs) + "</dl>" +
      '<div class="llm-tools"><button type="button" class="big-btn ghost-btn" data-sv="plat-send"' + (p.ready ? "" : " disabled") + '>지금 보내기</button><span class="sv-msg" id="svPlMsg"></span></div></section>';
  }
  async function paintSsoAdmin() {
    const box = $id("svAdm"); const d = await api("sso", "conf");
    if (!d.ok) { box.innerHTML = '<p class="lb-warn">' + esc(d.message) + "</p>"; return; }
    const chip = (ok, a, b) => '<span class="sv-chip ' + (ok ? "ok" : "bad") + '">' + (ok ? a : b) + "</span>";
    box.innerHTML = '<section class="card sv-card"><h3>지금 상태</h3><dl class="sv-dl"><dt>모드</dt><dd><b>' + esc(SSO_MODE[d.mode][0]) + "</b> · " + esc(SSO_MODE[d.mode][1]) + "</dd>" +
      "<dt>통합로그인 서버</dt><dd>" + chip(d.up, "응답함", "응답 없음") + " <code>" + esc(d.internal) + "</code> · 브라우저용 <code>" + esc(d.public) + "</code></dd>" +
      "<dt>서비스</dt><dd><code>" + esc(d.service_id) + "</code> · 비밀값 " + chip(d.hasSecret, "들어 있음", "없음") + (d.handoff ? ' <button type="button" class="mini-btn" data-sv="sso-handoff">ulogin 이 둔 비밀값 가져오기</button>' : "") +
        (d.rename ? ' <button type="button" class="mini-btn" data-sv="sso-rename" data-to="' + esc(d.rename.to) + '">서비스 id 를 ' + esc(d.rename.to) + " 로 바꾸기</button>" : "") + "</dd>" +
      "<dt>내 계정</dt><dd>" + (d.linkedAdmin ? chip(true, "통합로그인 관리자 계정으로 전환됨", "") : '<a class="mini-btn" href="/sso/start?link=1" data-sv-ssov>통합로그인 관리자 계정으로 전환</a> <small>[로컬 · 통합로그인 고르기]는 전환 전에도 켤 수 있고, 전환하면 그때부터 로컬 관리자 로그인이 막힙니다. [통합로그인만]은 전환한 뒤에 켭니다.</small>') + "</dd></dl></section>" +
      '<section class="card sv-card"><h3>주소</h3><div class="sv-grid"><label>로그인 화면(브라우저, 공개 도메인)<input id="svSsoPub" type="url" value="' + esc(d.public) + '"></label><label>code 교환(서버끼리)<input id="svSsoIn" type="url" value="' + esc(d.internal) + '"></label></div>' +
      '<div class="llm-tools"><button type="button" class="big-btn ghost-btn" data-sv="sso-addr">주소 저장</button><span class="sv-msg" id="svSsoAddrMsg"></span></div><p class="set-desc">같은 PC 면 교환 주소는 http://127.0.0.1:8197, 아니면 https://login.example.com 입니다. 복귀 주소는 https://learning.example.com/sso/callback 하나입니다.</p></section>' +
      '<section class="card sv-card"><h3>모드 바꾸기</h3><div class="sso-modes">' + Object.keys(SSO_MODE).map((k) => '<button type="button" class="big-btn ghost-btn' + (d.mode === k ? " on" : "") + '" data-sv="sso-mode" data-mode="' + k + '">' + SSO_MODE[k][0] + "</button>").join("") + "</div>" +
      '<p class="set-desc">통합로그인을 켜면 관리자 권한은 통합로그인에서 admin 이상인 사람에게만 주고, 로컬 관리자 계정은 쓰지 않습니다. 데이터는 지우지 않으며 로컬만으로 돌리면 되살아납니다.</p><span class="sv-msg" id="svSsoAMsg"></span></section>' +
      '<section class="card sv-card"><h3>연결된 계정 ' + d.links.length + "</h3>" + (d.links.length ? '<table class="sv-tbl"><thead><tr><th>이 시스템 계정</th><th>통합로그인 계정</th><th>권한</th><th>마지막 로그인</th><th></th></tr></thead><tbody>' +
        d.links.map((x) => "<tr><td><b>" + esc(x.display) + "</b> <small>" + esc(x.username) + "</small></td><td>" + esc(x.ulogin || "") + "</td><td>" + (x.admin ? '<span class="sv-chip ok">관리자</span>' : "사용자") + "</td><td>" + fmtT(x.seen) + '</td><td><button type="button" class="mini-btn" data-sv="sso-unlink" data-id="' + esc(x.id) + '" data-name="' + esc(x.username) + '">연결 풀기</button></td></tr>').join("") + "</tbody></table>" : '<p class="set-desc">아직 연결된 계정이 없습니다.</p>') + "</section>" +
      ulinkCard(d.ulink) + platCard(d.platlog) +
      '<section class="card sv-card"><h3>비상 복구</h3><p class="set-desc">통합로그인 서버가 멈췄거나 관리자가 들어오지 못할 때, 서버 PC 에서 <code>python tools/sso_off.py</code> 를 실행하면 로컬만 모드로 돌아갑니다. 웹에서는 할 수 없습니다.</p></section>';
  }
  async function paintServer() {
    const box = $id("svAdm"); const d = await api("admin", "info");
    if (!d.ok) { box.innerHTML = '<p class="lb-warn">' + esc(d.message) + "</p>"; return; }
    const up = d.uptime, h = Math.floor(up / 3600), m = Math.floor(up / 60) % 60;
    const kb = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + "MB" : Math.round(n / 1024) + "KB";
    box.innerHTML = '<section class="card sv-card"><h3>서버</h3><dl class="sv-dl"><dt>버전</dt><dd>' + esc(d.version) + " · PID " + d.pid + " · 켜진 지 " + h + "시간 " + m + "분" + (d.lan ? " · LAN 공개" : "") + "</dd><dt>파이썬</dt><dd><code>" + esc(d.python) + "</code></dd><dt>데이터 폴더</dt><dd><code>" + esc(d.data_dir) + "</code></dd><dt>로그 폴더</dt><dd><code>" + esc(d.log_dir) + "</code></dd>" +
      "<dt>계정</dt><dd>" + d.auth.users + "개 · 세션 " + d.auth.sessions + (d.auth.default_pw ? ' · <span class="sv-chip bad">초기 비밀번호 계정 있음</span>' : "") + "</dd><dt>Claude CLI</dt><dd>" + (d.cli.available ? "✓ " + esc(d.cli.version) : "✗ 없음") + "</dd><dt>라이브러리</dt><dd>" + Object.keys(d.ws.libs || {}).map((k) => (d.ws.libs[k] ? "✓ " : "✗ ") + k).join(" · ") + "</dd>" +
      "<dt>로그 크기</dt><dd>" + Object.keys(d.log_sizes).map((k) => k + " " + kb(d.log_sizes[k])).join(" · ") + "</dd></dl><p class=\"set-desc\">켜고 끄기·실시간 로그는 PC 의 <b>ScholarFlow 런처</b>(GUI)에서 더 편하게 볼 수 있어요.</p></section>" +
      '<section class="card sv-card"><h3>로그 보기</h3><div class="sv-logbar"><select id="svLf">' + [["activity", "조작 감사(모든 조작)"], ["audit", "보안 감사"], ["server", "서버(전체)"], ["error", "오류·경고"], ["access", "접근"], ["llm", "AI 호출"], ["client", "브라우저 오류"]].map((x) => '<option value="' + x[0] + '">' + x[1] + "</option>").join("") + '</select><select id="svLogU"><option value="">모든 계정</option></select><input id="svLogD" type="date" title="지난 날짜(감사 로그는 날짜별 파일로 10년 보관) — 비우면 오늘"><select id="svLl"><option value="">모든 수준</option><option value="INFO">INFO+</option><option value="WARNING">WARNING+</option><option value="ERROR">ERROR</option></select><input id="svLq" type="search" placeholder="찾기"><label class="chk"><input id="svLa" type="checkbox"> 5초마다</label><button type="button" class="mini-btn" data-sv="log-load">불러오기</button></div><div id="svLogs" class="sv-logs"></div></section>';
    loadLogs();
    $id("svLa").onchange = (e) => { clearInterval(logTimer); if (e.target.checked) logTimer = setInterval(() => { if (!admArea || admArea.classList.contains("hidden")) { clearInterval(logTimer); return; } loadLogs(); }, 5000); };
    ["svLf", "svLl", "svLogU", "svLogD"].forEach((id) => { $id(id).onchange = loadLogs; });
    api("auth", "users").then((u) => { const s = $id("svLogU"); if (u.ok && s) s.innerHTML += u.list.map((x) => '<option value="' + esc(x.id) + '">' + esc(x.username) + "</option>").join(""); });
    $id("svLq").onkeydown = (e) => { if (e.key === "Enter") loadLogs(); };
  }
  async function loadLogs() {
    const box = $id("svLogs"); if (!box) return;
    const day = $id("svLogD") && $id("svLogD").value; const today = new Date(); const td = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
    const d = await api("auth", "logs", undefined, { file: $id("svLf").value, level: $id("svLl").value, q: $id("svLq").value, user: $id("svLogU") ? $id("svLogU").value : "", day: day && day !== td ? day : "", lines: 400 });
    if (!d.ok) { box.textContent = d.message || "불러오지 못했어요."; return; }
    if (!d.list.length) { box.innerHTML = '<p class="set-desc">기록이 없어요.</p>'; return; }
    const skip = { ts: 1, lvl: 1, cat: 1, msg: 1 };
    box.innerHTML = d.list.map((r) => '<div class="sv-lr ' + esc(String(r.lvl).toLowerCase()) + '"><time>' + esc(String(r.ts).slice(5, 19).replace("T", " ")) + "</time><i>" + esc(r.lvl) + "</i><em>" + esc(r.cat) + "</em><b>" + esc(r.msg) + "</b><span>" +
      esc(Object.keys(r).filter((k) => !skip[k] && r[k] != null && r[k] !== "").map((k) => k + "=" + (typeof r[k] === "object" ? JSON.stringify(r[k]) : r[k])).join("  ")) + "</span></div>").join("");
  }

  const offMsg = () => '<div class="sv"><div class="sv-head"><h2>서버 모드가 아니에요</h2><p>계정·보안과 서버 관리는 로컬 서버(serve.py)로 열었을 때만 쓸 수 있어요. 프로젝트 폴더에서 <code>python serve.py</code> 또는 <b>ScholarFlow 런처</b>로 켠 뒤 <code>http://127.0.0.1:18162</code> 로 열어 주세요.</p></div></div>';

  /* ---------------- 클릭 ---------------- */
  document.addEventListener("click", async (e) => {
    const t = e.target.closest && e.target.closest("[data-sv]"); if (!t) return;
    const k = t.dataset.sv;
    if (k === "go-sec") { try { navTo("security"); } catch (er) { /* 계속 */ } return; }
    if (k === "ban-x") { const b = $id("svBanner"); if (b) b.remove(); return; }
    if (k === "llm-new") { editRef = null; formOpen = true; $id("svLlmForm").classList.remove("hidden"); paintLlmForm(); return; }
    if (k === "llm-cli") { editRef = null; formOpen = true; $id("svLlmForm").classList.remove("hidden"); paintLlmForm({ provider: "claude-cli", name: "Claude (이 PC)", model: "sonnet" }); return; }
    if (k === "llm-edit") { editRef = t.dataset.ref; formOpen = true; $id("svLlmForm").classList.remove("hidden"); paintLlmForm(); return; }
    if (k === "llm-export" || k === "llm-export-keys") {
      const wk = k === "llm-export-keys";
      if (wk && !confirm("API 키가 그대로(평문) 들어 있는 파일을 내려받아요. 옮긴 뒤에는 파일을 지워 주세요. 계속할까요?")) return;
      const r = await global.Api.llm.exportProfiles({ withKeys: wk });
      if (!r.ok) { msg("⚠️ " + r.message); return; }
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(r.payload, null, 2)], { type: "application/json" })); a.download = "llm-lab-profiles_" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + ".json"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      msg(wk ? "내려받았어요. 다 쓰면 파일을 지워 주세요." : "내려받았어요(키 제외).");
      return;
    }
    if (k === "llm-cancel") { formOpen = false; editRef = null; $id("svLlmForm").classList.add("hidden"); return; }
    if (k === "llm-save") { t.disabled = true; try { await saveLlm(); } finally { t.disabled = false; } return; }
    if (k === "aim-open") { aimOpen = true; const f = $id("svAim"); if (f) f.classList.remove("hidden"); paintAim(); return; }
    if (k === "aim-close") { aimOpen = false; const f = $id("svAim"); if (f) f.classList.add("hidden"); return; }
    if (k === "aim-addr") { const d = await api("llm", "aim_addr", { internal: $id("svAimIn").value }); msg(d.ok ? "주소를 저장했어요." : "⚠️ " + d.message); paintAim(); return; }
    if (k === "aim-handoff") { const d = await api("llm", "aim_handoff", {}); msg(d.ok ? "연결 토큰을 넣고 파일을 지웠어요." : "⚠️ " + d.message); paintAim(); return; }
    if (k === "llm-use") { const d = await api("llm", "active", { ref: t.dataset.ref }); msg(d.ok ? "연결했어요." : "⚠️ " + d.message); after(); return; }
    if (k === "llm-test") { msg("테스트 중… (Claude CLI 는 몇 초 걸려요)"); t.disabled = true; const d = await api("llm", "test", { ref: t.dataset.ref }); t.disabled = false; msg((d.ok ? "✅ " : "⚠️ ") + (d.message || "")); return; }
    if (k === "llm-del") { const p = S.llm.profiles.filter((x) => x.ref === t.dataset.ref)[0]; if (!confirm("'" + (p ? p.name : "") + "' 연결을 지울까요? (저장된 키도 함께 지워져요)")) return; const d = await api("llm", "remove", { ref: t.dataset.ref }); msg(d.ok ? "삭제했어요." : "⚠️ " + d.message); after(); return; }
    if (k === "pw") {
      const c = $id("svPc").value, n = $id("svPn").value, n2 = $id("svPn2").value, m = $id("svPwMsg");
      if (n !== n2) { m.textContent = "새 비밀번호 두 칸이 달라요."; return; }
      const d = await api("auth", "password", { current: c, new: n });
      if (!d.ok) { m.textContent = "⚠️ " + d.message; return; }
      S.user = d.user; try { await global.Api._adoptServerUser(d.user, n); } catch (er) { /* 계속 */ }
      paintBanner(); notice("비밀번호를 바꿨어요" + (d.revoked ? " · 다른 기기 " + d.revoked + "곳을 로그아웃했어요" : "") + ".");
      openSecurity(); return;
    }
    if (k === "revoke") { await api("auth", "revoke", { key: t.dataset.key }); paintSessions(); return; }
    if (k === "revoke-all") { if (!confirm("이 브라우저를 뺀 모든 기기에서 로그아웃할까요?")) return; const d = await api("auth", "revoke", { all: true }); notice(d.revoked + "곳을 로그아웃했어요."); paintSessions(); return; }
    if (k === "atab") { admTab = t.dataset.tab; openAdmin(); return; }
    if (k === "sso-mode") {
      const md = t.dataset.mode, m = $id("svSsoAMsg");
      if (md !== "off" && !confirm("통합로그인을 켜면 로컬 관리자 계정으로는 로그인할 수 없습니다. 통합로그인 관리자로 다시 로그인해야 합니다. 켤까요?")) return;
      const d = await api("sso", "mode", { mode: md });
      if (!d.ok) { m.textContent = d.message || "바꾸지 못했습니다."; return; }
      if (d.relogin) { alert("모드를 바꿨습니다. 로컬 관리자 세션이 끝나 통합로그인으로 다시 로그인합니다."); location.reload(); return; }
      notice("모드를 바꿨습니다."); paintSsoAdmin(); return;
    }
    if (k === "sso-unlink") { if (!confirm("'" + t.dataset.name + "' 의 통합로그인 계정 연결을 풀까요? 로컬 로그인을 쓰려면 비번 초기화로 임시 비밀번호를 주세요.")) return; const d = await api("sso", "unlink", { id: t.dataset.id }); notice(d.ok ? d.message : d.message || "풀지 못했습니다."); paintSsoAdmin(); return; }
    if (k === "sso-addr") { const d = await api("sso", "addr", { public: $id("svSsoPub").value, internal: $id("svSsoIn").value }); $id("svSsoAddrMsg").textContent = d.ok ? "저장했습니다." : d.message || "저장하지 못했습니다."; if (d.ok) paintSsoAdmin(); return; }
    if (k === "sso-rename") {     // (v150) 서비스 id 전환 — 확인 후에만
      const to = t.dataset.to || "";
      if (!confirm("통합로그인 서비스 id 를 " + to + " 로 바꿉니다.\n비밀값은 그대로 두고, 로그인 시작·교환·계정 목록 전송에 새 id 를 씁니다. 바꿀까요?")) return;
      const d = await api("sso", "rename", { to }); notice(d.ok ? d.message : d.message || "바꾸지 못했습니다."); paintSsoAdmin(); return;
    }
    if (k === "sso-handoff") { const d = await api("sso", "handoff", {}); notice(d.ok ? d.message : d.message || "가져오지 못했습니다."); paintSsoAdmin(); return; }
    if (k === "sso-local") {
      const a = $id("svSsoPw").value, b = $id("svSsoPw2").value, m = $id("svSsoMsg");
      if (a !== b) { m.textContent = "두 칸이 다릅니다."; return; }
      const d = await api("sso", "to_local", { password: a });
      if (!d.ok) { m.textContent = d.message || "바꾸지 못했습니다."; return; }
      const st = await api("auth", "status"); if (st.user) S.user = st.user;
      notice("로컬 계정으로 바꿨습니다. 다음부터 아이디와 새 비밀번호로 로그인합니다."); openSecurity(); return;
    }
    if (k === "u-create") {
      const d = await api("auth", "user_create", { username: $id("svNu").value, password: $id("svNp").value, role: $id("svNr").value });
      if (!d.ok) { $id("svUMsg").textContent = "⚠️ " + d.message; return; }
      notice("'" + d.user.username + "' 계정을 만들었어요. 임시 비밀번호를 전해 주세요."); paintUsers(); return;
    }
    if (k === "u-reset") {
      const pw = prompt("'" + t.dataset.name + "' 의 새 임시 비밀번호(다음 로그인 때 바꾸게 해요). 이 계정의 모든 로그인이 끊겨요.", genPw());
      if (!pw) return;
      const d = await api("auth", "user_update", { id: t.dataset.id, reset_password: pw });
      notice(d.ok ? "비밀번호를 초기화했어요." : "⚠️ " + d.message, !d.ok); paintUsers(); return;
    }
    if (k === "plat-send") {
      t.disabled = true;
      const d = await api("sso", "platlog_send", {});
      t.disabled = false;
      const m = $id("svPlMsg"); if (m) m.textContent = d.ok ? "✓ 보냈어요(대기 감사 " + d.platlog.audit.pending + " · 로그 " + d.platlog.logs.pending + ")" : "⚠️ " + (d.message || "실패");
      return;
    }
    if (k === "ulink-push" || k === "ulink-feed") {
      t.disabled = true;
      const d = await api("sso", k === "ulink-push" ? "ulink_push" : "ulink_feed", {});
      t.disabled = false;
      const m = $id("svUlMsg"); if (m) m.textContent = d.ok ? (k === "ulink-push" ? "✓ 계정 " + d.sent + "개를 보냈어요." : "✓ 연결 변경 " + (d.applied || 0) + "건을 반영했어요.") : "⚠️ " + (d.message || "실패");
      return;
    }
    if (k === "u-lock") { const d = await api("auth", "user_update", { id: t.dataset.id, status: t.dataset.to }); if (!d.ok) notice("⚠️ " + d.message, true); paintUsers(); return; }
    if (k === "u-del") { if (!confirm("'" + t.dataset.name + "' 계정을 지울까요? 로그인은 즉시 끊기고, 데이터 폴더는 보존돼요.")) return; const d = await api("auth", "user_delete", { id: t.dataset.id }); notice(d.ok ? "지웠어요." : "⚠️ " + d.message, !d.ok); paintUsers(); return; }
    if (k === "pol-save") {
      const pol = {}; document.querySelectorAll("[data-pol]").forEach((c) => { pol[c.dataset.pol] = c.checked; }); document.querySelectorAll("[data-pol-n]").forEach((c) => { pol[c.dataset.polN] = parseInt(c.value, 10) || 0; });
      const d = await api("auth", "policy", { policy: pol }); $id("svPolMsg").textContent = d.ok ? "✓ 저장했어요." : "⚠️ " + d.message; return;
    }
    if (k === "log-load") { loadLogs(); return; }
  });
  document.addEventListener("change", async (e) => {
    const fc = e.target.closest && e.target.closest("[data-sv-feat]");
    if (fc) {
      const id = fc.dataset.svFeat, ms = [...document.querySelectorAll('[data-sv-feat="' + CSS.escape(id) + '"]')].filter((x) => x.checked).map((x) => x.value);
      if (!ms.length) { fc.checked = true; notice("⚠️ 기능을 하나 이상 남겨 주세요.", true); return; }
      const d = await api("auth", "user_update", { id: id, modes: ms });
      notice(d.ok ? "기능 권한을 바꿨어요. 그 계정은 다음 화면 갱신부터 고른 기능만 봐요." : "⚠️ " + d.message, !d.ok); if (!d.ok) paintUsers();
      return;
    }
    const r = e.target.closest && e.target.closest("[data-sv-role],[data-sv-plan]"); if (!r) return;
    const patch = { id: r.dataset.svRole || r.dataset.svPlan }; if (r.dataset.svRole) patch.role = r.value; else patch.plan = r.value;
    const d = await api("auth", "user_update", patch);
    notice(d.ok ? "바꿨어요." : "⚠️ " + d.message, !d.ok); if (!d.ok) paintUsers();
  });

  /* ---------------- 등록 ---------------- */
  function build() {
    const content = document.querySelector("main.content"); if (!content || secArea || typeof EXT_VIEWS === "undefined") return;
    secArea = document.createElement("section"); secArea.id = "svSecArea"; secArea.className = "hidden";
    admArea = document.createElement("section"); admArea.id = "svAdmArea"; admArea.className = "hidden";
    content.appendChild(secArea); content.appendChild(admArea);
    EXT_VIEWS.security = { area: secArea, open: openSecurity, avail: () => S.on && !!S.user };
    EXT_VIEWS.srvadmin = { area: admArea, open: openAdmin, avail: () => S.on && isAdmin() };
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build); else build();

  S.ready = detect().then(async (on) => {
    if (!on) return false;
    install();
    if (S.policy.allow_signup && typeof CONFIG !== "undefined") { try { CONFIG.ALLOW_SIGNUP = true; } catch (e) { /* 계속 */ } }
    try { await syncLocal(); } catch (e) { /* 계속 */ }
    if (S.user) {
      await refreshLlm(); try { await migrateLocalLlm(); } catch (e) { /* 계속 */ }
      let r = null; try { r = S.hooks && S.hooks.boot ? await S.hooks.boot() : null; } catch (e) { r = null; }   // 다른 기기에서 진행한 상태 받기
      if (r === "reload") { location.reload(); await new Promise(() => {}); }
      setTimeout(paintBanner, 800);
    }
    const sub = () => { const s = $id("authSub"); if (s && !S.policy.allow_signup) s.textContent = "로그인하세요."; };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", sub); else sub();
    return true;
  }).then((on) => { if (on) setInterval(() => { if (S.user && document.visibilityState === "visible") api("auth", "status").then((d) => { if (d.ok && !d.user && S.user) expired(d.notice); else if (d.ok && d.user) { const was = JSON.stringify((S.user || {}).modes); S.user = d.user; paintBanner(); if (was !== JSON.stringify(d.user.modes)) userChanged(); } }); }, 120000); return on; });
  S.paintBanner = paintBanner;

  /* ---------------- (v94) 브랜드 옆 버전 뱃지 ----------------
   *   서버가 알려 주는 판 번호(serve.py APP_VERSION, 예: v94) + 화면 자산 빌드(?v=…)를 툴팁으로.
   *   이름 바로 뒤에 별도 요소(.ver-badge)로 둔다 — 긴 이름은 … 로 줄고 뱃지는 늘 보이며, 이름이 숨으면 같이 숨는다. */
  S.version = "";
  fetch("api.php?r=health", { cache: "no-store" }).then((r) => r.json()).then((d) => { S.version = (d && d.version) || ""; paintVer(); }).catch(() => {});
  function paintVer() {
    let build = ""; try { build = APP_BUILD || ""; } catch (e) { build = ""; }
    const v = S.version || (build ? "b" + build : "");
    if (!v) return;
    const tip = "버전 " + (S.version || "-") + (build ? " · 화면 빌드 " + build : "");
    // (v111) 이름 아래 둘째 줄에 버전 — 이름 글자 크기는 그대로
    document.querySelectorAll("#brandName, .sh-brand-t, .sh-rail-name").forEach((el) => {
      let b = el.nextElementSibling;
      if (!b || !(b.classList.contains("ver-badge") || b.classList.contains("ver"))) { b = document.createElement("span"); el.insertAdjacentElement("afterend", b); }
      const cls = window.RUIAPP && RUIAPP.on() ? "ver" : "ver-badge";   // (v131) 새 테마는 공용 .ver 한 줄 뱃지
      if (b.className !== cls) b.className = cls;
      if (b.textContent !== v) b.textContent = v;
      if (b.title !== tip) b.title = tip;
      const hide = getComputedStyle(el).display === "none";
      if (b.hidden !== hide) b.hidden = hide;
    });
  }
  setInterval(paintVer, 2000);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", paintVer); else paintVer();
})(typeof window !== "undefined" ? window : this);
