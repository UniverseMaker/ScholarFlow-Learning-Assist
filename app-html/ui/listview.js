/* ScholarFlow: 연구행정 adminv52 ui/listview.js 복사본 + 행 메뉴(o.action)·그림 html(o.imgHtml). 앞의 UI 는 이 앱에서 쓰는 최소 도우미다. */
(function () {
  var UI = window.UI = window.UI || {};
  UI.esc = UI.esc || function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  UI.$ = UI.$ || function (s, el) { return (el || document).querySelector(s); };
  UI.$$ = UI.$$ || function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  UI.drawer = UI.drawer || function (title, sub, html) {
    var o = document.getElementById("overlay"); if (!o) { o = document.createElement("div"); o.id = "overlay"; o.className = "rui rui-embed"; document.body.appendChild(o); }
    o.innerHTML = '<div class="scrim" data-x></div><aside class="drawer" role="dialog" aria-label="' + UI.esc(title) + '"><div class="drawer-head"><div><h2>' + UI.esc(title) + '</h2><p class="muted small">' + UI.esc(sub || "") + '</p></div><button type="button" class="icon-btn" data-x aria-label="닫기">×</button></div><div class="drawer-body">' + html + "</div></aside>";
    o.onclick = function (e) { if (e.target.closest("[data-x]")) { o.innerHTML = ""; o.onchange = null; } };
  };
})();
/* listview.js — 목록 화면 공통 부품. 표, 카드, 트리 보기와 묶음, 정렬, 찾기, 표시 옵션, 내려받기.
   UI.listView(요소, 설정). 보기와 옵션은 화면별로 이 기기에 저장한다.
   설정: key, rows, columns[{k,label,get,cls,on,tag}], title(행), sub(행), img(행), search(행), groups[{k,label,path(행)}],
         views(기본 table·card·tree), open(행), empty, name(내려받기 파일 이름), mark(행 → 'danger'|'warn'|'') */
