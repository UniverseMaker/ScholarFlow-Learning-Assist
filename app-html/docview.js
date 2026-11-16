/* =============================================================================
 * docview.js (v98) — 플랫폼 안 범용 자료 뷰어
 *   PDF·Word·PPT·Excel(오피스로 PDF 변환) → 쪽 그림 + 글 층(고르기·찾기) · 확대/폭 맞춤 · 쪽 목록·목차 · 형광펜 4색 · 쪽 메모 · 책갈피 · 어둡게 · 전체 화면
 *   HWP·HWPX·글·코드·MD·HTML → 글 보기(형광펜·메모) · XLSX·CSV → 시트 표(+ 인쇄 모양 PDF) · 그림 → 확대·회전·메모 핀 · 소리·영상 → 속도·10초·시각 메모
 *   서버: api.php?r=ws&op=view·page·words·ptext·file (tools/docview.py)
 *   DOCVIEW.mount(el, {url(op, extra), json(op, extra), name, ext, annKey, onAction(kind, info), onLocate(where)}) → {where(), goto(p), ann(), destroy()}
 *   주석은 TK.store(annKey) — 계정 실시간 저장(다른 기기에서도 그대로)
 * ========================================================================== */
(function () {
  "use strict";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const COLORS = [["y", "노랑"], ["g", "초록"], ["b", "파랑"], ["p", "분홍"]];
  const fmtTime = (s) => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0"); };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const md = (t) => { try { return chatMarkup(String(t || "")); } catch (e) { return "<pre>" + esc(t) + "</pre>"; } };
  const KIND_NAME = { pdf: "PDF", office: "오피스 문서", sheet: "표", hwp: "한글 문서", image: "그림", audio: "소리", video: "영상", md: "마크다운", html: "웹 문서", text: "글", other: "파일" };

  function mount(el, o) {
    const S = { kind: "", info: null, zoom: 1, fit: "width", page: 1, pages: 0, sizes: [], words: {}, ptext: null, dark: false, memoMode: false, hits: [], hitI: -1, destroyed: false, timers: [] };
    const A = () => { const a = (window.TK && TK.store.get(o.annKey, null)) || {}; a.hl = a.hl || []; a.memo = a.memo || []; a.bm = a.bm || []; return a; };
    const saveA = (a) => { if (window.TK) TK.store.set(o.annKey, a); if (o.onAnn) o.onAnn(a); };
    el.classList.add("dv");
    // (v168) 드래그 메뉴 가리기 — 메뉴의 ✕ 또는 위 막대 🗨 단추로 끄고 켠다(기기별 기억, dv.prefs.nopop)
    const popOff = () => !!(((window.TK && TK.store.get("dv.prefs", {})) || {}).nopop);
    const popTip = (off) => off ? "드래그 메뉴 가려짐 — 누르면 다시 보이기" : "드래그 메뉴 보이는 중 — 누르면 가리기";
    // (v181) 드래그 메뉴 위치·거리(기기별 기억 dv.prefs.popPos·popGap) — 고른 글 위/아래/마우스 옆, 0~60px
    const POP_POS = [["above", "고른 글 위"], ["below", "고른 글 아래"], ["mouse", "마우스 옆"]];
    const popPref = () => { const pr = ((window.TK && TK.store.get("dv.prefs", {})) || {}); const g = Number(pr.popGap); return { pos: POP_POS.some((x) => x[0] === pr.popPos) ? pr.popPos : "above", gap: isFinite(g) && pr.popGap !== undefined ? Math.max(0, Math.min(60, g)) : 14 }; };
    function popSettings(anchor) {
      let box = el.querySelector(".dv-popset"); if (box) { box.remove(); return; }
      const cur = popPref();
      box = document.createElement("div"); box.className = "dv-popset"; box.setAttribute("role", "dialog"); box.setAttribute("aria-label", "드래그 메뉴 설정");
      box.innerHTML = '<b>드래그 메뉴</b><label class="dv-ps-row"><input type="checkbox" data-ps-on' + (popOff() ? "" : " checked") + '> 글을 고르면 메뉴 띄우기</label>' +
        '<div class="dv-ps-h">위치</div><div class="dv-ps-seg">' + POP_POS.map((x) => '<button type="button" data-ps-pos="' + x[0] + '" class="' + (x[0] === cur.pos ? "on" : "") + '">' + x[1] + "</button>").join("") + "</div>" +
        '<div class="dv-ps-h">글에서 떨어진 거리 <em data-ps-gv>' + cur.gap + 'px</em></div><input type="range" min="0" max="60" step="2" value="' + cur.gap + '" data-ps-gap aria-label="글에서 떨어진 거리">' +
        '<div class="dv-ps-seg">' + [[6, "가깝게"], [14, "보통"], [28, "멀게"], [44, "아주 멀게"]].map((x) => '<button type="button" data-ps-g="' + x[0] + '">' + x[1] + "</button>").join("") + "</div>";
      el.appendChild(box);
      const r = el.getBoundingClientRect(), a = (anchor || el).getBoundingClientRect();
      box.style.left = Math.max(6, Math.min(r.width - box.offsetWidth - 6, a.left - r.left)) + "px"; box.style.top = Math.max(6, Math.min(r.height - box.offsetHeight - 6, a.bottom - r.top + 6)) + "px";
      const setGap = (v) => { prefs("popGap", v); box.querySelector("[data-ps-gap]").value = v; box.querySelector("[data-ps-gv]").textContent = v + "px"; };
      box.addEventListener("click", (e) => {
        e.stopPropagation();
        const b = e.target.closest("[data-ps-pos]"); if (b) { prefs("popPos", b.dataset.psPos); box.querySelectorAll("[data-ps-pos]").forEach((x) => x.classList.toggle("on", x === b)); return; }
        const g = e.target.closest("[data-ps-g]"); if (g) setGap(+g.dataset.psG);
      });
      box.addEventListener("input", (e) => { if (e.target.matches("[data-ps-gap]")) setGap(+e.target.value); if (e.target.matches("[data-ps-on]")) setPopOff(!e.target.checked); });
      setTimeout(() => document.addEventListener("mousedown", function off(e) { if (!box.contains(e.target) && !e.target.closest(".dv-popcfg")) { box.remove(); document.removeEventListener("mousedown", off); } }), 0);
    }
    function setPopOff(off) {
      prefs("nopop", !!off);
      el.querySelectorAll(".dv-popt").forEach((b) => { b.classList.toggle("on", !off); b.setAttribute("aria-pressed", String(!off)); b.title = popTip(off); if (off) { b.classList.remove("dv-flash"); void b.offsetWidth; b.classList.add("dv-flash"); } });
      if (off) popHide();
    }
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-dv-popx]")) { e.stopPropagation(); e.preventDefault(); setPopOff(true); return; }
      if (e.target.closest(".dv-popt")) { e.stopPropagation(); e.preventDefault(); setPopOff(!popOff()); }
      const cfg = e.target.closest(".dv-popcfg"); if (cfg) { e.stopPropagation(); e.preventDefault(); popSettings(cfg); }
    }, true);
    el.innerHTML = '<div class="dv-load"><span class="lb-dots"><i></i><i></i><i></i></span> 자료를 여는 중…</div>';
    const api = { where, goto, ann: A, refresh: () => paintAnn(), find: (q, opt) => { S.quiet = !!(opt && opt.quiet); const inp = el.querySelector(".dv-q"); if (!S.kind || S.kind === "office" || S.kind === "hwp" && !S.scroll) { S.pendingFind = q; return; } if (inp) inp.value = q; find(q); }, destroy() { S.destroyed = true; S.timers.forEach(clearInterval); if (S.io) S.io.disconnect(); document.removeEventListener("keydown", onKey); } };
    start();
    return api;

    async function start() {
      let v;
      try { v = await o.json("view"); } catch (e) { el.innerHTML = '<p class="lb-warn">' + esc(e.message) + "</p>"; return; }
      if (S.destroyed) return;
      S.info = v; S.kind = v.kind;
      if (v.error && !v.pdf && !v.text && !v.sheets) { other(v.error); return; }
      if (v.pdf) return pdfView(v.pdf);
      if (v.kind === "office" || v.kind === "hwp") return prepView(v);
      if (v.kind === "sheet") return sheetView(v);
      if (v.kind === "image") return imageView();
      if (v.kind === "audio" || v.kind === "video") return mediaView();
      if (v.kind === "html") return htmlView(v.text || "");
      if (v.kind === "hwp" || v.kind === "text" || v.kind === "md") return textView(v.text || "", v.kind);
      return other();
    }
    function other(msg) {
      el.innerHTML = '<div class="dv-empty"><span>📦</span><b>' + esc(o.name) + "</b><p>" + esc(msg || "이 형식은 화면에 그릴 수 없어요. 원본을 내려받아 열어 주세요.") + '</p><a class="ghost-btn" href="' + esc(o.url("file")) + '" download>⬇ 원본 내려받기</a></div>';
    }
    // (v98) 오피스·한글 — 쪽 모양이 준비되는 동안 글을 먼저 보여 주고, 준비되면 저절로 쪽 보기로 바뀐다(사용자가 할 일 없음)
    async function prepView(v) {
      if (v.state === "error") { if (v.text) { textView(v.text, v.kind === "hwp" ? "hwp" : "text"); prepChip("원래 모양으로는 열지 못해 글로 보여 드려요"); return; } return waitOffice(v); }
      let text = v.text || "";
      if (!text) { try { text = (await o.json("text")).text || ""; } catch (e) { text = ""; } }
      if (S.destroyed) return;
      if (!text) return waitOffice(v);
      textView(text, v.kind === "hwp" ? "hwp" : "text");
      prepChip(v.state === "waiting" ? "한글을 쓰는 중이라, 한글을 닫으면 원래 모양으로 바뀌어요" : "원래 모양으로 여는 중…", true);
      const t = setInterval(async () => {
        if (S.destroyed) { clearInterval(t); return; }
        let n = null; try { n = await o.json("view"); } catch (e) { n = null; }
        if (!n) return;
        if (n.pdf) { clearInterval(t); const q = S.q; S.info = n; S.docEl = null; S.sheetEl = null; pdfView(n.pdf); if (q) api.find(q); return; }
        if (n.state === "error") { clearInterval(t); prepChip("원래 모양으로는 열지 못해 글로 보여 드려요"); }
        else prepChip(n.state === "waiting" ? "한글을 쓰는 중이라, 한글을 닫으면 원래 모양으로 바뀌어요" : "원래 모양으로 여는 중…", true);
      }, 2500);
      S.timers.push(t);
    }
    function prepChip(t, busy) {
      const b = el.querySelector(".dv-bar"); if (!b) return;
      let c = b.querySelector(".dv-prep"); if (!c) { c = document.createElement("span"); c.className = "dv-prep"; b.insertBefore(c, b.querySelector(".dv-sp")); }
      c.innerHTML = (busy ? '<span class="lb-dots"><i></i><i></i><i></i></span>' : "ⓘ ") + esc(t);
    }
    function waitOffice(v) {
      if (v.state === "error") {
        el.innerHTML = '<div class="dv-empty"><span>⚠</span><b>' + esc(o.name) + '</b><p>원래 모양으로 열지 못했어요: ' + esc(v.error || "") + '</p><div class="lb-row"><button type="button" class="ghost-btn" data-dv="retry">다시 시도</button><a class="ghost-btn" href="' + esc(o.url("file")) + '" download>⬇ 원본</a><button type="button" class="ghost-btn" data-dv="astext">글만 보기</button></div></div>';
        bindEmpty(); return;
      }
      el.innerHTML = '<div class="dv-empty"><span class="lb-dots"><i></i><i></i><i></i></span><b>' + esc(o.name) + '</b><p>' + (v.state === "waiting" ? "한글을 쓰는 중이에요. 한글을 닫으면 바로 열려요." : "처음 여는 자료라 쪽을 준비하고 있어요 — 다음부터는 바로 열려요.") + '</p><div class="lb-row"><button type="button" class="ghost-btn" data-dv="astext">기다리는 동안 글만 보기</button></div></div>';
      bindEmpty();
      const t = setInterval(async () => {
        if (S.destroyed) { clearInterval(t); return; }
        try { const n = await o.json("view"); if (n.pdf) { clearInterval(t); S.info = n; pdfView(n.pdf); } else if (n.state === "error") { clearInterval(t); waitOffice(n); } } catch (e) { /* 계속 */ }
      }, 2500);
      S.timers.push(t);
    }
    function bindEmpty() {
      el.onclick = async (e) => {
        const b = e.target.closest("[data-dv]"); if (!b) return;
        if (b.dataset.dv === "retry") { el.innerHTML = '<div class="dv-load">다시 시도하는 중…</div>'; start(); }
        if (b.dataset.dv === "astext") { S.timers.forEach(clearInterval); let t = ""; try { t = (await o.json("text")).text || ""; } catch (er) { t = ""; } textView(t || "(글을 뽑지 못했어요)", "text"); }
      };
    }

    /* ------------------------------------------------------------ 공용 막대 */
    function bar(extra) {
      const all = !!((window.TK && TK.store.get("dv.prefs", {})) || {}).others;
      return '<div class="dv-bar" role="toolbar" aria-label="자료 보기 도구">' + extra +
        '<span class="dv-sp"></span><span class="dv-grp dv-find"><input type="search" class="dv-q" placeholder="찾기 (Ctrl+F)" aria-label="자료에서 찾기"><span class="dv-hn" aria-live="polite"></span><button type="button" class="dv-b" data-dv="hitp" title="이전 찾은 곳 (Shift+Enter)" aria-label="이전">‹</button><button type="button" class="dv-b" data-dv="hitn" title="다음 찾은 곳 (Enter)" aria-label="다음">›</button>' +
        (o.onSearchOther ? '<button type="button" class="dv-b dv-allf' + (all ? " on" : "") + '" data-dv="others" title="다른 자료에서도 찾기 — 켜 두면 찾을 때마다 프로젝트의 다른 자료까지 뒤져서 오른쪽에 모아요" aria-pressed="' + all + '">다른 자료도</button>' : "") + "</span>" +
        '<span class="dv-grp"><button type="button" class="dv-b dv-popt' + (popOff() ? "" : " on") + '" aria-pressed="' + !popOff() + '" aria-label="드래그 메뉴 보이기·가리기" title="' + popTip(popOff()) + '">🗨</button><button type="button" class="dv-b dv-popcfg" aria-label="드래그 메뉴 위치·거리" title="드래그 메뉴 위치·거리">⚙</button><button type="button" class="dv-b" data-dv="dark" title="어둡게 보기(종이 색 뒤집기)">🌙</button><button type="button" class="dv-b" data-dv="full" title="전체 화면">⛶</button><a class="dv-b" href="' + esc(o.url("file")) + '" download title="원본 내려받기">⬇</a></span></div>';
    }
    // 글을 고르면 뜨는 메뉴 — 칠하기 · AI · 모으기 · 단어 3묶음(앱 전체의 선택 칩은 뷰어 안에서는 뜨지 않는다 → 겹침 없음)
    function selPop() {
      const b = (k, ico, t, tip) => '<button type="button" data-dv-act="' + k + '" title="' + esc(tip || t) + '"><span aria-hidden="true">' + ico + "</span>" + (t ? "<em>" + t + "</em>" : "") + "</button>";
      return '<div class="dv-pop hidden" role="menu" aria-label="고른 글로 할 일"><span class="dv-pop-g">' + COLORS.map((c) => '<button type="button" class="dv-c c-' + c[0] + '" data-dv-hl="' + c[0] + '" title="형광펜 ' + c[1] + '" aria-label="형광펜 ' + c[1] + '"></button>').join("") + b("note", "📝", "메모", "형광펜 + 메모") + "</span>" +
        '<span class="dv-pop-g">' + b("ask", "💬", "AI 에게") + b("explain", "💡", "쉽게") + b("translate", "🌐", "번역") + "</span>" +
        '<span class="dv-pop-g">' + b("collect", "📌", "담기", "수집함에 담기") + (o.onAction ? b("todoc", "✍", "문서에", "작업 문서에 바로 넣기") : "") + b("copy", "📋", "", "복사") + '<button type="button" class="dv-popcfg" title="드래그 메뉴 위치·거리" aria-label="드래그 메뉴 위치·거리">⚙</button><button type="button" class="dv-pop-x" data-dv-popx title="드래그 메뉴 가리기 — 위 막대 🗨 로 다시 켜기" aria-label="드래그 메뉴 가리기">✕</button>' + "</span></div>";
    }
    function popAt(x, y, sel) {
      if (popOff()) return; const p = el.querySelector(".dv-pop"); if (!p) return; const r = el.getBoundingClientRect(); p.classList.remove("hidden");
      const w = p.offsetWidth || 360, h = p.offsetHeight || 40, pf = popPref(), GAP = pf.gap;
      // (v181) 고른 글 상자 기준으로 띄운다 — 마우스 놓은 자리 기준이면 고른 줄 바로 위에 붙어 글씨를 가렸다
      let sr = sel || null;
      if (!sr) {
        try {
          const s = curSel();
          if (s && s.rangeCount) {
            const rr = s.getRangeAt(0).getBoundingClientRect(), fr = S.selDoc && S.selDoc !== document ? (el.querySelector("iframe") || el).getBoundingClientRect() : null;
            if (rr && rr.width + rr.height > 0) sr = fr ? { left: rr.left + fr.left, top: rr.top + fr.top, width: rr.width, bottom: rr.bottom + fr.top } : rr;
          }
        } catch (e) { sr = null; }
      }
      let cx, top;
      if (pf.pos === "mouse" || !sr) { cx = x + w / 2 + GAP; top = y - r.top + GAP; }        // 마우스 오른쪽 아래
      else if (pf.pos === "below") { cx = sr.left + sr.width / 2; top = sr.bottom - r.top + GAP; if (top + h > r.height - 6) top = sr.top - r.top - h - GAP; }
      else { cx = sr.left + sr.width / 2; top = sr.top - r.top - h - GAP; if (top < 44) top = sr.bottom - r.top + GAP; }   // 위에 자리가 없으면 아래로
      p.style.left = Math.max(6, Math.min(r.width - w - 6, cx - r.left - w / 2)) + "px"; p.style.top = Math.max(44, Math.min(r.height - h - 6, top)) + "px";
    }
    function popHide() { const p = el.querySelector(".dv-pop"); if (p) p.classList.add("hidden"); }
    function curSel() { try { const s = (S.selDoc || document).getSelection(); return s && String(s).trim() ? s : null; } catch (e) { return null; } }
    function act(kind, text, page, rect) {
      if (kind === "copy") { try { navigator.clipboard.writeText(text); } catch (e) { /* 계속 */ } return; }
      if (o.onAction) o.onAction(kind, { text: text, page: page, label: label(page) });
    }
    function label(p) { return o.name + (p ? " p." + p : ""); }

    /* ------------------------------------------------------------ PDF(쪽 그림) */
    function pdfView(info) {
      S.kind = "pdf"; S.pages = info.pages; S.sizes = info.sizes; S.toc = info.toc || [];
      const prefs = (window.TK && TK.store.get("dv.prefs", {})) || {};
      S.thumbs = prefs.thumbs !== false && S.pages > 1 && el.clientWidth > 640;   // 좁으면 쪽 목록은 접어 둔다(▤ 로 펼침)
      S.fit = prefs.fit || "width"; S.zoom = prefs.zoom || 1; S.dark = !!prefs.dark;
      el.innerHTML = bar('<span class="dv-grp"><button type="button" class="dv-b" data-dv="thumbs" title="쪽 목록·목차">▤</button><button type="button" class="dv-b" data-dv="prev" title="이전 쪽 (←)" aria-label="이전 쪽">◀</button><input class="dv-pn" type="text" inputmode="numeric" value="1" aria-label="쪽 번호"><span class="dv-pt">/ ' + S.pages + '</span><button type="button" class="dv-b" data-dv="next" title="다음 쪽 (→)" aria-label="다음 쪽">▶</button></span>' +
        '<span class="dv-grp"><button type="button" class="dv-b" data-dv="zout" title="축소 (−)">−</button><button type="button" class="dv-b dv-zv" data-dv="zreset" title="100%">100%</button><button type="button" class="dv-b" data-dv="zin" title="확대 (+)">＋</button><button type="button" class="dv-b" data-dv="fitw" title="폭 맞춤">↔</button><button type="button" class="dv-b" data-dv="fitp" title="쪽 맞춤">⤢</button></span>' +
        '<span class="dv-grp"><button type="button" class="dv-b" data-dv="memo" title="쪽 메모 붙이기 — 누른 뒤 쪽을 클릭">📝</button><button type="button" class="dv-b" data-dv="bm" title="이 쪽 책갈피">🔖</button></span>') +
        '<div class="dv-body"><nav class="dv-side' + (S.thumbs ? "" : " hidden") + '"><div class="dv-stabs"><button type="button" class="on" data-dv-st="th">쪽</button><button type="button" class="hidden" data-dv-st="find">찾기</button>' + (S.toc.length ? '<button type="button" data-dv-st="toc">목차</button>' : "") + '<button type="button" data-dv-st="bm">책갈피</button></div><div class="dv-slist"></div></nav><div class="dv-scroll" tabindex="0"><div class="dv-pages">' +
        S.sizes.map((s, i) => '<div class="dv-pg" data-p="' + (i + 1) + '" style="--ar:' + (s[0] / s[1]) + '"><img alt="' + (i + 1) + '쪽" decoding="async" draggable="false"><div class="dv-hll"></div><div class="dv-fl"></div><div class="dv-tl"></div><span class="dv-pgn">' + (i + 1) + "</span></div>").join("") + "</div></div></div>" + selPop();
      S.scroll = el.querySelector(".dv-scroll"); S.selDoc = document;
      el.classList.toggle("dv-dark", S.dark);
      layout(); paintSide("th"); paintAnn();
      S.io = new IntersectionObserver((ents) => ents.forEach((en) => { if (en.isIntersecting) loadPage(+en.target.dataset.p); }), { root: S.scroll, rootMargin: "900px 0px" });
      el.querySelectorAll(".dv-pg").forEach((p) => S.io.observe(p));
      S.scroll.addEventListener("scroll", onScroll, { passive: true });
      new ResizeObserver(() => { if (S.fit !== "zoom") layout(); }).observe(S.scroll);
      bindCommon();
      el.querySelector(".dv-pn").addEventListener("change", (e) => goto(+e.target.value || 1));
      const pend = S.pendingGoto; if (pend) { S.pendingGoto = null; setTimeout(() => goto(pend), 60); }
      const pf = S.pendingFind; if (pf) { S.pendingFind = null; setTimeout(() => api.find(pf), 120); }
      o.json("ptext").then((d) => { S.ptext = d.pages || []; }).catch(() => { S.ptext = []; });
      // 쪽 클릭: 메모 모드면 메모 붙이기
      S.scroll.addEventListener("click", (e) => {
        const pin = e.target.closest(".dv-pin"); if (pin) { memoEdit(pin.dataset.id); return; }
        const hl = e.target.closest(".dv-hl"); if (hl && !curSel()) { hlMenu(hl.dataset.id, e); return; }
        if (!S.memoMode) return;
        const pg = e.target.closest(".dv-pg"); if (!pg) return;
        const r = pg.getBoundingClientRect(); const a = A();
        const m = { id: uid(), p: +pg.dataset.p, x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, text: "", t: Date.now() };
        a.memo.push(m); saveA(a); S.memoMode = false; el.querySelector('[data-dv="memo"]').classList.remove("on"); paintAnn(); memoEdit(m.id, true);
      });
      S.scroll.addEventListener("mouseup", (e) => setTimeout(() => { const s = curSel(); if (!s || !S.scroll.contains(s.anchorNode)) { if (!e.target.closest(".dv-pop")) popHide(); return; } popAt(e.clientX, e.clientY); }, 10));
    }
    function pgWidth() {
      const W = S.scroll.clientWidth - (window.innerWidth < 700 ? 24 : 64);   // 쪽 둘레 여백(.dv-pages 좌우 안쪽 여백과 같게)
      if (S.fit === "width") return Math.max(240, W);
      if (S.fit === "page") { const H = S.scroll.clientHeight - 24, s = S.sizes[S.page - 1] || S.sizes[0]; return Math.max(200, Math.min(W, H * s[0] / s[1])); }
      return Math.max(200, Math.round(780 * S.zoom));
    }
    function layout() {
      if (!S.scroll) return;
      const keep = S.page, w = pgWidth();
      el.querySelector(".dv-pages").style.setProperty("--pw", w + "px");
      el.querySelectorAll(".dv-pg").forEach((p) => { p.style.setProperty("--ph", (w / +p.style.getPropertyValue("--ar")) + "px"); const img = p.querySelector("img"); if (img.dataset.w && +img.dataset.w < w * (window.devicePixelRatio || 1) * 0.85) img.dataset.stale = "1"; });
      const z = el.querySelector(".dv-zv"); if (z) z.textContent = Math.round(w / 780 * 100) + "%";
      el.querySelectorAll(".dv-pg").forEach((p) => { const r = p.getBoundingClientRect(), sr = S.scroll.getBoundingClientRect(); if (r.bottom > sr.top - 900 && r.top < sr.bottom + 900) loadPage(+p.dataset.p); });
      if (keep > 1) { const pg = el.querySelector('.dv-pg[data-p="' + keep + '"]'); if (pg && !S.scrolling) S.scroll.scrollTop = pg.offsetTop - 8; }
    }
    function loadPage(p) {
      const pg = el.querySelector('.dv-pg[data-p="' + p + '"]'); if (!pg) return;
      const img = pg.querySelector("img"), need = Math.round(pgWidth() * Math.min(2.5, window.devicePixelRatio || 1));
      if (!img.dataset.w || img.dataset.stale) { const w = Math.max(200, Math.min(2800, Math.round(need / 200) * 200)); img.dataset.w = w; delete img.dataset.stale; img.src = o.url("page", { p: p, w: w }); }
      if (!S.words[p]) { S.words[p] = "…"; o.json("words", { p: p }).then((d) => { S.words[p] = d; textLayer(pg, d); paintHits(); }).catch(() => { S.words[p] = null; }); }
    }
    function textLayer(pg, d) {
      const tl = pg.querySelector(".dv-tl"); if (!d || !d.lines) return;
      tl.innerHTML = d.lines.map((l) => '<span style="left:' + (l[0] * 100) + "%;top:" + (l[1] * 100) + "%;width:" + ((l[2] - l[0]) * 100) + "%;font-size:calc(var(--ph) * " + ((l[3] - l[1]) * 0.86).toFixed(5) + ')">' + esc(l[4]) + "</span>").join(" ");
      requestAnimationFrame(() => { tl.querySelectorAll("span").forEach((s) => { const want = s.parentElement.clientWidth * parseFloat(s.style.width) / 100; s.style.width = "auto"; const has = s.getBoundingClientRect().width || 1; s.style.transform = "scaleX(" + Math.max(0.3, Math.min(3, want / has)).toFixed(3) + ")"; }); });
    }
    function onScroll() {
      S.scrolling = true; clearTimeout(S.st); S.st = setTimeout(() => { S.scrolling = false; }, 160);
      const sr = S.scroll.getBoundingClientRect(), mid = sr.top + sr.height * 0.35; let best = 1;
      el.querySelectorAll(".dv-pg").forEach((p) => { const r = p.getBoundingClientRect(); if (r.top <= mid) best = +p.dataset.p; });
      if (best !== S.page) { S.page = best; const pn = el.querySelector(".dv-pn"); if (pn && document.activeElement !== pn) pn.value = best; markThumb(); if (o.onLocate) o.onLocate(where()); }
    }
    function goto(p) {
      if (S.kind !== "pdf" || !S.scroll) { S.pendingGoto = p; return; }
      p = Math.max(1, Math.min(S.pages, p)); const pg = el.querySelector('.dv-pg[data-p="' + p + '"]'); if (!pg) return;
      S.scroll.scrollTo({ top: pg.offsetTop - 8, behavior: Math.abs(p - S.page) > 6 ? "auto" : "smooth" }); S.page = p; const pn = el.querySelector(".dv-pn"); if (pn) pn.value = p; markThumb();
      if (o.onLocate) o.onLocate(where());
    }
    /* 전체 찾기 목록 — 찾은 곳마다 쪽·앞뒤 글, 누르면 그 자리로 */
    function snip(t, q) {
      t = String(t || "").replace(/\s+/g, " ").trim(); const i = t.toLowerCase().indexOf(q.toLowerCase());
      if (i < 0) return esc(t.slice(0, 90));
      const a = Math.max(0, i - 34), b = Math.min(t.length, i + q.length + 46);
      return (a ? "…" : "") + esc(t.slice(a, i)) + "<mark>" + esc(t.slice(i, i + q.length)) + "</mark>" + esc(t.slice(i + q.length, b)) + (b < t.length ? "…" : "");
    }
    function hitText(h, k) {   // 서버가 줄을 주지 않았으면 쪽 글에서 k 번째 찾은 자리 앞뒤
      if (h.t) return h.t;
      const t = (S.ptext || [])[h.p - 1] || "", lq = S.q.toLowerCase(); let i = -1;
      for (let n = 0; n <= k; n++) { i = t.toLowerCase().indexOf(lq, i + 1); if (i < 0) break; }
      return i < 0 ? t.slice(0, 120) : t.slice(Math.max(0, i - 60), i + lq.length + 80);
    }
    function findList(box) {
      if (!S.q || S.q.length < 2) { box.innerHTML = '<p class="dv-fnone">위쪽 찾기 칸에 두 글자 이상 넣으면 이 자료 전체에서 찾은 곳을 모두 보여 줍니다.</p>'; return; }
      if (!S.hits.length) { box.innerHTML = '<p class="dv-fnone">“' + esc(S.q) + '”을(를) 이 자료에서 찾지 못했습니다.</p>'; return; }
      const seen = {}, pages = new Set(S.hits.map((h) => h.p || 0));
      let html = '<p class="dv-fsum"><button type="button" class="dv-fx" data-dv="fclose" title="목록 닫기" aria-label="찾기 목록 닫기">×</button>' + S.hits.length + "곳" + (S.kind === "pdf" ? " · " + pages.size + "쪽" : "") + (S.hits.length >= 1500 ? " (앞 1,500곳까지)" : "") + "</p>";
      html += S.hits.map((h, i) => {
        if (S.kind === "pdf") { const k = seen[h.p] = (seen[h.p] === undefined ? 0 : seen[h.p] + 1); return '<button type="button" class="dv-fi' + (i === S.hitI ? " on" : "") + '" data-dv-hit="' + i + '"><b>' + h.p + '쪽</b><span>' + snip(hitText(h, k), S.q) + "</span></button>"; }
        const par = h.closest && h.closest("p,li,td,h1,h2,h3,h4,div"), t = par ? par.textContent : h.textContent;
        return '<button type="button" class="dv-fi' + (i === S.hitI ? " on" : "") + '" data-dv-hit="' + i + '"><b>' + (i + 1) + "</b><span>" + snip(t, S.q) + "</span></button>";
      }).join("");
      box.innerHTML = html;
    }
    function showFindList() {
      const tb = el.querySelector('[data-dv-st="find"]'); if (!tb) return;
      tb.classList.toggle("hidden", !S.q || S.q.length < 2);
      const side = el.querySelector(".dv-side");
      if (S.q && S.q.length >= 2) {
        if (side && side.classList.contains("hidden")) { side.classList.remove("hidden"); side.classList.toggle("dv-over", el.clientWidth <= 640); S.findOpened = true; }   // 좁으면 쪽 위에 겹쳐 띄운다
        paintSide("find");
      } else {
        if (side && S.findOpened) { side.classList.add("hidden"); side.classList.remove("dv-over"); S.findOpened = false; }
        if (S.sideTab === "find") paintSide("th");
      }
    }
    function markFindItem() {
      if (S.sideTab !== "find") return; const box = el.querySelector(".dv-slist"); if (!box) return;
      box.querySelectorAll(".dv-fi").forEach((b) => b.classList.toggle("on", +b.dataset.dvHit === S.hitI));
      const on = box.querySelector(".dv-fi.on"); if (on && (on.offsetTop < box.scrollTop || on.offsetTop > box.scrollTop + box.clientHeight - 50)) box.scrollTop = on.offsetTop - 60;
    }
    function paintSide(tab) {
      const box = el.querySelector(".dv-slist"); if (!box) return; S.sideTab = tab;
      el.querySelectorAll("[data-dv-st]").forEach((b) => b.classList.toggle("on", b.dataset.dvSt === tab));
      box.classList.toggle("dv-flist", tab === "find");
      if (tab === "find") findList(box);
      else if (tab === "toc") box.innerHTML = S.toc.map((t) => '<button type="button" class="dv-toc l' + Math.min(4, t[0]) + '" data-dv-go="' + t[2] + '">' + esc(t[1]) + "<small>" + t[2] + "</small></button>").join("");
      else if (tab === "bm") { const a = A(); box.innerHTML = (a.bm.length ? a.bm.slice().sort((x, y) => x.p - y.p).map((b) => '<button type="button" class="dv-toc" data-dv-go="' + b.p + '">🔖 ' + esc(b.label || b.p + "쪽") + "<small>" + b.p + "</small></button>").join("") : '<p class="sh-muted">🔖 로 쪽을 표시해 두면 여기서 바로 가요.</p>') + (a.memo.length ? '<b class="dv-sh">📝 메모</b>' + a.memo.slice().sort((x, y) => x.p - y.p).map((m) => '<button type="button" class="dv-toc" data-dv-go="' + m.p + '">' + esc((m.text || "(빈 메모)").slice(0, 40)) + "<small>" + m.p + "</small></button>").join("") : "") + (a.hl.length ? '<b class="dv-sh">🖍 형광펜</b>' + a.hl.slice().sort((x, y) => x.p - y.p).map((h) => '<button type="button" class="dv-toc hl-' + h.color + '" data-dv-go="' + h.p + '">' + esc(h.text.slice(0, 40)) + "<small>" + h.p + "</small></button>").join("") : ""); }
      else {
        box.innerHTML = S.sizes.map((s, i) => '<button type="button" class="dv-th" data-dv-go="' + (i + 1) + '" style="--ar:' + (s[0] / s[1]) + '"><img alt="" loading="lazy" data-src="' + esc(o.url("page", { p: i + 1, w: 200 })) + '"><span>' + (i + 1) + "</span></button>").join("");
        const io = new IntersectionObserver((ents) => ents.forEach((en) => { if (en.isIntersecting) { const im = en.target.querySelector("img"); if (im.dataset.src) { im.src = im.dataset.src; delete im.dataset.src; } io.unobserve(en.target); } }), { root: box, rootMargin: "300px" });
        box.querySelectorAll(".dv-th").forEach((b) => io.observe(b)); markThumb();
      }
    }
    function markThumb() { const box = el.querySelector(".dv-slist"); if (!box || S.sideTab !== "th") return; box.querySelectorAll(".dv-th").forEach((b) => b.classList.toggle("on", +b.dataset.dvGo === S.page)); const on = box.querySelector(".dv-th.on"); if (on && (on.offsetTop < box.scrollTop || on.offsetTop > box.scrollTop + box.clientHeight - 60)) box.scrollTop = on.offsetTop - 40; }

    /* 주석 그리기(형광펜·메모·책갈피) */
    function paintAnn() {
      const a = A();
      if (S.kind === "pdf") {
        el.querySelectorAll(".dv-pg").forEach((pg) => {
          const p = +pg.dataset.p, L = pg.querySelector(".dv-hll");
          L.innerHTML = a.hl.filter((h) => h.p === p).map((h) => h.rects.map((r) => '<div class="dv-hl hl-' + h.color + (h.note ? " noted" : "") + '" data-id="' + h.id + '" style="left:' + r[0] * 100 + "%;top:" + r[1] * 100 + "%;width:" + r[2] * 100 + "%;height:" + r[3] * 100 + '%" title="' + esc(h.note || h.text.slice(0, 80)) + '"></div>').join("")).join("") +
            a.memo.filter((m) => m.p === p).map((m) => '<button type="button" class="dv-pin" data-id="' + m.id + '" style="left:' + m.x * 100 + "%;top:" + m.y * 100 + '%" title="' + esc(m.text || "메모") + '">📝</button>').join("");
          pg.classList.toggle("bm", a.bm.some((b) => b.p === p));
        });
        if (S.sideTab === "bm") paintSide("bm");
      } else if (S.docEl) markDocHl(a);
      if (o.onAnn) o.onAnn(a);
    }
    function memoEdit(id, fresh) {
      const a = A(), m = a.memo.filter((x) => x.id === id)[0]; if (!m) return;
      const t = prompt((fresh ? "새 메모" : "메모") + " — " + label(m.p) + "\n(비우고 확인하면 지워요)", m.text || "");
      if (t === null) { if (fresh && !m.text) { a.memo = a.memo.filter((x) => x.id !== id); saveA(a); paintAnn(); } return; }
      if (!t.trim()) a.memo = a.memo.filter((x) => x.id !== id); else { m.text = t.trim(); m.t = Date.now(); }
      saveA(a); paintAnn();
    }
    function hlMenu(id, e) {
      const a = A(), h = a.hl.filter((x) => x.id === id)[0]; if (!h) return;
      const c = prompt("형광펜: “" + h.text.slice(0, 120) + "”\n메모를 적거나 고치세요. 지우려면 -  한 글자만 넣으세요.", h.note || "");
      if (c === null) return;
      if (c.trim() === "-") a.hl = a.hl.filter((x) => x.id !== id); else h.note = c.trim();
      saveA(a); paintAnn();
    }
    function addHl(color, note) {
      const s = curSel(); if (!s) return null; const text = String(s).trim(); const a = A();
      if (S.kind === "pdf") {
        const rng = s.getRangeAt(0), rects = Array.from(rng.getClientRects()).filter((r) => r.width > 1 && r.height > 1), byP = {};
        rects.forEach((r) => { const cx = r.left + r.width / 2, cy = r.top + r.height / 2; el.querySelectorAll(".dv-pg").forEach((pg) => { const b = pg.getBoundingClientRect(); if (cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom) (byP[pg.dataset.p] = byP[pg.dataset.p] || []).push([(r.left - b.left) / b.width, (r.top - b.top) / b.height, r.width / b.width, r.height / b.height]); }); });
        Object.keys(byP).forEach((p) => a.hl.push({ id: uid(), p: +p, rects: byP[p], text: text, color: color, note: note || "", t: Date.now() }));
        if (!Object.keys(byP).length) return null;
      } else a.hl.push({ id: uid(), p: 0, text: text.slice(0, 2000), color: color, note: note || "", t: Date.now() });
      saveA(a); s.removeAllRanges(); popHide(); paintAnn(); return text;
    }
    function selPage() {
      const s = curSel(); if (!s) return S.page || 0;
      const n = s.anchorNode && (s.anchorNode.nodeType === 3 ? s.anchorNode.parentNode : s.anchorNode); const pg = n && n.closest && n.closest(".dv-pg");
      return pg ? +pg.dataset.p : S.kind === "pdf" ? S.page : 0;
    }

    /* 찾기 — PDF 는 서버가 전 쪽에서 글자 자리를 정확히 찾는다(op=search) → 지금 쪽부터 차례로, 찾은 글자 위에 칠하고 그 자리로 옮긴다.
       이 자료에 없으면 [다른 자료에서 찾기] (또는 '다른 자료도'를 켜 두면 늘) — 결과는 o.onSearchOther 가 옆 칸에 모은다. */
    async function find(q) {
      S.q = q; S.hits = []; S.hitI = -1; const tok = S.findTok = (S.findTok || 0) + 1;
      if (q.length < 2) { paintHits(); if (o.onSearchOther) o.onSearchOther("", false); return; }
      const lq = q.toLowerCase();
      if (S.kind === "pdf") {
        paintHits(true);
        let hits = null;
        try { hits = ((await o.json("search", { q: q })) || {}).hits || []; } catch (e) { hits = null; }
        if (tok !== S.findTok || S.destroyed) return;
        if (hits === null) { hits = []; (S.ptext || []).forEach((t, i) => { if (t.toLowerCase().indexOf(lq) >= 0) hits.push([i + 1, null]); }); }   // 서버 찾기가 안 되면 쪽 글로
        S.hits = hits.map((h) => ({ p: h[0], r: h[1], t: h[2] || "" }));
        const from = S.hits.findIndex((h) => h.p >= S.page); S.hitI = (from < 0 ? 0 : from) - 1;   // 지금 보는 쪽부터
      }
      else if (S.docEl) { markDocFind(q); S.hits = Array.from(S.docEl.querySelectorAll("mark.dv-f")); }
      else if (S.sheetEl) { S.sheetEl.querySelectorAll("td").forEach((td) => { const on = td.textContent.toLowerCase().indexOf(lq) >= 0; td.classList.toggle("dv-fh", on); if (on) S.hits.push(td); }); }
      paintHits(); if (S.hits.length) stepHit(1);
      showFindList();
      if (o.onSearchOther && !S.quiet) o.onSearchOther(q, !S.hits.length);   // AI 가 근거를 칠할 때(quiet)는 찾기 칸을 건드리지 않는다
      S.quiet = false;
    }
    function paintHits(busy) {
      const n = el.querySelector(".dv-hn");
      if (n) {
        const none = S.q && S.q.length >= 2 && !S.hits.length && !busy;
        n.innerHTML = !S.q || S.q.length < 2 ? "" : busy ? "찾는 중…" : S.hits.length ? (S.hitI + 1) + " / " + S.hits.length + (S.kind === "pdf" && S.hits[S.hitI] ? " · " + S.hits[S.hitI].p + "쪽" : "") : "이 자료엔 없음";
        n.classList.toggle("none", !!none);
      }
      if (S.kind !== "pdf") return;
      // 찾은 글자 위에 칠하기(쪽마다 .dv-fl 층) — 지금 고른 곳은 진하게
      const byP = {}; S.hits.forEach((h, i) => { if (h.r) (byP[h.p] = byP[h.p] || []).push([h.r, i === S.hitI]); });
      el.querySelectorAll(".dv-pg").forEach((pg) => { const L = pg.querySelector(".dv-fl"); if (!L) return; const hs = byP[pg.dataset.p] || []; L.innerHTML = hs.map((x) => '<i class="dv-fm' + (x[1] ? " cur" : "") + '" style="left:' + x[0][0] * 100 + "%;top:" + x[0][1] * 100 + "%;width:" + (x[0][2] - x[0][0]) * 100 + "%;height:" + (x[0][3] - x[0][1]) * 100 + '%"></i>').join(""); });
      const lq = (S.q || "").toLowerCase(), noRect = S.hits.length && !S.hits[0].r;   // 자리 정보가 없을 때만 줄 단위로
      el.querySelectorAll(".dv-tl span").forEach((s) => s.classList.toggle("dv-hit", !!noRect && lq.length >= 2 && s.textContent.toLowerCase().indexOf(lq) >= 0));
    }
    function stepHit(d) {
      if (!S.hits.length) return; S.hitI = (S.hitI + d + S.hits.length) % S.hits.length; const h = S.hits[S.hitI];
      if (h && h.p) gotoHit(h);
      else { el.querySelectorAll(".dv-fcur").forEach((x) => x.classList.remove("dv-fcur")); h.classList.add("dv-fcur"); h.scrollIntoView({ block: "center" }); }
      paintHits(); markFindItem();
    }
    function gotoHit(h) {
      const pg = el.querySelector('.dv-pg[data-p="' + h.p + '"]'); if (!pg || !S.scroll) return;
      const y = pg.offsetTop + (h.r ? h.r[1] * pg.offsetHeight : 0) - S.scroll.clientHeight * 0.32;
      const x = h.r && S.scroll.scrollWidth > S.scroll.clientWidth + 4 ? pg.offsetLeft + h.r[0] * pg.offsetWidth - S.scroll.clientWidth * 0.3 : S.scroll.scrollLeft;   // 확대해 옆으로 넘치면 가로로도 찾은 곳에
      S.scroll.scrollTo({ top: Math.max(0, y), left: Math.max(0, x), behavior: Math.abs(h.p - S.page) > 3 ? "auto" : "smooth" });
      S.page = h.p; const pn = el.querySelector(".dv-pn"); if (pn) pn.value = h.p; markThumb();
      if (o.onLocate) o.onLocate(where());
    }

    /* 공용 동작 */
    function prefs(k, v) { if (!window.TK) return; const p = TK.store.get("dv.prefs", {}); p[k] = v; TK.store.set("dv.prefs", p); }
    function bindCommon() {
      el.onclick = (e) => {
        const g = e.target.closest("[data-dv-go]"); if (g) { goto(+g.dataset.dvGo); return; }
        const st = e.target.closest("[data-dv-st]"); if (st) { paintSide(st.dataset.dvSt); return; }
        const fh = e.target.closest("[data-dv-hit]"); if (fh) { S.hitI = +fh.dataset.dvHit - 1; stepHit(1); return; }
        const hc = e.target.closest("[data-dv-hl]"); if (hc) { addHl(hc.dataset.dvHl); return; }
        const ac = e.target.closest("[data-dv-act]"); if (ac) {
          const s = curSel(); const text = s ? String(s).trim() : ""; const p = selPage(); const k = ac.dataset.dvAct; if (!text) return;
          if (k === "note") { const n = prompt("이 부분에 메모 — “" + text.slice(0, 100) + "”", ""); if (n === null) return; addHl("y", n); act("note", text, p); return; }
          let rect = null; try { rect = s.getRangeAt(0).getBoundingClientRect(); } catch (er) { rect = null; }
          popHide(); act(k, text, p, rect); return;
        }
        const b = e.target.closest("[data-dv]"); if (!b) return;
        const k = b.dataset.dv;
        if (k === "prev") goto(S.page - 1); if (k === "next") goto(S.page + 1);
        if (k === "zin" || k === "zout") { const cur = pgWidth() / 780; S.zoom = Math.max(0.3, Math.min(4, Math.round((cur * (k === "zin" ? 1.2 : 1 / 1.2)) * 20) / 20)); S.fit = "zoom"; prefs("fit", "zoom"); prefs("zoom", S.zoom); layout(); }
        if (k === "zreset") { S.zoom = 1; S.fit = "zoom"; prefs("fit", "zoom"); prefs("zoom", 1); layout(); }
        if (k === "fitw") { S.fit = "width"; prefs("fit", "width"); layout(); } if (k === "fitp") { S.fit = "page"; prefs("fit", "page"); layout(); }
        if (k === "thumbs") { const sd = el.querySelector(".dv-side"); sd.classList.toggle("hidden"); prefs("thumbs", !sd.classList.contains("hidden")); setTimeout(layout, 30); }
        if (k === "memo") { S.memoMode = !S.memoMode; b.classList.toggle("on", S.memoMode); el.classList.toggle("dv-memo-mode", S.memoMode); }
        if (k === "bm") { const a = A(); const i = a.bm.findIndex((x) => x.p === S.page); if (i >= 0) a.bm.splice(i, 1); else { const lb = prompt("책갈피 이름 (" + S.page + "쪽)", (S.ptext && S.ptext[S.page - 1] || "").trim().split("\n")[0].slice(0, 40)); if (lb === null) return; a.bm.push({ p: S.page, label: lb, t: Date.now() }); } saveA(a); paintAnn(); }
        if (k === "dark") { S.dark = !S.dark; el.classList.toggle("dv-dark", S.dark); prefs("dark", S.dark); }
        if (k === "full") { const tgt = el.closest(".rr") || el; if (document.fullscreenElement) document.exitFullscreen(); else if (tgt.requestFullscreen) tgt.requestFullscreen(); }
        if (k === "hitn") stepHit(1); if (k === "hitp") stepHit(-1);
        if (k === "fclose") { const sd = el.querySelector(".dv-side"); if (sd) { if (S.findOpened || sd.classList.contains("dv-over")) { sd.classList.add("hidden"); sd.classList.remove("dv-over"); S.findOpened = false; } else paintSide("th"); } }
        if (k === "others") { const on = !((window.TK && TK.store.get("dv.prefs", {})) || {}).others; prefs("others", on); b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); if (S.q && o.onSearchOther) o.onSearchOther(S.q, !S.hits.length, true); }
      };
      const q = el.querySelector(".dv-q"); let t = null;
      if (q) { q.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => find(q.value.trim()), 260); }); q.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); stepHit(e.shiftKey ? -1 : 1); } }); }
      document.addEventListener("keydown", onKey);
    }
    function onKey(e) {
      if (e.key === "Escape" && !S.destroyed && el.querySelector(".dv-pop:not(.hidden)")) popHide();      // (v168) Esc 로 지금 뜬 드래그 메뉴 닫기
      if (S.destroyed || !el.isConnected || !el.offsetParent) return;
      const tag = (document.activeElement && document.activeElement.tagName) || "";
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f" && el.contains(document.activeElement || el) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f" && el.matches(":hover"))) { const q = el.querySelector(".dv-q"); if (q) { e.preventDefault(); q.focus(); q.select(); } return; }
      if (/INPUT|TEXTAREA|SELECT/.test(tag) || document.activeElement && document.activeElement.isContentEditable) return;
      if (!el.matches(":hover") && !el.contains(document.activeElement)) return;
      if (S.kind === "pdf") {
        if (e.key === "ArrowRight" || e.key === "PageDown") { if (e.key === "ArrowRight" || S.fit === "page") { e.preventDefault(); goto(S.page + 1); } }
        else if (e.key === "ArrowLeft" || e.key === "PageUp") { if (e.key === "ArrowLeft" || S.fit === "page") { e.preventDefault(); goto(S.page - 1); } }
        else if (e.key === "+" || e.key === "=") { e.preventDefault(); el.querySelector('[data-dv="zin"]').click(); }
        else if (e.key === "-") { e.preventDefault(); el.querySelector('[data-dv="zout"]').click(); }
        else if (e.key === "Home") { e.preventDefault(); goto(1); } else if (e.key === "End") { e.preventDefault(); goto(S.pages); }
      }
    }

    /* ------------------------------------------------------------ 글 보기(HWP·글·코드·MD) */
    function textView(text, kind) {
      S.kind = "doc"; S.docKind = kind;
      const code = kind === "text" && /\.(py|js|ts|tsx|jsx|css|scss|java|c|h|cpp|hpp|cs|go|rs|rb|php|sh|ps1|bat|sql|r|kt|swift|vue|json|jsonl|xml|yaml|yml|toml|ini|cfg)$/i.test(o.name);
      const body = kind === "md" ? '<article class="dv-md">' + md(text) + "</article>"
        : code ? '<pre class="dv-code">' + text.split("\n").map((l, i) => '<span class="ln">' + (i + 1) + "</span>" + esc(l)).join("\n") + "</pre>"
        : '<article class="dv-txt' + (kind === "hwp" ? " hwp" : "") + '">' + text.replace(/\r/g, "").split(/\n/).map((p) => p.trim() ? "<p>" + esc(p) + "</p>" : "").join("") + "</article>";
      el.innerHTML = bar('<span class="dv-grp"><span class="dv-kind">' + esc(KIND_NAME[kind] || "글") + "" + '</span><button type="button" class="dv-b" data-dv="tsm" title="글자 작게">가−</button><button type="button" class="dv-b" data-dv="tlg" title="글자 크게">가＋</button></span>') +
        '<div class="dv-body"><div class="dv-scroll dv-docw" tabindex="0">' + body + "</div></div>" + selPop();
      S.scroll = el.querySelector(".dv-scroll"); S.docEl = S.scroll.firstElementChild; S.selDoc = document;
      const fz = (window.TK && TK.store.get("dv.prefs", {}).tz) || 1; S.scroll.style.setProperty("--tz", fz);
      bindCommon(); paintAnn();
      el.addEventListener("click", (e) => { const b = e.target.closest("[data-dv]"); if (!b) return; if (b.dataset.dv === "tsm" || b.dataset.dv === "tlg") { const cur = +S.scroll.style.getPropertyValue("--tz") || 1; const n = Math.max(0.7, Math.min(1.8, cur + (b.dataset.dv === "tlg" ? 0.1 : -0.1))); S.scroll.style.setProperty("--tz", n); prefs("tz", n); } const hm = e.target.closest("mark.dv-hm"); if (hm && !curSel()) hlMenu(hm.dataset.id, e); });
      S.scroll.addEventListener("mouseup", (e) => setTimeout(() => { const s = curSel(); if (!s || !S.scroll.contains(s.anchorNode)) { if (!e.target.closest(".dv-pop")) popHide(); return; } popAt(e.clientX, e.clientY); }, 10));
      S.scroll.addEventListener("scroll", () => { clearTimeout(S.lt); S.lt = setTimeout(() => { if (o.onLocate) o.onLocate(where()); }, 400); }, { passive: true });
      const pf = S.pendingFind; if (pf) { S.pendingFind = null; setTimeout(() => api.find(pf), 60); }
    }
    function unwrap(root, sel) { root.querySelectorAll(sel).forEach((m) => m.replaceWith(document.createTextNode(m.textContent))); root.normalize(); }
    function wrapText(root, q, mk, all) {
      if (!q) return 0; const lq = q.toLowerCase(); let n = 0;
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), nodes = []; while (w.nextNode()) nodes.push(w.currentNode);
      for (const node of nodes) {
        let cur = node;
        while (cur) { const i = cur.nodeValue.toLowerCase().indexOf(lq); if (i < 0) break; const mid = cur.splitText(i); const rest = mid.splitText(q.length); const m = mk(); m.textContent = mid.nodeValue; mid.replaceWith(m); n++; if (!all || n > 500) return n; cur = rest; }
      }
      return n;
    }
    function markDocHl(a) {
      unwrap(S.docEl, "mark.dv-hm");
      a.hl.forEach((h) => { const t = h.text.length > 300 ? h.text.slice(0, 300) : h.text; wrapText(S.docEl, t, () => { const m = document.createElement("mark"); m.className = "dv-hm hl-" + h.color + (h.note ? " noted" : ""); m.dataset.id = h.id; m.title = h.note || ""; return m; }, false); });
    }
    function markDocFind(q) { unwrap(S.docEl, "mark.dv-f"); if (q.length >= 2) wrapText(S.docEl, q, () => { const m = document.createElement("mark"); m.className = "dv-f"; return m; }, true); }

    /* ------------------------------------------------------------ HTML(스크립트 없이) */
    function htmlView(html) {
      S.kind = "html";
      el.innerHTML = bar('<span class="dv-grp"><span class="dv-kind">웹 문서 · 스크립트 꺼짐</span><button type="button" class="dv-b" data-dv="astext2">글만</button></span>') + '<div class="dv-body"><iframe class="dv-frame" sandbox="allow-same-origin" referrerpolicy="no-referrer" title="' + esc(o.name) + '"></iframe></div>' + selPop();
      const f = el.querySelector("iframe"); f.srcdoc = html;
      f.addEventListener("load", () => {
        S.selDoc = f.contentDocument; S.docEl = f.contentDocument && f.contentDocument.body; S.scroll = f.contentDocument && f.contentDocument.scrollingElement;
        try { const st = f.contentDocument.createElement("style"); st.textContent = "mark.dv-hm{border-radius:2px}mark.hl-y{background:#fde68a}mark.hl-g{background:#bbf7d0}mark.hl-b{background:#bfdbfe}mark.hl-p{background:#fbcfe8}mark.dv-f{background:#fb923c;color:#000}"; f.contentDocument.head.appendChild(st); } catch (e) { /* 계속 */ }
        paintAnn();
        f.contentDocument.addEventListener("mouseup", (e) => setTimeout(() => { const s = curSel(); if (!s) { popHide(); return; } const r = f.getBoundingClientRect(); popAt(r.left + e.clientX, r.top + e.clientY); }, 10));
      });
      bindCommon();
      el.querySelector('[data-dv="astext2"]').addEventListener("click", () => { const d = document.createElement("div"); d.innerHTML = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ""); textView(d.innerText, "text"); });
    }

    /* ------------------------------------------------------------ 표(XLSX·CSV) */
    function sheetView(v) {
      S.kind = "sheet"; const sh = v.sheets || []; let cur = 0;
      el.innerHTML = bar('<span class="dv-grp dv-sheets">' + sh.map((s, i) => '<button type="button" class="dv-b dv-tab' + (i ? "" : " on") + '" data-dv-sh="' + i + '">' + esc(s.name) + "</button>").join("") + '</span><span class="dv-grp">' + (/csv|tsv/.test(v.ext) ? "" : '<button type="button" class="dv-b" data-dv="print" title="엑셀 인쇄 모양(PDF)으로 보기">🖨 인쇄 모양</button>') + "</span>") + '<div class="dv-body"><div class="dv-scroll dv-sheet" tabindex="0"></div></div>' + selPop();
      S.scroll = el.querySelector(".dv-scroll"); S.sheetEl = S.scroll; S.selDoc = document;
      const paint = () => { const s = sh[cur] || { rows: [] }; const cols = Math.max(0, ...s.rows.map((r) => r.length)); const colName = (i) => { let n = "", x = i + 1; while (x) { n = String.fromCharCode(65 + (x - 1) % 26) + n; x = Math.floor((x - 1) / 26); } return n; };
        S.scroll.innerHTML = s.rows.length ? '<table class="dv-tbl"><thead><tr><th></th>' + Array.from({ length: cols }, (_, i) => "<th>" + colName(i) + "</th>").join("") + "</tr></thead><tbody>" + s.rows.map((r, i) => "<tr><th>" + (i + 1) + "</th>" + Array.from({ length: cols }, (_, j) => "<td>" + esc(r[j] == null ? "" : r[j]) + "</td>").join("") + "</tr>").join("") + "</tbody></table>" + (s.more ? '<p class="sh-muted">앞 3,000줄만 보여요 — 전체는 원본에서.</p>' : "") : '<p class="sh-muted">빈 시트예요.</p>'; if (S.q) find(S.q); };
      paint(); bindCommon();
      el.addEventListener("click", async (e) => {
        const t = e.target.closest("[data-dv-sh]"); if (t) { cur = +t.dataset.dvSh; el.querySelectorAll("[data-dv-sh]").forEach((b) => b.classList.toggle("on", b === t)); paint(); return; }
        const p = e.target.closest('[data-dv="print"]'); if (p) { p.textContent = "만드는 중…"; await o.json("view", { print: 1 }); const tm = setInterval(async () => { if (S.destroyed) { clearInterval(tm); return; } const n = await o.json("view").catch(() => ({})); if (n.pdf) { clearInterval(tm); pdfView(n.pdf); } else if (n.print_state === "error") { clearInterval(tm); p.textContent = "인쇄 모양 실패"; } }, 2500); S.timers.push(tm); }
      });
      S.scroll.addEventListener("mouseup", (e) => setTimeout(() => { const s = curSel(); if (!s || !S.scroll.contains(s.anchorNode)) { popHide(); return; } popAt(e.clientX, e.clientY); }, 10));
    }

    /* ------------------------------------------------------------ 그림 */
    function imageView() {
      S.kind = "image"; let z = 1, rot = 0, fit = true;
      el.innerHTML = bar('<span class="dv-grp"><button type="button" class="dv-b" data-dv="izo">−</button><button type="button" class="dv-b dv-zv" data-dv="ifit">맞춤</button><button type="button" class="dv-b" data-dv="izi">＋</button><button type="button" class="dv-b" data-dv="irot" title="90° 돌리기">⟳</button><button type="button" class="dv-b" data-dv="memo" title="그림에 메모 핀">📝</button></span>') + '<div class="dv-body"><div class="dv-scroll dv-imgw" tabindex="0"><div class="dv-imgbox"><img alt="' + esc(o.name) + '" src="' + esc(o.url("file", { inline: 1 })) + '" draggable="false"><div class="dv-hll"></div></div></div></div>';
      S.scroll = el.querySelector(".dv-scroll"); const box = el.querySelector(".dv-imgbox"), img = box.querySelector("img");
      const apply = () => { box.style.transform = "rotate(" + rot + "deg)"; img.style.width = fit ? "" : (img.naturalWidth * z) + "px"; img.style.maxWidth = fit ? "100%" : "none"; img.style.maxHeight = fit ? "calc(100% - 4px)" : "none"; el.querySelector(".dv-zv").textContent = fit ? "맞춤" : Math.round(z * 100) + "%"; };
      const pins = () => { const a = A(); box.querySelector(".dv-hll").innerHTML = a.memo.map((m) => '<button type="button" class="dv-pin" data-id="' + m.id + '" style="left:' + m.x * 100 + "%;top:" + m.y * 100 + '%" title="' + esc(m.text) + '">📝</button>').join(""); if (o.onAnn) o.onAnn(a); };
      S.paintPins = pins; pins();
      el.onclick = (e) => {
        const pin = e.target.closest(".dv-pin"); if (pin) { memoEdit(pin.dataset.id); pins(); return; }
        const b = e.target.closest("[data-dv]");
        if (!b) { if (S.memoMode && e.target === img) { const r = img.getBoundingClientRect(); const a = A(); const m = { id: uid(), p: 0, x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, text: "", t: Date.now() }; a.memo.push(m); saveA(a); S.memoMode = false; el.querySelector('[data-dv="memo"]').classList.remove("on"); pins(); memoEdit(m.id, true); pins(); } return; }
        const k = b.dataset.dv;
        if (k === "izi" || k === "izo") { if (fit) { z = img.clientWidth / (img.naturalWidth || 1); fit = false; } z = Math.max(0.05, Math.min(8, z * (k === "izi" ? 1.25 : 0.8))); apply(); }
        if (k === "ifit") { fit = !fit; z = 1; apply(); } if (k === "irot") { rot = (rot + 90) % 360; apply(); }
        if (k === "memo") { S.memoMode = !S.memoMode; b.classList.toggle("on", S.memoMode); }
        if (k === "dark") { S.dark = !S.dark; el.classList.toggle("dv-dark", S.dark); } if (k === "full") { const tgt = el.closest(".rr") || el; if (document.fullscreenElement) document.exitFullscreen(); else tgt.requestFullscreen && tgt.requestFullscreen(); }
      };
      S.scroll.addEventListener("wheel", (e) => { if (!e.ctrlKey) return; e.preventDefault(); if (fit) { z = img.clientWidth / (img.naturalWidth || 1); fit = false; } z = Math.max(0.05, Math.min(8, z * (e.deltaY < 0 ? 1.1 : 0.9))); apply(); }, { passive: false });
      el.querySelector(".dv-find").classList.add("hidden");
    }

    /* ------------------------------------------------------------ 소리·영상 */
    function mediaView() {
      const vid = S.kind === "video";
      el.innerHTML = bar('<span class="dv-grp">' + [0.75, 1, 1.25, 1.5, 2].map((r) => '<button type="button" class="dv-b' + (r === 1 ? " on" : "") + '" data-dv-rate="' + r + '">' + r + "×</button>").join("") + '</span><span class="dv-grp"><button type="button" class="dv-b" data-dv-skip="-10">⏪ 10초</button><button type="button" class="dv-b" data-dv-skip="10">10초 ⏩</button><button type="button" class="dv-b" data-dv="tmemo">📍 지금 메모</button><button type="button" class="dv-b" data-dv="tclip">📌 이 구간 담기</button></span>') +
        '<div class="dv-body"><div class="dv-scroll dv-media"><' + (vid ? "video" : "audio") + ' controls preload="metadata" src="' + esc(o.url("file", { inline: 1 })) + '"></' + (vid ? "video" : "audio") + '><div class="dv-tmemos"></div></div></div>';
      const m = el.querySelector(vid ? "video" : "audio"); S.media = m;
      const paint = () => { const a = A(); el.querySelector(".dv-tmemos").innerHTML = "<h4>📍 시각 메모 " + a.memo.length + "</h4>" + (a.memo.length ? a.memo.slice().sort((x, y) => x.at - y.at).map((x) => '<div class="dv-tm"><button type="button" class="dv-b" data-dv-seek="' + x.at + '">' + fmtTime(x.at) + "</button><span>" + esc(x.text) + '</span><button type="button" class="icon-mini" data-dv-tdel="' + x.id + '" aria-label="지우기">✕</button></div>').join("") : '<p class="sh-muted">듣거나 보다가 [📍 지금 메모]를 누르면 그 시각이 메모와 함께 남고, 누르면 그 자리로 가요.</p>'); if (o.onAnn) o.onAnn(a); };
      paint();
      el.onclick = (e) => {
        const r = e.target.closest("[data-dv-rate]"); if (r) { m.playbackRate = +r.dataset.dvRate; el.querySelectorAll("[data-dv-rate]").forEach((b) => b.classList.toggle("on", b === r)); return; }
        const sk = e.target.closest("[data-dv-skip]"); if (sk) { m.currentTime = Math.max(0, m.currentTime + +sk.dataset.dvSkip); return; }
        const se = e.target.closest("[data-dv-seek]"); if (se) { m.currentTime = +se.dataset.dvSeek; m.play(); return; }
        const td = e.target.closest("[data-dv-tdel]"); if (td) { const a = A(); a.memo = a.memo.filter((x) => x.id !== td.dataset.dvTdel); saveA(a); paint(); return; }
        const b = e.target.closest("[data-dv]"); if (!b) return;
        if (b.dataset.dv === "tmemo") { const at = m.currentTime; const t = prompt(fmtTime(at) + " 메모", ""); if (!t) return; const a = A(); a.memo.push({ id: uid(), at: at, text: t.trim(), t: Date.now() }); saveA(a); paint(); }
        if (b.dataset.dv === "tclip") { const at = m.currentTime; act("collect", "[" + fmtTime(Math.max(0, at - 30)) + "~" + fmtTime(at) + "] " + (prompt("이 구간에서 기억할 내용(선택)", "") || "(구간)"), 0); }
        if (b.dataset.dv === "full") { if (document.fullscreenElement) document.exitFullscreen(); else (vid ? m : el).requestFullscreen && (vid ? m : el).requestFullscreen(); }
        if (b.dataset.dv === "dark") { S.dark = !S.dark; el.classList.toggle("dv-dark", S.dark); }
      };
      el.querySelector(".dv-find").classList.add("hidden");
    }

    /* ------------------------------------------------------------ 지금 보는 곳(AI 맥락) */
    function where() {
      const s = curSel(); const sel = s ? String(s).trim().slice(0, 3000) : "";
      if (S.kind === "pdf") {
        const t = S.ptext || [], p = S.page;
        const near = (t[p - 1] || "") + (t[p] ? "\n\n[p." + (p + 1) + "]\n" + t[p].slice(0, 1500) : "");
        return { kind: "pdf", page: p, pages: S.pages, label: label(p) + " / " + S.pages + "쪽", text: (near || "").slice(0, 6000), sel: sel };
      }
      if (S.media) { const a = A(); const at = S.media.currentTime || 0; return { kind: S.kind, label: o.name + " " + fmtTime(at), text: a.memo.filter((m) => Math.abs(m.at - at) < 300).map((m) => fmtTime(m.at) + " " + m.text).join("\n"), sel: sel, at: at }; }
      if (S.kind === "doc" || S.kind === "sheet") {
        const sr = S.scroll.getBoundingClientRect(); let out = "";
        const els = S.kind === "sheet" ? S.scroll.querySelectorAll("tr") : S.docEl.children.length > 3 ? S.docEl.children : S.docEl.querySelectorAll("p, li, h1, h2, h3, h4, pre, span.ln");
        for (const x of els) { const r = x.getBoundingClientRect(); if (r.bottom > sr.top - 40 && r.top < sr.bottom + 200) { out += (x.innerText || x.textContent || "") + "\n"; if (out.length > 6000) break; } }
        const pct = S.scroll.scrollHeight > S.scroll.clientHeight ? Math.round(S.scroll.scrollTop / (S.scroll.scrollHeight - S.scroll.clientHeight) * 100) : 0;
        return { kind: S.kind, label: o.name + " (" + pct + "% 지점)", text: out.trim(), sel: sel };
      }
      if (S.kind === "html" && S.docEl) return { kind: "html", label: o.name, text: (S.docEl.innerText || "").slice(0, 6000), sel: sel };
      return { kind: S.kind, label: o.name, text: "", sel: sel };
    }
  }

  window.DOCVIEW = { mount: mount, kindName: KIND_NAME };
})();
