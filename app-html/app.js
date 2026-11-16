/* =========================================================================
 * ScholarFlow — 브라우저 쪽 앱 본체(app.js)
 *
 *   로그인 · 화면 이동(navTo) · 설정 · 시스템 설정(브랜딩·메뉴) · 화면 도우미(물어보기) · 학습 자료 목록과 뷰어.
 *   연구지원 화면(연구 프로젝트·논문·보고서·발표자료 …)은 각자 파일(rnd.js·paper.js·report.js …)에서
 *   EXT_VIEWS 에 등록되고 navTo 가 연다. 데이터는 전부 Api.*(api.js) → 서버(serve.py) 를 거친다.
 * ========================================================================= */

"use strict";

/* ===========================================================================
 * 1. LLM 호출 — Api.llm.* 로 이동 (직접 fetch/think제거/JSON파싱은 api.js 내부).
 *    아래는 도메인 로직이 쓰는 얇은 위임 래퍼(시그니처 유지).
 * ======================================================================== */
function llmStreamChat(messages, onDelta, opts) { return Api.llm.chat(messages, onDelta, opts); }
// JSON 생성: {messages, temperature, maxTokens} → 파싱된 객체(관대) 또는 null.
function llmGenerate(payload) { return Api.llm.generate(payload); }
function audit(action, target, detail) {
  try {
    if (SYSCFG && SYSCFG.features && SYSCFG.features.audit === false) return;
    Api.auditLog({ action: action, target: target == null ? "" : String(target), detail: detail || {},
                   nav: (state && state.nav) || "" });
  } catch (e) { /* 감사 기록 실패해도 앱은 계속 */ }
}
// 확장 화면(insight.js 가 등록): { <nav>: { area: <section>, open: fn } }
const EXT_VIEWS = {};

const state = {
  mode: "",
  nav: "",
};
let SETTINGS = defaultSettings();
let MODEL_INFO = { model: "-", temperature: null, keyExposed: false };
// 시스템 설정(화이트라벨·메뉴 구성 — 전역/관리자). 부팅 시 Api 로 로드해 브랜딩·내비에 적용.
// 로드 전에도 항상 유효한 기본값을 갖게 해 어떤 코드 경로에서도 널 참조가 없게 한다.
let SYSCFG = sysDefaults();
function sysDefaults() {
  try { return Api.systemMeta.defaults(); }
  catch (e) {
    return { v: 1, branding: { title: "", subtitle: "", logo_emoji: "📘", logo_image: "", favicon_emoji: "", favicon_image: "" },
             nav: { order: [], disabled: [], groups: {} },
             defaults: { theme: "dashboard", mode: "light", fontscale: "normal", layout: "sidebar" },
             features: { audit: true } };
  }
}

async function adHealth() { return Api.llm.health(); }
async function adLoadSettings() {
  MODEL_INFO = { model: CONFIG.MODEL, temperature: CONFIG.TEMPERATURE, keyExposed: true };
  const root = loadRoot();
  return (root && root.settings) || {};
}
// 시스템 설정(전역·관리자) — 실패해도 앱이 멈추지 않게 기본값/에러객체로 폴백.
async function adGetSystem() { try { return await Api.getSystemConfig(); } catch (e) { return sysDefaults(); } }
async function adSaveSystem(patch) {
  try { return await Api.saveSystemConfig(patch); }
  catch (e) { return { ok: false, message: "저장 중 오류가 발생했어요. 다시 시도해 주세요." }; }
}
async function adResetSystem() {
  try { return await Api.resetSystemConfig(); }
  catch (e) { return { ok: false, message: "복원 중 오류가 발생했어요. 다시 시도해 주세요." }; }
}
function adAdvInfo() { return MODEL_INFO; }
/* 어댑터 끝 — 아래는 두 버전 공통(byte-identical) */

const $ = (id) => document.getElementById(id);
const el = {
  statusDot: $("statusDot"), statusText: $("statusText"),
  sidebar: $("sidebar"), scrim: $("scrim"), hamburger: $("hamburger"),
  viewTitle: $("viewTitle"), darkToggle: $("darkToggle"),
  statusMode: $("statusMode"), statusModel: $("statusModel"), clockPill: $("clockPill"),
  brandName: $("brandName"),
  settingsArea: $("settingsArea"),
  setThemeSeg: $("setThemeSeg"), setModeSeg: $("setModeSeg"), setFontSeg: $("setFontSeg"),
  setLayoutSeg: $("setLayoutSeg"), setWidthSeg: $("setWidthSeg"), setFontFamSeg: $("setFontFamSeg"),
  widthToggle: $("widthToggle"),
  advModel: $("advModel"), advTemp: $("advTemp"), advKeyWarn: $("advKeyWarn"),
  llmStateLine: $("llmStateLine"), llmFile: $("llmFile"), llmDisconnect: $("llmDisconnect"),
  llmList: $("llmList"), llmMsg: $("llmMsg"),
};

const show = (node) => { if (node) node.classList.remove("hidden"); };
const hide = (node) => { if (node) node.classList.add("hidden"); };

function defaultSettings() {
  return {
    theme: "white", mode: "light", fontscale: "normal", layout: "app", width: "wide", font: "pretendard",
    barwidth: "wide",          // 탑메뉴(상단 바) 폭 — 본문 폭(width)과 따로
    lib_view: "table",         // 학습 자료 기본 보기(목록=표/카드 목록/카드/트리)
  };
}

/* =========================================================================
 * 인증 게이트 (Pass B) — 앱 진입 전에 로그인 확인. 로그인/회원가입 후 startApp().
 *   데이터(진행/설정/표시)는 로그인 사용자 네임스페이스에 저장된다(api.js 가 담당).
 *   로그아웃은 location.reload() 로 깨끗하게 세션 초기화 → 로그인 화면 재진입.
 * ========================================================================= */
let AUTH_TAB = "login";
let APP_STARTED = false;

/* 새 버전 알림은 공용 RUI.updates() 하나다(G1 6장). 버전 뱃지 툴팁이 쓰는 빌드 번호만 여기서 읽는다 */
function appBuildOf(src) { const m = String(src || "").match(/app\.js\?v=([\w.-]+)/); return m ? m[1] : null; }
const APP_BUILD = ((document.querySelector('meta[name="app-version"]') || {}).content) || appBuildOf(Array.from(document.scripts).map((x) => x.getAttribute("src") || "").join(" "));   // (v177) 빌드는 meta, 파일 ?v= 는 내용 해시
if (window.RUI && RUI.updates) RUI.updates({ version: APP_BUILD || undefined });   // (v152, G18) /version.json 과 같은 값(index.html 의 ?v=) — 로그인 화면·이전 테마 포함 이 한 곳

async function boot() {
  // (v92) 로컬 서버(serve.py)가 있으면 서버 계정·AI 프록시 모드로 — server.js 가 판별할 때까지 기다린다(없으면 바로 false).
  if (window.SERVER && SERVER.ready) { try { await SERVER.ready; } catch (e) { /* 아래에서 막는다 */ } }
  // (v93) 모든 스크립트(rnd.js·shell.js 등)가 읽히고 화면 등록(DOMContentLoaded)이 끝난 뒤에 시작한다.
  //   로컬 서버가 빠르면 로그인 확인이 먼저 끝나, 아직 등록 안 된 '연구 프로젝트' 화면 대신 옛 홈이 그려지던 문제.
  if (document.readyState === "loading") await new Promise((r) => document.addEventListener("DOMContentLoaded", r, { once: true }));
  await new Promise((r) => setTimeout(r, 0));
  // (v93) 백엔드 전용 — 서버(serve.py)가 없으면 로그인 화면에서 안내만 하고 멈춘다(브라우저 단독 모드 없음)
  if (!(window.SERVER && SERVER.on)) {
    bindAuthEvents(); showAuth();
    const d = $("authServerDown"); if (d) d.classList.remove("hidden");
    const f = $("authForm"); if (f) f.querySelectorAll("input,button").forEach((x) => { x.disabled = true; });
    if (RUI_LOGIN) {
      RUI_LOGIN.error("ScholarFlow 서버에 연결할 수 없습니다. 서버(serve.py)를 켠 뒤 새로고침하세요.");
      $("authRui").querySelectorAll("form input, form button[type=submit]").forEach((x) => { x.disabled = true; });
    }
    return;
  }
  // 시스템 설정(브랜딩·메뉴)은 로그인 화면에도 필요 → 가장 먼저 읽어 적용.
  try { SYSCFG = await adGetSystem(); } catch (e) { SYSCFG = sysDefaults(); }
  applyBranding();
  try { await Api.ensureSeed(); } catch (e) { /* 시드 실패해도 로그인 화면은 표시 */ }
  applySignupLockUI();
  bindAuthEvents();
  let user = null;
  try { user = await Api.currentUser(); } catch (e) { user = null; }
  if (user) { hideAuth(); await startApp(); }
  else { showAuth(); }
}

// 회원가입 잠금 UI(요청 ⑪): config.ALLOW_SIGNUP=false 면 회원가입 탭을 숨기고 로그인만 노출.
//   원복: config.js 의 ALLOW_SIGNUP:true → 회원가입 탭이 다시 나타난다.
function applySignupLockUI() {
  const allow = (typeof CONFIG !== "undefined" && CONFIG.ALLOW_SIGNUP === true);
  const regTab = document.querySelector('[data-authtab="register"]');
  const tabs = document.querySelector(".auth-tabs");
  if (!allow) {
    if (regTab) regTab.classList.add("hidden");
    if (tabs) tabs.classList.add("hidden");         // 탭 자체 숨김(로그인 전용)
    AUTH_TAB = "login";
    const sub = $("authSub");
    if (sub) sub.textContent = "로그인하세요.";
  } else {
    if (regTab) regTab.classList.remove("hidden");
    if (tabs) tabs.classList.remove("hidden");
    const note = $("authAdminNote");
    if (note) note.classList.add("hidden");
  }
}

function bindAuthEvents() {
  document.querySelectorAll("[data-authtab]").forEach((b) => {
    b.addEventListener("click", () => setAuthTab(b.dataset.authtab));
  });
  const form = $("authForm");
  if (form) form.addEventListener("submit", (e) => { e.preventDefault(); submitAuth(); });
  const lo = $("logoutBtn"); if (lo) lo.addEventListener("click", doLogout);
}

/* (v148) G16 공통 로그인 화면 — 직접 그리지 않고 RUI.login 하나로. 시스템이 정하는 것은 옵션 값과 onSubmit 뿐.
 *   왼쪽 시스템 면 문구는 tools/sso_api.py LOGIN_PITCH 와 같다. 이전 테마(legacy)에서는 예전 auth-card 를 쓴다. */
const LOGIN_PITCH = {
  tagline: "연구 자료와 학습 자료를 한 곳에서",
  desc: "연구 프로젝트 자료·문서 정리, 학습 자료 읽기, AI 도우미",
  points: ["연구 자료 정리와 보고서·논문·발표자료 작성", "학습 자료 읽기와 AI 도우미", "계정·AI 연결·백업을 서버 한 곳에서 관리"],
};
let RUI_LOGIN = null;
function ensureRuiLogin() {
  if (RUI_LOGIN) return RUI_LOGIN;
  const host = $("authRui");
  if (!host || !(window.RUI && RUI.login && window.RUIAPP && RUIAPP.on())) return null;
  const custom = (typeof SYSCFG !== "undefined" && SYSCFG && SYSCFG.branding && (SYSCFG.branding.title || "").trim()) || "";
  RUI_LOGIN = RUI.login(host, Object.assign({ self: "slc", version: (window.SERVER && SERVER.version) || "", onSubmit: ruiLoginSubmit, onEmergency: ruiEmergencySubmit }, LOGIN_PITCH, custom ? { name: custom } : {}));
  if (!(window.SERVER && SERVER.version)) {
    fetch("api.php?r=health", { cache: "no-store" }).then((r) => r.json()).then((d) => setLoginVer(d && d.version)).catch(() => {});
  }
  return RUI_LOGIN;
}
function setLoginVer(v) {
  const id = document.querySelector("#authRui .rui-login-id"); if (!id || !v) return;
  let el = id.querySelector(".ver"); if (!el) { el = document.createElement("span"); el.className = "ver"; id.appendChild(el); }
  el.textContent = v;
}
async function ruiLoginSubmit(id, pw) {
  let res = null;
  try { res = await Api.login(id, pw); } catch (e) { throw new Error("로그인하지 못했습니다. 다시 시도하세요."); }
  if (!res || !res.ok) throw new Error((res && res.message) || "아이디 또는 비밀번호가 올바르지 않습니다.");
  const p = document.querySelector("#authRui [name=p]"); if (p) p.value = "";
  hideAuth();
  await startApp();
  if (window.SERVER && SERVER.on && SERVER.paintBanner) SERVER.paintBanner();
}

/* (v169) 비상복구모드 — 서버가 통합로그인 접속 불가라고 할 때만. G31 이면 RUI.login 의 onEmergency, 아니면 emergency.js 자체 칸 */
async function ruiEmergencySubmit(id, pw) {
  await EMG.login(id, pw);
  await ruiEmergencySubmit.done();
}
ruiEmergencySubmit.done = async function () {
  location.reload();          // 비상 세션 쿠키로 처음부터(서버 계정 상태·역할을 서버에서 다시 받는다)
};
/* (v135) 통합로그인 모드: off 면 그대로, choice 면 아래에 [통합로그인], only 면 그 버튼만 */
async function paintAuthSso() {
  const box = $("authSso"), form = $("authForm"), tabs = document.querySelector(".auth-tabs"), note = $("authSsoNote");
  let d = null; try { d = await (await fetch("api.php?r=sso&op=status", { cache: "no-store", credentials: "same-origin" })).json(); } catch (e) { d = null; }
  const m = (d && d.mode) || "off";
  const emg = m !== "off" && d && d.up === false && window.EMG ? await EMG.available() : false;
  if (RUI_LOGIN) RUI_LOGIN.setSso({ mode: m, ready: !(d && (d.ready === false || d.up === false)), href: "/sso/start", emergency: emg });   // (v148) G16 · (v169) G31 emergency
  if (window.EMG) EMG.paintLogin({ rui: !!RUI_LOGIN, host: RUI_LOGIN ? document.querySelector("#authRui .rui-login-main") : (box && box.parentNode), available: emg, onDone: () => ruiEmergencySubmit.done() });
  if (window.SERVER && SERVER.emgNotice) {          // (v169) 통합로그인이 복구돼 비상 세션이 끝났다는 안내
    if (RUI_LOGIN) RUI_LOGIN.error(SERVER.emgNotice); else authMsg(SERVER.emgNotice, true);
    SERVER.emgNotice = null;
  }
  if (!box) return;
  box.classList.toggle("hidden", m === "off");
  box.classList.toggle("only", m === "only");
  const sb = $("authSsoBtn"); if (sb) { sb.classList.toggle("primary", m === "only"); sb.classList.toggle("ghost-btn", m !== "only"); }
  if (form) form.classList.toggle("hidden", m === "only");
  if (tabs) tabs.classList.toggle("hidden", m !== "off" || tabs.dataset.off === "1");
  const sub = $("authSub"); if (sub && m === "only") sub.textContent = "통합로그인 계정으로 로그인하세요.";
  if (note) {
    const down = m !== "off" && d && d.up === false;
    note.classList.toggle("hidden", !down);
    note.textContent = !down ? "" : m === "choice" ? "통합로그인 서버가 응답하지 않습니다. 위의 로컬 계정으로 로그인할 수 있습니다." : "통합로그인 서버가 응답하지 않습니다. 관리자는 서버 PC 에서 python tools/sso_off.py 로 로컬 로그인을 되살릴 수 있습니다.";
  }
}
function showAuth() {
  document.body.classList.remove("booting");   // 로그인 화면은 가림막 위에
  const rl = ensureRuiLogin();
  paintAuthSso();
  const s = $("authScreen"); if (s) s.classList.remove("hidden");
  const u = rl ? document.querySelector("#authRui [name=u]") : $("authUser"); if (u) setTimeout(() => u.focus(), 50);
  document.body.classList.add("auth-visible");   // 로그인 화면에서는 화면 도우미를 숨긴다
}
function hideAuth() {
  if (!APP_STARTED) document.body.classList.add("booting");   // 로그인 직후 앱을 준비하는 동안에도 첫 화면 전까지 가린다
  const s = $("authScreen"); if (s) s.classList.add("hidden");
  document.body.classList.remove("auth-visible");
}

