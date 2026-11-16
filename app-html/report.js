/* =============================================================================
 * report.js (v106) — 📝 보고서 작성·보조: 이 시스템 안의 문서 편집기(워드·구글 문서식 + 보고서 특화 + AI)
 *   [아이콘 줄 | 옆 칸(문서·개요·도구·코멘트·버전·분량·찾기·서식) | A4 쪽 편집기 | ✨ AI 작성 보조 대화]
 *   - 문서 = 연구 프로젝트의 '작업 문서'(ws op=doc, 서버 버전). 서식 있는 본문은 rec.html, 호환용 sections(마크다운)도 같이 저장 → 연구지원 도구·내보내기와 그대로 이어짐
 *   - 작업본(저장 안 한 고침)은 계정 저장소 tk.rnd.report.<pid> 에 바로바로, 💾 버전 저장(Ctrl+S)·10분마다·AI 작업 전에 서버 버전
 *   - 보고서 특화: 개조식(□○-·)·제목 번호(Ⅰ.1.가./1.1)·표 캡션 <표 n>·그림 [그림 n]·요약/참고/주의/결론 상자·차례·쪽 나눔·각주·결재용 1쪽·양식 11종
 *   - 편집: 서식 막대·스타일·글자색/형광펜·정렬·목록·표(행/열 막대·표→차트)·그림(붙여넣기·끌어 놓기·크기)·수식(KaTeX)·차트·링크·/ 명령·마크다운 단축(#, -, 1., □, >)
 *   - AI: 대화로 블록을 직접 고침(<replace>·<insert>·<section>·<delete>·<title>·<search_materials>), 차례마다 되돌리기, 고른 글 AI 막대(다듬기·개조식으로·문장으로·줄이기·늘리기·표로·영어로·지시)
 *   - 도구: 보고서·글 검토 도구 20여 종을 이 문서를 대상으로 바로 실행(RND.ctx 를 이 편집기에 맞춰 잠시 바꿔 끼움)
 *   - 내보내기: Word(DOCX, 서버 tools/report_api.py)·PDF(인쇄)·HTML·Markdown
 * ========================================================================== */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const P = (k, d) => (window.TK ? TK.store.get(k, d) : d), PS = (k, v) => { if (window.TK) TK.store.set(k, v); };
  const fmtT = (t) => new Date(t).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const uid = () => Math.random().toString(36).slice(2, 9);
  function toast(t, ms) { let el = $("rpToast"); if (!el) { el = document.createElement("div"); el.id = "rpToast"; el.className = "pp-toast"; document.body.appendChild(el); } el.textContent = t; el.classList.add("on"); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("on"), ms || 2600); }
  function modal(title, html, onAct, wide) {
    const el = document.createElement("div"); el.className = "pp-modal"; el.innerHTML = '<div class="pp-mbox' + (wide ? " wide" : "") + '"><div class="pp-mh"><b>' + esc(title) + '</b><button type="button" class="pp-ib" data-mod="x" aria-label="닫기">✕</button></div><div class="pp-mb">' + html + "</div></div>";
    document.body.appendChild(el); const m = { el: el, close: () => { el.remove(); document.removeEventListener("keydown", k); } }; const k = (e) => { if (e.key === "Escape") m.close(); }; document.addEventListener("keydown", k);
    el.addEventListener("click", (e) => { if (e.target === el) return m.close(); const b = e.target.closest("[data-mod]"); if (!b) return; if (b.dataset.mod === "x") return m.close(); if (onAct) onAct(b.dataset.mod, m, b); }); return m;
  }
  function popMenu(items, x, y) {
    let el = $("rpMenu"); if (!el) { el = document.createElement("div"); el.id = "rpMenu"; el.className = "pp-menu"; document.body.appendChild(el); document.addEventListener("mousedown", (e) => { if (!e.target.closest("#rpMenu")) el.classList.remove("on"); }); }
    el.innerHTML = items.map((it, i) => (it === "-" ? "<hr>" : '<button type="button" data-mi="' + i + '"' + (it[2] ? ' class="danger"' : "") + ">" + it[0] + "</button>")).join("");
    el.classList.add("on"); el.style.left = Math.max(8, Math.min(window.innerWidth - el.offsetWidth - 8, x)) + "px"; el.style.top = Math.max(8, Math.min(window.innerHeight - el.offsetHeight - 8, y)) + "px";
    el.onmousedown = (e) => e.preventDefault();
    el.onclick = (e) => { const b = e.target.closest("[data-mi]"); if (!b) return; el.classList.remove("on"); items[+b.dataset.mi][1](); };
  }

  /* ================================================================== 상태 */
  const S = {
    pid: "", list: [], docs: [], did: null, title: "", style: {}, comments: [], ed: null, v: 0, area: null, saveT: 0, srvT: 0, srvSig: "", dirtySrv: false,
    side: P("rp.side", "out"), sideOpen: P("rp.sideOpen", true), ai: P("rp.ai", window.innerWidth >= 1400), lay: Object.assign({ side: 270, ai: 400 }, P("rp.lay", {})), zoom: P("rp.zoom", 1),
    msgs: [], turns: {}, busyAI: false, savedRange: null, view: "home", hf: "", hide: Object.assign({ app: false, rib: false, status: false, rail: false }, P("rp.hide", {})),
  };
  const DEF_STYLE = { numbering: "korean", font: "맑은 고딕", size: 11, line: 1.6, margin: 20, gaeMarks: "□○-·", pageNum: true };
  const dkey = () => "rnd.report." + S.pid;
  const url = (op, p) => RND.ws.url(op, Object.assign({ pid: S.pid }, p || {}));

  /* ================================================================== 마크다운 ↔ 블록 HTML */
  function inlineMd(t) {
    return esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<i>$2</i>").replace(/`([^`]+)`/g, "<code>$1</code>").replace(/==(.+?)==/g, "<mark>$1</mark>")
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>').replace(/\^\[([^\]]+)\]/g, (m, n) => '<span class="rp-fn" data-note="' + n + '" contenteditable="false">*</span>');
  }
  function mdToHtml(md) {
    const L = String(md || "").replace(/\r/g, "").split("\n"); let h = "", i = 0, cap = "";
    const GAE = { "□": 0, "■": 0, "○": 1, "●": 1, "-": 2, "·": 3, "ㆍ": 3, "∙": 3 };
    while (i < L.length) {
      const ln = L[i];
      if (!ln.trim()) { i++; continue; }
      let m;
      if ((m = /^(#{1,4})\s+(.*)$/.exec(ln))) { h += "<h" + m[1].length + ">" + inlineMd(m[2]) + "</h" + m[1].length + ">"; i++; continue; }
      if (/^\s*(---+|\*\*\*+)\s*$/.test(ln)) { h += "<hr>"; i++; continue; }
      if ((m = /^:::\s*(요약|참고|주의|결론|sum|note|warn|end)?\s*(.*)$/.exec(ln))) { const kind = { 요약: "sum", 참고: "note", 주의: "warn", 결론: "end" }[m[1]] || m[1] || "note"; const body = []; i++; while (i < L.length && !/^:::\s*$/.test(L[i])) body.push(L[i++]); i++; h += '<div class="rp-box" data-kind="' + kind + '">' + (m[2] ? "<p><b>" + inlineMd(m[2]) + "</b></p>" : "") + mdToHtml(body.join("\n")) + "</div>"; continue; }
      if ((m = /^\s*(?:<|\[|&lt;)?표\s*\d*(?:>|\]|&gt;)?\s*[.:]?\s*(.*)$/.exec(ln)) && i + 1 < L.length && /^\s*\|.*\|\s*$/.test(L[i + 1])) { cap = m[1].trim(); i++; continue; }   // '<표> 제목' 줄 = 바로 아래 표의 캡션
      if (/^\s*\|.*\|\s*$/.test(ln)) { const rows = []; while (i < L.length && /^\s*\|.*\|\s*$/.test(L[i])) { if (!/^\s*\|[\s:|-]+\|\s*$/.test(L[i])) rows.push(L[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim())); i++; } h += '<figure class="rp-table"><figcaption>' + esc(cap || "표 제목") + "</figcaption><table>" + rows.map((r, ri) => "<tr>" + r.map((c) => (ri ? "<td>" : "<th>") + inlineMd(c) + (ri ? "</td>" : "</th>")).join("") + "</tr>").join("") + "</table></figure>"; cap = ""; continue; }
      if (/^(\s*)([□■○●\-·ㆍ∙*])\s+/.test(ln)) {   // 개조식(□○-·) 또는 일반 점 목록(-, *) — 기호가 단계, 없으면 들여쓰기가 단계
        const raw = []; while (i < L.length && (m = /^(\s*)([□■○●\-·ㆍ∙*])\s+(.*)$/.exec(L[i]))) { raw.push([m[1].length, m[2], m[3]]); i++; }
        const useGae = raw.some((x) => /[□■○●·ㆍ∙]/.test(x[1]));
        h += nest(raw.map((x) => [useGae && GAE[x[1]] != null ? Math.max(GAE[x[1]], Math.floor(x[0] / 2)) : Math.floor(x[0] / 2), x[2]]), useGae); continue;
      }
      if (/^\s*\d+[.)]\s+/.test(ln)) { h += "<ol>"; while (i < L.length && (m = /^\s*\d+[.)]\s+(.*)$/.exec(L[i]))) { h += "<li>" + inlineMd(m[1]) + "</li>"; i++; } h += "</ol>"; continue; }
      if (/^\s*\[( |x)\]\s+/i.test(ln)) { h += '<ul class="rp-check">'; while (i < L.length && (m = /^\s*\[( |x)\]\s+(.*)$/i.exec(L[i]))) { h += '<li data-check="' + (m[1].trim() ? 1 : 0) + '">' + inlineMd(m[2]) + "</li>"; i++; } h += "</ul>"; continue; }
      if (/^>\s?/.test(ln)) { const q = []; while (i < L.length && /^>\s?/.test(L[i])) q.push(L[i++].replace(/^>\s?/, "")); h += "<blockquote>" + inlineMd(q.join(" ")) + "</blockquote>"; continue; }
      const p = []; while (i < L.length && L[i].trim() && !/^(#{1,4}\s|\s*\||\s*[□■○●·]\s|\s*-\s|\s*\*\s|\s*\d+[.)]\s|>|:::|---)/.test(L[i])) p.push(L[i++]); if (!p.length) { p.push(L[i++]); } h += "<p>" + inlineMd(p.join(" ")) + "</p>";
    }
    return h;
    function nest(items, gae) {   // [[단계, 글]] → 중첩 목록(단계는 한 번에 한 칸씩만 깊어진다)
      const open = gae ? '<ul class="rp-gae">' : "<ul>"; let out = "", depth = -1;
      items.forEach(([lv, text]) => {
        lv = Math.max(0, Math.min(lv, depth + 1));
        if (lv > depth) { out += open; depth = lv; } else { out += "</li>"; while (depth > lv) { out += "</ul></li>"; depth--; } }
        out += "<li>" + inlineMd(text);
      });
      if (depth >= 0) { out += "</li>"; while (depth > 0) { out += "</ul></li>"; depth--; } out += "</ul>"; }
      return out;
    }
  }
  function inlineToMd(n) {
    let t = "";
    n.childNodes.forEach((c) => {
      if (c.nodeType === 3) { t += c.textContent; return; } if (c.nodeType !== 1) return;
      const tg = c.tagName.toLowerCase(), inner = inlineToMd(c);
      if (c.classList.contains("rp-fn")) t += "^[" + (c.dataset.note || "") + "]";
      else if (c.classList.contains("rp-math")) t += "$" + (c.dataset.tex || "") + "$";
      else if (tg === "b" || tg === "strong") t += "**" + inner + "**"; else if (tg === "i" || tg === "em") t += "*" + inner + "*"; else if (tg === "code") t += "`" + inner + "`"; else if (tg === "mark") t += "==" + inner + "==";
      else if (tg === "a") t += "[" + inner + "](" + (c.getAttribute("href") || "") + ")"; else if (tg === "br") t += " "; else if (tg === "img") t += "[그림]"; else t += inner;
    });
    return t;
  }
  function blockToMd(b) {
    const tg = b.tagName.toLowerCase(), cl = b.classList;
    if (/^h[1-4]$/.test(tg)) return "#".repeat(+tg[1]) + " " + inlineToMd(b).trim();
    if (tg === "p" || tg === "div" && !b.className) return inlineToMd(b).trim();
    if (tg === "ul" || tg === "ol") return listToMd(b, 0);
    if (tg === "blockquote") return "> " + inlineToMd(b).trim();
    if (tg === "hr") return "---";
    if (cl.contains("rp-pb")) return "(쪽 나눔)"; if (cl.contains("rp-toc")) return "(차례)";
    if (cl.contains("rp-box")) { const kind = { sum: "요약", note: "참고", warn: "주의", end: "결론" }[b.dataset.kind] || "참고"; return "::: " + kind + "\n" + Array.from(b.children).map(blockToMd).join("\n") + "\n:::"; }
    if (tg === "figure" && b.querySelector("table")) { const cap = b.querySelector("figcaption"); const rows = Array.from(b.querySelectorAll("tr")).map((tr) => "| " + Array.from(tr.children).map((c) => inlineToMd(c).trim().replace(/\|/g, "/")).join(" | ") + " |"); if (rows.length) rows.splice(1, 0, "| " + Array.from(b.querySelector("tr").children).map(() => "---").join(" | ") + " |"); return "<표> " + (cap ? cap.textContent.trim() : "") + "\n" + rows.join("\n"); }
    if (tg === "figure") { const cap = b.querySelector("figcaption"); return "[그림] " + (cap ? cap.textContent.trim() : "") + (b.classList.contains("rp-chart") ? " (차트)" : ""); }
    if (tg === "table") return Array.from(b.querySelectorAll("tr")).map((tr) => "| " + Array.from(tr.children).map((c) => inlineToMd(c).trim()).join(" | ") + " |").join("\n");
    return inlineToMd(b).trim();
  }
  function listToMd(l, d) {
    const gae = l.classList.contains("rp-gae"), ol = l.tagName === "OL", chk = l.classList.contains("rp-check"), marks = (S.style.gaeMarks || "□○-·").split("");
    return Array.from(l.children).filter((x) => x.tagName === "LI").map((li, i) => { const sub = Array.from(li.children).filter((x) => x.tagName === "UL" || x.tagName === "OL"); const c = li.cloneNode(true); c.querySelectorAll("ul,ol").forEach((x) => x.remove()); const mk = chk ? "[" + (li.dataset.check === "1" ? "x" : " ") + "]" : ol ? (i + 1) + "." : gae ? marks[Math.min(d, 3)] : "-"; return "  ".repeat(d) + mk + " " + inlineToMd(c).trim() + (sub.length ? "\n" + sub.map((s) => listToMd(s, d + 1)).join("\n") : ""); }).join("\n");
  }
  function htmlToSections(root) {
    const out = []; let cur = { h: "", body: [] };
    Array.from(root.children).forEach((b) => { if (/^H[12]$/.test(b.tagName)) { if (cur.h || cur.body.length) out.push(cur); cur = { h: b.textContent.trim(), body: [] }; } else cur.body.push(blockToMd(b)); });
    if (cur.h || cur.body.length) out.push(cur);
    return out.map((s) => ({ h: s.h || "머리말", body: s.body.filter(Boolean).join("\n\n") })).slice(0, 80);
  }
  function sectionsToHtml(secs) { return (secs || []).map((s) => (s.h ? "<h1>" + esc(s.h) + "</h1>" : "") + mdToHtml(s.body || "")).join("") || "<p></p>"; }
  function docMd() { if (!S.ed) return ""; ensureIds(); return Array.from(S.ed.children).map(blockToMd).filter(Boolean).join("\n\n"); }
  function ensureIds() { if (!S.ed) return; const seen = {}; Array.from(S.ed.children).forEach((b) => { let id = b.dataset.b; if (!id || seen[id]) { id = "b" + uid(); b.dataset.b = id; } seen[id] = 1; }); }
  function sanitize(html) {
    const t = document.createElement("template"); t.innerHTML = html;
    t.content.querySelectorAll("script,style,iframe,object,embed,link,meta,form,input,button,textarea,select").forEach((x) => x.remove());
    t.content.querySelectorAll("*").forEach((el) => { Array.from(el.attributes).forEach((a) => { const n = a.name.toLowerCase(); if (n.startsWith("on") || (n === "href" || n === "src") && /^\s*javascript:/i.test(a.value) || n === "contenteditable" && !el.classList.contains("rp-fn") && !el.classList.contains("rp-math") && !el.classList.contains("rp-chart") || n === "class" && /^(Mso|xl)/.test(a.value)) el.removeAttribute(a.name); }); if (el.tagName === "IMG" && !/^data:image\//.test(el.getAttribute("src") || "") && !/^https?:/.test(el.getAttribute("src") || "")) el.remove(); });
    return t.innerHTML;
  }

  /* ================================================================== 진입 */
  async function paintReport(area) {
    S.area = area;
    try { S.list = (await RND.ws.req("projects")).list || []; } catch (e) { area.innerHTML = '<div class="sv"><p class="lb-warn">' + esc(e.message) + '</p><button type="button" class="ghost-btn small-btn" id="rpRetry">다시 시도</button></div>'; $("rpRetry").onclick = () => paintReport(area); return; }
    if (!S.list.length) { area.innerHTML = '<div class="sv hub"><div class="hub-head"><div><h2>보고서 작성·보조</h2></div></div><p class="sh-muted">연구 프로젝트를 먼저 만드세요 — 보고서는 프로젝트의 작업 문서로 저장돼요.</p></div>'; return; }
    if ($("rp2") && area.contains($("rp2")) && S.did) { grid(); fitSoon(); patchCtx(true); applyHide(); return; }   // 문서를 연 채 다른 메뉴에 다녀오면 그대로
    let pid = P("hub.rnd", "") || (RND.cur && RND.cur()) || S.list[0].id; if (!S.list.some((p) => p.id === pid)) pid = S.list[0].id;
    if (S.pid !== pid) { S.pid = pid; S.hf = ""; }
    await paintHome(area);
  }
  async function loadDocs() { try { S.docs = (await RND.ws.req("docs", { pid: S.pid })).list || []; } catch (e) { S.docs = []; } }
  function projSelect(id) { return '<select id="' + id + '" class="pp-proj" aria-label="연구 프로젝트">' + S.list.map((p) => '<option value="' + esc(p.id) + '"' + (p.id === S.pid ? " selected" : "") + ">" + esc(p.name) + "</option>").join("") + "</select>"; }
  function mini(html) { const d = document.createElement("div"); d.innerHTML = html; d.querySelectorAll(".rp-toc,.rp-pb").forEach((x) => x.remove()); while (d.children.length > 7) d.lastElementChild.remove(); return d.innerHTML; }   // 글자 수로 자르면 태그가 깨져 카드가 무너진다
  function tplGallery(box, pick) {
    let cat = "전체"; const cats = ["전체"].concat(REPORTTPL.cats);
    const draw = () => { const l = REPORTTPL.list.filter((t) => cat === "전체" || t.cat === cat); box.innerHTML = '<div class="pp-gal-tabs">' + cats.map((c) => '<button type="button" class="' + (c === cat ? "on" : "") + '" data-gc="' + esc(c) + '">' + esc(c) + "</button>").join("") + '<span class="sh-muted">보고서 양식 ' + REPORTTPL.list.length + "종</span></div>" + '<div class="pp-gal">' + l.map((t) => '<button type="button" class="pp-tpl rp-tpl" data-gt="' + t.id + '"><span class="pp-tpl-img rp-tpl-img"><span class="rp-mini">' + mini(t.html) + "</span><i>" + t.ico + '</i></span><span class="pp-tpl-b"><b>' + esc(t.name) + "</b><small>" + esc(t.desc) + "</small></span></button>").join("") + "</div>"; };
    draw(); box.onclick = (e) => { const c = e.target.closest("[data-gc]"); if (c) { cat = c.dataset.gc; draw(); return; } const t = e.target.closest("[data-gt]"); if (t) pick(REPORTTPL.list.find((x) => x.id === t.dataset.gt)); };
  }
  /* ================================================================== 📂 문서함 — 프로젝트 → 폴더 → 문서 */
  const KIND = { report: "보고서", free: "일반", proposal: "계획서", paper: "논문", summary: "요약" };
  const dget = () => { const d = P(dkey(), {}) || {}; d.folders = d.folders || []; d.of = d.of || {}; d.drafts = d.drafts || {}; return d; };
  function askText(title, label, val, ok) {
    return new Promise((res) => {
      let done = false; const fin = (v) => { if (done) return; done = true; res(v); };
      const m = modal(title, '<label class="rh-ask">' + esc(label) + '<input id="rhAsk" value="' + esc(val || "") + '"></label><div class="lb-row"><button type="button" class="primary small-btn" data-mod="ok">' + esc(ok || "확인") + '</button><button type="button" class="ghost-btn small-btn" data-mod="no">취소</button></div>', (k, mm) => { const v = k === "ok" ? m.el.querySelector("#rhAsk").value.trim() : null; fin(v); mm.close(); });
      const i = m.el.querySelector("#rhAsk"); i.focus(); i.select(); i.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); fin(i.value.trim()); m.close(); } if (e.key === "Escape") fin(null); });
      new MutationObserver((a, ob) => { if (!m.el.isConnected) { fin(null); ob.disconnect(); } }).observe(document.body, { childList: true });
    });
  }
  async function paintHome(area) {
    S.view = "home"; S.did = null; S.ed = null; hideBars(); setZen(false); patchCtx(false); area.onclick = homeClick;
    await loadDocs();
    let files = []; try { files = (await RND.ws.req("files", { pid: S.pid })).list || []; } catch (e) { files = []; }
    let trash = []; try { trash = (await RND.ws.req("doctrash", { pid: S.pid })).list || []; } catch (e) { trash = []; }
    const d = dget(); const proj = S.list.find((x) => x.id === S.pid) || {}; const q = (S.hq || "").toLowerCase(); const sort = S.hsort || "new";
    const folders = d.folders, cnt = {}; S.docs.forEach((x) => { const f = d.of[x.id] || ""; cnt[f] = (cnt[f] || 0) + 1; });
    let rows = S.docs.filter((x) => (S.hf === "__trash" ? false : !S.hf || (d.of[x.id] || "") === S.hf) && (!q || String(x.title).toLowerCase().indexOf(q) >= 0));
    rows.sort((a, b) => (sort === "name" ? String(a.title).localeCompare(String(b.title), "ko") : sort === "ver" ? (b.v || 0) - (a.v || 0) : (b.saved || 0) - (a.saved || 0)));
    const pq = (S.hpq || "").toLowerCase(); const projs = S.list.filter((x) => !pq || String(x.name).toLowerCase().indexOf(pq) >= 0);
    const hdr = S.hf === "__trash" ? "🗑 휴지통" : S.hf ? "📁 " + S.hf : "모든 문서";
    area.innerHTML = '<div class="sv rh" id="rh"><div class="rh-head"><div><h2>📝 보고서 작성·보조</h2><p class="sh-muted">문서를 고르거나 새로 만들어 들어가요. 문서는 프로젝트 폴더에 버전과 함께 저장돼요.</p></div><div class="rh-acts"><button type="button" class="primary" data-rh="new">＋ 새 문서</button><button type="button" class="ghost-btn" data-rh="imp" title="Word(.docx)·Markdown·글·HTML 파일을 문서로">⬆ 불러오기</button></div></div>' +
      '<div class="rh-body"><aside class="rh-side"><h4>프로젝트 <small>' + S.list.length + '</small></h4><input id="rhPq" type="search" placeholder="프로젝트 찾기" value="' + esc(S.hpq || "") + '"><div class="rh-projs">' + projs.map((p) => '<button type="button" class="' + (p.id === S.pid ? "on" : "") + '" data-rh-p="' + esc(p.id) + '" title="' + esc(p.name) + '"><span>' + esc(p.name) + "</span><small>" + (((p.counts || {}).docs) || 0) + "</small></button>").join("") + "</div>" +
        '<h4>폴더 <button type="button" class="pp-ib" data-rh="newf" title="새 폴더">＋</button></h4><div class="rh-fold"><button type="button" class="' + (!S.hf ? "on" : "") + '" data-rh-f=""><span>📄 모든 문서</span><small>' + S.docs.length + "</small></button>" + folders.map((f) => '<button type="button" class="' + (S.hf === f ? "on" : "") + '" data-rh-f="' + esc(f) + '"><span>📁 ' + esc(f) + "</span><small>" + (cnt[f] || 0) + "</small></button>").join("") + '<button type="button" class="' + (S.hf === "__trash" ? "on" : "") + '" data-rh-f="__trash"><span>🗑 휴지통</span><small>' + trash.length + "</small></button></div></aside>" +
      '<main class="rh-main"><div class="rh-bar"><div class="rh-crumb"><b>' + esc(proj.name || "") + "</b> › " + esc(hdr) + '</div><input id="rhQ" type="search" placeholder="문서 찾기" value="' + esc(S.hq || "") + '"><select id="rhSort" aria-label="정렬"><option value="new">최근 수정순</option><option value="name">이름순</option><option value="ver">버전 많은 순</option></select></div>' +
      (S.hf === "__trash" ? (trash.length ? '<table class="rh-tbl"><thead><tr><th>문서</th><th>버전</th><th>지운 때</th><th></th></tr></thead><tbody>' + trash.map((t) => "<tr><td><b>" + esc(t.title) + "</b></td><td>v" + t.v + "</td><td>" + fmtT(t.trashed) + '</td><td><button type="button" class="ghost-btn small-btn" data-rh-res="' + esc(t.tid) + '">되살리기</button></td></tr>').join("") + "</tbody></table>" : '<div class="ll-empty"><span>🗑</span><b>휴지통이 비어 있어요</b></div>')
        : rows.length ? '<table class="rh-tbl"><thead><tr><th>제목</th><th>종류</th><th>폴더</th><th>버전</th><th>절</th><th>최근 수정</th><th></th></tr></thead><tbody>' + rows.map((x) => '<tr data-rh-o="' + esc(x.id) + '"><td class="t"><i>' + (x.kind === "report" ? "📝" : "📄") + "</i><b>" + esc(x.title) + "</b>" + (d.drafts[x.id] ? '<em title="작업본에만 있는 고침이 있어요">● 저장 안 한 고침</em>' : "") + (d.cur === x.id ? '<em class="c">최근</em>' : "") + "</td><td>" + esc(KIND[x.kind] || x.kind || "") + "</td><td>" + esc(d.of[x.id] || "-") + "</td><td>v" + (x.v || 1) + "</td><td>" + (x.sections || 0) + "</td><td>" + fmtT(x.saved) + '</td><td class="m"><button type="button" class="pp-ib" data-rh-m="' + esc(x.id) + '" aria-label="메뉴">⋯</button></td></tr>').join("") + "</tbody></table>"
        : S.docs.length ? '<div class="ll-empty"><span>🔎</span><b>맞는 문서가 없어요</b></div>' : '<div class="rh-startt"><b>아직 문서가 없어요 — 양식에서 시작하세요</b></div><div id="rhGal"></div>') +
      (files.length && S.hf !== "__trash" ? '<details class="rh-files"><summary>📎 프로젝트 자료 ' + files.length + '개 <small>자료를 근거로 보고서 초안을 시작할 수 있어요</small></summary><div class="rh-fl">' + files.slice(0, 60).map((f) => '<div><span title="' + esc(f.rel || f.name) + '">' + esc((f.rel || f.name || "").split("/").pop()) + '</span><button type="button" class="ghost-btn small-btn" data-rh-draft="' + esc((f.rel || f.name || "").split("/").pop()) + '">✨ 이 자료로 초안</button></div>').join("") + "</div></details>" : "") +
      '</main></div><input type="file" id="rhImp" accept=".docx,.md,.txt,.html,.htm" hidden></div>';
    if ($("rhGal")) tplGallery($("rhGal"), (t) => newDocDialog(t));
    $("rhSort").value = sort;
    const tb = area.querySelector(".rh-tbl");
    if (tb && S.hf !== "__trash" && window.SLCLV && SLCLV.on()) {   // (v126) 문서함을 공통 목록으로
      const box = document.createElement("div"); tb.replaceWith(box);
      SLCLV.mount(box, { key: "report.docs", name: "문서", titleLabel: "제목", placeholder: "문서 찾기", rows: rows.slice(), title: (x) => x.title, sub: (x) => (d.drafts[x.id] ? "저장 안 한 고침 있음" : ""),
        columns: [{ k: "kind", label: "종류", get: (x) => (x.kind === "report" ? "보고서" : "문서") }, { k: "folder", label: "폴더", get: (x) => d.of[x.id] || "" }, { k: "v", label: "버전", get: (x) => x.v || 1, cls: "n" }, { k: "sections", label: "절", get: (x) => x.sections || 0, cls: "n" }, { k: "saved", label: "최근 수정", get: (x) => SLCLV.day(x.saved) }],
        groups: [{ k: "folder", label: "폴더", path: (x) => [d.of[x.id] || "폴더 없음"] }, { k: "kind", label: "종류", path: (x) => [x.kind === "report" ? "보고서" : "문서"] }, { k: "month", label: "수정한 달", path: (x) => [SLCLV.day(x.saved).slice(0, 7)] }],
        action: (x) => '<button type="button" class="pp-ib" data-rh-m="' + esc(x.id) + '" aria-label="메뉴">⋯</button>',
        open: (x) => openFromHome(x.id) });
    }
    const refocus = (id) => { const x = $(id); if (x) { x.focus(); x.setSelectionRange(x.value.length, x.value.length); } };
    $("rhSort").addEventListener("change", (e) => { S.hsort = e.target.value; paintHome(area); });
    $("rhQ").addEventListener("input", (e) => { S.hq = e.target.value; clearTimeout(S._hq); S._hq = setTimeout(() => paintHome(area).then(() => refocus("rhQ")), 220); });
    $("rhPq").addEventListener("input", (e) => { S.hpq = e.target.value; clearTimeout(S._hq); S._hq = setTimeout(() => paintHome(area).then(() => refocus("rhPq")), 220); });
    $("rhImp").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) importFile(f); });
  }
  async function homeClick(e) {
    const t = e.target; let b;
    if ((b = t.closest("[data-rh-p]"))) { S.pid = b.dataset.rhP; PS("hub.rnd", S.pid); S.hf = ""; paintHome(S.area); return; }
    if ((b = t.closest("[data-rh-f]"))) { S.hf = b.dataset.rhF; paintHome(S.area); return; }
    if ((b = t.closest("[data-rh-res]"))) { try { await RND.ws.req("docrestore", { pid: S.pid, tid: b.dataset.rhRes }, {}); toast("되살렸어요"); paintHome(S.area); } catch (er) { toast(er.message); } return; }
    if ((b = t.closest("[data-rh-m]"))) { e.stopPropagation(); const r = b.getBoundingClientRect(); docMenu(b.dataset.rhM, r.left - 180, r.bottom + 4); return; }
    if ((b = t.closest("[data-rh-draft]"))) { draftFrom(b.dataset.rhDraft); return; }
    if ((b = t.closest("[data-rh-o]"))) { openFromHome(b.dataset.rhO); return; }
    if ((b = t.closest("[data-rh]"))) {
      const k = b.dataset.rh;
      if (k === "new") newDocDialog();
      if (k === "imp") $("rhImp").click();
      if (k === "newf") { const n = await askText("새 폴더", "폴더 이름 (예: 제출본, 초안, 2026 중간평가)", "", "만들기"); if (!n) return; const d = dget(); if (d.folders.indexOf(n) < 0) d.folders.push(n); PS(dkey(), d); S.hf = n; paintHome(S.area); }
    }
  }
  async function openFromHome(did) { await paintWs(S.area); await openDoc(did); }
  function docMenu(id, x, y) {
    popMenu([["열기", () => openFromHome(id)], ["✎ 이름 바꾸기", () => renameDoc(id)], ["⧉ 사본 만들기", () => copyDoc(id)], ["📁 폴더로 옮기기", () => moveDoc(id, x, y)], ["📍 저장 위치 보기", () => whereDoc(id)], "-", ["🗑 휴지통으로", () => trashDoc(id), true]], x, y);
  }
  const docRec = async (id) => (await RND.ws.req("doc", { pid: S.pid, did: id })).doc;
  async function renameDoc(id) {
    const cur = id === S.did ? S.title : (S.docs.find((x) => x.id === id) || {}).title; const n = await askText("이름 바꾸기", "문서 제목", cur, "바꾸기"); if (!n || n === cur) return;
    if (id === S.did) { S.title = n; $("rpTitle").value = n; $("rpDT").textContent = n; crumb(); await saveVersion("이름 바꿈"); return; }
    try { const r = await docRec(id); await RND.ws.req("doc", { pid: S.pid, did: id }, Object.assign({}, r, { title: n, note: "이름 바꿈" })); const d = dget(); if (d.drafts[id]) { d.drafts[id].title = n; PS(dkey(), d); } paintHome(S.area); } catch (e) { toast(e.message, 5000); }
  }
  async function copyDoc(id) {
    try {
      if (id === S.did) await saveVersion("사본 만들기 전", true);
      const r = await docRec(id); const n = await RND.ws.req("doc", { pid: S.pid }, Object.assign({}, r, { title: r.title + " 사본", note: "사본: v" + r.v })); const d = dget(); if (d.of[id]) d.of[n.doc.id] = d.of[id]; PS(dkey(), d); toast("사본을 만들었어요: " + r.title + " 사본");
      if (S.view === "home") paintHome(S.area); else await loadDocs();
    } catch (e) { toast(e.message, 5000); }
  }
  function moveDoc(id, x, y) {
    const d = dget();
    const set = (f) => { const dd = dget(); if (f) dd.of[id] = f; else delete dd.of[id]; PS(dkey(), dd); toast(f ? "📁 " + f + " 로 옮겼어요" : "폴더에서 뺐어요"); if (S.view === "home") paintHome(S.area); else crumb(); };
    popMenu([["(폴더 없음)", () => set("")]].concat(d.folders.map((f) => ["📁 " + f, () => set(f)])).concat(["-", ["＋ 새 폴더…", async () => { const n = await askText("새 폴더", "폴더 이름", "", "만들기"); if (!n) return; const dd = dget(); if (dd.folders.indexOf(n) < 0) dd.folders.push(n); PS(dkey(), dd); set(n); }]]), x, y);
  }
  async function whereDoc(id) {
    let r = {}; try { r = await RND.ws.req("docpath", { pid: S.pid, did: id }); } catch (e) { r = {}; } const proj = S.list.find((x) => x.id === S.pid) || {}; const d = dget(); const row = S.docs.find((x) => x.id === id) || {};
    const rows = [["프로젝트", proj.name], ["앱 안 폴더", d.of[id] || "(폴더 없음)"], ["버전", "v" + (id === S.did ? S.v : row.v || 1) + " — 버전마다 파일 하나(v0001.json…)"], ["서버 저장 위치", r.abs || r.rel || "-"], ["내보낸 파일", r.out || "프로젝트의 out 폴더"], ["작업본", "계정 저장소 projects/_report 항목 — 버전 저장 전 고침이 바로바로 저장돼요"]];
    modal("📍 저장 위치", '<dl class="rh-where">' + rows.map((x) => "<dt>" + esc(x[0]) + "</dt><dd>" + esc(x[1] || "-") + "</dd>").join("") + "</dl>" + (r.abs ? '<div class="lb-row"><button type="button" class="ghost-btn small-btn" data-mod="cp">경로 복사</button></div>' : ""), (k) => { if (k === "cp") { try { navigator.clipboard.writeText(r.abs); toast("경로를 복사했어요"); } catch (e) { /* 계속 */ } } });
  }
  async function trashDoc(id) {
    const row = S.docs.find((x) => x.id === id) || {}; if (!confirm("'" + (id === S.did ? S.title : row.title) + "' 을 휴지통으로 옮길까요? (문서함의 휴지통에서 되살릴 수 있어요)")) return;
    try { await RND.ws.req("docrm", { pid: S.pid, did: id }, {}); const d = dget(); delete d.drafts[id]; if (d.cur === id) delete d.cur; PS(dkey(), d); clearTimeout(S.saveT); clearTimeout(S.srvT); toast("휴지통으로 옮겼어요"); if (id === S.did) S.did = null; paintHome(S.area); } catch (e) { toast(e.message, 5000); }
  }
  async function createDoc(title, html, style, note, folder) {
    const tmp = document.createElement("div"); tmp.innerHTML = html;
    const r = await RND.ws.req("doc", { pid: S.pid }, { title: title, kind: "report", sections: htmlToSections(tmp), html: tmp.innerHTML, style: Object.assign({}, DEF_STYLE, style || {}), comments: [], note: note || "" });
    if (folder) { const d = dget(); d.of[r.doc.id] = folder; PS(dkey(), d); }
    await loadDocs(); await openFromHome(r.doc.id); return r.doc;
  }
  function newDocDialog(pre) {
    const d = dget(); let tpl = pre || REPORTTPL.list.find((t) => t.id === "blank");
    const m = modal("새 문서", '<div class="rh-new"><label>제목<input id="rhNt" value="' + esc(pre ? pre.name : "") + '" placeholder="문서 제목"></label><label>폴더<select id="rhNf"><option value="">(폴더 없음)</option>' + d.folders.map((f) => '<option value="' + esc(f) + '"' + (f === S.hf ? " selected" : "") + ">" + esc(f) + "</option>").join("") + '</select></label><label>저장될 프로젝트<input value="' + esc((S.list.find((x) => x.id === S.pid) || {}).name || "") + '" disabled></label><button type="button" class="primary" data-mod="mk">만들기</button></div><p class="sh-muted" id="rhNp">양식: ' + esc(tpl.name) + '</p><div id="rhNg"></div>', async (k, mm) => {
      if (k !== "mk") return; const title = m.el.querySelector("#rhNt").value.trim() || tpl.name; const folder = m.el.querySelector("#rhNf").value; mm.close();
      const tmp = document.createElement("div"); tmp.innerHTML = tpl.html; if (tmp.firstElementChild && tmp.firstElementChild.tagName === "H1") tmp.firstElementChild.remove();   // 양식 첫 제목 = 문서 제목 줄로
      try { await createDoc(title, tmp.innerHTML || "<p><br></p>", tpl.style, "양식: " + tpl.name, folder); toast("“" + title + "” 를 만들었어요"); } catch (e) { toast("만들지 못했어요: " + e.message, 5000); }
    }, true);
    tplGallery(m.el.querySelector("#rhNg"), (t) => { tpl = t; m.el.querySelector("#rhNp").textContent = "양식: " + t.name; const i = m.el.querySelector("#rhNt"); if (!i.value.trim() || REPORTTPL.list.some((x) => x.name === i.value)) i.value = t.id === "blank" ? "" : t.name; m.el.querySelectorAll("[data-gt]").forEach((x) => x.classList.toggle("on", x.dataset.gt === t.id)); i.focus(); });
    setTimeout(() => { const i = m.el.querySelector("#rhNt"); if (i) i.focus(); }, 30);
  }
  async function importFile(f) {
    const name = f.name.replace(/\.[^.]+$/, ""), ext = (/\.([^.]+)$/.exec(f.name) || [0, ""])[1].toLowerCase(); toast("불러오는 중…", 5000);
    try {
      let html = "", title = name;
      if (ext === "docx") { const r = await RND.ws.req("rimport", { pid: S.pid, mid: "w" }, f, { raw: true }); html = r.html; title = r.title || name; }
      else if (ext === "html" || ext === "htm") html = sanitize(await f.text());
      else html = mdToHtml(await f.text());
      await createDoc(title, html, {}, "불러옴: " + f.name, S.hf && S.hf !== "__trash" ? S.hf : ""); toast("“" + title + "” 로 불러왔어요");
    } catch (e) { toast("불러오지 못했어요: " + e.message, 6000); }
  }
  async function draftFrom(name) {
    try { await createDoc(name.replace(/\.[^.]+$/, "") + " 정리", "<p><br></p>", {}, "자료로 시작: " + name, S.hf && S.hf !== "__trash" ? S.hf : ""); setTimeout(() => aiSend("프로젝트 자료 '" + name + "' 의 내용을 search_materials 로 찾아 보고서 초안을 써 줘. 요약 상자 → 개요 → 주요 내용(개조식·표) → 시사점 순서로, 자료에 있는 사실만."), 300); } catch (e) { toast(e.message, 5000); }
  }
  async function closeDoc() {
    if (!S.did) return paintHome(S.area); clearTimeout(S.saveT); saveDraft(); if (S.dirtySrv) await saveVersion("닫을 때 저장", true);
    clearTimeout(S.srvT); await paintHome(S.area);
  }
  function crumb() { const el = $("rpCrumb"); if (!el) return; const d = dget(); const p = S.list.find((x) => x.id === S.pid) || {}; const f = d.of[S.did] || ""; el.textContent = (p.name || "") + (f ? " › " + f : ""); el.title = "저장 위치: " + (p.name || "") + (f ? " › " + f : ""); }
  function fileMenu(x, y) {
    popMenu([["＋ 새 문서…", () => newDocDialog()], ["📂 문서함 (다른 문서 열기)", closeDoc], "-", ["제출 전 점검 (AI 작업)", async () => { await saveVersion("점검 전 저장", true); try { const j = await AITASK.start("precheck", S.pid, S.did); AITASK.open(j.id); } catch (e) { toast(e.message, 4000); } }], ["💾 버전 저장  Ctrl+S", async () => { const n = await askText("버전 저장", "버전 이름(비워도 돼요 — 예: 1차 초안, 팀장 검토본)", "", "저장"); if (n != null) saveVersion(n); }], ["✎ 이름 바꾸기", () => renameDoc(S.did)], ["⧉ 사본 만들기", () => copyDoc(S.did)], ["📁 폴더로 옮기기", () => moveDoc(S.did, x, y)], ["📍 저장 위치 보기", () => whereDoc(S.did)], "-", ["⬇ 내보내기…", () => expMenu(x, y)], ["🏛 연구행정에 산출물 등록", () => { if (window.PINFO) PINFO.registerOutput({ pid: S.pid, type: "보고서", title: S.title, docId: S.did, tab: "report" }); }], ["✕ 문서 닫기", closeDoc], ["🗑 휴지통으로", () => trashDoc(S.did), true]], x, y);
  }
  /* ---- UI 가리기(전체 화면과 별개) — 앱 메뉴·위 막대·서식 막대·옆 칸·상태 줄을 골라 가린다 ---- */
  function applyHide() {
    const h = S.hide, root = $("rp2"); document.body.classList.toggle("pp-zen", !!h.app && !!root);
    if (root) { root.classList.toggle("rp-norib", !!h.rib); root.classList.toggle("rp-nostat", !!h.status); root.classList.toggle("rp-norail", !!h.rail); }
    const b = document.querySelector('#rp2 [data-rp="zen"]'); if (b) { const on = h.app || h.rib || h.status || h.rail; b.classList.toggle("on", !!on); b.textContent = on ? "◳ UI 보이기" : "◱ UI 가리기"; }
    if (root) { grid(); fitSoon(); }
  }
  function setZen(on) { if (!on) document.body.classList.remove("pp-zen"); }
  function zenToggle() { const h = S.hide; const on = h.app || h.rib || h.status || h.rail; S.hide = on ? { app: false, rib: false, status: false, rail: false } : Object.assign({ app: true, rib: false, status: true, rail: false }, S.hidePref || {}); if (!on) { S._sideWas = S.sideOpen; S.sideOpen = false; } else if (S._sideWas != null) S.sideOpen = S._sideWas; PS("rp.hide", S.hide); applyHide(); }
  function viewMenu(x, y) {
    const h = S.hide; const it = (k, t) => [(h[k] ? "☑ " : "☐ ") + t, () => { h[k] = !h[k]; S.hidePref = Object.assign({}, h); PS("rp.hide", h); applyHide(); }];
    popMenu([it("app", "앱 메뉴·위 막대 가리기"), it("rib", "서식 막대 가리기"), it("rail", "아이콘 줄 가리기"), it("status", "상태 줄 가리기"), [(S.sideOpen ? "☐ " : "☑ ") + "옆 칸 가리기", () => { S.sideOpen = !S.sideOpen; PS("rp.sideOpen", S.sideOpen); paintSide(); }], [(S.ai ? "☐ " : "☑ ") + "AI 칸 가리기", () => { S.ai = !S.ai; PS("rp.ai", S.ai); grid(); if (S.ai) paintAi(); }], "-", ["▭ 종이만 보기", () => { S.hide = { app: true, rib: true, status: true, rail: true }; S.sideOpen = false; S.ai = false; PS("rp.hide", S.hide); applyHide(); }], ["↺ 모두 보이기", () => { S.hide = { app: false, rib: false, status: false, rail: false }; S.sideOpen = true; PS("rp.hide", S.hide); applyHide(); paintSide(); }], "-", ["⛶ 전체 화면", () => { const r = $("rp2"); if (document.fullscreenElement) document.exitFullscreen(); else if (r.requestFullscreen) r.requestFullscreen(); }]], x, y);
  }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("rp2") && !document.fullscreenElement && (S.hide.app || S.hide.rib || S.hide.status || S.hide.rail) && !document.querySelector(".pp-modal")) { const a = document.activeElement; if (a && a.closest && a.closest("#rpEd,#rpDT,#rpAi,input,textarea")) return; zenToggle(); } });

  /* ================================================================== 작업 공간 */
  const RAIL = [["docs", "📑", "문서"], ["out", "≡", "개요"], ["tools", "🧰", "보고서 도구"], ["cmts", "💬", "코멘트"], ["hist", "🕘", "버전"], ["count", "📏", "분량"], ["find", "🔍", "찾기·바꾸기"], ["fmt", "⚙", "문서 서식"]];
  const COLORS = ["#111827", "#dc2626", "#ea580c", "#ca8a04", "#16a34a", "#0d9488", "#2563eb", "#7c3aed", "#db2777", "#6b7280"];
  const HILITE = ["#fef08a", "#bbf7d0", "#bfdbfe", "#fbcfe8", "#fed7aa", "transparent"];
  async function paintWs(area) {
    area.innerHTML = '<div class="sv pp2 rp2" id="rp2">' +
      '<div class="pp2-top rp-top"><div class="pp2-t1"><button type="button" class="rp-back" data-rp="home" title="문서함으로 — 지금 문서는 저장하고 닫아요">← 문서함</button><span class="rp-crumb" id="rpCrumb"></span><input id="rpTitle" class="rp-title" aria-label="문서 제목" placeholder="문서 제목"><span class="pp2-save" id="rpSave"></span></div>' +
        '<div class="pp2-t2"><button type="button" class="pp-tb" data-rp="file" title="새 문서·이름 바꾸기·사본·옮기기·저장 위치·닫기">파일 ▾</button><button type="button" class="pp-tb" data-rp="ver" title="버전 저장 (Ctrl+S)">💾 버전 저장</button><button type="button" class="pp-tb" data-rp="exp" title="내보내기">⬇ 내보내기</button><button type="button" class="pp-ai-t' + (S.ai ? " on" : "") + '" data-rp="ai">✨ AI</button><span class="rp-zen"><button type="button" class="pp-tb" data-rp="zen" title="앱 메뉴·옆 칸 같은 불필요한 화면을 가려요 (Esc 로 되돌리기)">◱ UI 가리기</button><button type="button" class="pp-tb" data-rp="view" title="무엇을 가릴지 고르기" aria-label="보기 설정">▾</button></span><button type="button" class="pp-tb" data-rp="full" title="전체 화면">⛶</button><button type="button" class="pp-tb" data-rp="close" title="문서 닫기">✕</button></div></div>' +
      '<div class="rp-ribbon" id="rpRib" role="toolbar" aria-label="서식"></div>' +
      '<div class="pp2-ws" id="rpWs"><nav class="pp2-rail">' + RAIL.map((r) => '<button type="button" data-rail="' + r[0] + '" title="' + r[2] + '"><span>' + r[1] + '</span><i class="pp-badge" id="rpB_' + r[0] + '"></i></button>').join("") + "</nav>" +
        '<aside class="pp2-side" id="rpSide"></aside><div class="pp2-split" data-split="side"></div>' +
        '<section class="rp-canvas" id="rpCanvas"><div class="rp-paper" id="rpPaper"><div class="rp-sheets" id="rpSheets" aria-hidden="true"></div><div class="rp-dtitle" id="rpDT" contenteditable="true" spellcheck="false" data-ph="문서 제목"></div><div class="rp-ed" id="rpEd" contenteditable="true" spellcheck="false"></div></div></section>' +
        '<div class="pp2-split" data-split="ai"></div><section class="pp2-ai" id="rpAi"></section></div>' +
      '<div class="pp2-status rp-status" id="rpStatus"></div><input type="file" id="rpImg" accept="image/*" hidden></div>';
    S.ed = $("rpEd");
    paintRibbon(); bindEditor(); bindSplits(); if (wsRO) { wsRO.disconnect(); wsRO.observe($("rpWs")); }
    $("rpTitle").addEventListener("input", () => { S.title = $("rpTitle").value; $("rpDT").textContent = S.title; draftSoon(); });
    $("rpDT").addEventListener("input", () => { S.title = $("rpDT").textContent.trim(); $("rpTitle").value = S.title; draftSoon(); });
    $("rpDT").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); S.ed.focus(); placeCaret(S.ed.firstElementChild || S.ed); } });
    area.onclick = onClick;
    S.view = "edit"; grid(); paintSide(); paintAi(); fitSoon(); patchCtx(true); applyHide();
  }
  function grid() {
    const ws = $("rpWs"), root = $("rp2"); if (!ws) return;
    // (v111) 작업 칸의 실제 너비로 판단 — 모자라면 옆 칸 → AI 칸을 줄이고, 그래도 안 되면 겹쳐 띄운다
    const W = ws.clientWidth || window.innerWidth, base = S.hide.rail ? 0 : 44, CEN = 380;   // 쪽이 칸보다 넓으면 effZoom 이 줄여서 맞춘다
    if (S.sideOpen && S.ai && ws.clientWidth && W < base + 205 + 305 + CEN) { if (S.front === "side") S.ai = false; else S.sideOpen = false; }   // 같이 안 들어가면 방금 연 쪽만
    const nw = W < base + (S.sideOpen ? 205 : 0) + (S.ai ? 305 : 0) + CEN;
    let sw = S.lay.side, aw = S.lay.ai; const room = () => W - base - (S.sideOpen ? sw + 5 : 0) - (S.ai ? aw + 5 : 0);
    if (!nw && S.sideOpen && room() < CEN) sw = Math.max(200, sw - (CEN - room()));
    if (!nw && S.ai && room() < CEN) aw = Math.max(300, aw - (CEN - room()));
    root.classList.toggle("nw", nw); root.classList.toggle("side-off", !S.sideOpen); root.classList.toggle("ai-off", !S.ai);
    ws.style.gridTemplateColumns = nw ? "44px 0px 0px minmax(0,1fr) 0px 0px" : [S.hide.rail ? "0px" : "44px", S.sideOpen ? sw + "px" : "0px", S.sideOpen ? "5px" : "0px", "minmax(0,1fr)", S.ai ? "5px" : "0px", S.ai ? aw + "px" : "0px"].join(" ");
    document.querySelectorAll("#rp2 .pp2-rail [data-rail]").forEach((b) => b.classList.toggle("on", S.sideOpen && b.dataset.rail === S.side));
    const at = document.querySelector('#rp2 [data-rp="ai"]'); if (at) at.classList.toggle("on", S.ai);
  }
  function bindSplits() {
    document.querySelectorAll("#rp2 .pp2-split").forEach((sp) => sp.addEventListener("pointerdown", (e) => {
      e.preventDefault(); const k = sp.dataset.split, r = $("rpWs").getBoundingClientRect(); sp.setPointerCapture(e.pointerId); document.body.classList.add("pp-drag");
      const mv = (ev) => { if (k === "side") S.lay.side = Math.max(200, Math.min(520, ev.clientX - r.left - 44)); if (k === "ai") S.lay.ai = Math.max(300, Math.min(760, r.right - ev.clientX)); grid(); };
      const up = () => { sp.removeEventListener("pointermove", mv); sp.removeEventListener("pointerup", up); document.body.classList.remove("pp-drag"); PS("rp.lay", S.lay); };
      sp.addEventListener("pointermove", mv); sp.addEventListener("pointerup", up);
    }));
  }
  function fit() {
    const ws = $("rpWs"); if (!ws || !ws.offsetParent) return; const sc = document.querySelector("main.content"); if (sc && sc.scrollTop) sc.scrollTop = 0;
    const full = document.fullscreenElement && document.fullscreenElement.id === "rp2"; const st = $("rpStatus");
    const h = Math.floor(window.innerHeight - ws.getBoundingClientRect().top - (st ? st.offsetHeight + 8 : 0) - (full ? 0 : 6)); ws.style.height = Math.max(420, h) + "px";
    const over = document.documentElement.scrollHeight - window.innerHeight; if (!full && over > 0 && over < 90) ws.style.height = Math.max(420, h - over) + "px";
    const p = $("rpPaper"), ez = effZoom(); if (p && String(ez) !== p.style.getPropertyValue("--rp-zoom")) { p.style.setProperty("--rp-zoom", ez); const zv = $("rpZv"); if (zv) zv.textContent = Math.round(ez * 100) + "%"; pagSoon(); }
  }
  function fitSoon() { clearTimeout(fit.t); fit.t = setTimeout(fit, 40); }
  /* ---------------- 쪽 매김(워드처럼) ----------------
   * 문서 DOM 은 건드리지 않는다 — 저장되는 HTML 이 깨끗하고 브라우저 되돌리기도 그대로다. 대신 동적 <style> 규칙으로만 민다.
   *   문단: ::before 플로트 + shape-outside 띠(줄 단위로 다음 쪽으로), 목록: li 여백, 표: 행 translateY, 나머지: 블록째 다음 쪽으로.
   *   제목은 다음 내용과 붙여 두고, 문단은 쪽 끝·첫머리에 한 줄만 남지 않게 한다. 좌표는 모두 zoom 을 뺀 값. */
  const MM = 96 / 25.4, PGAP = 20;
  const pageBox = () => { const l = !!S.style.landscape; return { W: (l ? 297 : 210) * MM, H: (l ? 210 : 297) * MM, M: (S.style.margin || 20) * MM }; };
  function pgCss() { let c = $("rpPgCss"); if (!c) { c = document.createElement("style"); c.id = "rpPgCss"; document.head.appendChild(c); } return c; }
  const pagSoon = () => { clearTimeout(paginate.t); paginate.t = setTimeout(paginate, 80); };
  function effZoom() { const c = $("rpCanvas"); if (!c || !c.clientWidth) return S.zoom; return Math.max(0.3, Math.min(S.zoom, (c.clientWidth - 48) / pageBox().W)); }
  function paginate() {
    const ed = S.ed, paper = $("rpPaper"); if (!ed || !paper || !ed.isConnected || !paper.offsetParent) return;
    const css = pgCss(); css.textContent = "";
    const B = pageBox(), pitch = B.H + PGAP, CH = B.H - B.M * 2, end = (p) => p * pitch + B.H - B.M, begin = (p) => p * pitch + B.M;
    const pr = paper.getBoundingClientRect(), z = (pr.width / B.W) || 1, yOf = (r) => (r.top - pr.top) / z;
    const kids = Array.from(ed.children), rules = [], base = parseFloat(getComputedStyle(ed).lineHeight) || 20;
    const sel = (b) => '#rpEd > [data-b="' + b.dataset.b + '"]', num = (v) => (parseFloat(v) || 0);
    let page = 0, shift = 0, force = false, pm = 0;
    const pushTo = (b, top, mt, p) => { const D = begin(p) - top; rules.push(sel(b) + "{margin-top:" + (Math.max(mt, pm) + D).toFixed(1) + "px !important}"); shift += D; return D; };
    const liPath = (b, el) => { const out = []; for (let n = el; n !== b; n = n.parentElement) out.unshift(n.tagName.toLowerCase() + ":nth-child(" + (Array.prototype.indexOf.call(n.parentElement.children, n) + 1) + ")"); return sel(b) + " > " + out.join(" > "); };
    function paraBands(b, r, top) {
      const rg = document.createRange(); rg.selectNodeContents(b);
      const ls = []; Array.from(rg.getClientRects()).forEach((q) => { const a = (q.top - r.top) / z, e = (q.bottom - r.top) / z; if (e - a < 2) return; const l = ls.find((x) => a < x.e - 2 && e > x.a + 2); if (l) { l.a = Math.min(l.a, a); l.e = Math.max(l.e, e); } else ls.push({ a: a, e: e }); });
      ls.sort((x, y) => x.a - y.a); const n = ls.length; if (n < 3) return false;
      let off = 0, pg = page, from = 0; const bands = [];
      for (;;) {
        let k = -1; for (let i = from; i < n; i++) if (top + ls[i].e + off > end(pg)) { k = i; break; }
        if (k < 0) break;
        if (n - k < 2) k = n - 2;
        if (k - from < 2) { if (!bands.length) return false; k = from + 2; if (k >= n) break; }
        const y0 = ls[k].a + off, y1 = begin(pg + 1) - top; bands.push([y0, y1]); off += y1 - y0; pg++; from = k;
      }
      if (!bands.length) return false;
      const pts = []; bands.forEach((q) => pts.push("0 " + q[0].toFixed(1) + "px", "100% " + q[0].toFixed(1) + "px", "100% " + q[1].toFixed(1) + "px", "0 " + q[1].toFixed(1) + "px"));
      rules.push(sel(b) + '::before{content:"";float:left;width:100%;height:' + bands[bands.length - 1][1].toFixed(1) + "px;shape-outside:polygon(" + pts.join(",") + ")}");
      shift += off; page = pg; return true;
    }
    function listBreaks(b) {
      let add = 0, pg = page;
      Array.from(b.querySelectorAll("li")).forEach((li) => {
        const lr = li.getBoundingClientRect(), sub = li.querySelector(":scope > ul, :scope > ol"), own = sub ? (sub.getBoundingClientRect().top - lr.top) / z : lr.height / z, t = yOf(lr) + shift + add;
        if (t + own <= end(pg) || t <= begin(pg) + 1) return;
        const c = getComputedStyle(li), prev = li.previousElementSibling, D = begin(pg + 1) - t;
        rules.push(liPath(b, li) + "{margin-top:" + (Math.max(num(c.marginTop), prev ? num(getComputedStyle(prev).marginBottom) : 0) + D).toFixed(1) + "px !important}"); add += D; pg++;
      });
      shift += add; page = pg;
    }
    function tableBreaks(b, mb) {
      let add = 0, pg = page;
      Array.from(b.querySelectorAll("tr")).forEach((tr) => {
        const rr = tr.getBoundingClientRect(), t = yOf(rr) + shift + add;
        if (t + rr.height / z <= end(pg) || t <= begin(pg) + 1) return;
        add += begin(pg + 1) - t; pg++;
        rules.push(sel(b) + " tr:nth-child(n+" + (Array.prototype.indexOf.call(tr.parentElement.children, tr) + 1) + "){transform:translateY(" + add.toFixed(1) + "px)}");
      });
      if (add) rules.push(sel(b) + "{margin-bottom:" + (mb + add).toFixed(1) + "px !important}");
      shift += add; page = pg;
    }
    const heads = [];
    for (let i = 0; i < kids.length; i++) {
      const b = kids[i], r = b.getBoundingClientRect(), c = getComputedStyle(b), h = r.height / z, mt = num(c.marginTop), mb = num(c.marginBottom), isPb = b.classList.contains("rp-pb");
      let top = yOf(r) + shift;
      if (force) { force = false; page++; top += pushTo(b, top, mt, page); }
      else {
        let need = h;
        if (/^H[1-4]$/.test(b.tagName) && kids[i + 1]) { const nr = kids[i + 1].getBoundingClientRect(); need = (nr.top - r.top) / z + Math.min(nr.height / z, base * 2); }
        if (top + need > end(page) && top > begin(page) + 1 && !isPb) {
          const tb = b.tagName === "TABLE" || b.querySelector("table");
          if (b.tagName === "P" && paraBands(b, r, top)) { /* 줄 단위로 나눴다 */ }
          else if (/^(UL|OL)$/.test(b.tagName) && h > base * 2) listBreaks(b);
          else if (tb && h > CH) tableBreaks(b, mb);
          else { page++; top += pushTo(b, top, mt, page); }
        }
      }
      if (/^H[1-3]$/.test(b.tagName)) heads.push(page);
      while (yOf(r) + shift + h > end(page) + base && h > CH) page++;
      if (isPb) force = true;
      pm = mb;
    }
    S.pages = page + (force ? 2 : 1);
    const N = S.pages;
    ed.querySelectorAll(".rp-toc").forEach((t, ti) => { const rows = t.querySelectorAll(":scope > div"); if (rows.length === heads.length) heads.forEach((p, k) => rules.push("#rpEd .rp-toc:nth-of-type(n) > div:nth-of-type(" + (k + 1) + ')::after{content:"' + (p + 1) + '";float:right}')); });
    css.textContent = rules.join("\n");
    const sh = $("rpSheets"); if (sh) { while (sh.children.length < N) { const d = document.createElement("div"); d.className = "rp-sheet"; sh.appendChild(d); } while (sh.children.length > N) sh.lastChild.remove(); Array.from(sh.children).forEach((d, i) => { const f = S.style.ftr || ""; d.dataset.n = (f ? f + "   " : "") + (S.style.pageNum === false ? "" : (i + 1) + " / " + N); d.dataset.h = S.style.hdr || ""; }); }
    paper.style.height = (N * pitch - PGAP) + "px";
    stat();
  }
  function caretPage() { const pp = $("rpPaper"), s = window.getSelection(); if (!pp || !s || !s.rangeCount || !S.ed.contains(s.anchorNode)) return 0; const q = s.getRangeAt(0).cloneRange(); q.collapse(true); let r = q.getBoundingClientRect(); if (!r.top && !r.height) { const n = s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement; r = n.getBoundingClientRect(); } const B = pageBox(), pr = pp.getBoundingClientRect(), z = (pr.width / B.W) || 1; return Math.floor(((r.top - pr.top) / z) / (B.H + PGAP)) + 1; }
  window.addEventListener("resize", () => { if ($("rp2")) { grid(); fitSoon(); } });
  const wsRO = window.ResizeObserver ? new ResizeObserver((es) => { const w = Math.round(es[0].contentRect.width); if (w && w !== S.wsW) { S.wsW = w; grid(); fitSoon(); } }) : null;
  document.addEventListener("fullscreenchange", () => setTimeout(fit, 80));

  /* ---------------- 문서 열기·저장 ---------------- */
  async function openDoc(did) {
    if (S.did && S.did !== did) await flushAll();
    let rec; try { rec = (await RND.ws.req("doc", { pid: S.pid, did: did })).doc; } catch (e) { toast("문서를 열지 못했어요: " + e.message); return; }
    const dr = P(dkey(), {}) || {}; const draft = (dr.drafts || {})[did];
    S.did = did; S.v = rec.v || 0; S.comments = rec.comments || [];
    let html = rec.html || sectionsToHtml(rec.sections); S.title = rec.title || ""; S.style = Object.assign({}, DEF_STYLE, rec.style || {});
    if (draft && draft.t > (rec.saved || 0) && draft.html) { html = draft.html; S.title = draft.title || S.title; if (draft.style) S.style = Object.assign({}, DEF_STYLE, draft.style); if (draft.comments) S.comments = draft.comments; toast("저장 안 한 고침을 이어서 열었어요 — 💾 버전 저장으로 서버에 남기세요", 4000); S.dirtySrv = true; } else S.dirtySrv = false;
    S.ed.innerHTML = sanitize(html); ensureIds(); renderMath(); applyStyle();
    $("rpTitle").value = S.title; $("rpDT").textContent = S.title; S.srvSig = S.dirtySrv ? "" : sig();
    dr.cur = did; PS(dkey(), dr); crumb();
    S.msgs = (draft && draft.chat) || []; S.turns = {};
    paintSide(); paintMsgs(); stat(); try { RND.prepare(S.pid).then(() => RND.useDoc(did)).catch(() => {}); } catch (e) { /* 계속 */ }
  }
  function sig() { return S.title + "\u0001" + (S.ed ? S.ed.innerHTML : "") + "\u0001" + JSON.stringify(S.style) + JSON.stringify(S.comments); }
  function draftSoon() { stat("save", "고치는 중…"); clearTimeout(S.saveT); S.saveT = setTimeout(saveDraft, 700); clearTimeout(S.outT); S.outT = setTimeout(() => { paintToc(); if (S.side === "out" || S.side === "count") paintSide(); stat(); }, 900); }
  function saveDraft() {
    if (!S.did || !S.ed) return; ensureIds(); const dr = P(dkey(), {}) || {}; dr.drafts = dr.drafts || {}; dr.cur = S.did;
    const changed = sig() !== S.srvSig; S.dirtySrv = changed;
    if (changed) dr.drafts[S.did] = { t: Date.now(), title: S.title, html: S.ed.innerHTML, style: S.style, comments: S.comments, chat: S.msgs.slice(-30).map((m) => ({ role: m.role, text: m.text, changes: (m.changes || []).map((c) => ({ kind: c.kind, label: c.label })), t: m.t })) };
    else delete dr.drafts[S.did];
    PS(dkey(), dr); stat("save", changed ? "작업본 저장됨 · 버전 저장 안 함" : "저장됨 v" + S.v);
    clearTimeout(S.srvT); if (changed) S.srvT = setTimeout(() => saveVersion("자동 저장(10분)", true), 10 * 60000);
  }
  async function saveVersion(note, auto, force) {
    if (!S.did || !S.ed) return; ensureIds(); if (auto && sig() === S.srvSig) return;
    const body = { title: S.title || "제목 없음", kind: "report", sections: htmlToSections(S.ed), html: S.ed.innerHTML, style: S.style, comments: S.comments, note: note || "", ifV: force ? undefined : S.v };
    try { const r = await RND.ws.req("doc", { pid: S.pid, did: S.did }, body); S.v = r.doc.v; S.srvSig = sig(); S.dirtySrv = false; const dr = P(dkey(), {}) || {}; if (dr.drafts) delete dr.drafts[S.did]; PS(dkey(), dr); stat("save", "저장됨 v" + S.v + " · " + new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })); if (!auto) toast("💾 버전 v" + S.v + " 저장"); if (S.side === "hist") paintSide(); loadDocs(); return r.doc; }
    catch (e) {
      if (/먼저 저장했어요/.test(e.message)) {      // (v122) 다른 곳에서 저장한 버전은 그대로 남고, 내 내용이 그 위 새 버전이 된다
        if (auto) { stat("save", "다른 곳에서 저장됨 — 자동 저장을 멈췄어요"); return null; }
        if (confirm(e.message + "\n\n[확인] 지금 내용을 새 버전으로 저장해요. 먼저 저장된 버전은 버전 목록에 그대로 남아요.\n[취소] 저장하지 않아요.")) return saveVersion(note, false, true);
        return null;
      }
      toast("저장하지 못했어요: " + e.message, 5000); return null;
    }
  }
  async function flushAll() { clearTimeout(S.saveT); if (S.did && S.ed) saveDraft(); }

  /* ================================================================== 서식 막대 */
  function paintRibbon() {
    const el = $("rpRib"); if (!el) return;
    const b = (k, h, t, x) => '<button type="button" class="pp-tb" data-f="' + k + '" title="' + esc(t) + '"' + (x || "") + ">" + h + "</button>";
    el.innerHTML = '<select class="rp-sty" id="rpSty" aria-label="문단 스타일"><option value="p">본문</option><option value="h1">제목 1</option><option value="h2">제목 2</option><option value="h3">제목 3</option><option value="h4">제목 4</option><option value="blockquote">인용</option></select>' +
      '<select class="rp-fs" id="rpFs" aria-label="글자 크기"><option value="">크기</option>' + [9, 10, 11, 12, 14, 16, 18, 20, 24, 28].map((n) => '<option value="' + n + '">' + n + "</option>").join("") + "</select><span class=\"pp-sep\"></span>" +
      b("bold", "<b>B</b>", "굵게 (Ctrl+B)") + b("italic", "<i>I</i>", "기울임 (Ctrl+I)") + b("underline", "<u>U</u>", "밑줄 (Ctrl+U)") + b("strikeThrough", "<s>S</s>", "취소선") + b("color", '<span class="rp-cA">A</span>', "글자색") + b("hilite", '<span class="rp-hA">🖍</span>', "형광펜") + b("sup", "x²", "위 첨자") + '<span class="pp-sep"></span>' +
      b("align", "☰", "정렬") + b("insertUnorderedList", "•", "점 목록") + b("insertOrderedList", "1.", "번호 목록") + b("gae", "□", "개조식(□○-·) — Tab 으로 한 단계 아래") + b("check", "☑", "확인 목록") + b("outdent", "⇤", "내어쓰기") + b("indent", "⇥", "들여쓰기") + '<span class="pp-sep"></span>' +
      b("table", "▦ 표", "표 넣기") + b("img", "🖼", "그림 넣기(붙여넣기·끌어 놓기도 돼요)") + b("box", "▭ 상자", "요약·참고·주의·결론 상자") + b("math", "∑", "수식") + b("chart", "📊", "차트(표에서·직접)") + b("fn", "¹", "각주") + b("toc", "≡ 차례", "차례 넣기") + b("hr", "―", "구분선") + b("pb", "⤓", "쪽 나눔") + b("link", "🔗", "링크") + b("date", "📅", "오늘 날짜") + '<span class="pp-sep"></span>' +
      b("removeFormat", "⌫", "서식 지우기") + b("undo", "↶", "되돌리기 (Ctrl+Z)") + b("redo", "↷", "다시 (Ctrl+Y)") + '<span class="pp-sep"></span>' + b("zout", "−", "작게 보기") + '<span class="rp-zv" id="rpZv">' + Math.round(effZoom() * 100) + "%</span>" + b("zin", "＋", "크게 보기");
    el.onmousedown = (e) => { if (e.target.closest("button")) e.preventDefault(); };   // 편집기 선택이 풀리지 않게
    $("rpSty").addEventListener("change", (e) => { restoreSel(); fmtBlock(e.target.value); });
    $("rpFs").addEventListener("change", (e) => { restoreSel(); if (e.target.value) fontSize(+e.target.value); e.target.value = ""; });
    el.onclick = (e) => { const x = e.target.closest("[data-f]"); if (x) fmt(x.dataset.f, x); };
  }
  function saveSel() { const s = window.getSelection(); if (s && s.rangeCount && S.ed && S.ed.contains(s.anchorNode)) S.savedRange = s.getRangeAt(0).cloneRange(); }
  function restoreSel() { if (!S.savedRange) return; const s = window.getSelection(); s.removeAllRanges(); s.addRange(S.savedRange); S.ed.focus(); }
  function exec(c, v) { S.ed.focus(); document.execCommand("styleWithCSS", false, c === "foreColor" || c === "hiliteColor"); document.execCommand(c, false, v == null ? null : v); afterEdit(); }
  function afterEdit() { ensureIds(); draftSoon(); pagSoon(); }
  function curBlock() { const s = window.getSelection(); if (!s.rangeCount) return null; let n = s.anchorNode; if (n && n.nodeType === 3) n = n.parentNode; while (n && n.parentNode !== S.ed) n = n.parentNode; return n && n !== S.ed ? n : null; }
  function fmtBlock(tag) { exec("formatBlock", "<" + tag + ">"); }
  function fontSize(px) {
    const s = window.getSelection(); if (!s.rangeCount || s.isCollapsed) { toast("글을 먼저 고르세요"); return; }
    document.execCommand("styleWithCSS", false, false); document.execCommand("fontSize", false, "7");
    S.ed.querySelectorAll('font[size="7"]').forEach((f) => { const sp = document.createElement("span"); sp.style.fontSize = px + "pt"; sp.innerHTML = f.innerHTML; f.replaceWith(sp); }); afterEdit();
  }
  function insertHtml(html, block) {
    S.ed.focus(); if (S.savedRange && !S.ed.contains(window.getSelection().anchorNode)) restoreSel();
    if (block) { const b = curBlock(); const t = document.createElement("template"); t.innerHTML = html; const nodes = Array.from(t.content.childNodes); if (b) { let ref = b; nodes.forEach((n) => { ref.after(n); ref = n; }); if (b.tagName === "P" && !b.textContent.trim() && !b.querySelector("img")) b.remove(); } else nodes.forEach((n) => S.ed.appendChild(n)); const last = nodes[nodes.length - 1]; if (last && last.nodeType === 1) { const nx = last.nextElementSibling; if (!nx) { const p = document.createElement("p"); p.innerHTML = "<br>"; last.after(p); } placeCaret(last.nextElementSibling || last); } }
    else document.execCommand("insertHTML", false, html);
    renderMath(); afterEdit();
  }
  function placeCaret(el) { try { const r = document.createRange(); r.selectNodeContents(el); r.collapse(true); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); } catch (e) { /* 계속 */ } }
  function fmt(k, btn) {
    restoreSel(); const r = btn ? btn.getBoundingClientRect() : { left: 200, bottom: 200 };
    if (["bold", "italic", "underline", "strikeThrough", "insertUnorderedList", "insertOrderedList", "outdent", "indent", "removeFormat", "undo", "redo"].indexOf(k) >= 0) return exec(k);
    if (k === "sup") return exec("superscript");
    if (k === "color") return popMenu(COLORS.map((c) => ['<span class="rp-sw" style="background:' + c + '"></span> ' + c, () => { restoreSel(); exec("foreColor", c); }]), r.left, r.bottom + 4);
    if (k === "hilite") return popMenu(HILITE.map((c) => ['<span class="rp-sw" style="background:' + c + ';border:1px solid #ccc"></span> ' + (c === "transparent" ? "없애기" : "형광펜"), () => { restoreSel(); exec("hiliteColor", c); }]), r.left, r.bottom + 4);
    if (k === "align") return popMenu([["⯇ 왼쪽", () => exec("justifyLeft")], ["≡ 가운데", () => exec("justifyCenter")], ["⯈ 오른쪽", () => exec("justifyRight")], ["▤ 양쪽", () => exec("justifyFull")]], r.left, r.bottom + 4);
    if (k === "gae") { exec("insertUnorderedList"); const b = curBlock(); const ul = b && (b.tagName === "UL" ? b : b.querySelector && b.querySelector("ul")); if (ul) ul.classList.add("rp-gae"); else { const s = window.getSelection(); let n = s.anchorNode; while (n && n !== S.ed && n.tagName !== "UL") n = n.parentNode; if (n && n.tagName === "UL") n.classList.add("rp-gae"); } return afterEdit(); }
    if (k === "check") { exec("insertUnorderedList"); const s = window.getSelection(); let n = s.anchorNode; while (n && n !== S.ed && n.tagName !== "UL") n = n.parentNode; if (n && n.tagName === "UL") { n.classList.add("rp-check"); n.querySelectorAll("li").forEach((li) => { if (li.dataset.check == null) li.dataset.check = "0"; }); } return afterEdit(); }
    if (k === "table") return tablePicker(r);
    if (k === "img") { saveSel(); $("rpImg").click(); return; }
    if (k === "box") return popMenu([["📌 요약 상자", () => insertBox("sum", "요약")], ["ℹ 참고 상자", () => insertBox("note", "참고")], ["⚠ 주의 상자", () => insertBox("warn", "주의")], ["✅ 결론 상자", () => insertBox("end", "결론")]], r.left, r.bottom + 4);
    if (k === "math") { const t = prompt("수식 (LaTeX, 예: \\frac{a}{b} \\sum_{i=1}^{n} x_i)", ""); if (t) insertHtml('<span class="rp-math" contenteditable="false" data-tex="' + esc(t) + '"></span>&nbsp;'); return; }
    if (k === "chart") return chartDialog();
    if (k === "fn") { const t = prompt("각주 내용", ""); if (t) insertHtml('<span class="rp-fn" contenteditable="false" data-note="' + esc(t) + '">*</span>'); return; }
    if (k === "toc") return insertHtml('<div class="rp-toc" contenteditable="false"></div>', true), paintToc();
    if (k === "hr") return insertHtml("<hr>", true);
    if (k === "pb") return insertHtml('<div class="rp-pb" contenteditable="false"></div>', true);
    if (k === "link") { const u = prompt("링크 주소 (https://…)", "https://"); if (u && /^https?:\/\//.test(u)) exec("createLink", u); return; }
    if (k === "date") return insertHtml(new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "numeric", day: "numeric", weekday: "short" }));
    if (k === "zin" || k === "zout") { S.zoom = Math.max(0.6, Math.min(1.6, Math.round((S.zoom + (k === "zin" ? 0.1 : -0.1)) * 10) / 10)); PS("rp.zoom", S.zoom); applyStyle(); const z = $("rpZv"); if (z) z.textContent = Math.round(effZoom() * 100) + "%"; }
  }
  function insertBox(kind, title) { const s = window.getSelection(); const sel = s.rangeCount && !s.isCollapsed ? s.toString() : ""; insertHtml('<div class="rp-box" data-kind="' + kind + '"><p><b>' + title + "</b></p>" + (sel ? "<p>" + esc(sel) + "</p>" : '<ul class="rp-gae"><li>핵심 내용</li></ul>') + "</div>", true); }
  function tablePicker(r) {
    let el = $("rpTP"); if (!el) { el = document.createElement("div"); el.id = "rpTP"; el.className = "pp-menu rp-tp"; document.body.appendChild(el); document.addEventListener("mousedown", (e) => { if (!e.target.closest("#rpTP")) el.classList.remove("on"); }); }
    el.innerHTML = '<div class="rp-tpg">' + Array.from({ length: 64 }, (_, i) => '<i data-r="' + (Math.floor(i / 8) + 1) + '" data-c="' + (i % 8 + 1) + '"></i>').join("") + '</div><small id="rpTPn">표 크기를 고르세요</small>';
    el.classList.add("on"); el.style.left = r.left + "px"; el.style.top = (r.bottom + 4) + "px";
    el.onmouseover = (e) => { const c = e.target.closest("i"); if (!c) return; const R = +c.dataset.r, C = +c.dataset.c; el.querySelectorAll("i").forEach((x) => x.classList.toggle("on", +x.dataset.r <= R && +x.dataset.c <= C)); $("rpTPn").textContent = R + " × " + C; };
    el.onmousedown = (e) => e.preventDefault();
    el.onclick = (e) => { const c = e.target.closest("i"); if (!c) return; el.classList.remove("on"); const R = +c.dataset.r, C = +c.dataset.c; restoreSel(); insertHtml('<figure class="rp-table"><figcaption>표 제목</figcaption><table>' + Array.from({ length: R }, (_, ri) => "<tr>" + Array.from({ length: C }, () => (ri ? "<td><br></td>" : "<th>항목</th>")).join("") + "</tr>").join("") + "</table></figure>", true); };
  }

  /* ---------------- 편집기 동작 ---------------- */
  function bindEditor() {
    const ed = S.ed;
    ed.addEventListener("input", (e) => { if (e.inputType === "insertText" && e.data === " ") mdShortcut(); afterEdit(); });
    ed.addEventListener("keydown", onKey);
    ed.addEventListener("keyup", () => { saveSel(); syncRibbon(); });
    ed.addEventListener("mouseup", () => { saveSel(); syncRibbon(); setTimeout(selBar, 10); });
    ed.addEventListener("click", onEdClick);
    ed.addEventListener("paste", onPaste);
    ed.addEventListener("drop", onDrop);
    ed.addEventListener("blur", () => { saveSel(); setTimeout(() => { if (!document.activeElement || !document.activeElement.closest(".pp-selbar,.rp-tbar,.pp-menu")) hideBars(); }, 200); });
    if (!S._selOn) S._selOn = document.addEventListener("selectionchange", () => { if (!S.ed || !S.ed.isConnected) return; const s = window.getSelection(); if (s && S.ed.contains(s.anchorNode)) { clearTimeout(S._sc); S._sc = setTimeout(() => { saveSel(); syncRibbon(); selBar(); tableBar(); }, 120); } }) || 1;
    $("rpImg").addEventListener("change", async (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) insertImage(f); });
    $("rpCanvas").addEventListener("scroll", hideBars, { passive: true });
    if (window.ResizeObserver) { if (S.edRO) S.edRO.disconnect(); S.edRO = new ResizeObserver(pagSoon); S.edRO.observe(ed); }   // 수식·그림이 늦게 그려져 높이가 바뀌어도 쪽을 다시 맞춘다
    ed.addEventListener("load", pagSoon, true);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(pagSoon);
    $("rpPaper").addEventListener("mousedown", (e) => { if (e.target.closest(".rp-ed,.rp-dtitle")) return; e.preventDefault(); ed.focus(); placeCaret(ed.lastElementChild || ed); const s = window.getSelection(); s.selectAllChildren(ed.lastElementChild || ed); s.collapseToEnd(); });   // 쪽의 빈 곳을 누르면 글 끝으로
  }
  function onKey(e) {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); saveVersion(""); return; }
    if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); fmt("link"); return; }
    if (e.key === "Tab") { const s = window.getSelection(); let n = s.anchorNode; while (n && n !== S.ed && n.tagName !== "LI" && n.tagName !== "TD" && n.tagName !== "TH") n = n.parentNode; if (n && n.tagName === "LI") { e.preventDefault(); exec(e.shiftKey ? "outdent" : "indent"); S.ed.querySelectorAll("ul.rp-gae ul:not(.rp-gae)").forEach((u) => u.classList.add("rp-gae")); return; } if (n && (n.tagName === "TD" || n.tagName === "TH")) { e.preventDefault(); const cells = Array.from(n.closest("table").querySelectorAll("td,th")); const i = cells.indexOf(n) + (e.shiftKey ? -1 : 1); if (i >= cells.length && !e.shiftKey) { tableOp("rowBelow", n); placeCaret(n.closest("table").querySelector("tr:last-child").firstElementChild); } else if (cells[i]) placeCaret(cells[i]); return; } }
    if (e.key === "/" && !mod) { const b = curBlock(); if (b && b.tagName === "P" && !b.textContent.trim()) { setTimeout(() => slashMenu(b), 0); } }
    if (e.key === "Escape") hideBars();
  }
  function mdShortcut() {
    const b = curBlock(); if (!b || b.tagName !== "P") return; const t = b.textContent; let m;
    const rep = (html) => { b.outerHTML = html; const nb = S.ed.querySelector("[data-new]"); if (nb) { nb.removeAttribute("data-new"); placeCaret(nb.querySelector("li") || nb); } afterEdit(); };
    if ((m = /^(#{1,4})\s$/.exec(t))) return rep("<h" + m[1].length + ' data-new="1"><br></h' + m[1].length + ">");
    if (/^[-*]\s$/.test(t)) return rep('<ul data-new="1"><li><br></li></ul>');
    if (/^1[.)]\s$/.test(t)) return rep('<ol data-new="1"><li><br></li></ol>');
    if (/^[□○■]\s$/.test(t)) return rep('<ul class="rp-gae" data-new="1"><li><br></li></ul>');
    if (/^\[\]\s$/.test(t)) return rep('<ul class="rp-check" data-new="1"><li data-check="0"><br></li></ul>');
    if (/^>\s$/.test(t)) return rep('<blockquote data-new="1"><br></blockquote>');
    if (/^---\s$/.test(t)) return rep('<hr><p data-new="1"><br></p>');
  }
  function slashMenu(b) {
    const r = b.getBoundingClientRect();
    const go = (fn) => () => { if (b.textContent === "/") b.innerHTML = "<br>"; placeCaret(b); saveSel(); fn(); };
    popMenu([["# 제목 1", go(() => fmtBlock("h1"))], ["## 제목 2", go(() => fmtBlock("h2"))], ["### 제목 3", go(() => fmtBlock("h3"))], ["□ 개조식", go(() => fmt("gae"))], ["1. 번호 목록", go(() => fmt("insertOrderedList"))], ["☑ 확인 목록", go(() => fmt("check"))], ["▦ 표 3×3", go(() => insertHtml('<figure class="rp-table"><figcaption>표 제목</figcaption><table><tr><th>항목</th><th>내용</th><th>비고</th></tr><tr><td><br></td><td><br></td><td><br></td></tr><tr><td><br></td><td><br></td><td><br></td></tr></table></figure>', true))], ["📌 요약 상자", go(() => insertBox("sum", "요약"))], ["⚠ 주의 상자", go(() => insertBox("warn", "주의"))], ["🖼 그림", go(() => fmt("img"))], ["📊 차트", go(() => chartDialog())], ["∑ 수식", go(() => fmt("math"))], ["≡ 차례", go(() => fmt("toc"))], ["⤓ 쪽 나눔", go(() => fmt("pb"))], "-", ["✨ AI 로 이어 쓰기", go(() => aiContinue(b))], ["✨ AI 에게 이 자리 채우기…", go(() => { const q = prompt("이 자리에 무엇을 쓸까요?", ""); if (q) aiSend(q + " — 커서가 있는 자리(" + (b.dataset.b || "") + " 블록)에 넣어 줘", { at: b.dataset.b }); })]], r.left, r.bottom + 4);
  }
  function syncRibbon() { const b = curBlock(); const st = $("rpSty"); if (st && b) { const t = b.tagName.toLowerCase(); st.value = /^(h[1-4]|blockquote)$/.test(t) ? t : "p"; } stat(); }
  function onEdClick(e) {
    const m = e.target.closest(".rp-math"); if (m) { const t = prompt("수식 고치기 (비우면 지움)", m.dataset.tex || ""); if (t === null) return; if (!t.trim()) m.remove(); else { m.dataset.tex = t; renderMath(); } afterEdit(); return; }
    const fnn = e.target.closest(".rp-fn"); if (fnn) { const t = prompt("각주 고치기 (비우면 지움)", fnn.dataset.note || ""); if (t === null) return; if (!t.trim()) fnn.remove(); else fnn.dataset.note = t; afterEdit(); return; }
    const im = e.target.closest("figure.rp-fig img, figure.rp-chart"); if (im) { imageBar(im.closest("figure")); return; }
    const li = e.target.closest("ul.rp-check > li"); if (li && e.offsetX < 22) { li.dataset.check = li.dataset.check === "1" ? "0" : "1"; afterEdit(); return; }
    const cm = e.target.closest(".rp-cm"); if (cm) { S.side = "cmts"; S.sideOpen = true; grid(); paintSide(); setTimeout(() => { const c = document.querySelector('[data-cmc="' + cm.dataset.cid + '"]'); if (c) { c.scrollIntoView({ block: "center" }); c.classList.add("hl"); } }, 40); }
  }
  async function onPaste(e) {
    const it = Array.from((e.clipboardData && e.clipboardData.items) || []).find((x) => x.type && x.type.indexOf("image/") === 0);
    if (it) { e.preventDefault(); insertImage(it.getAsFile()); return; }
    const html = e.clipboardData && e.clipboardData.getData("text/html");
    if (html) { e.preventDefault(); document.execCommand("insertHTML", false, sanitize(html.replace(/<!--[\s\S]*?-->/g, ""))); afterEdit(); return; }
    const txt = e.clipboardData && e.clipboardData.getData("text/plain");
    if (txt && /(^|\n)(#{1,4} |[□○] |\| .*\|)/.test(txt)) { e.preventDefault(); insertHtml(mdToHtml(txt), true); }
  }
  function onDrop(e) { const f = e.dataTransfer && Array.from(e.dataTransfer.files || []).find((x) => /^image\//.test(x.type)); if (!f) return; e.preventDefault(); const r = document.caretRangeFromPoint && document.caretRangeFromPoint(e.clientX, e.clientY); if (r) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); saveSel(); } insertImage(f); }
  function insertImage(file) {
    const rd = new FileReader(); rd.onload = () => { const img = new Image(); img.onload = () => { const mx = 1600, k = Math.min(1, mx / Math.max(img.width, img.height)); const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); const png = /png|gif/.test(file.type) && c.width * c.height < 900000; const u = c.toDataURL(png ? "image/png" : "image/jpeg", 0.86); restoreSel(); insertHtml('<figure class="rp-fig"><img src="' + u + '" data-w="80" style="width:80%" alt=""><figcaption>그림 설명</figcaption></figure>', true); }; img.src = rd.result; }; rd.readAsDataURL(file);
  }
  /* ---- 표 막대 · 그림 막대 · 고른 글 막대 ---- */
  function cellAt() { const s = window.getSelection(); let n = s.anchorNode; while (n && n !== S.ed && n.tagName !== "TD" && n.tagName !== "TH") n = n.parentNode; return n && n !== S.ed ? n : null; }
  function tableBar() {
    const cell = cellAt(); let el = $("rpTbar"); if (!cell) { if (el && !el.matches(":hover")) el.classList.remove("on"); return; }
    if (!el) { el = document.createElement("div"); el.id = "rpTbar"; el.className = "pp-selbar rp-tbar"; document.body.appendChild(el); el.addEventListener("mousedown", (e) => e.preventDefault()); el.addEventListener("click", (e) => { const b = e.target.closest("[data-tb]"); if (b) tableOp(b.dataset.tb, el._cell); }); }
    el._cell = cell; el.innerHTML = [["rowAbove", "↑행"], ["rowBelow", "↓행"], ["colLeft", "←열"], ["colRight", "→열"], ["delRow", "행 ✕"], ["delCol", "열 ✕"], ["head", "머리글"], ["stripe", "줄무늬"], ["chart", "📊 차트로"], ["ai", "✨ 표 다듬기"], ["delTable", "표 ✕"]].map((x) => '<button type="button" data-tb="' + x[0] + '">' + x[1] + "</button>").join("");
    const t = cell.closest("figure") || cell.closest("table"); const r = t.getBoundingClientRect(); el.classList.add("on"); el.style.left = Math.max(8, Math.min(window.innerWidth - el.offsetWidth - 8, r.left)) + "px"; el.style.top = Math.max(8, r.top - el.offsetHeight - 6) + "px";
  }
  function tableOp(k, cell) {
    if (!cell) return; const tr = cell.parentNode, table = cell.closest("table"), ci = Array.from(tr.children).indexOf(cell), fig = table.closest("figure");
    const mk = (tag) => { const c = document.createElement(tag); c.innerHTML = "<br>"; return c; };
    if (k === "rowAbove" || k === "rowBelow") { const n = document.createElement("tr"); Array.from(tr.children).forEach(() => n.appendChild(mk("td"))); if (k === "rowAbove" && tr.parentNode.firstElementChild !== tr) tr.before(n); else tr.after(n); }
    if (k === "colLeft" || k === "colRight") table.querySelectorAll("tr").forEach((r, i) => { const ref = r.children[Math.min(ci, r.children.length - 1)]; const c = mk(i === 0 && ref.tagName === "TH" ? "th" : "td"); if (k === "colLeft") ref.before(c); else ref.after(c); });
    if (k === "delRow") { if (table.querySelectorAll("tr").length > 1) tr.remove(); }
    if (k === "delCol") { if (tr.children.length > 1) table.querySelectorAll("tr").forEach((r) => { if (r.children[ci]) r.children[ci].remove(); }); }
    if (k === "head") { const first = table.querySelector("tr"); Array.from(first.children).forEach((c) => { const n = document.createElement(c.tagName === "TH" ? "td" : "th"); n.innerHTML = c.innerHTML; c.replaceWith(n); }); }
    if (k === "stripe") (fig || table).classList.toggle("rp-stripe");
    if (k === "delTable") { if (confirm("이 표를 지울까요?")) (fig || table).remove(); }
    if (k === "chart") { chartFromTable(table); return; }
    if (k === "ai") { const id = (fig || table).dataset.b; aiSend("이 표(" + id + ")를 보고서에 맞게 다듬어 줘 — 머리글·단위·숫자 정렬·캡션을 분명하게, 내용은 바꾸지 말고", { at: id }); return; }
    afterEdit(); tableBar();
  }
  function imageBar(fig) {
    let el = $("rpIbar"); if (!el) { el = document.createElement("div"); el.id = "rpIbar"; el.className = "pp-selbar rp-tbar"; document.body.appendChild(el); el.addEventListener("mousedown", (e) => e.preventDefault()); document.addEventListener("mousedown", (e) => { if (!e.target.closest("#rpIbar") && !e.target.closest("figure.rp-fig,figure.rp-chart")) el.classList.remove("on"); }); }
    el.innerHTML = [["25", "25%"], ["50", "50%"], ["75", "75%"], ["100", "100%"], ["cap", "캡션"], ["edit", fig.classList.contains("rp-chart") ? "✎ 차트" : ""], ["del", "✕"]].filter((x) => x[1]).map((x) => '<button type="button" data-ib="' + x[0] + '">' + x[1] + "</button>").join("");
    el.onclick = (e) => { const b = e.target.closest("[data-ib]"); if (!b) return; const k = b.dataset.ib; const im = fig.querySelector("img,svg"); if (/^\d+$/.test(k)) { fig.style.setProperty("--w", k + "%"); if (im) { im.style.width = k + "%"; im.dataset.w = k; } } if (k === "cap") { const c = fig.querySelector("figcaption"); if (c) { placeCaret(c); c.focus(); } } if (k === "edit") chartDialog(fig); if (k === "del") { fig.remove(); el.classList.remove("on"); } afterEdit(); };
    const r = fig.getBoundingClientRect(); el.classList.add("on"); el.style.left = (r.left + r.width / 2 - el.offsetWidth / 2) + "px"; el.style.top = Math.max(8, r.top - el.offsetHeight - 6) + "px";
  }
  function selBar() {
    const s = window.getSelection(); let el = $("rpSel");
    if (!s.rangeCount || s.isCollapsed || !S.ed.contains(s.anchorNode) || s.toString().trim().length < 2) { if (el) el.classList.remove("on"); return; }
    if (!el) { el = document.createElement("div"); el.id = "rpSel"; el.className = "pp-selbar"; document.body.appendChild(el); el.addEventListener("mousedown", (e) => e.preventDefault()); el.addEventListener("click", (e) => { const b = e.target.closest("[data-sb]"); if (!b) return; const k = b.dataset.sb; restoreSel(); if (k === "b") exec("bold"); else if (k === "hl") exec("hiliteColor", "#fef08a"); else if (k === "cmt") addComment(); else if (k === "chat") { S.ai = true; PS("rp.ai", true); grid(); paintAi(); setTimeout(() => { const q = $("rpAiQ"); if (q) q.focus(); }, 50); } else inlineAI(k); el.classList.remove("on"); }); }
    el.innerHTML = [["b", "<b>B</b>"], ["hl", "🖍"], ["cmt", "💬"], ["pol", "✨ 다듬기"], ["gae", "□ 개조식으로"], ["prose", "¶ 문장으로"], ["short", "✂ 줄이기"], ["long", "➕ 늘리기"], ["table", "▦ 표로"], ["easy", "쉬운 말로"], ["en", "🌐 영어로"], ["ask", "⚡ 지시…"], ["chat", "💭 대화로"]].map((x) => '<button type="button" data-sb="' + x[0] + '">' + x[1] + "</button>").join("");
    const r = s.getRangeAt(0).getBoundingClientRect(); el.classList.add("on"); el.style.left = Math.max(8, Math.min(window.innerWidth - el.offsetWidth - 8, r.left)) + "px"; el.style.top = Math.max(8, r.top - el.offsetHeight - 8) + "px";
  }
  function hideBars() { ["rpSel", "rpTbar", "rpIbar"].forEach((i) => { const el = $(i); if (el) el.classList.remove("on"); }); }

  /* ---------------- 수식·차례·차트·서식 적용 ---------------- */
  let katexP = null;
  function loadKatex() { if (window.katex) return Promise.resolve(true); if (katexP) return katexP; katexP = new Promise((res) => { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css"; document.head.appendChild(l); const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"; s.onload = () => res(true); s.onerror = () => res(false); document.head.appendChild(s); setTimeout(() => res(!!window.katex), 8000); }); return katexP; }
  function renderMath() { const ms = S.ed ? S.ed.querySelectorAll(".rp-math") : []; paintToc(); if (!ms.length) return; loadKatex().then((ok) => { ms.forEach((m) => { m.contentEditable = "false"; try { m.innerHTML = ok ? katex.renderToString(m.dataset.tex || "", { throwOnError: false }) : esc(m.dataset.tex || ""); } catch (e) { m.textContent = m.dataset.tex || ""; } }); }); paintToc(); }
  function paintToc() { if (!S.ed) return; const hs = Array.from(S.ed.querySelectorAll(":scope > h1, :scope > h2, :scope > h3")); S.ed.querySelectorAll(".rp-toc").forEach((t) => { t.contentEditable = "false"; t.innerHTML = '<b>차례</b>' + hs.map((h) => '<div class="l' + h.tagName[1] + '"><span class="rp-tn"></span>' + esc(h.textContent) + "</div>").join(""); }); numberToc(); }
  function headNums() {   // 화면의 CSS 번호와 같은 규칙으로 글자 번호를 만든다(::before 의 content 를 읽으면 계산된 글자가 아니라 counter() 식이 나온다)
    const ROM = ["Ⅰ", "Ⅱ", "Ⅲ", "Ⅳ", "Ⅴ", "Ⅵ", "Ⅶ", "Ⅷ", "Ⅸ", "Ⅹ", "Ⅺ", "Ⅻ"], HAN = "가나다라마바사아자차카타파하", mode = S.style.numbering || "none", c = [0, 0, 0, 0], out = new Map();
    Array.from(S.ed.querySelectorAll(":scope > h1, :scope > h2, :scope > h3, :scope > h4")).forEach((h) => { const lv = +h.tagName[1]; c[lv - 1]++; for (let j = lv; j < 4; j++) c[j] = 0; let t = ""; if (mode === "korean") t = [ROM[(c[0] - 1) % 12] + ".", c[1] + ".", HAN[(c[2] - 1) % 14] + ".", c[3] + ")"][lv - 1]; else if (mode === "decimal") t = lv === 1 ? c[0] + "." : c.slice(0, lv).join("."); out.set(h, t); });
    return out;
  }
  function numberToc() { if (!S.ed) return; const hs = Array.from(S.ed.querySelectorAll(":scope > h1, :scope > h2, :scope > h3")); const N = headNums(); const nums = hs.map((h) => N.get(h) || ""); S.ed.querySelectorAll(".rp-toc").forEach((t) => t.querySelectorAll(".rp-tn").forEach((sp, i) => { sp.textContent = nums[i] || ""; })); }
  function applyStyle() {
    const p = $("rpPaper"); if (!p) return; const s = S.style;
    p.dataset.num = s.numbering || "none"; p.style.setProperty("--rp-font", '"' + (s.font || "맑은 고딕") + '", "Pretendard Variable", sans-serif'); p.style.setProperty("--rp-size", (s.size || 11) + "pt"); p.style.setProperty("--rp-line", s.line || 1.6); p.style.setProperty("--rp-margin", (s.margin || 20) + "mm"); p.style.setProperty("--rp-zoom", effZoom());
    const mk = (s.gaeMarks || "□○-·").split(""); p.style.setProperty("--g1", '"' + (mk[0] || "□") + '"'); p.style.setProperty("--g2", '"' + (mk[1] || "○") + '"'); p.style.setProperty("--g3", '"' + (mk[2] || "-") + '"'); p.style.setProperty("--g4", '"' + (mk[3] || "·") + '"');
    p.dataset.design = s.design || "standard";
    p.classList.toggle("has-cover", !!(S.ed && S.ed.querySelector(".rp-cover")));   // 표지가 있으면 맨 위 문서 제목은 뺀다
    p.classList.toggle("land", !!s.landscape); setTimeout(numberToc, 30); stat(); pagSoon();
  }
  function chartFromTable(table) {
    const rows = Array.from(table.querySelectorAll("tr")).map((tr) => Array.from(tr.children).map((c) => c.textContent.trim()));
    if (rows.length < 2 || rows[0].length < 2) return toast("머리글 + 숫자 칸이 있는 표에서 만들 수 있어요");
    const series = rows[0].slice(1).map((name, j) => ({ name: name, vals: rows.slice(1).map((r) => parseFloat(String(r[j + 1] || "").replace(/[,%원건명개]/g, "")) || 0) }));
    chartDialog(null, { type: "bar", labels: rows.slice(1).map((r) => r[0]), series: series, title: ((table.closest("figure") || {}).querySelector ? ((table.closest("figure").querySelector("figcaption") || {}).textContent || "") : "") });
  }
  function chartSvg(c) {
    const W = 640, H = 340, L = 54, B = 46, T = 30, R = 16, lab = c.labels || [], ser = c.series || []; const all = ser.flatMap((s) => s.vals); const mx = Math.max(1, ...all) * 1.12, mn = Math.min(0, ...all);
    const PAL = ["#2563eb", "#f97316", "#16a34a", "#a855f7", "#e11d48", "#0d9488"]; const x0 = L, x1 = W - R, y0 = H - B, y1 = T; const y = (v) => y0 - (v - mn) / (mx - mn) * (y0 - y1);
    let g = '<svg viewBox="0 0 ' + W + " " + H + '" xmlns="http://www.w3.org/2000/svg" font-family="Pretendard Variable, Malgun Gothic, sans-serif" font-size="12">';
    for (let k = 0; k <= 4; k++) { const v = mn + (mx - mn) * k / 4, yy = y(v); g += '<line x1="' + x0 + '" x2="' + x1 + '" y1="' + yy + '" y2="' + yy + '" stroke="#e5e7eb"/><text x="' + (x0 - 6) + '" y="' + (yy + 4) + '" text-anchor="end" fill="#6b7280">' + (Math.round(v * 100) / 100) + "</text>"; }
    const n = Math.max(1, lab.length), bw = (x1 - x0) / n;
    if (c.type === "line") ser.forEach((s, si) => { const pts = s.vals.map((v, i) => (x0 + bw * (i + 0.5)) + "," + y(v)).join(" "); g += '<polyline points="' + pts + '" fill="none" stroke="' + PAL[si % 6] + '" stroke-width="2.5"/>' + s.vals.map((v, i) => '<circle cx="' + (x0 + bw * (i + 0.5)) + '" cy="' + y(v) + '" r="3.5" fill="' + PAL[si % 6] + '"/>').join(""); });
    else ser.forEach((s, si) => { const w = bw * 0.72 / ser.length; s.vals.forEach((v, i) => { const xx = x0 + bw * i + bw * 0.14 + w * si; g += '<rect x="' + xx + '" y="' + Math.min(y(v), y(0)) + '" width="' + w + '" height="' + Math.abs(y(0) - y(v)) + '" rx="2" fill="' + PAL[si % 6] + '"/><text x="' + (xx + w / 2) + '" y="' + (y(v) - 4) + '" text-anchor="middle" font-size="10.5" fill="#374151">' + v + "</text>"; }); });
    lab.forEach((t, i) => { g += '<text x="' + (x0 + bw * (i + 0.5)) + '" y="' + (y0 + 18) + '" text-anchor="middle" fill="#374151">' + esc(String(t).slice(0, 14)) + "</text>"; });
    g += '<line x1="' + x0 + '" x2="' + x1 + '" y1="' + y0 + '" y2="' + y0 + '" stroke="#9ca3af"/>';
    ser.forEach((s, si) => { g += '<rect x="' + (x0 + si * 120) + '" y="8" width="11" height="11" rx="2" fill="' + PAL[si % 6] + '"/><text x="' + (x0 + si * 120 + 16) + '" y="18" fill="#374151">' + esc(s.name) + "</text>"; });
    return g + "</svg>";
  }
  function chartDialog(fig, preset) {
    let c = preset || (fig && fig.dataset.chart ? JSON.parse(fig.dataset.chart) : { type: "bar", title: "차트 제목", labels: ["1분기", "2분기", "3분기", "4분기"], series: [{ name: "계획", vals: [10, 20, 30, 40] }, { name: "실적", vals: [12, 18, 33, 41] }] });
    const toText = () => ["항목," + c.series.map((s) => s.name).join(",")].concat(c.labels.map((l, i) => l + "," + c.series.map((s) => s.vals[i]).join(","))).join("\n");
    const m = modal("📊 차트", '<div class="pp-trc"><label>종류 <select data-o="type"><option value="bar">막대</option><option value="line">꺾은선</option></select></label><label>제목 <input data-o="title" value="' + esc(c.title || "") + '"></label></div><textarea data-o="data" rows="6" class="rp-cdata">' + esc(toText()) + '</textarea><small class="sh-muted">첫 줄 = 항목·계열 이름, 아래 줄 = 항목별 값(쉼표). 엑셀에서 복사해 붙여도 돼요(탭).</small><div class="rp-cprev" data-o="prev"></div><div class="lb-row"><button type="button" class="primary small-btn" data-mod="ok">' + (fig ? "고치기" : "넣기") + "</button></div>", (k, mm) => {
      if (k !== "ok") return; const html = '<figure class="rp-chart" contenteditable="false" data-chart="' + esc(JSON.stringify(c)) + '">' + chartSvg(c) + '<figcaption contenteditable="true">' + esc(c.title || "") + "</figcaption></figure>";
      mm.close(); if (fig) { fig.outerHTML = html; afterEdit(); } else { restoreSel(); insertHtml(html, true); }
    });
    const sel = m.el.querySelector('[data-o="type"]'); sel.value = c.type;
    const upd = () => { const lines = m.el.querySelector('[data-o="data"]').value.trim().split(/\n/).map((l) => l.split(/\t|,/).map((x) => x.trim())); if (lines.length >= 2) { c.series = lines[0].slice(1).map((nm, j) => ({ name: nm, vals: lines.slice(1).map((r) => parseFloat((r[j + 1] || "").replace(/[^\d.-]/g, "")) || 0) })); c.labels = lines.slice(1).map((r) => r[0]); } c.type = sel.value; c.title = m.el.querySelector('[data-o="title"]').value; m.el.querySelector('[data-o="prev"]').innerHTML = chartSvg(c); };
    m.el.addEventListener("input", upd); m.el.addEventListener("change", upd); upd();
  }

  /* ================================================================== 옆 칸 */
  function paintSide() {
    const el = $("rpSide"); if (!el) return; grid();
    const T = { docs: "문서", out: "개요", tools: "보고서 도구", cmts: "코멘트", hist: "버전", count: "분량", find: "찾기·바꾸기", fmt: "문서 서식" };
    const head = (x) => '<div class="pp-sh"><b>' + T[S.side] + "</b>" + (x || "") + '<button type="button" class="pp-ib" data-rp="sideclose" title="접기">«</button></div>';
    if (S.side === "docs") { el.innerHTML = head('<span class="pp-sh-a"><button type="button" class="pp-ib" data-rp="new" title="새 문서(양식)">＋</button></span>') + '<div class="rp-docs">' + S.docs.map((d) => '<button type="button" class="rp-di' + (d.id === S.did ? " on" : "") + '" data-doc="' + esc(d.id) + '"><b>' + (d.kind === "report" ? "📝 " : "📄 ") + esc(d.title) + "</b><small>v" + d.v + " · " + fmtT(d.saved) + " · 절 " + (d.sections || 0) + "</small></button>").join("") + '</div><p class="sh-muted pp-tip">연구 프로젝트의 작업 문서가 모두 여기에 보여요. 연구지원 작업실에서 AI 가 만든 문서도 열어 고칠 수 있어요.</p>'; return; }
    if (S.side === "out") { const hs = S.ed ? Array.from(S.ed.querySelectorAll(":scope > h1, :scope > h2, :scope > h3, :scope > h4")) : []; const N = S.ed ? headNums() : new Map(); el.innerHTML = head() + '<div class="pp-ol">' + (hs.length ? hs.map((h, i) => '<button type="button" class="pp-oi l' + (+h.tagName[1] - 1) + '" data-hi="' + i + '"><span class="rp-onum">' + esc(N.get(h) || "") + "</span>" + esc(h.textContent.slice(0, 60) || "(빈 제목)") + "</button>").join("") : '<p class="sh-muted">제목(제목 1~4)을 쓰면 개요가 생겨요. # + 띄어쓰기로도 돼요.</p>') + "</div>"; el.onclick = (e) => { const b = e.target.closest("[data-hi]"); if (!b) return; const h = hs[+b.dataset.hi]; h.scrollIntoView({ behavior: "smooth", block: "start" }); h.classList.add("rp-flash"); setTimeout(() => h.classList.remove("rp-flash"), 1400); }; return; }
    if (S.side === "tools") { el.innerHTML = head() + '<div class="rp-tools" id="rpTools"></div>'; paintTools(); return; }
    if (S.side === "cmts") { el.innerHTML = head() + '<div id="rpCmts"></div>'; paintCmts(); return; }
    if (S.side === "hist") { el.innerHTML = head('<span class="pp-sh-a"><button type="button" class="pp-ib" data-rp="ver" title="지금 버전 저장">💾</button></span>') + '<div id="rpHist"><p class="sh-muted" style="padding:10px">불러오는 중…</p></div>'; paintHist(); return; }
    if (S.side === "count") { el.innerHTML = head() + '<div id="rpCount"></div>'; paintCount(); return; }
    if (S.side === "find") { el.innerHTML = head() + '<div class="pp-find"><input id="rpFq" type="search" placeholder="찾을 글"><input id="rpFr" type="text" placeholder="바꿀 글"><div class="pp-find-o"><span id="rpFn"></span><button type="button" class="ghost-btn small-btn" data-rp="fnext">다음</button><button type="button" class="ghost-btn small-btn" data-rp="frep">모두 바꾸기</button></div></div>'; $("rpFq").addEventListener("input", findMark); $("rpFq").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); findNext(); } }); return; }
    if (S.side === "fmt") { el.innerHTML = head() + '<div id="rpFmt"></div>'; paintFmt(); return; }
  }
  /* (v125) 표지 — 문서 맨 앞 블록. 화면과 인쇄가 같게 본문 안에 둔다 */
  function coverInsert() {
    if (S.ed.querySelector(".rp-cover")) return toast("이미 표지가 있어요");
    const d = document.createElement("div"); d.innerHTML = '<div class="rp-cover"><p class="rc-org">기관 이름</p><p class="rc-title">' + esc(S.title || "보고서 제목") + '</p><p class="rc-sub">부제</p><p class="rc-meta">' + new Date().toLocaleDateString("ko-KR") + ' · 작성자</p></div><div class="rp-pb" contenteditable="false"></div>';
    while (d.lastChild) S.ed.insertBefore(d.lastChild, S.ed.firstChild);
    ensureIds(); applyStyle(); afterEdit();
  }
  function paintFmt() {
    const el = $("rpFmt"); if (!el) return; const s = S.style;
    const sel = (k, t, opts) => '<label class="pp-sw"><span><b>' + t + '</b></span><select data-st="' + k + '">' + opts.map((o) => '<option value="' + esc(o[0]) + '"' + (String(s[k]) === String(o[0]) ? " selected" : "") + ">" + esc(o[1]) + "</option>").join("") + "</select></label>";
    const txt = (k, t, ph) => '<label class="pp-sw"><span><b>' + t + '</b></span><input type="text" data-st="' + k + '" value="' + esc(s[k] || "") + '" placeholder="' + esc(ph) + '"></label>';
    el.innerHTML = '<div style="padding:8px;display:flex;flex-direction:column;gap:6px">' + sel("design", "디자인", [["standard", "표준 보고서"], ["official", "공문형"], ["research", "연구보고서"], ["executive", "경영 요약"], ["onepage", "한 장 요약"], ["slide", "발표형"]]) + txt("hdr", "머리글", "쪽 위에 넣을 글") + txt("ftr", "바닥글", "쪽 아래에 넣을 글") + '<button type="button" class="ghost-btn small-btn" data-fmt="cover">표지 넣기</button>' + sel("numbering", "제목 번호", [["korean", "Ⅰ. → 1. → 가. → 1) (공문·보고서)"], ["decimal", "1. → 1.1 → 1.1.1 (논문·기술)"], ["none", "번호 없음"]]) + sel("font", "글꼴", [["맑은 고딕", "맑은 고딕"], ["Pretendard Variable", "프리텐다드"], ["바탕", "바탕(명조)"], ["Noto Serif KR", "Noto Serif KR"], ["나눔고딕", "나눔고딕"]]) +
      sel("size", "본문 크기", [[10, "10pt"], [10.5, "10.5pt"], [11, "11pt"], [12, "12pt"], [13, "13pt"]]) + sel("line", "줄 간격", [[1.4, "1.4"], [1.6, "1.6"], [1.8, "1.8"], [2, "2.0"]]) + sel("margin", "여백", [[15, "좁게 15mm"], [20, "보통 20mm"], [25, "넓게 25mm"], [30, "아주 넓게 30mm"]]) + sel("gaeMarks", "개조식 기호", [["□○-·", "□ ○ - ·"], ["■●-·", "■ ● - ·"], ["❍▪-·", "❍ ▪ - ·"], ["•◦-·", "• ◦ - ·"]]) + sel("landscape", "쪽 방향", [["", "세로(A4)"], ["1", "가로"]]) +
      '<p class="sh-muted pp-tip">서식은 문서마다 저장되고, Word 로 내보낼 때도 그대로 적용돼요(글꼴·크기·줄 간격·여백·제목 번호·쪽 번호).</p></div>';
    el.onclick = (e) => { if (e.target.closest('[data-fmt="cover"]')) coverInsert(); };
    el.onchange = (e) => { const i = e.target.closest("[data-st]"); if (!i) return; const k = i.dataset.st; let v = i.value; if (["size", "line", "margin"].indexOf(k) >= 0) v = +v; if (k === "landscape") v = !!v; S.style[k] = v; applyStyle(); draftSoon(); if (S.side === "out") paintSide(); };
  }
  function paintCount() {
    const el = $("rpCount"); if (!el || !S.ed) return; const txt = S.ed.innerText || ""; const chars = txt.replace(/\s/g, "").length, withSp = txt.replace(/\n/g, "").length, words = (txt.match(/\S+/g) || []).length;
    const pages = S.pages || 1;
    const secs = []; let cur = null; Array.from(S.ed.children).forEach((b) => { if (/^H[12]$/.test(b.tagName)) { cur = { t: b.textContent.trim(), n: 0 }; secs.push(cur); } else if (cur) cur.n += (b.innerText || "").replace(/\s/g, "").length; });
    const mx = Math.max(1, ...secs.map((s) => s.n)); const goal = +(S.style.goal || 0);
    el.innerHTML = '<div class="pp-wc" style="padding:8px"><div><b>' + chars.toLocaleString() + "</b><span>글자(공백 뺌)</span></div><div><b>" + withSp.toLocaleString() + "</b><span>공백 포함</span></div><div><b>" + words.toLocaleString() + "</b><span>어절</span></div><div><b>" + pages + "</b><span>쪽(어림)</span></div><div><b>" + S.ed.querySelectorAll("figure.rp-table").length + "</b><span>표</span></div><div><b>" + S.ed.querySelectorAll("figure.rp-fig,figure.rp-chart").length + "</b><span>그림·차트</span></div></div>" +
      '<div style="padding:0 10px 10px"><label class="pp-sw"><span><b>목표 분량</b><small>' + (goal ? Math.round(chars / goal * 100) + "% (" + chars.toLocaleString() + " / " + goal.toLocaleString() + "자)" : "글자 수 목표를 정하면 진행률을 보여 줘요") + '</small></span><input type="number" min="0" step="500" value="' + (goal || "") + '" data-goal="1" style="width:90px"></label>' + (goal ? '<div class="rp-gbar"><i style="width:' + Math.min(100, chars / goal * 100) + '%"></i></div>' : "") +
      '<table class="sv-tbl" style="margin-top:8px"><thead><tr><th>절</th><th>글자</th></tr></thead><tbody>' + secs.map((s) => "<tr><td>" + esc(s.t.slice(0, 26)) + "</td><td>" + s.n.toLocaleString() + '<span class="pp-wbar" style="width:' + Math.round(s.n / mx * 100) + '%"></span></td></tr>').join("") + "</tbody></table></div>";
    el.onchange = (e) => { if (e.target.dataset.goal) { S.style.goal = +e.target.value || 0; draftSoon(); paintCount(); } };
  }
  function findMark() { S._fi = -1; const q = ($("rpFq") || {}).value || ""; const n = $("rpFn"); if (!q) { if (n) n.textContent = ""; return; } const c = (S.ed.innerText.match(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")) || []).length; if (n) n.textContent = c + "곳"; }
  function findNext() { const q = ($("rpFq") || {}).value || ""; if (!q) return; S.ed.focus(); if (!window.find(q, false, false, true)) toast("더 없어요"); }
  function replaceAllText() {
    const q = ($("rpFq") || {}).value || "", r = ($("rpFr") || {}).value || ""; if (!q) return; let n = 0; const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
    const w = document.createTreeWalker(S.ed, NodeFilter.SHOW_TEXT); const nodes = []; while (w.nextNode()) nodes.push(w.currentNode); nodes.forEach((t) => { const o = t.nodeValue; const v = o.replace(re, () => { n++; return r; }); if (v !== o) t.nodeValue = v; });
    afterEdit(); findMark(); toast(n + "곳 바꿨어요(Ctrl+Z 로 못 되돌려요 — 🕘 버전 사용)");
  }
  /* ---- 코멘트 ---- */
  function addComment() {
    const s = window.getSelection(); if (!s.rangeCount || s.isCollapsed) return toast("코멘트 달 글을 고르세요"); const t = prompt("코멘트", ""); if (!t || !t.trim()) return;
    const id = "c" + uid(); const r = s.getRangeAt(0); const span = document.createElement("span"); span.className = "rp-cm"; span.dataset.cid = id;
    try { r.surroundContents(span); } catch (e) { span.appendChild(r.extractContents()); r.insertNode(span); }
    S.comments.push({ id: id, text: t.trim(), quote: span.textContent.slice(0, 200), t: Date.now(), done: false, by: (window.SERVER && SERVER.user && SERVER.user.name) || "" });
    afterEdit(); if (S.side === "cmts") paintCmts(); badge(); toast("코멘트를 달았어요");
  }
  function badge() { const b = $("rpB_cmts"); if (b) { const n = S.comments.filter((c) => !c.done).length; b.textContent = n ? String(n) : ""; b.className = "pp-badge" + (n ? " info" : ""); } }
  function paintCmts() {
    const el = $("rpCmts"); if (!el) return; badge();
    el.innerHTML = '<div style="padding:8px;display:flex;flex-direction:column;gap:8px">' + (S.comments.length ? S.comments.slice().reverse().map((c) => '<div class="pp-cm' + (c.done ? " done" : "") + '" data-cmc="' + c.id + '"><div class="pp-cm-h"><a href="#" data-cgo="' + c.id + '">“' + esc((c.quote || "").slice(0, 40)) + "”</a><small>" + esc(c.by || "") + " " + fmtT(c.t) + "</small></div><p>" + esc(c.text) + '</p><div class="pp-cm-a"><button type="button" data-cai="' + c.id + '">✨ AI 로 반영</button><button type="button" data-cdone="' + c.id + '">' + (c.done ? "다시 열기" : "✓ 해결") + '</button><button type="button" data-cdel="' + c.id + '">✕</button></div></div>').join("") : '<p class="sh-muted">글을 고르고 💬 로 코멘트를 달아요. 검토자 의견·나에게 남기는 할 일로 써요.</p>') + "</div>";
    el.onclick = (e) => {
      const g = (id) => S.comments.find((x) => x.id === id), span = (id) => S.ed.querySelector('.rp-cm[data-cid="' + id + '"]'); let b;
      if ((b = e.target.closest("[data-cgo]"))) { e.preventDefault(); const sp = span(b.dataset.cgo); if (sp) { sp.scrollIntoView({ block: "center", behavior: "smooth" }); sp.classList.add("rp-flash"); setTimeout(() => sp.classList.remove("rp-flash"), 1400); } }
      if ((b = e.target.closest("[data-cdone]"))) { const c = g(b.dataset.cdone); c.done = !c.done; const sp = span(c.id); if (sp) sp.classList.toggle("done", c.done); afterEdit(); paintCmts(); }
      if ((b = e.target.closest("[data-cdel]"))) { const sp = span(b.dataset.cdel); if (sp) sp.replaceWith(...sp.childNodes); S.comments = S.comments.filter((x) => x.id !== b.dataset.cdel); afterEdit(); paintCmts(); }
      if ((b = e.target.closest("[data-cai]"))) { const c = g(b.dataset.cai); const sp = span(c.id); let blk = sp; while (blk && blk.parentNode !== S.ed) blk = blk.parentNode; aiSend("이 코멘트를 반영해 고쳐 줘: “" + c.text + "” (대상 글: “" + c.quote + "”)", { at: blk && blk.dataset.b, cmt: c.id }); }
    };
  }
  /* ---- 버전(서버) ---- */
  async function paintHist() {
    const el = $("rpHist"); if (!el) return; let l = []; try { l = (await RND.ws.req("versions", { pid: S.pid, did: S.did })).list || []; } catch (e) { el.innerHTML = '<p class="lb-warn">' + esc(e.message) + "</p>"; return; }
    el.innerHTML = '<div style="padding:8px"><div class="pp-hn"><button type="button" class="primary small-btn" data-rp="ver">💾 지금 버전 저장</button><small class="sh-muted">작업본은 바로바로 계정에 저장되고, 버전은 저장을 누를 때·10분마다·AI 작업 전에 서버에 남아요.</small></div><div class="pp-tl">' +
      l.slice().reverse().map((v) => '<div class="pp-tv' + (/자동|AI/.test(v.note || "") ? " auto" : "") + '"><i></i><div><b>v' + v.v + " " + esc(v.note || "") + "</b><small>" + fmtT(v.saved) + " · 절 " + (v.sections || "?") + '</small><div class="pp-tv-a"><button type="button" data-vd="' + v.v + '">비교</button><button type="button" data-vr="' + v.v + '">되돌리기</button></div></div></div>').join("") + "</div></div>";
    el.onclick = async (e) => {
      let b; if ((b = e.target.closest("[data-vd]"))) { const d = (await RND.ws.req("doc", { pid: S.pid, did: S.did, v: b.dataset.vd })).doc; const tmp = document.createElement("div"); tmp.innerHTML = d.html || sectionsToHtml(d.sections); const a = Array.from(tmp.children).map(blockToMd).join("\n\n"); const dd = window.PAPERKIT ? PAPERKIT.diff(a, docMd()) : []; modal("v" + d.v + " ↔ 지금", window.PAPERKIT ? '<p class="sh-muted">초록 = 지금 더해진 줄 · 빨강 = 지금 없어진 줄</p>' + PAPERKIT.diffHtml(dd) : "", null, true); }
      if ((b = e.target.closest("[data-vr]"))) { if (!confirm("v" + b.dataset.vr + " 로 되돌릴까요? (지금 상태도 먼저 버전으로 남겨요)")) return; await saveVersion("되돌리기 전", true); const d = (await RND.ws.req("doc", { pid: S.pid, did: S.did, v: b.dataset.vr })).doc; S.ed.innerHTML = sanitize(d.html || sectionsToHtml(d.sections)); if (d.style) S.style = Object.assign({}, DEF_STYLE, d.style); S.comments = d.comments || []; renderMath(); applyStyle(); afterEdit(); toast("v" + d.v + " 로 되돌렸어요"); }
    };
  }
  /* ---- 🧰 보고서 도구(연구 도구를 이 문서 대상으로) ---- */
  const TOOL_IDS = ["templates", "abstract", "boiler", "snips", "review", "suggest", "confid", "claimmap", "consistency", "conflict", "rubric", "reader", "prose", "briefs", "count", "diff", "citecheck", "translate", "glossary", "kpi", "budget", "schedule", "logic", "risk", "reqmap"];   // (v107) 글 검토·다듬기 · 수치·일정·예산 메뉴를 이 칸으로 합침
  let origCtx = null;
  function patchCtx(on) {   // 연구 도구는 RND.ctx() 로 '지금 작업 문서'를 읽는다 → 보고서 화면에서는 이 편집기를 보게 한다
    if (!window.RND || !RND.ctx) return; if (!origCtx) origCtx = RND.ctx;
    if (!on) { RND.ctx = origCtx; return; }
    RND.ctx = function () {
      const vis = $("rp2") && $("hub_rx_report") && !$("hub_rx_report").classList.contains("hidden"); const base = origCtx(); if (!vis || !base || base.pid !== S.pid || !S.ed) return base;
      const doc = { id: S.did, title: S.title, kind: "report", sections: htmlToSections(S.ed) };
      return Object.assign({}, base, {
        doc: () => doc, did: () => S.did, docText: () => "# " + S.title + "\n\n" + docMd(),
        toDoc: (title, md) => { insertHtml("<h2>" + esc(title || "도구 결과") + "</h2>" + mdToHtml(md), true); toast("문서에 넣었어요"); },
        setSection: (i, body) => { const secs = sectionHeads(); const h = secs[i]; if (!h) return false; replaceSection(h, "# " + h.textContent + "\n\n" + body); return true; },
        newDocFrom: (heads) => { insertHtml(heads.map((h) => "<h1>" + esc(h) + "</h1><p><br></p>").join(""), true); },
      });
    };
  }
  function paintTools() {
    const el = $("rpTools"); if (!el) return; if (!window.TOOLSETS || !TK.mount) { el.innerHTML = '<p class="sh-muted">도구를 불러오지 못했어요.</p>'; return; }
    const all = TOOLSETS.RND_TOOLS || []; const tools = TOOL_IDS.map((id) => all.find((t) => t.id === id)).filter(Boolean);
    el.innerHTML = '<div class="rp-tq"><b>지금 문서로 바로 실행</b><p class="sh-muted">결과는 아래에, ‘문서에 넣기’ 하면 커서 자리로. 고쳐 쓰기 도구는 이 문서의 절을 직접 바꿔요.</p></div><div id="rpTk"></div>';
    RND.prepare(S.pid).then(() => { patchCtx(true); TK.mount($("rpTk"), { id: "rpTools", title: "보고서 도구", intro: "", tools: tools }); }).catch((e) => { el.innerHTML = '<p class="lb-warn">' + esc(e.message) + "</p>"; });
  }
  function sectionHeads() { return Array.from(S.ed.children).filter((b) => /^H[12]$/.test(b.tagName)); }

  /* ================================================================== 내보내기 */
  function exportHtml() {
    const c = S.ed.cloneNode(true); c.querySelectorAll(".rp-cm").forEach((s) => s.replaceWith(...s.childNodes)); c.querySelectorAll("[data-b]").forEach((x) => x.removeAttribute("data-b")); c.querySelectorAll("[contenteditable]").forEach((x) => x.removeAttribute("contenteditable"));
    return c;
  }
  async function svgToPng(svg) { return new Promise((res) => { const img = new Image(); const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }); const u = URL.createObjectURL(blob); img.onload = () => { const c = document.createElement("canvas"); c.width = 1280; c.height = Math.round(1280 * (img.height / img.width || 0.53)); const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u); res(c.toDataURL("image/png")); }; img.onerror = () => res(null); img.src = u; }); }
  async function expDocx() {
    const c = exportHtml(); for (const f of Array.from(c.querySelectorAll("figure.rp-chart"))) { const svg = f.querySelector("svg"); const png = svg ? await svgToPng(svg) : null; if (png) { const im = document.createElement("img"); im.src = png; im.dataset.w = "85"; svg.replaceWith(im); f.className = "rp-fig"; } }
    toast("Word 파일을 만드는 중…", 6000);
    try {
      const r = await RND.ws.req("rexport", { pid: S.pid, mid: "w" }, { html: c.innerHTML, title: S.title, style: S.style, name: S.title || "보고서" });
      const a = document.createElement("a"); a.href = RND.ws.url("out", { pid: S.pid, name: r.name }); a.download = r.name; document.body.appendChild(a); a.click(); a.remove(); toast("Word 로 내보냈어요(" + Math.round(r.size / 1024) + "KB) — 프로젝트 내보낸 파일에도 있어요");
    } catch (e) { toast("Word 로 못 만들었어요: " + e.message, 5000); }
  }
  function printPdf() {
    const c = exportHtml(); const p = $("rpPaper");
    // (v125) 인쇄 품질: 표가 쪽을 넘으면 머리행 반복, 쪽 머리글·바닥글·번호, 표지 쪽에는 번호 없음
    c.querySelectorAll("table").forEach((t) => { if (t.tHead) return; const r = t.rows[0]; if (r && r.cells.length && Array.from(r.cells).every((x) => x.tagName === "TH")) { const h = t.createTHead(); h.appendChild(r); } });
    const q = (x) => '"' + String(x || "").replace(/\\/g, "").replace(/"/g, "'") + '"';
    const cover = !!c.querySelector(".rp-cover"), st = S.style;
    const box = "font-size:9pt;color:#555;font-family:inherit";
    const pageCss = "@page{size:A4 " + (st.landscape ? "landscape" : "portrait") + ";margin:" + (st.margin || 20) + "mm;@top-center{content:" + q(st.hdr) + ";" + box + "}@bottom-center{content:" + q((st.ftr ? st.ftr + "   " : "")) + (st.pageNum === false ? "" : ' counter(page)') + ";" + box + "}}" + (cover ? "@page:first{@top-center{content:none}@bottom-center{content:none}}" : "");
    const printCss = "html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact}thead{display:table-header-group}tr,figure.rp-chart,.rp-box{break-inside:avoid}h1,h2,h3,h4,figcaption{break-after:avoid}";
    const css = Array.from(document.styleSheets).map((s) => { try { return Array.from(s.cssRules).map((r) => r.cssText).filter((t) => /rp-|katex/.test(t)).join("\n"); } catch (e) { return ""; } }).join("\n");
    const w = window.open("", "_blank"); if (!w) return toast("팝업이 막혔어요 — 허용해 주세요");
    w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>' + esc(S.title) + '</title><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css"><style>' + css + pageCss + printCss + "body{margin:0;background:#fff}.rp-paper{box-shadow:none!important;width:auto!important;min-height:0!important;padding:0!important;margin:0!important;background:none!important;transform:none!important}.rp-pb{break-after:page;border:0!important;height:0!important;margin:0!important}.rp-pb::after{display:none!important}</style></head><body><div class=\"rp-paper\" data-design=\"" + (st.design || "standard") + "\" data-num=\"" + p.dataset.num + '" style="' + p.getAttribute("style") + '"><div class="rp-ed">' + (cover ? "" : '<h1 class="rp-doctitle">' + esc(S.title) + "</h1>") + c.innerHTML + "</div></div><script>setTimeout(function(){print()},600)<\/script></body></html>");
    w.document.close();
  }
  function expMenu(x, y) {
    popMenu([["📄 Word(DOCX) — 서식 그대로", expDocx], ["🖨 PDF (인쇄 → PDF 로 저장)", printPdf], ["🌐 HTML", () => TK.download((S.title || "보고서") + ".html", '<!doctype html><meta charset="utf-8"><title>' + esc(S.title) + "</title><h1>" + esc(S.title) + "</h1>" + exportHtml().innerHTML, "text/html")], ["Ⓜ Markdown", () => TK.download((S.title || "보고서") + ".md", "# " + S.title + "\n\n" + docMd(), "text/markdown")], "-", ["📦 작업 문서 내보내기(PPTX 등)", async () => { await saveVersion("내보내기 전", true); try { const r = await RND.ws.req("export", { pid: S.pid, did: S.did, fmt: "pptx" }, {}); const a = document.createElement("a"); a.href = RND.ws.url("out", { pid: S.pid, name: r.name }); a.download = r.name; document.body.appendChild(a); a.click(); a.remove(); toast("발표 자료(PPTX)로 만들었어요 — 절마다 한 장"); } catch (e) { toast(e.message, 5000); } }]], x, y);
  }

  /* ================================================================== AI — 인라인(고른 글) */
  async function inlineAI(kind) {
    const s = window.getSelection(); if (!s.rangeCount || s.isCollapsed) return; const range = s.getRangeAt(0).cloneRange(); const src = s.toString(); let ins = "";
    if (kind === "ask") { ins = prompt("고른 부분을 어떻게 고칠까요?", ""); if (!ins) return; }
    const T = { pol: "보고서 문체로 다듬으세요(뜻·수치는 그대로, 군더더기 없이).", gae: "개조식으로 바꾸세요. 줄마다 □(큰 항목)·○(작은 항목)·-(세부)로 시작하고 명사형으로 끝내세요(~함, ~임, ~필요).", prose: "개조식·목록을 자연스러운 문장 문단으로 풀어 쓰세요.", short: "뜻을 지키며 절반 정도로 줄이세요.", long: "근거·예시를 더해 1.5~2배로 늘리되 없는 수치는 지어내지 마세요([TODO] 로 표시).", table: "표로 정리하세요(마크다운 표, 첫 줄 머리글).", easy: "중학생도 이해할 쉬운 말로 바꾸세요.", en: "자연스러운 업무 영어로 옮기세요.", ask: "다음 지시대로 고치세요: " + ins };
    const g = await gateAction({ action: "tools", cost: 1 }); if (!g.ok) return toast(gateMessage(g), 5000);
    let el = $("rpInl"); if (!el) { el = document.createElement("div"); el.id = "rpInl"; el.className = "pp-inline rp-inl"; document.body.appendChild(el); }
    const r = range.getBoundingClientRect(); el.style.left = Math.max(8, Math.min(window.innerWidth - 520, r.left)) + "px"; el.style.top = Math.min(window.innerHeight - 260, r.bottom + 8) + "px"; el.classList.add("on");
    el.innerHTML = '<div class="pp-in-h"><b>✨ ' + esc({ pol: "다듬기", gae: "개조식으로", prose: "문장으로", short: "줄이기", long: "늘리기", table: "표로", easy: "쉬운 말로", en: "영어로", ask: "지시" }[kind]) + '</b><span class="lb-dots"><i></i><i></i><i></i></span></div><div class="pp-in-b"></div><div class="pp-in-a"></div>';
    let out = "";
    try { out = await llmStreamChat([{ role: "system", content: "당신은 한국어 업무 보고서 편집자입니다. 결과 글만 출력하세요(설명·코드펜스 없이). 목록은 마크다운(□ ○ - 또는 - ), 표는 마크다운 표. 수치를 지어내지 마세요." }, { role: "user", content: T[kind] + "\n\n" + src }], (d, full) => { el.querySelector(".pp-in-b").textContent = full; }, { temperature: 0.3, maxTokens: 2500 }); } catch (e) { el.querySelector(".pp-in-b").textContent = "⚠ " + e.message; }
    out = String(out || "").replace(/^```\w*\n?|```\s*$/g, "").trim(); const dots = el.querySelector(".lb-dots"); if (dots) dots.remove();
    const structured = /^(\s*[□○■●\-·*]\s|\s*\|)/m.test(out) || kind === "gae" || kind === "table";
    el.querySelector(".pp-in-b").innerHTML = structured ? '<div class="rp-inprev">' + mdToHtml(out) + "</div>" : (window.PAPERKIT ? wordDiff(src, out) : esc(out));
    el.querySelector(".pp-in-a").innerHTML = '<button type="button" class="primary small-btn" data-in="ok">바꾸기</button><button type="button" class="ghost-btn small-btn" data-in="below">아래에 넣기</button><button type="button" class="ghost-btn small-btn" data-in="no">취소</button>';
    el.onclick = (e) => {
      const b = e.target.closest("[data-in]"); if (!b) return; el.classList.remove("on"); if (b.dataset.in === "no") return;
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
      if (b.dataset.in === "ok") { if (structured) { const blk = (() => { let n = range.startContainer; if (n.nodeType === 3) n = n.parentNode; while (n && n.parentNode !== S.ed) n = n.parentNode; return n; })(); range.deleteContents(); const t = document.createElement("template"); t.innerHTML = mdToHtml(out); const nodes = Array.from(t.content.childNodes); let ref = blk; nodes.forEach((n) => { if (ref && ref.parentNode === S.ed) { ref.after(n); ref = n; } else S.ed.appendChild(n); }); if (blk && !blk.textContent.trim()) blk.remove(); afterEdit(); } else { document.execCommand("insertText", false, out); afterEdit(); } }
      else { let n = range.endContainer; if (n.nodeType === 3) n = n.parentNode; while (n && n.parentNode !== S.ed) n = n.parentNode; const t = document.createElement("template"); t.innerHTML = structured ? mdToHtml(out) : "<p>" + esc(out) + "</p>"; const nodes = Array.from(t.content.childNodes); let ref = n; nodes.forEach((x) => { if (ref) { ref.after(x); ref = x; } }); afterEdit(); }
    };
  }
  function wordDiff(a, b) { const ta = a.split(/(\s+)/), tb = b.split(/(\s+)/); if (ta.length * tb.length > 1.2e6) return esc(b); return PAPERKIT.diff(ta.join("\n"), tb.join("\n")).map((x) => (x[0] === "=" ? esc(x[1]) : x[0] === "+" ? "<ins>" + esc(x[1]) + "</ins>" : "<del>" + esc(x[1]) + "</del>")).join(""); }
  async function aiContinue(b) {
    const g = await gateAction({ action: "tools", cost: 1 }); if (!g.ok) return toast(gateMessage(g), 5000);
    ensureIds(); const before = Array.from(S.ed.children); const i = before.indexOf(b); const ctx = before.slice(Math.max(0, i - 12), i).map(blockToMd).join("\n\n");
    const p = document.createElement("div"); p.className = "rp-ghost"; p.textContent = "✨ 쓰는 중…"; b.after(p);
    let out = ""; try { out = await llmStreamChat([{ role: "system", content: "당신은 한국어 보고서 공동 작성자입니다. 앞 내용에 이어질 다음 부분만 마크다운(개조식 □○-, 표, 문단)으로 쓰세요. 설명 없이. 수치를 지어내지 말고 필요하면 [TODO]." }, { role: "user", content: "[문서 제목] " + S.title + "\n[앞 내용]\n" + ctx + "\n\n위에 자연스럽게 이어지는 2~4개 항목(또는 1~2문단)을 쓰세요." }], (d, full) => { p.innerHTML = mdToHtml(full) || "✨ 쓰는 중…"; }, { temperature: 0.5, maxTokens: 1500 }); } catch (e) { p.textContent = "⚠ " + e.message; return; }
    const t = document.createElement("template"); t.innerHTML = mdToHtml(out); const nodes = Array.from(t.content.childNodes); let ref = p; nodes.forEach((n) => { ref.after(n); ref = n; }); p.remove(); if (!b.textContent.trim()) b.remove(); afterEdit();
  }

  /* ================================================================== ✨ AI 작성 보조 대화(블록을 직접 고친다) */
  const AI_SYS = [
    "당신은 한국어 업무·연구 보고서 공동 작성자입니다. 사용자의 문서를 블록 단위로 직접 고칠 수 있습니다. 문서의 각 블록 앞에는 [b아이디] 가 붙어 있습니다.",
    "답은 반드시 아래 형식으로만:",
    "<reply>사용자에게 할 말(짧게: 무엇을 왜 바꿨는지)</reply>",
    "그리고 필요한 만큼 작업 태그(내용은 마크다운):",
    "<replace block=\"b아이디\">새 내용(블록 하나를 여러 블록으로 바꿔도 됨)</replace>",
    "<insert after=\"b아이디\">넣을 내용</insert>  또는 <insert before=\"b아이디\">…</insert>  (블록 아이디 없이 <insert>…</insert> 면 문서 끝)",
    "<section block=\"제목 블록 아이디\">그 절 전체를 새로 쓴 내용(제목 줄 포함)</section>   ← 제목부터 다음 같은/윗 수준 제목 전까지를 통째로 바꿈",
    "<delete block=\"b아이디\"/>   <title>새 문서 제목</title>   <search_materials query=\"…\"/> ← 연구 프로젝트 자료(PDF 등)에서 근거 찾기(다음 차례에 결과)",
    "마크다운 규칙: # 제목1 · ## 제목2 · ### 제목3 · 개조식은 줄 앞에 □(큰 항목)·○(작은 항목)·-(세부)·(들여쓰기로 단계) · 번호 목록 1. · 표는 | 칸 | (바로 윗줄에 '<표> 제목' 을 쓰면 캡션) · 상자는 ::: 요약|참고|주의|결론 (제목) … ::: · 굵게 **…** · 각주 ^[내용]",
    "규칙: 보고서 문체(개조식은 명사형 종결 ~함·~임·~필요). 수치·사실을 지어내지 말고 모르면 [TODO: …]. 자료 근거가 필요하면 먼저 search_materials. 바꾸지 않을 블록은 건드리지 마세요. '[그림]' 으로 보이는 그림·차트 블록은 다시 만들 수 없으니 replace·delete 하지 마세요. 질문·검토만 원하면 작업 태그 없이 <reply> 만.",
  ].join("\n");
  const QUICK = [["요약 상자 만들기", "문서 전체를 읽고 맨 앞에 '요약' 상자(::: 요약)를 개조식 3~5줄로 만들어 줘."], ["개조식으로 정리", "본문 문단들을 보고서 개조식(□○-)으로 정리해 줘. 뜻과 수치는 그대로."], ["표로 정리", "수치·비교가 들어간 부분을 찾아 표로 정리해 줘(캡션 포함)."], ["빈 곳 채우기(자료 근거)", "[TODO] 와 빈 절을 찾아 프로젝트 자료에서 근거를 찾아 채워 줘. 자료에 없으면 [TODO] 로 남겨."], ["결론·제언 쓰기", "본문을 바탕으로 결론 및 제언 절을 써 줘(결론 상자 포함)."], ["문체 통일", "문서 전체의 문체를 보고서 문체로 통일해 줘(개조식 종결·용어 일관)."], ["검토 의견", "상급자·심사자 입장에서 이 보고서의 약점·누락·근거 부족을 지적해 줘(고치지는 말고)."], ["1쪽 요약본", "이 보고서를 결재용 1쪽 요약으로 만들어 문서 끝에 '1쪽 요약' 절로 넣어 줘."], ["제목·소제목 다듬기", "제목과 소제목을 내용이 드러나게 다듬어 줘."], ["분량 줄이기", "전체 분량을 30% 줄여 줘. 핵심·수치는 남기고."]];
  function paintAi() {
    const el = $("rpAi"); if (!el) return;
    el.innerHTML = '<div class="pp-aih"><b>✨ 작성 보조 AI</b><span class="pp-aim">블록 직접 고침 · 되돌리기</span><button type="button" class="pp-ib" data-rp="aiclear" title="대화 지우기">🧹</button><button type="button" class="pp-ib" data-rp="ai" title="닫기">✕</button></div><div class="pp-ail" id="rpAiL"></div>' +
      '<div class="pp-aiq"><div class="pp-aichips">' + QUICK.map((q, i) => '<button type="button" data-aq="' + i + '">' + esc(q[0]) + "</button>").join("") + '</div><div class="pp-aictx" id="rpAiCtx"></div><div class="pp-aiin"><textarea id="rpAiQ" rows="2" placeholder="무엇을 할까요? 예) 2장을 개조식으로 · 추진 일정 표 만들어 줘 · 서론에 배경 수치 넣어 줘(자료 근거)"></textarea><button type="button" class="primary" data-rp="aisend" aria-label="보내기">↑</button></div></div>';
    paintMsgs(); const ta = $("rpAiQ"); ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); const v = ta.value.trim(); if (v) { ta.value = ""; aiSend(v); } } }); ta.addEventListener("focus", aiCtx); aiCtx();
  }
  function aiCtx() { const el = $("rpAiCtx"); if (!el) return; const sel = S.savedRange && !S.savedRange.collapsed ? S.savedRange.toString() : ""; const b = curBlock(); el.innerHTML = "<span>📝 " + esc((S.title || "").slice(0, 24)) + "</span>" + (b ? "<span>👁 " + esc(b.tagName.toLowerCase()) + " 블록</span>" : "") + (sel ? "<span>✂ 고른 글 " + sel.length + "자</span>" : "") + "<span>블록 " + (S.ed ? S.ed.children.length : 0) + "</span>"; }
  function paintMsgs() {
    const el = $("rpAiL"); if (!el) return;
    if (!S.msgs.length) { el.innerHTML = '<div class="pp-aiempty"><span>✨</span><b>말로 보고서를 써 나가세요</b><p>AI 가 문서의 블록(문단·개조식·표·상자)을 직접 고치고 넣어요. 바꾼 곳은 문서에서 빛나고, 차례마다 <b>↩ 되돌리기</b>.</p><p class="sh-muted">글을 고르면 그 부분만, 연구 자료(PDF)에서 근거를 찾아 써요.</p></div>'; return; }
    el.innerHTML = S.msgs.map((m, i) => {
      if (m.role === "user") return '<div class="pp-m u"><div>' + esc(m.text) + (m.sel ? "<q>" + esc(m.sel.slice(0, 140)) + "</q>" : "") + "</div></div>";
      if (m.role === "sys") return '<div class="pp-m s">' + esc(m.text) + "</div>";
      const ch = (m.changes || []).map((c) => '<div class="pp-chg k-' + c.kind + '"><i>' + ({ replace: "✎", insert: "＋", section: "§", delete: "🗑", title: "T" }[c.kind] || "•") + "</i><span>" + esc(c.label || "") + "</span>" + (c.id ? '<button type="button" data-bgo="' + esc(c.id) + '">보기</button>' : "") + "</div>").join("");
      const st = (m.steps || []).map((s) => '<div class="pp-step">' + esc(s) + "</div>").join("");
      const foot = !m.busy && m.turn && S.turns[m.turn] && (m.changes || []).length ? '<div class="pp-mfoot"><button type="button" data-cundo="' + esc(m.turn) + '">↩ 이 차례 되돌리기</button></div>' : "";
      return '<div class="pp-m a"><div class="pp-mb2">' + (m.busy && !m.text ? '<span class="lb-dots"><i></i><i></i><i></i></span> ' + esc(m.busyText || "생각하는 중…") : TK.md(m.text || "")) + (m.busy && m.text ? ' <span class="lb-dots"><i></i><i></i><i></i></span>' : "") + "</div>" + st + (ch ? '<div class="pp-chgs">' + ch + "</div>" : "") + foot + "</div>";
    }).join(""); el.scrollTop = el.scrollHeight;
  }
  function paintMsg() { clearTimeout(paintMsg.t); paintMsg.t = setTimeout(paintMsgs, 60); }
  function docForAI(at) {
    ensureIds(); const blocks = Array.from(S.ed.children); let total = 0; const lines = [];
    blocks.forEach((b) => { let md = blockToMd(b); if (md.length > 4000) md = md.slice(0, 4000) + " …(생략)"; total += md.length; lines.push("[" + b.dataset.b + "]" + (b.dataset.b === at ? " ◀ 커서" : "") + " " + md); });
    let txt = lines.join("\n"); if (txt.length > 60000) txt = txt.slice(0, 60000) + "\n…(뒤 생략)";
    return txt;
  }
  function parseAgent(t) {
    const ops = []; let reply = ""; const rm = /<reply>([\s\S]*?)(<\/reply>|$)/.exec(t); if (rm) reply = rm[1].trim();
    const re = /<(replace|section)\s+block="([^"]+)"\s*>([\s\S]*?)<\/\1>|<insert(?:\s+(after|before)="([^"]+)")?\s*>([\s\S]*?)<\/insert>|<delete\s+block="([^"]+)"\s*\/?>|<title>([\s\S]*?)<\/title>|<search_materials\s+query="([^"]*)"\s*\/?>/g; let m;
    while ((m = re.exec(t))) { if (m[1]) ops.push({ op: m[1], id: m[2], md: m[3].trim() }); else if (m[6] != null) ops.push({ op: "insert", where: m[4] || "end", id: m[5] || "", md: m[6].trim() }); else if (m[7]) ops.push({ op: "delete", id: m[7] }); else if (m[8] != null) ops.push({ op: "title", text: m[8].trim() }); else if (m[9] != null) ops.push({ op: "search", q: m[9] }); }
    if (!reply) reply = t.replace(re, "").replace(/<\/?reply>/g, "").trim(); return { reply: reply, ops: ops };
  }
  function liveReply(f) { const r = /<reply>([\s\S]*?)(<\/reply>|$)/.exec(f); if (r) return r[1]; const i = f.search(/<(replace|section|insert|delete|title|search_)/); return (i >= 0 ? f.slice(0, i) : f).replace(/<\/?reply>?/g, ""); }
  const byId = (id) => S.ed.querySelector(':scope > [data-b="' + id + '"]');
  function nodesFrom(md) { const t = document.createElement("template"); t.innerHTML = sanitize(mdToHtml(md)); return Array.from(t.content.childNodes).filter((n) => n.nodeType === 1); }
  function mark(nodes) { nodes.forEach((n) => { n.classList.add("rp-ainew"); setTimeout(() => n.classList.remove("rp-ainew"), 5000); }); }
  function replaceSection(h, md) { const lv = +h.tagName[1]; const list = [h]; let n = h.nextElementSibling; while (n && !(/^H[1-4]$/.test(n.tagName) && +n.tagName[1] <= lv)) { list.push(n); n = n.nextElementSibling; } const nodes = nodesFrom(md); let ref = h; nodes.forEach((x) => { ref.before(x); }); list.forEach((x) => x.remove()); ensureIds(); mark(nodes); return nodes; }
  async function applyOp(o) {
    if (o.op === "title") { S.title = o.text.slice(0, 200); $("rpTitle").value = S.title; $("rpDT").textContent = S.title; return { change: { kind: "title", label: "제목: " + S.title } }; }
    if (o.op === "search") { try { await RND.prepare(S.pid); const c = origCtx ? origCtx() : RND.ctx(); const ch = await c.retrieve(o.q || "", 7, 7000); return { info: "[자료 검색: " + o.q + "]\n" + (c.ground(ch) || "(찾은 자료 없음)"), step: "🔎 자료 검색: " + o.q + " — " + (ch ? ch.length : 0) + "건" }; } catch (e) { return { info: "[자료 검색 실패] " + e.message }; } }
    const b = o.id ? byId(o.id) : null;
    if (o.op === "replace") { if (!b) return { error: "replace: 없는 블록 " + o.id }; const nodes = nodesFrom(o.md); let ref = b; nodes.forEach((x) => { ref.after(x); ref = x; }); b.remove(); ensureIds(); mark(nodes); return { change: { kind: "replace", label: (nodes[0] ? nodes[0].textContent.slice(0, 40) : "") + " 고침", id: nodes[0] && nodes[0].dataset.b } }; }
    if (o.op === "section") { if (!b || !/^H[1-4]$/.test(b.tagName)) return { error: "section: 제목 블록이 아니에요 " + o.id }; const nodes = replaceSection(b, o.md); return { change: { kind: "section", label: "절 다시 씀: " + (nodes[0] ? nodes[0].textContent.slice(0, 30) : ""), id: nodes[0] && nodes[0].dataset.b } }; }
    if (o.op === "insert") { const nodes = nodesFrom(o.md); if (!nodes.length) return {}; if (b && o.where === "before") nodes.forEach((x) => b.before(x)); else if (b) { let ref = b; nodes.forEach((x) => { ref.after(x); ref = x; }); } else nodes.forEach((x) => S.ed.appendChild(x)); ensureIds(); mark(nodes); return { change: { kind: "insert", label: (nodes[0].textContent || "").slice(0, 40) + " 넣음 (" + nodes.length + "블록)", id: nodes[0].dataset.b } }; }
    if (o.op === "delete") { if (!b) return { error: "delete: 없는 블록 " + o.id }; const lab = b.textContent.slice(0, 40); b.remove(); return { change: { kind: "delete", label: lab + " 지움" } }; }
    return { error: "모르는 작업 " + o.op };
  }
  async function aiSend(text, opt) {
    if (S.busyAI || !S.ed) return; opt = opt || {};
    const g = await gateAction({ action: "tools", cost: 1 }); if (!g.ok) { S.msgs.push({ role: "sys", text: gateMessage(g), t: Date.now() }); paintMsgs(); return; }
    S.front = "ai"; S.ai = true; grid(); if (!$("rpAiL")) paintAi();
    const sel = S.savedRange && !S.savedRange.collapsed ? S.savedRange.toString() : ""; const b = curBlock() || (S.savedRange ? (() => { let n = S.savedRange.startContainer; if (n.nodeType === 3) n = n.parentNode; while (n && n.parentNode !== S.ed) n = n.parentNode; return n; })() : null);
    const at = opt.at || (b && b.dataset.b);
    const turnId = "t" + uid(); S.turns[turnId] = { html: S.ed.innerHTML, title: S.title };
    if (S.dirtySrv) saveVersion("AI 작업 전", true);
    const hist = S.msgs.filter((m) => m.role !== "sys").slice(-8).map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.role === "user" ? m.text : "<reply>" + (m.text || "") + "</reply>" }));
    S.msgs.push({ role: "user", text: text, sel: sel, t: Date.now() }); const am = { role: "ai", text: "", changes: [], steps: [], busy: true, turn: turnId, t: Date.now() }; S.msgs.push(am); paintMsgs();
    S.busyAI = true;
    const convo = [{ role: "system", content: AI_SYS }].concat(hist).concat([{ role: "user", content: "[문서 제목] " + S.title + "\n[문서 서식] 제목 번호 " + S.style.numbering + "\n[문서 — 블록 목록]\n" + docForAI(at) + (sel ? "\n\n[사용자가 고른 글]\n" + sel : "") + "\n\n[요청]\n" + text }]);
    const replies = [];
    try {
      for (let round = 0; round < 5; round++) {
        let full = ""; const acc = await llmStreamChat(convo, (d, f) => { full = f; am.text = replies.concat([liveReply(f)]).filter(Boolean).join("\n\n"); paintMsg(); }, { temperature: 0.35, maxTokens: 7000 });
        full = String(acc || full || ""); const pa = parseAgent(full); if (pa.reply) replies.push(pa.reply); am.text = replies.join("\n\n");
        const results = [];
        for (const o of pa.ops) { const r = await applyOp(o); if (r.change) am.changes.push(r.change); if (r.step) am.steps.push(r.step); if (r.info) results.push(r.info); if (r.error) results.push("[실패] " + r.error); paintMsg(); }
        if (am.changes.length) { renderMath(); afterEdit(); }
        if (!results.length) break;
        convo.push({ role: "assistant", content: full }); convo.push({ role: "user", content: "[도구 결과]\n" + results.join("\n\n") + "\n\n[지금 문서 — 블록 목록]\n" + docForAI(at) + "\n\n이어서 작업하세요. 끝났으면 <reply> 로 마무리만." });
      }
    } catch (e) { am.text = (am.text ? am.text + "\n\n" : "") + "⚠ " + e.message; }
    am.busy = false; S.busyAI = false;
    if (opt.cmt && am.changes.length) { const c = S.comments.find((x) => x.id === opt.cmt); if (c) c.done = true; paintCmts(); }
    paintMsgs(); saveDraft(); if (S.side === "out" || S.side === "count") paintSide();
    const first = am.changes.find((c) => c.id); if (first) { const n = byId(first.id); if (n) n.scrollIntoView({ behavior: "smooth", block: "center" }); }
  }
  function undoTurn(id) { const t = S.turns[id]; if (!t) return; S.ed.innerHTML = t.html; S.title = t.title; $("rpTitle").value = S.title; $("rpDT").textContent = S.title; delete S.turns[id]; renderMath(); afterEdit(); S.msgs.forEach((m) => { if (m.turn === id) { m.text += "\n\n↩ 이 차례에서 바꾼 것을 되돌렸어요."; m.turn = null; } }); paintMsgs(); toast("되돌렸어요"); }

  /* ================================================================== 상태 줄·클릭 */
  function stat(kind, text) {
    if (kind === "save") { const s = $("rpSave"); if (s) s.textContent = text; return; }
    const el = $("rpStatus"); if (!el || !S.ed) return; const txt = S.ed.innerText || ""; const ch = txt.replace(/\s/g, "").length; const b = curBlock();
    const cp = caretPage();
    el.innerHTML = "<span>📝 " + esc(S.title || "") + "</span><span>v" + S.v + (S.dirtySrv ? " · 저장 안 한 고침" : "") + "</span><span>쪽 " + (cp ? cp + " / " : "") + (S.pages || 1) + "</span><span>" + (b ? { H1: "제목 1", H2: "제목 2", H3: "제목 3", H4: "제목 4", P: "본문", UL: "목록", OL: "번호 목록", FIGURE: "표·그림", BLOCKQUOTE: "인용", DIV: "상자" }[b.tagName] || b.tagName : "") + '</span><span class="pp-st-c">글자 ' + ch.toLocaleString() + " · 표 " + S.ed.querySelectorAll("figure.rp-table").length + " · 그림 " + S.ed.querySelectorAll("figure.rp-fig,figure.rp-chart").length + "</span><span>" + Math.round(effZoom() * 100) + "%</span>";
  }
  async function onClick(e) {
    const t = e.target; let b;
    if ((b = t.closest("[data-rail]"))) { const k = b.dataset.rail; S.front = "side"; if (S.side === k && S.sideOpen) S.sideOpen = false; else { S.side = k; S.sideOpen = true; } PS("rp.side", S.side); PS("rp.sideOpen", S.sideOpen); paintSide(); return; }
    if ((b = t.closest("[data-doc]"))) { await openDoc(b.dataset.doc); return; }
    if ((b = t.closest("[data-aq]"))) { aiSend(QUICK[+b.dataset.aq][1]); return; }
    if ((b = t.closest("[data-cundo]"))) { if (confirm("이 차례에서 AI 가 바꾼 것을 되돌릴까요?")) undoTurn(b.dataset.cundo); return; }
    if ((b = t.closest("[data-bgo]"))) { const n = byId(b.dataset.bgo); if (n) { n.scrollIntoView({ behavior: "smooth", block: "center" }); n.classList.add("rp-flash"); setTimeout(() => n.classList.remove("rp-flash"), 1400); } return; }
    if ((b = t.closest("[data-rp]"))) {
      const k = b.dataset.rp;
      if (k === "home" || k === "close") closeDoc();
      if (k === "file") { const r = b.getBoundingClientRect(); fileMenu(r.left - 60, r.bottom + 4); }
      if (k === "zen") zenToggle();
      if (k === "view") { const r = b.getBoundingClientRect(); viewMenu(r.left - 170, r.bottom + 4); }
      if (k === "ver") { const n = await askText("버전 저장", "버전 이름(비워도 돼요 — 예: 1차 초안, 팀장 검토본)", "", "저장"); if (n != null) saveVersion(n); }
      if (k === "exp") { const r = b.getBoundingClientRect(); expMenu(r.left - 160, r.bottom + 4); }
      if (k === "ai") { S.front = "ai"; S.ai = !S.ai; PS("rp.ai", S.ai); grid(); if (S.ai) { paintAi(); setTimeout(() => { const q = $("rpAiQ"); if (q) q.focus(); }, 60); } }
      if (k === "aisend") { const q = $("rpAiQ"); const v = q.value.trim(); if (v) { q.value = ""; aiSend(v); } }
      if (k === "aiclear") { if (confirm("AI 대화를 지울까요? (문서는 그대로)")) { S.msgs = []; S.turns = {}; paintMsgs(); saveDraft(); } }
      if (k === "full") { const r = $("rp2"); if (document.fullscreenElement) document.exitFullscreen(); else if (r.requestFullscreen) r.requestFullscreen(); }
      if (k === "sideclose") { S.sideOpen = false; PS("rp.sideOpen", false); grid(); }
      if (k === "new") newDocDialog();
      if (k === "fnext") findNext();
      if (k === "frep") { if (confirm("모두 바꿀까요?")) replaceAllText(); }
    }
  }

  function build() {
    const content = document.querySelector("main.content"); if (!content || typeof EXT_VIEWS === "undefined" || !window.REPORTTPL) return;
    let a = $("hub_rx_report"); if (!a) { a = document.createElement("section"); a.id = "hub_rx_report"; a.className = "hidden"; content.appendChild(a); }
    EXT_VIEWS.rx_report = { area: a, open: () => paintReport(a).catch((er) => { a.innerHTML = '<p class="lb-warn">' + esc(er.message) + "</p>"; }) };
    new MutationObserver(() => { if (a.classList.contains("hidden")) { hideBars(); flushAll(); patchCtx(false); } else if ($("rp2")) { fitSoon(); patchCtx(true); applyHide(); } }).observe(a, { attributes: true, attributeFilter: ["class"] });
  }
  // hubs.js 가 먼저 rx_report 를 만들어 두므로, 그 뒤에 이 편집기로 바꿔 끼운다
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(build, 0)); else setTimeout(build, 30);
  document.addEventListener("visibilitychange", () => { if (document.hidden) flushAll(); });
  // (v109) 다른 화면(모의 심사실 등)에서 문서를 열고 AI 에게 고칠 일을 넘긴다
  async function goFix(pid, did, text) {
    await navTo("rx_report");
    if (S.did !== did) { if (S.did) await closeDoc(); S.pid = pid; PS("hub.rnd", pid); await openFromHome(did); }
    setTimeout(() => aiSend(text), 300);
  }
  window.REPORT = { state: () => S, md: mdToHtml, toMd: docMd, aiSend: aiSend, open: async (did) => { if (!S.ed) await paintWs(S.area); await openDoc(did); }, goFix: goFix };   // (v122) 바로 가기로 올 때는 편집기를 먼저 편다
})();
