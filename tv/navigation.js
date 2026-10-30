/* Predictable remote navigation: horizontal rows, vertical lanes, stable focus. ES5. */
(function (root) {
  'use strict';
  var doc = root.document;
  var attributes = ['id','data-page','data-video','data-service','data-launch-app','data-pin-app','data-action','data-play','data-favorite','data-job','data-job-action','data-wait','data-ready-video','data-remote','data-receiver','data-tv-service','data-send-tv'];
  function items(scope) {
    return Array.prototype.filter.call(scope.querySelectorAll('button,input'), function (node) { return !node.disabled && node.offsetWidth > 0 && node.offsetHeight > 0; });
  }
  function capture(scope) {
    var node = doc.activeElement;
    if (!scope || !scope.contains || !scope.contains(node)) return null;
    var key = {};
    attributes.forEach(function (name) { if (node.hasAttribute(name)) key[name] = node.getAttribute(name); });
    return Object.keys(key).length ? key : null;
  }
  function find(scope, key) {
    if (!scope || !key) return null;
    return items(scope).filter(function (node) { return Object.keys(key).every(function (name) { return node.getAttribute(name) === key[name]; }); })[0] || null;
  }
  function focus(node) {
    if (!node) return;
    try { node.focus({preventScroll:true}); } catch (_) { node.focus(); }
    var rail = node.closest('.row'), rect = node.getBoundingClientRect(), box;
    if (rail) {
      box = rail.getBoundingClientRect();
      if (rect.left < box.left + 14) rail.scrollLeft -= box.left + 14 - rect.left;
      else if (rect.right > box.right - 14) rail.scrollLeft += rect.right - box.right + 14;
    }
    rect = node.getBoundingClientRect();
    var dialog = node.closest('.dialog'), header = doc.querySelector('header');
    var top = dialog ? dialog.getBoundingClientRect().top + 20 : header ? header.getBoundingClientRect().bottom + 20 : 20;
    var bottom = dialog ? dialog.getBoundingClientRect().bottom - 20 : root.innerHeight - 55;
    var delta = rect.top < top ? rect.top - top : rect.bottom > bottom ? rect.bottom - bottom : 0;
    if (delta) { if (dialog) dialog.scrollTop += delta; else root.scrollBy(0, delta); }
  }
  function first(scope) {
    var available = items(scope), preferred = available.filter(function (node) { return node.matches('.service,.movie,.installed-launch,button.primary'); });
    focus(preferred[0] || available[0]);
  }
  function restore(scope, key, fallback) {
    var found = find(scope, key);
    if (found) focus(found); else if (fallback) first(scope);
    return !!found;
  }
  function lanes(available) {
    var groups = [], rows = [];
    available.forEach(function (node) {
      var group = node.closest('.row,.actions,.grid,.services-grid,.installed-grid,.hub-shortcuts,.settings-form,.dialog,nav') || node.parentElement;
      var entry = groups.filter(function (g) { return g.node === group; })[0];
      if (!entry) { entry = {node:group, items:[]}; groups.push(entry); }
      entry.items.push({node:node, rect:node.getBoundingClientRect()});
    });
    groups.forEach(function (group) {
      var local = [];
      group.items.sort(function (a,b) { return a.rect.top - b.rect.top || a.rect.left - b.rect.left; }).forEach(function (item) {
        var row = local.filter(function (line) { return Math.min(line.bottom,item.rect.bottom) - Math.max(line.top,item.rect.top) > Math.min(line.bottom-line.top,item.rect.height) * .5; })[0];
        if (!row) { row = {items:[],top:item.rect.top,bottom:item.rect.bottom}; local.push(row); rows.push(row); }
        row.items.push(item); row.top = Math.min(row.top,item.rect.top); row.bottom = Math.max(row.bottom,item.rect.bottom);
      });
    });
    rows.forEach(function (row) { row.items.sort(function (a,b) { return a.rect.left - b.rect.left; }); });
    return rows;
  }
  function move(scope, direction, contentKey) {
    var available = items(scope), current = doc.activeElement;
    if (available.indexOf(current) < 0) { first(scope); return; }
    var nav = doc.getElementById('navigation'), content = doc.getElementById('content');
    if (scope.id === 'app' && nav.contains(current)) {
      var tabs = items(nav), at = tabs.indexOf(current);
      if (direction === 37 || direction === 39) focus(tabs[at + (direction === 37 ? -1 : 1)]);
      else if (direction === 40) restore(content, contentKey, true);
      return;
    }
    // The header is entered only when moving above the first content row.
    if (scope.id === 'app') available = available.filter(function (node) { return !nav.contains(node); });
    var rows = lanes(available), row = rows.filter(function (line) { return line.items.some(function (item) { return item.node === current; }); })[0];
    if (!row) { first(scope); return; }
    var position = row.items.map(function (item) { return item.node; }).indexOf(current);
    if (direction === 37 || direction === 39) { var next = row.items[position + (direction === 37 ? -1 : 1)]; if (next) focus(next.node); return; }
    var rect = current.getBoundingClientRect(), center = (rect.left + rect.right) / 2, middle = (row.top + row.bottom) / 2;
    var nextRows = rows.filter(function (line) { var y = (line.top + line.bottom) / 2; return direction === 38 ? y < row.top : y > row.bottom; });
    nextRows.sort(function (a,b) { return Math.abs((a.top+a.bottom)/2-middle) - Math.abs((b.top+b.bottom)/2-middle); });
    if (nextRows.length) {
      var choices = nextRows[0].items.slice();
      choices.sort(function (a,b) {
        function distance(item) { return Math.max(item.rect.left - center, 0, center - item.rect.right) * 1000 + Math.abs((item.rect.left+item.rect.right)/2-center); }
        return distance(a) - distance(b);
      });
      focus(choices[0].node);
    } else if (direction === 38 && scope.id === 'app') {
      focus(nav.querySelector('button.active') || items(nav)[0]);
    }
  }
  root.CinemaNavigation = {capture:capture,restore:restore,focus:focus,first:first,move:move};
}(window));