function authMsg(text, ok) {
  const m = $("authMsg"); if (!m) return;
  if (!text) { m.classList.add("hidden"); m.textContent = ""; return; }
  m.textContent = text;
  m.className = "auth-msg " + (ok ? "ok" : "bad");
}

function setAuthTab(tab) {
  AUTH_TAB = (tab === "register") ? "register" : "login";
  document.querySelectorAll("[data-authtab]").forEach((b) => {
    b.classList.toggle("active", b.dataset.authtab === AUTH_TAB);
  });
  const reg = AUTH_TAB === "register";
  const t = $("authTitle"); if (t) t.textContent = reg ? "회원가입" : "로그인";
  const sub = $("authSub"); if (sub) sub.textContent = reg
    ? "새 계정을 만드세요." : "계정으로 로그인하세요.";
  const btn = $("authSubmit"); if (btn) btn.textContent = reg ? "회원가입" : "로그인";
  const pass = $("authPass"); if (pass) pass.setAttribute("autocomplete", reg ? "new-password" : "current-password");
  authMsg("");
}

async function submitAuth() {
  const uEl = $("authUser"), pEl = $("authPass");
  const username = (uEl ? uEl.value : "").trim();
  const password = pEl ? pEl.value : "";
  if (!username || !password) { authMsg("아이디와 비밀번호를 모두 입력해 주세요.", false); return; }
  const btn = $("authSubmit");
  const prev = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "처리 중…"; }
  authMsg("");
  try {
    const res = (AUTH_TAB === "register")
      ? await Api.register(username, password, {})
      : await Api.login(username, password);
    if (!res || !res.ok) {
      authMsg((res && res.message) || "처리하지 못했어요. 다시 시도해 주세요.", false);
      if (btn) { btn.disabled = false; btn.textContent = prev; }
      return;
    }
    if (pEl) pEl.value = "";
    if (!(window.SERVER && SERVER.on)) { try { if (window.SHELL && SHELL.setMode) SHELL.setMode("research", false); } catch (e) { /* 계속 */ } }   // 로그인하면 연구지원부터
    hideAuth();
    await startApp();
    if (window.SERVER && SERVER.on && SERVER.paintBanner) SERVER.paintBanner();
  } catch (e) {
    authMsg("처리 중 오류가 발생했어요. 다시 시도해 주세요.", false);
    if (btn) { btn.disabled = false; btn.textContent = prev; }
  }
}

async function doLogout() {
  try { await Api.logout(); } catch (e) { /* 계속 */ }
  location.reload();
}

async function refreshUserChip() {
  let u = null;
  try { u = await Api.currentUser(); } catch (e) { u = null; }
  const chip = $("userChip");
  if (!chip) return;
  if (!u) { chip.hidden = true; return; }
  chip.hidden = false;
  const nameEl = $("userName"); if (nameEl) nameEl.textContent = u.username;
  const ava = $("userAva"); if (ava) ava.textContent = (u.role === "admin" ? "🛡️" : "🙂");
  const roleEl = $("userRole");
  if (roleEl) {
    if (u.role === "admin") { roleEl.textContent = "관리자"; roleEl.classList.remove("hidden"); }
    else { roleEl.textContent = "사용자"; roleEl.classList.add("hidden"); }   // (v143) 숨겨도 글자가 '관리자'로 남아 아래 계정 줄이 그걸 읽었다
  }
}

// ---- 초기화 (로그인 이후 1회) ----
async function startApp() {
  if (APP_STARTED) return; // 세션당 1회(로그아웃은 reload 로 초기화)
  APP_STARTED = true;
  try { SYSCFG = await adGetSystem(); } catch (e) { SYSCFG = sysDefaults(); } // 브랜딩·메뉴 구성(전역)
  applyNavConfig();      // 시스템 설정의 메뉴 순서/활성/그룹을 사이드바에 반영(이벤트 바인딩 전)
  bindShell();
  bindEvents();
  applySystemFeatures();
  await bootstrapStorage(); // 계정 저장소 하이드레이션 — 데이터 접근 전에 1회
  try {
    const base = defaultSettings();
    // 신규 사용자(저장된 표시 설정 없음)에게는 시스템 설정의 기본 테마/모드/글자크기/레이아웃 적용.
    const sd = (SYSCFG && SYSCFG.defaults) || {};
    ["theme", "mode", "fontscale", "layout"].forEach((k) => { if (sd[k]) base[k] = sd[k]; });
    SETTINGS = Object.assign(base, (await adLoadSettings()) || {});
  } catch (e) { /* 기본값 */ }
  applyDisplayFromSettings();
  await refreshUserChip();
  await applyAdminNav();            // 관리자 메뉴 노출
  startClock();
  await checkHealth();
  syncSettingsUI();
  window.addEventListener("beforeunload", () => { try { sessFlush(); } catch (e) { /* 무시 */ } });
  // 처음부터 지금 모드의 첫 화면으로
  const bootMode = window.SHELL && SHELL.mode ? SHELL.mode() : "research";
  const routed = (window.PINFO && PINFO.route ? PINFO.route() : null) || (window.HUBLINK ? HUBLINK.route() : null);   // #/p/<pid>/… · #/<화면> 바로 가기로 들어왔으면 그 화면부터
  await Promise.race([routed || navTo(bootMode === "library" ? "library" : "rx_dash"), new Promise((r) => setTimeout(r, 6000))]);
  bootDone();
  if (window.HUBLINK) { HUBLINK.silent(); HUBLINK.load(); }   // 연동된 시스템 조용히 로그인·통합 메뉴
}

/* =========================================================================
 * 시스템 설정 적용 (화이트라벨 브랜딩 + 메뉴 구성) — Pass 3
 *
 *   SYSCFG(전역/관리자 설정)를 실제 화면에 반영하는 계층. 저장 즉시 다시 호출되며,
 *   설정이 비어 있으면(기본값) 기존 동작(도메인 이름·기본 메뉴 순서)과 100% 동일하다.
 * ========================================================================= */
// 스프라이트(#i-*)에서 아이콘 하나를 꺼내 <svg><use></use></svg> 로 만든다.
//  ▸ 단색 선 아이콘이라 stroke=currentColor 로 테마 색을 그대로 따라간다.
function svgIcon(id, cls) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", cls || "nav-ico");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(NS, "use");
  use.setAttribute("href", "#" + id);
  svg.appendChild(use);
  return svg;
}
const NAV_GROUP_ORDER = ["main", "library", "system", "helpg", "admin"];
const NAV_GROUP_LABEL = { main: "", library: "", system: "설정", helpg: "", admin: "관리자" };   // 항목 하나뿐인 묶음은 제목 없이(단독 메뉴)
// 그룹 제목 아이콘(index.html 의 SVG 스프라이트 id). 메뉴 항목과 같은 모양·크기를 쓴다.
const NAV_GROUP_ICON = { system: "i-gear", admin: "i-shield" };
const NAV_MENU_LABEL = {
  home: "홈", library: "학습 자료", settings: "설정", sysconfig: "시스템 설정", help: "도움말", datacenter: "데이터 센터",
};
function sysMeta() {
  return (Api && Api.systemMeta) || { NAV_ORDER: [], NAV_GROUPS: {}, NAV_LOCKED: ["home", "admin", "sysconfig"] };
}
function navLocked(key) { return sysMeta().NAV_LOCKED.indexOf(key) >= 0; }
function navGroupOf(key) {
  const g = (SYSCFG.nav && SYSCFG.nav.groups) || {};
  return g[key] || sysMeta().NAV_GROUPS[key] || "system";
}
function navDisabled(key) {
  if (navLocked(key)) return false;
  const d = (SYSCFG.nav && SYSCFG.nav.disabled) || [];
  return d.indexOf(key) >= 0;
}
function navOrder() {
  const o = (SYSCFG.nav && SYSCFG.nav.order && SYSCFG.nav.order.length)
    ? SYSCFG.nav.order.slice() : sysMeta().NAV_ORDER.slice();
  return o;
}

// 이모지 → SVG 데이터 URI 파비콘(외부 파일 없이 탭 아이콘 교체).
function emojiFavicon(emoji) {
  const svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>" +
    "<text y='.9em' font-size='54'>" + String(emoji || "") + "</text></svg>";
  return "data:image/svg+xml," + encodeURIComponent(svg);
}
function setFavicon(href) {
  let link = $("faviconLink");
  if (!link) {
    link = document.createElement("link");
    link.id = "faviconLink"; link.rel = "icon";
    document.head.appendChild(link);
  }
  if (href) link.setAttribute("href", href);
}
// 로고 슬롯(사이드바 브랜드/로그인 화면)에 이미지 또는 이모지를 그린다.
function paintLogo(node, b) {
  if (!node) return;
  node.innerHTML = "";
  if (b.logo_image) {
    const img = document.createElement("img");
    img.className = "brand-logo-img"; img.src = b.logo_image; img.alt = "";
    node.appendChild(img);
  } else {
    node.textContent = b.logo_emoji || "📘";
  }
}
// 앱 이름: 시스템 설정 > 도메인 표시명 > 기본값.
const DEFAULT_APP_TITLE = "ScholarFlow";
function brandTitleText() {
  const t = (SYSCFG.branding && SYSCFG.branding.title || "").trim();
  return t || DEFAULT_APP_TITLE;
}
function applyBranding() {
  const b = (SYSCFG && SYSCFG.branding) || {};
  const name = brandTitleText();
  if (el.brandName) el.brandName.textContent = name;
  const sub = $("brandSub");
  if (sub) sub.textContent = (b.subtitle || "").trim() || "";
  paintLogo($("brandMark"), b);
  paintLogo($("authMark"), b);
  const at = $("authBrandText");
  if (at) at.textContent = (b.subtitle || "").trim() || brandTitleText();
  document.title = name;
  setFavicon(b.favicon_image || emojiFavicon(b.favicon_emoji || b.logo_emoji || "📘"));
}

/* 메뉴 순서/활성/그룹을 사이드바(=탑메뉴 공용 마크업)에 반영.
   기존 nav-item 노드를 **그대로 재배치**하므로 배지/자물쇠/이벤트 핸들러가 유지된다. */
let NAV_NODES = null; // key → 원본 nav-item 노드(최초 1회 캡처)
function applyNavConfig() {
  const navRoot = document.querySelector(".side-nav");
  if (!navRoot) return;
  if (!NAV_NODES) {
    NAV_NODES = {};
    navRoot.querySelectorAll(".nav-item[data-nav]").forEach((n) => { NAV_NODES[n.dataset.nav] = n; });
  }
  const order = navOrder().filter((k) => NAV_NODES[k]);
  // 마크업에는 있는데 순서 목록에 없는 항목(구버전 설정)도 잃지 않게 뒤에 보충.
  Object.keys(NAV_NODES).forEach((k) => { if (order.indexOf(k) < 0) order.push(k); });

  navRoot.innerHTML = "";
  NAV_GROUP_ORDER.forEach((gid) => {
    const keys = order.filter((k) => navGroupOf(k) === gid && !navDisabled(k));
    if (!keys.length) return;
    const div = document.createElement("div");
    div.className = "nav-group";
    if (gid === "admin") div.id = "adminNavGroup"; // applyGating 이 이 id 로 노출 제어
    let host = div;
    if (NAV_GROUP_LABEL[gid]) {
      const h = document.createElement("p");
      h.className = "nav-heading";
      // 아이콘 + 글자 — 메뉴 항목(.nav-item)과 똑같은 구조라 크기·정렬이 자동으로 맞는다.
      if (NAV_GROUP_ICON[gid]) {
        h.appendChild(svgIcon(NAV_GROUP_ICON[gid], "nav-ico"));
      }
      const ht = document.createElement("span");
      ht.className = "nav-text"; ht.textContent = NAV_GROUP_LABEL[gid];
      h.appendChild(ht);
      div.appendChild(h);
      // 그룹 제목이 있으면 항목들을 .nav-sub 로 감싼다.
      // 탑메뉴에서는 이 래퍼가 통째로 하나의 드롭다운 패널이 된다.
      host = document.createElement("div");
      host.className = "nav-sub";
      div.appendChild(host);
    }
    keys.forEach((k) => { NAV_NODES[k].classList.remove("hidden"); host.appendChild(NAV_NODES[k]); });
    navRoot.appendChild(div);
  });
  // 관리자 그룹이 통째로 사라지지 않도록(관리자 항목이 하나도 없을 때) 빈 그룹 자리 보장.
  if (!$("adminNavGroup")) {
    const div = document.createElement("div");
    div.className = "nav-group hidden"; div.id = "adminNavGroup";
    navRoot.appendChild(div);
  }
  setActiveNav(state.nav);
  updateNavScroll();
}

/* 탑메뉴 가로 스크롤 화살표.
   스크롤 컨테이너(.side-nav) 밖인 .sidebar 에 한 번만 만들어 두고 절대위치로 띄운다.
   ▸ 안에 넣으면 가장자리 페이드 마스크에 화살표까지 흐려진다.
   ▸ applyNavConfig 이 내비를 다시 그려도 화살표는 그대로 살아 있다. */
/* 가로 스크롤 애니메이션 — 브라우저의 behavior:"smooth" 에 기대지 않는다.
   (임베디드 웹뷰 등 일부 환경에서 smooth 스크롤이 통째로 무시돼 버튼이 안 먹는다) */
function smoothScrollX(el, target, ms) {
  if (!el) return;
  const max = el.scrollWidth - el.clientWidth;
  target = Math.max(0, Math.min(max, Math.round(target)));
  const from = el.scrollLeft, dist = target - from;
  if (el._sxRaf) { cancelAnimationFrame(el._sxRaf); el._sxRaf = null; }
  if (Math.abs(dist) < 1) { el.scrollLeft = target; return; }
  const dur = ms || 240, t0 = performance.now();
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const done = () => {
    if (el._sxRaf) { cancelAnimationFrame(el._sxRaf); el._sxRaf = null; }
    if (el._sxFb) { clearTimeout(el._sxFb); el._sxFb = null; }
    el.scrollLeft = target;
    updateNavScroll();
  };
  const step = (now) => {
    const t = Math.min(1, (now - t0) / dur);
    el.scrollLeft = from + dist * ease(t);
    if (t < 1) el._sxRaf = requestAnimationFrame(step);
    else done();
  };
  el._sxRaf = requestAnimationFrame(step);
  // 안전망: 탭이 백그라운드면 rAF 가 아예 돌지 않는다(화면을 안 그리므로).
  //   그때도 스크롤 위치는 맞춰 둬야 다시 돌아왔을 때 어긋나 보이지 않는다.
  if (el._sxFb) clearTimeout(el._sxFb);
  el._sxFb = setTimeout(() => { if (el._sxRaf || el.scrollLeft !== target) done(); }, dur + 120);
}
function navArrowHost() {
  return document.getElementById("sidebar") || document.querySelector(".sidebar");
}
function ensureNavArrows() {
  const host = navArrowHost(), nav = $("sideNav");
  if (!host || !nav || host.querySelector(".nav-arrow")) return;
  ["l", "r"].forEach((dir) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "nav-arrow nav-arrow-" + dir;
    b.setAttribute("aria-label", dir === "l" ? "메뉴 왼쪽으로 스크롤" : "메뉴 오른쪽으로 스크롤");
    b.tabIndex = -1;                               // 키보드 탭 순서는 메뉴 항목만
    b.appendChild(svgIcon(dir === "l" ? "i-chev-l" : "i-chev-r", "nav-arrow-ico"));
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      const step = Math.max(160, Math.round(nav.clientWidth * 0.6));
      smoothScrollX(nav, nav.scrollLeft + (dir === "l" ? -step : step));
    });
    host.appendChild(b);
  });
}

