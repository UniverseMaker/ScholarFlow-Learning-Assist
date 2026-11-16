"use strict";

(function (global) {
  // config.js 는 `const CONFIG = {...}` 로 선언한다. 최상위 const 는 window 프로퍼티가
  // 되지 않으므로 global.CONFIG 는 undefined 다 → 렉시컬 전역 CONFIG 를 우선 참조한다.
  const CFG = (typeof CONFIG !== "undefined" && CONFIG) ? CONFIG : (global.CONFIG || {});
  const MODE = String(CFG.API_MODE || "local").toLowerCase();

  /* =======================================================================
   * A. localStorage 네임스페이스 & 키 이관 (study.*)
   *    - 지금은 단일 사용자. §2 의 사용자별 키(study.user.<id>.*)는 다음 패스(B)
   *      에서 도입하며, 그때 study.progress → study.user.<id>.progress.<domain>
   *      로 이관할 수 있게 구조만 잡아 둔다.
   * ===================================================================== */
  const NS = {
    root: "study.progress",   // 진행 root { active_domain, settings, domains:{<id>:subtree} }
    display: "study.display",  // 표시 설정 { theme, mode, fontscale, layout, width }
    users: "study.users",      // User[]
    session: "study.session",    // Ledger[]
    system: "study.system",
    llm: "study.llm",
  };

  /* =====================================================================
   * B9. LLM 서버 프로필 — 기본 연결 없음(사용자가 프로필을 불러와 선택해야 동작)
   *   저장: study.llm = { v:1, profiles:[Profile], active_id:string|null }
   *   Profile = { id, service, base_url, model, api_key, params:{temperature,max_tokens,top_p,timeout_ms}, note }
   *   가져오기 포맷: llm-lab-profiles.json ({type:"llm-lab-profiles", profiles:[...]}) 또는 프로필 배열/단일.
   * =================================================================== */
  const LLM_DEFAULT_PARAMS = { temperature: 0.7, max_tokens: 2048, top_p: 1, timeout_ms: 120000 };

  /* v71: AI 연결 프로필은 **계정별**(study.user.<id>.llm). 같은 브라우저의 다른 계정은 서로의 키를 볼 수 없다.
   *   예전 전역 키(study.llm)는 관리자 계정이 처음 읽을 때 그 계정으로 한 번 옮기고 지운다(다른 계정엔 절대 안 줌).
   *   로그인 전에는 빈 저장소(연결 없음). */
  function defaultLlmStore() { return { v: 1, profiles: [], active_id: null }; }
  function llmKeyFor(uid) { return uid ? "study.user." + uid + ".llm" : null; }
  function loadLlmStore() {
    const uid = currentUserId(); const key = llmKeyFor(uid);
    if (!key) return defaultLlmStore();
    let raw = rawGet(key);
    if (raw == null) {
      const legacy = rawGet(NS.llm);
      if (legacy && typeof legacy === "object" && isAdminUid(uid)) { rawSet(key, legacy); raw = legacy; }
      if (legacy != null && isAdminUid(uid)) rawDel(NS.llm);
    }
    if (!raw || typeof raw !== "object") return defaultLlmStore();
    return { v: 1, profiles: Array.isArray(raw.profiles) ? raw.profiles : [], active_id: raw.active_id || null };
  }
  function saveLlmStore(st) { const key = llmKeyFor(currentUserId()); if (!key) return st; rawSet(key, st); return st; }
  // 파일·보관함용 바깥 형식(llm-lab-profiles) — 내부 Profile → { service, base_url, model, auth:{api_key}, params, note }
  function llmToExternal(profiles, withKeys) {
    return { type: "llm-lab-profiles", version: 1, created: Date.now(),
      profiles: (profiles || []).map((p) => ({ id: p.id, service: p.service, base_url: p.base_url, model: p.model,
        auth: { api_key: withKeys ? (p.api_key || "") : "" }, params: p.params || {}, note: p.note || "" })) };
  }
  /* ---- 계정 보관함(서버 DB 대응) : study.user.<id>.llmvault ----
   *   { v:1, updated, count, summary:[{service,model,base_url}], enc:{alg,kdf,iter,salt,iv,ct}|null, plain:{type:"llm-lab-profiles",…}|null, active_id }
   *   암호 문구를 주면 AES-GCM(PBKDF2-SHA256 210k) 로 암호화 → 관리자·DB 가 봐도 키를 못 읽는다. 문구를 잊으면 복구 불가.
   *   서버 모드는 같은 계약으로 GET/PUT/DELETE /me/llm/vault — 서버가 토큰의 user_id 로만 읽고 쓴다(요청 본문의 id 는 무시). */
  const VAULT_ITER = 210000;
  function vaultKeyFor(uid) { return uid ? "study.user." + uid + ".llmvault" : null; }
  const _b64 = (u8) => { let s2 = ""; u8.forEach((x) => { s2 += String.fromCharCode(x); }); return btoa(s2); };
  const _unb64 = (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
  async function vaultKey(pass, salt, iter) {
    const base = await SUBTLE.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
    return SUBTLE.deriveKey({ name: "PBKDF2", salt: salt, iterations: iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function vaultEncrypt(obj, pass) {
    const salt = new Uint8Array(16), iv = new Uint8Array(12); CRYPTO.getRandomValues(salt); CRYPTO.getRandomValues(iv);
    const k = await vaultKey(pass, salt, VAULT_ITER);
    const ct = new Uint8Array(await SUBTLE.encrypt({ name: "AES-GCM", iv: iv }, k, new TextEncoder().encode(JSON.stringify(obj))));
    return { alg: "AES-GCM-256", kdf: "PBKDF2-SHA256", iter: VAULT_ITER, salt: _b64(salt), iv: _b64(iv), ct: _b64(ct) };
  }
  async function vaultDecrypt(enc, pass) {
    const k = await vaultKey(pass, _unb64(enc.salt), enc.iter || VAULT_ITER);
    const pt = await SUBTLE.decrypt({ name: "AES-GCM", iv: _unb64(enc.iv) }, k, _unb64(enc.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }
  /* v75: DB 없는 공용 보관함 — serve.py 가 프로젝트 폴더(userdata/llm-vault/)에 **암호문만** 파일로 둔다.
   *   브라우저 localStorage 는 브라우저마다 따로라 다른 브라우저·PC 에서 받아 쓸 수 없었다(v71 의 한계).
   *   조회 id = PBKDF2(암호 문구, "study-llmvault-id-v1|"+계정 이름) 64 hex → 이름+문구를 모르면 찾지도 못한다.
   *   정적 호스팅(서버 API 없음)이면 자동으로 '이 브라우저만' + 암호화 파일 옮기기로 떨어진다. */
  let FILE_VAULT = null;                                   // null=모름 · true/false
  let FILE_VAULT_INFO = {};                                // serve.py /api/health — shared(동기화 폴더) · lan
  async function fileVaultAvailable() {
    if (FILE_VAULT !== null) return FILE_VAULT;
    if (location.protocol === "file:") return (FILE_VAULT = false);
    // api.php — PHP 공용 호스팅에선 app-html/api.php 가, 로컬에선 serve.py 가 같은 규칙으로 답한다(정적 호스팅이면 실패 → 이 브라우저만)
    try { const r = await fetch("api.php?r=health", { cache: "no-store" }); const d = r.ok ? await r.json() : null; FILE_VAULT = !!(d && d.vault); FILE_VAULT_INFO = d || {}; }
    catch (e) { FILE_VAULT = false; }
    return FILE_VAULT;
  }
  async function vaultLookupId(username, pass) {
    const base = await SUBTLE.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveBits"]);
    const bits = await SUBTLE.deriveBits({ name: "PBKDF2", salt: new TextEncoder().encode("study-llmvault-id-v1|" + String(username || "").trim().toLowerCase()), iterations: VAULT_ITER, hash: "SHA-256" }, base, 256);
    return Array.from(new Uint8Array(bits)).map((x) => x.toString(16).padStart(2, "0")).join("");
  }
  async function fileVaultReq(method, id, body) {
    // 쓰기·지우기도 POST(PUT/DELETE 를 막는 공용 호스팅이 많다) — op=put|delete
    const op = method === "PUT" ? "&op=put" : method === "DELETE" ? "&op=delete" : "";
    const r = await fetch("api.php?r=vault&id=" + id + op, { method: method === "GET" ? "GET" : "POST", cache: "no-store",
      headers: Object.assign({ "X-Study-Vault": "1" }, body ? { "Content-Type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined });
    let d = null; try { d = await r.json(); } catch (e) { d = null; }
    return { status: r.status, data: d };
  }
  function vaultFileMetaKey(uid) { return uid ? "study.user." + uid + ".llmvault_file" : null; }
  function vaultNeedsCrypto() { return !SUBTLE ? { ok: false, message: "이 주소에서는 브라우저 암호화를 쓸 수 없어요(https 또는 localhost 로 여세요)." } : null; }

  // 파일/보관함에서 받은 프로필을 지금 계정 저장소에 넣는다(replace | merge). active 는 자동 연결하지 않는다(요청 시에만).
  function llmApplyProfiles(external, mode, activeId) {
    const parsed = parseLlmProfilesPayload(external);
    if (!parsed.ok) return parsed;
    const st = loadLlmStore();
    if (mode === "replace") st.profiles = [];
    parsed.profiles.forEach((np) => {
      const dup = st.profiles.findIndex((x) => x.base_url === np.base_url && x.model === np.model);
      if (dup >= 0) { np.id = st.profiles[dup].id; st.profiles[dup] = np; return; }
      let id = np.id, n = 2; while (st.profiles.some((x) => x.id === id)) { id = np.id + "-" + n; n++; }
      np.id = id; st.profiles.push(np);
    });
    if (activeId && st.profiles.some((x) => x.id === activeId)) st.active_id = activeId;
    else if (st.active_id && !st.profiles.some((x) => x.id === st.active_id)) st.active_id = null;
    saveLlmStore(st);
    return { ok: true, added: parsed.profiles.length, profiles: st.profiles, active_id: st.active_id };
  }

  function llmSlug(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || ("p" + Date.now());
  }
  // 외부 프로필(JSON) → 내부 Profile 로 정규화. 형식이 달라도 최대한 받아낸다.
  function normalizeLlmProfile(raw) {
    if (!raw || typeof raw !== "object") return null;
    const base = String(raw.base_url || raw.baseUrl || (raw.endpoints && raw.endpoints.chat_completions || "").replace(/\/chat\/completions$/, "") || "").trim().replace(/\/$/, "");
    const model = String(raw.model || raw.MODEL || "").trim();
    if (!base || !model) return null;
    const key = String((raw.auth && raw.auth.api_key) || raw.api_key || raw.API_KEY || "").trim();
    const pr = raw.params || {};
    return {
      id: llmSlug(raw.id || raw.service || raw.host || model),
      service: String(raw.service || raw.model_note || model).slice(0, 120),
      base_url: base,
      model: model,
      api_key: key,
      params: {
        temperature: Number(pr.temperature != null ? pr.temperature : LLM_DEFAULT_PARAMS.temperature),
        max_tokens: Number(pr.max_tokens != null ? pr.max_tokens : LLM_DEFAULT_PARAMS.max_tokens),
        top_p: Number(pr.top_p != null ? pr.top_p : LLM_DEFAULT_PARAMS.top_p),
        timeout_ms: Number(pr.timeout_ms != null ? pr.timeout_ms : LLM_DEFAULT_PARAMS.timeout_ms),
      },
      note: String(raw.network || raw.model_note || "").slice(0, 200),
    };
  }
  function parseLlmProfilesPayload(payload) {
    let data = payload;
    if (typeof data === "string") { try { data = JSON.parse(data); } catch (e) { return { ok: false, message: "JSON 형식이 아니에요." }; } }
    let list = [];
    if (Array.isArray(data)) list = data;
    else if (data && Array.isArray(data.profiles)) list = data.profiles;
    else if (data && typeof data === "object") list = [data];
    const out = [];
    for (const r of list) { const n = normalizeLlmProfile(r); if (n) out.push(n); }
    if (!out.length) return { ok: false, message: "불러올 수 있는 프로필이 없어요(base_url·model 필요)." };
    return { ok: true, profiles: out };
  }
  // 현재 활성 프로필(없으면 null → 미연결)
  function activeLlmProfile() {
    const st = loadLlmStore();
    if (!st.active_id) return null;
    return st.profiles.find((p) => p.id === st.active_id) || null;
  }

  function rawGet(key) {
    try { const v = localStorage.getItem(key); return v == null ? null : JSON.parse(v); }
    catch (e) { return null; }
  }
  function rawSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { return false; }
  }
  function rawDel(key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } }

  // 아직 구현되지 않은(다음 패스) 스텁 응답 — 던지지 않고 표식만 반환(앱 중단 금지).
  function stub(name) {
    return Promise.resolve({ ok: false, stub: true, message: "다음 패스에서 구현됩니다: " + name });
  }

  const AUTH = {
    PBKDF2_ITER: 150000,          // PBKDF2 반복(느릴수록 무차별 대입에 강함)
    SALT_BYTES: 16,               // 사용자별 랜덤 솔트 길이(바이트)
    SESSION_TTL_MS: 30 * 24 * 60 * 60 * 1000, // 세션 유효기간 30일
  };
  // SubtleCrypto: 브라우저 window.crypto, Node(단위검증) globalThis.crypto 모두 지원.
  const CRYPTO = (typeof globalThis !== "undefined" && globalThis.crypto) ? globalThis.crypto
    : (typeof crypto !== "undefined" ? crypto : null);
  const SUBTLE = CRYPTO && CRYPTO.subtle ? CRYPTO.subtle : null;

  function userProgressKey(id) { return "study.user." + id + ".progress"; }
  function userDisplayKey(id) { return "study.user." + id + ".display"; }

  function _hex(buf) {
    const b = new Uint8Array(buf); let s = "";
    for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
    return s;
  }
  function _hexToBytes(hex) {
    hex = String(hex || "");
    const a = new Uint8Array(hex.length / 2);
    for (let i = 0; i < a.length; i++) a[i] = parseInt(hex.substr(i * 2, 2), 16);
    return a;
  }
  function _randHex(nBytes) {
    const a = new Uint8Array(nBytes);
    if (CRYPTO && CRYPTO.getRandomValues) CRYPTO.getRandomValues(a);
    else for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
    return _hex(a.buffer);
  }
  async function _pbkdf2Hex(password, saltHex, iter) {
    const enc = new TextEncoder();
    const km = await SUBTLE.importKey("raw", enc.encode(String(password)), { name: "PBKDF2" }, false, ["deriveBits"]);
    const bits = await SUBTLE.deriveBits(
      { name: "PBKDF2", salt: _hexToBytes(saltHex), iterations: iter, hash: "SHA-256" }, km, 256);
    return _hex(bits);
  }
  // 길이 고정 비교(타이밍 편차 최소화). 해시는 hex 문자열.
  function _constEq(a, b) {
    a = String(a || ""); b = String(b || "");
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  function loadUsers() { const u = rawGet(NS.users); return Array.isArray(u) ? u : []; }
  function saveUsers(u) { return rawSet(NS.users, u); }
  function findUserByName(name) {
    const n = String(name || "").trim().toLowerCase();
    return loadUsers().filter((u) => (u.username || "").toLowerCase() === n)[0] || null;
  }
  function findUserById(id) { return loadUsers().filter((u) => u.id === id)[0] || null; }
  function publicUser(u) {
    if (!u) return null;
    return { id: u.id, username: u.username, role: u.role || "user", plan: u.plan || "free", created: u.created || 0 };
  }
  function getSession() { return rawGet(NS.session); }
  function startSession(uid) {
    const s = { token: _randHex(16), user_id: uid, expires: Date.now() + AUTH.SESSION_TTL_MS };
    rawSet(NS.session, s);
    return s;
  }
  function clearSession() { rawDel(NS.session); }

  // 현재 세션 사용자 id (없거나 만료·미존재면 null).
  function currentUserId() {
    const s = getSession();
    if (!s || !s.user_id) return null;
    if (s.expires && Date.now() > s.expires) return null; // 만료
    return findUserById(s.user_id) ? s.user_id : null;    // 사용자 삭제 방어
  }
  function currentUserObj() {
    const uid = currentUserId();
    if (!uid) return null;
    return publicUser(findUserById(uid));
  }
  // 진행/표시 저장 키 — 로그인 사용자별 네임스페이스(미로그인 시 레거시 단일 키).
  function rootKeyFor() { const uid = currentUserId(); return uid ? userProgressKey(uid) : NS.root; }
  function displayKeyFor() { const uid = currentUserId(); return uid ? userDisplayKey(uid) : NS.display; }

  // Pass A 단일 진행(study.progress) → 최초 사용자로 1회 이관(유실 금지). 이후 원본 제거.
  function claimLegacyProgress(uid) {
    try {
      const legacy = rawGet(NS.root); // "study.progress" (Pass A 단일)
      if (legacy == null) return false;
      const key = userProgressKey(uid);
      if (rawGet(key) == null) rawSet(key, legacy); // 사용자 진행이 비어 있을 때만 이식
      rawDel(NS.root);                              // 한 번만 이관되도록 원본 제거
      return true;
    } catch (e) { return false; }
  }
  function _pad2(n) { return String(n).padStart(2, "0"); }

  function userRole(uid) {
    const u = findUserById(uid);
    return u ? (u.role || "user") : "user";
  }
  function isAdminUid(uid) { return userRole(uid) === "admin"; }
  function _slug(s) {
    return "s_" + String(s || "").trim().toLowerCase().replace(/[^a-z0-9가-힣]+/gi, "_").slice(0, 40);
  }

  /* =======================================================================
   * B5. 관리자 시드 (로그인 잠금) : 최초 로드시 admin 계정(role=admin)이 없으면 생성.
   *   config.ADMIN_SEED = { username, password } (기본 admin/1234).
   *   비밀번호는 PBKDF2 해시로만 저장(평문 금지). 이미 있으면 아무것도 안 함(멱등).
   * ===================================================================== */
  async function ensureAdminSeed() {
    try {
      if (!SUBTLE) return { ok: false, error: "no_crypto" };
      const seed = (CFG.ADMIN_SEED && typeof CFG.ADMIN_SEED === "object") ? CFG.ADMIN_SEED : { username: "admin", password: "1234" };
      const uname = String(seed.username || "admin").trim();
      // 이미 admin 역할 계정이 하나라도 있으면 시드 불필요.
      const users = loadUsers();
      const hasAdmin = users.some((u) => (u.role || "user") === "admin");
      if (hasAdmin || findUserByName(uname)) return { ok: true, seeded: false };
      const salt = _randHex(AUTH.SALT_BYTES);
      const hash = await _pbkdf2Hex(String(seed.password || "1234"), salt, AUTH.PBKDF2_ITER);
      const isFirst = users.length === 0;
      const user = {
        id: "u" + Date.now().toString(36) + _randHex(3),
        username: uname, pass_hash: hash, salt: salt, iter: AUTH.PBKDF2_ITER,
        role: "admin", plan: "ultra", created: Date.now(),
      };
      users.push(user); saveUsers(users);
      if (isFirst) claimLegacyProgress(user.id); // 최초 계정이면 Pass A 단일 진행 이관(유실 금지)
      return { ok: true, seeded: true, username: uname };
    } catch (e) { return { ok: false, error: "seed_failed" }; }
  }
  const SIGNUP_ENABLED = (CFG.ALLOW_SIGNUP === true); // 기본 false(잠금)
  const LOGIN_LOCKED = (CFG.LOGIN_LOCK !== false);    // 기본 true(잠금)

  const ANNEX_CAP = 2000, ANNEX_TEXT = 4000, ANNEX_LIST = 40;
  function _clip(v) {
    if (typeof v === "string") return v.length > ANNEX_TEXT ? v.slice(0, ANNEX_TEXT) + "…" : v;
    if (v && typeof v === "object") { const o = {}; Object.keys(v).forEach((k) => { o[k] = _clip(v[k]); }); return o; }
    return v;
  }
  const AUDIT_CAP = 8000;
  NS.audit = "study.audit";
  function loadAudit() { const a = rawGet(NS.audit); return Array.isArray(a) ? a : []; }
  function saveAudit(list) {
    if (list.length > AUDIT_CAP) list = list.slice(list.length - AUDIT_CAP);
    for (let k = 0; k < 6; k++) { if (rawSet(NS.audit, list)) return true; list = list.slice(Math.ceil(list.length * 0.2)); }
    return false;
  }
  function normalizeAudit(e) {
    e = (e && typeof e === "object") ? e : {};
    const uid = e.user_id != null ? String(e.user_id) : (currentUserId() || "guest");
    const u = findUserById(uid);
    return {
      id: e.id || ("au" + Date.now().toString(36) + _randHex(3)), v: 1,
      ts: typeof e.ts === "number" ? e.ts : Date.now(),
      user_id: uid, username: e.username || (u && u.username) || (uid === "guest" ? "(로그인 전)" : ""),
      action: String(e.action || "event"), group: String(e.group || String(e.action || "").split(".")[0] || ""),
      target: e.target != null ? String(e.target).slice(0, 300) : "",
      detail: (e.detail && typeof e.detail === "object") ? _clip(e.detail) : (e.detail != null ? { note: String(e.detail).slice(0, 500) } : {}),
      domain: e.domain != null ? String(e.domain) : "", nav: e.nav != null ? String(e.nav) : "",
    };
  }
  function filterAudit(list, f) {
    f = f || {};
    const from = f.from ? (typeof f.from === "number" ? f.from : Date.parse(f.from)) : null;
    const to = f.to ? (typeof f.to === "number" ? f.to : Date.parse(f.to) + 86399999) : null;
    const q = f.q ? String(f.q).toLowerCase() : null;
    return list.filter((e) => {
      if (f.user_id && e.user_id !== f.user_id) return false;
      if (f.group && e.group !== f.group) return false;
      if (f.action && e.action !== f.action) return false;
      if (from != null && e.ts < from) return false;
      if (to != null && e.ts > to) return false;
      if (q && (e.action + " " + e.target + " " + JSON.stringify(e.detail) + " " + e.username).toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).sort((a, b) => b.ts - a.ts);
  }
  // 브라우저 저장소 사용량(키별 바이트) — 설정·관리자 화면. 서버 전환 후엔 서버가 대신 보고한다.
  function storageUsage(prefix) {
    const out = []; let total = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (prefix && k.indexOf(prefix) !== 0) continue;
        const n = (localStorage.getItem(k) || "").length * 2;   // UTF-16
        out.push({ key: k, bytes: n }); total += n;
      }
    } catch (e) { /* 계속 */ }
    out.sort((a, b) => b.bytes - a.bytes);
    return { total: total, keys: out };
  }
  function userKeys(uid) {
    const pre = "study.user." + uid + ".";
    const out = [];
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.indexOf(pre) === 0) out.push(k); } } catch (e) { /* 계속 */ }
    return out;
  }
  function _randId() { return "e" + Date.now().toString(36) + _randHex(3); }

  const SYSTEM_IMAGE_MAX = 300 * 1024;   // 로고/파비콘 dataURL 개별 상한(문자 수)
  const SYSTEM_MAX_BYTES = 900 * 1024;   // 시스템 설정 전체 직렬화 상한
  // 메뉴 기본 순서/그룹 — index.html 의 사이드바 초기 마크업과 일치시킨다.
  const NAV_LAYOUT_V = 5;
  const SYSTEM_NAV_ORDER = ["home", "library", "settings", "help", "sysconfig"];
  const SYSTEM_NAV_GROUPS = { home: "main", library: "library", settings: "system", help: "helpg", sysconfig: "admin" };
  // 끌 수 없는 메뉴(끄면 관리자가 되돌릴 길이 막힘) — UI 와 저장 양쪽에서 보호.
  const SYSTEM_NAV_LOCKED = ["home", "sysconfig"];

  function defaultSystemConfig() {
    return {
      v: 1,
      branding: {
        title: "", subtitle: "", logo_emoji: "📘", logo_image: "",
        favicon_emoji: "", favicon_image: "",
      },
      nav: { order: SYSTEM_NAV_ORDER.slice(), disabled: [], groups: {} },
      defaults: { theme: "white", mode: "light", fontscale: "normal", layout: "app", width: "wide", barwidth: "wide", font: "pretendard" },
      features: { audit: true },
    };
  }

  // 저장본 + 기본값 병합. 알 수 없는 메뉴키는 버리고, 빠진 메뉴키는 기본 순서 위치로 이어붙인다.
  function normalizeSystemConfig(raw) {
    const d = defaultSystemConfig();
    const s = (raw && typeof raw === "object") ? raw : {};
    const b = (s.branding && typeof s.branding === "object") ? s.branding : {};
    const n = (s.nav && typeof s.nav === "object") ? s.nav : {};
    const f = (s.features && typeof s.features === "object") ? s.features : {};
    const df = (s.defaults && typeof s.defaults === "object") ? s.defaults : {};
    const str = (v, dv) => (typeof v === "string" ? v : dv);

    const out = defaultSystemConfig();
    out.branding = {
      title: str(b.title, d.branding.title),
      subtitle: str(b.subtitle, d.branding.subtitle),
      logo_emoji: str(b.logo_emoji, d.branding.logo_emoji),
      logo_image: str(b.logo_image, ""),
      favicon_emoji: str(b.favicon_emoji, ""),
      favicon_image: str(b.favicon_image, ""),
    };
    // 순서: 저장된 유효 키 → 빠진 기본 키를 기본 순서대로 뒤에 보충(새 메뉴 추가 시 자동 노출).
    const known = {}; SYSTEM_NAV_ORDER.forEach((k) => { known[k] = 1; });
    const seen = {};
    const order = (Array.isArray(n.order) ? n.order : []).filter((k) => {
      if (typeof k !== "string" || !known[k] || seen[k]) return false;
      seen[k] = 1; return true;
    });
    SYSTEM_NAV_ORDER.forEach((k) => { if (!seen[k]) order.push(k); });
    out.nav.order = order;
    const oldLayout = n.layout_v !== NAV_LAYOUT_V;
    if (oldLayout) out.nav.order = SYSTEM_NAV_ORDER.slice();         // 옛 배치 → 새 기본 순서
    out.nav.layout_v = NAV_LAYOUT_V;
    out.nav.disabled = (Array.isArray(n.disabled) ? n.disabled : [])
      .filter((k) => typeof k === "string" && known[k] && SYSTEM_NAV_LOCKED.indexOf(k) < 0);
    out.nav.groups = {};
    const groupOk = { main: 1, library: 1, helpg: 1, system: 1, admin: 1 };
    if (n.groups && typeof n.groups === "object" && !oldLayout) {
      Object.keys(n.groups).forEach((k) => {
        const g = n.groups[k];
        if (known[k] && typeof g === "string" && groupOk[g]) out.nav.groups[k] = g;
      });
    }
    out.defaults = {
      theme: str(df.theme, d.defaults.theme),
      // 저장된 값이 없으면 코드 기본값(d.defaults)을 따른다. 무조건 light/sidebar 로
      // 떨어뜨리면 기본 테마를 바꿔도 모드·레이아웃이 되돌아간다.
      mode: (df.mode === "dark" || df.mode === "light") ? df.mode : d.defaults.mode,
      fontscale: str(df.fontscale, d.defaults.fontscale),
      layout: ["app", "apptop", "command", "topnav", "sidebar"].indexOf(df.layout) >= 0 ? df.layout : d.defaults.layout,
      width: (df.width === "short" || df.width === "mid" || df.width === "wide") ? df.width : d.defaults.width,
      barwidth: (df.barwidth === "short" || df.barwidth === "mid" || df.barwidth === "wide") ? df.barwidth : ((df.width === "short" || df.width === "mid" || df.width === "wide") ? df.width : "wide"),
      font: (df.font === "system" || df.font === "pretendard") ? df.font : d.defaults.font,
    };
    out.features = {
      audit: f.audit !== false,
    };
    return out;
  }

  function loadSystemConfig() { return normalizeSystemConfig(rawGet(NS.system)); }

  // 부분 패치(깊이 1단계 섹션 병합). 저장 전 정규화 + 용량 검사.
  function mergeSystemPatch(cur, patch) {
    const next = normalizeSystemConfig(cur);
    if (!patch || typeof patch !== "object") return next;
    ["branding", "nav", "defaults", "features"].forEach((sec) => {
      if (patch[sec] && typeof patch[sec] === "object") {
        next[sec] = Object.assign({}, next[sec], patch[sec]);
      }
    });
    return normalizeSystemConfig(next);
  }

  /* ---- 학습 자료 등록본 저장소(IndexedDB 'study-library' / store 'docs') — localStorage(5MB)엔 문서가 안 들어간다 ---- */
  function libIdb() {
    return new Promise((res, rej) => {
      if (typeof indexedDB === "undefined") return rej(new Error("no idb"));
      const r = indexedDB.open("study-library", 1);
      r.onupgradeneeded = () => { r.result.createObjectStore("docs", { keyPath: "id" }); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  async function libIdbTx(mode, fn) {
    const db = await libIdb();
    return new Promise((res, rej) => {
      const tx = db.transaction("docs", mode); const st = tx.objectStore("docs");
      const out = fn(st);
      tx.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
      tx.onerror = () => rej(tx.error);
    });
  }
  const libIdbAll = () => libIdbTx("readonly", (st) => st.getAll()).then((r) => r || []).catch(() => []);
  const libIdbGet = (id) => libIdbTx("readonly", (st) => st.get(id)).catch(() => null);
  const libIdbPut = (v) => libIdbTx("readwrite", (st) => st.put(v));
  const libIdbDel = (id) => libIdbTx("readwrite", (st) => st.delete(id));

  const LocalApi = {
    mode: "local",

    /* ---- 진행 root (opaque blob) : 구조 마이그레이션은 app.js 가 담당 ----
     *   getRootBlob/setRootBlob 은 LocalApi 저장 프리미티브. app.js 의
     *   동기 진행엔진(loadRoot/saveRoot 캐시)이 이 두 메서드로만 localStorage 에 접근. */
    //  진행 root 는 현재 세션 사용자 네임스페이스(study.user.<id>.progress)에서 읽고 쓴다.
    //  미로그인(정상 흐름 아님)에서는 레거시 단일 키(study.progress)로 폴백.
    async getRootBlob() { return rawGet(rootKeyFor()); },
    async setRootBlob(root) { return rawSet(rootKeyFor(), root); },

    /* ---- 표시 설정 (사용자별 + 프리페인트용 전역 미러) ----
     *   index.html 프리페인트 인라인 스크립트는 세션을 모른 채 study.display 를 읽으므로,
     *   사용자별 키와 함께 전역 미러(study.display)에도 마지막 값을 남겨 깜빡임을 막는다. */
    async getDisplay() { return rawGet(displayKeyFor()) || rawGet(NS.display); },
    async setDisplay(d) { rawSet(displayKeyFor(), d); return rawSet(NS.display, d); },
    async fetchJson(path) {
      const r = await fetch(path);
      if (!r.ok) return null;
      return r.json();
    },

    library: {
      _cat: null,
      _text: {},
      async catalog() {
        if (this._cat) return this._cat;
        const r = await fetch("library/catalog.json");
        if (!r.ok) throw new Error("카탈로그를 읽지 못했습니다(" + r.status + ")");
        const cat = await r.json();
        // 앱에서 등록한 자료(브라우저 IndexedDB) 를 카탈로그 뒤에 붙인다 — 같은 id 면 등록본이 이긴다
        try {
          const extra = await libIdbAll();
          if (extra.length) {
            const ids = {}; extra.forEach((x) => { ids[x.meta.id] = 1; });
            cat.docs = (cat.docs || []).filter((d) => !ids[d.id]).concat(extra.map((x) => Object.assign({}, x.meta, { path: null, uploaded: true, bytes: (x.html || "").length })));
            cat.count = cat.docs.length;
          }
        } catch (e) { /* IndexedDB 를 못 쓰는 브라우저 — 번들 카탈로그만 */ }
        this._cat = cat;
        return this._cat;
      },
      _reset() { this._cat = null; this._text = {}; },
      // ---- 앱 안에서 등록한 학습 자료(관리자) — 로컬: IndexedDB / 서버 모드: POST /library/docs ----
      async uploadDoc(meta, html) {
        const uid = currentUserId(); if (!uid || !isAdminUid(uid)) return { ok: false, message: "학습 자료 등록은 관리자만 할 수 있어요." };
        if (!meta || !/^[a-z0-9][a-z0-9-]{2,120}$/.test(meta.id || "")) return { ok: false, message: "문서 id(파일 이름)는 영소문자·숫자·하이픈이어야 해요." };
        await libIdbPut({ id: meta.id, meta: meta, html: String(html || ""), ts: Date.now(), by: uid });
        this._reset();
        return { ok: true, id: meta.id };
      },
      async removeDoc(id) {
        const uid = currentUserId(); if (!uid || !isAdminUid(uid)) return { ok: false, message: "관리자만 지울 수 있어요." };
        await libIdbDel(id); this._reset(); return { ok: true };
      },
      async uploadedHtml(id) { const x = await libIdbGet(id); return x ? x.html : null; },
      async uploadedList() { return (await libIdbAll()).map((x) => ({ id: x.id, meta: x.meta, ts: x.ts, bytes: (x.html || "").length })); },
      // 사용자별 읽기 정보 {progress:{id:{pct,ts,opens}}, fav:{id:1}, recent:[id]} — 서버 전환 시 library_progress 테이블
      async meta() { const uid = currentUserId(); const v = rawGet("study.user." + (uid || "guest") + ".libmeta"); return (v && typeof v === "object") ? v : { progress: {}, fav: {}, recent: [] }; },
      async saveMeta(v) { const uid = currentUserId(); return rawSet("study.user." + (uid || "guest") + ".libmeta", v); },
      async doc(id) {
        const c = await this.catalog();
        return (c.docs || []).find((d) => d.id === id) || null;
      },
      /* 문서 본문 → 평문. script/style 을 먼저 들어내고 태그를 지운다.
         DOMParser 를 쓰면 문서 안의 스크립트가 실행되지는 않지만 이미지·폰트를
         받으려 들기 때문에, 정규식으로 훑는 편이 가볍고 안전하다. */
      async text(id, limit) {
        limit = limit || 4000;
        if (this._text[id]) return this._text[id].slice(0, limit);
        const d = await this.doc(id);
        if (!d) return "";
        let s = "";
        if (d.uploaded) s = (await this.uploadedHtml(id)) || "";           // 앱에서 등록한 자료(IndexedDB)
        else { const r = await fetch(d.path); if (!r.ok) return ""; s = await r.text(); }
        s = s.replace(/<script[\s\S]*?<\/script>/gi, " ")
             .replace(/<style[\s\S]*?<\/style>/gi, " ")
             .replace(/<!--[\s\S]*?-->/g, " ")
             .replace(/<\/(p|div|section|li|tr|h[1-6])>/gi, "\n")
             .replace(/<[^>]+>/g, " ");
        s = s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
             .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
             .replace(/[ \t]+/g, " ");
        /* 껍데기 걷어내기 — 내비게이션, 목차 항목, 버튼 라벨은 하나같이 짧은
           한 줄이다. 길이로 거르면 본문(문장)은 남고 껍데기는 거의 다 빠진다.
           같은 줄이 연달아 나오는 것(목차와 제목이 겹치는 경우)도 접는다. */
        const lines = [];
        s.split("\n").forEach((raw) => {
          const t = raw.trim();
          if (t.length < 15) return;
          if (lines.length && lines[lines.length - 1] === t) return;
          lines.push(t);
        });
        s = lines.join("\n").trim();
        this._text[id] = s;
        return s.slice(0, limit);
      },
    },

    /* ---- LLM (브라우저 직접 호출; 미래엔 RemoteApi 가 백엔드 프록시로 키 은닉) ---- */
    llm: {
      // 활성 프로필(없으면 null = 미연결). 기본 연결은 없다 — 설정에서 프로필을 불러와 선택해야 한다.
      _profile() { return activeLlmProfile(); },
      _requireProfile() {
        const p = activeLlmProfile();
        if (!p) { const e = new Error("AI 서버가 연결되지 않았어요. 설정 → AI 연결에서 LLM 프로필을 불러와 선택하세요."); e.code = "no_llm"; throw e; }
        return p;
      },
      _headers(prof) {
        // 주의: User-Agent 는 fetch 에서 설정 금지(무시됨). 브라우저가 실제 UA 자동 전송.
        const p = prof || this._requireProfile();
        const h = { "Content-Type": "application/json" };
        if (p.api_key) h["Authorization"] = "Bearer " + p.api_key;
        return h;
      },
      _payload(messages, opts, prof) {
        opts = opts || {};
        const p = prof || this._requireProfile();
        const pr = p.params || {};
        return {
          model: p.model,
          messages: messages,
          temperature: opts.temperature == null ? pr.temperature : opts.temperature,
          max_tokens: opts.maxTokens == null ? pr.max_tokens : opts.maxTokens,
          top_p: pr.top_p,
          stream: !!opts.stream,
        };
      },
      // <think>...</think> 추론 블록 제거(닫히지 않은 것 포함)
      _strip(text) {
        if (!text) return "";
        let t = text.replace(/<think>[\s\S]*?<\/think>/g, "");
        t = t.replace(/<think>[\s\S]*$/g, "");
        t = t.replace(/<think>/g, "").replace(/<\/think>/g, "");
        return t.trim();
      },
      // 관대한 JSON 파싱: 코드펜스 제거 → 첫 { ~ 마지막 } → JSON.parse (트레일링 콤마 보정)
      _lenient(text) {
        if (!text) return null;
        let t = String(text).trim();
        t = t.replace(/```(?:json)?/gi, "").replace(/```/g, "");
        const start = t.indexOf("{");
        const end = t.lastIndexOf("}");
        if (start === -1 || end === -1 || end <= start) return null;
        const snippet = t.slice(start, end + 1);
        try { return JSON.parse(snippet); }
        catch (e) {
          const cleaned = snippet.replace(/,\s*([}\]])/g, "$1");
          try { return JSON.parse(cleaned); } catch (e2) { return null; }
        }
      },
      // 원 Response 반환(스트림 포함) — 내부/저수준
      async raw(messages, opts) {
        const _prof = this._requireProfile();
        return fetch(_prof.base_url + "/chat/completions", {
          method: "POST",
          headers: this._headers(_prof),
          body: JSON.stringify(this._payload(messages, opts, _prof)),
        });
      },
      // 텍스트 완성(think 제거)
      async complete(messages, opts) {
        const resp = await this.raw(messages, Object.assign({}, opts, { stream: false }));
        if (!resp.ok) throw new Error("LLM HTTP " + resp.status);
        const data = await resp.json();
        return this._strip(data.choices[0].message.content);
      },
      // JSON 생성: {messages, temperature, maxTokens} → 파싱된 객체(관대) 또는 null.
      async generate(payload) {
        payload = payload || {};
        const text = await this.complete(payload.messages, {
          temperature: payload.temperature, maxTokens: payload.maxTokens,
        });
        return this._lenient(text);
      },
      async chat(messages, onDelta, opts) {
        const r = await this.raw(messages, Object.assign({}, opts, { stream: true }));
        if (!r.ok || !r.body) throw new Error("no stream");
        const reader = r.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "", inThink = false, acc = "", streamErr = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop();
          for (const part of parts) {
            const line = part.trim();
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (data === "[DONE]") continue;
            let delta;
            try {
              const obj = JSON.parse(data);
              if (obj && obj.error) { streamErr = String(obj.error.message || obj.error); continue; }   // (v92) 서버 프록시가 보낸 오류
              delta = obj.choices && obj.choices[0] && obj.choices[0].delta
                ? (obj.choices[0].delta.content || "") : "";
            } catch (e) { continue; }
            if (!delta) continue;
            // 스트리밍 중 <think> 필터
            if (delta.includes("<think>")) { inThink = true; delta = delta.split("<think>")[0]; }
            if (delta.includes("</think>")) { inThink = false; delta = delta.split("</think>").pop(); }
            if (inThink) continue;
            if (delta) { acc += delta; if (typeof onDelta === "function") onDelta(delta, acc); }
          }
        }
        if (!acc && streamErr) throw new Error(streamErr);
        return acc;
      },
      // AI 서버 상태(health) — 상태 표시등
      async health() {
        const p = activeLlmProfile();
        if (!p) return false;                       // 미연결 = 기본 상태
        try { const r = await fetch(p.base_url + "/models", { headers: this._headers(p) }); return r.ok; }
        catch (e) { return false; }
      },
      /* ---- 프로필 관리 (설정 화면에서 사용) ---- */
      async profiles() { const st = loadLlmStore(); return { ok: true, profiles: st.profiles, active_id: st.active_id }; },
      async importProfiles(payload, opts) {
        const parsed = parseLlmProfilesPayload(payload);
        if (!parsed.ok) return parsed;
        const st = loadLlmStore();
        const replace = !!(opts && opts.replace);
        if (replace) st.profiles = [];
        for (const np of parsed.profiles) {
          let id = np.id, n = 2;
          const dup = st.profiles.findIndex((x) => x.base_url === np.base_url && x.model === np.model);
          if (dup >= 0) { np.id = st.profiles[dup].id; st.profiles[dup] = np; continue; }
          while (st.profiles.some((x) => x.id === id)) { id = np.id + "-" + n; n++; }
          np.id = id; st.profiles.push(np);
        }
        if (!st.active_id && st.profiles.length) st.active_id = null;   // 자동 연결하지 않는다
        saveLlmStore(st);
        return { ok: true, added: parsed.profiles.length, profiles: st.profiles, active_id: st.active_id };
      },
      async setActive(id) {
        const st = loadLlmStore();
        if (id === null || id === "") { st.active_id = null; saveLlmStore(st); return { ok: true, active_id: null }; }
        if (!st.profiles.some((p) => p.id === id)) return { ok: false, message: "그런 프로필이 없어요." };
        st.active_id = id; saveLlmStore(st);
        return { ok: true, active_id: id };
      },
      async removeProfile(id) {
        const st = loadLlmStore();
        st.profiles = st.profiles.filter((p) => p.id !== id);
        if (st.active_id === id) st.active_id = null;
        saveLlmStore(st);
        return { ok: true, profiles: st.profiles, active_id: st.active_id };
      },
      async testProfile(id) {
        const st = loadLlmStore();
        const p = st.profiles.find((x) => x.id === id);
        if (!p) return { ok: false, message: "그런 프로필이 없어요." };
        try {
          const r = await fetch(p.base_url + "/models", { headers: this._headers(p) });
          return r.ok ? { ok: true, message: "연결 성공" } : { ok: false, message: "응답 오류 (HTTP " + r.status + ")" };
        } catch (e) { return { ok: false, message: "연결 실패: " + (e.message || e) }; }
      },
      isConnected() { return !!activeLlmProfile(); },
      activeInfo() { const p = activeLlmProfile(); return p ? { id: p.id, service: p.service, model: p.model, base_url: p.base_url } : null; },
      // 내 프로필을 파일로(키 포함 — 내 계정에서만 부를 수 있다)
      async exportProfiles(opts) {
        if (!currentUserId()) return { ok: false, message: "로그인이 필요해요." };
        const st = loadLlmStore();
        if (!st.profiles.length) return { ok: false, message: "저장된 프로필이 없어요." };
        return { ok: true, payload: llmToExternal(st.profiles, !(opts && opts.withKeys === false)), active_id: st.active_id };
      },
      /* ---- 계정 보관함: 올리기/받기/정보/지우기 — uid 인자를 받지 않는다(언제나 '지금 로그인한 나') ---- */
      vault: {
        // 상태: 이 브라우저 사본 + 파일 보관함(serve.py) 사용 가능 여부 + 마지막으로 파일에 올린 기록
        async info() {
          const uid = currentUserId(); if (!uid) return { ok: false, message: "로그인이 필요해요." };
          const v = rawGet(vaultKeyFor(uid));
          const file = await fileVaultAvailable();
          const fm = rawGet(vaultFileMetaKey(uid));
          return { ok: true, exists: !!v, updated: v && v.updated, count: v && v.count, encrypted: !!(v && v.enc), summary: (v && v.summary) || [],
                   file: file, file_shared: !!FILE_VAULT_INFO.shared, file_store: FILE_VAULT_INFO.store || "", file_lan: !!FILE_VAULT_INFO.lan, file_folder: FILE_VAULT_INFO.folder || "", file_last: fm || null, username: (findUserById(uid) || {}).username || "" };
        },
        // 올리기: 이 브라우저 사본은 늘 저장, 파일 보관함은 암호 문구가 있을 때만(서버엔 암호문만 간다)
        async upload(opts) {
          opts = opts || {};
          const uid = currentUserId(); if (!uid) return { ok: false, message: "로그인이 필요해요." };
          const st = loadLlmStore();
          if (!st.profiles.length) return { ok: false, message: "올릴 프로필이 없어요. 먼저 프로필을 불러오세요." };
          const payload = llmToExternal(st.profiles, true);
          const pass = String(opts.passphrase || "");
          if (pass && pass.length < 6) return { ok: false, message: "암호 문구는 6자 이상으로 해 주세요." };
          if (pass) { const nc = vaultNeedsCrypto(); if (nc) return nc; }
          const enc = pass ? await vaultEncrypt(payload, pass) : null;
          const rec = { v: 1, updated: Date.now(), count: st.profiles.length,
            summary: st.profiles.map((x) => ({ service: x.service, model: x.model, base_url: x.base_url })),
            enc: enc, plain: pass ? null : payload, active_id: st.active_id || null };
          if (!rawSet(vaultKeyFor(uid), rec)) return { ok: false, message: "저장하지 못했어요(저장 공간 부족?)." };
          const out = { ok: true, count: rec.count, encrypted: !!enc, updated: rec.updated, file: false };
          if (await fileVaultAvailable()) {
            if (!pass) { out.file_note = "need_pass"; return out; }
            const user = (findUserById(uid) || {}).username || "";
            try {
              const id = await vaultLookupId(user, pass);
              const r = await fileVaultReq("PUT", id, { v: 1, kind: "study.llmvault", updated: rec.updated, count: rec.count, active_id: rec.active_id, enc: enc });
              if (r.status === 200) { out.file = true; rawSet(vaultFileMetaKey(uid), { updated: rec.updated, count: rec.count }); }
              else out.file_error = (r.data && r.data.message) || ("HTTP " + r.status);
            } catch (e) { out.file_error = String(e.message || e); }
          }
          return out;
        },
        // 받아 쓰기: 암호 문구가 있으면 파일 보관함 먼저(다른 브라우저에서 올린 것), 없거나 못 찾으면 이 브라우저 사본
        // apply: "merge"(기본) | "replace" | false(적용하지 않고 내용만)
        async download(opts) {
          opts = opts || {};
          const uid = currentUserId(); if (!uid) return { ok: false, message: "로그인이 필요해요." };
          const pass = String(opts.passphrase || "");
          let payload = null, active = null, from = "";
          if (pass && await fileVaultAvailable()) {
            const nc = vaultNeedsCrypto(); if (nc) return nc;
            const user = (findUserById(uid) || {}).username || "";
            try {
              const r = await fileVaultReq("GET", await vaultLookupId(user, pass));
              if (r.status === 429) return { ok: false, message: "잠깐 너무 많이 시도했어요. 1분 뒤에 다시 해 주세요." };
              if (r.status === 200 && r.data && r.data.record && r.data.record.enc) {
                try { payload = await vaultDecrypt(r.data.record.enc, pass); active = r.data.record.active_id; from = "file"; }
                catch (e) { return { ok: false, error: "bad_pass", message: "파일 보관함의 암호를 풀지 못했어요." }; }
              }
            } catch (e) { /* 파일 보관함 접속 실패 → 이 브라우저 사본으로 */ }
          }
          if (!payload) {
            const v = rawGet(vaultKeyFor(uid));
            if (!v) return { ok: false, error: pass ? "not_found" : "empty",
              message: pass ? "'" + ((findUserById(uid) || {}).username || "") + "' 계정 이름과 이 암호 문구로 올린 보관함이 없어요(이름·문구가 올릴 때와 같아야 해요)." : "내 계정 보관함이 비어 있어요." };
            payload = v.plain; active = v.active_id; from = "browser";
            if (v.enc) {
              if (!pass) return { ok: false, error: "need_pass", message: "암호 문구가 필요해요." };
              try { payload = await vaultDecrypt(v.enc, pass); } catch (e) { return { ok: false, error: "bad_pass", message: "암호 문구가 맞지 않아요." }; }
            }
          }
          if (opts.apply === false) return { ok: true, payload: payload, active_id: active, from: from };
          const r = llmApplyProfiles(payload, opts.apply === "replace" ? "replace" : "merge", opts.connect ? active : null);
          return Object.assign({}, r, { payload: undefined, from_vault: true, from: from });
        },
        // 비우기: 이 브라우저 사본 + (문구가 있으면) 파일 보관함의 내 것
        async remove(opts) {
          opts = opts || {};
          const uid = currentUserId(); if (!uid) return { ok: false, message: "로그인이 필요해요." };
          rawDel(vaultKeyFor(uid));
          const out = { ok: true, file: false };
          const pass = String(opts.passphrase || "");
          if (pass && SUBTLE && await fileVaultAvailable()) {
            try { const r = await fileVaultReq("DELETE", await vaultLookupId((findUserById(uid) || {}).username || "", pass)); out.file = r.status === 200; } catch (e) { /* 계속 */ }
            rawDel(vaultFileMetaKey(uid));
          }
          return out;
        },
        // 암호화 파일 — 서버가 없는 곳(배포 사이트·다른 PC)으로 옮길 때. 암호 문구 필수.
        async exportFile(opts) {
          opts = opts || {};
          const uid = currentUserId(); if (!uid) return { ok: false, message: "로그인이 필요해요." };
          const pass = String(opts.passphrase || "");
          if (pass.length < 6) return { ok: false, error: "need_pass", message: "암호화 파일은 암호 문구(6자 이상)가 있어야 만들 수 있어요." };
          const nc = vaultNeedsCrypto(); if (nc) return nc;
          const st = loadLlmStore();
          if (!st.profiles.length) return { ok: false, message: "저장할 프로필이 없어요." };
          return { ok: true, file: { kind: "study.llmvault", v: 1, created: Date.now(), count: st.profiles.length, active_id: st.active_id || null,
                                     enc: await vaultEncrypt(llmToExternal(st.profiles, true), pass) } };
        },
        async importFile(obj, opts) {
          opts = opts || {};
          if (!currentUserId()) return { ok: false, message: "로그인이 필요해요." };
          if (!obj || obj.kind !== "study.llmvault" || !obj.enc) return { ok: false, message: "암호화 보관함 파일이 아니에요." };
          const pass = String(opts.passphrase || "");
          if (!pass) return { ok: false, error: "need_pass", message: "이 파일을 만들 때 쓴 암호 문구가 필요해요." };
          const nc = vaultNeedsCrypto(); if (nc) return nc;
          let payload = null;
          try { payload = await vaultDecrypt(obj.enc, pass); } catch (e) { return { ok: false, error: "bad_pass", message: "암호 문구가 맞지 않아요." }; }
          const r = llmApplyProfiles(payload, opts.apply === "replace" ? "replace" : "merge", opts.connect !== false ? obj.active_id : null);
          return Object.assign({}, r, { from: "file-export" });
        },
      },
    },


    /* ---- 인증/세션 (Pass B) : study.users / study.session, PBKDF2 해시 ----
     *   반환 계약: { ok, user?, error?, message? }. 실패해도 throw 하지 않고 표식 반환.
     *   비밀번호는 절대 저장하지 않고, 사용자별 랜덤 솔트로 PBKDF2 해시만 저장. */
    // 관리자 시드 보장(로그인 잠금) — boot()/login() 진입 전에 호출. 멱등.
    async ensureSeed() { return ensureAdminSeed(); },
    async register(username, password, opts) {
      // ▶ 로그인 잠금(요청 ⑪): 회원가입 비활성. 계약(register)은 삭제하지 않고 플래그로 차단.
      //   원복: config.js 의 ALLOW_SIGNUP:true → 아래 가드가 열리고 원래 회원가입 로직이 동작.
      if (!SIGNUP_ENABLED) {
        return { ok: false, error: "signup_disabled",
          message: "지금은 회원가입이 막혀 있어요. 관리자 계정(admin)으로 로그인하세요." };
      }
      username = String(username == null ? "" : username).trim();
      password = String(password == null ? "" : password);
      if (!SUBTLE) return { ok: false, error: "no_crypto", message: "이 브라우저에서는 보안(암호화) 기능을 쓸 수 없어요." };
      if (username.length < 2) return { ok: false, error: "bad_username", message: "아이디는 2자 이상으로 입력해 주세요." };
      if (username.length > 24) return { ok: false, error: "bad_username", message: "아이디는 24자 이내로 입력해 주세요." };
      if (password.length < 4) return { ok: false, error: "bad_password", message: "비밀번호는 4자 이상으로 입력해 주세요." };
      if (findUserByName(username)) return { ok: false, error: "dup", message: "이미 있는 아이디예요. 다른 아이디를 쓰거나 로그인하세요." };
      const users = loadUsers();
      const isFirst = users.length === 0;
      const salt = _randHex(AUTH.SALT_BYTES);
      const hash = await _pbkdf2Hex(password, salt, AUTH.PBKDF2_ITER);
      // 관리자 시드: 최초 계정이거나 아이디가 admin 이면 role=admin (관리자 패널은 Pass C).
      const role = (isFirst || username.toLowerCase() === "admin") ? "admin" : "user";
      const user = {
        id: "u" + Date.now().toString(36) + _randHex(3),
        username: username, pass_hash: hash, salt: salt, iter: AUTH.PBKDF2_ITER,
        role: role, plan: "free", created: Date.now(),
      };
      users.push(user); saveUsers(users);
      // 최초 계정에 한해 Pass A 단일 진행(study.progress)을 이관(유실 금지).
      const migrated = isFirst ? claimLegacyProgress(user.id) : false;
      startSession(user.id);
      return { ok: true, user: publicUser(user), migrated: migrated };
    },
    async login(username, password) {
      username = String(username == null ? "" : username).trim();
      password = String(password == null ? "" : password);
      if (!SUBTLE) return { ok: false, error: "no_crypto", message: "이 브라우저에서는 보안(암호화) 기능을 쓸 수 없어요." };
      await ensureAdminSeed(); // 관리자 계정이 없으면 먼저 시드(멱등)
      const user = findUserByName(username);
      if (user && user.locked) return { ok: false, error: "locked", message: "관리자가 잠근 계정이에요. 관리자에게 문의하세요." };   // 관리자 잠금
      if (!user) return { ok: false, error: "not_found", message: LOGIN_LOCKED
        ? "관리자 계정(admin)으로만 로그인할 수 있어요." : "없는 아이디예요. 회원가입을 먼저 해주세요." };
      // ▶ 로그인 잠금(요청 ⑪): 관리자(role=admin)만 허용. 그 외 계정 자격은 거부.
      //   원복: config.js 의 LOGIN_LOCK:false → 아래 가드가 열리고 일반 로그인이 동작.
      if (LOGIN_LOCKED && (user.role || "user") !== "admin") {
        return { ok: false, error: "locked", message: "지금은 관리자 계정(admin)으로만 로그인할 수 있어요." };
      }
      const hash = await _pbkdf2Hex(password, user.salt, user.iter || AUTH.PBKDF2_ITER);
      if (!_constEq(hash, user.pass_hash)) return { ok: false, error: "bad_password", message: "비밀번호가 맞지 않아요." };
      startSession(user.id);
      return { ok: true, user: publicUser(user) };
    },
    async logout() { clearSession(); return { ok: true }; },
    // (v92) 서버 계정 연동(server.js) — 서버가 확인한 사용자로 이 브라우저의 로컬 계정을 맞추고 세션을 연다.
    //   로컬 데이터 네임스페이스(study.user.<로컬 id>.*)는 그대로 쓴다. 역할은 서버가 기준, 플랜은 로컬 값이 있으면 유지.
    //   password 를 주면 로컬 해시도 맞춰 둔다(서버가 꺼졌을 때 같은 비밀번호로 로컬 로그인).
    async _adoptServerUser(su, password) {
      if (!su || !su.username) return null;
      const users = loadUsers();
      let u = users.filter((x) => x.server_id === su.id)[0] || users.filter((x) => (x.username || "").toLowerCase() === String(su.username).toLowerCase())[0];
      const isNew = !u;
      if (isNew) { u = { id: su.id, username: su.username, created: Date.now() }; users.push(u); }
      u.server_id = su.id; u.username = su.username; u.role = su.role || "user"; u.plan = u.plan || su.plan || "free"; u.locked = false;
      if (SUBTLE && (password || !u.pass_hash)) {
        u.salt = _randHex(AUTH.SALT_BYTES); u.iter = AUTH.PBKDF2_ITER;
        u.pass_hash = await _pbkdf2Hex(password || _randHex(16), u.salt, u.iter);
      }
      saveUsers(users);
      if (isNew && users.length === 1) claimLegacyProgress(u.id);
      startSession(u.id);
      return publicUser(u);
    },
    _dropLocalSession() { clearSession(); },
    async currentUser() { return currentUserObj(); },  // 미로그인/만료면 null
    async updateProfile(patch) {
      const uid = currentUserId();
      if (!uid) return { ok: false, error: "no_session", message: "로그인이 필요해요." };
      patch = patch || {};
      const users = loadUsers();
      const u = users.filter((x) => x.id === uid)[0];
      if (!u) return { ok: false, error: "not_found", message: "사용자를 찾을 수 없어요." };
      if (patch.username != null) {
        const nn = String(patch.username).trim();
        if (nn.length < 2) return { ok: false, error: "bad_username", message: "아이디는 2자 이상이어야 해요." };
        if (nn.toLowerCase() !== u.username.toLowerCase() && findUserByName(nn)) {
          return { ok: false, error: "dup", message: "이미 있는 아이디예요." };
        }
        u.username = nn;
      }
      if (patch.password != null) {
        if (String(patch.password).length < 4) return { ok: false, error: "bad_password", message: "비밀번호는 4자 이상이어야 해요." };
        u.salt = _randHex(AUTH.SALT_BYTES); u.iter = AUTH.PBKDF2_ITER;
        u.pass_hash = await _pbkdf2Hex(String(patch.password), u.salt, u.iter);
      }
      saveUsers(users);
      return { ok: true, user: publicUser(u) };
    },

    // ---- 감사 기록 ----
    //   auditLog  : 한 줄 추가(실패해도 조용히). auditList: 필터·최신순 {items,total,has_more}.
    //   일반 사용자는 자기 기록만, 관리자는 전체(user_id 필터 가능). export/clear 는 관리자 전용(전체) / 사용자(자기 것).
    async auditLog(e) { const a = loadAudit(); a.push(normalizeAudit(e)); saveAudit(a); return { ok: true }; },
    async auditList(f) {
      f = Object.assign({}, f || {});
      const uid = currentUserId();
      if (!uid || !isAdminUid(uid)) f.user_id = uid || "guest";
      const all = filterAudit(loadAudit(), f);
      const off = Math.max(0, parseInt(f.offset, 10) || 0), lim = f.limit != null ? Math.max(0, parseInt(f.limit, 10) || 0) : all.length;
      const items = all.slice(off, off + lim);
      return { items: items, total: all.length, offset: off, has_more: off + items.length < all.length };
    },
    async auditExport(f) { const r = await this.auditList(Object.assign({}, f || {}, { offset: 0, limit: null })); return r.items; },
    async auditClear() {
      const uid = currentUserId();
      if (uid && isAdminUid(uid)) { rawDel(NS.audit); return { ok: true, all: true }; }
      saveAudit(loadAudit().filter((e) => e.user_id !== (uid || "guest")));
      return { ok: true, all: false };
    },
    async auditImport(list, mode) {
      if (!Array.isArray(list)) return { ok: false };
      const uid = currentUserId();
      if (!uid || !isAdminUid(uid)) return { ok: false, message: "감사 기록 가져오기는 관리자만 할 수 있어요." };
      const byId = {};
      (mode === "merge" ? loadAudit() : []).concat(list.map(normalizeAudit)).forEach((e) => { byId[e.id] = e; });
      const merged = Object.keys(byId).map((k) => byId[k]).sort((a, b) => a.ts - b.ts);
      saveAudit(merged);
      return { ok: true, count: merged.length };
    },
    // ---- 저장소 · 백업(사용자 단위) ----
    async storageUsage() {
      const uid = currentUserId();
      const all = storageUsage("study.");
      if (uid && isAdminUid(uid)) return all;
      const mine = all.keys.filter((k) => k.key.indexOf("study.user." + uid + ".") === 0);
      return { total: mine.reduce((t, k) => t + k.bytes, 0), keys: mine, all_total: all.total };
    },

    // ---- 시스템 설정 (화이트라벨·메뉴 구성 — Pass 3) : study.system [전역] ----
    //   getSystemConfig   : 누구나 읽기(로그인 전 브랜딩/메뉴 적용에 필요). 항상 기본값 병합본.
    //   saveSystemConfig  : **관리자 전용**. 섹션 단위 부분 패치 → 정규화 후 저장.
    //   resetSystemConfig : **관리자 전용**. 공장 기본값으로 복원.
    async getSystemConfig() { return loadSystemConfig(); },
    async saveSystemConfig(patch) {
      const uid = currentUserId();
      if (!uid || !isAdminUid(uid)) {
        return { ok: false, error: "forbidden", message: "시스템 설정은 관리자만 바꿀 수 있어요." };
      }
      const next = mergeSystemPatch(rawGet(NS.system), patch);
      // 이미지 dataURL 개별 상한
      const imgs = [["logo_image", "로고"], ["favicon_image", "파비콘"]];
      for (const [k, label] of imgs) {
        if ((next.branding[k] || "").length > SYSTEM_IMAGE_MAX) {
          return { ok: false, error: "too_large",
            message: label + " 이미지가 너무 커요(약 " + Math.round(SYSTEM_IMAGE_MAX / 1024) + "KB 이하로 올려 주세요)." };
        }
      }
      let body = "";
      try { body = JSON.stringify(next); } catch (e) { return { ok: false, error: "unserializable" }; }
      if (body.length > SYSTEM_MAX_BYTES) {
        return { ok: false, error: "too_large", message: "설정 용량이 너무 커요. 이미지 크기를 줄여 주세요." };
      }
      if (!rawSet(NS.system, next)) {
        return { ok: false, error: "storage", message: "저장 공간이 부족해요. 이미지 크기를 줄이거나 기록을 정리해 주세요." };
      }
      return { ok: true, config: next };
    },
    async resetSystemConfig() {
      const uid = currentUserId();
      if (!uid || !isAdminUid(uid)) {
        return { ok: false, error: "forbidden", message: "시스템 설정은 관리자만 바꿀 수 있어요." };
      }
      rawDel(NS.system);
      return { ok: true, config: defaultSystemConfig() };
    },
    _ns: NS,
  };

  /* =======================================================================
   * F. 모드에 따라 구현 선택 → window.Api
   * ===================================================================== */
  global.Api = LocalApi;
  global.Api.MODE = MODE;
  // 시스템 설정 메타(메뉴 기본 순서/그룹/보호 목록) — app.js 가 UI 구성에 참조(읽기 전용).
  global.Api.systemMeta = {
    NAV_ORDER: SYSTEM_NAV_ORDER.slice(),
    NAV_GROUPS: Object.assign({}, SYSTEM_NAV_GROUPS),
    NAV_LOCKED: SYSTEM_NAV_LOCKED.slice(),
    IMAGE_MAX: SYSTEM_IMAGE_MAX,
    defaults: defaultSystemConfig,
  };
})(typeof window !== "undefined" ? window : this);
