(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const LV = { beginner: "입문", intermediate: "중급", advanced: "심화", reference: "참고" };
  const LV_ORDER = ["beginner", "intermediate", "advanced", "reference"];
  const ST = { published: "공개", review: "검토 중", draft: "초안", archived: "보관", legacy: "레거시" };
  const SORTS = { new: "최신순", rec: "분류순", title: "제목순", level: "수준순", short: "짧은 것부터", long: "긴 것부터", read: "최근 읽음" };
  // (v98) 보기 4종 — 목록(게시판형 표, 기본) · 카드 목록(한 줄 카드) · 카드(격자) · 트리
  const VIEWS = [["table", "목록"], ["list", "카드 목록"], ["card", "카드"], ["tree", "트리"]];
  const PAGE = 30;
  const READ = { unread: "안 읽음", reading: "읽는 중", done: "다 읽음" };
  const K_STATE = "study.lib2";
  const L2 = {
    f: { subject: [], domain: [], track: [], level: [], tag: [], status: [], read: [], origin: [] },
    fav: false, q: "", sort: "new", rev: false, page: 1, selecting: false, sel: {}, meta: { progress: {}, fav: {}, recent: [] },
    tagQ: "", tagMore: false, sideQ: "", sideOpen: true, zoom: 1, facetsOpen: true, order: [],
    sideScope: "rel", tocOpen: true, readMode: "app", allOpen: {},     // v78: 목록 범위(관련/전체) · 오른쪽 목차 · 보기 방식(app=앱에 맞춤 / orig=원본)
  };
  function loadState() {
    try { const v = JSON.parse(localStorage.getItem(K_STATE) || "null"); if (v) { Object.assign(L2.f, v.f || {}); L2.sort = v.v98 ? (SORTS[v.sort] ? v.sort : "new") : (v.sort && v.sort !== "rec" ? v.sort : "new"); L2.rev = !!(v.v98 && v.rev); L2.fav = !!v.fav; L2.sideOpen = v.sideOpen !== false; L2.zoom = v.zoom || 1; L2.facetsOpen = v.facetsOpen !== false; L2.sideScope = v.sideScope === "all" ? "all" : "rel"; L2.tocOpen = v.tocOpen !== false; L2.readMode = v.readMode === "orig" ? "orig" : "app"; } } catch (e) { /* 계속 */ }
  }
  function saveState() { try { localStorage.setItem(K_STATE, JSON.stringify({ v98: 1, f: L2.f, sort: L2.sort, rev: L2.rev, fav: L2.fav, sideOpen: L2.sideOpen, zoom: L2.zoom, facetsOpen: L2.facetsOpen, sideScope: L2.sideScope, tocOpen: L2.tocOpen, readMode: L2.readMode })); } catch (e) { /* 계속 */ } }
  async function loadMeta() { try { L2.meta = Object.assign({ progress: {}, fav: {}, recent: [] }, (await Api.library.meta()) || {}); } catch (e) { /* 계속 */ } }
  let metaT = null;
  function saveMeta() { clearTimeout(metaT); metaT = setTimeout(() => { try { Api.library.saveMeta(L2.meta); } catch (e) { /* 계속 */ } }, 400); }

  /* ---- 데이터 도우미 ----------------------------------------------------- */
  // (v102) 레거시 묶음 — 새로 가다듬어 만든 AI 학습자료(AI 파노라마 팩, 갈래 ai-history)만 '새 문서', 나머지는 모두 '레거시'
  //   레거시: 상태 배지(검토 중 등) 대신 '레거시' 배지 · 태그 '레거시' · 목록에서는 늘 새 문서 아래로(정렬 기준은 그 안에서 적용)
  const isNewDoc = (d) => d.track === "ai-history" || /ai-panorama/.test(d.id || "");
  function markLegacy(c) {
    if (!c || c._lg) return c; c._lg = 1;
    (c.docs || []).forEach((d) => { if (isNewDoc(d)) return; d.legacy = true; d.status0 = d.status; d.status = "legacy"; d.tags = ["레거시"].concat((d.tags || []).filter((t) => t !== "레거시")); });
    return c;
  }
  const cat = () => markLegacy(libState.catalog) || { docs: [], taxonomy: {}, subjects: [] };
  function domLabel(k) { const t = cat().taxonomy || {}; return (t[k] && t[k].label) || k || "(미분류)"; }
  function trackLabel(d, k) { const t = (cat().taxonomy || {})[d] || {}; return (((t.tracks || {})[k]) || {}).label || k || "(갈래 없음)"; }
  function topicLabel(d, tr, k) { const t = ((((cat().taxonomy || {})[d] || {}).tracks || {})[tr]) || {}; return (t.topics || {})[k] || k || ""; }
  function crumb(d) { return [domLabel(d.domain), d.track ? trackLabel(d.domain, d.track) : "", d.topic ? topicLabel(d.domain, d.track, d.topic) : ""].filter(Boolean).join(" › "); }
  function readState(d) { const p = L2.meta.progress[d.id]; if (!p) return "unread"; return p.pct >= 90 ? "done" : "reading"; }
  function subjName(id) { const s = (cat().subjects || []).filter((x) => x.id === id)[0]; return s ? s.display_name : id; }
  const facetVal = {
    subject: (d) => d.subjects || [], domain: (d) => [d.domain], track: (d) => [d.domain + "/" + (d.track || "")], level: (d) => [d.level],
    tag: (d) => d.tags || [], status: (d) => [d.status || "published"], read: (d) => [readState(d)], origin: (d) => [d.uploaded ? "uploaded" : "bundle"],
  };
  function textHit(d, q) {
    q = (q || "").trim().toLowerCase(); if (!q) return true;
    const hay = [d.title, d.summary, d.id, (d.tags || []).join(" "), crumb(d)].join(" ").toLowerCase();
    return q.split(/\s+/).every((w) => hay.indexOf(w) >= 0);
  }
  function passes(d, skip) {
    if (L2.fav && !L2.meta.fav[d.id]) return false;
    if (!textHit(d, L2.q)) return false;
    for (const k of Object.keys(L2.f)) {
      if (k === skip || !L2.f[k].length) continue;
      const vs = facetVal[k](d);
      if (k === "tag") { if (!L2.f.tag.every((t) => vs.indexOf(t) >= 0)) return false; }       // 태그는 모두 포함(AND)
      else if (!vs.some((v) => L2.f[k].indexOf(v) >= 0)) return false;                           // 나머지는 하나라도(OR)
    }
    return true;
  }
  function sorted(list) {
    const P = L2.meta.progress;
    const by = {
      rec: (a, b) => (crumb(a)).localeCompare(crumb(b), "ko") || (a.title || "").localeCompare(b.title || "", "ko"),
      new: (a, b) => String(b.updated || "").localeCompare(String(a.updated || "")) || (a.title || "").localeCompare(b.title || "", "ko"),
      title: (a, b) => (a.title || "").localeCompare(b.title || "", "ko"),
      level: (a, b) => lvIdx(a) - lvIdx(b) || (a.title || "").localeCompare(b.title || "", "ko"),
      short: (a, b) => (a.minutes || 999) - (b.minutes || 999),
      long: (a, b) => (b.minutes || 0) - (a.minutes || 0),
      read: (a, b) => ((P[b.id] && P[b.id].ts) || 0) - ((P[a.id] && P[a.id].ts) || 0),
    };
    const out = list.slice().sort(by[L2.sort] || by.new);
    if (L2.rev) out.reverse();
    return out.filter((d) => !d.legacy).concat(out.filter((d) => d.legacy));   // 새 문서가 늘 먼저, 레거시는 아래

  }
  /* (v103) 문서 버전 — doc-meta.versions[{key,label,default,path,model,method,updated}] 가 2개 이상이면 목록엔 '버전 N' 칩, 뷰어엔 버전 고르기.
   *   목록에는 늘 한 줄(기본 버전 = docs/<id>.html). 고른 버전은 문서별로 기억(L2.meta.ver). 진도·형광펜·메모는 문서 id 기준 그대로. */
  function vers(d) { return d && Array.isArray(d.versions) && d.versions.filter((v) => v && v.path).length >= 2 ? d.versions.filter((v) => v && v.path) : null; }
  function curVer(d) { const vs = vers(d); if (!vs) return null; const k = (L2.meta.ver || {})[d.id]; return vs.find((v) => v.key === k) || vs.find((v) => v.default) || vs[0]; }
  function verChip(d) { const vs = vers(d), c = h("i", "lib2-bd ver", "버전 " + vs.length); c.title = vs.map((v) => (v.label || v.key) + (v.model ? " · " + v.model : "") + (v.method ? " · " + v.method : "")).join(" / "); return c; }
  function paintVerSel(d) {
    const bar = document.querySelector("#libViewer .lib2-bar-tools"); if (!bar) return;
    let sel = $("libVerSel"); const vs = vers(d);
    if (!vs) { if (sel) sel.remove(); return; }
    if (!sel) { sel = document.createElement("select"); sel.id = "libVerSel"; sel.className = "lib2-ver"; sel.setAttribute("aria-label", "문서 버전"); bar.insertBefore(sel, bar.firstChild);
      sel.addEventListener("change", () => { const doc = (cat().docs || []).find((x) => x.id === curId); if (!doc) return; const v = vers(doc).find((x) => x.key === sel.value); if (!v) return; L2.meta.ver = L2.meta.ver || {}; L2.meta.ver[doc.id] = v.key; saveMeta(); saveProgressNow(); $("libOpenNew").href = v.path; lb.frame.src = v.path; sel.title = verTitle(v); }); }
    const cv = curVer(d);
    sel.innerHTML = vs.map((v) => '<option value="' + String(v.key).replace(/"/g, "&quot;") + '"' + (v === cv ? " selected" : "") + ">" + (v.label || v.key) + (v.default ? " (기본)" : "") + "</option>").join("");
    sel.title = verTitle(cv);
  }
  function verTitle(v) { return v ? [(v.label || v.key), v.model ? "작성: " + v.model : "", v.method ? "방식: " + v.method : "", v.updated ? "갱신 " + v.updated : ""].filter(Boolean).join(" · ") : ""; }
  function lvIdx(d) { const i = LV_ORDER.indexOf(d.level); return i < 0 ? 9 : i; }
  // 갱신일이 7일 안이면 '새 글'
  function isNew(d) { if (!d.updated) return false; const t = Date.parse(d.updated); return t && Date.now() - t < 7 * 86400000; }
  function hits() { return sorted((cat().docs || []).filter((d) => passes(d))); }

  /* ---- 왼쪽 패싯 -------------------------------------------------------- */
  function renderFacets() {
    const box = $("libFacetPanel"); if (!box) return;
    box.classList.toggle("closed", !L2.facetsOpen);
    if ($("libBrowse")) $("libBrowse").classList.toggle("no-facets", !L2.facetsOpen);
    box.innerHTML = "";
    const head = h("div", "lib2-fhead"); head.appendChild(h("b", "", "필터"));
    const rs = h("button", "ghost-btn small-btn", "초기화"); rs.type = "button"; rs.addEventListener("click", resetAll); head.appendChild(rs);
    box.appendChild(head);
    const docs = cat().docs || [];
    const group = (key, title, opts, labelFn, extra) => {
      const counts = {};
      docs.filter((d) => passes(d, key)).forEach((d) => facetVal[key](d).forEach((v) => { counts[v] = (counts[v] || 0) + 1; }));
      let keys = opts || Object.keys(counts);
      if (extra && extra.filterKeys) keys = extra.filterKeys(keys, counts);
      if (!keys.length) return;
      const g = h("div", "lib2-fg"); g.appendChild(h("p", "lib2-fg-t", title));
      if (extra && extra.pre) extra.pre(g);
      keys.forEach((v) => {
        const n = counts[v] || 0; const on = L2.f[key].indexOf(v) >= 0;
        if (!n && !on) return;
        const l = h("label", "lib2-fo" + (on ? " on" : ""));
        const i = document.createElement("input"); i.type = "checkbox"; i.checked = on;
        i.addEventListener("change", () => { toggle(key, v); });
        l.appendChild(i); l.appendChild(h("span", "lib2-fo-l", labelFn ? labelFn(v) : v)); l.appendChild(h("span", "lib2-fo-n", String(n)));
        g.appendChild(l);
      });
      if (extra && extra.post) extra.post(g, keys);
      box.appendChild(g);
    };
    const favN = docs.filter((d) => L2.meta.fav[d.id]).length;
    if (favN) {
      const g = h("div", "lib2-fg");
      const l = h("label", "lib2-fo" + (L2.fav ? " on" : ""));
      const i = document.createElement("input"); i.type = "checkbox"; i.checked = L2.fav;
      i.addEventListener("change", () => { L2.fav = i.checked; changed(); });
      l.appendChild(i); l.appendChild(h("span", "lib2-fo-l", "★ 즐겨찾기만")); l.appendChild(h("span", "lib2-fo-n", String(favN)));
      g.appendChild(l); box.appendChild(g);
    }
    group("domain", "분류", null, domLabel, { filterKeys: (ks) => ks.sort((a, b) => domLabel(a).localeCompare(domLabel(b), "ko")) });
    group("track", "갈래", null, (v) => { const p = v.split("/"); return trackLabel(p[0], p[1]); }, {
      filterKeys: (ks) => ks.filter((v) => !L2.f.domain.length || L2.f.domain.indexOf(v.split("/")[0]) >= 0).sort(),
      pre: (g) => { if (!L2.f.domain.length) g.appendChild(h("p", "lib2-fg-hint", "분류를 고르면 좁혀져요")); },
    });
    group("level", "수준", LV_ORDER, (v) => LV[v] || v);
    group("tag", "태그", null, (v) => v, {
      filterKeys: (ks, c) => {
        const q = L2.tagQ.trim().toLowerCase();
        const on = L2.f.tag;
        let list = ks.filter((v) => !q || v.toLowerCase().indexOf(q) >= 0).sort((a, b) => (c[b] || 0) - (c[a] || 0));
        const lim = L2.tagMore || q ? 80 : 12;
        return on.concat(list.filter((v) => on.indexOf(v) < 0).slice(0, lim));
      },
      pre: (g) => {
        const i = document.createElement("input"); i.type = "search"; i.className = "lib2-tagq"; i.placeholder = "태그 찾기…"; i.value = L2.tagQ;
        i.addEventListener("input", () => { L2.tagQ = i.value; renderFacets(); const n = $("libFacetPanel").querySelector(".lib2-tagq"); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } });
        g.appendChild(i);
      },
      post: (g) => { const b = h("button", "lib2-more", L2.tagMore ? "태그 접기" : "태그 더 보기"); b.type = "button"; b.addEventListener("click", () => { L2.tagMore = !L2.tagMore; renderFacets(); }); g.appendChild(b); },
    });
    group("status", "상태", null, (v) => ST[v] || v);
    group("read", "읽기", ["unread", "reading", "done"], (v) => READ[v]);
    group("origin", "출처", ["bundle", "uploaded"], (v) => (v === "uploaded" ? "앱에서 등록" : "기본 제공"));
  }
  function toggle(key, v) { const a = L2.f[key]; const i = a.indexOf(v); if (i >= 0) a.splice(i, 1); else a.push(v); changed(); }
  function resetAll() { Object.keys(L2.f).forEach((k) => { L2.f[k] = []; }); L2.fav = false; L2.q = ""; if ($("libSearch")) $("libSearch").value = ""; changed(); }
  function changed() { L2.page = 1; saveState(); libRender(); }

  /* ---- 활성 칩 · 선반(이어 읽기/즐겨찾기) ---------------------------------- */
  function renderActive() {
    const box = $("libActive"); if (!box) return;
    box.innerHTML = "";
    const chip = (text, fn) => { const b = h("button", "lib2-achip", text + " ✕"); b.type = "button"; b.addEventListener("click", fn); box.appendChild(b); };
    const lab = { subject: subjName, domain: domLabel, track: (v) => { const p = v.split("/"); return trackLabel(p[0], p[1]); }, level: (v) => LV[v] || v, tag: (v) => "#" + v, status: (v) => ST[v] || v, read: (v) => READ[v], origin: (v) => (v === "uploaded" ? "앱 등록" : "기본 제공") };
    Object.keys(L2.f).forEach((k) => L2.f[k].forEach((v) => chip(lab[k](v), () => toggle(k, v))));
    if (L2.fav) chip("★ 즐겨찾기", () => { L2.fav = false; changed(); });
    if (L2.q) chip("“" + L2.q + "”", () => { L2.q = ""; $("libSearch").value = ""; changed(); });
    if (box.children.length > 1) { const b = h("button", "lib2-achip clear", "모두 지우기"); b.type = "button"; b.addEventListener("click", resetAll); box.appendChild(b); }
  }
  function renderShelves() {
    const box = $("libShelves"); if (!box) return;
    box.innerHTML = "";
    const any = L2.q || L2.fav || Object.keys(L2.f).some((k) => L2.f[k].length);
    if (any) return;
    const docs = cat().docs || []; const byId = {}; docs.forEach((d) => { byId[d.id] = d; });
    const reading = (L2.meta.recent || []).map((id) => byId[id]).filter((d) => d && readState(d) === "reading").slice(0, 6);
    const favs = docs.filter((d) => L2.meta.fav[d.id]).slice(0, 8);
    const shelf = (title, list) => {
      if (!list.length) return;
      const s = h("div", "lib2-shelf"); s.appendChild(h("p", "lib2-shelf-t", title));
      const row = h("div", "lib2-shelf-row");
      list.forEach((d) => {
        const b = h("button", "lib2-mini"); b.type = "button";
        b.appendChild(h("b", "", d.title));
        const p = L2.meta.progress[d.id];
        b.appendChild(h("span", "lib2-mini-s", crumb(d)));
        if (p) { const bar = h("span", "lib2-pbar"); const i = h("i"); i.style.width = Math.min(100, p.pct || 0) + "%"; bar.appendChild(i); b.appendChild(bar); }
        b.addEventListener("click", () => libOpen(d.id));
        row.appendChild(b);
      });
      s.appendChild(row); box.appendChild(s);
    };
    shelf("📖 이어 읽기", reading);
    shelf("★ 즐겨찾기", favs);
  }

  /* ---- 목록 항목 ------------------------------------------------------- */
  function item(d, compact) {
    const row = h("div", "lib2-item" + (compact ? " compact" : "") + (L2.sel[d.id] ? " sel" : ""));
    row.dataset.doc = d.id;
    if (L2.selecting && !compact) {
      const c = document.createElement("input"); c.type = "checkbox"; c.className = "lib2-check"; c.checked = !!L2.sel[d.id];
      c.addEventListener("click", (e) => { e.stopPropagation(); if (c.checked) L2.sel[d.id] = 1; else delete L2.sel[d.id]; row.classList.toggle("sel", c.checked); renderSelBar(); });
      row.appendChild(c);
    }
    const star = h("button", "lib2-star" + (L2.meta.fav[d.id] ? " on" : ""), L2.meta.fav[d.id] ? "★" : "☆"); star.type = "button"; star.title = "즐겨찾기";
    star.addEventListener("click", (e) => { e.stopPropagation(); favToggle(d.id); star.classList.toggle("on", !!L2.meta.fav[d.id]); star.textContent = L2.meta.fav[d.id] ? "★" : "☆"; });
    row.appendChild(star);
    const body = h("div", "lib2-ib");
    body.appendChild(h("b", "lib2-it", d.title));
    if (!compact) body.appendChild(h("span", "lib2-ic", crumb(d)));
    if (d.summary && !compact) body.appendChild(h("span", "lib2-is", d.summary));
    const m = h("span", "lib2-im");
    m.appendChild(h("i", "lib-lv lv-" + d.level, LV[d.level] || d.level || ""));
    if (d.minutes) m.appendChild(h("i", "lib2-bd", "약 " + d.minutes + "분"));
    if (!compact && d.updated) m.appendChild(h("i", "lib2-bd", "갱신 " + d.updated));
    if (!compact && d.status && d.status !== "published") m.appendChild(h("i", "lib2-bd " + (d.legacy ? "lg" : "st"), ST[d.status] || d.status));
    if (d.uploaded) m.appendChild(h("i", "lib2-bd up", "앱 등록"));
    if (vers(d)) m.appendChild(verChip(d));
    if (!compact) (d.tags || []).slice(0, 4).forEach((t) => { const g = h("i", "lib-tag", "#" + t); g.addEventListener("click", (e) => { e.stopPropagation(); toggle("tag", t); }); m.appendChild(g); });
    body.appendChild(m);
    const p = L2.meta.progress[d.id];
    if (p) { const bar = h("span", "lib2-pbar" + (p.pct >= 90 ? " done" : "")); const i = h("i"); i.style.width = Math.min(100, p.pct || 0) + "%"; bar.appendChild(i); bar.title = "읽은 위치 " + (p.pct || 0) + "%"; body.appendChild(bar); }
    row.appendChild(body);
    row.addEventListener("click", () => {
      if (L2.selecting && !compact) { const c = row.querySelector(".lib2-check"); c.checked = !c.checked; c.dispatchEvent(new Event("click")); return; }
      libOpen(d.id);
    });
    return row;
  }
  function favToggle(id) { if (L2.meta.fav[id]) delete L2.meta.fav[id]; else L2.meta.fav[id] = 1; saveMeta(); if ($("libFav") && libState.docId === id) paintFav(); }

  /* ---- 목록 그리기(덮어쓰기) ------------------------------------------- */
  async function libRender2() {
    await libCatalog();
    const list = hits();
    L2.order = list.map((d) => d.id);
    renderFacets(); renderActive(); renderShelves();
    const all = (cat().docs || []).length;
    if ($("libCount")) $("libCount").textContent = list.length === all ? "전체 " + all + "편" : list.length + "편 / 전체 " + all + "편";
    const sortSel = $("libSort");
    if (sortSel && !sortSel.options.length) Object.keys(SORTS).forEach((k) => { const o = document.createElement("option"); o.value = k; o.textContent = SORTS[k]; sortSel.appendChild(o); });
    if (sortSel) sortSel.value = L2.sort;
    const view = libView();
    paintViewSeg(view);
    if ($("libSelectBtn")) $("libSelectBtn").classList.toggle("on", L2.selecting);
    const box = $("libList"); box.innerHTML = "";
    box.className = "lib-list lib2-list as-" + view;
    const lv = list.length && !L2.selecting && window.SLCLV && SLCLV.on();   // (v126) 새 테마는 공통 목록(표·카드·트리·묶기·표시 옵션·내려받기). 여러 편 고르기는 예전 표로
    if ($("libViewSeg")) $("libViewSeg").classList.toggle("hidden", !!lv);
    if (sortSel) sortSel.classList.toggle("hidden", !!lv);
    if (lv) { box.className = "lib2-lv"; libListView(box, list); }
    else if (view === "tree") renderTree(box, list);
    else if (view === "table") renderTable(box, list);
    else if (L2.sort === "rec" && view === "list") {
      let last = null, grp = null;
      list.forEach((d) => { const c = crumb(d); if (c !== last) { last = c; grp = h("section", "lib2-gsec"); grp.appendChild(h("h3", "lib2-group", c)); box.appendChild(grp); } grp.appendChild(item(d)); });
    } else list.forEach((d) => box.appendChild(item(d)));
    if ($("libEmpty")) $("libEmpty").classList.toggle("hidden", list.length > 0);
    renderSelBar();
  }
  function libListView(box, list) {
    const star = (d) => '<button type="button" class="lib2-star' + (L2.meta.fav[d.id] ? " on" : "") + '" data-lib-star="' + UI.esc(d.id) + '" title="즐겨찾기" aria-label="즐겨찾기">' + (L2.meta.fav[d.id] ? "★" : "☆") + "</button>";
    SLCLV.mount(box, { key: "library.docs", name: "학습 자료", titleLabel: "제목", noSearch: true, rows: list.slice(), title: (d) => d.title, sub: (d) => d.summary || "",
      badge: (d) => (isNew(d) ? '<i class="lib2-new">N</i>' : "") + (d.status && d.status !== "published" ? '<i class="lib2-bd ' + (d.legacy ? "lg" : "st") + '">' + UI.esc(ST[d.status] || d.status) + "</i>" : "") + (d.uploaded ? '<i class="lib2-bd up">앱 등록</i>' : "") + (vers(d) ? '<i class="lib2-bd">버전 ' + vers(d).length + "</i>" : ""),
      columns: [{ k: "cat", label: "분류", get: crumb }, { k: "level", label: "수준", get: (d) => LV[d.level] || d.level || "" }, { k: "min", label: "분량", get: (d) => Number(d.minutes) || 0, cls: "n" }, { k: "updated", label: "갱신일", get: (d) => d.updated || "" }, { k: "prog", label: "읽기", get: (d) => { const p = L2.meta.progress[d.id]; return p ? (p.pct || 0) + "%" : ""; } }, { k: "fig", label: "그림", get: (d) => d.figures || 0, cls: "n", on: false }, { k: "refs", label: "출처", get: (d) => d.refs || 0, cls: "n", on: false }, { k: "source", label: "원본", get: (d) => d.source || "", on: false }, { k: "tags", label: "태그", get: (d) => (d.tags || []).join(", "), on: false }],
      groups: [{ k: "cat", label: "분류", path: (d) => crumb(d).split(" › ") }, { k: "level", label: "수준", path: (d) => [LV[d.level] || d.level || ""] }, { k: "tag", label: "첫 태그", path: (d) => [(d.tags || [])[0] || "태그 없음"] }, { k: "month", label: "갱신한 달", path: (d) => [String(d.updated || "").slice(0, 7) || "날짜 없음"] }],
      action: star, open: (d) => libOpen(d.id) });
    box.onclick = (e) => { const b = e.target.closest("[data-lib-star]"); if (!b) return; const id = b.dataset.libStar; favToggle(id); b.classList.toggle("on", !!L2.meta.fav[id]); b.textContent = L2.meta.fav[id] ? "★" : "☆"; };
  }
  // (v98) 보기 버튼 — index.html 의 3개를 4개(목록·카드 목록·카드·트리)로 다시 그린다(누르면 app.js 가 SETTINGS.lib_view 저장)
  function paintViewSeg(view) {
    const seg = $("libViewSeg"); if (!seg) return;
    if (seg.dataset.v98 !== "1") { seg.dataset.v98 = "1"; seg.innerHTML = VIEWS.map((v) => '<button type="button" class="seg-btn" data-libview="' + v[0] + '">' + v[1] + "</button>").join(""); }
    segActivate(seg, "libview", view);
  }
  /* ---- (v98) 목록 = 게시판형 표: 번호 · 제목(요약 한 줄) · 분류 · 수준 · 분량 · 갱신일 · 읽기 ---------
   *   머리글을 누르면 그 기준으로 정렬, 한 번 더 누르면 거꾸로. 30편씩 쪽 나눔. 분류순일 때는 분류 묶음 줄을 끼운다. */
  const TCOLS = [["no", "번호", ""], ["title", "제목", "title"], ["cat", "분류", "rec"], ["level", "수준", "level"], ["min", "분량", "short"], ["upd", "갱신일", "new"], ["prog", "읽기", "read"]];
  function renderTable(box, list) {
    const pages = Math.max(1, Math.ceil(list.length / PAGE)); L2.page = Math.min(Math.max(1, L2.page || 1), pages);
    const from = (L2.page - 1) * PAGE, rows = list.slice(from, from + PAGE);
    const wrap = h("div", "lib2-tblw"), t = h("table", "lib2-tbl"), thead = h("thead"), hr = h("tr");
    TCOLS.forEach((c) => {
      const th = h("th", "c-" + c[0]);
      if (c[0] === "no" && L2.selecting) { const all = document.createElement("input"); all.type = "checkbox"; all.title = "이 쪽 모두 선택"; all.checked = rows.length > 0 && rows.every((d) => L2.sel[d.id]); all.addEventListener("change", () => { rows.forEach((d) => { if (all.checked) L2.sel[d.id] = 1; else delete L2.sel[d.id]; }); libRender2(); }); th.appendChild(all); }
      else if (!c[2]) th.textContent = c[1];
      else {
        const on = L2.sort === c[2] || (c[2] === "short" && L2.sort === "long");
        const b = h("button", "lib2-th" + (on ? " on" : ""), c[1]); b.type = "button";
        const down = on && ((c[2] === "new" || c[2] === "read") !== L2.rev);   // 최신·최근 읽음은 기본이 내림차순
        if (on) { b.appendChild(h("i", "lib2-th-a", L2.sort === "long" ? "▼" : down ? "▼" : "▲")); th.setAttribute("aria-sort", (L2.sort === "long" || down) ? "descending" : "ascending"); }
        b.addEventListener("click", () => { if (on) { if (c[2] === "short") { L2.sort = L2.sort === "short" ? "long" : "short"; L2.rev = false; } else L2.rev = !L2.rev; } else { L2.sort = c[2]; L2.rev = false; } L2.page = 1; saveState(); libRender2(); });
        th.appendChild(b);
      }
      hr.appendChild(th);
    });
    thead.appendChild(hr); t.appendChild(thead);
    const tb = h("tbody"); let last = null;
    rows.forEach((d, i) => {
      if (L2.sort === "rec") { const c = crumb(d); if (c !== last) { last = c; const g = h("tr", "lib2-tgrp"); const td = h("td", "", c); td.colSpan = TCOLS.length; g.appendChild(td); tb.appendChild(g); } }
      const tr = h("tr", "lib2-tr" + (L2.sel[d.id] ? " sel" : "")); tr.dataset.doc = d.id; tr.tabIndex = 0;
      const no = h("td", "c-no");
      if (L2.selecting) { const c = document.createElement("input"); c.type = "checkbox"; c.checked = !!L2.sel[d.id]; c.addEventListener("click", (e) => { e.stopPropagation(); if (c.checked) L2.sel[d.id] = 1; else delete L2.sel[d.id]; tr.classList.toggle("sel", c.checked); renderSelBar(); }); no.appendChild(c); }
      else no.textContent = String(from + i + 1);
      tr.appendChild(no);
      const tt = h("td", "c-title"), line = h("div", "lib2-tt");
      const star = h("button", "lib2-star" + (L2.meta.fav[d.id] ? " on" : ""), L2.meta.fav[d.id] ? "★" : "☆"); star.type = "button"; star.title = "즐겨찾기";
      star.addEventListener("click", (e) => { e.stopPropagation(); favToggle(d.id); star.classList.toggle("on", !!L2.meta.fav[d.id]); star.textContent = L2.meta.fav[d.id] ? "★" : "☆"; });
      line.appendChild(star); line.appendChild(h("b", "lib2-tt-b", d.title));
      if (isNew(d)) line.appendChild(h("i", "lib2-new", "N"));
      if (d.status && d.status !== "published") line.appendChild(h("i", "lib2-bd " + (d.legacy ? "lg" : "st"), ST[d.status] || d.status));
      if (d.uploaded) line.appendChild(h("i", "lib2-bd up", "앱 등록"));
      if (vers(d)) line.appendChild(verChip(d));
      tt.appendChild(line);
      if (d.summary) tt.appendChild(h("span", "lib2-tt-s", d.summary));
      tt.appendChild(h("span", "lib2-tt-c", crumb(d)));   // 좁은 화면에서 분류 칸 대신
      tr.appendChild(tt);
      tr.appendChild(h("td", "c-cat", crumb(d)));
      const lv = h("td", "c-level"); lv.appendChild(h("i", "lib-lv lv-" + d.level, LV[d.level] || d.level || "")); tr.appendChild(lv);
      tr.appendChild(h("td", "c-min", d.minutes ? d.minutes + "분" : "—"));
      tr.appendChild(h("td", "c-upd", d.updated ? String(d.updated).slice(2).replace(/-/g, ".") : "—"));
      const pg = h("td", "c-prog"), p = L2.meta.progress[d.id];
      if (p && (p.pct || 0) > 0) { const bar = h("span", "lib2-pbar" + (p.pct >= 90 ? " done" : "")); const ii = h("i"); ii.style.width = Math.min(100, p.pct || 0) + "%"; bar.appendChild(ii); pg.appendChild(bar); pg.appendChild(h("small", "", p.pct >= 90 ? "다 읽음" : Math.round(p.pct) + "%")); pg.title = "읽은 위치 " + (p.pct || 0) + "%"; }
      else pg.appendChild(h("small", "lib2-dim", "안 읽음"));
      tr.appendChild(pg);
      const open = () => { if (L2.selecting) { const c = no.querySelector("input"); c.checked = !c.checked; c.dispatchEvent(new Event("click")); return; } libOpen(d.id); };
      tr.addEventListener("click", open);
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); open(); } });
      tb.appendChild(tr);
    });
    t.appendChild(tb); wrap.appendChild(t); box.appendChild(wrap);
    if (pages > 1) {
      const nav = h("nav", "lib2-pager"); nav.setAttribute("aria-label", "쪽 넘기기");
      const go = (n, label, cls, dis) => { const b = h("button", "lib2-pg" + (cls ? " " + cls : ""), label); b.type = "button"; b.disabled = !!dis; if (n === L2.page && !cls) { b.classList.add("on"); b.setAttribute("aria-current", "page"); } b.addEventListener("click", () => { L2.page = n; libRender2(); const top = $("libList"); if (top) top.scrollIntoView({ block: "start", behavior: "smooth" }); }); nav.appendChild(b); };
      go(L2.page - 1, "‹ 이전", "prev", L2.page === 1);
      for (let n = 1; n <= pages; n++) { if (n === 1 || n === pages || Math.abs(n - L2.page) <= 2) go(n, String(n)); else if (Math.abs(n - L2.page) === 3) nav.appendChild(h("span", "lib2-pg-gap", "…")); }
      go(L2.page + 1, "다음 ›", "next", L2.page === pages);
      nav.appendChild(h("span", "lib2-pg-info", (from + 1) + "–" + Math.min(list.length, from + PAGE) + " / " + list.length + "편"));
      box.appendChild(nav);
    }
  }
  function renderTree(box, list) {
    const tree = {};
    list.forEach((d) => { const a = tree[d.domain] = tree[d.domain] || {}; const b = a[d.track || ""] = a[d.track || ""] || []; b.push(d); });
    Object.keys(tree).sort((a, b) => domLabel(a).localeCompare(domLabel(b), "ko")).forEach((dm) => {
      const n = Object.keys(tree[dm]).reduce((t, k) => t + tree[dm][k].length, 0);
      const det = document.createElement("details"); det.className = "lib2-tnode"; det.open = !!L2.f.domain.length || list.length < 40;
      det.appendChild(h("summary", "", domLabel(dm) + " · " + n + "편"));
      Object.keys(tree[dm]).sort().forEach((tr) => {
        const d2 = document.createElement("details"); d2.className = "lib2-tnode sub"; d2.open = true;
        d2.appendChild(h("summary", "", trackLabel(dm, tr) + " · " + tree[dm][tr].length + "편"));
        tree[dm][tr].forEach((d) => d2.appendChild(item(d)));
        det.appendChild(d2);
      });
      box.appendChild(det);
    });
  }
  function renderSelBar() {
    const bar = $("libSelBar"); if (!bar) return;
    const n = Object.keys(L2.sel).length;
    bar.classList.toggle("hidden", !L2.selecting);
    if (!L2.selecting) return;
    bar.innerHTML = "";
    bar.appendChild(h("b", "", n + "개 선택"));
    const mk = (t, fn, cls) => { const b = h("button", cls || "ghost-btn small-btn", t); b.type = "button"; b.addEventListener("click", fn); bar.appendChild(b); };
    mk("지금 목록 전부 선택", () => { L2.order.forEach((id) => { L2.sel[id] = 1; }); libRender2(); });
    mk("선택 해제", () => { L2.sel = {}; libRender2(); });
    mk("선택 끝내기", () => { L2.selecting = false; L2.sel = {}; libRender2(); });
  }

  /* ---- 뷰어 ----------------------------------------------------------- */
  let blobUrl = null, scrollBound = null, curId = null;
  async function libOpen2(id) {
    await libCatalog();
    const d = (cat().docs || []).find((x) => x.id === id);
    if (!d) { showResumeNote("그 문서를 찾지 못했어요"); return; }
    saveProgressNow();
    curId = id; libState.docId = id;
    $("libDocTitle").textContent = d.title;
    $("libDocCrumb").textContent = crumb(d) + (d.minutes ? " · 약 " + d.minutes + "분" : "");
    if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
    let src = d.path; const vv = vers(d); if (vv) src = (curVer(d) || {}).path || d.path;
    if (d.uploaded) {
      const html = await Api.library.uploadedHtml(id);
      blobUrl = URL.createObjectURL(new Blob([html || "<p>본문이 없어요</p>"], { type: "text/html" }));
      src = blobUrl;
    }
    $("libOpenNew").href = src; paintVerSel(d);
    const f = lb.frame;
    f.onload = () => { libSyncFrameTheme(); injectReader(); applyReading(); buildToc(); bindFrameScroll(); restoreScroll(id); askRefreshHeader(); };
    f.src = src;
    hide(lb.browse); show(lb.viewer);
    document.body.classList.add("lib-reading");
    // 최근·열람 수
    L2.meta.recent = [id].concat((L2.meta.recent || []).filter((x) => x !== id)).slice(0, 40);
    const p = L2.meta.progress[id] = L2.meta.progress[id] || { pct: 0 };
    p.ts = Date.now(); p.opens = (p.opens || 0) + 1; saveMeta();
    paintFav(); paintProg(); renderSide(); placeSide(); placeToc();
    libFitHeight2(); setTimeout(libFitHeight2, 60);
    SESS.library = { docId: id }; sessTouch();
    askRefreshHeader();
  }
  function libClose2() {
    saveProgressNow();
    libState.docId = ""; curId = null;
    if (lb.frame) lb.frame.src = "about:blank";
    if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
    hide(lb.viewer); show(lb.browse);
    document.body.classList.remove("lib-reading");
    SESS.library = null; sessTouch();
    askRefreshHeader();
    libRender2();
  }
  function bindFrameScroll() {
    try {
      const w = lb.frame.contentWindow;
      let t = null;
      let raf = 0;
      w.addEventListener("scroll", () => { clearTimeout(t); t = setTimeout(() => { saveProgressNow(); paintProg(); }, 350); if (!raf) raf = requestAnimationFrame(() => { raf = 0; tocSpy(); }); }, { passive: true });
      w.document.addEventListener("keydown", keyNav);
    } catch (e) { /* 다른 출처 */ }
  }
  function saveProgressNow() {
    if (!curId) return;
    const pct = libScrollPct(); if (pct == null) return;
    const p = L2.meta.progress[curId] = L2.meta.progress[curId] || {};
    p.pct = Math.max(p.pct || 0, pct); p.at = pct; p.ts = Date.now();
    saveMeta();
  }
  function restoreScroll(id) {
    const p = L2.meta.progress[id]; if (!p || !p.at || p.at >= 98) return;
    try { const w = lb.frame.contentWindow, d = lb.frame.contentDocument; const max = d.documentElement.scrollHeight - w.innerHeight; w.scrollTo(0, Math.round(max * p.at / 100)); } catch (e) { /* 계속 */ }
  }
  function paintProg() { const p = curId && L2.meta.progress[curId]; if ($("libProg")) $("libProg").textContent = p && p.at != null ? p.at + "%" : ""; }
  function paintFav() { const b = $("libFav"); if (!b) return; const on = !!L2.meta.fav[curId]; b.textContent = on ? "★" : "☆"; b.classList.toggle("on", on); }

  // 왼쪽 목록 — [관련 문서] 지금 목록 필터 결과(필터가 없으면 지금 문서와 같은 갈래) · [전체 문서] 모든 자료를 분류별로 접었다 폈다
  //   검색은 지금 범위 안에서 — 관련 문서에 없으면 "전체에서 n편" 으로 바로 넘어갈 수 있게
  function relatedList() {
    const all = cat().docs || [];
    const filtered = L2.order.length && L2.order.length < all.length;
    const byId = {}; all.forEach((d) => { byId[d.id] = d; });
    if (filtered) return { list: L2.order.map((id) => byId[id]).filter(Boolean), why: "목록 필터 결과" };
    const cur = byId[curId];
    if (!cur) return { list: sorted(all), why: "" };
    let list = all.filter((d) => d.domain === cur.domain && (d.track || "") === (cur.track || ""));
    let why = cur.track ? trackLabel(cur.domain, cur.track) : domLabel(cur.domain);
    if (list.length < 3) { list = all.filter((d) => d.domain === cur.domain); why = domLabel(cur.domain); }
    return { list: sorted(list), why: why };
  }
  function renderSide() {
    const box = $("libSideList"); if (!box) return;
    const all = cat().docs || [];
    const rel = relatedList();
    const scope = L2.sideScope;
    document.querySelectorAll("#libSideScope .seg-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.scope === scope);
      b.textContent = (b.dataset.scope === "rel" ? "관련 문서 " + rel.list.length : "전체 문서 " + all.length);
    });
    const q = L2.sideQ;
    box.innerHTML = "";
    if (scope === "rel") {
      const list = rel.list.filter((d) => textHit(d, q));
      $("libSideInfo").textContent = (rel.why ? rel.why + " · " : "") + list.length + "편";
      let last = null;
      list.forEach((d) => {
        const c = domLabel(d.domain) + (d.track ? " › " + trackLabel(d.domain, d.track) : "");
        if (L2.sort === "rec" && c !== last) { last = c; box.appendChild(h("div", "lib2-side-g", c)); }
        const it = item(d, true); if (d.id === curId) it.classList.add("cur"); box.appendChild(it);
      });
      const more = all.filter((d) => textHit(d, q) && rel.list.indexOf(d) < 0).length;
      if (q && more) {
        const b = h("button", "ghost-btn small-btn lib2-side-more", "전체 문서에서 " + more + "편 더 보기 →"); b.type = "button";
        b.addEventListener("click", () => { L2.sideScope = "all"; saveState(); renderSide(); }); box.appendChild(b);
      } else if (!list.length) box.appendChild(h("p", "lib2-side-info", "검색 결과가 없어요."));
      if (!q) {
        const b = h("button", "ghost-btn small-btn lib2-side-more", "📚 전체 문서 " + all.length + "편 둘러보기 →"); b.type = "button";
        b.addEventListener("click", () => { L2.sideScope = "all"; saveState(); renderSide(); }); box.appendChild(b);
      }
    } else {
      // 전체: 분류(영역 › 갈래)별로 접기 — 검색 중이면 맞는 묶음만 펼친다. 지금 문서가 있는 묶음은 기본으로 펼침.
      const list = sorted(all).filter((d) => textHit(d, q));
      $("libSideInfo").textContent = (q ? "검색 결과 " : "모든 자료 ") + list.length + "편 · 묶음을 눌러 펼치기";
      const groups = {}; const order = [];
      list.slice().sort((a, b) => crumb(a).localeCompare(crumb(b), "ko")).forEach((d) => {
        const g = domLabel(d.domain) + (d.track ? " › " + trackLabel(d.domain, d.track) : "");
        if (!groups[g]) { groups[g] = []; order.push(g); } groups[g].push(d);
      });
      order.forEach((g) => {
        const has = groups[g].some((d) => d.id === curId);
        const open = q ? true : (L2.allOpen[g] != null ? L2.allOpen[g] : has);
        const head = h("button", "lib2-side-gbtn" + (open ? " open" : ""), (open ? "▾ " : "▸ ") + g); head.type = "button";
        head.appendChild(h("span", "lib2-side-gn", String(groups[g].length)));
        head.addEventListener("click", () => { L2.allOpen[g] = !open; renderSide(); });
        box.appendChild(head);
        if (open) groups[g].forEach((d) => { const it = item(d, true); if (d.id === curId) it.classList.add("cur"); box.appendChild(it); });
      });
      if (!list.length) box.appendChild(h("p", "lib2-side-info", "검색 결과가 없어요."));
    }
    const cur = box.querySelector(".cur"); if (cur) cur.scrollIntoView({ block: "nearest" });
  }
  function neighbor(step) {
    const base = L2.order.length ? L2.order : hits().map((d) => d.id);
    const i = base.indexOf(curId);
    const j = i + step;
    if (i < 0 || j < 0 || j >= base.length) return null;
    return base[j];
  }
  function keyNav(e) {
    if (!curId || e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.key === "[") { const n = neighbor(-1); if (n) libOpen(n); }
    if (e.key === "]") { const n = neighbor(1); if (n) libOpen(n); }
  }

  // 읽기 배치 — LDS 문서 규약(lds:layout: toc·width·header). 허브·문서·이 앱이 같은 키를 공유한다.
  //   v78: 기본은 '앱에 맞춰 보기' — 문서 안 목차·이동 경로·바닥글을 숨기고(목차는 오른쪽 패널로), 색을 앱 테마에 맞춘다.
  //        '원본 그대로' 를 고르면 예전처럼 문서 자신의 배치(목차 위치·머리)를 쓴다.
  const AXES = {
    toc: { t: "문서 안 목차", o: [["left", "왼쪽"], ["right", "오른쪽"], ["top", "위(접이식)"], ["hidden", "숨김"]] },
    width: { t: "본문 폭", o: [["narrow", "좁게"], ["default", "기본"], ["wide", "넓게"], ["full", "최대"]] },
    header: { t: "문서 머리", o: [["static", "위(비고정)"], ["sticky", "위 고정"], ["rail", "왼쪽 세로"]] },
  };
  function readLayout() { try { const v = JSON.parse(localStorage.getItem("lds:layout") || "null"); return Object.assign({ toc: "left", width: "full", header: "static" }, v || {}); } catch (e) { return { toc: "left", width: "full", header: "static" }; } }   // (v95) 본문 폭 기본 = 최대
  function writeLayout(L) { try { localStorage.setItem("lds:layout", JSON.stringify(L)); } catch (e) { /* 계속 */ } applyReading(); renderLayoutPop(); audit("settings.change", "library.layout", L); }
  function applyReading() {
    try {
      const doc = lb.frame.contentDocument; if (!doc || !doc.documentElement) return;
      const L = readLayout(), r = doc.documentElement;
      const app = L2.readMode === "app";
      Object.keys(AXES).forEach((k) => { if (AXES[k].o.some((x) => x[0] === L[k])) r.setAttribute("data-" + k, L[k]); });
      if (app) { r.setAttribute("data-toc", "hidden"); r.setAttribute("data-header", "static"); r.setAttribute("data-app-reader", ""); }
      else r.removeAttribute("data-app-reader");
      r.style.zoom = L2.zoom !== 1 ? String(L2.zoom) : "";
    } catch (e) { /* 계속 */ }
  }
  /* 앱 읽기 스타일 — 문서 <head> 에 한 번 넣는다(같은 출처라 가능).
     ① 빠진 색 변수 채우기: 일부 문서의 그림이 --ink·--surface·--thrA 같은 '정의 안 된' 변수를 써서 검게 보였다 →
        그 문서 자신의 --fg·--bg-elev·--border 로 이어 준다. :where(:root) 라 문서가 직접 정의한 값이 늘 이긴다.
     ② 앱 테마 색: 문서의 --bg·--fg·--border·--accent… 를 지금 앱 색으로(따로 노는 느낌 없애기). 앱 스타일일 때만.
     ③ 문서 안 목차·이동 경로·진도 막대·바닥글 숨김(목차는 오른쪽 패널, 이전/다음은 앱 막대). */
  function injectReader() {
    let doc; try { doc = lb.frame.contentDocument; } catch (e) { return; }
    if (!doc || !doc.head) return;
    const cs = getComputedStyle(document.documentElement), g = (k) => cs.getPropertyValue(k).trim();
    const dark = document.documentElement.getAttribute("data-mode") !== "light";
    const css =
      ":where(:root){--ink:var(--fg);--ink-2:var(--fg-muted,var(--fg));--ink-3:var(--fg-muted,var(--fg));--surface:var(--bg-elev,var(--bg));--surface-2:var(--bg-soft,var(--bg));" +
      "--line:var(--border);--line-2:var(--border-strong,var(--border));--grid:var(--border);--accent-2:var(--info,var(--accent));--fail:var(--danger);--pass:var(--ok);--safe:var(--ok);" +
      "--thrA:" + (dark ? "#60a5fa" : "#2563eb") + ";--thrB:" + (dark ? "#fbbf24" : "#c27803") + ";}\n" +
      "html[data-app-reader][data-theme],html[data-app-reader]{--bg:" + g("--surface") + ";--bg-soft:" + g("--surface-2") + ";--bg-elev:" + g("--surface-2") + ";--bg-code:" + g("--surface-2") +
      ";--fg:" + g("--ink") + ";--fg-muted:" + g("--muted") + ";--border:" + g("--line") + ";--accent:" + g("--accent") + ";--link:" + g("--accent-strong") + ";--accent-soft:" + g("--accent-weak") + ";}\n" +
      // (v95) 본문 폭(좁게·기본·넓게)을 줄여도 본문 열을 가운데로 — 문서 CSS 는 max-width 만 주고 가운데 여백이 없다
      ":root[data-width] main{margin-left:auto;margin-right:auto;width:100%;box-sizing:border-box;}\n" +   // width:100% — 그리드 칸에서 auto 여백이 '내용 폭'으로 늘어나지 않게(모바일 넘침 방지)
      "html[data-app-reader] body{background:var(--bg);}\n" +
      "html[data-app-reader] .doc-toc,html[data-app-reader] nav.toc,html[data-app-reader] .toc-backdrop,html[data-app-reader] .toc-toggle,html[data-app-reader] .toc-close," +
      "html[data-app-reader] .breadcrumb,html[data-app-reader] .doc-tools,html[data-app-reader] .progress,html[data-app-reader] .doc-footer,html[data-app-reader] .doc-head .crumb{display:none!important}\n" +
      "html[data-app-reader] .doc-shell,html[data-app-reader] .doc-shell.has-toc{grid-template-columns:minmax(0,1fr)!important}\n" +
      "html[data-app-reader] .doc-header{border-bottom:1px solid var(--border);margin-bottom:8px}\n" +
      "html[data-app-reader] .doc-main p,html[data-app-reader] .doc-main li,html[data-app-reader] .wrap p,html[data-app-reader] .wrap li{line-height:1.8}\n" +
      "html[data-app-reader] h2,html[data-app-reader] h3{scroll-margin-top:16px}\n" +
      // 작성 단계 검토 표식(갈색 바탕·'검토 필요' 꼬리말) — 학습자 화면엔 소음이라 앱 보기에선 숨김(원본 보기에선 그대로)
      "html[data-app-reader] [data-needs-review]{background:transparent!important;border-left-color:transparent!important;padding-left:0!important}\n" +
      "html[data-app-reader] [data-needs-review]::after{display:none!important}\n" +
      "html[data-app-reader] .lib-toc-hit{outline:2px solid var(--accent);outline-offset:4px;border-radius:4px;transition:outline-color 1.2s}\n" +
      // (v119) 새 테마: 인쇄물에 화면 색이 섞이지 않게
      (window.RUIAPP && RUIAPP.on() ? "@media print{html[data-app-reader][data-theme],html[data-app-reader]{--bg:#fff;--bg-soft:#fff;--bg-elev:#fff;--bg-code:#f5f5f5;--fg:#000;--fg-muted:#333;--border:#bbb;--accent:#000;--link:#000;--accent-soft:#fff}}\n" : "");
    let st = doc.getElementById("app-reader-style");
    if (!st) { st = doc.createElement("style"); st.id = "app-reader-style"; doc.head.appendChild(st); }
    st.textContent = css;
  }
  function renderLayoutPop() {
    const pop = $("libLayoutPop"); if (!pop) return;
    const L = readLayout();
    pop.innerHTML = "";
    const row = (t, opts, cur, fn) => {
      const r = h("div", "qsrc-row"); r.appendChild(h("span", "wm-label", t));
      const seg = h("div", "seg");
      opts.forEach((o) => { const b = h("button", "seg-btn" + (cur === o[0] ? " active" : ""), o[1]); b.type = "button"; b.addEventListener("click", () => fn(o[0])); seg.appendChild(b); });
      r.appendChild(seg); pop.appendChild(r);
    };
    row("보기 방식", [["app", "앱에 맞춰 보기(권장)"], ["orig", "문서 원본 그대로"]], L2.readMode, (v) => { L2.readMode = v; saveState(); injectReader(); applyReading(); buildToc(); renderLayoutPop(); placeToc(); libFitHeight2(); });
    row(AXES.width.t, AXES.width.o, L.width, (v) => { const n = Object.assign({}, L); n.width = v; writeLayout(n); });
    row("오른쪽 목차", [["on", "보이기"], ["off", "숨기기"]], L2.tocOpen ? "on" : "off", (v) => { L2.tocOpen = v === "on"; saveState(); placeToc(); libFitHeight2(); renderLayoutPop(); });
    if (L2.readMode === "orig") {
      row(AXES.toc.t, AXES.toc.o, L.toc, (v) => { const n = Object.assign({}, L); n.toc = v; writeLayout(n); });
      row(AXES.header.t, AXES.header.o, L.header, (v) => { const n = Object.assign({}, L); n.header = v; writeLayout(n); });
    }
    pop.appendChild(h("p", "set-desc", L2.readMode === "app"
      ? "앱에 맞춰 보기: 가운데엔 본문만, 목차는 오른쪽 패널, 색은 지금 테마. 글자 크기는 A− A+."
      : "원본 그대로: 문서가 만든 배치·색으로 봐요(목차 위치·머리 고정은 LDS 규격 문서에만 적용)."));
  }

  /* ---- 오른쪽 목차 패널(v78) — 문서의 h2·h3 로 만든다(LDS·교재 문서 모두). 읽는 위치를 따라 현재 항목 표시 ---- */
  let TOC = [];
  function buildToc() {
    const list = $("libTocList"); if (!list) return;
    list.innerHTML = ""; TOC = [];
    let doc; try { doc = lb.frame.contentDocument; } catch (e) { doc = null; }
    if (!doc || !doc.body) return;
    const root = doc.querySelector(".doc-main, main, .wrap") || doc.body;
    const hs = Array.from(root.querySelectorAll("h2, h3")).filter((x) => !x.closest("nav, .doc-toc, .toc, header.doc-header, .doc-footer, footer, svg, figure") && x.textContent.trim());
    hs.forEach((x, i) => {
      if (!x.id) x.id = "lib-h-" + i;
      const t = x.textContent.replace(/[¶#]\s*$/, "").replace(/\s+/g, " ").trim();
      const a = h("a", "lib2-toc-i lv" + (x.tagName === "H3" ? 3 : 2), t); a.href = "#" + x.id; a.title = t;
      a.addEventListener("click", (e) => {
        e.preventDefault();
        try { x.scrollIntoView({ block: "start", behavior: "smooth" }); x.classList.add("lib-toc-hit"); setTimeout(() => x.classList.remove("lib-toc-hit"), 1400); } catch (er) { /* 계속 */ }
        if (lb.viewer.classList.contains("toc-drawer")) lb.viewer.classList.remove("toc-drawer-open");
      });
      list.appendChild(a); TOC.push({ h: x, a: a });
    });
    $("libTocCount").textContent = TOC.length ? String(TOC.length) : "";
    if (!TOC.length) list.appendChild(h("p", "lib2-side-info", "이 문서에는 목차로 쓸 제목이 없어요."));
    tocSpy();
  }
  function tocSpy() {
    if (!TOC.length) return;
    let cur = TOC[0];
    for (const t of TOC) { let top = 0; try { top = t.h.getBoundingClientRect().top; } catch (e) { top = 0; } if (top <= 90) cur = t; else break; }
    TOC.forEach((t) => t.a.classList.toggle("on", t === cur));
    const list = $("libTocList"); const a = cur.a;
    if (list && a && (a.offsetTop < list.scrollTop + 30 || a.offsetTop > list.scrollTop + list.clientHeight - 40)) list.scrollTop = Math.max(0, a.offsetTop - list.clientHeight / 3);
  }
  // 목차 자리: 와이드 = 본문 오른쪽 열 / 일반 폭 = 본문 열 밖 오른쪽 여백(본문은 일반 폭 그대로) / 여백이 좁으면 서랍
  function placeToc() {
    const reader = lb.viewer, toc = $("libToc"); if (!reader || !toc) return;
    reader.classList.remove("toc-col", "toc-gutter", "toc-drawer", "toc-off", "toc-drawer-open");
    toc.style.left = toc.style.top = toc.style.width = toc.style.height = "";
    if (!L2.tocOpen) { reader.classList.add("toc-off"); paintTocBtn(); return; }
    const short = document.documentElement.getAttribute("data-width") === "short";
    const W = 250;
    if (!short) {
      if (window.innerWidth >= 1180) reader.classList.add("toc-col"); else reader.classList.add("toc-drawer");
      paintTocBtn(); return;
    }
    reader.classList.add("toc-gutter");
    const pane = reader.querySelector(".lib2-pane").getBoundingClientRect();
    const gutter = window.innerWidth - pane.right;
    if (gutter >= W + 20) {
      const top = Math.max(pane.top, 70);
      toc.style.left = Math.round(pane.right + 14) + "px"; toc.style.top = Math.round(top) + "px";
      toc.style.width = W + "px"; toc.style.height = Math.round(window.innerHeight - top - 14) + "px";
    } else { reader.classList.remove("toc-gutter"); reader.classList.add("toc-drawer"); }
    paintTocBtn();
  }
  function paintTocBtn() { const b = $("libTocToggle"); if (b) b.classList.toggle("on", L2.tocOpen); }

  // 왼쪽 목록 자리: 와이드 = 본문 안 2단 / 일반(숏) = 본문 열 밖 왼쪽 여백(본문은 일반 폭을 그대로) / 여백이 좁으면 서랍
  function placeSide() {
    const reader = lb.viewer, side = $("libSide"); if (!reader || !side) return;
    const short = document.documentElement.getAttribute("data-width") === "short";
    reader.classList.remove("side-grid", "side-gutter", "side-drawer");
    side.style.left = side.style.top = side.style.width = "";
    if (!L2.sideOpen || document.documentElement.getAttribute("data-width") === "short") side.style.height = "";
    if (!L2.sideOpen) { reader.classList.add("side-off"); return; }
    reader.classList.remove("side-off");
    const W = 300;
    if (!short) {                                          // 와이드라도 창이 좁으면(본문이 눌리면) 서랍으로
      if (window.innerWidth < 1100) { reader.classList.add("side-drawer"); return; }
      reader.classList.add("side-grid"); return;
    }
    reader.classList.add("side-gutter");                  // 먼저 띄워 놓고(흐름에서 빼고) 본문 자리를 잰다
    const pane = reader.querySelector(".lib2-pane").getBoundingClientRect();
    const gutter = pane.left;
    if (gutter >= W + 20) {
      const top = Math.max(pane.top, 70);
      side.style.left = Math.round(pane.left - W - 14) + "px";
      side.style.top = Math.round(top) + "px";
      side.style.width = W + "px";
      side.style.height = Math.round(window.innerHeight - top - 14) + "px";
    } else {
      reader.classList.remove("side-gutter");
      reader.classList.add("side-drawer");
    }
  }
  function libFitHeight2() {
    const f = lb.frame;
    if (!f || !lb.viewer || lb.viewer.classList.contains("hidden")) return;
    // 2단(와이드)일 때 왼쪽 목록이 페이지를 늘리지 않게 먼저 화면 높이로 묶는다(목록 안에서만 스크롤)
    const toc0 = $("libToc");
    if (toc0 && lb.viewer.classList.contains("toc-col")) { const tt = toc0.getBoundingClientRect().top; toc0.style.height = Math.max(300, Math.round(window.innerHeight - tt - 14)) + "px"; }
    const side0 = $("libSide");
    if (side0 && lb.viewer.classList.contains("side-grid")) {
      const st = side0.getBoundingClientRect().top;
      side0.style.height = Math.max(300, Math.round(window.innerHeight - st - 14)) + "px";
    }
    const top = f.getBoundingClientRect().top;
    let hh = Math.max(360, Math.round(window.innerHeight - top - 14));
    f.style.height = hh + "px";
    const over = document.documentElement.scrollHeight - window.innerHeight;
    if (over > 0) f.style.height = Math.max(360, hh - over) + "px";
    if (!lb.viewer.classList.contains("side-grid")) placeSide();
    if (lb.viewer.classList.contains("toc-gutter")) placeToc();
  }

  /* ---- 자료 등록(관리자) — HTML 파일 → doc-meta 읽기 → 등록(IndexedDB/서버) + 번들용 파일 안내 ---- */
  async function openUpload() {
    let dlg = $("libUploadDlg");
    if (!dlg) {
      dlg = h("div", "lib2-dlg"); dlg.id = "libUploadDlg";
      document.body.appendChild(dlg);
    }
    dlg.innerHTML = "";
    const card = h("div", "card lib2-dlg-card");
    card.appendChild(h("h3", "set-h3", "⬆ 학습 자료 등록"));
    card.appendChild(h("p", "set-desc", "단일 HTML 파일(스타일·스크립트를 품은 LDS 문서)을 올리면 바로 목록에 나와요. 파일 안의 <script id=\"doc-meta\"> 를 읽어 분류·수준·태그를 채우고, 없으면 아래에서 입력해요. 자세한 규격은 [도움말 → 학습 자료 만들기]."));
    const f = document.createElement("input"); f.type = "file"; f.accept = ".html,.htm,text/html"; card.appendChild(f);
    const form = h("div", "lib2-upform"); card.appendChild(form);
    const msg = h("p", "data-tools-msg"); card.appendChild(msg);
    const acts = h("div", "rec-actions"); card.appendChild(acts);
    const close = h("button", "ghost-btn", "닫기"); close.type = "button"; close.addEventListener("click", () => dlg.remove());
    let html = "", meta = null;
    const fields = [["id", "id(파일 이름, 영소문자·숫자·하이픈)"], ["title", "제목"], ["summary", "한 줄 요약"], ["domain", "분류(domain)"], ["track", "갈래(track)"], ["topic", "주제(topic)"],
      ["level", "수준(beginner/intermediate/advanced/reference)"], ["minutes", "분량(분)"], ["tags", "태그(쉼표로)"]];
    const inputs = {};
    f.addEventListener("change", () => {
      const file = f.files && f.files[0]; if (!file) return;
      const rd = new FileReader();
      rd.onload = () => {
        html = String(rd.result || "");
        meta = {};
        const m = html.match(/<script[^>]*id=["']doc-meta["'][^>]*>([\s\S]*?)<\/script>/i);
        if (m) { try { meta = JSON.parse(m[1]); } catch (e) { meta = {}; msg.textContent = "doc-meta JSON 을 읽지 못했어요 — 아래 칸을 직접 채워 주세요."; } }
        if (!meta.id) meta.id = file.name.replace(/\.html?$/i, "").toLowerCase().replace(/[^a-z0-9-]+/g, "-");
        if (!meta.title) { const t = html.match(/<title>([^<]{1,200})<\/title>/i); meta.title = t ? t[1].trim() : meta.id; }
        form.innerHTML = "";
        fields.forEach((x) => {
          const l = h("label", "rec-fl"); l.appendChild(h("span", "", x[1]));
          const i = document.createElement("input"); i.type = "text";
          const v = meta[x[0]]; i.value = Array.isArray(v) ? v.join(", ") : (v == null ? "" : String(v));
          inputs[x[0]] = i; l.appendChild(i); form.appendChild(l);
        });
        msg.textContent = (m ? "doc-meta 를 읽었어요. " : "doc-meta 가 없어 파일 이름·제목으로 채웠어요. ") + "확인하고 [등록]을 누르세요. (" + Math.round(html.length / 1024) + " KB)";
        msg.className = "data-tools-msg ok";
      };
      rd.readAsText(file, "utf-8");
    });
    const save = h("button", "primary", "등록"); save.type = "button";
    save.addEventListener("click", async () => {
      if (!html) { msg.textContent = "HTML 파일을 먼저 고르세요."; msg.className = "data-tools-msg bad"; return; }
      const m2 = Object.assign({ schema: "lds/1.0", status: "published", updated: todayISO() }, meta || {});
      Object.keys(inputs).forEach((k) => { const v = inputs[k].value.trim(); m2[k] = (k === "tags" || k === "subjects") ? v.split(",").map((x) => x.trim()).filter(Boolean) : k === "minutes" ? (parseInt(v, 10) || 0) : v; });
      if (!m2.domain) m2.domain = "misc";
      const r = await Api.library.uploadDoc(m2, html);
      if (!r || !r.ok) { msg.textContent = (r && r.message) || "등록하지 못했어요."; msg.className = "data-tools-msg bad"; return; }
      audit("library.upload", m2.id, { title: m2.title, bytes: html.length });
      libState.catalog = null; await libCatalog(); libRender2();
      msg.innerHTML = "등록했어요 — 목록에 <b>앱 등록</b> 배지로 나와요. " + (Api.MODE === "remote" ? "서버에 저장됐어요." :
        "이 브라우저에만 저장돼요. 모두가 쓰는 기본 자료로 넣으려면 아래 [파일 받기] → <code>app-html/library/docs/" + m2.id + ".html</code> 로 저장 → <code>python app-html/library/build_library.py</code> 실행.");
      msg.className = "data-tools-msg ok";
      const dl = h("button", "ghost-btn", "⬇ 파일 받기(" + m2.id + ".html)"); dl.type = "button";
      dl.addEventListener("click", () => { const b = new Blob([html], { type: "text/html" }); const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href = u; a.download = m2.id + ".html"; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(u); });
      acts.insertBefore(dl, close);
    });
    acts.appendChild(save); acts.appendChild(close);
    // 등록한 자료 관리
    try {
      const up = await Api.library.uploadedList();
      if (up && up.length) {
        card.appendChild(h("p", "rec-sec-h", "앱에서 등록한 자료 " + up.length + "편"));
        up.forEach((x) => {
          const row = h("div", "audit-row");
          row.appendChild(h("span", "audit-target", (x.meta && x.meta.title) || x.id));
          row.appendChild(h("span", "audit-detail", x.id + " · " + Math.round(x.bytes / 1024) + " KB · " + recFmtTs(x.ts)));
          const del = h("button", "mini-btn danger", "지우기"); del.type = "button";
          del.addEventListener("click", async () => { if (!confirm(x.id + " 를 지울까요?")) return; await Api.library.removeDoc(x.id); audit("library.remove", x.id, {}); libState.catalog = null; row.remove(); libRender2(); });
          row.appendChild(del); card.appendChild(row);
        });
      }
    } catch (e) { /* 계속 */ }
    dlg.appendChild(card);
  }

  /* ---- 묶기 ---------------------------------------------------------- */
  function bind() {
    const q = $("libSearch");
    if (q) { q.value = L2.q; let t = 0; q.addEventListener("input", () => { L2.q = q.value; L2.page = 1; clearTimeout(t); t = setTimeout(libRender2, 120); }); }
    $("libSort").addEventListener("change", (e) => { L2.sort = e.target.value; L2.rev = false; changed(); });
    $("libSelectBtn").addEventListener("click", () => { L2.selecting = !L2.selecting; if (!L2.selecting) L2.sel = {}; libRender2(); });
    $("libUploadBtn").addEventListener("click", openUpload);
    $("libFacetToggle").addEventListener("click", () => { L2.facetsOpen = !L2.facetsOpen; saveState(); renderFacets(); });
    $("libSideToggle").addEventListener("click", () => {
      // 서랍 모드(왼쪽 여백이 좁은 일반 폭)에서는 서랍만 여닫는다
      if (lb.viewer.classList.contains("side-drawer")) { lb.viewer.classList.toggle("drawer-open"); return; }
      L2.sideOpen = !L2.sideOpen; saveState(); placeSide(); libFitHeight2();
    });
    $("libSideClose").addEventListener("click", () => {
      if (lb.viewer.classList.contains("side-drawer")) { lb.viewer.classList.remove("drawer-open"); return; }
      L2.sideOpen = false; saveState(); placeSide(); libFitHeight2();
    });
    document.querySelectorAll("#libSideScope .seg-btn").forEach((b) => b.addEventListener("click", () => { L2.sideScope = b.dataset.scope; saveState(); renderSide(); }));
    $("libTocToggle").addEventListener("click", () => {
      if (lb.viewer.classList.contains("toc-drawer")) { lb.viewer.classList.toggle("toc-drawer-open"); return; }
      L2.tocOpen = !L2.tocOpen; saveState(); placeToc(); libFitHeight2();
    });
    $("libTocClose").addEventListener("click", () => {
      if (lb.viewer.classList.contains("toc-drawer")) { lb.viewer.classList.remove("toc-drawer-open"); return; }
      L2.tocOpen = false; saveState(); placeToc(); libFitHeight2();
    });
    const sq = $("libSideSearch"); let t2 = 0;
    sq.addEventListener("input", () => { L2.sideQ = sq.value; clearTimeout(t2); t2 = setTimeout(renderSide, 100); });
    $("libPrev").addEventListener("click", () => { const n = neighbor(-1); if (n) libOpen(n); });
    $("libNext").addEventListener("click", () => { const n = neighbor(1); if (n) libOpen(n); });
    $("libZoomIn").addEventListener("click", () => { L2.zoom = Math.min(1.6, Math.round((L2.zoom + 0.1) * 10) / 10); saveState(); applyReading(); });
    $("libZoomOut").addEventListener("click", () => { L2.zoom = Math.max(0.7, Math.round((L2.zoom - 0.1) * 10) / 10); saveState(); applyReading(); });
    $("libLayoutBtn").addEventListener("click", () => { const p = $("libLayoutPop"); p.classList.toggle("hidden"); renderLayoutPop(); libFitHeight2(); });
    $("libFav").addEventListener("click", () => { if (curId) favToggle(curId); paintFav(); });
    $("libPrint").addEventListener("click", () => { try { lb.frame.contentWindow.print(); audit("data.print", "library:" + curId, {}); } catch (e) { /* 계속 */ } });
    document.addEventListener("keydown", (e) => {
      if (state.nav !== "library") return;
      if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test((e.target || {}).tagName || "")) { e.preventDefault(); (curId ? $("libSideSearch") : $("libSearch")).focus(); }
      keyNav(e);
    });
    window.addEventListener("resize", () => { if (curId) { placeSide(); placeToc(); libFitHeight2(); } });
    // 표시 설정(폭 모드)이 바뀌면 목록 자리를 다시 잡는다
    new MutationObserver(() => { if (curId) setTimeout(() => { placeSide(); placeToc(); libFitHeight2(); }, 30); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-width", "data-barwidth", "data-layout"] });
    // 라이트/다크·색 테마가 바뀌면 문서 색도 다시 맞춘다
    new MutationObserver(() => { if (curId) setTimeout(() => { libSyncFrameTheme(); injectReader(); }, 30); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-mode", "data-theme"] });
    window.addEventListener("beforeunload", saveProgressNow);
  }
  async function openLibrary2() {
    // (v98) 기본 보기를 게시판형 '목록'(table)으로 — 예전 기본값 'list'(지금의 카드 목록)였던 사람만 한 번 옮긴다(설정을 다 불러온 뒤라 여기서)
    try { if (typeof SETTINGS === "object" && !SETTINGS.lib_view_v98) { if (!SETTINGS.lib_view || SETTINGS.lib_view === "list") SETTINGS.lib_view = "table"; SETTINGS.lib_view_v98 = 1; if (typeof persistSettings === "function") persistSettings(); } } catch (e) { /* 계속 */ }
    hide(lb.viewer); show(lb.browse);
    document.body.classList.remove("lib-reading");
    await loadMeta();
    try { const u = await Api.currentUser(); $("libUploadBtn").classList.toggle("hidden", !(u && u.role === "admin")); } catch (e) { /* 계속 */ }
    try { await libRender2(); } catch (e) { if ($("libCount")) $("libCount").textContent = "자료 목록을 불러오지 못했어요"; console.warn("library:", e); }
  }

  // app.js 의 전역 함수 교체
  window.libRender = libRender2;
  window.libOpen = async function (id) { await loadMeta(); return libOpen2(id); };
  window.libClose = libClose2;
  window.openLibrary = openLibrary2;
  window.libFitHeight = libFitHeight2;
  window.LIB2 = { markLegacy: () => markLegacy(libState.catalog), state: L2, render: libRender2, select: (ids) => { L2.selecting = true; (ids || []).forEach((i) => { L2.sel[i] = 1; }); libRender2(); } };
  loadState();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind); else bind();
})();
