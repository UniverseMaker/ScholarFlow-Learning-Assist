/* rui-app.js — research-ui 를 이 앱에 잇는 층 (v119).
   · 새 테마(기본): <html data-app-theme="rui">. data-theme·data-mode·data-layout 은 새 테마 값으로 고정한다.
   · 이전 테마: 위 속성을 떼고 새 테마 CSS 를 끈다(media="not all"). v118 화면과 같다.
   · 사용자의 예전 표시 설정(테마·밝기·화면 틀)은 saved 에 그대로 남긴다 — 새 테마가 덮어쓰지 않는다.
   저장은 기기별 localStorage(rui_prefs). 서버 데이터에는 아무것도 쓰지 않는다. */
(function () {
  "use strict";
  var r = document.documentElement;
  var A = window.RUIAPP = {
    saved: { theme: null, mode: null, layout: null },
    on: function () { return !RUI.get().legacy; },
    /* 저장된 표시 설정을 기억한다(값이 있는 것만) */
    remember: function (d) { if (!d) return; ["theme", "mode", "layout"].forEach(function (k) { if (d[k]) A.saved[k] = d[k]; }); },
    /* 현재 상태를 html 속성에 입힌다. 첫 화면 전에도 불린다. */
    enforce: function () {
      var links = document.querySelectorAll("link[data-rui-css]"), on = A.on(), i;
      for (i = 0; i < links.length; i++) links[i].media = on ? "all" : "not all";
      if (!on) {
        r.removeAttribute("data-app-theme"); r.removeAttribute("data-rui-theme"); r.removeAttribute("data-rui-mode"); r.removeAttribute("data-rui-palette"); r.removeAttribute("data-rui-layout");
        return false;
      }
      RUI.apply();
      var p = RUI.get();
      r.setAttribute("data-app-theme", "rui");
      r.setAttribute("data-theme", "white");
      r.setAttribute("data-mode", RUI.mode(p));
      r.setAttribute("data-layout", p.layout === "top" ? "apptop" : "app");
      r.setAttribute("data-shell", "app");
      r.setAttribute("data-ui", "rui");
      return true;
    },
    /* 앱의 setDisplay 패치를 새 테마 설정으로 돌린다. 나머지(글자 크기·폭·글꼴)는 앱이 그대로 처리한다. */
    intercept: function (patch) {
      var o = Object.assign({}, patch), q = {};
      if (o.mode) q.mode = o.mode;
      if (o.layout === "app" || o.layout === "apptop") q.layout = o.layout === "apptop" ? "top" : "side";
      delete o.mode; delete o.layout; delete o.theme;
      if (Object.keys(q).length) RUI.set(q);
      return o;
    },
    toLegacy: function () { RUI.set({ legacy: true }); location.reload(); },
    toNew: function () { RUI.set({ legacy: false }); location.reload(); },
    /* 화면 설정 카드를 그린다. 새 테마면 RUI.picker, 이전 테마면 돌아오는 버튼. */
    mountSettings: function () {
      var box = document.getElementById("ruiSettings"); if (!box) return;
      if (A.on()) {
        var draw = function (n) { RUI.picker(box, { legacy: A.toLegacy, unified: { linked: n } }); };
        draw(A.linked || 0);
        if (A.linked == null && window.HUBLINK && HUBLINK.isLocal()) { A.linked = 0; fetch("hub/links", { credentials: "same-origin", cache: "no-store" }).then(function (r) { return r.json(); }).then(function (j) { A.linked = ((j && j.data) || []).filter(function (x) { return x.linked; }).length; if (A.linked && document.querySelector("#ruiSettings .pick")) draw(A.linked); }).catch(function () { /* 연동 없음 */ }); }
      }
      else {
        box.innerHTML = '<div class="set-row"><span class="set-label">새 테마<br><span class="set-desc" style="margin:0">지금은 이전 테마로 보고 있어요</span></span><button type="button" class="ghost-btn" id="ruiToNew">새 테마로 돌아가기</button></div>';
        document.getElementById("ruiToNew").onclick = A.toNew;
      }
    }
  };
  /* 제목 앞 이모지를 새 테마에서만 뗀다(규칙: 제목에 이모지를 쓰지 않는다). 글·문서 내용은 건드리지 않는다. */
  var EMO = /^[\s\u{FE0F}\u{200D}\u{20E3}\p{Extended_Pictographic}]+/u, queued = false;
  /* G4: 글자 없이 기호만 있는 버튼은 글꼴마다 기준선이 달라 어긋난다. 같은 뜻의 SVG 로 바꾼다 */
  var P_X = "M6 6l12 12M18 6L6 18", P_UP = "M6 15l6-6 6 6", P_DOWN = "M6 9l6 6 6-6", P_PLUS = "M12 5v14M5 12h14", P_MIC = "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3",
    P_STAR = "M12 3l2.8 5.8 6.2.9-4.5 4.4 1.1 6.3L12 17.5l-5.6 3 1.1-6.3L3 9.700l6.200-.9z";
  var SYM = { "\u00d7": P_X, "\u2715": P_X, "\u2716": P_X, "\u22ef": "M6 12h.01M12 12h.01M18 12h.01", "\u2026": "M6 12h.01M12 12h.01M18 12h.01", "\uff0b": P_PLUS, "+": P_PLUS, "\uff0d": "M5 12h14", "\u2212": "M5 12h14",
    "\u25b2": P_UP, "\u25b4": P_UP, "\u25bc": P_DOWN, "\u25be": P_DOWN, "\u2606": P_STAR, "\u2605": P_STAR, "\ud83c\udf99": P_MIC, "\ud83c\udfa4": P_MIC, "\u2191": "M12 19V5M6 11l6-6 6 6", "\u2193": "M12 5v14M6 13l6 6 6-6", "\u21bb": "M20 12a8 8 0 1 1-2.300-5.700M20 3v5h-5" };
  function symbol(b) {
    if (b.children.length) return;
    var t = (b.textContent || "").replace(/\ufe0f/g, "").trim(), d = SYM[t];
    if (!d) return;
    if (!b.getAttribute("aria-label")) b.setAttribute("aria-label", b.title || "버튼");
    b.setAttribute("data-rui-center", "");
    b.setAttribute("data-rui-sym", t);
    b.innerHTML = '<svg class="i" viewBox="0 0 24 24" width="16" height="16" fill="' + (t === "\u2605" ? "currentColor" : "none") + '" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + d + '"/></svg>';
  }
  function strip() {
    queued = false;
    var bs = document.querySelectorAll("button:not([data-rui-sym]), button[data-rui-sym]:not(:has(svg))"), k;
    for (k = 0; k < bs.length; k++) if (!bs[k].closest("[contenteditable],.rp-paper,.ss-s")) symbol(bs[k]);
    var hs = document.querySelectorAll("h1,h2,h3,h4,.view-title,.set-h3,.ll-t1 b,.lib2-facets h4,button,a.ghost-btn,summary"), i, n;   // G4: 글이 있는 버튼 앞의 이모지도 뺀다
    for (i = 0; i < hs.length; i++) {
      if (hs[i].closest("[contenteditable],.rp-paper,.ss-s,.rr-msg,.md,.lib2-reader")) continue;
      n = hs[i].firstChild;
      if (n && n.nodeType === 3 && EMO.test(n.nodeValue)) { var v = n.nodeValue.replace(EMO, ""); if (v.trim()) n.nodeValue = v; }
    }
  }
  A.watchTitles = function () {
    if (!A.on() || !window.MutationObserver) return;
    var run = function () { if (queued) strip(); };   // 가려진 탭은 requestAnimationFrame 이 멈춘다
    new MutationObserver(function () { if (!queued) { queued = true; requestAnimationFrame(run); setTimeout(run, 200); } }).observe(document.body, { childList: true, subtree: true, characterData: true });
    strip();
  };
  document.addEventListener("DOMContentLoaded", A.watchTitles);
  document.addEventListener("rui:change", function () {
    if (!A.on()) return;
    A.enforce();
    if (typeof window.applyDisplay === "function") window.applyDisplay({});
    if (document.querySelector("#ruiSettings .pick")) A.mountSettings();
  });
})();
