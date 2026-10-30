/* Installed TV applications only: never guess Samsung application IDs. ES5. */
(function (root) {
  'use strict';
  var services = [
    {key:'netflix', name:'Netflix', mark:'N', color:'#b20710', names:['netflix']},
    {key:'youtube', name:'YouTube', mark:'▶', color:'#c71820', names:['youtube']},
    {key:'prime', name:'Prime Video', mark:'prime', color:'#12618c', names:['primevideo','amazonprimevideo','amazonvideo']},
    {key:'disney', name:'Disney+', mark:'Disney+', color:'#263b91', names:['disney','disneyplus']},
    {key:'max', name:'HBO Max / Max', mark:'HBO', color:'#4232a5', names:['hbomax','max']},
    {key:'apple', name:'Apple TV', mark:'tv', color:'#343b48', names:['appletv','appletvplus']},
    {key:'spotify', name:'Spotify', mark:'♫', color:'#176d3c', names:['spotify']},
    {key:'plex', name:'Plex', mark:'plex', color:'#765814', names:['plex']},
    {key:'jellyfin', name:'Jellyfin', mark:'J', color:'#56347e', names:['jellyfin']},
    {key:'emby', name:'Emby', mark:'E', color:'#376b2b', names:['emby']}
  ];
  var installed = [], status = 'idle', failure = '', timer = null, sequence = 0;
  var cacheKey = 'cinema.installedApps.v1', bindings = {}, restored = false, cacheError = '', retryTimer = null;
  function normalize(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function nativeApi() { return root.tizen && root.tizen.application; }
  function readList(key) { try { var data = JSON.parse(root.localStorage.getItem(key) || '[]'); return Array.isArray(data) ? data.filter(function (x) { return typeof x === 'string'; }) : []; } catch (_) { return []; } }
  function writeList(key, list) { try { root.localStorage.setItem(key, JSON.stringify(list)); } catch (_) {} }
  function currentId() { try { return nativeApi().getCurrentApplication().appInfo.id; } catch (_) { return ''; } }
  function safeApp(info, own) {
    return info && typeof info.id === 'string' && info.id.length > 0 && info.id.length <= 256 &&
      typeof info.name === 'string' && info.name.trim().length > 0 && info.name.length <= 200 && info.show === true && info.id !== own &&
      !/factory|testmode|factorymenu|servicemenu|engineering/i.test(info.id + ' ' + normalize(info.name));
  }
  function sortInstalled() { installed.sort(function (a,b) { return a.name.localeCompare(b.name); }); }
  function restoreCache() {
    var api = nativeApi();
    // A PC/TV browser must never inherit a native receiver capability from storage.
    if (restored || !api || typeof api.getAppsInfo !== 'function') return;
    restored = true;
    try {
      var saved = JSON.parse(root.localStorage.getItem(cacheKey) || 'null'), own = currentId(), seen = Object.create(null);
      if (!saved || saved.version !== 1 || !Array.isArray(saved.apps) || (own && saved.owner && saved.owner !== own)) return;
      installed = saved.apps.slice(0,2000).filter(function (item) {
        if (!safeApp(item, own) || seen[item.id]) return false; seen[item.id] = true; return true;
      }).map(function (item) { return {id:item.id, name:item.name}; });
      services.forEach(function (service) {
        var id = saved.bindings && saved.bindings[service.key];
        if (installed.some(function (item) { return item.id === id && service.names.indexOf(normalize(item.name)) >= 0; })) bindings[service.key] = id;
      });
      sortInstalled(); if (installed.length) status = 'cached';
    } catch (_) { /* A corrupt or unavailable cache must not break native discovery. */ }
  }
  function saveCache() {
    try {
      root.localStorage.setItem(cacheKey, JSON.stringify({version:1, owner:currentId(), bindings:bindings,
        apps:installed.map(function (item) { return {id:item.id, name:item.name, show:true}; })}));
      cacheError = '';
    } catch (_) { cacheError = 'A TV tárhelye nem engedte az alkalmazáslista tartós mentését.'; }
  }
  function forget(id) {
    installed = installed.filter(function (item) { return item.id !== id; });
    services.forEach(function (service) { if (bindings[service.key] === id) delete bindings[service.key]; });
    saveCache();
  }
  function find(key) { return services.filter(function (service) { return service.key === key; })[0]; }
  function match(service) {
    if (!service) return null;
    var matches = installed.filter(function (app) { return service.names.indexOf(normalize(app.name)) >= 0; });
    var bound = matches.filter(function (app) { return app.id === bindings[service.key]; });
    if (bound.length === 1) return bound[0];
    return matches.length === 1 ? matches[0] : null;
  }
  function refresh(done, attempt) {
    var api = nativeApi(), run = ++sequence;
    if (timer) root.clearTimeout(timer);
    if (retryTimer) { root.clearTimeout(retryTimer); retryTimer = null; }
    attempt = attempt || 0;
    restoreCache(); failure = '';
    if (!api || typeof api.getAppsInfo !== 'function') { status = 'browser'; if (done) done(); return; }
    status = 'loading';
    function finish(items, problem) {
      if (run !== sequence || status !== 'loading') return;
      root.clearTimeout(timer); timer = null;
      if (!problem) {
        var own = currentId(), seen = Object.create(null), hidden = Object.create(null);
        var fresh = (Array.isArray(items) ? items : []).filter(function (item) {
          if (item && typeof item.id === 'string' && (item.show === false || /factory|testmode|factorymenu|servicemenu|engineering/i.test(item.id + ' ' + normalize(item.name)))) hidden[item.id] = true;
          if (!safeApp(item, own) || seen[item.id]) return false; seen[item.id] = true; return true;
        }).map(function (item) { return {id:item.id, name:item.name}; });
        // Merge positive observations. An empty/partial scan is not an uninstall.
        fresh = fresh.filter(function (item) { return !hidden[item.id]; });
        installed = fresh.concat(installed.filter(function (item) { return !seen[item.id] && !hidden[item.id] && item.id !== own; }));
        services.forEach(function (service) {
          var found = fresh.filter(function (item) { return service.names.indexOf(normalize(item.name)) >= 0; });
          if (found.length === 1) bindings[service.key] = found[0].id;
          if (!installed.some(function (item) { return item.id === bindings[service.key]; })) delete bindings[service.key];
        });
        sortInstalled(); saveCache();
      }
      failure = problem ? String(problem.name || 'API-hiba') : '';
      status = problem ? 'error' : 'ready';
      // A cold TV sometimes answers before its application list is ready.
      // Retry at most twice; explicit refresh cancels an obsolete retry.
      if (attempt < 2 && (problem || !(Array.isArray(items) && items.some(function (item) { return safeApp(item, own); })))) {
        retryTimer = root.setTimeout(function () { retryTimer = null; if (run === sequence) refresh(done, attempt + 1); }, attempt ? 4000 : 1500);
      }
      if (done) done();
    }
    timer = root.setTimeout(function () { finish([], {name:'Időtúllépés'}); }, 8000);
    try { api.getAppsInfo(function (items) { finish(items); }, function (e) { finish([], e); }); } catch (e) { finish([], e); }
  }
  function launch(id, done) {
    var api = nativeApi(), app = installed.filter(function (item) { return item.id === id; })[0];
    if (!app || !api) { done(new Error('Az alkalmazás nem található a TV beolvasott listájában. Frissítsd az alkalmazásokat.')); return; }
    // Only an explicit native NotFound/hidden result invalidates a saved ID.
    if (typeof api.getAppInfo === 'function') {
      try {
        var info = api.getAppInfo(id);
        if (info && info.show === false) { forget(id); done(new Error('A TV ezt az alkalmazást már nem jelzi láthatóként.')); return; }
      } catch (e) {
        if (e.name === 'NotFoundError') { forget(id); done(new Error('Ez az alkalmazás már nincs telepítve a TV-n.')); return; }
      }
    }
    var settled = false;
    var timeout = root.setTimeout(function () { finish(new Error('A TV nem igazolta az indítást. Ha nem nyílt meg az app, indítsd a Smart Hubból.')); }, 8000);
    function finish(e) { if (settled) return; settled = true; root.clearTimeout(timeout); if (!e) {
      services.forEach(function (service) { if (service.names.indexOf(normalize(app.name)) >= 0) bindings[service.key] = id; }); saveCache();
      var recent = readList('cinema.recentApps').filter(function (key) { return key !== id; }); recent.unshift(id); writeList('cinema.recentApps', recent.slice(0,8));
    } done(e, app); }
    try {
      if (typeof api.launch === 'function') api.launch(id, function () { finish(); }, function (e) { finish(new Error('A TV nem engedte az indítást (' + (e.name || 'hiba') + '). Nyisd meg az alkalmazást a Smart Hubból.')); });
      else finish(new Error('Ezen a firmware-en nem érhető el a közvetlen alkalmazásindítás. Használd a Smart Hubot.'));
    } catch (e) { finish(new Error('Alkalmazásindítási hiba (' + (e.name || 'hiba') + '). Használd a Smart Hubot.')); }
  }
  root.CinemaApps = {
    services:services, refresh:refresh, find:find, match:match, launch:launch,
    availableServices:function () { var api = nativeApi(); return api && typeof api.launch === 'function' ? services.filter(function (service) { return !!match(service); }).map(function (service) { return service.key; }) : []; },
    launchService:function (key, done) { var app = match(find(key)); if (!app) { done(new Error('A szolgáltatás alkalmazása nincs egyértelműen felismerve ezen a TV-n. Frissítsd az alkalmazáslistát.')); return; } launch(app.id, done); },
    installed:function () { return installed.slice(); }, status:function () { return status; }, failure:function () { return failure; }, cacheError:function () { return cacheError; },
    pins:function () { return readList('cinema.pinnedApps'); },
    togglePin:function (id) { if (!installed.some(function (app) { return app.id === id; })) return; var pins = readList('cinema.pinnedApps'); var at = pins.indexOf(id); if (at < 0) pins.push(id); else pins.splice(at,1); writeList('cinema.pinnedApps', pins); },
    recent:function () { return readList('cinema.recentApps'); }
  };
  restoreCache();
}(window));