/* 사이드바 레이아웃 상단바(.top-right)도 한 줄 고정 + 가로 스크롤.
   왼쪽에 가려진 게 있으면 그쪽 가장자리를 흐리게 해서 알려 준다. */
function updateTopRightScroll() {
  const tr = $("topRight");
  if (!tr) return;
  const can = !isTopnav() && tr.scrollLeft > 2;
  tr.classList.toggle("can-l", can);
}

// 어느 쪽으로 더 갈 수 있는지 → 페이드(내비)·화살표(바) 표시와 위치 갱신.
function updateNavScroll() {
  const nav = $("sideNav"), host = navArrowHost();
  if (!nav || !host) return;
  if (!isTopnav()) {
    nav.classList.remove("can-l", "can-r");
    host.classList.remove("can-l", "can-r");
    return;
  }
  ensureNavArrows();
  const max = nav.scrollWidth - nav.clientWidth;
  const x = nav.scrollLeft;
  const canL = max > 2 && x > 2, canR = max > 2 && x < max - 2;
  nav.classList.toggle("can-l", canL);
  nav.classList.toggle("can-r", canR);
  host.classList.toggle("can-l", canL);
  host.classList.toggle("can-r", canR);
  // 화살표를 내비의 좌/우 끝에 붙인다(바 기준 좌표).
  const hb = host.getBoundingClientRect(), nb = nav.getBoundingClientRect();
  const al = host.querySelector(".nav-arrow-l"), ar = host.querySelector(".nav-arrow-r");
  // 오른쪽 화살표는 자기 실측 폭만큼 안으로 당긴다.
  //   숨어 있을 때는 offsetWidth 가 0 이므로 CSS 기본값(26)으로 대신한다.
  //   26 으로 하드코딩하면 글자 크기 배율에 따라 내비 밖으로 삐져나갔다.
  if (al) al.style.left = Math.round(nb.left - hb.left) + "px";
  if (ar) ar.style.left = Math.round(nb.right - hb.left - (ar.offsetWidth || 26)) + "px";
  observeNavWidth(nav, host);
}

/* 내비 폭이 창 리사이즈 없이 바뀌는 경우가 많다.
     - 화면 도우미 패널 개폐(.app-shell 에 오른쪽 여백이 생긴다)
     - 폭 모드(와이드/숏)·글자 크기·레이아웃 전환
     - 메뉴 항목 자체가 늘거나 줄 때(관리자 메뉴 노출 등)
   resize 이벤트만 듣고 있으면 이때 화살표가 안 나타나거나, 나타난 채
   예전 좌표에 붙박여 있었다. 폭 변화를 직접 관측해서 다시 계산한다. */
let navWidthRO = null;
let navWidthTick = null;
let navWidthSeen = "";
function navWidthApply() {
  updateNavScroll();
  updateTopRightScroll();
  repositionOpenNavPanel();
}
function observeNavWidth(nav, host) {
  if (navWidthTick) return;                       // 이미 감시 중
  // 1) 정확하고 즉각적인 쪽 — 지원되면 폭이 바뀌는 즉시 불린다.
  if (typeof ResizeObserver === "function") {
    let t = 0;
    navWidthRO = new ResizeObserver(() => {
      // 콜백 안에서 곧바로 레이아웃을 읽으면 "ResizeObserver loop" 경고가 난다.
      //   빠져나온 뒤에 계산해야 하는데 requestAnimationFrame 은 쓸 수 없다 —
      //   프레임이 멈춘 환경에서는 그 예약이 영영 실행되지 않는다.
      if (t) return;
      t = setTimeout(() => { t = 0; navWidthApply(); }, 0);
    });
    navWidthRO.observe(nav);
    if (host && host !== nav) navWidthRO.observe(host);
    const tr0 = $("topRight");
    if (tr0) navWidthRO.observe(tr0);
  }
  // 2) 확실한 쪽 — 관측자가 죽어 있어도 도는 감시 타이머.
  //    치수가 그대로면 아무것도 하지 않으므로 평소 비용은 읽기 두 번뿐이다.
  navWidthTick = setInterval(() => {
    const n = $("sideNav");
    if (!n) return;
    const tr = $("topRight");
    const key = n.clientWidth + ":" + n.scrollWidth +
                (tr ? "/" + tr.clientWidth + ":" + tr.scrollWidth : "");
    if (key === navWidthSeen) return;
    navWidthSeen = key;
    navWidthApply();
  }, 350);
}
// 선택된 메뉴가 스크롤 밖에 있으면 보이는 곳으로 끌어온다.
function scrollActiveNavIntoView() {
  const nav = $("sideNav");
  if (!nav || !isTopnav()) return;
  const act = nav.querySelector(".nav-item.active") || nav.querySelector(".nav-group.has-active > .nav-heading");
  if (!act) return;
  const n = nav.getBoundingClientRect(), a = act.getBoundingClientRect();
  const pad = 40;                                  // 화살표에 가리지 않게 여유
  if (a.left < n.left + pad) smoothScrollX(nav, nav.scrollLeft + (a.left - n.left - pad));
  else if (a.right > n.right - pad) smoothScrollX(nav, nav.scrollLeft + (a.right - n.right + pad));
}

/* 열린 드롭다운 패널의 위치를 그룹 제목 아래에 맞춘다.
   패널은 fixed 라서(스크롤 컨테이너에 잘리지 않게) 좌표를 직접 넣어야 한다.
   화면 오른쪽으로 넘치면 왼쪽으로 당겨 붙인다. */
function positionNavPanel(group) {
  if (!group || !isTopnav()) return;
  const head = group.querySelector(":scope > .nav-heading");
  const sub = group.querySelector(":scope > .nav-sub");
  if (!head || !sub) return;
  const r = head.getBoundingClientRect();
  sub.style.top = Math.round(r.bottom + 6) + "px";
  const w = sub.offsetWidth || 210;
  const maxLeft = window.innerWidth - w - 8;
  sub.style.left = Math.round(Math.max(8, Math.min(r.left, maxLeft))) + "px";
}
function repositionOpenNavPanel() {
  const g = document.querySelector(".side-nav .nav-group.open");
  if (g) positionNavPanel(g);
}

function applySystemFeatures() { /* 전역 스위치 — 공개판에는 따로 없다 */ }

async function applySystemConfig() {
  applyBranding();
  applyNavConfig();
  applySystemFeatures();
  await applyAdminNav();
  // 방금 끈 메뉴를 보고 있었다면 첫 화면으로(끊긴 화면에 남지 않게).
  if (navDisabled(state.nav)) navTo(homeNav());
}

function bindEvents() {
  bindLibraryEvents();
  bindAskEvents();
  bindSettingsEvents();
  bindSysEvents();      // 시스템 설정(관리자) 화면 정적 이벤트
}

function bindShell() {
  document.querySelectorAll("[data-nav]").forEach((b) => {
    b.addEventListener("click", () => navTo(b.dataset.nav));
  });
  if (el.hamburger) el.hamburger.addEventListener("click", () => document.body.classList.toggle("drawer-open"));
  if (el.scrim) el.scrim.addEventListener("click", closeDrawer);
  // 폭 버튼 → 작은 메뉴: [내용 폭] 와이드·일반 · [탑메뉴 폭] 와이드·일반 (둘은 따로 움직인다)
  if (el.widthToggle) el.widthToggle.addEventListener("click", (e) => { e.stopPropagation(); widthMenuToggle(); });
  document.addEventListener("click", (e) => {
    const m = document.getElementById("widthMenu");
    if (m && !m.classList.contains("hidden") && !m.contains(e.target) && e.target !== el.widthToggle) m.classList.add("hidden");
  });
  if (el.darkToggle) el.darkToggle.addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-mode");
    setDisplay({ mode: cur === "dark" ? "light" : "dark" });
  });
}
function closeDrawer() { document.body.classList.remove("drawer-open"); }

// ---- 내비게이션 라우터 ----
function bootDone() { document.body.classList.remove("booting"); }
async function navTo(nav) {
  if (!nav || nav === "home" || nav === "today") nav = homeNav();
  // 시스템 설정에서 끈 메뉴는 직접 라우팅해도 첫 화면으로 보낸다(내비에서 숨김 + 진입 차단).
  if (navDisabled(nav)) nav = homeNav();
  state.nav = nav;
  setActiveNav(nav);
  closeDrawer();
  audit("view.open", nav, { title: navTitle(nav) });
  if (EXT_VIEWS[nav]) { showSection(EXT_VIEWS[nav].area); try { await EXT_VIEWS[nav].open(); } catch (e) { console.error(e); } return; }
  if (nav === "sysconfig") { showSection(sy.area); renderSysConfig(); return; }
  if (nav === "library") {
    state.mode = "library"; showSection(lb.area);
    if (restoreLibrary()) { showResumeNote("보던 자료를 다시 펼쳤어요"); return; }
    openLibrary(); return;
  }
  if (nav === "settings") { showSection(el.settingsArea); return; }
  // 모르는 화면 → 지금 모드의 첫 화면
  const h = homeNav();
  if (nav !== h) return navTo(h);
}
// 지금 모드의 첫 화면(연구지원 = 오늘 연구, 자료 학습 = 학습 자료)
function homeNav() {
  const m = window.SHELL && SHELL.mode ? SHELL.mode() : "research";
  return m === "library" ? "library" : (typeof EXT_VIEWS !== "undefined" && EXT_VIEWS.rx_dash ? "rx_dash" : "library");
}

function allSections() {
  return [el.settingsArea, sy.area, lb.area].concat(Object.keys(EXT_VIEWS).map((k) => EXT_VIEWS[k].area)).filter(Boolean);
}
function showSection(node) {
  // 자료 읽기 전용 여백 해제 — 다른 화면으로 나가면 원래 여백으로 돌아와야 한다.
  if (typeof lb === "undefined" || node !== lb.area) {
    document.body.classList.remove("lib-reading");
  }
  allSections().forEach(hide);
  show(node);
  window.scrollTo(0, 0);
}

function setActiveNav(nav) {
  document.querySelectorAll(".nav-item").forEach((b) => {
    b.classList.toggle("active", b.dataset.nav === nav);
  });
  // 탑메뉴: 선택된 항목이 드롭다운 안이면 닫혀 있을 때 안 보이므로 그룹 제목에도 표시
  document.querySelectorAll(".nav-group").forEach((g) => {
    g.classList.toggle("has-active", !!g.querySelector(".nav-item.active"));
  });
  if (el.viewTitle) el.viewTitle.textContent = navTitle(nav);
  if (typeof askRefreshHeader === "function") askRefreshHeader();
  scrollActiveNavIntoView();
  updateNavScroll();
}
function navTitle(nav) {
  return { home: "홈", settings: "설정", sysconfig: "시스템 설정", library: "학습 자료", help: "도움말",
           datacenter: "데이터 센터" }[nav] || "ScholarFlow";
}

// ---- 표시(테마 / 다크 / 글자크기) ----
// 폭 모드 3단계(v80): wide(제한 없음) · mid(중간 1480px) · short(일반, 테마 최대폭)
const WIDTHS = [["wide", "와이드"], ["mid", "중간"], ["short", "일반"]];
function normWidth(v) { return v === "short" || v === "mid" ? v : "wide"; }
function widthLabel(v) { return (WIDTHS.filter((x) => x[0] === normWidth(v))[0] || WIDTHS[0])[1]; }
function currentDisplay() {
  const r = document.documentElement;
  return { theme: r.getAttribute("data-theme"), mode: r.getAttribute("data-mode"),
           fontscale: r.getAttribute("data-fontscale"), layout: r.getAttribute("data-layout") || "sidebar",
           width: normWidth(r.getAttribute("data-width")),
           barwidth: normWidth(r.getAttribute("data-barwidth")),
           font: r.getAttribute("data-font") === "system" ? "system" : "pretendard", ...ruiSavedDisplay() };
}
/* research-ui(v119): 새 테마에서 html 속성은 새 테마 값이다. 저장·설정에는 사용자의 예전 값을 그대로 돌려줘
   이전 테마로 돌아갔을 때 v118 모습이 되게 한다. */
function ruiOn() { return !!(window.RUIAPP && RUIAPP.on()); }
function ruiSavedDisplay() {
  if (!ruiOn()) return {};
  const s = RUIAPP.saved, o = {};
  ["theme", "mode", "layout"].forEach((k) => { if (s[k]) o[k] = s[k]; });
  return o;
}
function applyDisplay(d) {
  const r = document.documentElement;
  if (ruiOn()) {   // 예전 값은 기억만 하고 속성은 새 테마가 정한다
    RUIAPP.remember(d);
    d = Object.assign({}, d); delete d.theme; delete d.mode; delete d.layout;
    RUIAPP.enforce();
  }
  if (d.theme) r.setAttribute("data-theme", d.theme);
  if (d.mode) r.setAttribute("data-mode", d.mode);
  if (d.fontscale) r.setAttribute("data-fontscale", d.fontscale);
  if (d.layout) r.setAttribute("data-layout", d.layout);
  if (d.width) r.setAttribute("data-width", normWidth(d.width));
  if (d.barwidth) r.setAttribute("data-barwidth", normWidth(d.barwidth));
  if (d.font) r.setAttribute("data-font", d.font === "system" ? "system" : "pretendard");
  applyLayoutStructure(r.getAttribute("data-layout") || "sidebar");
  paintDisplayToggles();
  // 레이아웃/폭이 바뀌면 내비가 넘치는지도 달라진다 → 화살표·페이드 상태 재계산.
  if (typeof updateNavScroll === "function") updateNavScroll();
  if (typeof updateTopRightScroll === "function") updateTopRightScroll();
    if (typeof libFitHeight === "function") setTimeout(libFitHeight, 0);
  syncLibraryTheme();
}
/* 레이아웃별 1단 통합: 탑메뉴 모드에서는 우측 컨트롤(.top-right)을 상단 내비 바
   (.sidebar) 안으로 이동시켜 브랜드·메뉴·컨트롤을 한 줄에 둔다. 사이드바 모드로
   돌아오면 원래 위치(.topbar)로 복귀. 같은 노드를 이동하므로 이벤트 핸들러는 유지됨. */
/* 라이트/다크를 바꾸면 펼쳐 둔 학습 자료도 같은 밝기로 맞춘다.
   문서는 iframe 안의 독립 페이지라 앱 CSS 변수가 닿지 않는다. */
