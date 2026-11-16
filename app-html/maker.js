(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const esc = (t) => String(t == null ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  function view(nav, title, desc) {
    const host = document.querySelector(".content");
    const sec = h("section", "hidden"); sec.id = nav + "Area"; sec.dataset.view = nav;
    const card = h("div", "card ins-card");
    const head = h("div", "rec-head"); head.appendChild(h("h2", "", title)); card.appendChild(head);
    if (desc) card.appendChild(h("p", "hint", desc));
    const body = h("div", "ins-body"); card.appendChild(body);
    sec.appendChild(card); host.appendChild(sec);
    return { area: sec, body: body, card: card };
  }

  /* =======================================================================
   * 3. 📘 도움말 — help/index.json + *.md
   * ===================================================================== */
  const HP = { index: null, cache: {}, cur: "start" };
  function md(src) {
    const lines = String(src || "").replace(/\r/g, "").split("\n");
    let out = "", i = 0, list = null;
    const inline = (t) => esc(t)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<i>$2</i>")
      .replace(/\[([^\]]+)\]\(#help:([a-z0-9-]+)\)/g, '<a href="#help:$2" data-help="$2">$1</a>')
      .replace(/\[([^\]]+)\]\(((?:help|library)\/[^)\s]+)\)/g, '<a href="$2" download>$1</a>')
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    const closeList = () => { if (list) { out += "</" + list + ">"; list = null; } };
    const slugId = (t) => "h-" + t.replace(/<[^>]+>/g, "").trim().toLowerCase().replace(/[^0-9a-z가-힣]+/g, "-").slice(0, 40);
    while (i < lines.length) {
      const l = lines[i];
      if (/^```/.test(l)) { closeList(); let code = ""; i++; while (i < lines.length && !/^```/.test(lines[i])) { code += lines[i] + "\n"; i++; } i++; out += "<pre><code>" + esc(code) + "</code></pre>"; continue; }
      if (/^\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
        closeList();
        const cells = (r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        out += "<table><thead><tr>" + cells(l).map((c) => "<th>" + inline(c) + "</th>").join("") + "</tr></thead><tbody>";
        i += 2;
        while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) { out += "<tr>" + cells(lines[i]).map((c) => "<td>" + inline(c) + "</td>").join("") + "</tr>"; i++; }
        out += "</tbody></table>"; continue;
      }
      let m;
      if ((m = /^(#{1,4})\s+(.*)$/.exec(l))) { closeList(); const n = m[1].length, t = inline(m[2]); out += "<h" + n + ' id="' + slugId(t) + '">' + t + "</h" + n + ">"; i++; continue; }
      if (/^>\s?/.test(l)) { closeList(); let q = ""; while (i < lines.length && /^>\s?/.test(lines[i])) { q += lines[i].replace(/^>\s?/, "") + " "; i++; } out += "<blockquote>" + inline(q) + "</blockquote>"; continue; }
      if (/^---+\s*$/.test(l)) { closeList(); out += "<hr>"; i++; continue; }
      if ((m = /^\s*[-*]\s+(\[[ x]\]\s+)?(.*)$/.exec(l))) { if (list !== "ul") { closeList(); out += "<ul>"; list = "ul"; } out += "<li>" + (m[1] ? (m[1].indexOf("x") >= 0 ? "☑ " : "☐ ") : "") + inline(m[2]) + "</li>"; i++; continue; }
      if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(l))) { if (list !== "ol") { closeList(); out += "<ol>"; list = "ol"; } out += "<li>" + inline(m[1]) + "</li>"; i++; continue; }
      if (!l.trim()) { closeList(); i++; continue; }
      closeList();
      let para = l; i++;
      while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\||>|\s*[-*]\s|\s*\d+[.)]\s|---)/.test(lines[i])) { para += " " + lines[i]; i++; }
      out += "<p>" + inline(para) + "</p>";
    }
    closeList();
    return out;
  }
  function buildHelp() {
    const v = view("help", "도움말", null);
    const wrap = h("div", "help-wrap");
    HP.toc = h("aside", "help-toc");
    HP.body = h("article", "help-body");
    wrap.appendChild(HP.toc); wrap.appendChild(HP.body); v.body.appendChild(wrap);
    HP.v = v;
    EXT_VIEWS.help = { area: v.area, open: () => openHelp(HP.cur) };
    document.addEventListener("click", (e) => {
      const a = e.target.closest && e.target.closest("a[href^='#help:']");
      if (!a) return;
      e.preventDefault();
      const id = a.getAttribute("href").slice(6);
      if (state.nav !== "help") { HP.cur = id; navTo("help"); } else openHelp(id);
    });
  }
  async function helpIndex() {
    if (HP.index) return HP.index;
    try { const r = await fetch("help/index.json", { cache: "no-store" }); HP.index = await r.json(); } catch (e) { HP.index = { groups: [] }; }
    return HP.index;
  }
  async function helpDoc(id) {
    if (HP.cache[id] != null) return HP.cache[id];
    try { const r = await fetch("help/" + id + ".md", { cache: "no-store" }); HP.cache[id] = r.ok ? await r.text() : "# 없는 문서\n\n`help/" + id + ".md` 를 찾지 못했어요."; } catch (e) { HP.cache[id] = "# 불러오지 못했어요"; }
    return HP.cache[id];
  }
  async function openHelp(id) {
    HP.cur = id || "start";
    const idx = await helpIndex();
    HP.toc.innerHTML = "";
    const q = document.createElement("input"); q.type = "search"; q.placeholder = "도움말 검색…"; q.className = "lib2-tagq";
    const res = h("div", "help-res");
    q.addEventListener("input", async () => {
      res.innerHTML = ""; const t = q.value.trim().toLowerCase(); if (t.length < 2) return;
      for (const g of idx.groups) for (const it of g.items) {
        const txt = (await helpDoc(it.id)).toLowerCase(); const k = txt.indexOf(t);
        if (k < 0 && it.title.toLowerCase().indexOf(t) < 0) continue;
        const a = h("a", "help-hit"); a.href = "#help:" + it.id; a.innerHTML = "<b>" + esc(it.title) + "</b>" + (k >= 0 ? "<span>" + esc(txt.slice(Math.max(0, k - 30), k + 60)) + "</span>" : "");
        res.appendChild(a);
      }
    });
    HP.toc.appendChild(q); HP.toc.appendChild(res);
    idx.groups.forEach((g) => {
      HP.toc.appendChild(h("p", "lib2-fg-t", g.title));
      g.items.forEach((it) => { const a = h("a", "help-link" + (it.id === HP.cur ? " on" : ""), it.title); a.href = "#help:" + it.id; HP.toc.appendChild(a); });
    });
    const src = await helpDoc(HP.cur);
    HP.body.innerHTML = md(src);
    // 문서 안 목차(h2)
    const hs = HP.body.querySelectorAll("h2");
    if (hs.length > 2) {
      const mini = h("nav", "help-mini"); mini.appendChild(h("b", "", "이 문서"));
      hs.forEach((x) => { const a = h("a", "", x.textContent); a.href = "#"; a.addEventListener("click", (e) => { e.preventDefault(); x.scrollIntoView({ block: "start" }); }); mini.appendChild(a); });
      const h1 = HP.body.querySelector("h1"); if (h1) h1.insertAdjacentElement("afterend", mini); else HP.body.prepend(mini);
    }
    window.scrollTo(0, 0);
  }

  function init() {
    try { buildHelp(); } catch (e) { console.error("help", e); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