(function (global) {
  'use strict';
  var UI = global.UI, esc = UI.esc, KEY = 'ui_list_';
  var VIEWS = { table: ['표', 'M4 6h16M4 12h16M4 18h16'], card: ['카드', 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z'], tree: ['트리', 'M5 4v14h5M5 11h5M14 4h6v4h-6zM14 10h6v4h-6zM14 16h6v4h-6z'] };
  function load(k, d) { try { return Object.assign(d, JSON.parse(localStorage.getItem(KEY + k) || '{}')); } catch (e) { return d; } }
  function save(k, s) { try { localStorage.setItem(KEY + k, JSON.stringify({ view: s.view, group: s.group, photo: s.photo, dense: s.dense, cols: s.cols, sort: s.sort, dir: s.dir })); } catch (e) { /* 이번 화면에만 적용된다 */ } }
  function svg(d) { return '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="' + d + '"/></svg>'; }

  UI.listView = function (el, o) {
    var views = o.views || ['table', 'card', 'tree'], cols = o.columns || [];
    var S = load(o.key, { view: views[0], group: o.groups && o.groups[0] ? o.groups[0].k : '', photo: !!o.img, dense: false, cols: {}, sort: '', dir: 1 });
    if (views.indexOf(S.view) < 0) S.view = views[0];
    var q = '', node = '', open = {};
    var on = function (c) { return S.cols[c.k] !== undefined ? S.cols[c.k] : c.on !== false; };
    var cell = function (c, r) { return c.get ? c.get(r) : r[c.k]; };
    var group = function () { return (o.groups || []).filter(function (g) { return g.k === S.group; })[0]; };
    var thumb = function (r, cls) {
      if (!o.img || !S.photo) return '';
      if (o.imgHtml) return '<span class="lv-img ' + (cls || '') + '">' + o.imgHtml(r, cls) + '</span>';
      var u = o.img(r), t = o.title(r);
      return '<span class="lv-img ' + (cls || '') + '">' + (u ? '<img src="' + esc(u) + '" alt="" loading="lazy">' : '<i aria-hidden="true">' + esc(String(t || '').slice(0, 1)) + '</i>') + '</span>';
    };
    var val = function (c, r) { var v = cell(c, r); return c.tag && v ? '<span class="tag ' + esc(c.tag(r) || '') + '">' + esc(v) + '</span>' : esc(v == null || v === '' ? '-' : v); };
    function hits() {
      var k = q.toLowerCase(), a = o.rows.filter(function (r) { return !k || String(o.search ? o.search(r) : o.title(r)).toLowerCase().indexOf(k) >= 0; });
      if (node) { var g = group(); a = a.filter(function (r) { return g.path(r).join('\u0001').indexOf(node) === 0; }); }
      if (S.sort) {
        var c = cols.filter(function (x) { return x.k === S.sort; })[0] || { k: 'title', get: o.title };
        a = a.slice().sort(function (x, y) { var p = cell(c, x), r = cell(c, y); return (typeof p === 'number' && typeof r === 'number' ? p - r : String(p == null ? '' : p).localeCompare(String(r == null ? '' : r), 'ko', { numeric: true })) * S.dir; });
      }
      return a;
    }
    function table(rows) {
      var shown = cols.filter(on);
      var head = '<thead><tr><th><button type="button" data-sort="title">' + esc(o.titleLabel || '이름') + (S.sort === 'title' ? (S.dir > 0 ? ' ↑' : ' ↓') : '') + '</button></th>' + shown.map(function (c) { return '<th class="' + esc(c.cls || '') + '"><button type="button" data-sort="' + esc(c.k) + '">' + esc(c.label) + (S.sort === c.k ? (S.dir > 0 ? ' ↑' : ' ↓') : '') + '</button></th>'; }).join('') + (o.action ? '<th></th>' : '') + '</tr></thead>';
      var line = function (r) {
        return '<tr data-row="' + esc(r.__i) + '" class="lv-row ' + (o.mark && o.mark(r) ? 'lv-' + esc(o.mark(r)) : '') + '"><td><div class="lv-t">' + thumb(r, 'sm') + '<div><b>' + esc(o.title(r)) + '</b>' + (o.badge ? o.badge(r) : '') + (o.sub ? '<small>' + esc(o.sub(r)) + '</small>' : '') + '</div></div></td>' + shown.map(function (c) { return '<td class="' + esc(c.cls || '') + '">' + val(c, r) + '</td>'; }).join('') + (o.action ? '<td class="lv-act" data-lv-act>' + o.action(r) + '</td>' : '') + '</tr>';
      };
      var g = group(), body;
      if (g && S.view === 'table' && o.groupTable !== false && S.group && S.tableGroup) body = '';
      body = rows.map(line).join('');
      return '<div class="table-wrap"><table class="' + (S.dense ? 'lv-dense' : '') + '">' + head + '<tbody>' + body + '</tbody></table></div>';
    }
    function cards(rows) {
      var shown = cols.filter(on).slice(0, 4);
      return '<div class="lv-cards">' + rows.map(function (r) {
        return '<div class="lv-card" role="link" tabindex="0" data-row="' + esc(r.__i) + '">' + (o.img && S.photo ? thumb(r, 'lg') : '') + '<span class="lv-c"><b>' + esc(o.title(r)) + '</b>' + (o.badge ? o.badge(r) : '') + (o.sub ? '<small>' + esc(o.sub(r)) + '</small>' : '') + '<span class="lv-f">' + shown.map(function (c) { return '<span><em>' + esc(c.label) + '</em>' + val(c, r) + '</span>'; }).join('') + '</span></span>' + (o.action ? '<span class="lv-act" data-lv-act>' + o.action(r) + '</span>' : '') + '</div>';
      }).join('') + '</div>';
    }
    function tree() {   // 왼쪽 묶음 나무, 오른쪽 목록
      var g = group(), root = { n: 0, kids: {} };
      o.rows.forEach(function (r) { var cur = root; root.n++; g.path(r).forEach(function (p) { p = p || '미지정'; cur = cur.kids[p] = cur.kids[p] || { n: 0, kids: {} }; cur.n++; }); });
      var draw = function (t, pre, depth) {
        return Object.keys(t.kids).sort(function (a, b) { return t.kids[b].n - t.kids[a].n; }).map(function (k) {
          var p = pre ? pre + '\u0001' + k : k, c = t.kids[k], has = Object.keys(c.kids).length, isOpen = open[p] !== false && (depth < 1 || open[p]);
          return '<li><div class="lv-node' + (node === p ? ' on' : '') + '" style="padding-left:' + (8 + depth * 14) + 'px">' + (has ? '<button type="button" class="lv-tw" data-tw="' + esc(p) + '" aria-expanded="' + (!!isOpen) + '" aria-label="펼치기">' + (isOpen ? '−' : '+') + '</button>' : '<span class="lv-tw"></span>') + '<button type="button" class="lv-nm" data-node="' + esc(p) + '"><span>' + esc(k) + '</span><small>' + c.n + '</small></button></div>' + (has && isOpen ? '<ul>' + draw(c, p, depth + 1) + '</ul>' : '') + '</li>';
        }).join('');
      };
      return '<div class="lv-tree"><nav aria-label="분류"><div class="lv-node' + (node ? '' : ' on') + '"><span class="lv-tw"></span><button type="button" class="lv-nm" data-node=""><span>전체</span><small>' + root.n + '</small></button></div><ul>' + draw(root, '', 0) + '</ul></nav><div class="lv-tree-r">' + table(hits()) + '</div></div>';
    }
    function paint() {
      o.rows.forEach(function (r, i) { r.__i = i; });
      var a = S.view === 'tree' ? [] : hits(), box = UI.$('.lv-body', el);
      var html = S.view === 'tree' ? tree() : !a.length ? '<p class="panel-empty">' + esc(o.empty || '찾은 항목이 없습니다.') + '</p>' : S.view === 'card' ? cards(a) : table(a);
      box.innerHTML = html;
      UI.$('.lv-count', el).textContent = (S.view === 'tree' ? hits().length : a.length) + '건';
    }
    function head() {
      var gs = o.groups || [];
      return '<div class="tools lv-tools">' + (o.noSearch ? '' : '<input class="input search" type="search" placeholder="' + esc(o.placeholder || '찾기') + '" aria-label="찾기">') + '<span class="lv-count muted small"></span><span class="spacer"></span>' +
        (gs.length ? '<label class="lv-group"><span class="muted small">묶기</span><select class="input" aria-label="묶는 기준">' + gs.map(function (g) { return '<option value="' + esc(g.k) + '"' + (g.k === S.group ? ' selected' : '') + '>' + esc(g.label) + '</option>'; }).join('') + '</select></label>' : '') +
        '<div class="seg" role="group" aria-label="보기">' + views.map(function (v) { return '<button type="button" data-view="' + v + '" class="' + (S.view === v ? 'on' : '') + '" aria-pressed="' + (S.view === v) + '">' + svg(VIEWS[v][1]) + VIEWS[v][0] + '</button>'; }).join('') + '</div>' +
        '<button type="button" class="btn" data-opts>표시 옵션</button><button type="button" class="btn" data-csv>내려받기</button></div>';
    }
    function opts() {
      UI.drawer('표시 옵션', '이 기기에 저장됩니다', '<div class="stack" style="padding:14px 16px">' +
        (o.img ? '<label class="lv-ck"><input type="checkbox" data-o="photo"' + (S.photo ? ' checked' : '') + '>사진 보기</label>' : '') +
        '<label class="lv-ck"><input type="checkbox" data-o="dense"' + (S.dense ? ' checked' : '') + '>줄 간격 좁게</label>' +
        '<h3 class="small">표에 보일 항목</h3>' + cols.map(function (c) { return '<label class="lv-ck"><input type="checkbox" data-c="' + esc(c.k) + '"' + (on(c) ? ' checked' : '') + '>' + esc(c.label) + '</label>'; }).join('') + '</div>');
      UI.$('#overlay').onchange = function (e) {
        var i = e.target; if (i.dataset.o) S[i.dataset.o] = i.checked; if (i.dataset.c) S.cols[i.dataset.c] = i.checked;
        save(o.key, S); paint();
      };
    }
    function csv() {
      var q2 = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
      var lines = [[o.titleLabel || '이름'].concat(cols.map(function (c) { return c.label; })).map(q2).join(',')].concat(hits().map(function (r) { return [o.title(r)].concat(cols.map(function (c) { return cell(c, r); })).map(q2).join(','); }));
      var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })); a.download = (o.name || o.key) + '.csv'; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    }
    el.innerHTML = head() + '<div class="lv-body"></div>';
    var qi = UI.$('.search', el); if (qi) qi.oninput = function (e) { q = e.target.value.trim(); paint(); };
    var sel = UI.$('.lv-group select', el); if (sel) sel.onchange = function () { S.group = sel.value; node = ''; save(o.key, S); paint(); };
    el.onclick = function (e) {
      if (e.target.closest('[data-lv-act]')) return;
      var b = e.target.closest('[data-view],[data-opts],[data-csv],[data-sort],[data-node],[data-tw],[data-row]'); if (!b) return;
      if (b.dataset.view) { S.view = b.dataset.view; node = ''; UI.$$('[data-view]', el).forEach(function (x) { var y = x === b; x.classList.toggle('on', y); x.setAttribute('aria-pressed', String(y)); }); save(o.key, S); paint(); return; }
      if (b.dataset.opts !== undefined) return opts();
      if (b.dataset.csv !== undefined) return csv();
      if (b.dataset.sort) { if (S.sort === b.dataset.sort) S.dir = -S.dir; else { S.sort = b.dataset.sort; S.dir = 1; } save(o.key, S); paint(); return; }
      if (b.dataset.tw !== undefined) { open[b.dataset.tw] = b.getAttribute('aria-expanded') !== 'true'; paint(); return; }
      if (b.dataset.node !== undefined) { node = b.dataset.node; paint(); return; }
      if (b.dataset.row !== undefined && o.open) o.open(o.rows[+b.dataset.row]);
    };
    paint();
  };
})(window);
/* 이 앱의 목록 틀: 새 테마에서만 쓴다. 이전 테마는 예전 목록 그대로 */
window.SLCLV = {
  on: function () { return !!(window.RUIAPP && RUIAPP.on() && window.UI && UI.listView); },
  mount: function (el, cfg) { el.innerHTML = '<div class="rui rui-embed panel lv-wrap"></div>'; UI.listView(el.firstChild, cfg); },
  day: function (t) { if (!t) return ""; var d = new Date(t); return isNaN(d) ? "" : d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); },
};