function syncLibraryTheme() {
  if (typeof libSyncFrameTheme === "function") libSyncFrameTheme();
}
// 상단 토글(다크·폭) 아이콘/라벨을 현재 상태의 "누르면 이렇게 됨"으로 갱신한다.
function paintDisplayToggles() {
  const r = document.documentElement;
  const dark = r.getAttribute("data-mode") === "dark";
  const wide = r.getAttribute("data-width") !== "short";
  const barWide = r.getAttribute("data-barwidth") !== "short";
  const wl = widthLabel(r.getAttribute("data-width")), bl = widthLabel(r.getAttribute("data-barwidth"));
  // 아이콘·라벨·툴팁은 모두 "누르면 이렇게 됨"을 가리킨다.
  const set = (btn, ico, txt) => {
    if (!btn) return;
    const i = btn.querySelector(".tgl-ico"), t = btn.querySelector(".tgl-txt");
    if (i) i.textContent = ico; else btn.textContent = ico;
    if (t) t.textContent = txt;
    btn.title = txt + "로 전환";
    btn.setAttribute("aria-pressed", "false");
  };
  set(el.darkToggle, dark ? "☀️" : "🌙", dark ? "라이트 모드" : "다크 모드");
  if (el.widthToggle) {
    const i = el.widthToggle.querySelector(".tgl-ico");
    if (i) i.textContent = wide || barWide ? "↔" : "⇥";
    el.widthToggle.title = "화면 폭 — 내용 " + wl + " · 탑메뉴 " + bl;
    el.widthToggle.setAttribute("aria-haspopup", "true");
  }
  widthMenuPaint();
}
// 폭 메뉴(바 버튼 아래) — 내용 폭 · 탑메뉴 폭을 따로
function widthMenuToggle() {
  let m = document.getElementById("widthMenu");
  if (!m) {
    m = document.createElement("div");
    m.id = "widthMenu"; m.className = "width-menu hidden"; m.setAttribute("role", "menu");
    const row = (label, key) => {
      const r = document.createElement("div"); r.className = "wm-row";
      const l = document.createElement("span"); l.className = "wm-label"; l.textContent = label; r.appendChild(l);
      const seg = document.createElement("div"); seg.className = "seg";
      WIDTHS.forEach((x) => {
        const b = document.createElement("button"); b.type = "button"; b.className = "seg-btn"; b.dataset.k = key; b.dataset.v = x[0]; b.textContent = x[1];
        b.addEventListener("click", (e) => { e.stopPropagation(); const p = {}; p[key] = x[0]; setDisplay(p); });
        seg.appendChild(b);
      });
      r.appendChild(seg); m.appendChild(r);
    };
    row("내용 폭", "width");
    row("탑메뉴 폭", "barwidth");
    const n = document.createElement("p"); n.className = "wm-note"; n.textContent = "와이드 = 화면 끝까지 · 중간 = 1480px · 일반 = 읽기 좋은 폭. 탑메뉴 와이드·중간에서는 AI 모델 이름까지 보여요.";
    m.appendChild(n);
    document.body.appendChild(m);
  }
  m.classList.toggle("hidden");
  if (!m.classList.contains("hidden")) {
    const b = el.widthToggle.getBoundingClientRect();
    m.style.top = Math.round(b.bottom + 8) + "px";
    m.style.right = Math.max(8, Math.round(window.innerWidth - b.right)) + "px";
    widthMenuPaint();
  }
}
function widthMenuPaint() {
  const m = document.getElementById("widthMenu");
  if (!m) return;
  const d = currentDisplay();
  m.querySelectorAll(".seg-btn").forEach((b) => b.classList.toggle("active", d[b.dataset.k] === b.dataset.v));
}
function applyLayoutStructure(layout) {
  const sidebar = document.getElementById("sidebar");
  const topbar = document.querySelector(".topbar");
  const topRight = document.getElementById("topRight");
  if (!sidebar || !topbar || !topRight) return;
  if (layout === "topnav") {
    if (topRight.parentElement !== sidebar) sidebar.appendChild(topRight);
  } else {
    // 학습 앱형·커맨드 센터형(shell.js)도 상단 바에 둔다 — 셸 버튼(검색 등) 뒤 자리
    if (topRight.parentElement !== topbar) topbar.insertBefore(topRight, document.getElementById("shInspBtn"));
  }
  if (window.SHELL) window.SHELL.apply(layout);
}
// 셸(커맨드 센터형)의 아래 상태줄처럼 화면 아래를 덮는 막대 높이 — 높이 맞춤(대화방·자료 뷰어)에서 뺀다
function shellInsetBottom() {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--shell-bottom"));
  return isFinite(v) ? v : 0;
}
function applyDisplayFromSettings() {
  applyDisplay({ theme: SETTINGS.theme, mode: SETTINGS.mode, fontscale: SETTINGS.fontscale,
                 layout: SETTINGS.layout, width: SETTINGS.width, font: SETTINGS.font,
                 barwidth: SETTINGS.barwidth || SETTINGS.width });
  saveDisplayLocal();
}
function saveDisplayLocal() {
  // 표시 설정 영속화는 Api 로 위임(내부 localStorage.setItem 이 동기 실행됨).
  try { Api.setDisplay(currentDisplay()); } catch (e) { /* ignore */ }
}
function setDisplay(patch) {
  if (ruiOn()) patch = RUIAPP.intercept(patch);
  applyDisplay(Object.assign(currentDisplay(), patch));
  const d = currentDisplay();
  SETTINGS.theme = d.theme; SETTINGS.mode = d.mode; SETTINGS.fontscale = d.fontscale;
  SETTINGS.layout = d.layout; SETTINGS.width = d.width; SETTINGS.font = d.font; SETTINGS.barwidth = d.barwidth;
  saveDisplayLocal();
  syncSettingsUI();
  persistSettings();
}

function bindSettingsEvents() {
  bindLlmEvents();
  bindTopnavDropdowns();
  segBind(el.setThemeSeg, "theme", (v) => setDisplay({ theme: v }));
  segBind(el.setModeSeg, "md", (v) => setDisplay({ mode: v }));
  segBind(el.setFontSeg, "fs", (v) => setDisplay({ fontscale: v }));
  segBind(el.setLayoutSeg, "lay", (v) => setDisplay({ layout: v }));
  segBind(el.setWidthSeg, "wd", (v) => setDisplay({ width: v }));
  segBind($("setBarWidthSeg"), "bw", (v) => setDisplay({ barwidth: v }));
  segBind(el.setFontFamSeg, "ff", (v) => setDisplay({ font: v }));
}
function segBind(seg, attr, fn) {
  if (!seg) return;
  seg.querySelectorAll(".seg-btn").forEach((b) => b.addEventListener("click", () => fn(b.dataset[attr])));
}
function segActivate(seg, attr, val) {
  if (!seg) return;
  seg.querySelectorAll(".seg-btn").forEach((b) => b.classList.toggle("active", b.dataset[attr] === String(val)));
}
function clampInt(v, lo, hi) { let n = parseInt(v, 10); if (isNaN(n)) n = lo; return Math.max(lo, Math.min(hi, n)); }

function syncSettingsUI() {
  if (window.RUIAPP) RUIAPP.mountSettings();
  const d = currentDisplay();
  segActivate(el.setThemeSeg, "theme", d.theme);
  segActivate(el.setModeSeg, "md", d.mode);
  segActivate(el.setFontSeg, "fs", d.fontscale);
  segActivate(el.setLayoutSeg, "lay", d.layout);
  segActivate(el.setWidthSeg, "wd", d.width);
  segActivate($("setBarWidthSeg"), "bw", d.barwidth);
  segActivate(el.setFontFamSeg, "ff", d.font);
  const info = (Api.llm.activeInfo && Api.llm.activeInfo()) || null;
  if (el.advModel) el.advModel.textContent = info ? info.model : "-";
  const ap = info ? (Api.llm._profile && Api.llm._profile()) : null;
  if (el.advTemp) el.advTemp.textContent = (ap && ap.params && ap.params.temperature != null) ? String(ap.params.temperature) : "-";
  hide(el.advKeyWarn);
  renderLlmSettings();
}

/* ===== AI 연결(LLM 프로필) ===== */
async function renderLlmSettings() {
  if (!el.llmList) return;
  if (window.SERVER && SERVER.on) return SERVER.renderLlmSettings();   // (v92) 서버 모드: 계정별 서버 보관 + 프록시
  try { renderLlmVault(); } catch (e) { /* 계속 */ }
  const r = await Api.llm.profiles();
  const profiles = (r && r.profiles) || [];
  const activeId = r && r.active_id;
  if (el.llmStateLine) {
    el.llmStateLine.textContent = activeId
      ? "연결됨 — 이 프로필로 AI 기능이 동작해요."
      : "AI 서버에 연결되어 있지 않아요. 아래에서 LLM 프로필을 불러와 연결하면 AI 기능을 쓸 수 있어요.";
  }
  el.llmList.innerHTML = "";
  if (!profiles.length) {
    const d = document.createElement("div");
    d.className = "llm-empty";
    d.textContent = "불러온 프로필이 없어요. 위의 [프로필 불러오기]로 LLM 서버 정보(JSON)를 추가하세요.";
    el.llmList.appendChild(d);
    return;
  }
  profiles.forEach((p) => {
    const row = document.createElement("div");
    row.className = "llm-item" + (p.id === activeId ? " active" : "");
    const meta = document.createElement("div"); meta.className = "llm-meta";
    const nm = document.createElement("div"); nm.className = "llm-name";
    nm.textContent = p.service || p.model;
    if (p.id === activeId) { const b = document.createElement("span"); b.className = "llm-badge"; b.textContent = "연결됨"; b.style.marginLeft = "8px"; nm.appendChild(b); }
    const sub = document.createElement("div"); sub.className = "llm-sub";
    sub.textContent = p.model + " · " + p.base_url + (p.api_key ? " · 🔑" : " · 키 없음");
    meta.appendChild(nm); meta.appendChild(sub);
    const acts = document.createElement("div"); acts.className = "llm-actions";
    const mk = (label, cls, fn) => { const b = document.createElement("button"); b.className = "mini-btn " + (cls || ""); b.textContent = label; b.onclick = fn; return b; };
    if (p.id !== activeId) acts.appendChild(mk("연결", "", async () => { await Api.llm.setActive(p.id); llmMsg("연결했어요: " + (p.service || p.model)); await afterLlmChange(); }));
    acts.appendChild(mk("테스트", "", async () => { llmMsg("테스트 중…"); const t = await Api.llm.testProfile(p.id); llmMsg((t.ok ? "✅ " : "⚠️ ") + t.message); }));
    acts.appendChild(mk("삭제", "danger-btn", async () => { await Api.llm.removeProfile(p.id); llmMsg("삭제했어요."); await afterLlmChange(); }));
    row.appendChild(meta); row.appendChild(acts);
    el.llmList.appendChild(row);
  });
}
function llmMsg(t) { if (el.llmMsg) el.llmMsg.textContent = t || ""; }
/* ---- 내 계정 보관함(v71 → v75 파일 보관함) — 올리기/받아 쓰기/암호화 파일. 언제나 '지금 로그인한 계정'만 ----
 *   v71 은 이 브라우저 localStorage 에만 둬서 다른 브라우저에서 [받아 쓰기]가 늘 비어 있었다.
 *   v75: serve.py 가 있으면 userdata/llm-vault/ 파일(암호문)에 — 계정 이름 + 암호 문구로 찾는다. 없으면 이 브라우저 + 암호화 파일. */
