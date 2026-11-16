/* =============================================================================
 * paper.js (v105) — 📄 논문 작성·보조: 브라우저 안 LaTeX 작업실 + 🗂 프로젝트 정보·관리
 *   화면: [아이콘 줄 | 옆 칸(파일·차례·찾기·문제·참고문헌·코멘트·버전·기호·설정) | 편집기(CodeMirror) | 미리보기(PDF·바로 보기·기록) | ✨ AI 작성 보조 대화]
 *   - 폴더 트리: 폴더·하위 폴더·버전 폴더(복제), 끌어 옮기기, 올리기(그림·zip·.tex/.bib), 본문 파일 고르기
 *   - 편집기: 문법 색·자동 완성(명령·환경·인용 키·이름표·파일·패키지)·접기·괄호 짝·찾기/바꾸기·여러 커서(Sublime 키)·수식 미리보기·고른 글 도구·그림 붙여넣기
 *   - 컴파일: 서버(ws op=tex, tools/tex_api.py)의 tectonic — 자동 컴파일, 문제 목록(줄로 이동·한국어 설명), 원고↔PDF 오가기(SyncTeX: Ctrl+. / PDF 더블클릭)
 *   - AI: 대화하면서 파일을 직접 고치는 작성 보조(쓰기·고치기·넣기·폴더 정리·컴파일해 오류 고치기·자료 근거·논문 검색) — 차례마다 되돌리기, 검토 모드
 *   - 버전(rnd.paperv.<pid>)·비교·되돌리기·폴더로 꺼내기, 줄 코멘트, 참고문헌 관리(DOI·검색·붙여넣기·프로젝트 참고문헌), 표·그림 만들기, 단어 수
 *   저장: 글 파일은 TK.store("rnd.paper.<pid>") → 계정 projects/<pid>/paper · 그림·데이터 파일은 서버 projects/<pid>/paper/w/assets
 * ========================================================================== */
