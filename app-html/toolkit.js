(function (global) {
  "use strict";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const md = (t) => { try { return chatMarkup(String(t || "")); } catch (e) { return "<p>" + esc(t).replace(/\n/g, "<br>") + "</p>"; } };
  const uid = () => { try { const s = JSON.parse(localStorage.getItem("study.session") || "null"); return s && s.user_id; } catch (e) { return null; } };
  const store = {
    key: (k) => "study.user." + (uid() || "anon") + ".tk." + k,
    get(k, d) { try { const v = JSON.parse(localStorage.getItem(this.key(k)) || "null"); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(this.key(k), JSON.stringify(v)); } catch (e) { /* 계속 */ } },
  };
  function download(name, text, mime) {
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: (mime || "text/markdown") + ";charset=utf-8" }));
    a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }
  async function copy(text) { try { await navigator.clipboard.writeText(text); return true; } catch (e) { return false; } }
  const slug = (s) => String(s || "결과").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 60);

  /* ---------------- AI ---------------- */
  async function gate(cost) { const g = await gateAction({ action: "tools", cost: cost || 1 }); if (!g.ok) throw new Error(gateMessage(g)); }
  async function ai(o, onDelta) {   // o = {sys, user, tokens, temp}
    await gate(o.cost);
    const acc = await llmStreamChat([{ role: "system", content: o.sys || "당신은 학습·연구를 돕는 꼼꼼한 조교입니다. 한국어로, 구조적으로(제목·목록·표) 답하고 근거 없는 내용은 지어내지 마세요." }, { role: "user", content: o.user }],
      (d, full) => { if (onDelta) onDelta(full); }, { temperature: o.temp == null ? 0.3 : o.temp, maxTokens: o.tokens || 1800 });
    return String(acc || "").trim();
  }
  async function aiJSON(o) {   // o = {sys, user, shape(설명), tokens, temp}
    await gate(o.cost);
    const sys = (o.sys || "당신은 학습·연구 자료를 구조화하는 조교입니다.") + " 반드시 JSON 하나만 출력하세요(설명·코드펜스 없이). 형식: " + o.shape;
    const r = await llmGenerate({ messages: [{ role: "system", content: sys }, { role: "user", content: o.user }], temperature: o.temp == null ? 0.2 : o.temp, maxTokens: o.tokens || 2200 });
    if (!r) throw new Error("AI 응답을 해석하지 못했어요. 다시 눌러 주세요.");
    return r;
  }

  /* ---------------- 결과 그리기 ---------------- */
  function tableHtml(cols, rows) {
    return '<div class="tk-tblw"><table class="tk-tbl"><thead><tr>' + cols.map((c) => "<th>" + esc(c[1]) + "</th>").join("") + "</tr></thead><tbody>" +
      rows.map((r) => "<tr>" + cols.map((c) => "<td>" + esc(r[c[0]] == null ? "" : r[c[0]]) + "</td>").join("") + "</tr>").join("") + "</tbody></table></div>";
  }
  const tableMd = (cols, rows) => "| " + cols.map((c) => c[1]).join(" | ") + " |\n|" + cols.map(() => "---").join("|") + "|\n" + rows.map((r) => "| " + cols.map((c) => String(r[c[0]] == null ? "" : r[c[0]]).replace(/\|/g, "/").replace(/\n/g, " ")).join(" | ") + " |").join("\n");
  const tableCsv = (cols, rows) => "﻿" + [cols.map((c) => c[1])].concat(rows.map((r) => cols.map((c) => r[c[0]] == null ? "" : r[c[0]]))).map((l) => l.map((x) => '"' + String(x).replace(/"/g, '""') + '"').join(",")).join("\r\n");
  function treeHtml(n, depth) {
    depth = depth || 0;
    const kids = n.children || [];
    return '<li class="tk-node d' + Math.min(depth, 4) + '"><span class="tk-nl' + (kids.length ? " has" : "") + '">' + esc(n.title || n.name || "") + (n.note ? "<small>" + esc(n.note) + "</small>" : "") + "</span>" +
      (kids.length ? "<ul>" + kids.map((k) => treeHtml(k, depth + 1)).join("") + "</ul>" : "") + "</li>";
  }
  const treeMd = (n, d) => { d = d || 0; return "  ".repeat(d) + "- " + (n.title || n.name || "") + (n.note ? " — " + n.note : "") + "\n" + (n.children || []).map((k) => treeMd(k, d + 1)).join(""); };
  function ganttHtml(rows) {   // rows: [{name, start:"YYYY-MM", end:"YYYY-MM", owner}]
    const ym = (s) => { const m = /(\d{4})[-./](\d{1,2})/.exec(String(s || "")); return m ? (+m[1]) * 12 + (+m[2] - 1) : null; };
    const ok = rows.filter((r) => ym(r.start) != null);
    if (!ok.length) return "";
    const lo = Math.min.apply(null, ok.map((r) => ym(r.start))), hi = Math.max.apply(null, ok.map((r) => ym(r.end) != null ? ym(r.end) : ym(r.start)));
    const span = Math.max(1, hi - lo + 1), W = 760, L = 210, rowH = 26, cw = (W - L) / span;
    let svg = '<svg class="tk-gantt" viewBox="0 0 ' + W + " " + (34 + ok.length * rowH) + '" role="img" aria-label="일정 막대 그림">';
    for (let i = 0; i < span; i++) { const m = (lo + i) % 12 + 1; if (span <= 24 || m === 1 || i === 0) svg += '<text x="' + (L + i * cw + 2) + '" y="14" class="gx">' + (m === 1 || i === 0 ? Math.floor((lo + i) / 12) + "." : "") + m + "</text>"; svg += '<line x1="' + (L + i * cw) + '" y1="20" x2="' + (L + i * cw) + '" y2="' + (24 + ok.length * rowH) + '" class="gl"/>'; }
    ok.forEach((r, i) => { const s = ym(r.start), e = ym(r.end) != null ? ym(r.end) : s; const y = 26 + i * rowH;
      svg += '<text x="4" y="' + (y + 13) + '" class="gn">' + esc(String(r.name || "").slice(0, 26)) + "</text>" + '<rect x="' + (L + (s - lo) * cw + 1) + '" y="' + (y + 2) + '" width="' + Math.max(6, (e - s + 1) * cw - 2) + '" height="' + (rowH - 8) + '" rx="4" class="gb"><title>' + esc(r.name + " · " + r.start + "~" + (r.end || r.start) + (r.owner ? " · " + r.owner : "")) + "</title></rect>"; });
    return svg + "</svg>";
  }
  function diffHtml(a, b) {   // 단어 단위 LCS(길면 줄 단위)
    const tok = (s) => String(s || "").split(/(\s+)/);
    let A = tok(a), B = tok(b);
    if (A.length * B.length > 4e6) { A = String(a || "").split("\n").map((x) => x + "\n"); B = String(b || "").split("\n").map((x) => x + "\n"); }
    const n = A.length, m = B.length, dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    let i = 0, j = 0, out = "", add = 0, del = 0;
    while (i < n && j < m) { if (A[i] === B[j]) { out += esc(A[i]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) { out += "<del>" + esc(A[i]) + "</del>"; del++; i++; } else { out += "<ins>" + esc(B[j]) + "</ins>"; add++; j++; } }
    while (i < n) { out += "<del>" + esc(A[i++]) + "</del>"; del++; } while (j < m) { out += "<ins>" + esc(B[j++]) + "</ins>"; add++; }
    return { html: '<div class="tk-diff">' + out + "</div>", add: add, del: del };
  }

  /* ---------------- 뽀모도로 — (v98) 위쪽 막대 🍅 버튼 + 떠 있는 타이머(끌어 옮기기·접기, 끝 시각 기준이라 새로고침·다른 화면에서도 정확) ----------------
   *   상태 tk.pomo.state {mode, end|left, run, f, b, task, x, y, mini, open} · 끝난 집중은 tk.pomo [{t, min, task}] (계정 실시간 저장)
   * ------------------------------------------------------------------------- */
  const PS = () => Object.assign({ mode: "focus", run: false, end: 0, left: 25 * 60, f: 25, b: 5, task: "", mini: false, open: false }, store.get("pomo.state", {}));
  const psave = (s) => store.set("pomo.state", s);
  let pTick = null;
  const pLeft = (s) => Math.max(0, s.run ? Math.round((s.end - Date.now()) / 1000) : s.left);
  const mmss = (n) => Math.floor(n / 60) + ":" + String(n % 60).padStart(2, "0");
  function beep() { try { const C = new (window.AudioContext || window.webkitAudioContext)(); [0, 0.25, 0.5].forEach((d, i) => { const o = C.createOscillator(), g = C.createGain(); o.frequency.value = i === 2 ? 1046 : 784; o.connect(g); g.connect(C.destination); g.gain.setValueAtTime(0.0001, C.currentTime + d); g.gain.exponentialRampToValueAtTime(0.25, C.currentTime + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, C.currentTime + d + 0.22); o.start(C.currentTime + d); o.stop(C.currentTime + d + 0.24); }); } catch (e) { /* 계속 */ } }
  function pomoTodayN() { const d0 = new Date(); d0.setHours(0, 0, 0, 0); return store.get("pomo", []).filter((x) => x.t >= d0.getTime()).length; }
  function pomoDone(s) {
    if (s.mode === "focus") { const log = store.get("pomo", []); log.push({ t: Date.now(), min: s.f, task: s.task || "" }); store.set("pomo", log.slice(-1000)); }
    beep();
    try { if (window.Notification && Notification.permission === "granted") new Notification(s.mode === "focus" ? "🍅 집중 " + s.f + "분 끝!" : "☕ 쉬는 시간 끝!", { body: s.mode === "focus" ? s.b + "분 쉬어요." : "다시 집중해요." + (s.task ? " — " + s.task : "") }); } catch (e) { /* 계속 */ }
    s.mode = s.mode === "focus" ? "break" : "focus"; s.left = (s.mode === "focus" ? s.f : s.b) * 60; s.end = Date.now() + s.left * 1000; s.run = true; s.open = true;
    psave(s);
  }
  function pomoPaint() {
    const s = PS(); const left = pLeft(s);
    if (s.run && left <= 0) { pomoDone(s); return pomoPaint(); }
    const tot = (s.mode === "focus" ? s.f : s.b) * 60, pct = tot ? 1 - left / tot : 0;
    const btn = document.getElementById("tkPomoBtn");
    if (btn) { btn.classList.toggle("run", !!s.run); btn.classList.toggle("brk", s.mode !== "focus"); btn.querySelector(".tgl-txt").textContent = s.run || left < tot ? mmss(left) : "집중"; btn.title = (s.mode === "focus" ? "🍅 집중 타이머" : "☕ 쉬는 시간") + (s.run ? " — " + mmss(left) + " 남음" : "") + " (Alt+P)"; }
    let w = document.getElementById("tkPomo");
    if (!s.open) { if (w) w.remove(); return; }
    if (!w) {
      w = document.createElement("div"); w.id = "tkPomo"; w.className = "tk-pomo"; w.setAttribute("role", "dialog"); w.setAttribute("aria-label", "뽀모도로 타이머"); document.body.appendChild(w);
      w.addEventListener("pointerdown", (e) => {
        const h = e.target.closest(".tpm-h, .tpm-mini"); if (!h || e.target.closest("button, input")) return;
        const r = w.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top; w.setPointerCapture(e.pointerId);
        const mv = (ev) => { w.style.left = Math.max(4, Math.min(innerWidth - r.width - 4, ev.clientX - dx)) + "px"; w.style.top = Math.max(4, Math.min(innerHeight - 60, ev.clientY - dy)) + "px"; w.style.right = "auto"; };
        const up = () => { w.removeEventListener("pointermove", mv); const z = PS(); z.x = parseInt(w.style.left); z.y = parseInt(w.style.top); psave(z); };
        w.addEventListener("pointermove", mv); w.addEventListener("pointerup", up, { once: true });
      });
      w.addEventListener("click", pomoClick);
      w.addEventListener("change", (e) => {
        const z = PS();
        if (e.target.id === "tpmTask") { z.task = e.target.value.slice(0, 80); psave(z); }
        if (e.target.id === "tpmF" || e.target.id === "tpmB") { const v = Math.max(1, Math.min(180, +e.target.value || 1)); z[e.target.id === "tpmF" ? "f" : "b"] = v; if (!z.run && ((z.mode === "focus") === (e.target.id === "tpmF"))) z.left = v * 60; psave(z); pomoPaint(); }
      });
    }
    if (s.x != null) { w.style.left = Math.max(4, Math.min(innerWidth - 120, s.x)) + "px"; w.style.top = Math.max(4, Math.min(innerHeight - 60, s.y)) + "px"; w.style.right = "auto"; }
    w.classList.toggle("mini", !!s.mini); w.classList.toggle("brk", s.mode !== "focus"); w.classList.toggle("run", !!s.run);
    const R = 52, C = 2 * Math.PI * R, n = pomoTodayN();
    const html = s.mini ? '<div class="tpm-mini"><b>' + (s.mode === "focus" ? "🍅" : "☕") + " " + mmss(left) + '</b><button type="button" data-tpm="toggle" aria-label="' + (s.run ? "일시정지" : "시작") + '">' + (s.run ? "⏸" : "▶") + '</button><button type="button" data-tpm="mini" aria-label="펼치기">⤢</button></div>'
      : '<div class="tpm-h"><b>' + (s.mode === "focus" ? "🍅 집중" : "☕ 쉬는 시간") + '</b><span class="tpm-n" title="오늘 끝낸 집중">' + (n ? "오늘 " + n + "회" : "") + '</span><button type="button" data-tpm="mini" title="작게" aria-label="작게">—</button><button type="button" data-tpm="close" title="닫기(타이머는 계속 — 위쪽 🍅 에 남은 시간)" aria-label="닫기">×</button></div>' +
        '<div class="tpm-ring"><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="' + R + '" class="bg"/><circle cx="60" cy="60" r="' + R + '" class="fg" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + (C * (1 - pct)).toFixed(1) + '"/></svg><div><b class="tpm-t">' + mmss(left) + "</b><small>" + (s.run ? "진행 중" : left < tot ? "멈춤" : "준비") + "</small></div></div>" +
        '<div class="tpm-ctl"><button type="button" data-tpm="reset" title="처음부터" aria-label="처음부터">↺</button><button type="button" class="tpm-go" data-tpm="toggle">' + (s.run ? "⏸ 잠깐" : "▶ 시작") + '</button><button type="button" data-tpm="skip" title="' + (s.mode === "focus" ? "쉬기로 건너뛰기" : "집중으로 건너뛰기") + '" aria-label="건너뛰기">⏭</button></div>' +
        '<div class="tpm-pre">' + [[25, 5], [50, 10], [15, 3], [90, 15]].map((p) => '<button type="button" data-tpm-pre="' + p[0] + "|" + p[1] + '" class="' + (s.f === p[0] && s.b === p[1] ? "on" : "") + '">' + p[0] + "/" + p[1] + "</button>").join("") + '<label title="집중 분"><input id="tpmF" type="number" min="1" max="180" value="' + s.f + '">분</label><label title="쉬는 분"><input id="tpmB" type="number" min="1" max="60" value="' + s.b + '">분</label></div>' +
        '<input id="tpmTask" class="tpm-task" type="text" placeholder="지금 할 일 (선택)" value="' + esc(s.task || "") + '">' +
        '<div class="tpm-dots" aria-label="오늘 집중 ' + n + '회">' + Array.from({ length: Math.min(12, Math.max(4, n)) }, (_, i) => '<i class="' + (i < n ? "on" : "") + '"></i>').join("") + "</div>";
    if (w._h !== html) {
      const fid = document.activeElement && w.contains(document.activeElement) ? document.activeElement.id : null;
      if (fid === "tpmTask" || fid === "tpmF" || fid === "tpmB") { const t = w.querySelector(".tpm-t"); if (t) t.textContent = mmss(left); const fg = w.querySelector(".fg"); if (fg) fg.setAttribute("stroke-dashoffset", (C * (1 - pct)).toFixed(1)); return; }   // 입력 중엔 통째로 다시 그리지 않는다
      w.innerHTML = html; w._h = html;
    }
  }
  function pomoClick(e) {
    const s = PS(); const p = e.target.closest("[data-tpm-pre]");
    if (p) { const fb = p.dataset.tpmPre.split("|").map(Number); s.f = fb[0]; s.b = fb[1]; if (!s.run) s.left = (s.mode === "focus" ? s.f : s.b) * 60; psave(s); pomoPaint(); return; }
    const b = e.target.closest("[data-tpm]"); if (!b) return; const k = b.dataset.tpm;
    if (k === "toggle") {
      if (s.run) { s.left = pLeft(s); s.run = false; }
      else { if (s.left <= 0) s.left = (s.mode === "focus" ? s.f : s.b) * 60; s.end = Date.now() + s.left * 1000; s.run = true; try { if (window.Notification && Notification.permission === "default") Notification.requestPermission(); } catch (er) { /* 계속 */ } }
    }
    if (k === "reset") { s.run = false; s.left = (s.mode === "focus" ? s.f : s.b) * 60; }
    if (k === "skip") { s.mode = s.mode === "focus" ? "break" : "focus"; s.run = false; s.left = (s.mode === "focus" ? s.f : s.b) * 60; }
    if (k === "mini") s.mini = !s.mini;
    if (k === "close") s.open = false;
    psave(s); pomoPaint();
  }
  function pomo(min, mode) {   // 도구에서 바로 시작
    const s = PS(); s.mode = mode || "focus"; if (s.mode === "focus") s.f = Math.round(min || s.f || 25); else s.b = Math.round(min || s.b || 5);
    s.left = (s.mode === "focus" ? s.f : s.b) * 60; s.end = Date.now() + s.left * 1000; s.run = true; s.open = true; s.mini = false; psave(s); pomoPaint();
  }
  function pomoMount() {
    const tr = document.getElementById("topRight"); if (!tr || document.getElementById("tkPomoBtn")) return;
    const b = document.createElement("button"); b.type = "button"; b.id = "tkPomoBtn"; b.className = "bar-toggle tk-pomo-btn"; b.setAttribute("aria-label", "뽀모도로 타이머");
    b.innerHTML = '<span class="tgl-ico" aria-hidden="true">🍅</span><span class="tgl-txt">집중</span>';
    b.addEventListener("click", () => { const s = PS(); s.open = !s.open || s.mini; s.mini = false; psave(s); pomoPaint(); });
    const dk = document.getElementById("darkToggle"); tr.insertBefore(b, dk || tr.firstChild);
    clearInterval(pTick); pTick = setInterval(pomoPaint, 1000); pomoPaint();
    document.addEventListener("keydown", (e) => { if (e.altKey && !e.ctrlKey && (e.key === "p" || e.key === "P" || e.key === "ㅔ")) { e.preventDefault(); b.click(); } });
  }
  document.addEventListener("click", (e) => { const b = e.target.closest && e.target.closest("[data-tk-pomo]"); if (b) { const s = PS(); s.open = true; psave(s); pomoPaint(); } });

  function fabStack() {
    const fabs = [".ask-fab", ".tools-fab", ".xr-fab"].map((q) => document.querySelector(q)).filter(Boolean);
    fabs.forEach((x) => { x.style.removeProperty("bottom"); x.style.removeProperty("right"); });
    const vis = fabs.filter((x) => x.getClientRects().length && getComputedStyle(x).display !== "none" && getComputedStyle(x).visibility !== "hidden");   // fixed 라 offsetParent 는 늘 null
    if (vis.length < 2) return;
    const cs = getComputedStyle(vis[0]); let y = parseFloat(cs.bottom) + vis[0].offsetHeight + 8; const right = cs.right;
    vis.slice(1).forEach((x) => { x.style.setProperty("bottom", y + "px", "important"); x.style.setProperty("right", right, "important"); y += x.offsetHeight + 8; });
  }
  let fabT = null; const fabSoon = () => { clearTimeout(fabT); fabT = setTimeout(fabStack, 60); };
  function fabMount() { fabStack(); new MutationObserver(fabSoon).observe(document.body, { attributes: true, attributeFilter: ["class"], childList: true }); window.addEventListener("resize", fabSoon); setInterval(fabStack, 2500); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => { pomoMount(); fabMount(); }); else setTimeout(() => { pomoMount(); fabMount(); }, 0);

  /* ---------------- 참고문헌 ---------------- */
  const BIB = {
    apa(r) { return (r.authors || "") + " (" + (r.year || "n.d.") + "). " + (r.title || "") + ". " + (r.venue ? "<i>" + r.venue + "</i>. " : "") + (r.doi ? "https://doi.org/" + r.doi : r.url || ""); },
    ieee(r, i) { return "[" + (i + 1) + "] " + (r.authors || "") + ', "' + (r.title || "") + '," ' + (r.venue ? "<i>" + r.venue + "</i>, " : "") + (r.year || "") + "." + (r.doi ? " doi: " + r.doi : ""); },
    bibtex(r) {
      const key = (String(r.authors || "ref").split(/[ ,]/)[0] || "ref").replace(/[^A-Za-z가-힣]/g, "") + (r.year || "");
      return "@article{" + key + ",\n  title = {" + (r.title || "") + "},\n  author = {" + String(r.authors || "").replace(/, (?=[A-Z가-힣])/g, " and ") + "},\n  journal = {" + (r.venue || "") + "},\n  year = {" + (r.year || "") + "}" + (r.doi ? ",\n  doi = {" + r.doi + "}" : "") + (r.url ? ",\n  url = {" + r.url + "}" : "") + "\n}";
    },
    async doi(doi) {   // Crossref(공개 API, CORS 허용) — 입력한 DOI 만 보낸다
      doi = String(doi || "").trim().replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
      const r = await fetch("https://api.crossref.org/works/" + encodeURIComponent(doi));
      if (!r.ok) throw new Error("DOI 를 찾지 못했어요(" + r.status + ")");
      const m = (await r.json()).message || {};
      return { title: (m.title || [""])[0], authors: (m.author || []).map((a) => (a.family || "") + (a.given ? ", " + a.given.charAt(0) + "." : "")).join(", "), year: ((m.issued || {})["date-parts"] || [[""]])[0][0], venue: (m["container-title"] || [""])[0], doi: m.DOI, url: m.URL };
    },
    async search(q) {   // OpenAlex(공개 API, CORS 허용) — 검색어만 보낸다
      const r = await fetch("https://api.openalex.org/works?per-page=15&search=" + encodeURIComponent(q));
      if (!r.ok) throw new Error("검색하지 못했어요(" + r.status + ")");
      return ((await r.json()).results || []).map((w) => ({ title: w.title || w.display_name, authors: (w.authorships || []).slice(0, 6).map((a) => (a.author || {}).display_name).join(", ") + ((w.authorships || []).length > 6 ? " 외" : ""),
        year: w.publication_year, venue: ((w.primary_location || {}).source || {}).display_name || "", doi: (w.doi || "").replace("https://doi.org/", ""), url: (w.primary_location || {}).landing_page_url || w.id, cited: w.cited_by_count, oa: (w.open_access || {}).oa_url }));
    },
  };

  /* ---------------- 도구 상자 ---------------- */
  // spec = {id, title, intro, tools:[{id, group, ico, name, desc, ai, inputs:[{id,label,type,options,placeholder}], run(ctx, io, vals)}], ctx, scopes:[[값,이름]], actions:[{label, run(io)}]}
  function mount(el, spec) {
    const st = { q: "", tool: null, scope: (spec.scopes && spec.scopes[0] && spec.scopes[0][0]) || "", last: null };
    const groups = [];
    spec.tools.forEach((t) => { if (groups.indexOf(t.group) < 0) groups.push(t.group); });
    el.classList.add("tk");
    el.innerHTML = '<div class="tk-head"><div><b>' + esc(spec.title) + "</b>" + (spec.intro ? '<p class="sh-muted">' + esc(spec.intro) + "</p>" : "") + '</div><input type="search" class="tk-q" placeholder="도구 찾기 (예: 퀴즈, 표, 번역)" aria-label="도구 찾기">' +
      (spec.scopes ? '<select class="tk-scope" aria-label="범위">' + spec.scopes.map((s) => '<option value="' + s[0] + '">' + esc(s[1]) + "</option>").join("") + "</select>" : "") + "</div>" +
      '<div class="tk-grid"></div><div class="tk-run hidden"><div class="tk-run-h"><button type="button" class="ghost-btn small-btn" data-tk="back">← 도구 목록</button><b class="tk-run-t"></b></div><div class="tk-inputs"></div><div class="tk-out"></div><div class="tk-acts hidden"></div></div>';
    const grid = el.querySelector(".tk-grid"), run = el.querySelector(".tk-run"), out = el.querySelector(".tk-out"), acts = el.querySelector(".tk-acts");
    const pinKey = "pins." + spec.id;
    const pinned = () => store.get(pinKey, spec.pinsDefault || []);
    const card = (t) => { const on = pinned().indexOf(t.id) >= 0; return '<div class="tk-cw"><button type="button" class="tk-card" data-tk-tool="' + t.id + '"><span class="tk-ico">' + t.ico + "</span><span><b>" + esc(t.name) + (t.ai ? ' <i class="tk-ai">AI</i>' : "") + "</b><small>" + esc(t.desc) + '</small></span></button><button type="button" class="tk-pin' + (on ? " on" : "") + '" data-tk-pin="' + t.id + '" title="' + (on ? "고정 빼기" : "자주 쓰는 도구로 고정") + '" aria-label="' + (on ? "고정 빼기" : "고정") + '">' + (on ? "★" : "☆") + "</button></div>"; };
    function paintGrid() {
      const q = st.q.toLowerCase();
      grid.innerHTML = groups.map((g) => {
        const ts = spec.tools.filter((t) => t.group === g && (!q || (t.name + t.desc + t.group).toLowerCase().indexOf(q) >= 0));
        if (!ts.length) return "";
        return '<section class="tk-g"><h4>' + esc(g) + "</h4><div>" + ts.map(card).join("") + "</div></section>";
      }).join("") || '<p class="sh-muted">찾는 도구가 없어요.</p>';
      const pins = pinned().map((id) => spec.tools.filter((t) => t.id === id)[0]).filter(Boolean);
      if (pins.length && !q) grid.insertAdjacentHTML("afterbegin", '<section class="tk-g tk-pins"><h4>⭐ 고정한 도구 <small>카드의 ☆ 로 넣고 빼요' + (spec.pinHint ? " · " + esc(spec.pinHint) : "") + "</small></h4><div>" + pins.map(card).join("") + "</div></section>");
    }
    const io = {
      el: out,
      busy(t) { out.innerHTML = '<div class="lb-loading"><span class="lb-dots"><i></i><i></i><i></i></span>' + esc(t || "AI 가 만드는 중…") + "</div>"; acts.classList.add("hidden"); },
      error(e) { out.innerHTML = '<p class="lb-warn">' + esc(e && e.message ? e.message : e) + "</p>"; },
      html(h, mdText, title) { out.innerHTML = h; st.last = { md: mdText || out.innerText, title: title || (st.tool && st.tool.name) }; paintActs(); },
      md(t, title) { this.html('<div class="tk-md">' + md(t) + "</div>", t, title); },
      stream(full) { out.innerHTML = '<div class="tk-md">' + md(full) + "</div>"; },
      table(cols, rows, title, extra) {
        if (!rows || !rows.length) { out.innerHTML = '<p class="sh-muted">찾은 항목이 없어요.</p>'; return; }
        this.html((extra && extra.before || "") + tableHtml(cols, rows) + (extra && extra.after || ""), tableMd(cols, rows), title);
        st.last.csv = tableCsv(cols, rows);
      },
      tree(root, title) { this.html('<ul class="tk-tree">' + treeHtml(root) + "</ul>", treeMd(root), title); },
      note(t) { const p = document.createElement("p"); p.className = "sh-muted"; p.textContent = t; out.appendChild(p); },
    };
    function paintActs() {
      if (!st.last) { acts.classList.add("hidden"); return; }
      acts.classList.remove("hidden");
      acts.innerHTML = '<button type="button" class="ghost-btn small-btn" data-tk="copy">📋 복사</button><button type="button" class="ghost-btn small-btn" data-tk="save">⬇ MD 저장</button>' + (st.last.csv ? '<button type="button" class="ghost-btn small-btn" data-tk="csv">⬇ CSV(엑셀)</button>' : "") +
        (spec.actions || []).map((a, i) => '<button type="button" class="ghost-btn small-btn" data-tk-act="' + i + '">' + esc(a.label) + "</button>").join("");
    }
    async function open(t) {
      st.tool = t; st.last = null; out.onclick = null;
      grid.classList.add("hidden"); run.classList.remove("hidden");
      run.querySelector(".tk-run-t").textContent = t.ico + " " + t.name;
      const ins = run.querySelector(".tk-inputs");
      ins.innerHTML = (t.inputs || []).map((f) => '<label class="tk-in"><span>' + esc(f.label) + "</span>" + (f.type === "textarea" ? '<textarea data-tk-in="' + f.id + '" rows="' + (f.rows || 5) + '" placeholder="' + esc(f.placeholder || "") + '">' + esc(f.value || "") + "</textarea>"
        : f.type === "select" ? '<select data-tk-in="' + f.id + '">' + f.options.map((o) => '<option value="' + esc(o[0]) + '">' + esc(o[1]) + "</option>").join("") + "</select>"
        : '<input data-tk-in="' + f.id + '" type="text" value="' + esc(f.value || "") + '" placeholder="' + esc(f.placeholder || "") + '">') + "</label>").join("") +
        ((t.inputs || []).length || t.ai ? '<button type="button" class="primary big-btn" data-tk="go">' + (t.go || (t.ai ? "✨ 실행" : "실행")) + "</button>" : "");
      out.innerHTML = t.hint ? '<p class="sh-muted">' + esc(t.hint) + "</p>" : ""; acts.classList.add("hidden");
      if (!(t.inputs || []).length && !t.ai) go();
      try { if (global.SERVER && SERVER.act) SERVER.act("tool", { l: spec.id + "." + t.id }); } catch (e) { /* 계속 */ }
    }
    async function go() {
      const t = st.tool; if (!t) return;
      const vals = {}; run.querySelectorAll("[data-tk-in]").forEach((x) => { vals[x.dataset.tkIn] = x.value; });
      vals.scope = st.scope;
      const btn = run.querySelector('[data-tk="go"]'); if (btn) btn.disabled = true;
      try { await t.run(spec.ctx, io, vals); } catch (e) { io.error(e); } finally { if (btn) btn.disabled = false; }
    }
    el.addEventListener("click", async (e) => {
      const pn = e.target.closest("[data-tk-pin]"); if (pn) { const l = pinned().slice(); const i = l.indexOf(pn.dataset.tkPin); if (i >= 0) l.splice(i, 1); else l.push(pn.dataset.tkPin); store.set(pinKey, l); paintGrid(); if (spec.onPins) spec.onPins(l); return; }
      const tb = e.target.closest("[data-tk-tool]"); if (tb) { open(spec.tools.filter((t) => t.id === tb.dataset.tkTool)[0]); return; }
      const a = e.target.closest("[data-tk]"); const ac = e.target.closest("[data-tk-act]");
      if (ac) { spec.actions[+ac.dataset.tkAct].run(st.last, io); return; }
      if (!a) return;
      const k = a.dataset.tk;
      if (k === "back") { st.tool = null; run.classList.add("hidden"); grid.classList.remove("hidden"); return; }
      if (k === "go") go();
      if (k === "copy" && st.last) { a.textContent = (await copy(st.last.md)) ? "✓ 복사됨" : "복사 실패"; }
      if (k === "save" && st.last) download(slug(st.last.title) + ".md", "# " + st.last.title + "\n\n" + st.last.md);
      if (k === "csv" && st.last && st.last.csv) download(slug(st.last.title) + ".csv", st.last.csv, "text/csv");
    });
    el.querySelector(".tk-q").addEventListener("input", (e) => { st.q = e.target.value; if (st.tool) { st.tool = null; run.classList.add("hidden"); grid.classList.remove("hidden"); } paintGrid(); });
    const sc = el.querySelector(".tk-scope"); if (sc) sc.addEventListener("change", () => { st.scope = sc.value; });
    paintGrid();
    return { open: (id) => { const t = spec.tools.filter((x) => x.id === id)[0]; if (t) open(t); }, io: io, pinned: pinned };
  }

  global.TK = { esc: esc, md: md, store: store, download: download, copy: copy, ai: ai, aiJSON: aiJSON, mount: mount, pomo: pomo, BIB: BIB, fabStack: fabStack,
                pomoOpen: () => { const s = PS(); s.open = true; s.mini = false; psave(s); pomoPaint(); },
                tableHtml: tableHtml, tableMd: tableMd, treeHtml: treeHtml, ganttHtml: ganttHtml, diffHtml: diffHtml, slug: slug };
})(typeof window !== "undefined" ? window : this);