async function renderLlmVault() {
  const meta = document.getElementById("llmVaultMeta"), where = document.getElementById("llmVaultWhere");
  if (!meta || !Api.llm.vault) return;
  let v = null; try { v = await Api.llm.vault.info(); } catch (e) { v = null; }
  if (!v || !v.ok) { meta.textContent = (v && v.message) || "보관함 정보를 읽지 못했어요."; return; }
  if (where) {
    const who = "<b>'" + escapeHtml(v.username) + "'</b> 계정으로 로그인 → 같은 암호 문구 → [받아 쓰기]";
    if (!v.file) {
      where.innerHTML = "🌐 <b>보관 위치: 이 브라우저만</b> — 지금 주소에는 파일 보관함 서버가 없어요(정적 호스팅·파일로 열기). 다른 브라우저·PC 로는 <b>🔐 암호화 파일로 저장</b> → 거기서 <b>📂 암호화 파일에서 받아 쓰기</b>로 옮기세요.";
    } else if (v.file_store === "php") {
      where.innerHTML = "🌍 <b>보관 위치: 웹 호스팅 서버(api.php)</b> — 이 주소로 여는 <b>어느 PC·브라우저</b>에서든 " + who + ". 서버엔 암호문만 저장돼요.";
    } else if (v.file_shared) {
      where.innerHTML = "☁ <b>보관 위치: 공유(동기화) 폴더 '" + escapeHtml(v.file_folder) + "'</b> — 같은 폴더를 보는 다른 PC 의 serve.py 에서도 " + who + ".";
    } else {
      where.innerHTML = "🖥 <b>보관 위치: 이 PC 폴더(userdata/llm-vault)</b> — <b>이 PC</b> 의 다른 브라우저에서 " + who + (v.file_lan ? ". 같은 네트워크의 다른 PC 는 이 PC 주소로 접속하면 돼요." : ".") +
        "<br>⚠ <b>다른 컴퓨터</b>에서 받으려면 셋 중 하나: ① 두 PC 의 serve.py 가 같은 동기화 폴더(Google Drive·OneDrive)를 보게 — <code>userdata/vault-dir.txt</code> 에 그 폴더 경로 한 줄(또는 <code>--vault-dir=경로</code>) ② 이 PC 를 <code>python serve.py 18162 --lan</code> 으로 띄우고 다른 PC 에서 이 PC 주소로 접속 ③ 🔐 암호화 파일로 옮기기.";
    }
  }
  const bits = [];
  if (v.file && v.file_last) bits.push("파일 보관함에 올린 때 " + new Date(v.file_last.updated).toLocaleString() + " · 프로필 " + v.file_last.count + "개");
  if (v.exists) bits.push("이 브라우저 사본: 프로필 " + v.count + "개 · " + (v.encrypted ? "🔐 암호화" : "암호화 안 함") + " · " + new Date(v.updated).toLocaleString());
  meta.textContent = bits.length ? bits.join("  ·  ") : (v.file ? "이 브라우저에서는 아직 올리거나 받은 적 없어요 — 다른 브라우저에서 올려 뒀다면 그때의 암호 문구를 넣고 [⬇ 받아 쓰기], 처음이면 문구를 정해 [⬆ 올리기]." : "아직 올린 적 없어요 — 암호 문구를 넣고 [⬆ 올리기].");
}
function vaultDownloadJson(name, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob), aEl = document.createElement("a");
  aEl.href = url; aEl.download = name; document.body.appendChild(aEl); aEl.click(); aEl.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function vaultStamp() { const d = new Date(); return d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0"); }
function bindLlmVault() {
  const $v = (id) => document.getElementById(id);
  const pass = $v("llmVaultPass");
  const pv = () => (pass && pass.value) || "";
  const done = () => { if (pass) pass.value = ""; };
  const needPass = (t) => { llmMsg("🔐 " + t); if (pass) pass.focus(); };
  if ($v("llmVaultUp")) $v("llmVaultUp").addEventListener("click", async () => {
    const info = await Api.llm.vault.info();
    if (info && info.file && !pv()) { needPass("파일 보관함에 올리려면 암호 문구(6자 이상)가 필요해요 — 받아 쓸 때 같은 문구를 넣어요."); return; }
    if (info && (info.exists || info.file_last) && !window.confirm("이미 올려 둔 연결 정보가 있으면 지금 프로필로 바뀌어요. 계속할까요?")) return;
    const r = await Api.llm.vault.upload({ passphrase: pv() });
    if (!r || !r.ok) { llmMsg("⚠️ " + ((r && r.message) || "올리지 못했어요.")); return; }
    if (r.file) llmMsg("✅ " + (info.file_store === "php" ? "웹 호스팅 보관함" : info.file_shared ? "공유(동기화) 폴더 보관함" : "이 PC 파일 보관함") + "에 올렸어요(프로필 " + r.count + "개 · 암호화). " + (info.file_store === "php" ? "이 주소로 여는 다른 PC·브라우저" : info.file_shared ? "같은 폴더를 보는 다른 PC" : "이 PC 의 다른 브라우저") + "에서 '" + (info.username || "") + "' 계정 → 같은 암호 문구 → [받아 쓰기]." + (info.file_shared ? "" : " 다른 컴퓨터로는 위 안내(동기화 폴더·--lan·암호화 파일)를 보세요."));
    else if (r.file_error) llmMsg("⚠️ 이 브라우저에는 저장했지만 파일 보관함에 올리지 못했어요: " + r.file_error);
    else llmMsg("✅ 이 브라우저에 저장했어요(프로필 " + r.count + "개" + (r.encrypted ? " · 암호화" : "") + "). 다른 기기로는 🔐 암호화 파일로 옮기세요.");
    done(); await renderLlmVault();
  });
  if ($v("llmVaultDown")) $v("llmVaultDown").addEventListener("click", async () => {
    const r = await Api.llm.vault.download({ passphrase: pv(), apply: "merge", connect: true });
    if (r && r.error === "need_pass") { needPass("암호화해서 올린 정보예요 — 암호 문구를 넣고 다시 누르세요."); return; }
    if (r && r.error === "empty") {
      const info = await Api.llm.vault.info();
      if (info && info.file) { needPass("다른 브라우저에서 올린 걸 받으려면 올릴 때 쓴 암호 문구를 넣고 [받아 쓰기]를 누르세요."); return; }
    }
    llmMsg(r && r.ok ? "✅ " + (r.from === "file" ? "서버 보관함" : "이 브라우저 보관함") + "에서 받아 왔어요(프로필 " + r.added + "개)" + (r.active_id ? " — 올릴 때 쓰던 연결로 바로 연결했어요." : " — 쓸 프로필에서 [연결]을 누르세요.") : "⚠️ " + ((r && r.message) || "받아 오지 못했어요."));
    if (r && r.ok) done();
    await afterLlmChange();
  });
  if ($v("llmVaultExport")) $v("llmVaultExport").addEventListener("click", async () => {
    const r = await Api.llm.vault.exportFile({ passphrase: pv() });
    if (r && r.error === "need_pass") { needPass(r.message); return; }
    if (!r || !r.ok) { llmMsg("⚠️ " + ((r && r.message) || "만들지 못했어요.")); return; }
    vaultDownloadJson("llm-vault_" + vaultStamp() + ".json", r.file);
    llmMsg("🔐 암호화 파일을 저장했어요(llm-vault_" + vaultStamp() + ".json). 다른 PC·브라우저에서 [📂 암호화 파일에서 받아 쓰기] + 같은 암호 문구. 파일만으로는 키를 읽을 수 없어요.");
    done();
  });
  if ($v("llmVaultImportFile")) $v("llmVaultImportFile").addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0]; e.target.value = ""; if (!f) return;
    let obj = null; try { obj = JSON.parse(await f.text()); } catch (er) { obj = null; }
    if (obj && obj.type === "llm-lab-profiles") { const r0 = await Api.llm.importProfiles(obj); llmMsg(r0 && r0.ok ? "✅ 평문 프로필 파일에서 " + r0.added + "개를 불러왔어요." : "⚠️ " + ((r0 && r0.message) || "불러오지 못했어요.")); await afterLlmChange(); return; }
    const r = await Api.llm.vault.importFile(obj, { passphrase: pv() });
    if (r && r.error === "need_pass") { needPass("파일을 만들 때 쓴 암호 문구를 칸에 넣고 파일을 다시 고르세요."); return; }
    llmMsg(r && r.ok ? "✅ 암호화 파일에서 받아 왔어요(프로필 " + r.added + "개)" + (r.active_id ? " — 바로 연결했어요." : ".") : "⚠️ " + ((r && r.message) || "받아 오지 못했어요."));
    if (r && r.ok) done();
    await afterLlmChange();
  });
  if ($v("llmVaultFile")) $v("llmVaultFile").addEventListener("click", async () => {
    const r = await Api.llm.exportProfiles();
    if (!r || !r.ok) { llmMsg("⚠️ " + ((r && r.message) || "저장할 프로필이 없어요.")); return; }
    if (!window.confirm("API 키가 그대로(평문) 들어 있는 파일이에요. 옮기는 용도라면 🔐 암호화 파일을 권해요. 그래도 내려받을까요?")) return;
    vaultDownloadJson("llm-lab-profiles_" + vaultStamp() + ".json", r.payload);
    llmMsg("💾 평문 프로필 파일을 저장했어요 — [📂 프로필 불러오기]로 다시 넣을 수 있어요. 다 쓰면 지우세요.");
  });
  if ($v("llmVaultDel")) $v("llmVaultDel").addEventListener("click", async () => {
    const info = await Api.llm.vault.info();
    const msg = info && info.file ? "이 브라우저 사본을 지워요." + (pv() ? " 칸의 암호 문구로 올린 파일 보관함도 함께 지워요." : " (파일 보관함까지 지우려면 암호 문구를 넣고 누르세요.)") : "이 브라우저의 보관함을 비울까요?";
    if (!window.confirm(msg + " 지금 연결된 프로필은 그대로예요.")) return;
    const r = await Api.llm.vault.remove({ passphrase: pv() });
    llmMsg(r && r.file ? "보관함을 비웠어요(파일 보관함 포함)." : "이 브라우저 보관함을 비웠어요."); done(); await renderLlmVault();
  });
}
async function afterLlmChange() {
  await renderLlmSettings();
  try { await checkHealth(); } catch (e) {}
  const info = (Api.llm.activeInfo && Api.llm.activeInfo()) || null;
  if (el.advModel) el.advModel.textContent = info ? info.model : "-";
  const ap = info ? (Api.llm._profile && Api.llm._profile()) : null;
  if (el.advTemp) el.advTemp.textContent = (ap && ap.params && ap.params.temperature != null) ? String(ap.params.temperature) : "-";
}
function bindLlmEvents() {
  try { bindLlmVault(); } catch (e) { /* 계속 */ }
  if (el.llmFile) {
    el.llmFile.addEventListener("change", async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      try {
        const text = await f.text();
        const res = await Api.llm.importProfiles(text);
        if (!res.ok) { llmMsg("⚠️ " + (res.message || "불러오기 실패")); }
        else { llmMsg("✅ 프로필 " + res.added + "개를 불러왔어요. 쓸 프로필에서 [연결]을 누르세요."); }
        await afterLlmChange();
      } catch (err) { llmMsg("⚠️ 파일을 읽지 못했어요: " + (err.message || err)); }
      e.target.value = "";
    });
  }
  if (el.llmDisconnect) {
    el.llmDisconnect.addEventListener("click", async () => {
      await Api.llm.setActive(null); llmMsg("연결을 끊었어요."); await afterLlmChange();
    });
  }
}
async function persistSettings() {
  const d = currentDisplay();
  SETTINGS.theme = d.theme; SETTINGS.mode = d.mode; SETTINGS.fontscale = d.fontscale;
  SETTINGS.layout = d.layout; SETTINGS.width = d.width; SETTINGS.font = d.font; SETTINGS.barwidth = d.barwidth;
  try { await adSaveSettings(SETTINGS); } catch (e) { /* 저장 실패해도 계속 */ }
}

// ---- LLM 상태 ----
// 상태칩의 "접속 모드 · 모델명" 칸을 현재 LLM 프로필로 갱신한다.
//   접속 모드: config 의 API_MODE(local=브라우저가 직접 호출 / remote=백엔드 경유)
//   모델명: 활성 프로필의 model. 없으면 "모델 없음".
function paintLlmInfo() {
  let info = null;
  try { info = Api.llm.activeInfo && Api.llm.activeInfo(); } catch (e) { info = null; }
  if (el.statusMode) el.statusMode.textContent = apiModeLabel();
  if (el.statusModel) {
    el.statusModel.textContent = (info && info.model) || "모델 없음";
    el.statusModel.title = info
      ? (info.model + (info.service ? "  ·  " + info.service : "") + (info.base_url ? "\n" + info.base_url : ""))
      : "설정 → AI 연결에서 LLM 프로필을 불러와 연결하세요";
  }
}
// 접속 모드 — api.js 가 config.API_MODE 를 읽어 Api.MODE 로 고정해 둔다.
//   local  = 브라우저가 LLM 을 직접 호출(현재)
//   server = 백엔드 프록시 경유(RemoteApi)
function apiModeLabel() {
  return (Api && Api.MODE === "remote") ? "server" : "local";
}

async function checkHealth() {
  paintLlmInfo();
  try {
    // 프로필 미연결이면 "미연결"로 명확히 표시(기본 상태)
    if (Api.llm.isConnected && !Api.llm.isConnected()) {
      el.statusDot.className = "dot bad";
      el.statusText.textContent = "AI 미연결";
      return;
    }
    el.statusDot.className = "dot warn";
    el.statusText.textContent = "확인 중…";
    const ok = await adHealth();
    el.statusDot.className = ok ? "dot ok" : "dot bad";
    el.statusText.textContent = ok ? "AI 연결됨" : "AI 응답 없음";
  } catch (e) {
    el.statusDot.className = "dot bad";
    el.statusText.textContent = "연결 실패";
  }
}

/* 상단 시계 — 초 단위. 다음 "정각 초"에 맞춰 예약하므로 시간이 밀리지 않는다.
   탭이 백그라운드로 가면 브라우저가 타이머를 늦추므로, 복귀 시 즉시 다시 그린다. */
let _clockTimer = null;
function paintClock() {
  if (!el.clockPill) return;
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const t = p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  el.clockPill.textContent = t;
  el.clockPill.setAttribute("datetime", d.toISOString());
  el.clockPill.title = d.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long" });
}
function startClock() {
  if (!el.clockPill) return;
  const tick = () => {
    paintClock();
    if (_clockTimer) clearTimeout(_clockTimer);
    _clockTimer = setTimeout(tick, 1000 - (Date.now() % 1000));
  };
  tick();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
}


const ak = {
  fab: $("askFab"), panel: $("askPanel"), close: $("askClose"), clear: $("askClear"),
  where: $("askWhere"), log: $("askLog"), quick: $("askQuick"),
  input: $("askInput"), send: $("askSend"),
};
const ASK_HISTORY_MAX = 12;
// rec = 기록 화면에서 연 대화({att, q, evt, annex}) — 있으면 화면 맥락 대신 그 기록을 맥락으로 쓴다.
const askState = { open: false, busy: false, messages: [], lastNav: null };

/* ---- 화면 이름 + 맥락 ------------------------------------------------ */
function askNavLabel() {
  const nav = state.nav || "home";
  // 라이브러리에서는 "학습 자료" 보다 펼쳐 둔 문서 제목이 훨씬 쓸모 있다.
  if (nav === "library" && libState.docId) {
    const d = libDoc();
    if (d) return d.title;
  }
  return (typeof navTitle === "function" ? navTitle(nav) : nav) || nav;
}
function askContext() {
  const nav = state.nav || "";
  let t = "[현재 화면] " + askNavLabel() + "\n";
  if (nav === "rx_dash" && window.DASHBOARD) {
    t += DASHBOARD.context();
  } else if (nav === "library") {
    const d = libDoc();
    if (d) {
      t += "[펼쳐 둔 학습 자료]\n제목: " + d.title + "\n";
      t += "분류: " + libTaxLabel(libState.catalog, d) + "\n";
      if (d.summary) t += "요약: " + d.summary + "\n";
      const pct = libScrollPct();
      if (pct != null) t += "읽은 위치: 약 " + pct + "%\n";
      // 문서가 길면 맥락이 묽어지므로 지금 화면에 보이는 부분만 잘라 넘긴다.
      const seen = libVisibleText(2600);
      if (seen) t += "\n[지금 화면에 보이는 부분]\n" + seen + "\n";
      t += "\n※ 위 본문에 근거해 답하세요. 본문에 없는 내용은 추측하지 말고 그렇다고 밝히세요.\n";
    } else {
      t += "[학습 자료 목록] 아직 문서를 펼치지 않았습니다. 검색어·분류로 자료를 고르는 중입니다.\n";
    }
  }
  return t;
}

/* ---- 화면별 추천 질문 ------------------------------------------------ */
const ASK_QUICK = {
  settings:     ["이 설정들 뭐가 뭔지 알려줘"],
  library:      ["이 부분 쉽게 풀어서 설명해줘", "핵심만 세 줄로 요약해줘", "이거 왜 중요해?", "이 내용으로 확인 질문 내줘"],
  rx_dash:      ["오늘 뭐부터 하면 좋을까?", "멈춘 프로젝트 정리해줘"],
};
function askQuickFor(nav) {
  return ASK_QUICK[nav] || ["이 화면에서 뭘 할 수 있어?", "지금 뭐부터 하면 좋을까?"];
}

/* ---- 패널 열고 닫기 --------------------------------------------------- */
function askSetOpen(on) {
  askState.open = !!on;
  if (ak.panel) ak.panel.classList.toggle("open", askState.open);
  if (ak.fab) ak.fab.setAttribute("aria-expanded", askState.open ? "true" : "false");
  document.body.classList.toggle("ask-open", askState.open);
  // 본문 폭이 바뀌므로 탑메뉴 스크롤 상태를 다시 잡는다.
  updateNavScroll();
  updateTopRightScroll();
  repositionOpenNavPanel();
  setTimeout(() => { updateNavScroll(); repositionOpenNavPanel(); }, 260);
  if (askState.open) {
    askRefreshHeader();
    if (ak.input) ak.input.focus();
  }
}
function askToggle() { askSetOpen(!askState.open); }

// 화면이 바뀌면 "어느 화면인지" 표시와 추천 질문을 갱신한다.
function askRefreshHeader() {
  const nav = state.nav || "";
  if (ak.where) ak.where.textContent = askNavLabel();
  if (ak.quick) {
    ak.quick.innerHTML = "";
    askQuickFor(nav).forEach((q) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "ask-qbtn"; b.textContent = q;
      b.addEventListener("click", () => askSend(q));
      ak.quick.appendChild(b);
    });
  }
  // 화면이 바뀌었으면 안내 한 줄(대화는 유지 — 이어서 물어볼 수 있게)
  //   라이브러리는 nav 가 "library" 로 고정된 채 문서만 갈아탄다 → 문서 id 까지 합친 키로 비교
  const key = nav === "library" ? "library:" + (libState.docId || "") : nav;
  if (askState.lastNav && askState.lastNav !== key && askState.messages.length) {
    askBubble("sys", "화면이 ‘" + askNavLabel() + "’ 으로 바뀌었어요. 이 화면에 대해 물어보세요.");
  }
  askState.lastNav = key;
  if (!askState.messages.length && ak.log && !ak.log.querySelector(".ask-empty")) {
    const d = document.createElement("div");
    d.className = "ask-empty";
    d.textContent = "지금 보고 있는 화면에 대해 물어보세요. 아래 추천 질문을 눌러도 돼요.";
    ak.log.appendChild(d);
  }
}