(function () {
  "use strict";
  const K = window.PAPERKIT, esc = K ? K.esc : (s) => String(s);
  const $ = (id) => document.getElementById(id);
  const P = (k, d) => (window.TK ? TK.store.get(k, d) : d), PS = (k, v) => { if (window.TK) TK.store.set(k, v); };
  const MID = "w", BS = "\\";
  const EDIT_RE = /\.(tex|bib|sty|cls|bst|bbx|cbx|lbx|dbx|txt|md|cfg|def|clo|ltx|tikz|pgf|lua)$/i;
  const IMG_RE = /\.(png|jpe?g|gif|bmp|webp|svg)$/i;
  const extOf = (p) => ((/\.([^./]+)$/.exec(p || "") || [0, ""])[1] || "").toLowerCase();
  const dirOf = (p) => (p.indexOf("/") >= 0 ? p.slice(0, p.lastIndexOf("/")) : "");
  const baseOf = (p) => p.slice(p.lastIndexOf("/") + 1);
  const join = (d, n) => (d ? d + "/" + n : n);
  const cleanPath = (p) => { const s = String(p || "").replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\/+$/, "").trim(); if (!s || s.split("/").some((x) => !x || x === "." || x === ".." || x[0] === ".") || /[:*?"<>|]/.test(s) || s.length > 180) return null; return s; };
  const fmtT = (t) => new Date(t).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const kb = (n) => (n < 1024 ? n + "B" : n < 1048576 ? (n / 1024).toFixed(1) + "KB" : (n / 1048576).toFixed(1) + "MB");
  const ICO = (p) => { const e = extOf(p); return e === "tex" ? "𝑻" : e === "bib" ? "📚" : /^(sty|cls|bst)$/.test(e) ? "⚙" : IMG_RE.test(p) ? "🖼" : e === "pdf" ? "📕" : /^(csv|tsv|dat|xlsx|json)$/.test(e) ? "▦" : e === "md" || e === "txt" ? "📝" : "📄"; };

  /* ================================================================== 상태 */
  const S = {
    pid: "", list: [], data: null, assets: [], file: null, cm: null, docs: {}, dirty: {}, area: null,
    build: null, compiling: false, queued: false, engine: undefined, allowed: false, warm: true, log: "", out: "", lastSec: 0,
    probs: { compile: [], check: [] }, side: P("pp.side", "files"), sideOpen: P("pp.sideOpen", true), pv: P("pp.pv", "pdf"), vm: P("pp.vm", "split"), ai: P("pp.ai", window.innerWidth >= 1400),
    lay: Object.assign({ side: 270, ed: 0.5, ai: 400 }, P("pp.lay", {})),
    set: Object.assign({ auto: true, math: true, wrap: true, font: 13.5, spell: false, sublime: true, review: false, dark: false }, P("pp.set", {})),
    zen: P("pp.zen", false), zoom: P("pp.zoom", "width"), openDirs: P("pp.dirs", {}), msgs: [], turns: {}, busyAI: false, saveT: 0, lintT: 0, autoT: 0, hits: [], hitI: -1, findQ: "",
  };
  const key = () => "rnd.paper." + S.pid, vkey = () => "rnd.paperv." + S.pid;
  const setPref = (k, v) => { PS("pp." + k, v); };
  const url = (op, p) => RND.ws.url(op, Object.assign({ pid: S.pid, mid: MID }, p || {}));
  const req = (op, p, body, o) => RND.ws.req(op, Object.assign({ pid: S.pid, mid: MID }, p || {}), body, o);
  function toast(t, ms) { let el = $("ppToast"); if (!el) { el = document.createElement("div"); el.id = "ppToast"; el.className = "pp-toast"; document.body.appendChild(el); } el.textContent = t; el.classList.add("on"); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("on"), ms || 2600); }

  /* ================================================================== 데이터 */
  function normalize(d) {
    if (!d || typeof d !== "object" || !d.files) return null;
    d.v = 2; d.folders = Array.isArray(d.folders) ? d.folders : []; d.comments = Array.isArray(d.comments) ? d.comments : []; d.open = Array.isArray(d.open) ? d.open : []; d.meta = d.meta || {}; d.chat = Array.isArray(d.chat) ? d.chat : [];
    if (!d.main || d.files[d.main] == null) d.main = Object.keys(d.files).find((f) => /\.tex$/.test(f) && /\\documentclass/.test(d.files[f])) || Object.keys(d.files).find((f) => /\.tex$/.test(f)) || "main.tex";
    return d;
  }
  function flushDocs() { Object.keys(S.dirty).forEach((p) => { if (S.docs[p] && S.data.files[p] != null) S.data.files[p] = S.docs[p].getValue(); }); S.dirty = {}; }
  function persist(note) {
    if (!S.data) return; flushDocs();
    S.data.open = (S.data.open || []).filter((p) => S.data.files[p] != null).slice(-12); S.data.cur = S.file; S.data.saved = Date.now();
    S.data.chat = S.msgs.slice(-40).map((m) => ({ role: m.role, text: m.text, changes: (m.changes || []).map((c) => ({ kind: c.kind, path: c.path, to: c.to, add: c.add, del: c.del })), steps: m.steps || [], t: m.t }));
    // (v124) 다른 탭·기기가 먼저 저장했으면 그 내용을 버전에 남긴다. 글을 쓰는 중이라 묻지 않고 알린다
    const now = JSON.stringify(P(key(), null));
    if (S.lastRaw != null && now !== "null" && now !== S.lastRaw) { try { const o = JSON.parse(now); if (o && o.files && JSON.stringify(o.files) !== JSON.stringify(S.data.files)) { const l = vlist(); l.push({ id: "v" + Date.now().toString(36), t: Date.now(), label: "다른 곳에서 저장한 내용", auto: false, main: o.main, folders: o.folders || [], files: o.files }); PS(vkey(), { list: l.slice(-40) }); toast("다른 탭·기기에서 저장한 내용을 버전에 남겼어요", 5000); } } catch (e) { /* 계속 */ } }
    PS(key(), S.data); S.lastRaw = JSON.stringify(P(key(), null)); stat("save", note || "저장됨 " + new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }));
  }
  function saveSoon() { stat("save", "고치는 중…"); clearTimeout(S.saveT); S.saveT = setTimeout(() => persist(), 700); }
  function texts() { flushDocs(); return S.data.files; }
  function assetNames() { return S.assets.map((a) => a.name); }
  async function loadAssets() { try { S.assets = (await req("texassets")).list || []; } catch (e) { S.assets = []; } }

  /* ================================================================== CodeMirror 불러오기 */
  const CMV = "5.65.16", CDN = "https://cdnjs.cloudflare.com/ajax/libs/codemirror/" + CMV + "/";
  const CM_CSS = ["codemirror.min.css", "addon/hint/show-hint.min.css", "addon/fold/foldgutter.min.css", "addon/dialog/dialog.min.css", "addon/search/matchesonscrollbar.min.css"];
  const CM_JS = ["codemirror.min.js", "mode/stex/stex.min.js", "addon/edit/matchbrackets.min.js", "addon/edit/closebrackets.min.js", "addon/hint/show-hint.min.js", "addon/search/searchcursor.min.js", "addon/dialog/dialog.min.js", "addon/search/search.min.js", "addon/search/jump-to-line.min.js", "addon/scroll/annotatescrollbar.min.js", "addon/search/matchesonscrollbar.min.js", "addon/search/match-highlighter.min.js", "addon/fold/foldcode.min.js", "addon/fold/foldgutter.min.js", "addon/selection/active-line.min.js", "addon/comment/comment.min.js", "keymap/sublime.min.js"];
  let cmP = null;
  function loadCM() {
    if (window.CodeMirror && CodeMirror.showHint && CodeMirror.modes.stex) return Promise.resolve(true);
    if (cmP) return cmP;
    cmP = new Promise((res) => {
      CM_CSS.forEach((h) => { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = CDN + h; document.head.appendChild(l); });
      const load = (src) => new Promise((ok, no) => { const s = document.createElement("script"); s.src = CDN + src; s.async = false; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
      (async () => { try { await load(CM_JS[0]); await Promise.all(CM_JS.slice(1).map(load)); cmExtras(); res(true); } catch (e) { res(!!window.CodeMirror); } })();
      setTimeout(() => res(!!window.CodeMirror), 20000);
    });
    return cmP;
  }
  function cmExtras() {
    const CM = window.CodeMirror; if (!CM || CM._ppx) return; CM._ppx = 1;
    CM.defineMode("bibtex", () => ({
      token(st) {
        if (st.sol() && st.match(/^\s*%.*/)) return "comment";
        if (st.match(/^@\w+/)) return "keyword";
        if (st.match(/^\w[\w-]*(?=\s*=)/)) return "attribute";
        const c = st.next();
        if (c === "{" || c === "}") return "bracket";
        if (c === '"') { st.skipTo('"'); st.next(); return "string"; }
        if (/\d/.test(c)) { st.eatWhile(/\d/); return "number"; }
        return null;
      },
    }));
    const LV = { part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4 };
    const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    CM.registerHelper("fold", "stex", (cm, start) => {
      const line = cm.getLine(start.line);
      let m = /\\begin\{([^}]+)\}/.exec(line);
      if (m && m[1] !== "document" && line.indexOf("\\end{" + m[1] + "}", m.index) < 0) {
        const rb = new RegExp("\\\\begin\\{" + reEsc(m[1]) + "\\}", "g"), re = new RegExp("\\\\end\\{" + reEsc(m[1]) + "\\}", "g"); let d = 1;
        for (let i = start.line + 1; i < Math.min(cm.lineCount(), start.line + 4000); i++) { const l = cm.getLine(i); d += (l.match(rb) || []).length; d -= (l.match(re) || []).length; if (d <= 0) return { from: CM.Pos(start.line, line.length), to: CM.Pos(i, Math.max(0, l.indexOf("\\end"))) }; }
      }
      m = /^\s*\\(part|chapter|section|subsection|subsubsection)\*?\s*[[{]/.exec(line);
      if (m) {
        const lv = LV[m[1]];
        for (let i = start.line + 1; i <= cm.lineCount(); i++) {
          const l = i < cm.lineCount() ? cm.getLine(i) : null; const k = l != null && /^\s*\\(part|chapter|section|subsection|subsubsection)\*?\s*[[{]/.exec(l);
          if (l == null || (k && LV[k[1]] <= lv) || /\\end\{document\}|\\bibliography\{|\\appendix\b/.test(l)) { let e = i - 1; while (e > start.line && !cm.getLine(e).trim()) e--; return e > start.line ? { from: CM.Pos(start.line, line.length), to: CM.Pos(e, cm.getLine(e).length) } : undefined; }
        }
      }
      return undefined;
    });
  }
  const modeOf = (p) => (/\.bib$/i.test(p) ? "bibtex" : /\.(tex|sty|cls|ltx|tikz|pgf|bbx|cbx|def|cfg|clo)$/i.test(p) ? "stex" : null);

  /* ================================================================== 진입 */
  async function paintPaper(area) {
    S.area = area;
    try { S.list = (await RND.ws.req("projects")).list || []; } catch (e) { area.innerHTML = '<div class="sv"><p class="lb-warn">' + esc(e.message) + '</p><button type="button" class="ghost-btn small-btn" id="ppRetry">다시 시도</button></div>'; $("ppRetry").onclick = () => paintPaper(area); return; }
    if (!S.list.length) { area.innerHTML = '<div class="sv hub"><div class="hub-head"><div><h2>논문 작성·보조</h2></div></div><p class="sh-muted">연구 프로젝트를 먼저 만드세요 — 원고는 프로젝트마다 하나의 작업 공간(폴더 여러 개)으로 저장돼요.</p></div>'; return; }
    let pid = P("hub.rnd", "") || (RND.cur && RND.cur()) || S.list[0].id; if (!S.list.some((p) => p.id === pid)) pid = S.list[0].id;
    if (S.pid && S.data && S.pid !== pid) persist();
    if (S.pid === pid && S.data && $("pp2") && area.contains($("pp2")) && S.cm) { grid(); fitSoon(); setTimeout(() => { S.cm.refresh(); pdfLayout(); }, 60); return; }   // 다시 들어오면 그대로(실행 취소 기록·스크롤 유지)
    if (S.cm) { try { S.cm.swapDoc(window.CodeMirror.Doc("")); } catch (e) { /* 계속 */ } S.cm = null; }   // 예전 편집기에서 문서를 떼어 낸다("already in use" 방지)
    if (S.pid !== pid || !S.data) { S.pid = pid; S.data = normalize(P(key(), null)); S.lastRaw = JSON.stringify(P(key(), null)); S.docs = {}; S.dirty = {}; S.build = null; S.probs = { compile: [], check: [] }; S.msgs = S.data ? (S.data.chat || []).map((m) => Object.assign({}, m)) : []; S.turns = {}; S.file = null; S.log = ""; }
    if (S.engine === undefined) { try { const t = await RND.ws.req("texinfo"); S.engine = t.engine || null; S.allowed = !!t.allowed; S.warm = !!t.warm; } catch (e) { S.engine = null; } }
    if (!S.data) return paintStart(area);
    await paintWs(area);
  }
  function projSelect(id) { return '<select id="' + id + '" class="pp-proj" aria-label="연구 프로젝트">' + S.list.map((p) => '<option value="' + esc(p.id) + '"' + (p.id === S.pid ? " selected" : "") + ">" + esc(p.name) + "</option>").join("") + "</select>"; }

  /* ---------------- 처음: 샘플 갤러리 ---------------- */
  function paintStart(area) {
    area.innerHTML = '<div class="sv pp2s"><div class="pp2s-head"><div><h2>📄 논문 작성·보조</h2><p class="sh-muted">이 프로젝트에는 아직 원고가 없어요. 샘플에서 시작하거나, Overleaf·GitHub 에서 받은 zip 을 그대로 가져오세요.</p></div><label class="pp2s-proj">프로젝트 ' + projSelect("ppProjS") + "</label></div>" +
      '<div class="pp2s-acts"><button type="button" class="pp-act" data-pps="zip">📦 zip 가져오기 <small>Overleaf·GitHub 프로젝트 통째로</small></button><button type="button" class="pp-act" data-pps="blank">⬜ 빈 문서 <small>한국어 되는 최소 문서</small></button></div>' +
      '<div id="ppGal"></div><input type="file" id="ppZipS" accept=".zip" hidden></div>';
    gallery($("ppGal"), (t) => startFrom(t));
    $("ppProjS").addEventListener("change", (e) => { PS("hub.rnd", e.target.value); S.data = null; S.pid = ""; paintPaper(area); });
    area.onclick = (e) => { const b = e.target.closest("[data-pps]"); if (!b) return; if (b.dataset.pps === "blank") startFrom(PAPERTPL.list.find((t) => t.id === "blank")); if (b.dataset.pps === "zip") $("ppZipS").click(); };
    $("ppZipS").onchange = async (e) => { const f = e.target.files[0]; if (!f) return; const r = await importZip(f, ""); if (r && Object.keys(r.files || {}).length) { S.data = normalize({ files: r.files, main: r.main || "main.tex" }); persist(); paintWs(area); } };
  }
  function startFrom(t) { if (!t) return; S.data = normalize({ files: JSON.parse(JSON.stringify(t.files)), main: t.main, folders: [] }); S.data.meta.tpl = t.id; S.msgs = []; persist(); paintWs(S.area); toast("“" + t.name + "” 샘플로 시작했어요 — ▶ 컴파일을 눌러 보세요"); }
  // 갤러리(처음 화면·새 샘플 추가 창 공용) — 실제 컴파일한 첫 쪽 그림(img/papertpl/<id>.jpg)
  function gallery(box, pick, opt) {
    opt = opt || {}; let cat = "전체";
    const cats = ["전체"].concat(PAPERTPL.cats);
    const draw = () => {
      const l = PAPERTPL.list.filter((t) => cat === "전체" || t.cat === cat);
      box.innerHTML = '<div class="pp-gal-tabs">' + cats.map((c) => '<button type="button" class="' + (c === cat ? "on" : "") + '" data-gc="' + esc(c) + '">' + esc(c) + "</button>").join("") + '<span class="sh-muted">샘플 ' + PAPERTPL.list.length + "종 · 모두 이 PC 에서 컴파일 확인</span></div>" +
        '<div class="pp-gal">' + l.map((t) => '<button type="button" class="pp-tpl" data-gt="' + t.id + '"><span class="pp-tpl-img"><img src="img/papertpl/' + t.id + '.jpg" alt="" loading="lazy" onerror="this.remove()"><i>' + t.ico + '</i></span><span class="pp-tpl-b"><b>' + esc(t.name) + "</b><small>" + esc(t.desc) + '</small><span class="pp-tpl-tags">' + t.tags.map((g) => "<em>" + esc(g) + "</em>").join("") + "<em>파일 " + Object.keys(t.files).length + "</em></span></span></button>").join("") + "</div>";
    };
    draw();
    box.onclick = (e) => { const c = e.target.closest("[data-gc]"); if (c) { cat = c.dataset.gc; draw(); return; } const t = e.target.closest("[data-gt]"); if (t) pick(PAPERTPL.list.find((x) => x.id === t.dataset.gt)); };
  }

  /* ================================================================== 작업 공간 */
  const RAIL = [["files", "📁", "파일"], ["outline", "≡", "차례"], ["find", "🔍", "모든 파일에서 찾기"], ["probs", "⚠", "문제"], ["bib", "📚", "참고문헌"], ["cmts", "💬", "코멘트"], ["hist", "🕘", "버전"], ["sym", "Ω", "기호"], ["set", "⚙", "설정"]];
  const TOOLS = [["b", "<b>B</b>", "굵게 (Ctrl+B)"], ["i", "<i>I</i>", "기울임 (Ctrl+I)"], ["sec", "§", "절 넣기"], ["math", "∑", "수식"], ["fig", "🖼", "그림 넣기"], ["tab", "▦", "표 만들기"], ["cite", "❝", "인용 넣기"], ["ref", "↗", "참조 넣기"], ["ul", "•", "점 목록"], ["ol", "1.", "번호 목록"], ["cmt", "💬", "코멘트 달기"]];
  async function paintWs(area) {
    area.innerHTML = '<div class="sv pp2" id="pp2">' +
      '<div class="pp2-top">' +
        '<div class="pp2-t1"><b class="pp2-name">📄 논문 작성·보조</b>' + projSelect("ppProj") + '<span class="pp2-save" id="ppSave">저장됨</span></div>' +
        '<div class="pp2-tools" role="toolbar" aria-label="편집 도구">' + TOOLS.map((t) => '<button type="button" class="pp-tb" data-tb="' + t[0] + '" title="' + esc(t[2]) + '">' + t[1] + "</button>").join("") + '<span class="pp-sep"></span><button type="button" class="pp-tb" data-tb="undo" title="되돌리기 (Ctrl+Z)">↶</button><button type="button" class="pp-tb" data-tb="redo" title="다시 (Ctrl+Y)">↷</button><button type="button" class="pp-tb" data-tb="search" title="찾기·바꾸기 (Ctrl+F)">⌕</button><button type="button" class="pp-tb" data-tb="gal" title="샘플 갤러리 — 폴더로 추가하거나 새로 시작">✦ 샘플</button></div>' +
        '<div class="pp2-t2"><span class="pp-seg" role="group" aria-label="보기"><button type="button" data-vm="edit" title="편집기만">편집</button><button type="button" data-vm="split" title="나란히">나란히</button><button type="button" data-vm="pdf" title="PDF 만">PDF</button></span>' +
        '<span class="pp-cmpw"><button type="button" class="pp-cmp" data-pp="compile" title="컴파일 (Ctrl+Enter · Ctrl+S)"><span class="pp-cmp-i">▶</span><span id="ppCmpT">컴파일</span></button><button type="button" class="pp-cmp-m" data-pp="cmpmenu" title="컴파일 설정" aria-label="컴파일 설정">▾</button></span>' +
        '<button type="button" class="pp-tb" data-pp="dl" title="내려받기·내보내기">⬇</button><button type="button" class="pp-ai-t' + (S.ai ? " on" : "") + '" data-pp="ai" title="AI 작성 보조 대화">✨ AI</button><button type="button" class="pp-tb' + (S.zen ? " on" : "") + '" data-pp="zen" title="앱 메뉴·위 막대를 가려요">' + (S.zen ? "◳ UI 보이기" : "◱ UI 가리기") + '</button><button type="button" class="pp-tb" data-pp="full" title="전체 화면">⛶</button></div>' +
      "</div>" +
      '<div class="pp2-ws" id="ppWs">' +
        '<nav class="pp2-rail" aria-label="옆 칸">' + RAIL.map((r) => '<button type="button" data-rail="' + r[0] + '" title="' + r[2] + '"><span>' + r[1] + '</span><i class="pp-badge" id="ppB_' + r[0] + '"></i></button>').join("") + "</nav>" +
        '<aside class="pp2-side" id="ppSide"></aside><div class="pp2-split" data-split="side"></div>' +
        '<section class="pp2-ed"><div class="pp2-tabs" id="ppTabs"></div><div class="pp2-cm" id="ppCm"><div class="pp-load"><span class="lb-dots"><i></i><i></i><i></i></span> 편집기를 준비하는 중…</div></div><div class="pp2-status" id="ppStatus"></div></section>' +
        '<div class="pp2-split" data-split="ed"></div>' +
        '<section class="pp2-pv"><div class="pp2-pvbar" id="ppPvBar"></div><div class="pp2-pvb" id="ppPv"></div></section>' +
        '<div class="pp2-split" data-split="ai"></div>' +
        '<section class="pp2-ai" id="ppAi"></section>' +
      "</div><input type=\"file\" id=\"ppUp\" multiple hidden><input type=\"file\" id=\"ppZip\" accept=\".zip\" hidden></div>";
    $("ppProj").addEventListener("change", (e) => { persist(); PS("hub.rnd", e.target.value); S.data = null; S.pid = ""; paintPaper(area); });
    area.onclick = onClick; area.oncontextmenu = onCtx;
    bindSplits(); document.body.classList.toggle("pp-zen", !!S.zen); grid(); fitSoon(); if (wsRO) { wsRO.disconnect(); wsRO.observe($("ppWs")); }
    await loadAssets();
    const ok = await loadCM();
    if (!ok || !window.CodeMirror) { $("ppCm").innerHTML = '<p class="lb-warn">편집기(CodeMirror)를 불러오지 못했어요 — 인터넷 연결을 확인하고 새로 고쳐 주세요.</p>'; }
    else makeEditor();
    const start = (S.data.cur && S.data.files[S.data.cur] != null) ? S.data.cur : S.data.main;
    openFile(start);
    paintSide(); paintPvBar(); paintAi(); runChecks(); fitSoon();
    try { const v = await req("texview"); if (v.has) { S.build = v; S.probs.compile = v.problems || []; paintProbs(); } } catch (e) { /* 계속 */ }
    paintPv();
    if (!S.build && S.engine && S.allowed && S.set.auto) setTimeout(() => compile("open"), 400);
  }

  /* ---------------- 칸 배치 ---------------- */
  // (v111) 창이 아니라 작업 칸의 실제 너비로 판단 — 앱 메뉴가 차지한 만큼 칸이 넘쳐 AI 칸이 잘리던 문제
  function narrow() { const w = $("ppWs"), W = (w && w.clientWidth) || window.innerWidth; return W < 44 + (S.sideOpen ? 205 : 0) + (S.ai ? 305 : 0) + 320; }
  function grid() {
    const ws = $("ppWs"), root = $("pp2"); if (!ws) return;
    // (v111) 옆 칸과 AI 칸이 같이 안 들어가면 방금 연 쪽만 — 둘 다 띄워 편집기를 가리지 않는다
    if (S.sideOpen && S.ai && ws.clientWidth && ws.clientWidth < 874) { if (S.front === "side") S.ai = false; else S.sideOpen = false; }
    const nw = narrow(); let vm = S.vm; if (nw && vm === "split") vm = "edit";
    const side = S.sideOpen, ai = S.ai; let sw = S.lay.side, aw = S.lay.ai;
    if (!nw && ws.clientWidth) {   // 모자라면 옆 칸 → AI 칸을 줄이고, 그래도 모자라면 나란히를 푼다
      const room = () => ws.clientWidth - 44 - (side ? sw + 5 : 0) - (ai ? aw + 5 : 0), min = vm === "split" ? 485 : 320;
      if (side && room() < min) sw = Math.max(200, sw - (min - room()));
      if (ai && room() < min) aw = Math.max(300, aw - (min - room()));
      if (vm === "split" && room() < 485) vm = "edit";
    }
    const ed = vm !== "pdf", pv = vm !== "edit";
    root.classList.toggle("nw", nw); root.dataset.view = vm; root.classList.toggle("side-off", !side); root.classList.toggle("ai-off", !ai);
    const c = ["44px"];
    if (!nw) {
      c.push(side ? sw + "px" : "0px", side ? "5px" : "0px");
      if (ed && pv) c.push("minmax(240px," + S.lay.ed + "fr)", "5px", "minmax(240px," + (1 - S.lay.ed) + "fr)"); else if (ed) c.push("minmax(0,1fr)", "0px", "0px"); else c.push("0px", "0px", "minmax(0,1fr)");
      c.push(ai ? "5px" : "0px", ai ? aw + "px" : "0px");
    } else { c.push("0px", "0px"); if (ed) c.push("minmax(0,1fr)", "0px", "0px"); else c.push("0px", "0px", "minmax(0,1fr)"); c.push("0px", "0px"); }
    ws.style.gridTemplateColumns = c.join(" ");
    document.querySelectorAll("#pp2 [data-vm]").forEach((b) => b.classList.toggle("on", b.dataset.vm === S.vm));
    document.querySelectorAll("#pp2 .pp2-rail [data-rail]").forEach((b) => b.classList.toggle("on", side && b.dataset.rail === S.side));
    const at = document.querySelector("#pp2 [data-pp=ai]"); if (at) at.classList.toggle("on", ai);
    setTimeout(() => { if (S.cm) S.cm.refresh(); pdfLayout(); }, 30);
  }
  function bindSplits() {
    document.querySelectorAll("#pp2 .pp2-split").forEach((sp) => sp.addEventListener("pointerdown", (e) => {
      e.preventDefault(); const k = sp.dataset.split, ws = $("ppWs"), r = ws.getBoundingClientRect(); sp.setPointerCapture(e.pointerId); document.body.classList.add("pp-drag");
      const ed = document.querySelector("#pp2 .pp2-ed").getBoundingClientRect(), pv = document.querySelector("#pp2 .pp2-pv").getBoundingClientRect();
      const mv = (ev) => {
        if (k === "side") S.lay.side = Math.max(190, Math.min(480, ev.clientX - r.left - 44));
        if (k === "ai") S.lay.ai = Math.max(300, Math.min(760, r.right - ev.clientX));
        if (k === "ed") { const tot = ed.width + pv.width; S.lay.ed = Math.max(0.2, Math.min(0.8, (ev.clientX - ed.left) / tot)); }
        grid();
      };
      const up = () => { sp.removeEventListener("pointermove", mv); sp.removeEventListener("pointerup", up); document.body.classList.remove("pp-drag"); setPref("lay", S.lay); };
      sp.addEventListener("pointermove", mv); sp.addEventListener("pointerup", up);
    }));
  }
  function fit() {
    const ws = $("ppWs"); if (!ws || !ws.offsetParent) return;
    const sc = document.querySelector("main.content"); if (sc && sc.scrollTop) sc.scrollTop = 0; if (window.scrollY) window.scrollTo(0, 0);
    const full = document.fullscreenElement && document.fullscreenElement.id === "pp2";
    let h = Math.floor(window.innerHeight - ws.getBoundingClientRect().top - (full ? 0 : 6));
    ws.style.height = Math.max(420, h) + "px";
    const over = document.documentElement.scrollHeight - window.innerHeight; if (!full && over > 0 && over < 90) ws.style.height = Math.max(420, h - over) + "px";
    if (S.cm) S.cm.refresh(); pdfLayout();
  }
  function fitSoon() { clearTimeout(fit.t); fit.t = setTimeout(fit, 40); }
  window.addEventListener("resize", () => { if ($("pp2")) { grid(); fitSoon(); } });
  // (v111) 앱 메뉴 접기·UI 가리기처럼 창 크기가 그대로여도 칸 너비가 바뀌면 다시 맞춘다
  const wsRO = window.ResizeObserver ? new ResizeObserver((es) => { const w = Math.round(es[0].contentRect.width); if (w && w !== S.wsW) { S.wsW = w; grid(); fitSoon(); } }) : null;
  document.addEventListener("fullscreenchange", () => setTimeout(fit, 80));

  /* ================================================================== 편집기 */
  function makeEditor() {
    const host = $("ppCm"); host.innerHTML = "";
    const CM = window.CodeMirror;
    S.cm = CM(host, {
      value: "", mode: "stex", lineNumbers: true, lineWrapping: S.set.wrap, matchBrackets: true, autoCloseBrackets: { pairs: "()[]{}$$", explode: "[]{}" }, styleActiveLine: true,
      foldGutter: { rangeFinder: CM.fold.auto }, gutters: ["pp-g-lint", "CodeMirror-linenumbers", "pp-g-cmt", "CodeMirror-foldgutter"], indentUnit: 2, tabSize: 2, indentWithTabs: false,
      keyMap: S.set.sublime ? "sublime" : "default", highlightSelectionMatches: { minChars: 3, showToken: false, annotateScrollbar: true }, inputStyle: "contenteditable", spellcheck: !!S.set.spell, viewportMargin: 30, dragDrop: true,
      extraKeys: {
        "Ctrl-S": () => { persist(); compile("save"); }, "Cmd-S": () => { persist(); compile("save"); }, "Ctrl-Enter": () => compile("key"), "Cmd-Enter": () => compile("key"),
        "Ctrl-B": () => wrapSel("textbf"), "Cmd-B": () => wrapSel("textbf"), "Ctrl-I": () => wrapSel("textit"), "Cmd-I": () => wrapSel("textit"),
        "Ctrl-/": () => toggleComment(), "Cmd-/": () => toggleComment(), "Ctrl-Space": (cm) => showHint(cm, true), "Ctrl-.": () => syncFwd(), "Cmd-.": () => syncFwd(),
        "Ctrl-H": "replace", "Ctrl-Shift-F": () => { S.side = "find"; S.sideOpen = true; grid(); paintSide(); setTimeout(() => { const q = $("ppFq"); if (q) { q.value = S.cm.getSelection() || q.value; q.focus(); } }, 30); },
        "Ctrl-Alt-M": () => addComment(), "Ctrl-K": false, "Tab": (cm) => { if (cm.somethingSelected()) cm.indentSelection("add"); else cm.replaceSelection("  "); }, "Shift-Tab": (cm) => cm.indentSelection("subtract"),
      },
    });
    S.cm.getWrapperElement().style.fontSize = S.set.font + "px";
    S.cm.on("cursorActivity", onCursor);
    S.cm.on("inputRead", onInput);
    S.cm.on("gutterClick", (cm, line, g) => { if (g === "pp-g-cmt") openCommentsAt(line); if (g === "pp-g-lint") { const p = allProbs().find((x) => x.file === S.file && x.line === line + 1); if (p) toast((p.kind === "error" ? "✕ " : "▲ ") + p.msg + (K.hint(p.msg) ? " — " + K.hint(p.msg) : ""), 6000); } });
    S.cm.on("drop", onDropCm);
    S.cm.on("paste", onPasteCm);
    S.cm.on("blur", () => { setTimeout(() => { if (!document.activeElement || !document.activeElement.closest || !document.activeElement.closest(".pp-selbar,.pp-inline")) hideSelBar(); }, 150); mathHide(); });
  }
  function docFor(p) {
    if (S.docs[p]) return S.docs[p];
    const d = window.CodeMirror.Doc(S.data.files[p] || "", modeOf(p));
    d._pp = p; d.on("change", (doc) => { S.dirty[doc._pp] = 1; saveSoon(); clearTimeout(S.lintT); S.lintT = setTimeout(runChecks, 900); if (S.set.auto) { clearTimeout(S.autoT); S.autoT = setTimeout(() => compile("auto"), 2600); } if (S.pv === "html") { clearTimeout(S.htT); S.htT = setTimeout(paintPv, 500); } });
    S.docs[p] = d; return d;
  }
  function setDocText(p, text) { const d = S.docs[p]; if (!d) return; if (d.getValue() === text) return; const cur = d.getCursor(); d.setValue(text); try { d.setCursor(cur); } catch (e) { /* 계속 */ } }
  function openFile(p, line, flash) {
    if (!p) return;
    if (S.data.files[p] == null) { const a = S.assets.find((x) => x.name === p); if (a) return previewAsset(a); return; }
    S.file = p; if (S.data.open.indexOf(p) < 0) S.data.open.push(p);
    let d = p.split("/"); for (let i = 1; i < d.length; i++) S.openDirs[d.slice(0, i).join("/")] = true;
    if (S.cm) { S.cm.swapDoc(docFor(p)); S.cm.setOption("mode", modeOf(p)); paintMarks(); }
    paintTabs(); if (S.side === "files") paintSide(); else if (S.side === "outline") paintSide();
    if (line && S.cm) gotoLine(line, flash);
    stat(); S.data.cur = p;
  }
  function gotoLine(line, flash, ch) {
    if (!S.cm) return; const l = Math.max(0, Math.min(S.cm.lineCount() - 1, line - 1));
    S.cm.setCursor({ line: l, ch: ch || 0 }); S.cm.scrollIntoView({ line: l, ch: 0 }, Math.round(S.cm.getScrollInfo().clientHeight / 3)); S.cm.focus();
    if (flash) { const h = S.cm.addLineClass(l, "background", "pp-flash"); setTimeout(() => S.cm.removeLineClass(h, "background", "pp-flash"), 1600); }
  }
  function closeTab(p) { S.data.open = S.data.open.filter((x) => x !== p); if (S.file === p) openFile(S.data.open[S.data.open.length - 1] || S.data.main); else paintTabs(); persist(); }
  function paintTabs() {
    const el = $("ppTabs"); if (!el) return;
    if (S.data.open.indexOf(S.data.main) < 0) S.data.open.unshift(S.data.main);
    el.innerHTML = S.data.open.filter((p) => S.data.files[p] != null).map((p) => '<span class="pp-tab' + (p === S.file ? " on" : "") + '" data-tab="' + esc(p) + '" title="' + esc(p) + '"><i>' + ICO(p) + "</i>" + esc(baseOf(p)) + (p === S.data.main ? ' <em title="본문(컴파일하는 파일)">★</em>' : "") + (p !== S.data.main ? '<button type="button" data-tabx="' + esc(p) + '" aria-label="닫기">×</button>' : "") + "</span>").join("") + '<span class="pp-tab-path">' + esc(S.file || "") + "</span>";
    const on = el.querySelector(".pp-tab.on"); if (on) on.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  /* ---- 서식·넣기 ---- */
  function insertSnip(text, from, to) {
    const cm = S.cm; if (!cm) return; from = from || cm.getCursor("from"); to = to || cm.getCursor("to");
    const ind = (/^\s*/.exec(cm.getLine(from.line)) || [""])[0];
    text = text.split("\n").map((l, i) => (i ? ind + l : l)).join("\n");
    const at = text.indexOf("¦"); const t = text.replace("¦", "");
    cm.replaceRange(t, from, to, "+input"); const start = cm.indexFromPos(from);
    cm.setCursor(cm.posFromIndex(start + (at >= 0 ? at : t.length))); cm.focus();
  }
  function wrapSel(cmd) { const cm = S.cm; if (!cm) return; const s = cm.getSelection(); if (s) cm.replaceSelection(BS + cmd + "{" + s + "}", "around"); else insertSnip(BS + cmd + "{¦}"); cm.focus(); }
  function toggleComment() {
    const cm = S.cm; if (!cm) return; const a = cm.getCursor("from").line, b = cm.getCursor("to").line; const lines = []; for (let i = a; i <= b; i++) lines.push(cm.getLine(i));
    const all = lines.every((l) => /^\s*%/.test(l) || !l.trim());
    cm.operation(() => { for (let i = a; i <= b; i++) { const l = cm.getLine(i); if (all) { const m = /^(\s*)% ?/.exec(l); if (m) cm.replaceRange(m[1], { line: i, ch: 0 }, { line: i, ch: m[0].length }); } else if (l.trim()) cm.replaceRange("% ", { line: i, ch: 0 }); } });
  }
  function tool(k) {
    if (!S.cm) return;
    if (k === "b") return wrapSel("textbf"); if (k === "i") return wrapSel("textit");
    if (k === "sec") return insertSnip(BS + "section{¦}\n");
    if (k === "math") { const s = S.cm.getSelection(); return s ? S.cm.replaceSelection("$" + s + "$") : insertSnip(BS + "begin{equation}\n  ¦\n  " + BS + "label{eq:}\n" + BS + "end{equation}\n"); }
    if (k === "fig") return figureDialog(); if (k === "tab") return tableDialog();
    if (k === "cite") { S.side = "bib"; S.sideOpen = true; grid(); paintSide(); return; }
    if (k === "ref") { insertSnip(BS + "ref{¦}"); setTimeout(() => showHint(S.cm, true), 30); return; }
    if (k === "ul") return insertSnip(BS + "begin{itemize}\n  " + BS + "item ¦\n" + BS + "end{itemize}\n");
    if (k === "ol") return insertSnip(BS + "begin{enumerate}\n  " + BS + "item ¦\n" + BS + "end{enumerate}\n");
    if (k === "cmt") return addComment();
    if (k === "undo") return S.cm.undo(); if (k === "redo") return S.cm.redo();
    if (k === "search") { S.cm.focus(); S.cm.execCommand("find"); return; }
    if (k === "gal") return galleryModal();
  }

  /* ---- 자동 완성 ---- */
  function onInput(cm, ch) {
    const t = ch.text.join("").slice(-1);   // 한 번에 여러 글자가 들어와도(붙여넣기·IME) 마지막 글자로 판단
    if (cm.state.completionActive) return;
    const before = cm.getLine(cm.getCursor().line).slice(0, cm.getCursor().ch);
    if (t === "\\" || t === "{" || (t === "," && /\\\w*cite\w*\*?(?:\[[^\]]*\])*\{[^}]*$/.test(before)) || (/^[a-zA-Z]$/.test(t) && /\\[a-zA-Z]+$/.test(before))) showHint(cm, false);
  }
  function showHint(cm, forced) { if (!cm.showHint) return; cm.showHint({ hint: hintFn, completeSingle: false, closeCharacters: /[\s()\[\]};>]/, alignWithWord: true, forced: forced }); }
  function hintFn(cm) {
    const CM = window.CodeMirror, cur = cm.getCursor(), line = cm.getLine(cur.line), before = line.slice(0, cur.ch);
    const files = texts(); let list = [], from, to = cur;
    const m = /\\([a-zA-Z]+)\*?(?:\[[^\]]*\])*\{([^{}]*)$/.exec(before);
    if (m) {
      const cmd = m[1], part = m[2].split(",").pop().replace(/^\s+/, ""); from = CM.Pos(cur.line, cur.ch - part.length);
      const after = line.slice(cur.ch); if (after[0] === "}") to = CM.Pos(cur.line, cur.ch); // 닫는 } 는 둔다
      const q = part.toLowerCase(); const ok = (s) => !q || s.toLowerCase().indexOf(q) >= 0;
      const main = S.data.main, base = dirOf(main);
      if (/cite/i.test(cmd)) list = K.bibAll(files).filter((b) => ok(b.key + " " + (b.f.title || "") + " " + (b.f.author || ""))).map((b) => ({ text: b.key, displayText: b.key, d: (b.f.title || "").slice(0, 70) + (b.f.year ? " · " + b.f.year : ""), ico: "❝" }));
      else if (/^(ref|eqref|autoref|pageref|cref|Cref|vref|nameref)$/.test(cmd)) list = K.labels(files).filter((l) => ok(l.key)).map((l) => ({ text: l.key, displayText: l.key, d: baseOf(l.file) + ":" + l.line + " " + l.ctx.slice(0, 50), ico: l.key.indexOf("fig") === 0 ? "🖼" : l.key.indexOf("tab") === 0 ? "▦" : l.key.indexOf("eq") === 0 ? "∑" : "↗" }));
      else if (/^(input|include|subfile)$/.test(cmd)) list = Object.keys(files).filter((f) => /\.tex$/.test(f) && f !== main).map((f) => { let r = base && f.indexOf(base + "/") === 0 ? f.slice(base.length + 1) : f; return r.replace(/\.tex$/, ""); }).filter(ok).map((f) => ({ text: f, displayText: f, d: "파일", ico: "𝑻" }));
      else if (cmd === "includegraphics") list = S.assets.filter((a) => /\.(png|jpe?g|pdf|eps|gif)$/i.test(a.name)).map((a) => (base && a.name.indexOf(base + "/") === 0 ? a.name.slice(base.length + 1) : a.name)).filter(ok).map((f) => ({ text: f, displayText: f, d: "그림", ico: "🖼" })).concat(["example-image-a", "example-image-b", "example-image-c"].filter(ok).map((f) => ({ text: f, displayText: f, d: "예시 그림(mwe)", ico: "▧" })));
      else if (cmd === "begin") list = K.ENVS.concat(K.newcommands(files).filter((n) => n.env).map((n) => [n.env, "  ¦", "사용자 환경"])).filter((e) => ok(e[0])).map((e) => ({ text: e[0], displayText: e[0], d: e[2], ico: "▣", hint: (cm2, data, c) => { let t2 = to; if (cm2.getLine(t2.line)[t2.ch] === "}") t2 = CM.Pos(t2.line, t2.ch + 1); insertSnip(e[0] + "}" + (K.ENV_ARG[e[0]] || "") + "\n" + e[1] + "\n" + BS + "end{" + e[0] + "}", data.from, t2); } }));
      else if (cmd === "end") { const open = openEnvs(cm, cur); list = open.filter(ok).map((e) => ({ text: e, displayText: e, d: "열린 환경 닫기", ico: "▣" })); }
      else if (cmd === "usepackage") list = K.PKGS.filter((p) => ok(p[0])).map((p) => ({ text: p[0], displayText: p[0], d: p[1], ico: "📦" }));
      else if (cmd === "documentclass") list = K.CLASSES.filter((p) => ok(p[0])).map((p) => ({ text: p[0], displayText: p[0], d: p[1], ico: "📄" }));
      else if (cmd === "bibliographystyle") list = K.BIBSTYLES.filter((p) => ok(p[0])).map((p) => ({ text: p[0], displayText: p[0], d: p[1], ico: "📚" }));
      else if (cmd === "bibliography" || cmd === "addbibresource") list = Object.keys(files).filter((f) => /\.bib$/.test(f)).map((f) => (cmd === "bibliography" ? f.replace(/\.bib$/, "") : f)).filter(ok).map((f) => ({ text: f, displayText: f, d: "참고문헌 파일", ico: "📚" }));
      else return null;
    } else {
      const c = /\\([a-zA-Z@]*\*?)$/.exec(before); if (!c) return null;
      from = CM.Pos(cur.line, cur.ch - c[1].length - 1); const q = c[1].toLowerCase();
      const user = K.newcommands(files).filter((n) => n.name).map((n) => [n.name, n.name + (n.n ? "{¦}" + "{}".repeat(n.n - 1) : ""), "내가 만든 명령"]);
      const all = user.concat(K.CMDS); const seen = {};
      list = all.filter((x) => { if (seen[x[0]]) return false; seen[x[0]] = 1; return !q || x[0].toLowerCase().indexOf(q) === 0; }).slice(0, 60).concat(q.length >= 2 ? all.filter((x) => x[0].toLowerCase().indexOf(q) > 0).slice(0, 20) : [])
        .map((x) => ({ text: BS + x[1].replace("¦", ""), displayText: BS + x[0], d: x[2], ico: "\\", hint: (cm2, data) => insertSnip(BS + x[1], data.from, data.to) }));
    }
    list.forEach((it) => { it.render = (el, self, d) => { el.innerHTML = '<span class="pp-hi">' + esc(d.ico || "") + "</span><b>" + esc(d.displayText) + "</b>" + (d.d ? "<small>" + esc(d.d) + "</small>" : ""); }; });
    return list.length ? { list: list.slice(0, 80), from: from, to: to } : null;
  }
  function openEnvs(cm, cur) {
    const st = []; for (let i = Math.max(0, cur.line - 600); i <= cur.line; i++) { const l = K.stripComment(i === cur.line ? cm.getLine(i).slice(0, cur.ch) : cm.getLine(i)); const re = /\\(begin|end)\{([^}]+)\}/g; let m; while ((m = re.exec(l))) { if (m[1] === "begin") st.push(m[2]); else { const k = st.lastIndexOf(m[2]); if (k >= 0) st.splice(k, 1); } } }
    return st.reverse().filter((e) => e !== "document").concat(st.indexOf("document") >= 0 ? ["document"] : []);
  }

  /* ---- 커서: 수식 미리보기 · 고른 글 막대 · 상태 줄 ---- */
  let katexP = null;
  function loadKatex() {
    if (window.katex) return Promise.resolve(true); if (katexP) return katexP;
    katexP = new Promise((res) => { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css"; document.head.appendChild(l); const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"; s.onload = () => res(true); s.onerror = () => res(false); document.head.appendChild(s); setTimeout(() => res(!!window.katex), 8000); });
    return katexP;
  }
  function onCursor(cm) {
    clearTimeout(onCursor.t); onCursor.t = setTimeout(() => {
      stat();
      if (cm.somethingSelected() && cm.getSelection().trim().length > 1) showSelBar(); else hideSelBar();
      if (S.set.math) mathShow(); else mathHide();
      if (S.side === "outline") markOutline();
    }, 110);
  }
  async function mathShow() {
    const cm = S.cm; if (!cm || !cm.hasFocus() || cm.somethingSelected() || modeOf(S.file) !== "stex") return mathHide();
    const c = cm.getCursor(); const m = K.mathAt((i) => cm.getLine(i), cm.lineCount(), c.line, c.ch); if (!m) return mathHide();
    if (!window.katex) { await loadKatex(); if (!window.katex) return; }
    let el = $("ppMath"); if (!el) { el = document.createElement("div"); el.id = "ppMath"; el.className = "pp-math"; document.body.appendChild(el); }
    let h; try { h = katex.renderToString(m.src, { displayMode: true, throwOnError: true, strict: false }); } catch (e) { h = '<span class="pp-merr">⚠ ' + esc(String(e.message || e).replace(/^KaTeX parse error: /, "")).slice(0, 140) + "</span>"; }
    el.innerHTML = '<small>수식 미리보기</small>' + h;
    const pos = cm.charCoords({ line: m.to, ch: 0 }, "window"); const r = cm.getWrapperElement().getBoundingClientRect();
    el.style.left = Math.max(r.left + 50, Math.min(window.innerWidth - 20 - Math.min(520, el.offsetWidth || 300), r.left + 60)) + "px";
    let top = pos.bottom + 8; if (top + 120 > window.innerHeight) top = cm.charCoords({ line: m.from, ch: 0 }, "window").top - (el.offsetHeight || 80) - 8; el.style.top = top + "px"; el.classList.add("on");
  }
  function mathHide() { const el = $("ppMath"); if (el) el.classList.remove("on"); }
  function showSelBar() {
    const cm = S.cm; let el = $("ppSelBar");
    if (!el) { el = document.createElement("div"); el.id = "ppSelBar"; el.className = "pp-selbar"; document.body.appendChild(el); el.addEventListener("mousedown", (e) => e.preventDefault()); el.addEventListener("click", (e) => { const b = e.target.closest("[data-sb]"); if (!b) return; const k = b.dataset.sb; if (k === "b") wrapSel("textbf"); else if (k === "i") wrapSel("textit"); else if (k === "cmt") addComment(); else if (k === "chat") { S.ai = true; setPref("ai", true); grid(); paintAi(); const ta = $("ppAiQ"); if (ta) ta.focus(); } else inlineAI(k); hideSelBar(); }); }
    el.innerHTML = [["b", "<b>B</b>", "굵게"], ["i", "<i>I</i>", "기울임"], ["cmt", "💬", "코멘트"], ["pol", "✨ 다듬기", "학술 문체로 다듬기"], ["short", "✂ 줄이기", "간결하게"], ["en", "🌐 영어로", "학술 영어로"], ["ko", "🇰🇷 한국어로", "한국어로"], ["ask", "⚡ 지시…", "원하는 대로 고치기"], ["chat", "💭 대화로", "AI 대화 칸에서 이어서"]].map((x) => '<button type="button" data-sb="' + x[0] + '" title="' + x[2] + '">' + x[1] + "</button>").join("");
    const p = cm.cursorCoords(cm.getCursor("from"), "window"); el.classList.add("on");
    el.style.left = Math.max(8, Math.min(window.innerWidth - el.offsetWidth - 8, p.left - 10)) + "px"; el.style.top = Math.max(8, p.top - el.offsetHeight - 8) + "px";
  }
  function hideSelBar() { const el = $("ppSelBar"); if (el) el.classList.remove("on"); }
  function stat(kind, text) {
    if (kind === "save") { const s = $("ppSave"); if (s) s.textContent = text; return; }
    const el = $("ppStatus"); if (!el || !S.cm) return;
    const c = S.cm.getCursor(), sel = S.cm.getSelection();
    const pr = allProbs(), ne = pr.filter((p) => p.kind === "error").length, nw = pr.length - ne;
    const b = S.build;
    el.innerHTML = '<span title="파일">' + ICO(S.file || "") + " " + esc(S.file || "") + "</span><span>줄 " + (c.line + 1) + ", 칸 " + (c.ch + 1) + "</span>" + (sel ? "<span>고름 " + sel.length + "자</span>" : "") +
      '<span class="pp-st-w" data-pp="words" title="단어 수 자세히">' + (S._words != null ? "단어 " + S._words.toLocaleString() : "") + "</span>" +
      '<button type="button" class="pp-st-p' + (ne ? " err" : nw ? " warn" : " ok") + '" data-rail="probs" title="문제 목록">' + (ne ? "✕ " + ne : "✓ 0") + " · ▲ " + nw + "</button>" +
      '<span class="pp-st-c">' + (S.compiling ? '<span class="lb-dots"><i></i><i></i><i></i></span> 컴파일 중' : b && b.build ? "PDF " + (b.pages || 0) + "쪽 · " + (b.sec || S.lastSec) + "초" : "") + "</span>" +
      "<span>" + (S.engine ? esc(S.engine) + (S.allowed ? "" : " · 관리자 전용") : "엔진 없음") + "</span>" + (S.set.auto ? '<span title="입력을 멈추면 저절로 컴파일">자동 ●</span>' : "");
  }

  /* ================================================================== 옆 칸 */
  function paintSide() {
    const el = $("ppSide"); if (!el) return; grid();
    const T = { files: "파일", outline: "차례", find: "모든 파일에서 찾기", probs: "문제", bib: "참고문헌", cmts: "코멘트", hist: "버전 기록", sym: "기호", set: "설정" };
    const head = (extra) => '<div class="pp-sh"><b>' + T[S.side] + "</b>" + (extra || "") + '<button type="button" class="pp-ib" data-pp="sideclose" title="옆 칸 접기" aria-label="접기">«</button></div>';
    if (S.side === "files") { el.innerHTML = head('<span class="pp-sh-a"><button type="button" class="pp-ib" data-fa="newf" title="새 파일">＋📄</button><button type="button" class="pp-ib" data-fa="newd" title="새 폴더">＋📁</button><button type="button" class="pp-ib" data-fa="up" title="올리기(그림·.tex·.bib·zip)">⬆</button><button type="button" class="pp-ib" data-fa="more" title="더 보기">⋯</button></span>') + '<div class="pp-tree" id="ppTree"></div><div class="pp-drop-hint">파일을 끌어다 놓으면 올라가요 · 항목을 끌어 폴더로 옮겨요</div>'; paintTree(); return; }
    if (S.side === "outline") { el.innerHTML = head() + '<div class="pp-ol" id="ppOl"></div>'; paintOutline(); return; }
    if (S.side === "find") { el.innerHTML = head() + '<div class="pp-find"><input id="ppFq" type="search" placeholder="모든 파일에서 찾기" value="' + esc(S.findQ) + '"><input id="ppFr" type="text" placeholder="바꿀 글(선택)"><div class="pp-find-o"><label><input type="checkbox" id="ppFc"> 대소문자</label><label><input type="checkbox" id="ppFx"> 정규식</label><button type="button" class="ghost-btn small-btn" data-pp="replall">모두 바꾸기</button></div></div><div class="pp-fres" id="ppFres"></div>'; const q = $("ppFq"); q.addEventListener("input", () => { S.findQ = q.value; clearTimeout(q._t); q._t = setTimeout(findAll, 200); }); ["ppFc", "ppFx"].forEach((i) => $(i).addEventListener("change", findAll)); findAll(); return; }
    if (S.side === "probs") { el.innerHTML = head('<span class="pp-sh-a"><button type="button" class="pp-ib" data-pp="compile" title="다시 컴파일">▶</button></span>') + '<div id="ppProbs"></div>'; paintProbs(); return; }
    if (S.side === "bib") { el.innerHTML = head() + '<div id="ppBib"></div>'; paintBib(); return; }
    if (S.side === "cmts") { el.innerHTML = head('<span class="pp-sh-a"><button type="button" class="pp-ib" data-pp="addcmt" title="지금 줄에 코멘트">＋</button></span>') + '<div id="ppCmts"></div>'; paintCmts(); return; }
    if (S.side === "hist") { el.innerHTML = head('<span class="pp-sh-a"><button type="button" class="pp-ib" data-pp="snap" title="지금 버전 저장">📌</button></span>') + '<div id="ppHist"></div>'; paintHist(); return; }
    if (S.side === "sym") { el.innerHTML = head() + '<div id="ppSym"></div>'; paintSym(); return; }
    if (S.side === "set") { el.innerHTML = head() + '<div id="ppSet"></div>'; paintSet(); return; }
  }

  /* ---------------- 📁 폴더 트리 ---------------- */
  function treeModel() {
    const root = { name: "", path: "", dirs: {}, files: [] };
    const dir = (p) => { let n = root; if (!p) return n; p.split("/").forEach((seg, i, a) => { const pp = a.slice(0, i + 1).join("/"); n.dirs[seg] = n.dirs[seg] || { name: seg, path: pp, dirs: {}, files: [] }; n = n.dirs[seg]; }); return n; };
    S.data.folders.forEach((f) => dir(f));
    Object.keys(S.data.files).forEach((p) => dir(dirOf(p)).files.push({ path: p, text: true, size: (S.data.files[p] || "").length }));
    S.assets.forEach((a) => { if (S.data.files[a.name] == null) dir(dirOf(a.name)).files.push({ path: a.name, text: false, size: a.size }); });
    return root;
  }
  function paintTree() {
    const el = $("ppTree"); if (!el) return; const t = treeModel(); const cmt = {}; S.data.comments.filter((c) => !c.done).forEach((c) => { cmt[c.file] = (cmt[c.file] || 0) + 1; });
    const pr = {}; allProbs().forEach((p) => { if (p.file && p.kind === "error") pr[p.file] = 1; });
    const row = (n, depth) => {
      let h = "";
      Object.keys(n.dirs).sort((a, b) => a.localeCompare(b)).forEach((k) => { const d = n.dirs[k], open = !!S.openDirs[d.path]; h += '<div class="pp-tr dir' + (open ? " open" : "") + '" draggable="true" data-dir="' + esc(d.path) + '" style="--d:' + depth + '"><span class="pp-tw">' + (open ? "▾" : "▸") + "</span><i>" + (open ? "📂" : "📁") + "</i><b>" + esc(d.name) + '</b><button type="button" class="pp-tm" data-tmenu="' + esc(d.path) + '" data-isdir="1" aria-label="메뉴">⋯</button></div>' + (open ? row(d, depth + 1) : ""); });
      n.files.sort((a, b) => (a.path === S.data.main ? -1 : b.path === S.data.main ? 1 : baseOf(a.path).localeCompare(baseOf(b.path)))).forEach((f) => { h += '<div class="pp-tr file' + (f.path === S.file ? " on" : "") + (f.text ? "" : " bin") + '" draggable="true" data-file="' + esc(f.path) + '" style="--d:' + depth + '" title="' + esc(f.path) + " · " + kb(f.size) + '"><span class="pp-tw"></span><i>' + ICO(f.path) + "</i><b>" + esc(baseOf(f.path)) + "</b>" + (f.path === S.data.main ? '<em class="pp-main" title="본문">★</em>' : "") + (pr[f.path] ? '<em class="pp-ferr" title="오류 있음">●</em>' : "") + (cmt[f.path] ? '<em class="pp-fcm">💬' + cmt[f.path] + "</em>" : "") + '<button type="button" class="pp-tm" data-tmenu="' + esc(f.path) + '" aria-label="메뉴">⋯</button></div>'; });
      return h;
    };
    const nf = Object.keys(S.data.files).length, na = S.assets.length;
    el.innerHTML = '<div class="pp-tr dir root" data-dir="" style="--d:0"><span class="pp-tw">▾</span><i>🗂</i><b>' + esc(projName()) + "</b><small>글 " + nf + " · 그림·자료 " + na + "</small></div>" + row(t, 1);
    bindTree(el);
  }
  function projName() { const p = S.list.find((x) => x.id === S.pid); return p ? p.name.slice(0, 30) : "원고"; }
  function bindTree(el) {
    el.onclick = (e) => {
      const m = e.target.closest("[data-tmenu]"); if (m) { e.stopPropagation(); const r = m.getBoundingClientRect(); treeMenu(m.dataset.tmenu, !!m.dataset.isdir, r.left, r.bottom + 4); return; }
      const d = e.target.closest("[data-dir]"); if (d && d.dataset.dir) { S.openDirs[d.dataset.dir] = !S.openDirs[d.dataset.dir]; setPref("dirs", S.openDirs); paintTree(); return; }
      const f = e.target.closest("[data-file]"); if (f) openFile(f.dataset.file);
    };
    el.ondblclick = (e) => { const f = e.target.closest("[data-file]"), d = e.target.closest("[data-dir]"); if (f) renameItem(f.dataset.file, false); else if (d && d.dataset.dir) renameItem(d.dataset.dir, true); };
    el.oncontextmenu = (e) => { const f = e.target.closest("[data-file]"), d = e.target.closest("[data-dir]"); if (!f && !d) return; e.preventDefault(); treeMenu(f ? f.dataset.file : d.dataset.dir, !f, e.clientX, e.clientY); };
    el.ondragstart = (e) => { const it = e.target.closest("[data-file],[data-dir]"); if (!it) return; e.dataTransfer.setData("text/pp-path", it.dataset.file != null ? it.dataset.file : it.dataset.dir); e.dataTransfer.setData("text/pp-isdir", it.dataset.file != null ? "" : "1"); e.dataTransfer.effectAllowed = "move"; };
    el.ondragover = (e) => { const d = e.target.closest("[data-dir]") || e.target.closest("[data-file]"); if (!d) return; e.preventDefault(); el.querySelectorAll(".dragon").forEach((x) => x.classList.remove("dragon")); (d.dataset.dir != null ? d : el.querySelector('[data-dir=""]')).classList.add("dragon"); };
    el.ondragleave = () => el.querySelectorAll(".dragon").forEach((x) => x.classList.remove("dragon"));
    el.ondrop = async (e) => {
      e.preventDefault(); el.querySelectorAll(".dragon").forEach((x) => x.classList.remove("dragon"));
      const d = e.target.closest("[data-dir]"); const f = e.target.closest("[data-file]"); const dest = d ? d.dataset.dir : f ? dirOf(f.dataset.file) : "";
      if (e.dataTransfer.files && e.dataTransfer.files.length) { await uploadFiles(e.dataTransfer.files, dest); return; }
      const src = e.dataTransfer.getData("text/pp-path"); if (!src && src !== "") return; const isDir = !!e.dataTransfer.getData("text/pp-isdir");
      if (src === dest || dirOf(src) === dest || (isDir && (dest + "/").indexOf(src + "/") === 0)) return;
      await moveItem(src, join(dest, baseOf(src)), isDir);
    };
  }
  function treeMenu(p, isDir, x, y) {
    const items = [];
    if (isDir) items.push(["📄 새 파일", () => newFile(p)], ["📁 새 하위 폴더", () => newFolder(p)], ["⬆ 여기로 올리기", () => { S.upDir = p; $("ppUp").click(); }], ["📦 zip 을 여기에 풀기", () => { S.zipDir = p; $("ppZip").click(); }], ["✎ 이름 바꾸기", () => renameItem(p, true)], ["⧉ 폴더 복제 (버전 만들기)", () => dupItem(p, true)], ["🗑 지우기", () => removeItem(p, true), true]);
    else {
      const txt = S.data.files[p] != null;
      if (txt) items.push(["열기", () => openFile(p)]); else items.push(["보기", () => openFile(p)]);
      if (/\.tex$/.test(p) && p !== S.data.main) items.push(["★ 본문으로 지정(이 파일을 컴파일)", () => setMain(p)]);
      if (!txt && /\.(png|jpe?g|pdf|eps|gif)$/i.test(p)) items.push(["🖼 그림으로 넣기", () => figureDialog(p)]);
      items.push(["✎ 이름 바꾸기", () => renameItem(p, false)], ["📂 다른 폴더로 옮기기", () => moveTo(p)], ["⧉ 복제", () => dupItem(p, false)], ["⬇ 내려받기", () => downloadItem(p)], ["🗑 지우기", () => removeItem(p, false), true]);
    }
    popMenu(items, x, y);
  }
  function popMenu(items, x, y) {
    let el = $("ppMenu"); if (!el) { el = document.createElement("div"); el.id = "ppMenu"; el.className = "pp-menu"; document.body.appendChild(el); document.addEventListener("mousedown", (e) => { if (!e.target.closest("#ppMenu")) el.classList.remove("on"); }); }
    el.innerHTML = items.map((it, i) => (it === "-" ? "<hr>" : '<button type="button" data-mi="' + i + '"' + (it[2] ? ' class="danger"' : "") + ">" + it[0] + "</button>")).join("");
    el.classList.add("on"); el.style.left = Math.min(window.innerWidth - el.offsetWidth - 8, x) + "px"; el.style.top = Math.min(window.innerHeight - el.offsetHeight - 8, y) + "px";
    el.onclick = (e) => { const b = e.target.closest("[data-mi]"); if (!b) return; el.classList.remove("on"); items[+b.dataset.mi][1](); };
  }
  function exists(p) { return S.data.files[p] != null || S.assets.some((a) => a.name === p || a.name.indexOf(p + "/") === 0) || S.data.folders.some((f) => f === p || f.indexOf(p + "/") === 0) || Object.keys(S.data.files).some((f) => f.indexOf(p + "/") === 0); }
  function newFile(dir) {
    const n = prompt("새 파일 이름 (예: method.tex, refs.bib)" + (dir ? "\n폴더: " + dir : ""), "new.tex"); if (!n) return;
    const p = cleanPath(join(dir, n.trim())); if (!p) return toast("이름이 이상해요"); if (!EDIT_RE.test(p)) return toast("글 파일(.tex·.bib·.sty·.cls·.txt·.md 등)만 만들 수 있어요 — 그림은 ⬆ 로 올려요"); if (exists(p)) return toast("이미 있어요");
    S.data.files[p] = /\.tex$/.test(p) ? "% " + baseOf(p) + "\n" + BS + "section{" + baseOf(p).replace(/\.tex$/, "") + "}\n\n" : ""; S.data.folders = S.data.folders.filter((f) => f !== dir);
    persist(); openFile(p); paintSide();
    if (/\.tex$/.test(p) && p !== S.data.main) toast("본문에 넣으려면 " + BS + "input{" + p.replace(/\.tex$/, "") + "} 를 쓰세요");
  }
  function newFolder(dir) { const n = prompt("새 폴더 이름 (예: figures, chapters, v2)" + (dir ? "\n안에 만들 폴더: " + dir : ""), ""); if (!n) return; const p = cleanPath(join(dir, n.trim())); if (!p) return toast("이름이 이상해요"); if (exists(p)) return toast("이미 있어요"); S.data.folders.push(p); S.openDirs[p] = true; if (dir) S.openDirs[dir] = true; persist(); paintSide(); }
  function setMain(p) { S.data.main = p; persist(); paintTabs(); paintSide(); runChecks(); toast("★ 본문: " + p + " — 이제 이 파일을 컴파일해요"); if (S.set.auto) compile("main"); }
  function renameItem(p, isDir) { const n = prompt("새 이름", baseOf(p)); if (!n || n === baseOf(p)) return; const to = cleanPath(join(dirOf(p), n.trim())); if (!to) return toast("이름이 이상해요"); if (exists(to)) return toast("이미 있어요"); moveItem(p, to, isDir); }
  function moveTo(p) { const dirs = [""].concat(allDirs()); const d = prompt("옮길 폴더 (비우면 맨 위)\n있는 폴더: " + dirs.filter(Boolean).join(", "), dirOf(p)); if (d == null) return; const to = cleanPath(join(d.trim(), baseOf(p))); if (!to) return toast("폴더 이름이 이상해요"); if (exists(to)) return toast("이미 있어요"); moveItem(p, to, false); }
  function allDirs() { const s = {}; S.data.folders.forEach((f) => { s[f] = 1; }); Object.keys(S.data.files).concat(S.assets.map((a) => a.name)).forEach((p) => { const d = p.split("/"); for (let i = 1; i < d.length; i++) s[d.slice(0, i).join("/")] = 1; }); return Object.keys(s).sort(); }
  // 옮기기·이름 바꾸기 — 글 파일·폴더·그림(서버) + \input·\includegraphics 참조도 같이 고친다
  async function moveItem(from, to, isDir, quiet) {
    flushDocs(); const F = S.data.files, moved = []; const under = (p) => p === from || p.indexOf(from + "/") === 0;
    Object.keys(F).filter(under).forEach((p) => { const np = to + p.slice(from.length); F[np] = F[p]; delete F[p]; moved.push([p, np]); if (S.docs[p]) { S.docs[np] = S.docs[p]; S.docs[np]._pp = np; delete S.docs[p]; } });
    S.data.folders = S.data.folders.map((f) => (under(f) ? to + f.slice(from.length) : f));
    if (S.assets.some((a) => under(a.name))) { try { await req("texmv", {}, { from: from, to: to }); S.assets.filter((a) => under(a.name)).forEach((a) => moved.push([a.name, to + a.name.slice(from.length)])); } catch (e) { toast("그림 파일을 옮기지 못했어요: " + e.message); } await loadAssets(); }
    S.data.comments.forEach((c) => { if (under(c.file)) c.file = to + c.file.slice(from.length); });
    S.data.open = S.data.open.map((p) => (under(p) ? to + p.slice(from.length) : p)); if (under(S.data.main)) S.data.main = to + S.data.main.slice(from.length); if (S.file && under(S.file)) S.file = to + S.file.slice(from.length);
    if (isDir) S.openDirs[to] = S.openDirs[from];
    const fixed = fixRefs(moved);
    persist(); paintTabs(); paintSide(); runChecks(); if (S.file && S.docs[S.file] && S.cm) S.cm.swapDoc(S.docs[S.file]);
    if (!quiet) toast("옮겼어요: " + from + " → " + to + (fixed ? " · 참조 " + fixed + "곳도 고쳤어요" : ""));
    return moved;
  }
  function fixRefs(moved) {
    let n = 0; const base = dirOf(S.data.main); const rel = (p) => (base && p.indexOf(base + "/") === 0 ? p.slice(base.length + 1) : p);
    moved.forEach(([a, b]) => {
      const forms = /\.tex$/.test(a) ? [[rel(a).replace(/\.tex$/, ""), rel(b).replace(/\.tex$/, "")], [rel(a), rel(b)]] : /\.bib$/.test(a) ? [[rel(a).replace(/\.bib$/, ""), rel(b).replace(/\.bib$/, "")]] : [[rel(a), rel(b)], [rel(a).replace(/\.[^.]+$/, ""), rel(b).replace(/\.[^.]+$/, "")]];
      Object.keys(S.data.files).filter((f) => /\.tex$/.test(f)).forEach((f) => {
        let t = S.data.files[f]; const o = t;
        forms.forEach(([x, y]) => { const re = new RegExp("(\\\\(?:input|include|subfile|includegraphics|bibliography|addbibresource)\\*?(?:\\[[^\\]]*\\])?\\{)" + x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\}", "g"); t = t.replace(re, (m0, pre) => { n++; return pre + y + "}"; }); });
        if (t !== o) { S.data.files[f] = t; setDocText(f, t); }
      });
    });
    return n;
  }
  async function dupItem(p, isDir) {
    flushDocs(); let to = isDir ? p + "-복사본" : p.replace(/(\.[^./]+)?$/, (m) => "-복사본" + (m || "")); let i = 2; while (exists(to)) to = isDir ? p + "-v" + i++ : p.replace(/(\.[^./]+)?$/, (m) => "-" + i++ + (m || ""));
    const nm = prompt(isDir ? "새 폴더 이름 (버전 폴더라면 v2·2026-11-04 처럼)" : "복제할 이름", to); if (!nm) return; const dst = cleanPath(nm); if (!dst || exists(dst)) return toast("이름이 이상하거나 이미 있어요");
    const F = S.data.files; Object.keys(F).filter((f) => f === p || f.indexOf(p + "/") === 0).forEach((f) => { F[dst + f.slice(p.length)] = F[f]; });
    if (isDir) S.data.folders.filter((f) => f.indexOf(p + "/") === 0).forEach((f) => S.data.folders.push(dst + f.slice(p.length))); if (isDir) S.data.folders.push(dst);
    if (S.assets.some((a) => a.name === p || a.name.indexOf(p + "/") === 0)) { try { await req("texcp", {}, { from: p, to: dst }); } catch (e) { toast(e.message); } await loadAssets(); }
    S.openDirs[dst] = true; persist(); paintSide(); toast("복제했어요: " + dst + (isDir ? " — 안의 main 을 ★ 본문으로 지정하면 그 버전을 컴파일해요" : ""));
  }
  async function removeItem(p, isDir) {
    const nT = Object.keys(S.data.files).filter((f) => f === p || f.indexOf(p + "/") === 0).length, nA = S.assets.filter((a) => a.name === p || a.name.indexOf(p + "/") === 0).length;
    if (p === S.data.main) return toast("본문 파일은 지울 수 없어요 — 다른 파일을 ★ 본문으로 지정한 뒤 지우세요");
    if (!confirm((isDir ? "폴더 '" + p + "'" : "'" + p + "'") + " 를 지울까요?" + (isDir ? "\n안의 글 파일 " + nT + "개 · 그림·자료 " + nA + "개" : "") + (nA ? "\n(그림·자료 파일은 되돌릴 수 없어요. 글 파일은 🕘 버전에서 되살릴 수 있어요)" : ""))) return;
    snapshot("지우기 전: " + p, true);
    Object.keys(S.data.files).filter((f) => f === p || f.indexOf(p + "/") === 0).forEach((f) => { delete S.data.files[f]; delete S.docs[f]; });
    S.data.folders = S.data.folders.filter((f) => !(f === p || f.indexOf(p + "/") === 0));
    if (nA) { try { await req("texrm", {}, { name: p }); } catch (e) { toast(e.message); } await loadAssets(); }
    S.data.comments = S.data.comments.filter((c) => !(c.file === p || c.file.indexOf(p + "/") === 0));
    if (S.file && (S.file === p || S.file.indexOf(p + "/") === 0)) S.file = null;
    persist(); openFile(S.file || S.data.main); paintSide(); runChecks();
  }
  function downloadItem(p) { if (S.data.files[p] != null) { flushDocs(); TK.download(baseOf(p), S.data.files[p], "text/plain"); } else { const a = document.createElement("a"); a.href = url("texasset", { name: p }); a.download = baseOf(p); document.body.appendChild(a); a.click(); a.remove(); } }
  async function uploadFiles(fl, dir) {
    dir = dir || ""; let nT = 0, nA = 0; const fail = [];
    for (const f of Array.from(fl)) {
      const p = cleanPath(join(dir, f.name)); if (!p) { fail.push(f.name); continue; }
      if (/\.zip$/i.test(f.name)) { if (confirm("'" + f.name + "' 을 " + (dir || "맨 위") + " 에 풀어 넣을까요? (Overleaf 프로젝트 zip 이면 그대로 들어와요)")) await importZip(f, dir); continue; }
      if (EDIT_RE.test(f.name)) { S.data.files[p] = await f.text(); setDocText(p, S.data.files[p]); nT++; continue; }
      try { const r = await fetch(url("texasset", { name: p }), { method: "POST", credentials: "same-origin", headers: { "X-Study-Vault": "1" }, body: f }).then((x) => x.json()); if (r.ok) nA++; else fail.push(f.name + "(" + r.message + ")"); } catch (e) { fail.push(f.name); }
    }
    if (dir) S.openDirs[dir] = true; await loadAssets(); persist(); paintSide(); runChecks();
    toast("올렸어요: 글 " + nT + " · 그림·자료 " + nA + (fail.length ? " · 실패 " + fail.join(", ") : ""), 4000);
  }
  async function importZip(f, dir) {
    toast("zip 을 푸는 중…", 8000);
    try {
      const r = await fetch(url("teximport", { prefix: dir || "" }), { method: "POST", credentials: "same-origin", headers: { "X-Study-Vault": "1" }, body: f }).then((x) => x.json());
      if (!r.ok) { toast("가져오지 못했어요: " + (r.message || "")); return null; }
      if (S.data) { Object.keys(r.files).forEach((p) => { S.data.files[p] = r.files[p]; setDocText(p, r.files[p]); }); if (dir) S.openDirs[dir] = true; await loadAssets(); persist(); paintSide(); runChecks(); if (r.main && confirm("가져온 본문 '" + r.main + "' 을 ★ 본문으로 지정할까요?")) setMain(r.main); }
      toast("가져왔어요: 글 " + Object.keys(r.files).length + " · 그림·자료 " + r.assets.length + (r.skipped.length ? " · 건너뜀 " + r.skipped.length : ""), 5000);
      return r;
    } catch (e) { toast("가져오지 못했어요: " + e.message); return null; }
  }
  function previewAsset(a) {
    const u = url("texasset", { name: a.name, img: IMG_RE.test(a.name) ? 1 : "" });
    const body = IMG_RE.test(a.name) ? '<img class="pp-aimg" src="' + esc(u) + '" alt="">' : /\.pdf$/i.test(a.name) ? '<img class="pp-aimg" src="' + esc(url("texasset", { name: a.name, png: 1, w: 900 })) + '" alt="">' : '<p class="sh-muted">' + esc(extOf(a.name).toUpperCase()) + " 파일 · " + kb(a.size) + "</p>";
    modal("🖼 " + a.name, body + '<div class="lb-row"><button type="button" class="primary small-btn" data-mod="fig">그림으로 넣기</button><button type="button" class="ghost-btn small-btn" data-mod="dl">⬇ 내려받기</button></div>', (k, m) => { if (k === "fig") { m.close(); figureDialog(a.name); } if (k === "dl") downloadItem(a.name); });
  }

  /* ---------------- ≡ 차례 ---------------- */
  function paintOutline() {
    const el = $("ppOl"); if (!el) return; const files = texts(); const ol = K.outline(files, S.data.main); const w = K.words(files, S.data.main); S._words = w.words;
    el.innerHTML = '<div class="pp-olst"><span><b>' + w.words.toLocaleString() + "</b> 단어</span><span><b>" + w.figures + "</b> 그림</span><span><b>" + w.tables + "</b> 표</span><span><b>" + w.equations + "</b> 식</span><span><b>" + w.cites + '</b> 인용</span><button type="button" class="pp-ib" data-pp="words" title="자세히">⋯</button></div>' +
      (ol.length ? ol.map((o, i) => '<button type="button" class="pp-oi l' + Math.max(0, o.lv) + '" data-oi="' + i + '" title="' + esc(o.file + ":" + o.line) + '">' + esc(o.title) + "<small>" + esc(baseOf(o.file)) + ":" + o.line + "</small></button>").join("") : '<p class="sh-muted">' + BS + "section{…} 을 쓰면 여기에 차례가 생겨요.</p>");
    el.onclick = (e) => { const b = e.target.closest("[data-oi]"); if (!b) return; const o = ol[+b.dataset.oi]; openFile(o.file, o.line, true); if (S.build && S.vm !== "edit") setTimeout(() => syncFwd(true), 80); };
    S._ol = ol; markOutline(); stat();
  }
  function markOutline() { const el = $("ppOl"); if (!el || !S._ol || !S.cm) return; const ln = S.cm.getCursor().line + 1; let best = -1; S._ol.forEach((o, i) => { if (o.file === S.file && o.line <= ln) best = i; }); el.querySelectorAll(".pp-oi").forEach((b) => b.classList.toggle("on", +b.dataset.oi === best)); }

  /* ---------------- 🔍 모든 파일에서 찾기 ---------------- */
  function findRe() { const q = ($("ppFq") || {}).value || ""; if (!q) return null; const cs = $("ppFc") && $("ppFc").checked, rx = $("ppFx") && $("ppFx").checked; try { return new RegExp(rx ? q : q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), cs ? "g" : "gi"); } catch (e) { return null; } }
  function findAll() {
    const el = $("ppFres"); if (!el) return; const re = findRe(); if (!re) { el.innerHTML = '<p class="sh-muted">찾을 글을 넣으세요. 결과를 누르면 그 줄로 가요.</p>'; return; }
    const files = texts(); let n = 0, h = "";
    Object.keys(files).sort().forEach((f) => { const hits = []; String(files[f]).split("\n").forEach((l, i) => { re.lastIndex = 0; if (re.test(l)) hits.push([i + 1, l]); }); if (!hits.length) return; n += hits.length; h += '<div class="pp-fg"><b>' + ICO(f) + " " + esc(f) + " <small>" + hits.length + "</small></b>" + hits.slice(0, 60).map((x) => { re.lastIndex = 0; return '<button type="button" data-fh="' + esc(f) + "|" + x[0] + '"><span>' + x[0] + "</span>" + esc(x[1].trim().slice(0, 140)).replace(new RegExp(re.source.replace(/&/g, "&amp;"), re.flags), (m) => "<mark>" + m + "</mark>") + "</button>"; }).join("") + "</div>"; });
    el.innerHTML = '<p class="sh-muted">' + n + "곳</p>" + h;
    el.onclick = (e) => { const b = e.target.closest("[data-fh]"); if (!b) return; const [f, l] = b.dataset.fh.split("|"); openFile(f, +l, true); };
  }
  function replaceAll() { const re = findRe(); if (!re) return; const to = ($("ppFr") || {}).value || ""; flushDocs(); let n = 0; snapshot("모두 바꾸기 전", true); Object.keys(S.data.files).forEach((f) => { const o = S.data.files[f]; const t = o.replace(re, () => { n++; return to; }); if (t !== o) { S.data.files[f] = t; setDocText(f, t); } }); persist(); findAll(); toast(n + "곳을 바꿨어요(🕘 버전에서 되돌릴 수 있어요)"); }

  /* ---------------- ⚠ 문제 ---------------- */
  function allProbs() { const seen = {}; return S.probs.compile.concat(S.probs.check).filter((p) => { const k = p.kind + p.file + p.line + p.msg; if (seen[k]) return false; seen[k] = 1; return true; }).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "error" ? -1 : 1)); }
  function runChecks() { if (!S.data) return; S.probs.check = K.lint(texts(), S.data.main, assetNames()); paintProbs(); paintMarks(); if (S.side === "outline") paintOutline(); else { try { S._words = K.words(S.data.files, S.data.main).words; } catch (e) { /* 계속 */ } } stat(); }
  function paintProbs() {
    const all = allProbs(), ne = all.filter((p) => p.kind === "error").length;
    const b = $("ppB_probs"); if (b) { b.textContent = all.length ? String(all.length) : ""; b.className = "pp-badge" + (ne ? " err" : all.length ? " warn" : ""); }
    if (S.side === "files" && $("ppTree")) paintTree();
    const el = $("ppProbs"); if (!el) return;
    if (!all.length) { el.innerHTML = '<div class="pp-ok">✓ 문제가 없어요' + (S.build ? '<small>마지막 컴파일 ' + (S.build.sec || "") + "초</small>" : "") + "</div>"; return; }
    el.innerHTML = '<div class="pp-pbar"><span>오류 <b>' + ne + "</b> · 경고 <b>" + (all.length - ne) + '</b></span><button type="button" class="primary small-btn" data-pp="aifix">✨ AI 로 고치기</button></div>' +
      all.map((p, i) => { const h = K.hint(p.msg); return '<button type="button" class="pp-pi ' + p.kind + '" data-pi="' + i + '"><i>' + (p.kind === "error" ? "✕" : "▲") + "</i><span><b>" + esc(p.msg) + "</b>" + (h ? "<small>" + esc(h) + "</small>" : "") + "<em>" + esc(p.file ? baseOf(p.file) + (p.line ? ":" + p.line : "") : "전체") + (p.src === "check" ? " · 미리 검사" : " · 컴파일") + "</em></span></button>"; }).join("");
    el.onclick = (e) => { const x = e.target.closest("[data-pi]"); if (!x) return; const p = all[+x.dataset.pi]; if (p.file && (S.data.files[p.file] != null)) openFile(p.file, p.line || 1, true); };
  }
  function paintMarks() {
    const cm = S.cm; if (!cm) return; cm.clearGutter("pp-g-lint"); cm.clearGutter("pp-g-cmt");
    allProbs().filter((p) => p.file === S.file && p.line).forEach((p) => { const m = document.createElement("span"); m.className = "pp-gm " + p.kind; m.textContent = p.kind === "error" ? "●" : "▲"; m.title = p.msg; if (p.line - 1 < cm.lineCount()) cm.setGutterMarker(p.line - 1, "pp-g-lint", m); });
    S.data.comments.filter((c) => c.file === S.file && !c.done).forEach((c) => { const m = document.createElement("span"); m.className = "pp-gc"; m.textContent = "💬"; m.title = c.text; if (c.line - 1 < cm.lineCount()) cm.setGutterMarker(c.line - 1, "pp-g-cmt", m); });
    const b = $("ppB_cmts"); if (b) { const n = S.data.comments.filter((c) => !c.done).length; b.textContent = n ? String(n) : ""; b.className = "pp-badge" + (n ? " info" : ""); }
  }

  /* ================================================================== 컴파일 */
  async function compile(why) {
    if (!S.data) return;
    if (why === "auto" && (!S.set.auto || S.vm === "edit" || S.busyAI)) return;
    if (!S.engine) { if (why !== "auto" && why !== "open") { S.pv = "html"; paintPvBar(); paintPv(); toast("이 PC 에 LaTeX 엔진이 없어 바로 보기로 보여 드려요"); } return; }
    if (!S.allowed) { if (why !== "auto" && why !== "open") { S.log = "PDF 컴파일은 관리자 계정만 쓸 수 있어요(TeX 엔진이 이 PC 의 파일을 읽을 수 있어서). 바로 보기는 누구나 쓸 수 있어요."; S.pv = "html"; paintPvBar(); paintPv(); toast("PDF 컴파일은 관리자 계정만 — 바로 보기로 보여 드려요", 4000); } return; }
    if (S.compiling) { S.queued = true; return; }
    S.compiling = true; S.queued = false; cmpBtn(); stat(); persist();
    if (!S.warm) toast("처음 컴파일은 필요한 패키지를 받느라 1~3분 걸릴 수 있어요. 다음부터는 몇 초면 돼요.", 8000);
    let r;
    try { r = await fetch(url("tex"), { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-Study-Vault": "1" }, body: JSON.stringify({ files: texts(), main: S.data.main }) }).then((x) => x.json()); }
    catch (e) { r = { ok: false, message: e.message, problems: [] }; }
    S.compiling = false; S.warm = true;
    S.log = r.log || r.message || ""; S.out = r.out || ""; S.probs.compile = r.problems || []; S.lastSec = r.sec || 0;
    if (r.ok) { S.build = r; if (S.pv === "log" && !(r.errors > 0)) S.pv = "pdf"; autoSnap(); }
    else if (r.error === "admin_only" || r.error === "no_engine") { S.allowed = r.error !== "admin_only" && S.allowed; toast(r.message, 5000); }
    else if (!r.problems || !r.problems.length) S.probs.compile = [{ kind: "error", file: null, line: 0, msg: r.message || "컴파일 실패", src: "engine" }];
    cmpBtn(r); paintProbs(); paintMarks(); stat(); paintPvBar(); paintPv();
    if (S.queued) setTimeout(() => compile("queued"), 50);
    return r;
  }
  function cmpBtn(r) {
    const t = $("ppCmpT"), b = document.querySelector("#pp2 .pp-cmp"); if (!t || !b) return;
    b.classList.toggle("busy", S.compiling); b.classList.remove("ok", "err");
    if (S.compiling) { t.textContent = "컴파일 중…"; return; }
    t.textContent = "컴파일"; if (r) b.classList.add(r.ok && !(r.errors > 0) ? "ok" : "err");
  }

  /* ================================================================== 미리보기 */
  function paintPvBar() {
    const el = $("ppPvBar"); if (!el) return; const b = S.build;
    el.innerHTML = '<span class="pp-seg sm"><button type="button" data-pv="pdf" class="' + (S.pv === "pdf" ? "on" : "") + '">PDF</button><button type="button" data-pv="html" class="' + (S.pv === "html" ? "on" : "") + '" title="엔진 없이 브라우저가 바로 그림(근사)">바로 보기</button><button type="button" data-pv="log" class="' + (S.pv === "log" ? "on" : "") + '">기록</button></span>' +
      (S.pv === "pdf" && b && b.pages ? '<span class="pp-pg-i"><input id="ppPgN" value="1" inputmode="numeric" aria-label="쪽"> / ' + b.pages + '</span><span class="pp-zg"><button type="button" class="pp-ib" data-z="out" title="축소">−</button><button type="button" class="pp-ib pp-zv" data-z="width" title="폭 맞춤">' + (typeof S.zoom === "number" ? Math.round(S.zoom * 100) + "%" : S.zoom === "page" ? "쪽" : "폭") + '</button><button type="button" class="pp-ib" data-z="in" title="확대">＋</button><button type="button" class="pp-ib" data-z="page" title="쪽 맞춤">⤢</button></span><button type="button" class="pp-ib" data-pp="syncfwd" title="커서 자리를 PDF 에서 보기 (Ctrl+.) · PDF 를 더블클릭하면 원고로">⇥</button><span class="pp-pfind"><input id="ppPq" type="search" placeholder="PDF 에서 찾기" value="' + esc(S.pq || "") + '"><span id="ppPqn"></span></span><button type="button" class="pp-ib' + (S.set.dark ? " on" : "") + '" data-pp="pdark" title="어둡게 보기">🌙</button>' : "<span></span>");
    const pq = $("ppPq"); if (pq) pq.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); if (S.pq === pq.value && S.hits.length) hitStep(e.shiftKey ? -1 : 1); else pdfFind(pq.value); } });
    const pn = $("ppPgN"); if (pn) pn.addEventListener("change", () => pdfGoto(+pn.value || 1));
  }
  function paintPv() {
    const box = $("ppPv"); if (!box) return;
    if (S.pv === "log") { box.innerHTML = '<div class="pp-logv">' + (S.out ? '<details open><summary>엔진 메시지</summary><pre>' + esc(S.out).replace(/^(error:.*)$/gm, '<b class="e">$1</b>').replace(/^(warning:.*)$/gm, '<b class="w">$1</b>') + "</pre></details>" : "") + '<details' + (S.out ? "" : " open") + "><summary>전체 기록(.log)</summary><pre>" + (esc(S.log || "아직 컴파일 기록이 없어요.").replace(/^(!.*)$/gm, '<b class="e">$1</b>').replace(/^(l\.\d+.*)$/gm, '<b class="e">$1</b>').replace(/^((?:LaTeX|Package \w+) Warning:.*)$/gm, '<b class="w">$1</b>')) + "</pre></details></div>"; S.pdfEl = null; return; }
    if (S.pv === "html") { htmlPreview(box); S.pdfEl = null; return; }
    const b = S.build;
    if (!b || !b.pages) { S.pdfEl = null; box.innerHTML = '<div class="pp-empty"><span>📄</span><b>' + (S.compiling ? "컴파일 중…" : !S.engine ? "LaTeX 엔진이 없어요" : !S.allowed ? "PDF 컴파일은 관리자 계정만" : "아직 PDF 가 없어요") + "</b><p>" + (S.compiling ? (S.warm ? "곧 나와요." : "처음 컴파일은 패키지를 받느라 1~3분 걸려요.") : !S.engine || !S.allowed ? "[바로 보기]로 원고 모양을 확인할 수 있어요." : "▶ 컴파일(Ctrl+Enter)을 누르면 여기에 PDF 가 나와요.") + "</p></div>"; return; }
    pdfRender(box);
  }
  function htmlPreview(box) {
    const files = texts(); const names = {}; S.assets.forEach((a) => { names[a.name] = a; names[a.name.replace(/\.[^./]+$/, "")] = a; });
    const base = dirOf(S.data.main);
    const r = K.render(files, S.data.main, { img: (n) => { const a = names[n] || names[join(base, n)] || names[n.replace(/^\.\//, "")]; return a ? (/\.pdf$/i.test(a.name) ? url("texasset", { name: a.name, png: 1, w: 900 }) : url("texasset", { name: a.name, img: 1 })) : null; } });
    const keep = box.querySelector(".pp-doc") ? box.scrollTop : 0;
    box.innerHTML = '<article class="pp-doc' + (r.beamer ? " beamer" : "") + '"><p class="pp-docnote">바로 보기 — 브라우저가 대략 그린 모양이에요. 정확한 모양은 PDF 로.</p>' + r.html + "</article>"; box.scrollTop = keep;
    if (!window.katex && /pp-m/.test(r.html)) loadKatex().then((ok) => { if (ok && S.pv === "html") paintPv(); });
  }
  /* ---- PDF 쪽 보기(쪽 그림 · 다시 컴파일해도 자리 유지 · 원고↔PDF) ---- */
  function pdfW(sc, s) {
    const W = sc.clientWidth - 30; const nat = s[0] * 96 / 72;
    if (S.zoom === "width") return Math.max(200, W);
    if (S.zoom === "page") return Math.max(160, Math.min(W, (sc.clientHeight - 24) * s[0] / s[1]));
    return Math.max(160, Math.round(nat * S.zoom));
  }
  function pdfRender(box) {
    const b = S.build, same = S.pdfEl && box.contains(S.pdfEl) && S.pdfEl._n === b.pages && JSON.stringify(S.pdfEl._sizes) === JSON.stringify(b.sizes);
    if (same) { if (S.pdfEl._build !== b.build) { S.pdfEl._build = b.build; S.pdfEl.querySelectorAll(".pp-pg").forEach((pg) => { const im = pg.querySelector("img"); if (im.dataset.w) swapImg(im, +pg.dataset.p, +im.dataset.w); }); } pdfLayout(); return; }
    const pos = S.pdfEl && box.contains(S.pdfEl) ? pdfPos() : S._pdfPos;
    box.innerHTML = '<div class="pp-psc' + (S.set.dark ? " dark" : "") + '" tabindex="0"><div class="pp-pages">' + b.sizes.map((s, i) => '<div class="pp-pg" data-p="' + (i + 1) + '"><img alt="' + (i + 1) + '쪽" draggable="false"><div class="pp-ov"></div><span class="pp-pgn">' + (i + 1) + "</span></div>").join("") + "</div></div>";
    const sc = box.querySelector(".pp-psc"); S.pdfEl = sc; sc._n = b.pages; sc._sizes = b.sizes; sc._build = b.build;
    if (S.pio) S.pio.disconnect();
    S.pio = new IntersectionObserver((ents) => ents.forEach((en) => { if (en.isIntersecting) loadPg(en.target); }), { root: sc, rootMargin: "800px 0px" });
    sc.querySelectorAll(".pp-pg").forEach((pg) => S.pio.observe(pg));
    sc.addEventListener("scroll", () => { clearTimeout(sc._t); sc._t = setTimeout(() => { S._pdfPos = pdfPos(); const pn = $("ppPgN"); if (pn && document.activeElement !== pn) pn.value = S._pdfPos.p; }, 80); }, { passive: true });
    sc.addEventListener("dblclick", pdfDbl);
    pdfLayout(); if (pos) pdfRestore(pos);
    if (S.hits.length) paintHits();
  }
  function pdfLayout() {
    const sc = S.pdfEl; if (!sc || !sc.isConnected || !S.build) return; const b = S.build;
    sc.querySelectorAll(".pp-pg").forEach((pg) => { const s = b.sizes[+pg.dataset.p - 1]; const w = pdfW(sc, s); pg.style.width = w + "px"; pg.style.height = (w * s[1] / s[0]) + "px"; const im = pg.querySelector("img"); if (im.dataset.w && +im.dataset.w < w * (window.devicePixelRatio || 1) * 0.8) { delete im.dataset.w; loadPg(pg); } });
    const zv = document.querySelector("#pp2 .pp-zv"); if (zv) { const s = b.sizes[0]; zv.textContent = Math.round(pdfW(sc, s) / (s[0] * 96 / 72) * 100) + "%"; }
  }
  function loadPg(pg) {
    const im = pg.querySelector("img"); const want = Math.max(200, Math.min(2800, Math.round(pg.clientWidth * Math.min(2.5, window.devicePixelRatio || 1) / 200) * 200));
    if (+im.dataset.w >= want && im.dataset.b === String(S.build.build)) return; im.dataset.w = want; swapImg(im, +pg.dataset.p, want);
  }
  function swapImg(im, p, w) { const u = url("texpage", { p: p, w: w, v: S.build.build }); if (!im.getAttribute("src")) { im.src = u; im.dataset.b = S.build.build; return; } const n = new Image(); n.onload = () => { im.src = u; im.dataset.b = S.build.build; }; n.src = u; }
  function pdfPos() { const sc = S.pdfEl; if (!sc) return null; const top = sc.scrollTop + 10; let best = null; sc.querySelectorAll(".pp-pg").forEach((pg) => { if (pg.offsetTop <= top) best = pg; }); best = best || sc.querySelector(".pp-pg"); return best ? { p: +best.dataset.p, f: (top - best.offsetTop) / Math.max(1, best.offsetHeight) } : null; }
  function pdfRestore(pos) { const sc = S.pdfEl; const pg = sc && sc.querySelector('.pp-pg[data-p="' + pos.p + '"]'); if (pg) sc.scrollTop = pg.offsetTop + pos.f * pg.offsetHeight - 10; }
  function pdfGoto(p) { pdfRestore({ p: Math.max(1, Math.min(S.build.pages, p)), f: 0 }); }
  function zoom(k) { const sc = S.pdfEl; if (!sc) return; const pos = pdfPos(); const s = S.build.sizes[0]; let cur = pdfW(sc, s) / (s[0] * 96 / 72); if (k === "in") S.zoom = Math.min(4, Math.round((cur + 0.15) * 20) / 20); else if (k === "out") S.zoom = Math.max(0.3, Math.round((cur - 0.15) * 20) / 20); else S.zoom = k; setPref("zoom", S.zoom); pdfLayout(); if (pos) pdfRestore(pos); }
  async function pdfDbl(e) {
    const pg = e.target.closest(".pp-pg"); if (!pg || !S.build) return; const r = pg.getBoundingClientRect(), p = +pg.dataset.p, s = S.build.sizes[p - 1];
    const x = (e.clientX - r.left) / r.width * s[0], y = (e.clientY - r.top) / r.height * s[1];
    dot(pg, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    try { const res = await req("texsync", { dir: "back", p: p, x: x.toFixed(2), y: y.toFixed(2) }); if (res.at && res.at.file && S.data.files[res.at.file] != null) { if (S.vm === "pdf" && narrow()) { S.vm = "edit"; grid(); } openFile(res.at.file, res.at.line, true); } else toast("이 자리의 원고를 찾지 못했어요"); } catch (er) { toast("원고 자리를 찾지 못했어요"); }
  }
  function dot(pg, fx, fy) { const d = document.createElement("i"); d.className = "pp-dot"; d.style.left = fx * 100 + "%"; d.style.top = fy * 100 + "%"; pg.querySelector(".pp-ov").appendChild(d); setTimeout(() => d.remove(), 1200); }
  async function syncFwd(quiet) {
    if (!S.build || !S.cm) { if (!quiet) toast("먼저 컴파일하세요"); return; }
    flushDocs(); const c = S.cm.getCursor();
    try {
      const r = await req("texsync", { file: S.file, line: c.line + 1 }); if (!r.at) { if (!quiet) toast("PDF 에서 이 자리를 못 찾았어요(새로 쓴 곳이면 컴파일한 뒤에)"); return; }
      if (S.pv !== "pdf") { S.pv = "pdf"; paintPvBar(); paintPv(); } if (S.vm === "edit") { S.vm = narrow() ? "pdf" : "split"; grid(); }
      const sc = S.pdfEl; const pg = sc && sc.querySelector('.pp-pg[data-p="' + r.at.page + '"]'); if (!pg) return; const s = S.build.sizes[r.at.page - 1];
      sc.scrollTo({ top: pg.offsetTop + (r.at.y / s[1]) * pg.offsetHeight - sc.clientHeight * 0.3, behavior: "smooth" });
      const box = document.createElement("div"); box.className = "pp-sbox"; box.style.cssText = "left:" + (r.at.x / s[0] * 100) + "%;top:" + (r.at.y / s[1] * 100) + "%;width:" + (r.at.w / s[0] * 100) + "%;height:" + (r.at.h / s[1] * 100) + "%"; pg.querySelector(".pp-ov").appendChild(box); setTimeout(() => box.remove(), 2400);
    } catch (e) { if (!quiet) toast(e.message); }
  }
  async function pdfFind(q) {
    S.pq = q; S.hits = []; S.hitI = -1; const n = $("ppPqn"); if (!q || q.length < 2) { paintHits(); if (n) n.textContent = ""; return; }
    try { S.hits = ((await req("texsearch", { q: q })).hits || []).map((h) => ({ p: h[0], r: h[1] })); } catch (e) { S.hits = []; }
    paintHits(); if (S.hits.length) hitStep(1); else if (n) n.textContent = "없음";
  }
  function paintHits() { const sc = S.pdfEl; if (!sc) return; sc.querySelectorAll(".pp-fh").forEach((x) => x.remove()); S.hits.forEach((h, i) => { const pg = sc.querySelector('.pp-pg[data-p="' + h.p + '"]'); if (!pg || !h.r) return; const d = document.createElement("i"); d.className = "pp-fh" + (i === S.hitI ? " on" : ""); d.style.cssText = "left:" + h.r[0] * 100 + "%;top:" + h.r[1] * 100 + "%;width:" + (h.r[2] - h.r[0]) * 100 + "%;height:" + (h.r[3] - h.r[1]) * 100 + "%"; pg.querySelector(".pp-ov").appendChild(d); }); }
  function hitStep(d) { if (!S.hits.length) return; S.hitI = (S.hitI + d + S.hits.length) % S.hits.length; paintHits(); const h = S.hits[S.hitI]; const sc = S.pdfEl; const pg = sc.querySelector('.pp-pg[data-p="' + h.p + '"]'); if (pg) sc.scrollTo({ top: pg.offsetTop + (h.r ? h.r[1] * pg.offsetHeight : 0) - sc.clientHeight * 0.3, behavior: "smooth" }); const n = $("ppPqn"); if (n) n.textContent = (S.hitI + 1) + "/" + S.hits.length; }

  /* ================================================================== 📚 참고문헌 */
  function bibFile() { const l = Object.keys(S.data.files).filter((f) => /\.bib$/.test(f)); return l.find((f) => /refs?\.bib$|references\.bib$/.test(f)) || l[0] || null; }
  function paintBib() {
    const el = $("ppBib"); if (!el) return; const files = texts(); const bib = K.bibAll(files); const uses = K.citeUses(files); const q = (S.bibQ || "").toLowerCase();
    const l = bib.filter((b) => !q || (b.key + " " + (b.f.title || "") + " " + (b.f.author || "") + " " + (b.f.year || "")).toLowerCase().indexOf(q) >= 0);
    el.innerHTML = '<div class="pp-badd"><div class="pp-seg sm"><button type="button" data-ba="doi" class="' + ((S.bibAdd || "search") === "doi" ? "on" : "") + '">DOI</button><button type="button" data-ba="search" class="' + ((S.bibAdd || "search") === "search" ? "on" : "") + '">논문 검색</button><button type="button" data-ba="paste" class="' + (S.bibAdd === "paste" ? "on" : "") + '">BibTeX</button><button type="button" data-ba="proj" class="' + (S.bibAdd === "proj" ? "on" : "") + '">프로젝트</button></div><div id="ppBadd"></div></div>' +
      '<input type="search" class="pp-bq" id="ppBq" placeholder="키·제목·저자로 거르기 (' + bib.length + "건)\" value=\"" + esc(S.bibQ || "") + '">' +
      '<div class="pp-bl">' + (l.length ? l.map((b, i) => { const n = (uses[b.key] || []).length; return '<div class="pp-be"><div class="pp-be-h"><code>' + esc(b.key) + "</code>" + (n ? '<em class="u">인용 ' + n + "</em>" : '<em class="nu">안 씀</em>') + "</div><b>" + esc(b.f.title || "(제목 없음)") + "</b><small>" + esc(String(b.f.author || "").split(" and ").slice(0, 3).join(", ") + (String(b.f.author || "").split(" and ").length > 3 ? " 외" : "")) + (b.f.year ? " · " + esc(b.f.year) : "") + (b.f.journal || b.f.booktitle ? " · " + esc(b.f.journal || b.f.booktitle) : "") + '</small><div class="pp-be-a"><button type="button" data-bc="' + esc(b.key) + '">❝ 넣기</button><button type="button" data-bo="' + esc(b.file + "|" + b.line) + '">✎ 열기</button><button type="button" data-bd="' + i + '">✕</button></div></div>'; }).join("") : '<p class="sh-muted">' + (bib.length ? "맞는 항목이 없어요." : ".bib 파일에 항목이 없어요. 위에서 DOI·검색으로 넣어 보세요.") + "</p>") + "</div>";
    $("ppBq").addEventListener("input", (e) => { S.bibQ = e.target.value; clearTimeout(S._bq); S._bq = setTimeout(() => { paintBib(); const q2 = $("ppBq"); q2.focus(); q2.setSelectionRange(q2.value.length, q2.value.length); }, 200); });
    paintBibAdd();
    el.onclick = async (e) => {
      const t = e.target; let b;
      if ((b = t.closest("[data-ba]"))) { S.bibAdd = b.dataset.ba; paintBib(); return; }
      if ((b = t.closest("[data-bc]"))) { citeKey(b.dataset.bc); return; }
      if ((b = t.closest("[data-bo]"))) { const [f, ln] = b.dataset.bo.split("|"); openFile(f, +ln, true); return; }
      if ((b = t.closest("[data-bd]"))) { const it = l[+b.dataset.bd]; if (!confirm("'" + it.key + "' 항목을 지울까요?")) return; const s = S.data.files[it.file]; S.data.files[it.file] = s.slice(0, it.start) + s.slice(it.end).replace(/^\s*\n/, ""); setDocText(it.file, S.data.files[it.file]); persist(); runChecks(); paintBib(); return; }
      if ((b = t.closest("[data-bres]"))) { const w = S._bres[+b.dataset.bres]; addBib(toBib(w)); b.textContent = "✓ 넣음"; b.disabled = true; return; }
      if ((b = t.closest("[data-bpj]"))) { const k = b.dataset.bpj; const l2 = P("rnd.bib." + S.pid, []); (k === "all" ? l2 : [l2[+k]]).forEach((r) => addBib(toBib(r), true)); persist(); runChecks(); paintBib(); toast("참고문헌에 넣었어요"); return; }
      if ((b = t.closest("[data-bgo]"))) { bibGo(); return; }
    };
  }
  function paintBibAdd() {
    const el = $("ppBadd"); if (!el) return; const m = S.bibAdd || "search";
    if (m === "doi") el.innerHTML = '<div class="pp-brow"><input id="ppBi" placeholder="10.1038/nature14539 또는 https://doi.org/…"><button type="button" class="primary small-btn" data-bgo="1">넣기</button></div><small class="sh-muted">Crossref 에서 서지 정보를 받아 .bib 에 넣어요.</small>';
    if (m === "search") el.innerHTML = '<div class="pp-brow"><input id="ppBi" placeholder="제목·키워드 (영어가 잘 찾아져요)"><button type="button" class="primary small-btn" data-bgo="1">찾기</button></div><div id="ppBres"></div>';
    if (m === "paste") el.innerHTML = '<textarea id="ppBi" rows="4" placeholder="@article{key, title={…}, …} 를 붙여 넣으세요 (Google Scholar·출판사 BibTeX)"></textarea><button type="button" class="primary small-btn" data-bgo="1">넣기</button>';
    if (m === "proj") { const l = P("rnd.bib." + S.pid, []); el.innerHTML = l.length ? '<div class="pp-bres">' + l.slice(0, 50).map((r, i) => '<div class="pp-bri"><span><b>' + esc(r.title || "") + "</b><small>" + esc(r.authors || "") + " · " + esc(r.year || "") + '</small></span><button type="button" class="ghost-btn small-btn" data-bpj="' + i + '">＋</button></div>').join("") + '</div><button type="button" class="ghost-btn small-btn" data-bpj="all">모두 넣기(' + l.length + ")</button>" : '<p class="sh-muted">연구 프로젝트의 참고문헌 관리에 넣은 항목이 없어요.</p>'; }
    const i = $("ppBi"); if (i && i.tagName === "INPUT") i.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); bibGo(); } });
  }
  async function bibGo() {
    const m = S.bibAdd || "search", v = ($("ppBi") || {}).value || ""; if (!v.trim()) return;
    try {
      if (m === "doi") { const w = await crossref(v.trim()); addBib(toBib(w)); toast("넣었어요: " + (w.title || "").slice(0, 40)); paintBib(); }
      if (m === "search") { const box = $("ppBres"); box.innerHTML = '<p class="sh-muted"><span class="lb-dots"><i></i><i></i><i></i></span> 찾는 중…</p>'; const ws = await TK.BIB.search(v.trim()); S._bres = ws; box.innerHTML = ws.length ? '<div class="pp-bres">' + ws.map((w, i) => '<div class="pp-bri"><span><b>' + esc(w.title || "") + "</b><small>" + esc(w.authors || "") + " · " + esc(w.year || "") + (w.venue ? " · " + esc(w.venue) : "") + (w.cited ? " · 인용 " + w.cited : "") + '</small></span><button type="button" class="ghost-btn small-btn" data-bres="' + i + '">＋</button></div>').join("") + "</div>" : '<p class="sh-muted">찾지 못했어요.</p>'; }
      if (m === "paste") { const es = K.parseBib(v); if (!es.length) return toast("BibTeX 형식이 아니에요"); addBib(v.trim()); toast(es.length + "건 넣었어요"); paintBib(); }
    } catch (e) { toast(e.message); }
  }
  async function crossref(doi) {
    doi = doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, "").trim(); const r = await fetch("https://api.crossref.org/works/" + encodeURIComponent(doi)); if (!r.ok) throw new Error("DOI 를 찾지 못했어요(" + r.status + ")"); const m = (await r.json()).message || {};
    return { title: (m.title || [""])[0], authorList: (m.author || []).map((a) => [a.family || a.name || "", a.given || ""]), year: ((m.issued || {})["date-parts"] || [[""]])[0][0], venue: (m["container-title"] || [""])[0], doi: m.DOI, type: m.type, volume: m.volume, number: m.issue, pages: m.page, publisher: m.publisher, url: m.URL };
  }
  function toBib(w) {
    const al = w.authorList || String(w.authors || "").replace(/\s외$/, "").split(/,\s*/).filter(Boolean).map((n) => { const p = n.trim().split(/\s+/); return p.length > 1 ? [p.pop(), p.join(" ")] : [p[0], ""]; });
    const fam = (al[0] && al[0][0]) || "ref"; let k = (fam.toLowerCase().normalize("NFKD").replace(/[^a-z]/g, "") || "ref") + (w.year || "") + ((String(w.title || "").toLowerCase().match(/[a-z]{4,}/) || [""])[0]).slice(0, 8);
    const have = {}; K.bibAll(S.data.files).forEach((b) => { have[b.key] = 1; }); let kk = k, i = 2; while (have[kk]) kk = k + String.fromCharCode(96 + i++); k = kk;
    const type = /proceedings|conference/i.test(w.type || "") || /proceedings|conference|workshop|symposium|neurips|icml|iclr|cvpr|acl|naacl|emnlp/i.test(w.venue || "") ? "inproceedings" : /book$/.test(w.type || "") ? "book" : w.venue ? "article" : "misc";
    const f = [["title", "{" + (w.title || "") + "}"], ["author", al.map((a) => a[0] + (a[1] ? ", " + a[1] : "")).join(" and ")], [type === "inproceedings" ? "booktitle" : "journal", w.venue], ["year", w.year], ["volume", w.volume], ["number", w.number], ["pages", w.pages ? String(w.pages).replace(/-/, "--") : ""], ["publisher", type === "book" ? w.publisher : ""], ["doi", w.doi], ["url", !w.doi ? w.url : ""]].filter((x) => x[1]);
    return "@" + type + "{" + k + ",\n" + f.map((x) => "  " + x[0] + " ".repeat(Math.max(1, 10 - x[0].length)) + "= {" + String(x[1]).replace(/^\{|\}$/g, "") + "}").join(",\n") + "\n}";
  }
  function addBib(entry, quiet) {
    let bf = bibFile(); if (!bf) { bf = join(dirOf(S.data.main), "refs.bib"); S.data.files[bf] = ""; toast("refs.bib 를 만들었어요 — 본문에 " + BS + "bibliography{refs} 가 있어야 해요"); }
    const s = S.data.files[bf] || ""; S.data.files[bf] = s.replace(/\s*$/, "") + (s.trim() ? "\n\n" : "") + entry + "\n"; setDocText(bf, S.data.files[bf]);
    if (!quiet) { persist(); runChecks(); }
    const m = /@\w+\{([^,]+),/.exec(entry); return m ? m[1] : null;
  }
  function citeKey(k) {
    const cm = S.cm; if (!cm || modeOf(S.file) !== "stex") { toast("본문(.tex)을 열고 커서를 둔 뒤 누르세요"); return; }
    const c = cm.getCursor(), line = cm.getLine(c.line), before = line.slice(0, c.ch);
    if (/\\cite\w*\*?(?:\[[^\]]*\])*\{[^}]*$/.test(before)) cm.replaceRange((/[{,]\s*$/.test(before) ? "" : ",") + k, c); else cm.replaceRange(BS + "cite{" + k + "}", c);
    cm.focus(); toast("인용 넣음: " + k);
  }

  /* ================================================================== 💬 코멘트 */
  function addComment() {
    const cm = S.cm; if (!cm) return; const sel = cm.getSelection(), c = cm.getCursor("from");
    const t = prompt("코멘트 (" + baseOf(S.file) + " " + (c.line + 1) + "줄)" + (sel ? "\n고른 글: " + sel.slice(0, 80) : ""), ""); if (!t || !t.trim()) return;
    S.data.comments.push({ id: "c" + Date.now().toString(36), file: S.file, line: c.line + 1, quote: sel.slice(0, 300), text: t.trim(), t: Date.now(), done: false, by: (window.SERVER && SERVER.user && SERVER.user.name) || "" });
    persist(); paintMarks(); if (S.side === "cmts") paintCmts(); toast("코멘트를 달았어요");
  }
  function openCommentsAt(line) { S.side = "cmts"; S.sideOpen = true; grid(); paintSide(); setTimeout(() => { const el = document.querySelector('#ppCmts [data-cl="' + S.file + "|" + (line + 1) + '"]'); if (el) { el.scrollIntoView({ block: "center" }); el.classList.add("hl"); } }, 40); }
  function paintCmts() {
    const el = $("ppCmts"); if (!el) return; const show = S.cmtAll ? S.data.comments : S.data.comments.filter((c) => !c.done);
    el.innerHTML = '<div class="pp-seg sm"><button type="button" data-cf="open" class="' + (S.cmtAll ? "" : "on") + '">열림 ' + S.data.comments.filter((c) => !c.done).length + '</button><button type="button" data-cf="all" class="' + (S.cmtAll ? "on" : "") + '">전체 ' + S.data.comments.length + "</button></div>" +
      (show.length ? show.slice().sort((a, b) => (a.file + a.line).localeCompare(b.file + b.line)).map((c) => '<div class="pp-cm' + (c.done ? " done" : "") + '" data-cl="' + esc(c.file + "|" + c.line) + '"><div class="pp-cm-h"><a href="#" data-cgo="' + esc(c.id) + '">' + esc(baseOf(c.file)) + ":" + c.line + "</a><small>" + esc(c.by || "") + " " + fmtT(c.t) + "</small></div>" + (c.quote ? "<q>" + esc(c.quote.slice(0, 160)) + "</q>" : "") + "<p>" + esc(c.text) + '</p><div class="pp-cm-a"><button type="button" data-cai="' + esc(c.id) + '">✨ AI 로 반영</button><button type="button" data-cdone="' + esc(c.id) + '">' + (c.done ? "다시 열기" : "✓ 해결") + '</button><button type="button" data-cdel="' + esc(c.id) + '">✕</button></div></div>').join("") : '<p class="sh-muted">코멘트가 없어요. 글을 고른 뒤 💬 (또는 Ctrl+Alt+M) 로 달 수 있어요. 함께 쓰는 사람·나에게 남기는 할 일 메모로 써요.</p>');
    el.onclick = (e) => {
      const t = e.target; let b; const f = (id) => S.data.comments.find((x) => x.id === id);
      if ((b = t.closest("[data-cf]"))) { S.cmtAll = b.dataset.cf === "all"; paintCmts(); return; }
      if ((b = t.closest("[data-cgo]"))) { e.preventDefault(); const c = f(b.dataset.cgo); if (c) openFile(c.file, c.line, true); return; }
      if ((b = t.closest("[data-cdone]"))) { const c = f(b.dataset.cdone); c.done = !c.done; persist(); paintMarks(); paintCmts(); return; }
      if ((b = t.closest("[data-cdel]"))) { S.data.comments = S.data.comments.filter((x) => x.id !== b.dataset.cdel); persist(); paintMarks(); paintCmts(); return; }
      if ((b = t.closest("[data-cai]"))) { const c = f(b.dataset.cai); aiSend("이 코멘트를 원고에 반영해 고쳐 줘 — " + c.file + " " + c.line + "줄" + (c.quote ? " (해당 글: \"" + c.quote.slice(0, 200) + "\")" : "") + "\n코멘트: " + c.text, { cmt: c.id }); return; }
    };
  }

  /* ================================================================== 🕘 버전 */
  function vlist() { const v = P(vkey(), null); return (v && Array.isArray(v.list)) ? v.list : []; }
  function snapshot(label, auto) {
    if (!S.data) return; flushDocs(); const l = vlist(); const files = JSON.parse(JSON.stringify(S.data.files)); const sig = JSON.stringify(files);
    if (l.length && JSON.stringify(l[l.length - 1].files) === sig) { if (!auto) toast("바뀐 곳이 없어 새 버전을 만들지 않았어요"); return; }
    l.push({ id: "v" + Date.now().toString(36), t: Date.now(), label: label || "", auto: !!auto, main: S.data.main, folders: S.data.folders.slice(), files: files });
    while (l.length > 40) { const i = l.findIndex((x) => x.auto); l.splice(i >= 0 ? i : 0, 1); }
    while (JSON.stringify(l).length > 6e6 && l.length > 1) l.splice(Math.max(0, l.findIndex((x) => x.auto)), 1);
    PS(vkey(), { list: l }); if (S.side === "hist") paintHist(); if (!auto) toast("📌 버전을 저장했어요");
  }
  function autoSnap() { const l = vlist(); const last = l.length ? l[l.length - 1].t : 0; if (Date.now() - last > 15 * 60000) snapshot("컴파일 성공", true); }
  function paintHist() {
    const el = $("ppHist"); if (!el) return; const l = vlist().slice().reverse();
    el.innerHTML = '<div class="pp-hn"><button type="button" class="primary small-btn" data-pp="snap">📌 지금 버전 저장</button><small class="sh-muted">컴파일에 성공하면 15분마다, AI 가 고치기 전·지우기 전에도 저절로 남겨요.</small></div>' +
      (l.length ? '<div class="pp-tl">' + l.map((v) => { const n = Object.keys(v.files).length; return '<div class="pp-tv' + (v.auto ? " auto" : "") + '"><i></i><div><b>' + esc(v.label || (v.auto ? "자동 저장" : "버전")) + "</b><small>" + fmtT(v.t) + " · 글 파일 " + n + '</small><div class="pp-tv-a"><button type="button" data-vd="' + v.id + '">비교</button><button type="button" data-vr="' + v.id + '">되돌리기</button><button type="button" data-vx="' + v.id + '" title="이 버전을 폴더로 꺼내기(나란히 두고 보기)">📂 폴더로</button><button type="button" data-vl="' + v.id + '">✎</button><button type="button" data-vdel="' + v.id + '">✕</button></div></div></div>'; }).join("") + "</div>" : '<p class="sh-muted">아직 저장한 버전이 없어요.</p>');
    el.onclick = (e) => {
      const t = e.target; let b; const all = vlist(); const g = (id) => all.find((x) => x.id === id);
      if ((b = t.closest("[data-vd]"))) return diffDialog(g(b.dataset.vd));
      if ((b = t.closest("[data-vr]"))) { const v = g(b.dataset.vr); if (!confirm(fmtT(v.t) + " 버전으로 되돌릴까요? (지금 상태도 먼저 버전으로 남겨요)")) return; snapshot("되돌리기 전", true); restoreFiles(v); toast("되돌렸어요"); return; }
      if ((b = t.closest("[data-vx]"))) { const v = g(b.dataset.vx); let d = "versions/" + new Date(v.t).toISOString().slice(0, 16).replace(/[:T]/g, "-"); const nm = prompt("이 버전을 꺼낼 폴더", d); if (!nm) return; const dd = cleanPath(nm); if (!dd || exists(dd)) return toast("폴더 이름이 이상하거나 이미 있어요"); Object.keys(v.files).forEach((f) => { S.data.files[dd + "/" + f] = v.files[f]; }); S.data.folders.push(dd); S.openDirs[dd] = true; persist(); S.side = "files"; paintSide(); toast("꺼냈어요: " + dd + " (그림 파일은 원래 자리 것을 써요)"); return; }
      if ((b = t.closest("[data-vl]"))) { const v = g(b.dataset.vl); const n = prompt("이 버전 이름", v.label || ""); if (n == null) return; v.label = n; v.auto = false; PS(vkey(), { list: all }); paintHist(); return; }
      if ((b = t.closest("[data-vdel]"))) { if (!confirm("이 버전을 지울까요?")) return; PS(vkey(), { list: all.filter((x) => x.id !== b.dataset.vdel) }); paintHist(); return; }
    };
  }
  function restoreFiles(v) {
    const old = S.data.files; S.data.files = JSON.parse(JSON.stringify(v.files)); if (v.folders) S.data.folders = v.folders.slice(); if (v.main && S.data.files[v.main] != null) S.data.main = v.main;
    Object.keys(S.docs).forEach((p) => { if (S.data.files[p] == null) delete S.docs[p]; else if (S.data.files[p] !== old[p]) setDocText(p, S.data.files[p]); });
    if (!S.data.files[S.file]) S.file = S.data.main; persist(); openFile(S.file); paintSide(); runChecks();
  }
  function diffDialog(v) {
    flushDocs(); const cur = S.data.files; const names = Array.from(new Set(Object.keys(v.files).concat(Object.keys(cur)))).sort();
    const st = names.map((n) => { const d = K.diff(v.files[n] || "", cur[n] || ""); return { n: n, d: d, s: K.diffStat(d), gone: cur[n] == null, nu: v.files[n] == null }; }).filter((x) => x.s.add || x.s.del);
    modal("🕘 " + fmtT(v.t) + " ↔ 지금", st.length ? '<p class="sh-muted">왼쪽 번호 = 그 버전, 오른쪽 번호 = 지금. 초록 = 지금 더해진 줄, 빨강 = 지금 없어진 줄.</p>' + st.map((x) => '<details open class="pp-dfile"><summary>' + ICO(x.n) + " " + esc(x.n) + ' <em class="a">+' + x.s.add + '</em> <em class="d">−' + x.s.del + "</em>" + (x.gone ? " · 지금은 없음" : x.nu ? " · 새 파일" : "") + "</summary>" + K.diffHtml(x.d) + "</details>").join("") : '<p class="sh-muted">이 버전과 지금이 같아요.</p>', null, true);
  }

  /* ================================================================== Ω 기호 · ⚙ 설정 · 단어 수 */
  function paintSym() {
    const el = $("ppSym"); if (!el) return; const cats = Object.keys(K.SYMBOLS); const cat = S.symCat || cats[0];
    el.innerHTML = '<div class="pp-symt">' + cats.map((c) => '<button type="button" data-sc="' + esc(c) + '" class="' + (c === cat ? "on" : "") + '">' + esc(c) + "</button>").join("") + '</div><div class="pp-symg">' + K.SYMBOLS[cat].map((s, i) => '<button type="button" data-sy="' + i + '" title="' + esc(BS + s) + '"><span class="pp-syr" data-tex="' + esc(BS + s) + '">' + esc(BS + s) + "</span></button>").join("") + '</div><p class="sh-muted pp-tip">누르면 커서 자리에 넣어요. 수식 밖이면 $…$ 로 감싸서.</p>';
    loadKatex().then((ok) => { if (!ok) return; el.querySelectorAll(".pp-syr").forEach((x) => { try { x.innerHTML = katex.renderToString(x.dataset.tex.replace(/\\begin\{(\w+)\}/, "\\begin{$1}"), { throwOnError: false }); } catch (e) { /* 계속 */ } }); });
    el.onclick = (e) => { const c = e.target.closest("[data-sc]"); if (c) { S.symCat = c.dataset.sc; paintSym(); return; } const b = e.target.closest("[data-sy]"); if (!b || !S.cm) return; const s = BS + K.SYMBOLS[cat][+b.dataset.sy]; const cur = S.cm.getCursor(); const inMath = K.mathAt((i) => S.cm.getLine(i), S.cm.lineCount(), cur.line, cur.ch); S.cm.replaceSelection(inMath ? s + " " : "$" + s + "$"); S.cm.focus(); };
  }
  function paintSet() {
    const el = $("ppSet"); if (!el) return; const s = S.set;
    const ck = (k, t, d) => '<label class="pp-sw"><input type="checkbox" data-st="' + k + '"' + (s[k] ? " checked" : "") + "><span><b>" + t + "</b><small>" + d + "</small></span></label>";
    el.innerHTML = ck("auto", "자동 컴파일", "입력을 멈추면 2.6초 뒤 저절로 PDF 를 다시 만들어요") + ck("math", "수식 미리보기", "커서가 수식 안에 있으면 바로 아래에 그려 보여요") + ck("wrap", "줄 바꿈", "긴 줄을 화면 폭에 맞춰 접어 보여요") + ck("sublime", "Sublime 단축키", "Ctrl+D 같은 낱말 더 고르기·여러 커서·줄 옮기기") + ck("spell", "맞춤법 밑줄(브라우저)", "브라우저 맞춤법 검사를 켜요(영어 위주)") + ck("review", "AI 검토 모드", "AI 가 고친 것을 바로 넣지 않고 ‘적용’을 눌러야 넣어요") +
      '<label class="pp-sw"><span><b>글자 크기</b><small>' + s.font + 'px</small></span><input type="range" min="11" max="20" step="0.5" value="' + s.font + '" data-st="font"></label>' +
      '<div class="pp-eng"><b>컴파일 엔진</b><p>' + (S.engine ? esc(S.engine) + " · " + (S.allowed ? "이 계정으로 컴파일할 수 있어요" : "관리자 계정만 컴파일(엔진이 PC 파일을 읽을 수 있어서)") : "없음 — 바로 보기만") + "</p></div>" +
      '<div class="pp-keys"><b>단축키</b>' + [["Ctrl+Enter / Ctrl+S", "컴파일"], ["Ctrl+.", "커서 자리를 PDF 에서"], ["PDF 더블클릭", "그 자리 원고로"], ["Ctrl+Space", "자동 완성"], ["Ctrl+B / Ctrl+I", "굵게·기울임"], ["Ctrl+/", "주석 켜고 끄기"], ["Ctrl+F · Ctrl+H", "찾기 · 바꾸기"], ["Ctrl+Shift+F", "모든 파일에서 찾기"], ["Ctrl+D", "같은 낱말 더 고르기(Sublime)"], ["Alt+클릭", "여러 커서"], ["Ctrl+Alt+M", "코멘트"], ["그림 붙여넣기·끌어 놓기", "올리고 그림 넣기"]].map((k) => "<div><kbd>" + k[0] + "</kbd><span>" + k[1] + "</span></div>").join("") + "</div>";
    el.onchange = el.oninput = (e) => {
      const i = e.target.closest("[data-st]"); if (!i) return; const k = i.dataset.st; s[k] = i.type === "checkbox" ? i.checked : +i.value; setPref("set", s);
      if (!S.cm) return; if (k === "wrap") S.cm.setOption("lineWrapping", s.wrap); if (k === "sublime") S.cm.setOption("keyMap", s.sublime ? "sublime" : "default"); if (k === "spell") S.cm.setOption("spellcheck", s.spell); if (k === "font") { S.cm.getWrapperElement().style.fontSize = s.font + "px"; S.cm.refresh(); const sm = el.querySelector('[data-st="font"]').previousElementSibling.querySelector("small"); if (sm) sm.textContent = s.font + "px"; } if (k === "math" && !s.math) mathHide(); stat();
    };
  }
  function wordsDialog() {
    const w = K.words(texts(), S.data.main);
    modal("단어 수", '<div class="pp-wc"><div><b>' + w.words.toLocaleString() + "</b><span>단어(어절)</span></div><div><b>" + w.chars.toLocaleString() + "</b><span>글자(공백 뺌)</span></div><div><b>" + w.figures + "</b><span>그림</span></div><div><b>" + w.tables + "</b><span>표</span></div><div><b>" + w.equations + "</b><span>식</span></div><div><b>" + w.cites + "</b><span>인용</span></div><div><b>" + w.minutes + "분</b><span>읽는 시간</span></div></div>" +
      '<table class="sv-tbl"><thead><tr><th>절</th><th>단어</th><th></th></tr></thead><tbody>' + w.sections.map((s) => { const mx = Math.max.apply(null, w.sections.map((x) => x.words).concat([1])); return '<tr><td style="padding-left:' + (s.lv * 12 + 8) + 'px">' + esc(s.title) + "</td><td>" + s.words.toLocaleString() + '</td><td><span class="pp-wbar" style="width:' + Math.round(s.words / mx * 100) + '%"></span></td></tr>'; }).join("") + "</tbody></table><p class=\"sh-muted\">본문(\\begin{document} 뒤)만 셉니다. 수식·명령·주석은 빼요.</p>");
  }

  /* ================================================================== 표·그림 만들기 */
  function tableDialog() {
    let R = 3, C = 3; const cells = []; const al = ["l", "c", "c", "c", "c", "c", "c", "c"];
    const draw = (m) => {
      const g = m.el.querySelector(".pp-tg"); g.style.gridTemplateColumns = "repeat(" + C + ", minmax(70px,1fr))";
      g.innerHTML = Array.from({ length: R * C }, (_, i) => '<input data-c="' + i + '" value="' + esc(cells[i] || "") + '" placeholder="' + (i < C ? "제목 " + (i + 1) : "") + '">').join("");
      m.el.querySelector(".pp-tal").innerHTML = Array.from({ length: C }, (_, j) => '<select data-al="' + j + '">' + ["l", "c", "r"].map((a) => '<option value="' + a + '"' + (al[j] === a ? " selected" : "") + ">" + { l: "왼쪽", c: "가운데", r: "오른쪽" }[a] + "</option>").join("") + "</select>").join("");
    };
    const m = modal("▦ 표 만들기", '<div class="pp-trc"><label>행 <input type="number" min="1" max="40" value="3" data-rc="r"></label><label>열 <input type="number" min="1" max="8" value="3" data-rc="c"></label><label><input type="checkbox" checked data-o="book"> booktabs 줄</label><label><input type="checkbox" checked data-o="head"> 첫 줄 굵게</label></div><div class="pp-tal"></div><div class="pp-tg"></div>' +
      '<details><summary>엑셀·CSV 붙여넣기로 채우기</summary><textarea rows="4" data-o="paste" placeholder="엑셀에서 복사한 칸을 여기에 붙여 넣으세요(탭·쉼표 구분)"></textarea></details><div class="pp-trc"><label>캡션 <input data-o="cap" value="표 설명"></label><label>이름표 <input data-o="lab" value="tab:"></label></div><div class="lb-row"><button type="button" class="primary small-btn" data-mod="ins">넣기</button></div>', (k, mm) => {
      if (k !== "ins") return; const book = mm.el.querySelector('[data-o="book"]').checked, head = mm.el.querySelector('[data-o="head"]').checked;
      const rows = []; for (let r = 0; r < R; r++) { const row = []; for (let c = 0; c < C; c++) { let v = (cells[r * C + c] || "").replace(/([&%#_])/g, "\\$1"); if (head && r === 0 && v) v = BS + "textbf{" + v + "}"; row.push(v); } rows.push("    " + row.join(" & ") + " " + BS + BS); }
      const top = book ? BS + "toprule" : BS + "hline", mid = book ? BS + "midrule" : BS + "hline", bot = book ? BS + "bottomrule" : BS + "hline";
      const code = BS + "begin{table}[t]\n  " + BS + "centering\n  " + BS + "caption{" + mm.el.querySelector('[data-o="cap"]').value + "}\n  " + BS + "label{" + mm.el.querySelector('[data-o="lab"]').value + "}\n  " + BS + "begin{tabular}{" + al.slice(0, C).join("") + "}\n    " + top + "\n" + rows[0] + "\n    " + mid + "\n" + rows.slice(1).join("\n") + (rows.length > 1 ? "\n" : "") + "    " + bot + "\n  " + BS + "end{tabular}\n" + BS + "end{table}\n";
      if (book) ensurePkg("booktabs"); mm.close(); insertSnip(code + "¦");
    });
    m.el.addEventListener("input", (e) => {
      const t = e.target;
      if (t.dataset.c != null) cells[+t.dataset.c] = t.value;
      if (t.dataset.rc) { const old = cells.slice(), oC = C; if (t.dataset.rc === "r") R = Math.max(1, Math.min(40, +t.value || 1)); else C = Math.max(1, Math.min(8, +t.value || 1)); cells.length = 0; for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) cells[r * C + c] = c < oC ? old[r * oC + c] || "" : ""; draw(m); }
      if (t.dataset.o === "paste") { const rows = t.value.trim().split(/\r?\n/).map((l) => l.split(l.indexOf("\t") >= 0 ? "\t" : ",")); if (!rows.length) return; R = Math.min(40, rows.length); C = Math.min(8, Math.max.apply(null, rows.map((r) => r.length))); cells.length = 0; for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) cells[r * C + c] = (rows[r][c] || "").trim(); m.el.querySelector('[data-rc="r"]').value = R; m.el.querySelector('[data-rc="c"]').value = C; draw(m); }
    });
    m.el.addEventListener("change", (e) => { if (e.target.dataset.al != null) al[+e.target.dataset.al] = e.target.value; });
    draw(m);
  }
  function figureDialog(pre) {
    const imgs = S.assets.filter((a) => /\.(png|jpe?g|pdf|eps|gif)$/i.test(a.name)); let pick = pre || (imgs[0] && imgs[0].name) || "example-image-a";
    const base = dirOf(S.data.main); const rel = (n) => (base && n.indexOf(base + "/") === 0 ? n.slice(base.length + 1) : n);
    const m = modal("🖼 그림 넣기", '<div class="pp-fgrid">' + imgs.map((a) => '<button type="button" class="pp-fimg' + (a.name === pick ? " on" : "") + '" data-fi="' + esc(a.name) + '"><img loading="lazy" src="' + esc(/\.pdf$/i.test(a.name) ? url("texasset", { name: a.name, png: 1, w: 300 }) : /\.eps$/i.test(a.name) ? "" : url("texasset", { name: a.name, img: 1 })) + '" alt=""><small>' + esc(a.name) + "</small></button>").join("") + '<button type="button" class="pp-fimg up" data-fi-up="1"><span>⬆</span><small>그림 올리기</small></button><button type="button" class="pp-fimg' + (pick === "example-image-a" ? " on" : "") + '" data-fi="example-image-a"><span>▧</span><small>예시 그림</small></button></div>' +
      '<div class="pp-trc"><label>폭 <input type="range" min="0.2" max="1" step="0.05" value="0.8" data-o="w"> <b data-o="wv">0.8</b>×줄 폭</label><label>위치 <select data-o="pos"><option value="t">쪽 위 [t]</option><option value="h">여기 [h]</option><option value="htbp">알아서 [htbp]</option><option value="H">꼭 여기 [H]</option></select></label></div><div class="pp-trc"><label>캡션 <input data-o="cap" value="그림 설명"></label><label>이름표 <input data-o="lab" value="fig:"></label></div><div class="lb-row"><button type="button" class="primary small-btn" data-mod="ins">넣기</button><input type="file" accept="image/*,.pdf,.eps" data-o="file" hidden></div>', (k, mm) => {
      if (k !== "ins") return; const w = mm.el.querySelector('[data-o="w"]').value, pos = mm.el.querySelector('[data-o="pos"]').value; if (pos === "H") ensurePkg("float");
      mm.close(); insertSnip(BS + "begin{figure}[" + pos + "]\n  " + BS + "centering\n  " + BS + "includegraphics[width=" + w + BS + "linewidth]{" + rel(pick) + "}\n  " + BS + "caption{" + mm.el.querySelector('[data-o="cap"]').value + "}\n  " + BS + "label{" + mm.el.querySelector('[data-o="lab"]').value + "}\n" + BS + "end{figure}\n¦"); ensurePkg("graphicx");
    });
    const lab = m.el.querySelector('[data-o="lab"]'); const setLab = () => { lab.value = "fig:" + baseOf(pick).replace(/\.[^.]+$/, "").replace(/[^\w-]+/g, "-").toLowerCase(); }; setLab();
    m.el.addEventListener("click", async (e) => { const b = e.target.closest("[data-fi]"); if (b) { pick = b.dataset.fi; m.el.querySelectorAll(".pp-fimg").forEach((x) => x.classList.toggle("on", x === b)); setLab(); } if (e.target.closest("[data-fi-up]")) m.el.querySelector('[data-o="file"]').click(); });
    m.el.querySelector('[data-o="file"]').addEventListener("change", async (e) => { const f = e.target.files[0]; if (!f) return; await uploadFiles([f], "figures"); m.close(); figureDialog("figures/" + f.name); });
    m.el.addEventListener("input", (e) => { if (e.target.dataset.o === "w") m.el.querySelector('[data-o="wv"]').textContent = e.target.value; });
  }
  function ensurePkg(name) {
    const f = S.data.main; const t = (S.docs[f] ? S.docs[f].getValue() : S.data.files[f]) || ""; if (new RegExp("\\\\usepackage(\\[[^\\]]*\\])?\\{[^}]*\\b" + name + "\\b").test(t)) return;
    const i = t.indexOf("\\begin{document}"); if (i < 0) return; const lines = t.slice(0, i).split("\n"); let at = -1; lines.forEach((l, k) => { if (/\\usepackage/.test(l)) at = k; });
    const ins = BS + "usepackage{" + name + "}"; const d = docFor(f); d.replaceRange(ins + "\n", { line: at >= 0 ? at + 1 : lines.length - 1, ch: 0 }); toast(BS + "usepackage{" + name + "} 를 본문 앞부분에 넣었어요");
  }
  async function onDropCm(cm, e) {
    const fl = e.dataTransfer && e.dataTransfer.files; if (!fl || !fl.length) return; e.preventDefault();
    const imgs = Array.from(fl).filter((f) => /\.(png|jpe?g|gif|pdf|eps)$/i.test(f.name)); const pos = cm.coordsChar({ left: e.clientX, top: e.clientY });
    await uploadFiles(fl, imgs.length ? "figures" : dirOf(S.file));
    if (imgs.length && modeOf(S.file) === "stex") { cm.setCursor(pos); imgs.forEach((f) => insertSnip(BS + "begin{figure}[t]\n  " + BS + "centering\n  " + BS + "includegraphics[width=0.8" + BS + "linewidth]{figures/" + f.name + "}\n  " + BS + "caption{¦}\n  " + BS + "label{fig:" + f.name.replace(/\.[^.]+$/, "").replace(/[^\w-]+/g, "-").toLowerCase() + "}\n" + BS + "end{figure}\n")); }
  }
  async function onPasteCm(cm, e) {
    const it = Array.from((e.clipboardData && e.clipboardData.items) || []).find((x) => x.type && x.type.indexOf("image/") === 0); if (!it) return; e.preventDefault();
    const blob = it.getAsFile(); const name = "paste-" + new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "") + ".png"; const f = new File([blob], name, { type: blob.type });
    await uploadFiles([f], "figures"); if (modeOf(S.file) === "stex") insertSnip(BS + "begin{figure}[t]\n  " + BS + "centering\n  " + BS + "includegraphics[width=0.8" + BS + "linewidth]{figures/" + name + "}\n  " + BS + "caption{¦}\n  " + BS + "label{fig:" + name.replace(/\.png$/, "") + "}\n" + BS + "end{figure}\n");
  }

  /* ================================================================== 창(모달)·내려받기·갤러리 */
  function modal(title, html, onAct, wide) {
    const el = document.createElement("div"); el.className = "pp-modal"; el.innerHTML = '<div class="pp-mbox' + (wide ? " wide" : "") + '" role="dialog" aria-label="' + esc(title) + '"><div class="pp-mh"><b>' + esc(title) + '</b><button type="button" class="pp-ib" data-mod="x" aria-label="닫기">✕</button></div><div class="pp-mb">' + html + "</div></div>";
    document.body.appendChild(el); const m = { el: el, close: () => { el.remove(); document.removeEventListener("keydown", esc2); } };
    const esc2 = (e) => { if (e.key === "Escape") m.close(); }; document.addEventListener("keydown", esc2);
    el.addEventListener("click", (e) => { if (e.target === el) return m.close(); const b = e.target.closest("[data-mod]"); if (!b) return; if (b.dataset.mod === "x") return m.close(); if (onAct) onAct(b.dataset.mod, m, b); });
    return m;
  }
  function galleryModal() {
    const m = modal("✦ 샘플 갤러리", '<p class="sh-muted">샘플을 고르면 <b>새 폴더로 추가</b>(지금 원고는 그대로)하거나 <b>전체를 바꿀</b> 수 있어요.</p><div id="ppGalM"></div>', null, true);
    gallery(m.el.querySelector("#ppGalM"), (t) => {
      const how = prompt("“" + t.name + "” 를 어떻게 넣을까요?\n1 = 새 폴더로 추가 (추천)\n2 = 지금 원고를 이 샘플로 바꾸기(먼저 버전으로 남김)", "1"); if (!how) return;
      if (how.trim() === "2") { snapshot("샘플로 바꾸기 전", true); S.data.files = JSON.parse(JSON.stringify(t.files)); S.data.main = t.main; S.data.folders = []; S.docs = {}; S.data.open = []; persist(); m.close(); openFile(S.data.main); paintSide(); runChecks(); if (S.set.auto) compile("tpl"); return; }
      let d = t.id, i = 2; while (exists(d)) d = t.id + "-" + i++; Object.keys(t.files).forEach((f) => { S.data.files[d + "/" + f] = t.files[f]; }); S.openDirs[d] = true; persist(); m.close(); S.side = "files"; S.sideOpen = true; paintSide(); runChecks();
      if (confirm("'" + d + "/" + t.main + "' 를 ★ 본문으로 지정해서 바로 컴파일해 볼까요?")) { setMain(d + "/" + t.main); openFile(d + "/" + t.main); }
    });
  }
  function dlMenu(x, y) {
    popMenu([["🏛 연구행정에 산출물 등록", () => { if (window.PINFO) PINFO.registerOutput({ pid: S.pid, type: "논문", title: ((/\\title\s*\{([^}]*)\}/.exec(S.data.files[S.data.main] || "") || [])[1] || projName()).trim(), docId: "paper", tab: "paper" }); }], "-", ["⬇ PDF 내려받기", () => { if (!S.build) return toast("먼저 컴파일하세요"); const a = document.createElement("a"); a.href = url("texpdf", { name: baseOf(S.data.main).replace(/\.tex$/, "") + ".pdf" }); a.download = baseOf(S.data.main).replace(/\.tex$/, "") + ".pdf"; document.body.appendChild(a); a.click(); a.remove(); }],
      ["↗ PDF 새 탭에서", () => { if (!S.build) return toast("먼저 컴파일하세요"); window.open(url("texpdf", { name: "paper.pdf" }), "_blank", "noopener"); }],
      ["📦 전체 zip (원고+그림+PDF)", async () => { try { const r = await req("texzip", {}, { files: texts(), name: "paper-" + projName().replace(/\s+/g, "_") }); const a = document.createElement("a"); a.href = RND.ws.url("out", { pid: S.pid, name: r.name }); a.download = r.name; document.body.appendChild(a); a.click(); a.remove(); toast("zip 을 만들었어요(" + kb(r.size) + ") — 프로젝트 내보낸 파일에도 있어요"); } catch (e) { toast(e.message); } }],
      ["📤 PDF 를 프로젝트 결과물로", async () => { try { const r = await req("texexport", {}, { name: "paper-" + baseOf(S.data.main).replace(/\.tex$/, "") }); toast("프로젝트 내보낸 파일에 넣었어요: " + r.name); } catch (e) { toast(e.message); } }],
      ["🌐 바로 보기 HTML 내려받기", () => { const r = K.render(texts(), S.data.main, {}); TK.download("paper.html", '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css"><style>body{max-width:760px;margin:40px auto;font:16px/1.75 serif;padding:0 20px}.pp-eq{display:flex;justify-content:center;gap:16px}.pp-tab table{margin:auto;border-collapse:collapse;border-top:2px solid;border-bottom:2px solid}.pp-tab td,.pp-tab th{padding:4px 12px}</style>' + r.html, "text/html"); }],
      "-", ["📦 zip 가져오기(Overleaf 등)", () => { S.zipDir = ""; $("ppZip").click(); }], ["✦ 샘플 갤러리", () => galleryModal()]], x, y);
  }

  /* ================================================================== AI 작성 보조(인라인) */
  async function inlineAI(kind) {
    const cm = S.cm; if (!cm) return; const from = cm.getCursor("from"), to = cm.getCursor("to"), src = cm.getSelection(); if (!src.trim()) return;
    let ins = "";
    if (kind === "ask") { ins = prompt("고른 부분을 어떻게 고칠까요? (예: 더 설득력 있게, 표로 바꿔 줘, 수식으로)", ""); if (!ins) return; }
    const T = { pol: "학술 논문 문체로 다듬으세요(뜻·수식·인용·명령은 그대로, 같은 언어).", short: "뜻을 지키며 더 간결하게 줄이세요.", en: "학술 영어로 옮기세요(LaTeX 명령·수식·인용 키는 그대로).", ko: "자연스러운 한국어 학술 문체로 옮기세요(LaTeX 명령·수식·인용 키는 그대로).", ask: "다음 지시대로 고치세요: " + ins };
    const g = await gateAction({ action: "tools", cost: 1 }); if (!g.ok) return toast(gateMessage(g), 5000);
    const box = document.createElement("div"); box.className = "pp-inline"; box.innerHTML = '<div class="pp-in-h"><b>✨ ' + esc({ pol: "다듬기", short: "줄이기", en: "영어로", ko: "한국어로", ask: "지시: " + ins }[kind]) + '</b><span class="lb-dots"><i></i><i></i><i></i></span></div><div class="pp-in-b"></div><div class="pp-in-a"></div>';
    const w = cm.addLineWidget(to.line, box, { coverGutter: false, noHScroll: true, above: false });
    let out = "";
    try {
      out = await llmStreamChat([{ role: "system", content: "당신은 LaTeX 원고 편집기입니다. 고친 LaTeX 만 출력하세요(설명·코드펜스 없이). 수치·인용을 지어내지 마세요." }, { role: "user", content: T[kind] + "\n\n" + src }], (d, full) => { box.querySelector(".pp-in-b").textContent = full; }, { temperature: 0.3, maxTokens: 3000 });
    } catch (e) { box.querySelector(".pp-in-b").textContent = "⚠ " + e.message; }
    out = String(out || "").replace(/^```\w*\n?|```\s*$/g, "").trim();
    const dots = box.querySelector(".lb-dots"); if (dots) dots.remove();
    box.querySelector(".pp-in-b").innerHTML = wordDiff(src, out);
    box.querySelector(".pp-in-a").innerHTML = '<button type="button" class="primary small-btn" data-in="ok">바꾸기</button><button type="button" class="ghost-btn small-btn" data-in="ins">아래에 넣기</button><button type="button" class="ghost-btn small-btn" data-in="no">취소</button>';
    box.onclick = (e) => { const b = e.target.closest("[data-in]"); if (!b) return; if (b.dataset.in === "ok") cm.replaceRange(out, from, to, "+ai"); if (b.dataset.in === "ins") cm.replaceRange("\n" + out, to, to, "+ai"); w.clear(); cm.focus(); };
  }
  function wordDiff(a, b) {
    const ta = a.split(/(\s+)/), tb = b.split(/(\s+)/); if (ta.length * tb.length > 1.2e6) return esc(b);
    const d = K.diff(ta.join("\n"), tb.join("\n")); return d.map((x) => (x[0] === "=" ? esc(x[1]) : x[0] === "+" ? "<ins>" + esc(x[1]) + "</ins>" : "<del>" + esc(x[1]) + "</del>")).join("");
  }

  /* ================================================================== ✨ AI 작성 보조 대화(파일을 직접 고친다) */
  const AI_SYS = [
    "당신은 이 사용자의 LaTeX 논문 공동 저자이자 작업 공간 관리자입니다. 여러 파일·폴더로 된 원고를 직접 읽고 고칠 수 있습니다.",
    "답은 반드시 아래 형식으로만 씁니다(태그 밖에 다른 말 금지):",
    "<reply>사용자에게 할 말 — 한국어, 짧게. 무엇을 왜 바꿨는지, 남은 일</reply>",
    "그리고 필요한 만큼 작업 태그:",
    "<write path=\"sections/intro.tex\">파일 전체 내용</write>   ← 새 파일 만들기 또는 작은 파일 전체 바꾸기",
    "<edit path=\"main.tex\"><find>파일에 있는 그대로의 원래 글(딱 한 번 나오도록 충분히 길게)</find><replace>새 글</replace></edit>   ← 일부 고치기(find/replace 쌍 여러 개 가능)",
    "<insert path=\"main.tex\" after=\"파일에 그대로 있는 기준 글\">넣을 글</insert>   ← after 가 없으면 \\end{document} 앞(없으면 파일 끝)에",
    "<mkdir path=\"figures\"/>  <move from=\"a.tex\" to=\"sections/a.tex\"/>  <delete path=\"old.tex\"/>  <main path=\"v2/main.tex\"/>  <open path=\"main.tex\" line=\"10\"/>",
    "<read path=\"...\"/>  ← 내용을 봐야 할 파일(다음 차례에 받음)   <compile/>  ← 컴파일해서 오류를 확인(다음 차례에 결과)",
    "<search_materials query=\"...\"/>  ← 연구 프로젝트 자료(PDF 등)에서 근거 찾기   <search_papers query=\"영어 키워드\"/>  ← 논문 검색(서지 정보)",
    "규칙:",
    "- 큰 파일은 전체를 다시 쓰지 말고 edit 를 쓰세요. find 는 줄바꿈·공백까지 파일과 똑같이.",
    "- 수치·실험 결과·인용·참고문헌을 지어내지 마세요. 모르는 값은 [TODO: …] 로 표시. 자료 근거가 필요하면 search_materials, 논문이 필요하면 search_papers 를 먼저.",
    "- \\cite 키는 .bib 에 있는 것만 쓰고, 새 논문은 .bib 에 항목도 함께 넣으세요(서지 정보는 검색 결과 그대로).",
    "- 한국어 문서는 kotex 를 씁니다. 기존 \\label·\\ref 이름 체계와 문체를 지키세요.",
    "- 폴더 정리는 move 로 하고 \\input·\\includegraphics 경로는 자동으로 고쳐집니다. 그림·자료 파일(바이너리)은 move 만 가능.",
    "- 오류를 고칠 때는 고친 뒤 <compile/> 로 확인하세요. 같은 차례에 read·compile 결과가 필요하면 그 태그만 내고 기다리세요.",
    "- 사용자가 검토·질문만 원하면 작업 태그 없이 <reply> 만 쓰세요.",
  ].join("\n");
  const QUICK = [["초록 써 줘", "본문을 읽고 초록(abstract)을 써서 넣어 줘. 수치는 본문에 있는 것만."], ["이 절 다듬어 줘", "지금 커서가 있는 절을 학술 문체로 다듬어 줘(뜻·수식·인용은 그대로)."], ["오류 고쳐 줘", "컴파일해서 오류·경고를 확인하고 모두 고쳐 줘. 고친 뒤 다시 컴파일해서 확인해."], ["관련 연구(자료 근거)", "프로젝트 자료에서 근거를 찾아 '관련 연구' 절을 써 줘. 자료에 있는 논문만 인용하고 .bib 도 채워."], ["폴더 정리", "파일들을 sections/·figures/·chapters/ 같은 폴더로 깔끔하게 정리하고, 본문 \\input 경로가 맞는지 확인해."], ["심사위원처럼 검토", "학회 심사위원처럼 이 원고를 검토해 줘(요약·강점·약점(근거 줄)·필수 수정·질문·판정). 고치지는 말고 의견만."], ["제목 후보", "이 논문의 제목 후보 5개를 한국어·영어로 제안해 줘(고치지 말고)."], ["영어로 옮기기", "지금 열린 파일을 학술 영어로 옮겨 줘(명령·수식·인용 키는 그대로)."], ["표·그림 캡션", "모든 표·그림 캡션을 무엇을 보여 주는지 분명하게 다듬어 줘."], ["다음 할 일", "원고를 훑고 남은 [TODO]·빈 곳·약한 부분을 할 일 목록으로 정리해 줘(고치지 말고)."]];
  function paintAi() {
    const el = $("ppAi"); if (!el) return;
    el.innerHTML = '<div class="pp-aih"><b>✨ 작성 보조 AI</b><span class="pp-aim">' + (S.set.review ? "검토 모드" : "바로 고침 · 되돌리기 가능") + '</span><button type="button" class="pp-ib" data-pp="aiclear" title="대화 지우기">🧹</button><button type="button" class="pp-ib" data-pp="ai" title="닫기">✕</button></div>' +
      '<div class="pp-ail" id="ppAiL"></div>' +
      '<div class="pp-aiq"><div class="pp-aichips">' + QUICK.map((q, i) => '<button type="button" data-aq="' + i + '">' + esc(q[0]) + "</button>").join("") + '</div><div class="pp-aictx" id="ppAiCtx"></div><div class="pp-aiin"><textarea id="ppAiQ" rows="2" placeholder="무엇을 할까요? 예) 3장 실험 결과를 표 2개로 정리해 줘 · sections 폴더로 나눠 줘 · 오류 고쳐 줘 (Enter 보내기, Shift+Enter 줄바꿈)"></textarea><button type="button" class="primary" data-pp="aisend" aria-label="보내기">↑</button></div></div>';
    paintMsgs();
    const ta = $("ppAiQ"); ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); const v = ta.value.trim(); if (v) { ta.value = ""; aiSend(v); } } });
    ta.addEventListener("focus", aiCtx);
    aiCtx();
  }
  function aiCtx() { const el = $("ppAiCtx"); if (!el || !S.cm) return; const sel = S.cm.getSelection(); const ne = allProbs().filter((p) => p.kind === "error").length; el.innerHTML = '<span title="AI 가 보는 파일">👁 ' + esc(S.file || "") + " " + (S.cm.getCursor().line + 1) + "줄</span>" + (sel ? "<span>✂ 고른 글 " + sel.length + "자</span>" : "") + (ne ? '<span class="e">✕ 오류 ' + ne + "</span>" : "") + "<span>📁 파일 " + (Object.keys(S.data.files).length + S.assets.length) + "</span>"; }
  function paintMsgs() {
    const el = $("ppAiL"); if (!el) return;
    if (!S.msgs.length) { el.innerHTML = '<div class="pp-aiempty"><span>✨</span><b>말로 원고를 써 나가세요</b><p>AI 가 파일을 직접 고치고(새 파일·폴더 정리 포함), 필요하면 컴파일해서 오류까지 잡아요. 차례마다 <b>↩ 되돌리기</b>가 있고, 바꾼 곳은 ＋/− 로 보여 줘요.</p><p class="sh-muted">원고 글을 고르고 물어보면 그 부분만 고쳐요. 연구 프로젝트 자료(PDF)에서 근거를 찾아 쓰고, 논문을 검색해 참고문헌도 넣어요.</p></div>'; return; }
    el.innerHTML = S.msgs.map((m, i) => msgHtml(m, i)).join(""); el.scrollTop = el.scrollHeight;
  }
  function msgHtml(m, i) {
    if (m.role === "user") return '<div class="pp-m u"><div>' + esc(m.text) + (m.sel ? '<q>' + esc(m.sel.slice(0, 160)) + (m.sel.length > 160 ? "…" : "") + "</q>" : "") + "</div></div>";
    if (m.role === "sys") return '<div class="pp-m s">' + esc(m.text) + "</div>";
    const ch = (m.changes || []).map((c, j) => '<div class="pp-chg k-' + c.kind + '"><i>' + ({ new: "＋", write: "✎", edit: "✎", insert: "↳", mkdir: "📁", move: "→", delete: "🗑", main: "★" }[c.kind] || "•") + "</i><span>" + esc(chgLabel(c)) + "</span>" + (c.add || c.del ? '<em class="a">+' + (c.add || 0) + '</em><em class="d">−' + (c.del || 0) + "</em>" : "") + (c.before != null || c.after != null ? '<button type="button" data-cv="' + i + "|" + j + '">보기</button>' : "") + (c.path && S.data.files[c.path] != null ? '<button type="button" data-copen="' + esc(c.path) + '">열기</button>' : "") + "</div>").join("");
    const st = (m.steps || []).map((s) => '<div class="pp-step">' + esc(s) + "</div>").join("");
    const pend = m.pending && m.pending.length ? '<div class="pp-pend"><b>검토 대기 ' + m.pending.length + '건</b>' + m.pending.map((o) => "<div>" + esc(opLabel(o)) + "</div>").join("") + '<div class="lb-row"><button type="button" class="primary small-btn" data-capply="' + i + '">모두 적용</button><button type="button" class="ghost-btn small-btn" data-cdrop="' + i + '">버리기</button></div></div>' : "";
    const foot = !m.busy && m.turn && S.turns[m.turn] && (m.changes || []).length ? '<div class="pp-mfoot"><button type="button" data-cundo="' + esc(m.turn) + '">↩ 이 차례 되돌리기</button><button type="button" data-pp="compile">▶ 컴파일</button></div>' : "";
    return '<div class="pp-m a"><div class="pp-mb2">' + (m.busy && !m.text ? '<span class="lb-dots"><i></i><i></i><i></i></span> ' + esc(m.busyText || "생각하는 중…") : (window.TK && TK.md ? TK.md(m.text || "") : esc(m.text || ""))) + (m.busy && m.text ? ' <span class="lb-dots"><i></i><i></i><i></i></span>' : "") + "</div>" + st + (ch ? '<div class="pp-chgs">' + ch + "</div>" : "") + pend + foot + "</div>";
  }
  function chgLabel(c) { return c.kind === "new" ? c.path + " 새로 만듦" : c.kind === "move" ? c.path + " → " + c.to : c.kind === "mkdir" ? c.path + " 폴더" : c.kind === "delete" ? c.path + " 지움" : c.kind === "main" ? "본문: " + c.path : c.path + (c.kind === "insert" ? " 에 넣음" : " 고침"); }
  function opLabel(o) { return ({ write: "✎ 쓰기 ", edit: "✎ 고치기 ", insert: "↳ 넣기 ", mkdir: "📁 폴더 ", move: "→ 옮기기 ", delete: "🗑 지우기 ", main: "★ 본문 " }[o.op] || o.op + " ") + (o.path || o.from || "") + (o.to ? " → " + o.to : ""); }
  function paintMsg() { clearTimeout(paintMsg.t); paintMsg.t = setTimeout(paintMsgs, 60); }
  function wsSummary(userText, selText) {
    flushDocs(); const F = S.data.files; const lines = [];
    lines.push("[작업 공간] 본문(★ 컴파일): " + S.data.main + " · 엔진: " + (S.engine || "없음"));
    lines.push("글 파일: " + Object.keys(F).sort().map((f) => f + " (" + kb(F[f].length) + ")").join(", "));
    if (S.assets.length) lines.push("그림·자료 파일: " + S.assets.map((a) => a.name).slice(0, 80).join(", "));
    const empty = S.data.folders.filter((d) => !Object.keys(F).some((f) => f.indexOf(d + "/") === 0)); if (empty.length) lines.push("빈 폴더: " + empty.join(", "));
    const ol = K.outline(F, S.data.main); if (ol.length) lines.push("[차례] " + ol.slice(0, 60).map((o) => "  ".repeat(Math.max(0, o.lv)) + o.title + " (" + o.file + ":" + o.line + ")").join(" | "));
    const pr = allProbs().slice(0, 15); if (pr.length) lines.push("[문제] " + pr.map((p) => (p.kind === "error" ? "오류 " : "경고 ") + (p.file || "") + (p.line ? ":" + p.line : "") + " " + p.msg).join(" | "));
    const bib = K.bibAll(F); if (bib.length) lines.push("[참고문헌 키] " + bib.map((b) => b.key).slice(0, 120).join(", "));
    const cur = S.file, c = S.cm ? S.cm.getCursor() : { line: 0 };
    const body = (p, lim) => { const t = F[p] || ""; return t.length > lim ? t.slice(0, lim) + "\n…(뒤 " + (t.length - lim) + "자 생략 — 필요하면 <read path=\"" + p + "\"/>)" : t; };
    lines.push("[지금 열린 파일: " + cur + " — 커서 " + (c.line + 1) + "줄]\n<file path=\"" + cur + "\">\n" + body(cur, 28000) + "\n</file>");
    if (cur !== S.data.main && F[S.data.main] != null) lines.push("[본문 파일]\n<file path=\"" + S.data.main + "\">\n" + body(S.data.main, 9000) + "\n</file>");
    if (selText) lines.push("[사용자가 고른 글 — " + cur + "]\n" + selText);
    lines.push("[요청]\n" + userText);
    return lines.join("\n\n");
  }
  function parseAgent(t) {
    const ops = []; let reply = "";
    const rm = /<reply>([\s\S]*?)(<\/reply>|$)/.exec(t); if (rm) reply = rm[1].trim();
    const re = /<(write|insert)\s+([^>]*?)>([\s\S]*?)<\/\1>|<edit\s+([^>]*?)>([\s\S]*?)<\/edit>|<(mkdir|move|delete|main|read|compile|search_materials|search_papers|open)\b([^>]*?)\/?>/g; let m;
    while ((m = re.exec(t))) {
      if (m[1]) ops.push(Object.assign({ op: m[1], text: trimNL(m[3]) }, attrs(m[2])));
      else if (m[4] != null) { const pairs = []; m[5].replace(/<find>([\s\S]*?)<\/find>\s*<replace>([\s\S]*?)<\/replace>/g, (x, f, r) => { pairs.push([trimNL(f), trimNL(r)]); return x; }); ops.push(Object.assign({ op: "edit", pairs: pairs }, attrs(m[4]))); }
      else ops.push(Object.assign({ op: m[6] }, attrs(m[7])));
    }
    if (!reply) reply = t.replace(re, "").replace(/<\/?reply>/g, "").trim();
    return { reply: reply, ops: ops };
  }
  function attrs(s) { const o = {}; String(s || "").replace(/(\w+)\s*=\s*"([^"]*)"/g, (m, k, v) => { o[k] = v.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"); return m; }); return o; }
  function trimNL(s) { return String(s).replace(/^\r?\n/, "").replace(/\r?\n$/, ""); }
  function liveReply(full) { const r = /<reply>([\s\S]*?)(<\/reply>|$)/.exec(full); if (r) return r[1]; const i = full.search(/<(write|edit|insert|mkdir|move|delete|main|read|compile|search_)/); return (i >= 0 ? full.slice(0, i) : full).replace(/<\/?reply>?/g, ""); }
  function findLoose(text, find) {
    let i = text.indexOf(find); if (i >= 0) return [i, i + find.length];
    const norm = find.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"); if (!norm) return null;
    try { const m = new RegExp(norm).exec(text); if (m) return [m.index, m.index + m[0].length]; } catch (e) { /* 계속 */ }
    return null;
  }
  function changed(path, before, after, kind) { const d = K.diff(before || "", after || ""); const s = K.diffStat(d); return { kind: kind, path: path, before: before, after: after, add: s.add, del: s.del }; }
  function putText(p, t) { S.data.files[p] = t; if (S.docs[p]) setDocText(p, t); }
  async function applyOp(o, turn, force) {
    const F = S.data.files; const mut = /^(write|edit|insert|mkdir|move|delete|main)$/.test(o.op);
    if (mut && S.set.review && !force) return { pend: o };
    const pth = o.path != null ? cleanPath(o.path) : null;
    if (o.path != null && !pth) return { error: o.op + ": 경로가 이상해요 (" + o.path + ")" };
    switch (o.op) {
      case "write": { if (!EDIT_RE.test(pth)) return { error: "write: 글 파일만 쓸 수 있어요 (" + pth + ")" }; const b = F[pth]; putText(pth, o.text); return { change: changed(pth, b, o.text, b == null ? "new" : "write") }; }
      case "edit": {
        if (F[pth] == null) return { error: "edit: 파일이 없어요 (" + pth + ")" }; flushDocs(); let t = F[pth]; const b = t; const miss = [];
        (o.pairs || []).forEach(([f, r]) => { const at = findLoose(t, f); if (!at) miss.push(f.slice(0, 80)); else t = t.slice(0, at[0]) + r + t.slice(at[1]); });
        if (t !== b) putText(pth, t); const res = { change: t !== b ? changed(pth, b, t, "edit") : null }; if (miss.length) res.error = "edit: " + pth + " 에서 이 글을 못 찾았어요(정확히 복사하거나 <read> 로 다시 보세요): " + miss.map((x) => JSON.stringify(x)).join(" / "); return res;
      }
      case "insert": {
        if (!EDIT_RE.test(pth)) return { error: "insert: 글 파일만" }; flushDocs(); const b = F[pth] || ""; let t;
        if (o.after) { const at = findLoose(b, o.after); if (!at) return { error: "insert: 기준 글을 못 찾았어요: " + JSON.stringify(o.after.slice(0, 80)) }; const e = b.indexOf("\n", at[1]); const k = e < 0 ? b.length : e; t = b.slice(0, k) + "\n" + o.text + b.slice(k); }
        else { const k = b.lastIndexOf("\\end{document}"); t = k >= 0 ? b.slice(0, k) + o.text + "\n\n" + b.slice(k) : b.replace(/\s*$/, "") + "\n" + o.text + "\n"; }
        putText(pth, t); return { change: changed(pth, b, t, b === "" ? "new" : "insert") };
      }
      case "mkdir": if (!exists(pth)) S.data.folders.push(pth); S.openDirs[pth] = true; return { change: { kind: "mkdir", path: pth } };
      case "move": { const a = cleanPath(o.from), b = cleanPath(o.to); if (!a || !b) return { error: "move: 경로가 이상해요" }; if (!exists(a)) return { error: "move: 없는 항목 (" + a + ")" }; if (exists(b) && F[a] != null) return { error: "move: 이미 있어요 (" + b + ")" }; const isDir = F[a] == null && !S.assets.some((x) => x.name === a); const moved = await moveItem(a, b, isDir, true); (turn.assetMoves = turn.assetMoves || []).push(...moved.filter((x) => S.data.files[x[1]] == null).map((x) => [x[0], x[1]])); return { change: { kind: "move", path: a, to: b } }; }
      case "delete": {
        if (pth === S.data.main) return { error: "delete: 본문 파일은 지울 수 없어요" };
        const isAsset = S.assets.some((x) => x.name === pth || x.name.indexOf(pth + "/") === 0);
        if (isAsset && !confirm("AI 가 그림·자료 파일 '" + pth + "' 를 지우려 해요. 이건 되돌릴 수 없어요. 지울까요?")) return { error: "delete: 사용자가 그림 파일 지우기를 거절했어요 (" + pth + ")" };
        const b = F[pth]; Object.keys(F).filter((f) => f === pth || f.indexOf(pth + "/") === 0).forEach((f) => { delete F[f]; delete S.docs[f]; }); S.data.folders = S.data.folders.filter((f) => !(f === pth || f.indexOf(pth + "/") === 0));
        if (isAsset) { try { await req("texrm", {}, { name: pth }); } catch (e) { /* 계속 */ } await loadAssets(); }
        if (S.file === pth) S.file = S.data.main; return { change: Object.assign(changed(pth, b || "", "", "delete"), { after: null }) };
      }
      case "main": if (F[pth] == null || !/\.tex$/.test(pth)) return { error: "main: .tex 파일이 아니에요" }; S.data.main = pth; return { change: { kind: "main", path: pth } };
      case "open": if (F[pth] != null) openFile(pth, +o.line || 1, true); return {};
      case "read": { if (F[pth] == null) { const a = S.assets.find((x) => x.name === pth); return { info: a ? "[" + pth + "] 그림·자료 파일(바이너리, " + kb(a.size) + ") — 내용은 읽을 수 없어요" : "[" + pth + "] 없는 파일" }; } flushDocs(); const t = F[pth]; return { info: '<file path="' + pth + '">\n' + (t.length > 60000 ? t.slice(0, 60000) + "\n…(생략)" : t) + "\n</file>", step: "📖 " + pth + " 읽음" }; }
      case "compile": {
        if (!S.engine || !S.allowed) { S.probs.check = K.lint(texts(), S.data.main, assetNames()); return { info: "[컴파일] 이 계정은 PDF 컴파일을 못 해요. 미리 검사 결과: " + (S.probs.check.slice(0, 20).map((p) => (p.file || "") + ":" + p.line + " " + p.msg).join(" | ") || "문제 없음"), step: "🔎 미리 검사" }; }
        persist(); while (S.compiling) await new Promise((ok) => setTimeout(ok, 300)); const r = await compile("ai");
        const pr = (r && r.problems) || []; const fl = texts();
        const sum = pr.slice(0, 20).map((p) => (p.kind === "error" ? "오류 " : "경고 ") + (p.file || "?") + ":" + (p.line || "?") + " " + p.msg + (p.file && fl[p.file] && p.line ? "  ← 그 줄: " + JSON.stringify((fl[p.file].split("\n")[p.line - 1] || "").slice(0, 160)) : "")).join("\n");
        return { info: "[컴파일 결과] " + (r && r.ok ? "PDF " + r.pages + "쪽 생성" : "PDF 실패") + " · 오류 " + ((r && r.errors) || 0) + " · 경고 " + ((r && r.warnings) || 0) + (sum ? "\n" + sum : ""), step: "▶ 컴파일 — " + (r && r.ok ? "PDF " + r.pages + "쪽" : "실패") + " · 오류 " + ((r && r.errors) || 0) + " · 경고 " + ((r && r.warnings) || 0) };
      }
      case "search_materials": {
        try { await RND.prepare(S.pid); const c = RND.ctx(); const ch = await c.retrieve(o.query || "", 7, 7000); return { info: "[자료 검색: " + o.query + "]\n" + (c.ground(ch) || "(찾은 자료 없음)"), step: "🔎 자료 검색: " + o.query + " — " + (ch ? ch.length : 0) + "건" }; }
        catch (e) { return { info: "[자료 검색 실패] " + e.message }; }
      }
      case "search_papers": {
        try { const ws = (await TK.BIB.search(o.query || "")).slice(0, 7); return { info: "[논문 검색: " + o.query + "]\n" + ws.map((w, i) => (i + 1) + ". " + w.title + " — " + w.authors + " (" + w.year + ")" + (w.venue ? ", " + w.venue : "") + (w.doi ? ", doi:" + w.doi : "") + (w.cited ? ", 인용 " + w.cited : "")).join("\n"), step: "📚 논문 검색: " + o.query + " — " + ws.length + "건" }; }
        catch (e) { return { info: "[논문 검색 실패] " + e.message }; }
      }
    }
    return { error: "모르는 작업: " + o.op };
  }
  async function aiSend(text, opt) {
    if (!S.data || S.busyAI) return; opt = opt || {};
    const g = await gateAction({ action: "tools", cost: 1 }); if (!g.ok) { S.msgs.push({ role: "sys", text: gateMessage(g), t: Date.now() }); paintMsgs(); return; }
    S.front = "ai"; S.ai = true; grid(); if (!$("ppAiL")) paintAi();
    flushDocs(); const sel = S.cm && S.cm.getSelection() ? S.cm.getSelection() : "";
    const turnId = "t" + Date.now().toString(36);
    const turn = { id: turnId, before: { files: JSON.parse(JSON.stringify(S.data.files)), folders: S.data.folders.slice(), main: S.data.main }, assetMoves: [] };
    S.turns[turnId] = turn;
    const hist = S.msgs.filter((m) => m.role !== "sys").slice(-8).map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.role === "user" ? m.text : "<reply>" + (m.text || "") + "</reply>" + ((m.changes || []).length ? "\n(바꾼 것: " + m.changes.map(chgLabel).join(", ") + ")" : "") }));
    S.msgs.push({ role: "user", text: text, sel: sel, t: Date.now() });
    const am = { role: "ai", text: "", changes: [], steps: [], busy: true, turn: turnId, t: Date.now() }; S.msgs.push(am); paintMsgs();
    S.busyAI = true; snapshot("AI 작업 전", true);
    const convo = [{ role: "system", content: AI_SYS }].concat(hist).concat([{ role: "user", content: wsSummary(text, sel) }]);
    const replies = [];
    try {
      for (let round = 0; round < 7; round++) {
        am.busyText = round ? "이어서 작업하는 중…" : "생각하는 중…"; let full = "";
        const acc = await llmStreamChat(convo, (d, f) => { full = f; am.text = replies.concat([liveReply(f)]).filter(Boolean).join("\n\n"); paintMsg(); }, { temperature: 0.3, maxTokens: 8000 });
        full = String(acc || full || ""); const pa = parseAgent(full); if (pa.reply) replies.push(pa.reply); am.text = replies.join("\n\n");
        const results = [];
        for (const o of pa.ops) {
          am.busyText = opLabel(o); paintMsg();
          const r = await applyOp(o, turn);
          if (r.pend) (am.pending = am.pending || []).push(r.pend);
          if (r.change) am.changes.push(r.change);
          if (r.step) am.steps.push(r.step);
          if (r.info) results.push(r.info);
          if (r.error) results.push("[실패] " + r.error);
          paintMsg();
        }
        if (am.changes.length) { persist(); paintTabs(); if (S.side === "files" || S.side === "outline") paintSide(); runChecks(); if (S.file && S.data.files[S.file] == null) openFile(S.data.main); }
        if (!results.length) break;
        convo.push({ role: "assistant", content: full }); convo.push({ role: "user", content: "[도구 결과]\n" + results.join("\n\n") + "\n\n이어서 작업하세요. 다 끝났으면 <reply> 로 마무리만 하세요." });
      }
    } catch (e) { am.text = (am.text ? am.text + "\n\n" : "") + "⚠ " + e.message; }
    am.busy = false; S.busyAI = false;
    if (opt.cmt) { const c = S.data.comments.find((x) => x.id === opt.cmt); if (c && am.changes.length) c.done = true; }
    persist(); paintMsgs(); paintMarks(); aiCtx();
    if (am.changes.some((c) => c.path && c.path === S.file)) { const ch = am.changes.find((c) => c.path === S.file && c.after != null && c.before != null); if (ch) flashChange(ch); }
    if (S.set.auto && am.changes.length && !am.steps.some((s) => s.indexOf("▶") === 0)) compile("ai-after");
  }
  function flashChange(c) { if (!S.cm) return; const d = K.diff(c.before || "", c.after || ""); let ln = 0; const lines = []; d.forEach((x) => { if (x[0] !== "-") { if (x[0] === "+") lines.push(ln); ln++; } }); lines.slice(0, 400).forEach((l) => { const h = S.cm.addLineClass(l, "background", "pp-ai-new"); setTimeout(() => S.cm.removeLineClass(h, "background", "pp-ai-new"), 4000); }); if (lines.length) S.cm.scrollIntoView({ line: lines[0], ch: 0 }, 120); }
  async function undoTurn(id) {
    const t = S.turns[id]; if (!t) return toast("이 차례는 되돌릴 수 없어요(새로 고침 뒤에는 🕘 버전에서)");
    for (const [a, b] of (t.assetMoves || []).slice().reverse()) { try { await req("texmv", {}, { from: b, to: a }); } catch (e) { /* 계속 */ } }
    await loadAssets(); restoreFiles(t.before); delete S.turns[id];
    S.msgs.forEach((m) => { if (m.turn === id) { m.changes = (m.changes || []).map((c) => Object.assign({}, c, { undone: true })); m.text += "\n\n↩ 이 차례에서 바꾼 것을 되돌렸어요."; m.turn = null; } }); persist(); paintMsgs();
  }
  async function applyPending(i) { const m = S.msgs[i]; if (!m || !m.pending) return; const turn = S.turns[m.turn] || { assetMoves: [] }; for (const o of m.pending) { const r = await applyOp(o, turn, true); if (r.change) m.changes.push(r.change); if (r.error) m.steps.push("⚠ " + r.error); } m.pending = null; persist(); paintMsgs(); paintTabs(); paintSide(); runChecks(); }
  function changeDialog(c) {
    if (c.after == null && c.before != null) return modal("🗑 " + c.path, '<pre class="pp-pre">' + esc(c.before) + "</pre>", null, true);
    modal("✎ " + c.path + " — 바꾼 곳", '<p class="sh-muted"><em class="a">+' + (c.add || 0) + '</em> <em class="d">−' + (c.del || 0) + "</em></p>" + K.diffHtml(K.diff(c.before || "", c.after || "")), null, true);
  }

  /* ================================================================== 클릭 한곳에서 */
  async function onClick(e) {
    const t = e.target; let b;
    if ((b = t.closest("[data-rail]"))) { const k = b.dataset.rail; S.front = "side"; if (S.side === k && S.sideOpen && b.closest(".pp2-rail")) S.sideOpen = false; else { S.side = k; S.sideOpen = true; } setPref("side", S.side); setPref("sideOpen", S.sideOpen); paintSide(); return; }
    if ((b = t.closest("[data-tb]"))) { tool(b.dataset.tb); return; }
    if ((b = t.closest("[data-vm]"))) { S.vm = b.dataset.vm; setPref("vm", S.vm); grid(); if (S.vm !== "edit") paintPv(); return; }
    if ((b = t.closest("[data-pv]"))) { S.pv = b.dataset.pv; setPref("pv", S.pv); paintPvBar(); paintPv(); return; }
    if ((b = t.closest("[data-z]"))) { zoom(b.dataset.z); paintPvBar(); return; }
    if ((b = t.closest("[data-tabx]"))) { e.stopPropagation(); closeTab(b.dataset.tabx); return; }
    if ((b = t.closest("[data-tab]"))) { openFile(b.dataset.tab); return; }
    if ((b = t.closest("[data-fa]"))) { const k = b.dataset.fa; const dir = S.file ? dirOf(S.file) : ""; if (k === "newf") newFile(dir); if (k === "newd") newFolder(""); if (k === "up") { S.upDir = dir; $("ppUp").click(); } if (k === "more") { const r = b.getBoundingClientRect(); popMenu([["📦 zip 가져오기(Overleaf·GitHub)", () => { S.zipDir = ""; $("ppZip").click(); }], ["⬇ 전체 zip 내려받기", () => dlMenu(r.left, r.bottom)], ["✦ 샘플을 폴더로 추가", () => galleryModal()], ["⟳ 그림 목록 새로 고침", async () => { await loadAssets(); paintSide(); }]], r.left, r.bottom + 4); } return; }
    if ((b = t.closest("[data-aq]"))) { const q = QUICK[+b.dataset.aq]; aiSend(q[1]); return; }
    if ((b = t.closest("[data-cv]"))) { const [i, j] = b.dataset.cv.split("|"); changeDialog(S.msgs[+i].changes[+j]); return; }
    if ((b = t.closest("[data-copen]"))) { openFile(b.dataset.copen); return; }
    if ((b = t.closest("[data-cundo]"))) { if (confirm("이 차례에서 AI 가 바꾼 것을 모두 되돌릴까요?")) undoTurn(b.dataset.cundo); return; }
    if ((b = t.closest("[data-capply]"))) { applyPending(+b.dataset.capply); return; }
    if ((b = t.closest("[data-cdrop]"))) { const m = S.msgs[+b.dataset.cdrop]; if (m) { m.pending = null; m.steps.push("버렸어요"); paintMsgs(); } return; }
    if ((b = t.closest("[data-pp]"))) {
      const k = b.dataset.pp;
      if (k === "compile") compile("btn");
      if (k === "cmpmenu") { const r = b.getBoundingClientRect(); popMenu([[(S.set.auto ? "✓ " : "") + "자동 컴파일", () => { S.set.auto = !S.set.auto; setPref("set", S.set); stat(); }], ["★ 본문: " + S.data.main, () => { S.side = "files"; S.sideOpen = true; paintSide(); toast("파일 ⋯ 메뉴에서 '본문으로 지정'을 고르세요"); }], ["📜 기록 보기", () => { S.pv = "log"; paintPvBar(); paintPv(); }], ["🧹 작업 폴더 비우고 다시", () => compile("btn")]], r.left - 120, r.bottom + 4); }
      if (k === "dl") { const r = b.getBoundingClientRect(); dlMenu(r.left - 180, r.bottom + 4); }
      if (k === "ai") { S.front = "ai"; S.ai = !S.ai; setPref("ai", S.ai); grid(); if (S.ai) { paintAi(); setTimeout(() => { const q = $("ppAiQ"); if (q) q.focus(); }, 60); } }
      if (k === "aisend") { const q = $("ppAiQ"); const v = q.value.trim(); if (v) { q.value = ""; aiSend(v); } }
      if (k === "aiclear") { if (confirm("AI 대화를 지울까요? (원고는 그대로)")) { S.msgs = []; S.turns = {}; persist(); paintMsgs(); } }
      if (k === "aifix") aiSend("컴파일해서 오류·경고를 확인하고 모두 고쳐 줘. 고친 뒤 다시 컴파일해서 확인해.");
      if (k === "zen") { S.zen = !S.zen; setPref("zen", S.zen); document.body.classList.toggle("pp-zen", S.zen); b.classList.toggle("on", S.zen); b.textContent = S.zen ? "◳ UI 보이기" : "◱ UI 가리기"; grid(); fitSoon(); }
      if (k === "full") { const r = $("pp2"); if (document.fullscreenElement) document.exitFullscreen(); else if (r.requestFullscreen) r.requestFullscreen(); }
      if (k === "sideclose") { S.sideOpen = false; setPref("sideOpen", false); grid(); }
      if (k === "syncfwd") syncFwd();
      if (k === "pdark") { S.set.dark = !S.set.dark; setPref("set", S.set); if (S.pdfEl) S.pdfEl.classList.toggle("dark", S.set.dark); b.classList.toggle("on", S.set.dark); }
      if (k === "words") wordsDialog();
      if (k === "snap") { const n = prompt("이 버전 이름 (예: 투고본, 1차 수정)", ""); if (n != null) snapshot(n || "버전", false); }
      if (k === "addcmt") addComment();
      if (k === "replall") { if (confirm("모든 파일에서 바꿀까요?")) replaceAll(); }
    }
  }
  function onCtx(e) { /* 트리는 자체 메뉴 — 나머지는 기본 */ }
  document.addEventListener("change", async (e) => {
    if (e.target.id === "ppUp" && e.target.files.length) { await uploadFiles(e.target.files, S.upDir || ""); e.target.value = ""; }
    if (e.target.id === "ppZip" && e.target.files.length) { await importZip(e.target.files[0], S.zipDir || ""); e.target.value = ""; }
  });
  document.addEventListener("dragover", (e) => { if (e.target.closest && e.target.closest("#ppSide")) e.preventDefault(); });
  document.addEventListener("drop", (e) => { if (e.target.closest && e.target.closest("#ppSide") && !e.target.closest("#ppTree") && e.dataTransfer.files.length) { e.preventDefault(); uploadFiles(e.dataTransfer.files, ""); } });
  document.addEventListener("visibilitychange", () => { if (document.hidden && S.data) persist(); });
  window.addEventListener("beforeunload", () => { if (S.data && Object.keys(S.dirty).length) persist(); });

  /* ================================================================== 🗂 프로젝트 정보·관리 (업무관리시스템 연동 자리) */
  async function paintProj(area) {
    let list = []; try { list = (await RND.ws.req("projects")).list || []; } catch (e) { area.innerHTML = '<p class="lb-warn">' + esc(e.message) + "</p>"; return; }
    if (!list.length) { area.innerHTML = '<div class="sv hub"><div class="hub-head"><div><h2>프로젝트 정보·관리</h2></div></div><p class="sh-muted">연구 프로젝트가 없어요.</p></div>'; return; }
    let pid = P("hub.rnd", "") || RND.cur() || list[0].id; if (!list.some((p) => p.id === pid)) pid = list[0].id;
    const p = list.find((x) => x.id === pid);
    const KIND = { proposal: "연구개발계획서", paper: "논문·학술", report: "보고서·결과물", policy: "정책·규정·공고", lecture: "강의·교육 자료", other: "기타", research: "연구" };
    const fmt = (t) => t ? new Date(t).toLocaleString("ko-KR", { year: "numeric", month: "numeric", day: "numeric" }) : "-";
    const SOON = [["📅 일정·마일스톤", ["단계", "시작", "끝", "담당", "상태"]], ["👥 참여 인력", ["이름", "역할", "참여율", "기관", "연락"]], ["💰 예산·집행", ["비목", "계획", "집행", "잔액", "증빙"]], ["📦 산출물·보고", ["산출물", "기한", "담당", "상태", "제출처"]], ["⚠ 위험·이슈", ["이슈", "영향", "대응", "담당", "상태"]]];
    area.innerHTML = '<div class="sv hub pj"><div class="hub-head"><div><h2>프로젝트 정보·관리</h2><p class="sh-muted">과제의 기본 정보와 업무 진행 상황. 일정·인력·예산·산출물 관리는 <b>업무관리시스템(FlowBoard)</b>과 연동해 그쪽 데이터를 그대로 보여 줄 자리예요.</p></div><span class="hub-n">업무관리시스템 연동 준비</span></div>' +
      '<div class="hub-ctx"><label>프로젝트 <select id="pjSel">' + list.map((x) => '<option value="' + esc(x.id) + '"' + (x.id === pid ? " selected" : "") + ">" + esc(x.name) + "</option>").join("") + '</select></label><span class="hub-st"></span><button type="button" class="ghost-btn small-btn" data-pj="edit">✎ 이름·목표 고치기</button><button type="button" class="ghost-btn small-btn" data-pj="open">작업실 열기 →</button></div>' +
      '<div class="pj-grid"><section class="lf-card pj-info"><h4>📌 기본 정보</h4><dl>' + [["이름", p.name], ["종류", KIND[p.kind] || p.kind || "-"], ["목표", p.goal || "-"], ["폴더 묶음", p.group || "기본"], ["연결 폴더", (p.source && p.source.path) || "-"], ["만든 날", fmt(p.created)], ["최근 수정", fmt(p.updated)], ["자료 · 문서", ((p.counts || {}).files || 0) + "개 · " + ((p.counts || {}).docs || 0) + "개"]].map((r) => "<dt>" + r[0] + "</dt><dd>" + esc(r[1]) + "</dd>").join("") + "</dl></section>" +
      '<section class="lf-card pj-epic"><h4>📋 FlowBoard 에픽</h4><div id="pjEpic"></div></section></div>' +
      '<div class="pj-soon">' + SOON.map((s) => '<section class="lf-card"><h4>' + s[0] + ' <small class="pj-tag">업무관리시스템 연동 예정</small></h4><div class="tk-tblw"><table class="sv-tbl"><thead><tr>' + s[1].map((c) => "<th>" + c + "</th>").join("") + '</tr></thead><tbody><tr><td colspan="' + s[1].length + '" class="pj-empty">FlowBoard 에픽·카드와 연결되면 여기에 표시돼요.</td></tr></tbody></table></div></section>').join("") + "</div></div>";
    $("pjSel").addEventListener("change", (e) => { PS("hub.rnd", e.target.value); paintProj(area); });
    try { if (window.RNDLINK && RNDLINK.epicPanel) RNDLINK.epicPanel($("pjEpic"), p); else $("pjEpic").innerHTML = '<p class="sh-muted">FlowBoard 연결 모듈을 불러오지 못했어요.</p>'; } catch (e) { $("pjEpic").innerHTML = '<p class="lb-warn">' + esc(e.message) + "</p>"; }
    area.onclick = async (e) => {
      const b = e.target.closest("[data-pj]"); if (!b) return;
      if (b.dataset.pj === "open") RND.open(pid);
      if (b.dataset.pj === "edit") { const n = prompt("프로젝트 이름", p.name); if (n == null) return; const g = prompt("목표", p.goal || ""); try { await RND.ws.req("project", {}, { id: pid, name: n, goal: g == null ? p.goal : g }); paintProj(area); } catch (er) { alert(er.message); } }
    };
  }

  function build() {
    const content = document.querySelector("main.content"); if (!content || typeof EXT_VIEWS === "undefined" || EXT_VIEWS.rx_paper) return;
    [["rx_paper", paintPaper], ["rx_proj", paintProj]].forEach(([k, fn]) => {
      const a = document.createElement("section"); a.id = "hub_" + k; a.className = "hidden"; content.appendChild(a);
      EXT_VIEWS[k] = { area: a, open: () => { if (k !== "rx_paper" && S.data) persist(); return fn(a).catch((er) => { a.innerHTML = '<p class="lb-warn">' + esc(er.message) + "</p>"; }); } };
    });
    const pa = $("hub_rx_paper"); new MutationObserver(() => { if (!pa.classList.contains("hidden") && $("pp2")) { document.body.classList.toggle("pp-zen", !!S.zen); fitSoon(); } else { mathHide(); hideSelBar(); if (S.data) persist(); } }).observe(pa, { attributes: true, attributeFilter: ["class"] });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build); else setTimeout(build, 0);
  // (v107) 다른 화면(문헌 작업실 등)이 원고에 파일·참고문헌을 넣는다 — 열려 있으면 편집기 안에서, 아니면 저장소에 바로
  async function importFrom(pid, o) {
    const live = S.pid === pid && S.data; const d = live ? S.data : normalize(P("rnd.paper." + pid, null)); if (!d) return null;
    if (live) flushDocs();
    Object.keys(o.files || {}).forEach((p) => { d.files[p] = o.files[p]; if (live) setDocText(p, d.files[p]); });
    if (o.bib) {
      const bf = Object.keys(d.files).find((f) => /(^|\/)refs?\.bib$/.test(f)) || Object.keys(d.files).find((f) => /\.bib$/.test(f)) || join(dirOf(d.main || ""), "refs.bib");
      const s0 = d.files[bf] || ""; const have = {}; K.parseBib(s0).forEach((b) => { have[b.key] = 1; });
      const add = K.parseBib(o.bib).filter((b) => !have[b.key]).map((b) => o.bib.slice(b.start, b.end));
      if (add.length) { d.files[bf] = s0.replace(/\s*$/, "") + (s0.trim() ? "\n\n" : "") + add.join("\n\n") + "\n"; if (live) setDocText(bf, d.files[bf]); }
    }
    if (live) { persist(); if ($("pp2")) { paintSide(); runChecks(); } } else PS("rnd.paper." + pid, d);
    return true;
  }
  window.PAPER = { render: (files, main) => (K ? K.render(files, main).html : ""), state: () => S, compile: compile, aiSend: aiSend, importFrom: importFrom };
})();
