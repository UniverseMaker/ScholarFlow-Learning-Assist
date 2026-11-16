/* =============================================================================
 * rndlink.js (v93) — 연구 프로젝트 연결: 로컬 폴더 · 마스터 폴더 · FlowBoard(칸반) 에픽
 *   · 로컬 폴더 연결: 서버 PC 의 폴더를 복사하지 않고 그 자리의 파일 구조 그대로 프로젝트 자료로(읽기만). 관리자만.
 *   · 마스터 폴더: 상위 폴더를 등록하면 하위 폴더 하나하나가 프로젝트가 된다(예: Claude Projects 폴더). [동기화]로 새 하위 폴더 추가.
 *   · FlowBoard 에픽: 개인 API 토큰(fbt_…)을 서버에 연결 → 보드의 에픽을 골라 프로젝트로(또는 기존 프로젝트에 연결),
 *     프로젝트 안에서 에픽 상태·하위 작업을 보고 진행 기록을 댓글로 남긴다. 연결 없이 직접 만드는 프로젝트도 그대로.
 *   서버: tools/ws_api.py(folder_link·master_*·tree·browse) · tools/kanban_api.py(r=kb)
 * ========================================================================== */
(function () {
  "use strict";
  const esc = (s) => escapeHtml(String(s == null ? "" : s));
  const $ = (id) => document.getElementById(id);
  const WS = () => window.RND && RND.ws;
  const isAdmin = () => !!(window.SERVER && SERVER.user && SERVER.user.role === "admin");
  const fmtD = (t) => t ? new Date(t).toLocaleDateString("ko-KR") : "";
  async function kb(op, params, body) {
    let u = "api.php?r=kb&op=" + op; Object.keys(params || {}).forEach((k) => { if (params[k] != null && params[k] !== "") u += "&" + k + "=" + encodeURIComponent(params[k]); });
    const init = { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store", headers: {} };
    if (body !== undefined) { init.headers["Content-Type"] = "application/json"; init.headers["X-Study-Vault"] = "1"; init.body = JSON.stringify(body); }
    const r = await fetch(u, init); let d = null; try { d = await r.json(); } catch (e) { d = null; }
    if (!d) throw new Error("HTTP " + r.status);
    if (d.ok === false && d.error !== "not_connected") throw new Error(d.message || "FlowBoard 오류");
    return d;
  }

  /* ---------------- 공용 모달 ---------------- */
  function modal(title, html, wide) {
    let m = $("rlModal");
    if (!m) { m = document.createElement("div"); m.id = "rlModal"; m.className = "rl-modal"; m.innerHTML = '<div class="rl-box" role="dialog" aria-modal="true"><div class="rl-h"><b id="rlT"></b><button type="button" class="ask-icon" data-rl="close" aria-label="닫기">✕</button></div><div class="rl-b" id="rlB"></div></div>'; document.body.appendChild(m);
      m.addEventListener("click", (e) => { if (e.target === m || e.target.closest('[data-rl="close"]')) m.classList.remove("on"); }); }
    m.querySelector(".rl-box").classList.toggle("wide", !!wide);
    $("rlT").textContent = title; $("rlB").innerHTML = html; m.classList.add("on");
    return $("rlB");
  }
  const close = () => { const m = $("rlModal"); if (m) m.classList.remove("on"); };

  /* ---------------- 폴더 고르기(서버 PC) ---------------- */
  async function folderDialog(kind, done) {
    if (!isAdmin()) { alert("폴더 연결은 관리자만 할 수 있어요(서버 PC 의 디스크를 읽기 때문)."); return; }
    const title = kind === "master" ? "🗂 마스터 폴더 등록 — 하위 폴더마다 프로젝트" : "📁 로컬 폴더 연결 — 폴더 그대로 프로젝트 자료로";
    const body = modal(title, '<p class="sh-muted">' + (kind === "master" ? "고른 폴더의 <b>하위 폴더 하나하나</b>가 연구 프로젝트가 돼요(예: Claude Projects 폴더). 나중에 생긴 하위 폴더는 [동기화]로 추가해요." : "폴더를 복사하지 않고 <b>그 자리의 파일 구조 그대로</b> 써요(읽기만). 문서·대화·내보내기는 프로젝트 저장소에 따로 남아요.") + '</p><div class="rl-path"><input id="rlPath" type="text" placeholder="C:\\Users\\…\\폴더 경로를 붙여 넣거나 아래에서 고르기"><button type="button" class="ghost-btn big-btn" data-rl="go">열기</button></div><div id="rlList" class="rl-list"></div><div class="rl-f"><button type="button" class="primary big-btn" data-rl="ok">' + (kind === "master" ? "🗂 이 폴더를 마스터로 등록" : "📁 이 폴더 연결") + '</button><span class="sh-muted" id="rlMsg"></span></div>', true);
    async function show(path) {
      const list = $("rlList"); list.innerHTML = '<p class="sh-muted">불러오는 중…</p>';
      let d; try { d = await WS().req("browse", { path: path || "" }); } catch (e) { list.innerHTML = '<p class="lb-warn">' + esc(e.message) + "</p>"; return; }
      if (d.path) $("rlPath").value = d.path;
      list.innerHTML = (d.error ? '<p class="lb-warn">' + esc(d.error) + "</p>" : "") +
        (!d.path ? '<p class="sh-muted">자주 쓰는 곳</p>' + (d.quick || []).map((q) => '<button type="button" class="rl-dir" data-rlp="' + esc(q) + '">⭐ ' + esc(q) + "</button>").join("") + '<p class="sh-muted">드라이브</p>' + (d.roots || []).map((q) => '<button type="button" class="rl-dir" data-rlp="' + esc(q) + '">💽 ' + esc(q) + "</button>").join("")
          : (d.parent ? '<button type="button" class="rl-dir up" data-rlp="' + esc(d.parent) + '">⬆ 상위 폴더</button>' : '<button type="button" class="rl-dir up" data-rlp="">⬆ 처음으로</button>') + d.dirs.map((x) => '<button type="button" class="rl-dir" data-rlp="' + esc(d.path.replace(/[\\/]+$/, "") + (d.path.indexOf("/") >= 0 && d.path.indexOf("\\") < 0 ? "/" : "\\") + x) + '">📁 ' + esc(x) + "</button>").join("") + (d.dirs.length ? "" : '<p class="sh-muted">하위 폴더가 없어요.</p>'));
    }
    body.addEventListener("click", async (e) => {
      const p = e.target.closest("[data-rlp]"); if (p) { show(p.dataset.rlp); return; }
      const a = e.target.closest("[data-rl]"); if (!a) return;
      if (a.dataset.rl === "go") show($("rlPath").value.trim());
      if (a.dataset.rl === "ok") {
        const path = $("rlPath").value.trim(); if (!path) { $("rlMsg").textContent = "폴더를 고르세요."; return; }
        a.disabled = true; $("rlMsg").textContent = kind === "master" ? "하위 폴더를 프로젝트로 만드는 중…" : "연결하는 중…";
        try {
          const d = await WS().req(kind === "master" ? "master_add" : "folder_link", {}, { path: path });
          close();
          if (kind === "master") { if (window.SERVER && SERVER.notice) SERVER.notice("마스터 폴더 등록 — 새 프로젝트 " + d.created.length + "개" + (d.linked ? " · 이미 있던 " + d.linked + "개" : "")); done && done(); }
          else { done && done(d.project); }
        } catch (er) { $("rlMsg").textContent = "⚠ " + er.message; a.disabled = false; }
      }
    });
    $("rlPath").addEventListener("keydown", (e) => { if (e.key === "Enter") show($("rlPath").value.trim()); });
    show("");
  }

  async function paintMasters(el, refresh) {
    if (!el) return;
    if (!isAdmin()) { el.innerHTML = ""; return; }
    let d; try { d = await WS().req("masters"); } catch (e) { el.innerHTML = ""; return; }
    if (!d.list.length) { el.innerHTML = ""; return; }
    el.innerHTML = '<div class="rl-masters"><b>🗂 마스터 폴더</b>' + d.list.map((m) => '<div class="rl-m"><span title="' + esc(m.path) + '"><b>' + esc(m.name) + "</b><small>" + esc(m.path) + " · 하위 폴더 " + m.subdirs + " · 프로젝트 " + m.projects + (m.exists ? "" : " · ⚠ 폴더 없음") + '</small></span><button type="button" class="ghost-btn small-btn" data-rlm="sync" data-id="' + esc(m.id) + '">↻ 동기화</button><button type="button" class="icon-mini" data-rlm="rm" data-id="' + esc(m.id) + '" title="등록 해제(프로젝트는 남아요)">✕</button></div>' + ((m.exclude || []).length ? '<details class="rl-excl"><summary>뺀 하위 폴더 ' + m.exclude.length + '개 — 동기화해도 다시 만들지 않아요</summary>' + m.exclude.map((x) => '<div><code>' + esc(x.split(/[\/]/).pop()) + '</code><button type="button" class="ghost-btn small-btn" data-rlm="inc" data-id="' + esc(m.id) + '" data-path="' + esc(x) + '">다시 넣기</button></div>').join("") + "</details>" : "")).join("") + "</div>";
    el.onclick = async (e) => {
      const b = e.target.closest("[data-rlm]"); if (!b) return;
      if (b.dataset.rlm === "sync") { b.disabled = true; const r = await WS().req("master_sync", {}, { id: b.dataset.id }); if (window.SERVER && SERVER.notice) SERVER.notice("새 프로젝트 " + r.created.length + "개"); refresh && refresh(); }
      if (b.dataset.rlm === "inc") { await WS().req("master_include", {}, { id: b.dataset.id, path: b.dataset.path }); refresh && refresh(); }
      if (b.dataset.rlm === "rm" && confirm("마스터 폴더 등록을 해제할까요? 이미 만든 프로젝트와 연결은 그대로 남아요.")) { await WS().req("master_remove", {}, { id: b.dataset.id }); refresh && refresh(); }
    };
  }

  /* ---------------- FlowBoard ---------------- */
  async function connectForm(el, after) {
    const st = await kb("status");
    if (st.connected) { el.innerHTML = '<p>✅ FlowBoard 연결됨 — <b>' + esc((st.me && (st.me.name || st.me.username)) || "") + "</b> · " + esc(st.base) + " · 토큰 " + esc(st.token_hint) + ' <button type="button" class="ghost-btn small-btn" data-kbx="off">연결 끊기</button></p>'; el.onclick = async (e) => { if (e.target.closest('[data-kbx="off"]') && confirm("FlowBoard 연결을 끊을까요? (서버에 보관된 토큰을 지워요)")) { await kb("disconnect", {}, {}); connectForm(el, after); } }; return true; }
    el.innerHTML = '<p class="sh-muted">FlowBoard › 설정 › 계정 › <b>API 토큰</b>에서 만든 토큰(fbt_…)을 넣으세요. 토큰은 이 서버에 암호화해 두고 브라우저로 내려보내지 않아요. 읽기만 하려면 read, 진행 기록 댓글까지 쓰려면 write 권한.</p><div class="sv-grid"><label class="w2">FlowBoard API 주소<input id="kbBase" type="url" value="' + esc(st.base) + '"></label><label class="w2">API 토큰<input id="kbTok" type="password" autocomplete="off" placeholder="fbt_…"></label></div><div class="llm-tools"><button type="button" class="primary big-btn" data-kbx="on">연결</button><span class="sh-muted" id="kbMsg"></span></div>';
    el.onclick = async (e) => { if (!e.target.closest('[data-kbx="on"]')) return; $("kbMsg").textContent = "확인 중…"; try { await kb("connect", {}, { base: $("kbBase").value.trim(), token: $("kbTok").value.trim() }); connectForm(el, after); after && after(); } catch (er) { $("kbMsg").textContent = "⚠ " + er.message; } };
    return false;
  }
  const epicMeta = (e) => ({ id: String(e.id), key: e.key, title: e.title, board: e.projectKey, url: e.webUrl, status: (e.status && e.status.name) || "" });
  async function epicImport(done, linkPid) {
    const body = modal(linkPid ? "📋 이 프로젝트에 에픽 연결" : "📋 FlowBoard 에픽에서 프로젝트 만들기", '<div id="kbConn"></div><div id="kbPick"></div>', true);
    const pick = async () => {
      const box = $("kbPick"); box.innerHTML = '<p class="sh-muted">보드를 불러오는 중…</p>';
      let boards; try { boards = (await kb("boards")).list || []; } catch (e) { box.innerHTML = '<p class="lb-warn">' + esc(e.message) + "</p>"; return; }
      box.innerHTML = '<div class="rl-path"><select id="kbBoard">' + boards.map((b) => '<option value="' + esc(b.key || b.id) + '">' + esc((b.key ? b.key + " · " : "") + (b.name || b.title || "")) + "</option>").join("") + '</select><button type="button" class="ghost-btn big-btn" data-kbx="list">에픽 보기</button></div><div id="kbEpics" class="rl-list"></div>';
      const list = async () => {
        const el = $("kbEpics"); el.innerHTML = '<p class="sh-muted">에픽을 불러오는 중…</p>';
        let eps; try { eps = (await kb("epics", { project: $("kbBoard").value })).list || []; } catch (er) { el.innerHTML = '<p class="lb-warn">' + esc(er.message) + "</p>"; return; }
        const have = new Set(((window.RND && RND.projects && RND.projects()) || []).filter((p) => p.epic).map((p) => String(p.epic.id)));
        el.innerHTML = eps.length ? eps.map((x) => '<label class="rl-ep' + (have.has(String(x.id)) ? " had" : "") + '"><input type="' + (linkPid ? "radio" : "checkbox") + '" name="kbE" value="' + esc(x.id) + '"' + (have.has(String(x.id)) && !linkPid ? " disabled" : "") + '><span><b>' + esc(x.key) + " " + esc(x.title) + "</b><small>" + esc((x.status && x.status.name) || "") + (x.progress != null ? " · " + x.progress + "%" : "") + (x.dueDate ? " · 마감 " + esc(x.dueDate) : "") + (x.assignee ? " · " + esc(x.assignee.name || x.assignee.username) : "") + (have.has(String(x.id)) ? " · 이미 프로젝트 있음" : "") + "</small></span></label>").join("") + '<div class="rl-f"><button type="button" class="primary big-btn" data-kbx="make">' + (linkPid ? "이 에픽 연결" : "선택한 에픽으로 프로젝트 만들기") + "</button></div>" : '<p class="sh-muted">이 보드에 에픽이 없어요.</p>';
        el.onclick = async (ev) => {
          if (!ev.target.closest('[data-kbx="make"]')) return;
          const ids = Array.from(el.querySelectorAll('input[name="kbE"]:checked')).map((i) => i.value); if (!ids.length) return;
          const chosen = eps.filter((x) => ids.indexOf(String(x.id)) >= 0);
          if (linkPid) { const p = (RND.projects() || []).filter((x) => x.id === linkPid)[0] || {}; await WS().req("project", {}, Object.assign({}, p, { id: linkPid, epic: epicMeta(chosen[0]) })); close(); done && done(); return; }
          for (const x of chosen) await WS().req("project", {}, { name: x.title, kind: "other", goal: x.key + " · " + ((x.status && x.status.name) || ""), epic: epicMeta(x) });
          close(); if (window.SERVER && SERVER.notice) SERVER.notice("에픽 " + chosen.length + "개로 프로젝트를 만들었어요."); done && done();
        };
      };
      box.onclick = (e) => { if (e.target.closest('[data-kbx="list"]')) list(); };
      list();
    };
    if (await connectForm($("kbConn"), pick)) pick();
  }
  /* (v125) 이슈 연결(13장) — 찾아서 연결하거나 새로 만든다. 이슈의 변화는 칸반이 보내 작업 이력에 쌓인다 */
  function issuePanel(el, project) {
    const pid = project.id; let items = project.issues || [];
    const open = (x) => x.publicUrl || (window.HUBLINK ? HUBLINK.toPublic(x.url) : x.url);   // (G5) 늘 공개 도메인
    if (items.length) kb("issue_sync", { pid: pid }).catch(() => {});   // 서버가 꺼져 있던 동안의 변화를 작업 이력에 채운다
    const paint = () => {
      el.innerHTML = '<div class="lb-card2 rn-issues"><h3>이슈</h3>' + (items.length ? items.map((x) => '<div class="rn-iss"><a href="' + esc(open(x) || "#") + '" target="_blank" rel="noopener"><b>' + esc(x.key) + "</b> " + esc(x.title || "") + '</a><button type="button" class="mini-btn" data-iss-off="' + esc(x.id || "") + '">해제</button></div>').join("") : '<p class="sh-muted">업무관리의 이슈를 연결하면 바뀔 때마다 작업 이력에 남아요.</p>') +
        '<div class="rn-issbar"><input type="search" id="rnIssQ" placeholder="이슈 찾기"><button type="button" class="ghost-btn small-btn" data-iss="find">찾기</button><button type="button" class="ghost-btn small-btn" data-iss="new">새로 만들기</button></div><div id="rnIssR"></div></div>';
    };
    paint();
    el.onclick = async (e) => {
      const b = e.target.closest("[data-iss],[data-iss-go],[data-iss-off]"); if (!b) return;
      const r = el.querySelector("#rnIssR");
      try {
        if (b.dataset.iss === "find") {
          const q = el.querySelector("#rnIssQ").value.trim(); r.textContent = "찾는 중…";
          const l = (await kb("issues", { pid: pid, q: q })).list || [];
          r.innerHTML = l.length ? l.map((x) => '<div class="rn-iss"><span><b>' + esc(x.key) + "</b> " + esc(x.title || "") + " <small>" + esc(x.status || "") + '</small></span><button type="button" class="mini-btn" data-iss-go="' + esc(x.key) + '" data-t="' + esc(x.title || "") + '" data-u="' + esc(window.HUBLINK ? HUBLINK.toPublic(x.webUrl) : x.webUrl || "") + '" data-p="' + esc(x.publicUrl || "") + '">연결</button></div>').join("") : '<p class="sh-muted">찾은 이슈가 없어요.</p>';
        } else if (b.dataset.iss === "new") {
          const t = prompt("새 이슈 제목", el.querySelector("#rnIssQ").value.trim() || project.name || ""); if (!t || !t.trim()) return;
          const bd = prompt("어느 보드에 만들까요? (보드 키)", ""); if (bd == null) return;
          const d = await kb("issue_new", { pid: pid }, { title: t.trim(), project: bd.trim() }); items = d.issues || items; project.issues = items; paint();
        } else if (b.dataset.issGo) {
          const d = await kb("issue_link", { pid: pid }, { key: b.dataset.issGo, title: b.dataset.t, url: b.dataset.u, publicUrl: b.dataset.p }); items = d.issues || items; project.issues = items; paint();
        } else if ("issOff" in b.dataset) {
          if (!confirm("이 이슈 연결을 해제할까요?")) return;
          const d = await kb("issue_unlink", { pid: pid }, { id: b.dataset.issOff }); items = d.issues || []; project.issues = items; paint();
        }
      } catch (er) { if (r) r.textContent = "⚠ " + er.message; }
    };
  }
  async function epicPanel(el, project) {
    if (!el) return;
    const ep = project && project.epic;
    if (!ep) { el.innerHTML = '<div class="rn-sec"><div class="rn-sec-h"><b>📋 에픽</b><button type="button" class="ghost-btn small-btn" data-rl-ep="link">연결</button></div><p class="sh-muted">FlowBoard 에픽과 연결하면 상태·하위 작업을 여기서 봐요.</p></div>'; return; }
    el.innerHTML = '<div class="rn-sec"><div class="rn-sec-h"><b>📋 ' + esc(ep.key || "에픽") + "</b>" + (ep.url ? '<a class="ghost-btn small-btn" href="' + esc(ep.url) + '" target="_blank" rel="noopener">FlowBoard ↗</a>' : "") + '</div><p class="sh-muted">불러오는 중…</p></div>';
    let d; try { d = await kb("epic", { ref: ep.key || ep.id }); } catch (e) { el.querySelector("p").textContent = "⚠ " + e.message; return; }
    if (d.error === "not_connected") { el.querySelector("p").innerHTML = 'FlowBoard 가 연결되지 않았어요. <a href="#" data-acm-go="rndset">연구지원 설정</a>에서 연결하세요.'; return; }
    const e = d.epic || {}; const kids = d.children || [];
    const done = kids.filter((k) => k.done).length;
    el.querySelector(".rn-sec").innerHTML = '<div class="rn-sec-h"><b>📋 ' + esc(e.key) + "</b>" + (e.webUrl ? '<a class="ghost-btn small-btn" href="' + esc(window.HUBLINK ? HUBLINK.toPublic(e.webUrl) : e.webUrl) + '" target="_blank" rel="noopener">FlowBoard ↗</a>' : "") + "</div>" +
      "<p><b>" + esc(e.title) + "</b><br><small>" + esc((e.status && e.status.name) || "") + (e.progress != null ? " · 진행 " + e.progress + "%" : "") + (e.dueDate ? " · 마감 " + esc(e.dueDate) : "") + (e.overdue ? ' · <b class="rn-bad">지연</b>' : "") + "</small></p>" +
      '<div class="rl-prog"><i style="width:' + (kids.length ? Math.round(done / kids.length * 100) : (e.progress || 0)) + '%"></i></div><small class="sh-muted">하위 작업 ' + done + "/" + kids.length + " 완료</small>" +
      '<ul class="rl-kids">' + kids.slice(0, 30).map((k) => '<li class="' + (k.done ? "done" : k.overdue ? "late" : "") + '"><a href="' + esc((window.HUBLINK ? HUBLINK.toPublic(k.webUrl) : k.webUrl) || "#") + '" target="_blank" rel="noopener">' + esc(k.key) + "</a> " + esc(k.title) + "<small>" + esc((k.status && k.status.name) || "") + (k.assignee ? " · " + esc(k.assignee.name || k.assignee.username) : "") + (k.dueDate ? " · " + esc(k.dueDate) : "") + "</small></li>").join("") + "</ul>" +
      '<button type="button" class="ghost-btn small-btn" data-rl-ep="note">💬 에픽에 진행 기록 남기기</button>';
  }
  async function epicNote(project, summary) {
    const text = prompt("FlowBoard 에픽(" + (project.epic.key || "") + ")에 남길 진행 기록:", summary);
    if (!text) return;
    try { await kb("comment", {}, { ref: project.epic.key || project.epic.id, text: text }); if (window.SERVER && SERVER.notice) SERVER.notice("에픽에 기록을 남겼어요."); }
    catch (e) { alert("남기지 못했어요: " + e.message + "\n(토큰에 write 권한이 있어야 해요)"); }
  }

  /* ---------------- 폴더 트리 ---------------- */
  // (v98) 숨기기 — 쓸모없는 폴더·파일을 트리에서 숨긴다(실제 파일은 그대로). opts = {hidden:[상대 경로], showHidden, onHide(rel, hide), onToggleShow()}
  const FICO = (ext) => /^(pdf)$/.test(ext) ? "📕" : /^(docx?|rtf|odt|hwpx?)$/.test(ext) ? "📘" : /^(pptx?|odp|key)$/.test(ext) ? "📙" : /^(xlsx?|xlsm|csv|tsv|ods)$/.test(ext) ? "📗" : /^(png|jpe?g|gif|webp|bmp|svg|avif|tiff?)$/.test(ext) ? "🖼" : /^(mp3|wav|m4a|ogg|flac|aac|opus)$/.test(ext) ? "🎵" : /^(mp4|webm|mov|m4v|mkv|avi)$/.test(ext) ? "🎬" : /^(md|txt|log)$/.test(ext) ? "📝" : /^(html?|py|js|ts|css|json|java|c|cpp|go|rs|sql|ya?ml|xml|sh|ipynb)$/.test(ext) ? "🧩" : /^(zip|7z|rar|tar|gz)$/.test(ext) ? "🗜" : "📄";
  const OPEN = {};      // 루트별 펼친 폴더(다시 그려도 유지)
  const isHidden = (rel, hidden) => hidden.some((h) => rel === h || rel.indexOf(h + "/") === 0);
  function treePanel(el, files, sel, root, opts) {
    if (!el) return;
    opts = opts || {}; const hidden = opts.hidden || [];
    const all = files.filter((f) => f.folder), hidN = all.filter((f) => isHidden(f.rel, hidden)).length;
    const fs = opts.showHidden ? all : all.filter((f) => !isHidden(f.rel, hidden));
    const tree = { dirs: {}, files: [] };
    fs.forEach((f) => { const parts = f.rel.split("/"); let n = tree; parts.slice(0, -1).forEach((p) => { n = n.dirs[p] = n.dirs[p] || { dirs: {}, files: [] }; }); n.files.push(f); });
    const docN = fs.filter((f) => f.doc).length, on = fs.filter((f) => f.doc && sel(f.id)).length;
    const open = OPEN[root] = OPEN[root] || {};
    const cnt = (n) => n.files.length + Object.keys(n.dirs).reduce((a, d) => a + cnt(n.dirs[d]), 0);
    const draw = (n, depth, base) => Object.keys(n.dirs).sort((a, b) => a.localeCompare(b, "ko")).map((d) => { const rel = base ? base + "/" + d : d, hid = isHidden(rel, hidden); return '<details data-rl-dir="' + esc(rel) + '"' + ((open[rel] != null ? open[rel] : depth < 1) ? " open" : "") + (hid ? ' class="rl-hid"' : "") + '><summary><span class="rl-dn">📁 ' + esc(d) + '</span><small class="rl-dc">' + cnt(n.dirs[d]) + '</small><button type="button" class="rl-hide" data-rl-hide="' + esc(rel) + '" data-on="' + (hid ? 0 : 1) + '" title="' + (hid ? "다시 보이기" : "이 폴더 숨기기(파일은 그대로)") + '">' + (hid ? "👁" : "🙈") + '</button><button type="button" class="rl-hide" data-rl-rm="' + esc(rel) + '" title="이 폴더를 시스템에서 지우기(실제 폴더는 그대로)">🗑</button></summary>' + draw(n.dirs[d], depth + 1, rel) + "</details>"; }).join("") +
      n.files.map((f) => { const hid = isHidden(f.rel, hidden); return '<div class="rl-file' + (f.doc ? "" : " nodoc") + (hid ? " rl-hid" : "") + '">' + (f.doc ? '<input type="checkbox" data-rn-ctx="' + f.id + '"' + (sel(f.id) ? " checked" : "") + ' title="대화 근거에 넣기">' : '<span class="rl-nb"></span>') + '<button type="button" data-rn-src="' + f.id + '" title="' + esc(f.rel) + ' — 눌러서 보기"><i>' + FICO(f.ext) + "</i>" + esc(f.rel.split("/").pop()) + "</button><small>" + (f.size > 1048576 ? (f.size / 1048576).toFixed(1) + "MB" : Math.max(1, Math.round(f.size / 1024)) + "KB") + '</small><button type="button" class="rl-hide" data-rl-hide="' + esc(f.rel) + '" data-on="' + (hid ? 0 : 1) + '" title="' + (hid ? "다시 보이기" : "숨기기") + '">' + (hid ? "👁" : "🙈") + '</button><button type="button" class="rl-hide" data-rl-rm="' + esc(f.rel) + '" title="시스템에서 지우기(실제 파일은 그대로)">🗑</button></div>'; }).join("");
    el.innerHTML = '<div class="rn-sec rl-treesec"><div class="rn-sec-h"><b>📁 폴더</b><span class="rl-act"><input type="search" class="rl-tq" placeholder="파일 찾기" aria-label="폴더에서 파일 찾기"><button type="button" class="icon-mini" data-rl-tree="all" title="문서 모두 근거로">☑</button><button type="button" class="icon-mini" data-rl-tree="none" title="모두 빼기">☐</button><button type="button" class="icon-mini" data-rl-tree="reload" title="새로 읽기">↻</button></span></div><small class="sh-muted rl-root" title="' + esc(root) + '">' + esc(root) + " · 문서 " + docN + "개 중 근거 " + on + "개" + (hidN ? ' · <button type="button" class="sh-link" data-rl-tree="showhid">' + (opts.showHidden ? "숨긴 항목 감추기" : "숨긴 항목 " + hidN + "개 보기") + "</button>" : "") + (opts.removedN ? ' · <button type="button" class="sh-link" data-rl-tree="restore">지운 항목 ' + opts.removedN + "개 되살리기</button>" : "") + "</small>" + '<div class="rl-tree">' + draw(tree, 0, "") + "</div></div>";
    el.querySelectorAll("details[data-rl-dir]").forEach((d) => d.addEventListener("toggle", () => { open[d.dataset.rlDir] = d.open; }));
    const q = el.querySelector(".rl-tq");
    q.addEventListener("input", () => { const v = q.value.trim().toLowerCase(); el.querySelectorAll(".rl-file").forEach((r) => { const b = r.querySelector("[data-rn-src]"); r.style.display = !v || b.title.toLowerCase().indexOf(v) >= 0 ? "" : "none"; }); if (v) el.querySelectorAll("details").forEach((d) => { d.open = true; }); });
    el.onclick = (e) => { const h = e.target.closest("[data-rl-hide]"); if (h) { e.preventDefault(); e.stopPropagation(); if (opts.onHide) opts.onHide(h.dataset.rlHide, h.dataset.on === "1"); return; } const rm = e.target.closest("[data-rl-rm]"); if (rm) { e.preventDefault(); e.stopPropagation(); if (opts.onRemove) opts.onRemove(rm.dataset.rlRm); return; } if (e.target.closest('[data-rl-tree="restore"]') && opts.onRestoreAll) { e.stopPropagation(); opts.onRestoreAll(); return; } if (e.target.closest('[data-rl-tree="showhid"]') && opts.onToggleShow) { e.stopPropagation(); opts.onToggleShow(); } };
  }

  window.RNDLINK = { folderDialog: folderDialog, paintMasters: paintMasters, epicImport: epicImport, issuePanel: issuePanel, epicPanel: epicPanel, epicNote: epicNote, treePanel: treePanel, isHidden: isHidden, fileIcon: FICO, connectForm: connectForm, kb: kb };
})();