/* ---- 말풍선 ----------------------------------------------------------- */
function askBubble(role, text, raw) {
  const empty = ak.log && ak.log.querySelector(".ask-empty");
  if (empty) empty.remove();
  const wrap = document.createElement("div");
  wrap.className = "ask-msg " + (role === "user" ? "me" : role === "sys" ? "sys" : "bot");
  if (role === "sys") {
    wrap.textContent = text;
  } else {
    const b = document.createElement("div");
    b.className = "bubble " + (role === "user" ? "user" : "bot");
    if (raw) b.textContent = text; else b.innerHTML = chatMarkup(text);
    wrap.appendChild(b);
  }
  ak.log.appendChild(wrap);
  ak.log.scrollTop = ak.log.scrollHeight;
  return wrap.querySelector(".bubble") || wrap;
}
function askSetBusy(on) {
  askState.busy = on;
  if (ak.send) ak.send.disabled = on;
  if (ak.input) ak.input.disabled = on;
  if (ak.quick) ak.quick.querySelectorAll(".ask-qbtn").forEach((b) => { b.disabled = on; });
}

/* ---- 한 번 주고받기 --------------------------------------------------- */
const ASK_SYSTEM =
  "당신은 연구·학습 도구 화면 옆에 떠 있는 도우미입니다. 사용자가 '지금 보고 있는 화면'에 대해 묻습니다.\n" +
  "- 쉬운 한국어로, 짧고 친절하게 답합니다(보통 3~6줄).\n" +
  "- 아래 [화면 맥락]에 있는 내용을 최우선으로 근거 삼아 답합니다.\n" +
  "- 맥락에 없는 것을 아는 척하지 말고, 모르면 모른다고 말한 뒤 할 수 있는 안내를 합니다.\n" +
  "- 표·코드블록은 쓰지 말고 줄바꿈으로 읽기 쉽게 씁니다.\n" +
  "- 한국어와 영어 외의 문자는 쓰지 마세요.\n/no_think";

async function askSend(text) {
  text = (text || "").trim();
  if (!text || askState.busy) return;
  if (ak.input) ak.input.value = "";
  const g = await gateAction({ action: "ask" });
  if (!g.ok) { askBubble("bot", gateMessage(g)); return; }

  askBubble("user", text);
  askState.messages.push({ role: "user", content: text });
  const bot = askBubble("bot", "…", true);
  bot.classList.add("typing");
  askSetBusy(true);

  const ctxText = askContext();
  // 연구지원·자료 학습: 앱 자료를 코드로 먼저 찾아 읽고, 쓰기 제안은 카드로(ai-task/1)
  const agentOn = !!window.AIAGENT;
  const agentCtx = agentOn ? await AIAGENT.context(text) : "";
  const messages = [{ role: "system", content: ASK_SYSTEM + "\n\n[화면 맥락]\n" + ctxText + agentCtx }];
  askState.messages.slice(-ASK_HISTORY_MAX).forEach((m) => {
    if (m.content) messages.push({ role: m.role, content: m.content });
  });

  let acc = "";
  try {
    acc = await llmStreamChat(messages, (delta, full) => {
      bot.textContent = full || "…";
      ak.log.scrollTop = ak.log.scrollHeight;
    }, { temperature: 0.6, maxTokens: 900 });
  } catch (e) { acc = ""; }
  if (!acc) {
    try { acc = await Api.llm.complete(messages, { temperature: 0.6, maxTokens: 900 }); }
    catch (e) { acc = ""; }
  }
  let agentActions = [];
  if (agentOn && acc) {     // 읽기 도구는 왕복 몇 번까지, 쓰기 제안은 카드로만
    let retried = false;
    for (let round = 0; round < AIAGENT.MAX_ROUNDS; round++) {
      const pa = AIAGENT.parse(acc); agentActions = agentActions.concat(pa.actions);
      if (pa.offProtocol && !pa.rest && !pa.tools.length && !pa.actions.length && !retried) {   // 호출문만 냈으면 한 번 다시 시킨다
        retried = true;
        messages.push({ role: "assistant", content: acc }, { role: "user", content: "호출문을 쓰지 말고, 위 자료로 바로 답하세요." });
        try { acc = await Api.llm.complete(messages, { temperature: 0.4, maxTokens: 900 }); continue; } catch (e) { acc = ""; break; }
      }
      if (!pa.tools.length) { acc = pa.rest; break; }
      bot.textContent = "자료를 읽는 중…";
      const results = []; for (const t of pa.tools) results.push(await AIAGENT.read(t));
      messages.push({ role: "assistant", content: acc }, { role: "user", content: results.join("\n\n") });
      try { acc = await Api.llm.complete(messages, { temperature: 0.4, maxTokens: 900 }); } catch (e) { acc = pa.rest; break; }
    }
    acc = AIAGENT.parse(acc).rest || (agentActions.length ? "아래 제안을 확인해 주세요." : "");
  }
  bot.classList.remove("typing");
  if (!acc) {
    bot.textContent = "답을 받지 못했어요. 잠시 후 다시 물어봐 주세요.";
    askState.messages.pop();
  } else {
    bot.innerHTML = chatMarkup(acc);
    if (agentActions.length) { AIAGENT.cards(ak.log, agentActions); ak.log.scrollTop = ak.log.scrollHeight; }
    askState.messages.push({ role: "assistant", content: acc });
  }
  askSetBusy(false);
  if (ak.input) ak.input.focus();
}

function askClear() {
  askState.messages = [];
  if (ak.log) ak.log.innerHTML = "";
  askRefreshHeader();
}

/* ---- 바인딩 ----------------------------------------------------------- */
function bindAskEvents() {
  if (ak.fab) ak.fab.addEventListener("click", askToggle);
  if (ak.close) ak.close.addEventListener("click", () => askSetOpen(false));
  if (ak.clear) ak.clear.addEventListener("click", askClear);
  if (ak.send) ak.send.addEventListener("click", () => askSend(ak.input && ak.input.value));
  if (ak.input) ak.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); askSend(ak.input.value); }
  });
  document.addEventListener("keydown", (e) => {
    // Esc 로 닫기 / Alt+A 로 열고 닫기
    if (e.key === "Escape" && askState.open) { askSetOpen(false); return; }
    if (e.altKey && (e.key === "a" || e.key === "A")) { e.preventDefault(); askToggle(); }
  });
  askRefreshHeader();
}
/* =========================================================================
 * 학습 자료 라이브러리 (library)
 *   library/catalog.json 에 등록된 단일 파일 HTML 학습 문서를 찾아보고 읽는다.
 *   문서는 저마다 자기 CSS·JS 를 품은 완결된 페이지라서, 앱 스타일과 섞이지
 *   않도록 iframe 으로 띄운다(같은 출처라 본문 접근은 자유롭다 — 화면 도우미가
 *   "지금 보고 있는 대목"을 읽어 가는 데 이걸 쓴다).
 * ========================================================================= */
const lb = {
  area: $("libraryArea"),
  browse: $("libBrowse"),
  viewer: $("libViewer"),
  q: $("libSearch"),
  subjWrap: $("libSubjects"),
  facets: $("libFacets"),
  count: $("libCount"),
  list: $("libList"),
  empty: $("libEmpty"),
  back: $("libBack"),
  title: $("libDocTitle"),
  crumb: $("libDocCrumb"),
  open: $("libOpenNew"),
  frame: $("libFrame"),
  reset: $("libReset"),
  viewSeg: $("libViewSeg"),
  head: $("libListHead"),
  treeBar: $("libTreeBar"),
};

const libState = {
  catalog: null,       // { taxonomy, subjects, docs }
  q: "",
  subject: "",
  domain: "",          // 분류 1단계
  level: "",
  docId: "",           // 뷰어에서 열려 있는 문서
};
const LIB_VIEWS = ["table", "list", "tree", "card"];   // (v98) table = 게시판형 목록(기본), list = 카드 목록
function libView() {
  return LIB_VIEWS.indexOf(SETTINGS.lib_view) >= 0 ? SETTINGS.lib_view : "table";
}
// 트리에서 펼쳐 둔 가지(경로 문자열). 화면을 옮겨도 유지된다.
const libOpenBranches = {};
// 지금 그려진 가지 전체 — "모두 펼치기" 가 무엇을 펼칠지 알아야 한다.
let libAllBranches = [];
// 표 머리글 정렬. key 가 비면 카탈로그 원래 순서(분류별로 묶여 있다).
const libSort = { key: "", desc: false };
function libSortKey(d, key, cat) {
  if (key === "title") return d.title || "";
  if (key === "crumb") return libTaxLabel(cat, d);
  if (key === "level") return String(LIB_LEVEL_ORDER.indexOf(d.level)).padStart(2, "0");
  if (key === "minutes") return d.minutes || 0;
  return 0;
}
const LIB_LEVEL_ORDER = ["beginner", "intermediate", "advanced", "reference"];

const LIB_LEVEL = { beginner: "입문", intermediate: "중급",
                    advanced: "심화", reference: "참고" };

async function libCatalog() {
  if (libState.catalog) return libState.catalog;
  libState.catalog = await Api.library.catalog();
  return libState.catalog;
}

function libTaxLabel(cat, d) {
  // "데이터·AI › 시맨틱 › 지식그래프" — 분류 라벨이 비면 id 를 그대로 보여 준다.
  const tx = cat.taxonomy || {};
  const dm = tx[d.domain] || {};
  const tr = ((dm.tracks || {})[d.track]) || {};
  const parts = [dm.label || d.domain];
  if (d.track) parts.push(tr.label || d.track);
  if (d.topic) parts.push((tr.topics || {})[d.topic] || d.topic);
  return parts.join(" › ");
}

function libMatch(d) {
  if (libState.subject && (d.subjects || []).indexOf(libState.subject) < 0) return false;
  if (libState.domain && d.domain !== libState.domain) return false;
  if (libState.level && d.level !== libState.level) return false;
  const q = libState.q.trim().toLowerCase();
  if (!q) return true;
  const hay = [d.title, d.summary, d.id, (d.tags || []).join(" ")].join(" ").toLowerCase();
  // 띄어쓰기로 나눈 모든 조각이 들어 있어야 한다(단어 순서는 상관없이).
  return q.split(/\s+/).every((w) => hay.indexOf(w) >= 0);
}

function libChip(label, on, onClick, title) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "lib-chip" + (on ? " on" : "");
  b.textContent = label;
  if (title) b.title = title;
  b.addEventListener("click", onClick);
  return b;
}

function libRenderFacets(cat) {
  if (lb.subjWrap) {
    lb.subjWrap.innerHTML = "";
    lb.subjWrap.appendChild(libChip("전체 주제", !libState.subject, () => {
      libState.subject = ""; libRender();
    }));
    (cat.subjects || []).forEach((s) => {
      lb.subjWrap.appendChild(libChip(
        s.display_name + " " + s.docs, libState.subject === s.id,
        () => { libState.subject = (libState.subject === s.id ? "" : s.id); libRender(); },
        s.summary || ""));
    });
  }
  if (!lb.facets) return;
  lb.facets.innerHTML = "";
  const tx = cat.taxonomy || {};
  const dcount = {};
  (cat.docs || []).forEach((d) => { dcount[d.domain] = (dcount[d.domain] || 0) + 1; });
  lb.facets.appendChild(libChip("전체 분류", !libState.domain, () => {
    libState.domain = ""; libRender();
  }));
  Object.keys(tx).sort().forEach((k) => {
    if (!dcount[k]) return;
    lb.facets.appendChild(libChip(
      (tx[k].label || k) + " " + dcount[k], libState.domain === k,
      () => { libState.domain = (libState.domain === k ? "" : k); libRender(); }));
  });
  const sep = document.createElement("span");
  sep.className = "lib-facet-sep";
  lb.facets.appendChild(sep);
  Object.keys(LIB_LEVEL).forEach((k) => {
    lb.facets.appendChild(libChip(LIB_LEVEL[k], libState.level === k, () => {
      libState.level = (libState.level === k ? "" : k); libRender();
    }));
  });
}

function libCard(cat, d) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "lib-card";
  b.dataset.doc = d.id;
  // 목록 보기에서는 요약이 숨는다 → 행 전체 툴팁으로 남겨 둔다.
  b.title = d.summary || d.title;

  const h = document.createElement("b");
  h.className = "lib-card-t";
  h.textContent = d.title;
  b.appendChild(h);

  const c = document.createElement("span");
  c.className = "lib-card-c";
  c.textContent = libTaxLabel(cat, d);
  b.appendChild(c);

  if (d.summary) {
    const s = document.createElement("span");
    s.className = "lib-card-s";
    s.textContent = d.summary;
    b.appendChild(s);
  }

  const meta = document.createElement("span");
  meta.className = "lib-card-m";
  const lv = document.createElement("i");
  lv.className = "lib-lv lv-" + d.level;
  lv.textContent = LIB_LEVEL[d.level] || d.level;
  meta.appendChild(lv);
  const m = document.createElement("i");
  m.className = "lib-min";
  m.textContent = d.minutes ? "약 " + d.minutes + "분" : "";
  meta.appendChild(m);
  // 태그는 한 칸으로 묶는다 — 표에서 하나의 열이 되어야 한다.
  const tags = document.createElement("span");
  tags.className = "lib-tags";
  (d.tags || []).slice(0, 3).forEach((t) => {
    const g = document.createElement("i");
    g.className = "lib-tag";
    g.textContent = t;
    tags.appendChild(g);
  });
  meta.appendChild(tags);
  b.appendChild(meta);

  b.addEventListener("click", () => libOpen(d.id));
  return b;
}

/* 분류 체계대로 가지를 친다. 영역 › 갈래 › 주제, 그 아래 문서.
   빈 가지는 만들지 않는다(필터를 걸면 대부분의 가지가 비므로). */
function libRenderTree(cat, hits) {
  const tx = cat.taxonomy || {};
  libAllBranches = [];
  const tree = {};
  hits.forEach((d) => {
    const dm = d.domain || "misc", tr = d.track || "", tp = d.topic || "";
    const a = (tree[dm] = tree[dm] || { n: 0, kids: {} });
    a.n++;
    const b = (a.kids[tr] = a.kids[tr] || { n: 0, kids: {} });
    b.n++;
    const c = (b.kids[tp] = b.kids[tp] || { n: 0, docs: [] });
    c.n++;
    c.docs.push(d);
  });

  const branch = (label, count, depth, path) => {
    libAllBranches.push(path);
    const node = document.createElement("div");
    node.className = "lib-node d" + depth;
    if (libOpenBranches[path]) node.classList.add("open");
    const head = document.createElement("button");
    head.type = "button";
    head.className = "lib-branch";
    const car = document.createElement("span");
    car.className = "lib-caret";
    car.textContent = "▶";
    head.appendChild(car);
    const t = document.createElement("span");
    t.textContent = label;
    head.appendChild(t);
    const n = document.createElement("span");
    n.className = "lib-branch-n";
    n.textContent = count + "편";
    head.appendChild(n);
    head.addEventListener("click", () => {
      const on = !node.classList.contains("open");
      node.classList.toggle("open", on);
      if (on) libOpenBranches[path] = 1; else delete libOpenBranches[path];
    });
    node.appendChild(head);
    const kids = document.createElement("div");
    kids.className = "lib-kids";
    node.appendChild(kids);
    return { node: node, kids: kids };
  };

  const label = (o, k) => (o && o.label) || k || "(미분류)";
  Object.keys(tree).sort().forEach((dm) => {
    const A = branch(label(tx[dm], dm), tree[dm].n, 0, dm);
    Object.keys(tree[dm].kids).sort().forEach((tr) => {
      const trs = ((tx[dm] || {}).tracks || {})[tr];
      const B = branch(label(trs, tr), tree[dm].kids[tr].n, 1, dm + "/" + tr);
      Object.keys(tree[dm].kids[tr].kids).sort().forEach((tp) => {
        const leaf = tree[dm].kids[tr].kids[tp];
        const tpLabel = ((trs || {}).topics || {})[tp] || tp || "(주제 없음)";
        const C = branch(tpLabel, leaf.n, 2, dm + "/" + tr + "/" + tp);
        leaf.docs.forEach((d) => C.kids.appendChild(libCard(cat, d)));
        B.kids.appendChild(C.node);
      });
      A.kids.appendChild(B.node);
    });
    lb.list.appendChild(A.node);
  });
}

