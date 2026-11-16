/* =============================================================================
 * emergency.js (v169) — 비상복구모드 emergency/1 v1.2 화면 쪽
 *   · 로그인 화면: 서버가 통합로그인 health 실패(연결 실패·시간 초과·5xx)라고 할 때만 「비상복구모드」 단추
 *     공용 테마 G31(RUI.login onEmergency · setSso({emergency}) · RUI.emergencyBar)이 있으면 그것을, 없으면 같은 문구의 자체 칸
 *   · 비상 세션: 모든 화면 위 띠 · 1분마다 상태 확인(통합로그인이 살아나면 서버가 세션을 끝냄 → 안내 후 로그인 화면)
 *   · 관리자: 「비상 로그인 발생」 강조(시각·계정·IP) — 확인 처리할 때까지(1-2a ④)
 *   · AI: 비상 연결로 답하면 「비상 모드(AI 관리시스템 접속 불가) · 저장된 연결로 응답」(10분에 한 번)
 * ========================================================================== */
(function (global) {
  "use strict";
  const T = {
    btn: "통합로그인 접속 불가 · 비상복구모드",
    note: "통합로그인 장애 중에만 사용 · 마지막 통합로그인 비밀번호로 이 시스템에만 로그인 · 최대 8시간",
    bar: "비상복구모드 · 통합로그인 접속 불가 중 · 복구되면 다시 로그인",
    ai: "비상 모드(AI 관리시스템 접속 불가) · 저장된 연결로 응답",
  };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const g31 = () => !!(global.RUI && typeof RUI.emergencyBar === "function");
  const fmt = (sec) => { const d = new Date(sec * 1000); return d.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" }) + " " + d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }); };

  async function call(op, body) {
    const init = { method: body === undefined ? "GET" : "POST", cache: "no-store", credentials: "same-origin", headers: {} };
    if (body !== undefined) { init.headers["X-Study-Vault"] = "1"; init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
    try { const r = await fetch("api.php?r=sso&op=" + op, init); let d = null; try { d = await r.json(); } catch (e) { d = null; } return Object.assign({ http: r.status }, d || { ok: false }); }
    catch (e) { return { ok: false, http: 0, message: "서버에 연결할 수 없습니다." }; }
  }
  async function available() { const d = await call("emergency_status"); return !!(d && d.ok && d.available); }
  async function login(id, pw) {
    const d = await call("emergency_login", { username: id, password: pw });
    if (!d.ok) throw new Error(d.message || "비상 로그인을 할 수 없습니다. 통합로그인 복구 후 다시 시도하세요.");
    return d;
  }

  /* 로그인 화면 — 공용 RUI.login(G31)이면 그쪽이 그린다. 이전 테마(예전 로그인 카드)일 때만 같은 문구의 자체 칸 */
  function paintLogin(o) {
    const host = o.host; if (!host) return;
    let box = host.querySelector(".emg-login");
    if (!o.available || (o.rui && g31())) { if (box) box.remove(); return; }
    if (!box) { box = document.createElement("div"); box.className = "emg-login"; host.appendChild(box); }
    if (box.dataset.ready) return;
    box.dataset.ready = "1";
    box.innerHTML = '<button type="button" class="btn emg-open">' + esc(T.btn) + "</button>" +
      '<form class="emg-form" hidden novalidate><p class="emg-note">' + esc(T.note) + "</p>" +
      '<label>통합로그인 아이디<input class="input" name="eu" autocomplete="username" required></label>' +
      '<label>통합로그인 비밀번호<input class="input" name="ep" type="password" autocomplete="current-password" required></label>' +
      '<div class="emg-err" role="alert" aria-live="polite"></div><button class="btn primary emg-go" type="submit">비상 로그인</button></form>';
    const f = box.querySelector("form"), err = box.querySelector(".emg-err"), go = box.querySelector(".emg-go");
    box.querySelector(".emg-open").onclick = () => { f.hidden = !f.hidden; if (!f.hidden) f.eu.focus(); };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const id = f.eu.value.trim(), pw = f.ep.value;
      if (!id || !pw) { err.textContent = !id ? "아이디를 입력하세요." : "비밀번호를 입력하세요."; return; }
      err.textContent = ""; go.disabled = true; go.textContent = "확인하는 중…";
      try { await login(id, pw); f.ep.value = ""; if (o.onDone) await o.onDone(); }
      catch (er) { err.textContent = er.message; f.ep.select(); }
      go.disabled = false; go.textContent = "비상 로그인";
    };
  }

  /* 비상 세션 띠 */
  function bar(on) {
    if (g31()) {                 // G31·G32 공용 띠(#ruiEmgBar 32px, :root --rui-emg-h). 고정 칸은 style.css 가 그 값만큼 내린다
      try { if (on) RUI.emergencyBar(); else RUI.emergencyBar(null); } catch (e) { /* 계속 */ }   // G34: 인자 없이 → 공용 기본 문구·좁은 화면 짧은 문구
      return;
    }
    let b = document.getElementById("emgBar");
    document.documentElement.classList.toggle("emg-on", !!on);
    if (!on) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement("div"); b.id = "emgBar"; b.className = "emg-bar"; b.setAttribute("role", "status"); document.body.insertBefore(b, document.body.firstChild); }
    b.textContent = T.bar;
  }

  /* 관리자 강조 — 비상 로그인 발생 */
  let alertT = 0;
  async function alerts(force) {
    if (!force && Date.now() - alertT < 60000) return;
    alertT = Date.now();
    const d = await call("emergency_alerts");
    let el = document.getElementById("emgAlert");
    const list = (d && d.ok && d.list) || [];
    if (!list.length) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement("div"); el.id = "emgAlert"; el.className = "emg-alert"; el.setAttribute("role", "alert"); document.body.appendChild(el); }
    const a = list[0];
    el.innerHTML = "<b>비상 로그인 발생 " + list.length + "건</b><span>" + esc(fmt(a.at)) + " · " + esc(a.username || a.user) + (a.ulogin ? " (" + esc(a.ulogin) + ")" : "") + " · " + esc(a.ip || "") + (list.length > 1 ? " 외 " + (list.length - 1) + "건" : "") + "</span>" +
      '<button type="button" class="btn" data-emg-ack>확인</button>';
    el.querySelector("[data-emg-ack]").onclick = async () => { const r = await call("emergency_ack", {}); if (r.ok) el.remove(); };
  }

  let pollT = null;
  function sync(user) {
    const emg = !!(user && user.emergency);
    bar(emg);
    if (user && user.role === "admin") alerts(); else { const el = document.getElementById("emgAlert"); if (el) el.remove(); }
    if (emg && !pollT) {
      pollT = setInterval(async () => {            // 통합로그인이 살아나면 서버가 비상 세션을 끝낸다 → 안내 후 로그인 화면
        try {
          const d = await (await fetch("api.php?r=auth&op=status", { cache: "no-store", credentials: "same-origin" })).json();
          if (d && d.ok && !d.user) { clearInterval(pollT); pollT = null; if (global.SERVER && SERVER.expired) SERVER.expired(d.notice); else { alert(d.notice || T.bar); location.reload(); } }
        } catch (e) { /* 계속 */ }
      }, 60000);
    }
    if (!emg && pollT) { clearInterval(pollT); pollT = null; }
  }

  let aiT = 0;
  function aiNotice() {
    if (Date.now() - aiT < 600000) return;
    aiT = Date.now();
    if (global.SERVER && SERVER.notice) SERVER.notice(T.ai);
  }

  global.EMG = { T, available, login, paintLogin, bar, alerts, sync, aiNotice };
})(window);