async function libRender() {
  const cat = await libCatalog();
  libRenderFacets(cat);
  const hits = (cat.docs || []).filter(libMatch);
  if (libSort.key) {
    const dir = libSort.desc ? -1 : 1;
    hits.sort((a, b) => {
      const x = libSortKey(a, libSort.key, cat), y = libSortKey(b, libSort.key, cat);
      if (x === y) return (a.title || "").localeCompare(b.title || "", "ko");
      return (typeof x === "number" ? x - y : String(x).localeCompare(String(y), "ko")) * dir;
    });
  }
  if (lb.count) {
    lb.count.textContent = hits.length === (cat.docs || []).length
      ? "전체 " + hits.length + "편"
      : hits.length + "편 / 전체 " + (cat.docs || []).length + "편";
  }
  if (lb.reset) {
    lb.reset.classList.toggle("hidden",
      !(libState.q || libState.subject || libState.domain || libState.level));
  }
  if (!lb.list) return;
  const view = libView();
  lb.list.classList.toggle("as-list", view === "list");
  lb.list.classList.toggle("as-tree", view === "tree");
  lb.list.classList.toggle("as-card", view === "card");
  if (lb.treeBar) lb.treeBar.classList.toggle("hidden", view !== "tree");
  if (lb.viewSeg) segActivate(lb.viewSeg, "libview", view);
  if (lb.head) {
    lb.head.classList.toggle("hidden", view !== "list");
    lb.head.querySelectorAll("[data-sort]").forEach((th) => {
      const on = th.dataset.sort === libSort.key;
      th.classList.toggle("on", on);
      th.classList.toggle("desc", on && libSort.desc);
    });
  }
  lb.list.innerHTML = "";
  if (view === "tree") libRenderTree(cat, hits);
  else hits.forEach((d) => lb.list.appendChild(libCard(cat, d)));
  if (lb.empty) lb.empty.classList.toggle("hidden", hits.length > 0);
}

/* 뷰어 ------------------------------------------------------------------ */
function libDoc(id) {
  const cat = libState.catalog;
  if (!cat) return null;
  return (cat.docs || []).find((d) => d.id === (id || libState.docId)) || null;
}

async function libOpen(id) {
  const cat = await libCatalog();
  const d = (cat.docs || []).find((x) => x.id === id);
  if (!d) { showResumeNote("그 문서를 찾지 못했어요"); return; }
  libState.docId = id;
  if (lb.title) lb.title.textContent = d.title;
  if (lb.crumb) lb.crumb.textContent = libTaxLabel(cat, d);
  if (lb.open) lb.open.href = d.path;
  if (lb.frame) {
    lb.frame.src = d.path;
    lb.frame.onload = () => { libSyncFrameTheme(); askRefreshHeader(); };
  }
  if (lb.browse) hide(lb.browse);
  if (lb.viewer) show(lb.viewer);
  document.body.classList.add("lib-reading");
  libFitHeight();                                  // 보인 뒤에 실측
  setTimeout(libFitHeight, 60);                    // 레이아웃이 자리잡은 뒤 한 번 더
  SESS.library = { docId: id };
  sessTouch();
  askRefreshHeader();
}

function libClose() {
  libState.docId = "";
  if (lb.frame) lb.frame.src = "about:blank";
  if (lb.viewer) hide(lb.viewer);
  if (lb.browse) show(lb.browse);
  document.body.classList.remove("lib-reading");
  SESS.library = null;
  sessTouch();
  askRefreshHeader();
}

/* 문서는 자기 테마를 따로 갖고 있다. 앱이 다크인데 문서만 흰 종이면 눈이 아프니
   앱의 밝기를 그대로 밀어 넣는다(문서 쪽 규약: html[data-theme=light|dark|auto]). */
function libSyncFrameTheme() {
  if (!lb.frame) return;
  try {
    const doc = lb.frame.contentDocument;
    if (!doc || !doc.documentElement) return;
    const mode = document.documentElement.getAttribute("data-mode") === "light"
      ? "light" : "dark";
    doc.documentElement.setAttribute("data-theme", mode);
  } catch (e) { /* 다른 출처로 이동한 경우 — 그냥 문서 기본 테마로 둔다 */ }
}

/* 지금 화면에 보이는 대목만 뽑는다. 문서가 13만 자를 넘는 경우가 흔해서
   통째로 넘기면 맥락이 묽어지고 토큰만 먹는다. */
function libVisibleText(limit) {
  limit = limit || 2600;
  if (!lb.frame) return "";
  let doc, win;
  try {
    doc = lb.frame.contentDocument;
    win = lb.frame.contentWindow;
    if (!doc || !doc.body) return "";
  } catch (e) { return ""; }
  const H = win.innerHeight || 800;
  const blocks = doc.body.querySelectorAll(
    "section, article, .sec, .card, .note, .term, .quiz, h1, h2, h3, p, li, td, pre");
  const out = [];
  let n = 0;
  for (let i = 0; i < blocks.length && n < limit; i++) {
    const b = blocks[i];
    let r;
    try { r = b.getBoundingClientRect(); } catch (e) { continue; }
    if (r.bottom < 0 || r.top > H) continue;          // 화면 밖
    if (r.height > H * 3) continue;                   // 너무 큰 컨테이너는 건너뛴다
    const t = (b.innerText || "").trim().replace(/\s+\n/g, "\n");
    if (t.length < 2) continue;
    if (out.some((x) => x.indexOf(t) >= 0)) continue; // 부모에 이미 담긴 내용
    out.push(t);
    n += t.length;
  }
  let s = out.join("\n").replace(/\n{3,}/g, "\n\n");
  if (!s) {                                           // 아직 못 그렸을 때의 보루
    try { s = (doc.body.innerText || "").trim(); } catch (e) { s = ""; }
  }
  return s.slice(0, limit);
}

/* 뷰어를 화면 바닥까지 채운다.
   상단바 높이·글자 배율·폭 모드·본문 여백이 전부 변수라 px 로 못 박을 수 없다.
   (물어보기 버튼은 fixed 라 자리를 차지하지 않는다 — 여백을 비울 이유가 없다.) */
function libFitHeight() {
  const f = lb.frame;
  if (!f || !lb.viewer || lb.viewer.classList.contains("hidden")) return;
  const GAP = 16;                                  // 아래 숨 쉴 여백
  const top = f.getBoundingClientRect().top;
  let h = Math.max(360, Math.round(window.innerHeight - shellInsetBottom() - top - GAP));
  f.style.height = h + "px";
  // 프레임 아래에도 본문 래퍼의 패딩이 있다. 그만큼 페이지가 넘치면 스크롤바가
  // 생기고 문서가 화면 밖으로 밀린다. 값을 짐작하지 말고 넘친 만큼 줄인다.
  const over = document.documentElement.scrollHeight - window.innerHeight;
  if (over > 0) f.style.height = Math.max(360, h - over) + "px";
}

function libScrollPct() {
  try {
    const w = lb.frame.contentWindow, d = lb.frame.contentDocument;
    const max = d.documentElement.scrollHeight - w.innerHeight;
    if (max <= 0) return 100;
    return Math.max(0, Math.min(100, Math.round(w.scrollY / max * 100)));
  } catch (e) { return null; }
}

function restoreLibrary() {
  const s = SESS.library;
  if (!s || !s.docId) return false;
  libOpen(s.docId);
  return true;
}

async function openLibrary() {
  if (lb.viewer) hide(lb.viewer);
  if (lb.browse) show(lb.browse);
  document.body.classList.remove("lib-reading");
  try {
    await libRender();
  } catch (e) {
    if (lb.count) lb.count.textContent = "자료 목록을 불러오지 못했어요";
    console.warn("library:", e);
  }
}

function bindLibraryEvents() {
  if (lb.q) {
    let t = 0;
    lb.q.addEventListener("input", () => {
      libState.q = lb.q.value;
      clearTimeout(t);
      t = setTimeout(libRender, 120);
    });
  }
  if (lb.reset) lb.reset.addEventListener("click", () => {
    libState.q = ""; libState.subject = ""; libState.domain = ""; libState.level = "";
    if (lb.q) lb.q.value = "";
    libRender();
  });
  if (lb.back) lb.back.addEventListener("click", libClose);
  if (lb.treeBar) lb.treeBar.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tree]");
    if (!b) return;
    // 펼침 상태는 경로 집합이 정본이다. DOM 만 건드리면 다시 그릴 때 되돌아간다.
    const open = b.dataset.tree === "expand";
    const paths = libAllBranches.slice();
    Object.keys(libOpenBranches).forEach((k) => delete libOpenBranches[k]);
    if (open) paths.forEach((p) => { libOpenBranches[p] = 1; });
    libRender();
  });
  if (lb.head) lb.head.addEventListener("click", (e) => {
    const th = e.target.closest("[data-sort]");
    if (!th) return;
    const k = th.dataset.sort;
    // 같은 열을 다시 누르면 역순 → 한 번 더 누르면 원래 순서로.
    if (libSort.key !== k) { libSort.key = k; libSort.desc = false; }
    else if (!libSort.desc) { libSort.desc = true; }
    else { libSort.key = ""; libSort.desc = false; }
    libRender();
  });
  if (lb.viewSeg) lb.viewSeg.addEventListener("click", (e) => {
    const b = e.target.closest("[data-libview]");
    if (!b) return;
    SETTINGS.lib_view = LIB_VIEWS.indexOf(b.dataset.libview) >= 0
      ? b.dataset.libview : "table";
    persistSettings();
    libRender();
  });
}

/* ---- 말풍선 --------------------------------------------------------- */
// 모델이 습관적으로 쓰는 최소 마크다운(**굵게** · ### 제목 · - 목록)만 안전하게 렌더.
//  ▸ 먼저 HTML 을 전부 이스케이프하므로 응답에 태그가 섞여도 주입되지 않는다.
//  ▸ 표/코드블록은 프롬프트에서 금지 — 남아도 그냥 글자로 보인다.
function chatMarkup(text) {
  let t = String(text == null ? "" : text).trim();
  t = t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const TBL = [];                                                 // (v124) 마크다운 표 — 글을 다듬기 전에 떼어 두었다가 끝에 되돌린다
  t = t.replace(/(?:^|\n)((?:\s*\|.*\|[ \t]*\n){1,}\s*\|?[\s:|-]*-[\s:|-]*\|?[ \t]*\n(?:\s*\|.*\|[ \t]*(?:\n|$))*)/g, (m, b) => {
    const rows = b.trim().split("\n").map((r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
    const sep = rows.findIndex((r) => r.every((c) => /^:?-{1,}:?$/.test(c)));
    if (sep < 1) return m;
    TBL.push('<div class="ait-tw"><table><thead>' + rows.slice(0, sep).map((r) => "<tr>" + r.map((c) => "<th>" + c + "</th>").join("") + "</tr>").join("") + "</thead><tbody>" + rows.slice(sep + 1).map((r) => "<tr>" + r.map((c) => "<td>" + c + "</td>").join("") + "</tr>").join("") + "</tbody></table></div>");
    return "\n\u0001T" + (TBL.length - 1) + "\u0001\n";
  });
  t = t.replace(/`{1,3}/g, "");                                   // 코드펜스 흔적 제거
  t = t.replace(/^\s*#{1,6}\s*(.+)$/gm, "<b>$1</b>");             // 제목 → 굵게
  t = t.replace(/(^|\n)\s*(?:-{3,}|\*{3,}|_{3,})\s*(?=\n|$)/g, "$1"); // --- 구분선 제거
  t = t.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");               // **굵게**
  t = t.replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)\*(?!\*)/g, "$1<i>$2</i>"); // *기울임* (뒤에 한글 조사가 붙어도)
  t = t.replace(/(^|\n)\s*[-*]\s+/g, "$1• ");                     // - 목록 → 가운뎃점
  t = t.replace(/\n{3,}/g, "\n\n");                               // 과한 빈 줄 정리
  return t.replace(/\n/g, "<br>").replace(/(?:<br>)*\u0001T(\d+)\u0001(?:<br>)*/g, (m, n) => TBL[+n]);
}
function recFmtTs(ts) {
  const d = new Date(ts || 0);
  if (isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}

async function gateAction(opts) {
  try {
    // AI 서버 미연결이면 먼저 막는다(기본 상태 = 미연결).
    if (Api.llm && Api.llm.isConnected && !Api.llm.isConnected()) {
      return { ok: false, kind: "no_llm",
        message: "AI 서버가 연결되어 있지 않아요. [설정 → AI 연결]에서 LLM 프로필을 불러와 연결해 주세요." };
    }
    return { ok: true };
  } catch (e) {
    return { ok: true, softFail: true };
  }
}
function gateMessage(g) {
  return (g && g.message) || "지금은 실행할 수 없어요.";
}

/* =========================================================================
 * 시스템 설정 화면 (admin 전용 · 화이트라벨 브랜딩 + 메뉴 구성)
 *
 *   편집은 화면 로컬 초안(SYS_DRAFT)에서 하고, "저장"을 눌러야 Api.saveSystemConfig
 *   로 전역에 반영된다(관리자 아니면 어댑터가 거부). 저장 즉시 applySystemConfig()
 *   로 브랜딩·메뉴가 다시 그려진다(새로고침 불필요).
 * ========================================================================= */
const sy = { area: $("sysArea") };
let SYS_DRAFT = null;

function sysMsg(text, ok) {
  const m = $("sysMsg"); if (!m) return;
  m.textContent = text || "";
  m.className = "data-tools-msg " + (ok ? "ok" : "bad");
}
function sysDraftClone(cfg) { return JSON.parse(JSON.stringify(cfg)); }

async function renderSysConfig() {
  let u = null; try { u = await Api.currentUser(); } catch (e) { u = null; }
  const isAdmin = !!(u && u.role === "admin");
  $("sysDenied").classList.toggle("hidden", isAdmin);
  $("sysBody").classList.toggle("hidden", !isAdmin);
  if (!isAdmin) return;
  sysMsg("");
  SYS_DRAFT = sysDraftClone(await adGetSystem());
  syncSysUI();
}

// 초안 → 폼(브랜딩/기본값/스위치/메뉴 목록) 반영
function syncSysUI() {
  const d = SYS_DRAFT; if (!d) return;
  const b = d.branding;
  const set = (id, v) => { const n = $(id); if (n) n.value = v || ""; };
  set("sysTitle", b.title); set("sysSubtitle", b.subtitle);
  set("sysLogoEmoji", b.logo_emoji); set("sysFavEmoji", b.favicon_emoji);
  sysPaintPreview("sysLogoPreview", b.logo_image, b.logo_emoji || "📘");
  sysPaintPreview("sysFavPreview", b.favicon_image, b.favicon_emoji || b.logo_emoji || "📘");
  const sel = (id, v) => { const n = $(id); if (n) n.value = v; };
  sel("sysDefTheme", d.defaults.theme); sel("sysDefMode", d.defaults.mode);
  sel("sysDefFont", d.defaults.fontscale); sel("sysDefLayout", d.defaults.layout);
  sysSegSync("sysFeatAudit", d.features.audit !== false);
  renderSysMenuList();
}
function sysPaintPreview(id, img, emoji) {
  const n = $(id); if (!n) return;
  n.innerHTML = "";
  if (img) { const i = document.createElement("img"); i.src = img; i.alt = ""; n.appendChild(i); }
  else n.textContent = emoji;
}
function sysSegSync(id, on) {
  const seg = $(id); if (!seg) return;
  seg.querySelectorAll(".seg-btn").forEach((b) => {
    b.classList.toggle("active", (b.dataset.on === "1") === (on !== false));
  });
}

/* 메뉴 목록: 순서(▲▼) · 활성 토글 · 그룹 선택 */
function renderSysMenuList() {
  const box = $("sysMenuList"); if (!box || !SYS_DRAFT) return;
  const order = SYS_DRAFT.nav.order.slice();
  box.innerHTML = "";
  order.forEach((key, i) => {
    const locked = navLocked(key);
    const off = SYS_DRAFT.nav.disabled.indexOf(key) >= 0;
    const row = document.createElement("div");
    row.className = "sys-menu-row" + (off ? " off" : "");
    row.innerHTML =
      '<span class="smr-ord"></span>' +
      '<span class="smr-name"></span>' +
      '<select class="set-select smr-group"></select>' +
      '<span class="smr-btns">' +
      '<button class="ghost-btn smr-up" type="button" aria-label="위로">▲</button>' +
      '<button class="ghost-btn smr-down" type="button" aria-label="아래로">▼</button>' +
      '<button class="ghost-btn smr-toggle" type="button"></button>' +
      '</span>';
    row.querySelector(".smr-ord").textContent = String(i + 1);
    row.querySelector(".smr-name").textContent = NAV_MENU_LABEL[key] || key;

    const gsel = row.querySelector(".smr-group");
    NAV_GROUP_ORDER.forEach((g) => {
      const o = document.createElement("option");
      o.value = g; o.textContent = NAV_GROUP_LABEL[g] || (g === "main" ? "(맨 위)" : g === "library" ? "(단독 메뉴)" : "(기타)");
      gsel.appendChild(o);
    });
    gsel.value = (SYS_DRAFT.nav.groups && SYS_DRAFT.nav.groups[key]) || sysMeta().NAV_GROUPS[key] || "system";
    gsel.disabled = locked;
    gsel.addEventListener("change", () => {
      SYS_DRAFT.nav.groups[key] = gsel.value;
      renderSysMenuList();
    });

    const up = row.querySelector(".smr-up"), down = row.querySelector(".smr-down");
    up.disabled = (i === 0); down.disabled = (i === order.length - 1);
    up.addEventListener("click", () => sysMove(key, -1));
    down.addEventListener("click", () => sysMove(key, 1));

    const tg = row.querySelector(".smr-toggle");
    if (locked) { tg.textContent = "항상 켜짐"; tg.disabled = true; }
    else {
      tg.textContent = off ? "켜기" : "끄기";
      tg.classList.toggle("smr-on", off);
      tg.addEventListener("click", () => sysToggleMenu(key));
    }
    box.appendChild(row);
  });
}
function sysMove(key, delta) {
  const o = SYS_DRAFT.nav.order;
  const i = o.indexOf(key);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= o.length) return;
  o[i] = o[j]; o[j] = key;
  renderSysMenuList();
}
function sysToggleMenu(key) {
  if (navLocked(key)) return;
  const d = SYS_DRAFT.nav.disabled;
  const i = d.indexOf(key);
  if (i >= 0) d.splice(i, 1); else d.push(key);
  renderSysMenuList();
}

/* 이미지 업로드 → dataURL (용량 초과 시 안내). 외부 라이브러리 없이 FileReader 만 사용. */
function sysReadImage(file, onDone) {
  const max = (sysMeta().IMAGE_MAX || 300 * 1024);
  if (!file) return;
  if (!/^image\//.test(file.type || "")) { sysMsg("이미지 파일만 올릴 수 있어요.", false); return; }
  // dataURL 은 원본보다 약 4/3 커진다 → 원본 기준으로 미리 걸러 안내.
  if (file.size > max * 0.72) {
    sysMsg("이미지가 너무 커요. 약 " + Math.round((max * 0.72) / 1024) + "KB 이하 파일을 올려 주세요.", false);
    return;
  }
  const fr = new FileReader();
  fr.onload = () => {
    const url = String(fr.result || "");
    if (url.length > max) { sysMsg("이미지가 너무 커요. 더 작은 파일을 올려 주세요.", false); return; }
    sysMsg("");
    onDone(url);
  };
  fr.onerror = () => sysMsg("이미지를 읽지 못했어요. 다른 파일로 시도해 주세요.", false);
  fr.readAsDataURL(file);
}

function bindSysEvents() {
  if (!sy.area) return;
  const t = $("sysTitle"); if (t) t.addEventListener("input", () => { if (SYS_DRAFT) SYS_DRAFT.branding.title = t.value; });
  const s = $("sysSubtitle"); if (s) s.addEventListener("input", () => { if (SYS_DRAFT) SYS_DRAFT.branding.subtitle = s.value; });
  const le = $("sysLogoEmoji");
  if (le) le.addEventListener("input", () => {
    if (!SYS_DRAFT) return;
    SYS_DRAFT.branding.logo_emoji = le.value;
    sysPaintPreview("sysLogoPreview", SYS_DRAFT.branding.logo_image, le.value || "📘");
    sysPaintPreview("sysFavPreview", SYS_DRAFT.branding.favicon_image,
      SYS_DRAFT.branding.favicon_emoji || le.value || "📘");
  });
  const fe = $("sysFavEmoji");
  if (fe) fe.addEventListener("input", () => {
    if (!SYS_DRAFT) return;
    SYS_DRAFT.branding.favicon_emoji = fe.value;
    sysPaintPreview("sysFavPreview", SYS_DRAFT.branding.favicon_image,
      fe.value || SYS_DRAFT.branding.logo_emoji || "📘");
  });

  const pick = (btnId, fileId, apply) => {
    const btn = $(btnId), f = $(fileId);
    if (btn && f) {
      btn.addEventListener("click", () => f.click());
      f.addEventListener("change", () => {
        const file = f.files && f.files[0];
        sysReadImage(file, (url) => { apply(url); syncSysUI(); });
        f.value = "";
      });
    }
  };
  pick("sysLogoPick", "sysLogoFile", (url) => { if (SYS_DRAFT) SYS_DRAFT.branding.logo_image = url; });
  pick("sysFavPick", "sysFavFile", (url) => { if (SYS_DRAFT) SYS_DRAFT.branding.favicon_image = url; });
  const lc = $("sysLogoClear");
  if (lc) lc.addEventListener("click", () => { if (SYS_DRAFT) { SYS_DRAFT.branding.logo_image = ""; syncSysUI(); } });
  const fc = $("sysFavClear");
  if (fc) fc.addEventListener("click", () => { if (SYS_DRAFT) { SYS_DRAFT.branding.favicon_image = ""; syncSysUI(); } });

  [["sysDefTheme", "theme"], ["sysDefMode", "mode"], ["sysDefFont", "fontscale"], ["sysDefLayout", "layout"]]
    .forEach(([id, key]) => {
      const n = $(id);
      if (n) n.addEventListener("change", () => { if (SYS_DRAFT) SYS_DRAFT.defaults[key] = n.value; });
    });

  [["sysFeatAudit", "audit"]].forEach(([id, key]) => {
    const seg = $(id); if (!seg) return;
    seg.querySelectorAll(".seg-btn").forEach((b) => {
      b.addEventListener("click", () => {
        if (!SYS_DRAFT) return;
        SYS_DRAFT.features[key] = (b.dataset.on === "1");
        sysSegSync(id, SYS_DRAFT.features[key]);
      });
    });
  });

  const save = $("sysSave"); if (save) save.addEventListener("click", saveSysConfig);
  const rel = $("sysReload"); if (rel) rel.addEventListener("click", renderSysConfig);
  const rst = $("sysReset"); if (rst) rst.addEventListener("click", resetSysConfig);
}

async function saveSysConfig() {
  if (!SYS_DRAFT) return;
  const r = await adSaveSystem({
    branding: SYS_DRAFT.branding, nav: SYS_DRAFT.nav,
    defaults: SYS_DRAFT.defaults, features: SYS_DRAFT.features,
  });
  if (!r || !r.ok) { sysMsg((r && r.message) || "저장하지 못했어요.", false); return; }
  SYSCFG = r.config;
  SYS_DRAFT = sysDraftClone(SYSCFG);
  await applySystemConfig();
  syncSysUI();
  sysMsg("시스템 설정을 저장했어요. 화면에 바로 반영됐어요.", true);
}
async function resetSysConfig() {
  const r = await adResetSystem();
  if (!r || !r.ok) { sysMsg((r && r.message) || "복원하지 못했어요.", false); return; }
  SYSCFG = r.config;
  SYS_DRAFT = sysDraftClone(SYSCFG);
  await applySystemConfig();
  syncSysUI();
  sysMsg("기본값으로 복원했어요.", true);
}

/* HTML 이스케이프(사용자/데이터 텍스트 안전 삽입) */
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
}

function isTopnav() {
  return document.documentElement.getAttribute("data-layout") === "topnav";
}
function closeTopnavMenus(keepEl) {
  document.querySelectorAll(".side-nav .nav-group.open").forEach(function (g) {
    if (g === keepEl) return;
    g.classList.remove("open");
    const sub = g.querySelector(":scope > .nav-sub");
    if (sub) { sub.style.top = ""; sub.style.left = ""; }   // fixed 좌표 초기화
  });
  const right = $("topRight");
  if (right && right !== keepEl) right.classList.remove("open");
}
function bindTopnavDropdowns() {
  // 그룹 제목 클릭 → 해당 그룹만 열기
  document.querySelectorAll(".side-nav .nav-group > .nav-heading").forEach(function (h) {
    h.setAttribute("role", "button");
    h.setAttribute("tabindex", "0");
    const toggle = function (e) {
      if (!isTopnav()) return;
      e.stopPropagation();
      const g = h.parentElement;
      const on = !g.classList.contains("open");
      closeTopnavMenus(on ? g : null);
      g.classList.toggle("open", on);
      if (on) positionNavPanel(g);   // fixed 패널이라 좌표를 직접 잡아준다
    };
    h.addEventListener("click", toggle);
    h.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(e); }
    });
  });
  // 항목 선택 시 닫기
  const nav = $("sideNav");
  if (nav) nav.addEventListener("click", function (e) {
    if (isTopnav() && e.target.closest(".nav-item")) closeTopnavMenus();
  });
  if (nav) {
    // 가로 스크롤: 화살표/페이드 갱신 + 열린 패널 따라 움직이기
    nav.addEventListener("scroll", function () {
      updateNavScroll();
      repositionOpenNavPanel();
    }, { passive: true });
    // 세로 휠을 가로 스크롤로 — 트랙패드 가로 제스처(deltaX)는 브라우저에 맡긴다
    nav.addEventListener("wheel", function (e) {
      if (!isTopnav()) return;
      if (nav.scrollWidth - nav.clientWidth <= 2) return;
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      nav.scrollLeft += e.deltaY;
      e.preventDefault();
    }, { passive: false });
  }
  window.addEventListener("resize", function () {
    updateNavScroll();
    updateTopRightScroll();
    repositionOpenNavPanel();
    libFitHeight();
  });
  // 사이드바 레이아웃의 상단바: 칩이 넘치면 줄바꿈 대신 가로 스크롤
  const tr = $("topRight");
  if (tr) {
    tr.addEventListener("scroll", updateTopRightScroll, { passive: true });
    tr.addEventListener("wheel", function (e) {
      if (isTopnav()) return;
      if (tr.scrollWidth - tr.clientWidth <= 2) return;
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      tr.scrollLeft += e.deltaY;
      e.preventDefault();
    }, { passive: false });
  }
  // 계정 뱃지 클릭 → 우측 정보 펼치기 (로그아웃 버튼 클릭은 제외)
  const chip = $("userChip"), right = $("topRight");
  if (chip && right) {
    chip.addEventListener("click", function (e) {
      if (!isTopnav()) return;
      if (e.target.closest("#logoutBtn")) return;
      e.stopPropagation();
      const on = !right.classList.contains("open");
      closeTopnavMenus(on ? right : null);
      right.classList.toggle("open", on);
    });
  }
  document.addEventListener("click", function (e) {
    if (!isTopnav()) return;
    if (e.target.closest(".side-nav, #topRight")) return;
    closeTopnavMenus();
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeTopnavMenus(); });
}

/* =========================================================================
 * 공용 보조 — 저장소 캐시 · 화면 복원 메모 · 날짜 · 글 조각(검색용) · 관리자 메뉴
 * ========================================================================= */
// 계정 저장소(설정 등)의 메모리 캐시. 서버 모드에서는 Api 가 계정 kv 로 실시간 저장한다.
let ROOT_CACHE = null;
async function bootstrapStorage() {
  let raw = null;
  try { raw = await Api.getRootBlob(); } catch (e) { raw = null; }
  ROOT_CACHE = raw && typeof raw === "object" ? raw : {};
}
function loadRoot() {
  if (!ROOT_CACHE) ROOT_CACHE = {};
  return ROOT_CACHE;
}
function saveRoot(root) {
  ROOT_CACHE = root;
  try { Api.setRootBlob(root); } catch (e) { /* 저장 실패해도 계속 */ }
}
async function adSaveSettings(s) {
  const root = loadRoot();
  root.settings = s;
  saveRoot(root);
}
// 화면 복원 메모(새로고침 전까지 — 보던 자료 다시 펼치기)
const SESS = { nav: null, library: null };
function sessTouch() { /* 메모리에만 둔다 */ }
function sessFlush() { /* 메모리에만 둔다 */ }
let _resumeTimer = null;
function showResumeNote(text) {
  const n = $("resumeNote");
  if (!n) return;
  n.textContent = text || "";
  n.classList.remove("hidden");
  if (_resumeTimer) clearTimeout(_resumeTimer);
  _resumeTimer = setTimeout(() => { n.classList.add("hidden"); }, 4000);
}
function todayISO() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
// 검색용 글 조각 — 영문은 단어, 한글은 2글자 조각(BM25 색인에 쓴다)
const TEXT_STOP = new Set(("a an the of to in on at by for and or is are was were be been it its this that these those with from as " +
  "what which who how why when where do does did can could will would should may might no not yes up down out my your our their").split(" "));
const TEXT_STOP_KO = new Set("에서 으로 에게 하는 이다 것은 것을 가장 적절 절한 설명 명으로 관한 대한 다음 음에 음은 뭐야 무엇 어떻 떻게 해줘 알려 려줘 인가 는가 할때 경우 에는 까지 부터 이란 란무 궁금".split(" "));
function textTokens(s) {
  s = String(s || "").toLowerCase().replace(/[|¶]/g, " ");
  const out = [];
  (s.match(/[a-z][a-z0-9\-\.\/+]{1,}/g) || []).forEach((w) => { w = w.replace(/[.\-]+$/, ""); if (!TEXT_STOP.has(w)) out.push(w); });
  (s.match(/[가-힣]{2,}/g) || []).forEach((w) => { for (let i = 0; i < w.length - 1; i++) { const b = w.substr(i, 2); if (!TEXT_STOP_KO.has(b)) out.push(b); } });
  return out;
}
// 관리자 메뉴 그룹 노출
async function applyAdminNav() {
  let u = null; try { u = await Api.currentUser(); } catch (e) { u = null; }
  const g = $("adminNavGroup");
  if (g) g.classList.toggle("hidden", !(u && u.role === "admin"));
}

boot();

