/* ES5 syntax for the Samsung 2020 / Tizen 5.5 web engine. No build step or third-party JS. */
(function () {
  'use strict';
  var bootstrap = window.CinemaBootstrap || {};
  var automatic = !!window.tizen && typeof bootstrap.server === 'string' && /^http:\/\/(?:192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)(?::\d+)?$/.test(bootstrap.server);
  var storedBase = localStorage.getItem('cinema.server') || '';
  var bindingChanged = automatic && bootstrap.discoveryId && localStorage.getItem('cinema.binding') !== bootstrap.discoveryId;
  var state = {base: automatic ? storedBase || bootstrap.server : storedBase || (location.protocol.indexOf('http') === 0 ? location.origin : ''),
    token: bindingChanged ? '' : localStorage.getItem('cinema.token') || '', page: 'home', videos: [], movies: [], jobs: [], settings: {},
    selected: null, waiting: localStorage.getItem('cinema.waiting') || '', playing: null, av: false,
    busy: false, lastProgress: 0, local: false, usb: false, modalReturn: null, pageFocus: {}, detailReturn: null, online: false, connecting: false, generation: 0, chromeTimer: 0, audioIndex: null, textIndex: null, tracks: {audio: [], text: []},
    receiving: localStorage.getItem('cinema.receiver') === 'true' || (!!window.tizen && localStorage.getItem('cinema.receiver') !== 'false'), remoteAck: '', remoteBusy: false, remoteStatus: 'Készen áll', receivers: []};
  var apps = window.CinemaApps;
  var navigation = window.CinemaNavigation;
  var heldKeys = {}, lastMove = 0;
  function tvBrowser() { return !!window.tizen || /SMART-TV|SmartTV|Tizen/i.test(navigator.userAgent); }
  var $ = function (id) { return document.getElementById(id); };
  function text(value) { var node = document.createElement('span'); node.textContent = value == null ? '' : String(value); return node.innerHTML; }
  function show(id, value) { $(id).classList.toggle('hidden', !value); }
  function message(value) { $('message').textContent = value || ''; show('message', !!value); }
  function focusFirst(root) { navigation.first(root || $('content')); }
  function api(path, data, raw) {
    return new Promise(function (resolve, reject) {
      var generation = state.generation;
      var xhr = new XMLHttpRequest(); xhr.open(data === undefined ? 'GET' : 'POST', state.base + path, true);
      xhr.timeout = path === '/api/receiver' || path === '/api/settings' ? 6000 : 25000;
      if (state.token) xhr.setRequestHeader('Authorization', 'Bearer ' + state.token);
      if (data !== undefined) xhr.setRequestHeader('Content-Type', raw ? 'application/x-bittorrent' : 'application/json');
      xhr.onload = function () {
        var result; try { result = JSON.parse(xhr.responseText); } catch (_) { reject(new Error('A szerver válasza nem olvasható.')); return; }
        if (xhr.status >= 200 && xhr.status < 300) resolve(result);
        else { if (xhr.status === 401 && !automatic) pairing(); var failure = new Error(result.error || 'Kapcsolati hiba (' + xhr.status + ').'); failure.status = xhr.status; failure.generation = generation; reject(failure); }
      };
      xhr.onerror = xhr.ontimeout = function () { var failure = new Error('A PC nem érhető el. Ellenőrizd, hogy fut-e a Cinema TV szerver és a gép nincs-e alvó állapotban.'); failure.generation = generation; reject(failure); };
      xhr.send(data === undefined ? null : raw ? data : JSON.stringify(data));
    });
  }
  function error(e) { message(e.message || String(e)); }
  function bytes(value) { value = Number(value) || 0; return value >= 1073741824 ? (value / 1073741824).toFixed(1) + ' GiB' : value >= 1048576 ? (value / 1048576).toFixed(1) + ' MiB' : Math.round(value / 1024) + ' KiB'; }
  function clock(value) { value = Math.max(0, Math.floor(value || 0)); return Math.floor(value / 3600) + ':' + ('0' + Math.floor(value / 60) % 60).slice(-2) + ':' + ('0' + value % 60).slice(-2); }
  function pairing() { $('server-url').value = state.base; show('pairing', true); $('pairing-pin').focus(); }
  function pair() {
    var base = $('server-url').value.trim().replace(/\/$/, '');
    if (!/^http:\/\/(?:192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|127\.0\.0\.1|localhost)(?::\d+)?$/.test(base)) {
      $('pair-error').textContent = 'Helyi PC-címet adj meg, például http://192.168.1.50:8790'; return;
    }
    state.base = base;
    api('/api/pair', {pin: $('pairing-pin').value.trim(), label: window.tizen ? 'Samsung Tizen TV' : 'PC böngésző'}).then(function (result) {
      state.token = result.token; localStorage.setItem('cinema.token', state.token); localStorage.setItem('cinema.server', state.base);
      $('pairing-pin').value = ''; show('pairing', false); connect();
    }).catch(function (e) { $('pair-error').textContent = e.message; });
  }
  function automaticPair() {
    if (state.connecting) return;
    state.connecting = true; show('pairing', false);
    $('connection').textContent = 'Automatikus kapcsolódás a PC-hez…';
    if (!bootstrap.enrollment) { state.connecting = false; connectionLost(new Error('Az automatikus párosításhoz a PC-ről frissíthető a TV-alkalmazás.')); return; }
    api('/api/auto-pair', {secret:bootstrap.enrollment}).then(function (result) {
      state.token = result.token;
      localStorage.setItem('cinema.token', state.token); localStorage.setItem('cinema.server', state.base);
      if (bootstrap.discoveryId) localStorage.setItem('cinema.binding', bootstrap.discoveryId);
      state.connecting = false; connect();
    }).catch(function (e) { state.connecting = false; connectionLost(e); });
  }
  function resumeConnection() {
    if (state.connecting) return;
    if (!automatic || !bootstrap.discoveryId) { if (state.token) connect(); else automaticPair(); return; }
    state.connecting = true; show('pairing', false);
    $('connection').textContent = 'Saját PC keresése a hálózaton…';
    window.CinemaConnection.find(bootstrap, state.base).then(function (base) {
      state.base = base; localStorage.setItem('cinema.server', base);
      state.connecting = false; if (state.token) connect(); else automaticPair();
    }).catch(function (e) { state.connecting = false; connectionLost(e); });
  }
  function connectionLost(e) {
    // Requests started before a successful reconnect must not undo that connection.
    if (e && e.generation != null && e.generation !== state.generation) return;
    state.online = false; $('connection').textContent = automatic ? 'Várakozás a PC-re…' : 'PC nincs kapcsolatban';
    $('connection').classList.remove('online');
    if (automatic) { show('pairing', false); if (e && e.status === 401) state.token = ''; }
    if (e) { state.remoteStatus = e.message; error(e); }
  }
  function connect() {
    state.connecting = true;
    api('/api/settings').then(function (settings) {
      state.connecting = false;
      state.settings = settings; state.local = settings.local; state.online = true;
      state.generation++; if (!state.playing) state.remoteStatus = 'Készen áll';
      $('connection').textContent = 'PC csatlakoztatva'; $('connection').classList.add('online');
      message('');
      show('pairing', false); loadLibrary(); loadCatalog('');
      if (state.local) localPairing();
      if (state.receiving) receiveRemote();
    }).catch(function (e) { state.connecting = false; connectionLost(e); render(); if (!automatic) pairing(); });
  }
  function localPairing() {
    api('/api/local-pairing').then(function (result) {
      var expires = new Date(result.expires * 1000);
      $('pairing-hint').textContent = state.page === 'settings' ? 'Másik eszköz kézi párosítókódja: ' + result.pin + ' · ' + expires.toLocaleTimeString() : 'A saját TV automatikusan kapcsolódik. A kézi párosítás a Beállításokban érhető el.';
    }).catch(function () {});
  }
  function loadLibrary() {
    api('/api/library').then(function (result) { state.videos = result.videos; state.usb = false; if (state.page !== 'downloads' && state.page !== 'settings' && !state.selected) render(); }).catch(error);
  }
  function loadCatalog(query) {
    if (!state.settings.tmdb_configured) return;
    api('/api/catalog' + (query ? '?q=' + encodeURIComponent(query) : '')).then(function (result) { state.movies = result.movies; if (state.page === 'home' && !state.selected) render(); }).catch(error);
  }
  function card(movie) {
    return '<button class="movie" data-video="' + text(movie.id) + '"><div class="poster">' +
      (movie.poster ? '<img src="' + text(movie.poster) + '" alt="">' : '▶<span class="tag">' + (movie.usb ? 'USB' : 'SAJÁT FILM') + '</span>') +
      '</div><strong>' + text(movie.title) + '</strong><small>' + text(movie.year || (movie.bytes ? bytes(movie.bytes) : '')) + (movie.watched ? ' · Megnézve' : '') + '</small></button>';
  }
  function row(title, movies) { return movies.length ? '<section><h2>' + text(title) + '</h2><div class="row">' + movies.map(card).join('') + '</div></section>' : ''; }
  function hero(movie) {
    return '<div class="hero">' + (movie && movie.backdrop ? '<img src="' + text(movie.backdrop) + '" alt="">' : '') +
      '<div class="hero-copy"><div class="eyebrow">HOME THEATER · MINDEN ESTÉRE</div><h1>' + text(movie ? movie.title : 'Ma este mit nézünk?') +
      '</h1><p>' + text(movie && movie.overview ? movie.overview : 'Streamingalkalmazások, saját filmek és a következő moziested. Egy közös kiindulópont a Samsung TV-n.') + '</p></div></div>';
  }
  function serviceCard(service) {
    var match = apps.match(service), label = match ? 'Megnyitás a TV-n' : tvBrowser() ? 'TV-s felismerés szükséges' : 'Indítás a TV-n';
    return '<button class="service service-' + service.key + '" data-service="' + service.key + '"><span class="service-art" style="background:' + service.color + '">' + text(service.mark) + '</span><strong>' + text(service.name) + '</strong><small>' + label + '</small></button>';
  }
  function installedCard(app, manage) {
    return '<div class="installed-card"><button class="installed-launch" data-launch-app="' + text(app.id) + '"><span class="app-monogram">' + text(app.name.slice(0,2).toUpperCase()) + '</span><strong>' + text(app.name) + '</strong><small>Megnyitás a TV-n</small></button>' +
      (manage ? '<button class="pin-button" data-pin-app="' + text(app.id) + '">' + (apps.pins().indexOf(app.id) >= 0 ? '★ Rögzítve' : '☆ Kezdőlapra') + '</button>' : '') + '</div>';
  }
  function installedRow(title, ids) {
    var items = ids.map(function (id) { return apps.installed().filter(function (app) { return app.id === id; })[0]; }).filter(Boolean);
    return items.length ? '<section><h2>' + title + '</h2><div class="row app-row">' + items.map(function (app) { return installedCard(app, false); }).join('') + '</div></section>' : '';
  }
  function appStatus() {
    var count = apps.installed().length;
    if (apps.status() === 'loading') return count ? 'Alkalmazások frissítése… A ' + count + ' korábban felismert app közben is használható.' : 'A TV alkalmazásainak beolvasása…';
    if (apps.status() === 'error') return 'Az új beolvasás nem sikerült (' + apps.failure() + '). ' + (count ? count + ' mentett alkalmazás továbbra is használható.' : 'Próbáld újra; a Smart Hubból továbbra is megnyithatók.');
    if (apps.status() === 'ready' || apps.status() === 'cached') return count + ' felismert TV-alkalmazás. ' + (apps.cacheError() || 'A találatokat megjegyeztük, újraindítás után is megmaradnak.');
    return tvBrowser() ? 'A TV böngészője nem ad hozzáférést a telepített appokhoz. Ehhez a telepített Cinema TV Tizen-alkalmazás szükséges.' : 'A streamingcsempék a párosított TV saját alkalmazásait indítják. A TV-n a telepített Cinema TV legyen nyitva, a TV menüben a fogadás legyen BE állapotú.';
  }
  function serviceDialog(key) {
    var service = apps.find(key); if (!service) return;
    if (apps.availableServices().indexOf(key) >= 0) { launchApp(apps.match(service).id); return; }
    if (state.local && !window.tizen) {
      refreshReceivers(function () {
        var devices = state.receivers.filter(function (device) { return Array.isArray(device.services) && device.services.indexOf(key) >= 0; });
        if (devices.length === 1) { sendService(devices[0].id, key); return; }
        modal('<div class="eyebrow">STREAMING A TV-N</div><h2>' + text(service.name) + '</h2>' +
          (devices.length ? '<p>Válaszd ki, melyik TV saját alkalmazása induljon.</p><div class="actions">' + devices.map(function (device) { return '<button class="primary" data-tv-service="' + key + '" data-receiver="' + text(device.id) + '">' + text(device.label) + '</button>'; }).join('') + '</div>' : '<p>Nincs kapcsolódott TV, amely ezt az alkalmazást indíthatónak jelezte. A TV-n nyisd meg a telepített Cinema TV-t, párosítsd a PC-vel, frissítsd az alkalmazáslistát és kapcsold BE a PC-s indítás fogadását.</p><p>A TV böngészős nézete nem tud saját TV-alkalmazást indítani. Ha a szolgáltatás appja hiányzik, ellenőrizd a Samsung Apps képernyőn.</p>') + '<div class="actions"><button data-action="modal-close">Vissza</button></div>');
      }); return;
    }
    modal('<div class="eyebrow">STREAMING A TV-N</div><h2>' + text(service.name) + '</h2><p>' + (tvBrowser() && !window.tizen ? 'A TV böngészője nem tudja megnyitni a telepített TV-alkalmazásokat. A Cinema TV aláírt Tizen-kiadását kell telepíteni.' : 'A TV nem jelezte indíthatónak ezt az alkalmazást. Ellenőrizd a Samsung Apps képernyőn, majd frissítsd az alkalmazáslistát. Ha a firmware korlátozza az indítást, a Smart Hubból nyitható meg.') + '</p><div class="actions"><button data-action="refresh-apps">Alkalmazások újraolvasása</button><button data-action="modal-close">Vissza</button></div>');
  }
  function sendService(receiverId, key) {
    var service = apps.find(key); if (!service) return;
    api('/api/remote', {receiverId:receiverId, action:'launch-service', service:key}).then(function () { closeModal(); message(service.name + ': az indítási kérés elküldve a TV-nek. A szolgáltatás a TV saját alkalmazásában nyílik meg.'); }).catch(error);
  }
  function launchApp(id) { message('Alkalmazás indítása a TV-n…'); apps.launch(id, function (e, app) { if (e) error(e); else { closeModal(); message(app.name + ' megnyitva a TV-n. A Cinema TV-hez a Smart Hubból térhetsz vissza.'); } }); }
  function navigate(page) {
    var saved = navigation.capture($('content')); if (saved && !state.selected) state.pageFocus[state.page] = saved;
    state.page = page; state.selected = null; message(''); render();
    navigation.restore($('content'), state.pageFocus[page], true);
    if (page === 'downloads') poll(); if (state.local) localPairing();
  }
  function remoteCards(videoId) {
    return state.receivers.length ? state.receivers.map(function (device) { return '<div class="panel"><h3>' + text(device.label) + '</h3><p>' + text(device.status) + '</p><div class="actions">' +
      (videoId ? '<button class="primary" data-remote="play" data-receiver="' + text(device.id) + '" data-remote-video="' + text(videoId) + '">Film indítása ezen az eszközön</button>' : ['pause','resume','rewind','forward','stop'].map(function (cmd, index) { return '<button data-remote="' + cmd + '" data-receiver="' + text(device.id) + '">' + ['Szünet','Folytatás','−30 mp','+30 mp','Leállítás'][index] + '</button>'; }).join('')) + '</div></div>'; }).join('') : '<div class="panel"><p>Nincs aktív fogadó. A TV-n nyisd meg a Cinema TV-t, párosítsd, majd a TV oldalon kapcsold be a PC-s indítás fogadását. A TV és a PC legyen ugyanazon a hálózaton.</p></div>';
  }
  function refreshReceivers(done) { api('/api/receivers').then(function (r) { state.receivers = r.receivers; if (done) done(); else if ($('receiver-list')) $('receiver-list').innerHTML = remoteCards(); }).catch(error); }
  function sendToTv(videoId) { refreshReceivers(function () { modal('<h2>Lejátszás a TV-n</h2><p>A filmet a PC tárolja, a kiválasztott képernyő hálózaton játssza le.</p>' + remoteCards(videoId) + '<button data-action="modal-close">Vissza</button>'); }); }
  function receiveRemote() {
    if (!state.online || !state.token || !state.receiving || state.remoteBusy || document.hidden) return;
    var status = state.remoteStatus;
    if (state.playing) { try { status = state.av ? webapis.avplay.getState() : $('html-player').error ? 'Lejátszási hiba' : $('html-player').paused ? 'Szünet / a TV-n OK szükséges' : 'Lejátszás folyamatban'; } catch (_) {} }
    state.remoteBusy = true;
    api('/api/receiver', {label: window.tizen ? 'Samsung TV' : tvBrowser() ? 'Samsung TV böngésző' : 'Böngészős fogadó', status: status, ack: state.remoteAck, services:apps.availableServices()}).then(function (r) {
      state.remoteBusy = false;
      if (!state.receiving) { api('/api/receiver', {enabled:false}).catch(function () {}); return; }
      var cmd = r.command; if (!cmd || cmd.id === state.remoteAck) return;
      state.remoteAck = cmd.id; state.remoteStatus = 'Parancs fogadva';
      if (cmd.action === 'launch-service') {
        if (state.playing) closePlayer();
        state.remoteStatus = 'Streamingalkalmazás indítása';
        api('/api/receiver', {label:'Samsung TV', status:state.remoteStatus, ack:state.remoteAck, services:apps.availableServices()}).then(function () {
          if (!state.receiving) return;
          apps.launchService(cmd.service, function (e, app) {
            state.remoteStatus = e ? e.message : app.name + ' indítását a TV visszaigazolta';
            if (e) error(e);
            if (state.receiving) api('/api/receiver', {label:'Samsung TV', status:state.remoteStatus, ack:state.remoteAck, services:apps.availableServices()}).catch(function () {});
          });
        }).catch(function (e) { state.remoteStatus = e.message; error(e); });
      } else if (cmd.action === 'play') {
        state.remoteStatus = 'Film előkészítése';
        if (state.playing) closePlayer();
        api('/api/library').then(function (data) { state.videos = data.videos; play(cmd.videoId); }).catch(function (e) { state.remoteStatus = 'A film nem indult: ' + e.message; error(e); });
      } else if (cmd.action === 'stop') { closePlayer(); state.remoteStatus = 'Leállítva'; }
      else if (state.playing && cmd.action === 'pause') { if (state.av) webapis.avplay.pause(); else $('html-player').pause(); $('player-toggle').textContent = 'Folytatás'; }
      else if (state.playing && cmd.action === 'resume') { if (state.av) webapis.avplay.play(); else { var promise = $('html-player').play(); if (promise && promise.catch) promise.catch(function () { state.remoteStatus = 'A TV-n nyomj OK-t a lejátszáshoz.'; }); } $('player-toggle').textContent = 'Szünet'; }
      else if (state.playing && (cmd.action === 'rewind' || cmd.action === 'forward')) seek(cmd.action === 'rewind' ? -30 : 30);
    }).catch(function (e) { state.remoteBusy = false; if (automatic) connectionLost(e); else state.remoteStatus = e.message; });
  }
  function render() {
    if (state.playing) return;
    var focusKey = navigation.capture($('content'));
    var html = '';
    if (state.selected) { renderDetails(); return; }
    Array.prototype.forEach.call(document.querySelectorAll('nav [data-page]'), function (node) { node.classList.toggle('active', node.getAttribute('data-page') === state.page); });
    if (state.page === 'home') {
      html = hero(state.movies[0]) + '<section class="streaming"><div class="section-heading"><h2>Streaming és szórakozás</h2><button data-action="apps">Összes alkalmazás →</button></div><div class="row services-row">' + apps.services.slice(0,6).map(serviceCard).join('') + '</div></section>';
      html += installedRow('A te alkalmazásaid', apps.pins()) + installedRow('Legutóbb megnyitott alkalmazások', apps.recent());
      html += '<div class="hub-shortcuts"><button data-action="library"><strong>Saját filmek</strong><small>' + state.videos.length + ' videó a médiatárban</small></button><button data-action="downloads"><strong>Letöltések</strong><small>A PC letölt, a TV lejátszik</small></button><button data-action="search"><strong>Filmkeresés</strong><small>Saját gyűjtemény és TMDb</small></button><button data-action="' + (state.online ? 'rescan' : 'reconnect') + '"><strong>' + (state.online ? 'Médiatár frissítése' : 'PC csatlakoztatása') + '</strong><small>' + (state.online ? 'Új fájlok beolvasása' : 'Párosítás a filmekhez') + '</small></button></div>';
      html += row('Folytatás', state.videos.filter(function (v) { return v.position > 0 && !v.watched; }).sort(function (a,b) { return b.last_played - a.last_played; }));
      html += row('A gyűjteményedben', state.videos);
      html += row('Kedvencek', state.videos.filter(function (v) { return v.favorite; }));
      html += row('Felfedezés · TMDb', state.movies);
      if (!state.videos.length && !state.movies.length) html += '<div class="empty"><h3>Minden a saját gyűjteményeddel kezdődik.</h3><p>Tedd a filmeket a PC-n kiválasztott médiamappába, majd nyomd meg a Médiatár frissítése gombot. A borítós TMDb-katalógust a PC-n, a Beállításokban kapcsolhatod be.</p></div>';
      if (state.movies.length) html += '<p class="attribution">This product uses the TMDB API but is not endorsed or certified by TMDB.</p>';
    } else if (state.page === 'apps') {
      html = '<div class="eyebrow">HOME THEATER</div><h1>Alkalmazások</h1><p>' + text(appStatus()) + '</p><div class="actions"><button data-action="refresh-apps">TV-alkalmazások frissítése</button></div><div class="services-grid">' + apps.services.map(serviceCard).join('') + '</div>';
      html += '<h2>A TV-n talált alkalmazások</h2>' + (apps.installed().length ? '<div class="installed-grid">' + apps.installed().map(function (app) { return installedCard(app, true); }).join('') + '</div>' : '<div class="panel"><p>' + text(appStatus()) + '</p></div>');
      html += '<p class="small">A streaming saját alkalmazásban fut, saját fiókkal. A Cinema TV önálló médiaközpont; a Samsung Home gombja továbbra is a Smart Hubot nyitja meg.</p>';
    } else if (state.page === 'remote') {
      html = '<h1>TV vezérlése Wi-Fi-n</h1><p>A saját film a PC-n marad. A TV-n megnyitott Cinema TV fogadja az indítást; a TV USB-lemezére ez a művelet nem másol.</p><div class="actions"><button data-action="receiver-toggle">PC-s indítás fogadása ezen a képernyőn: ' + (state.receiving ? 'BE' : 'KI') + '</button>' + (state.local ? '<button data-action="receivers-refresh">Fogadók frissítése</button>' : '') + '<button data-action="shutdown-ask">PC kikapcsolása</button></div>' +
        (state.local ? '<h2>Csatlakozott képernyők</h2><p>A Könyvtárban válassz filmet, majd Lejátszás a TV-n. Itt szüneteltethetsz és tekerhetsz.</p><div id="receiver-list">' + remoteCards() + '</div>' : '<div class="panel"><p>Ha a fogadás BE állapotú, a PC-n kiválasztott film itt indul. A Cinema TV maradjon nyitva az előtérben. A böngésző a lejátszás kezdetén OK megnyomását kérheti.</p></div>');
    } else if (state.page === 'library') {
      html = '<h1>' + (state.usb ? 'USB-filmek' : 'Saját médiatár') + '</h1><p>' + state.videos.length + ' film · ' + (state.usb ? 'közvetlenül a TV USB-meghajtójáról' : 'a számítógépedről, helyi hálózaton') + '</p><div class="actions"><button data-action="rescan">Frissítés</button></div><div class="grid">' + state.videos.map(card).join('') + '</div>';
    } else if (state.page === 'downloads') {
      html = '<h1>Letöltések</h1><p>A PC letölt és tovább seedel. A kész film automatikusan indul, ha itt vársz rá.</p><div class="actions"><button class="primary" data-action="import">Torrentfájl importálása a PC-n</button><button data-action="magnet">Magnet link</button></div><div id="download-list">' + downloadCards() + '</div>';
    } else {
      html = '<h1>Beállítások</h1><div class="panel"><h3>A te rendszered</h3><p>TV: Samsung UE55TU7092UXXH · PC: ' + text(state.base) + '</p>' +
        (state.settings.library ? '<p>Médiamappa: ' + text(state.settings.library) + '</p>' : '') + '<p>Szabad hely a PC-n: ' + bytes(state.settings.free_bytes) + '</p>' +
        (state.local ? '<p>A TV párosítókódja az oldal alján látható.</p><button data-action="renew">Új párosítókód</button>' : '') + '</div>' +
        '<div class="panel settings-form"><h3>Letöltés és lejátszás</h3><div class="inline"><label>Maximum torrentméret (GiB)<input id="max-gib" type="number" min="1" max="500" value="' + state.settings.max_gib + '"></label><label>Szabadhelytartalék (GiB)<input id="reserve-gib" type="number" min="1" max="100" value="' + state.settings.reserve_gib + '"></label></div>' +
        '<button data-action="autoplay">Automatikus indítás: ' + (state.settings.autoplay ? 'be' : 'ki') + '</button><div class="actions"><button class="primary" data-action="save-settings">Beállítások mentése</button></div></div>' +
        (state.local ? '<div class="panel settings-form"><h3>TMDb-katalógus</h3><label>Saját API Read Access Token<input id="tmdb-token" type="password" placeholder="' + (state.settings.tmdb_configured ? 'Már beállítva; új tokennel felülírható' : 'A helyi filmlejátszáshoz nem szükséges') + '"></label><button data-action="save-tmdb">Token mentése a PC-n</button><p class="small">A token titkosítva tárolódik a Windows-fiókod alatt. Nem a TMDb-jelszót várja.</p></div>' : '') +
        '<div class="panel"><h3>PC</h3><p>Ha a filmnek vége, a tévé leállíthatja a számítógépet. A lejátszás és a letöltés megszakad.</p><button data-action="shutdown-ask">PC kikapcsolása</button></div>' +
        '<div class="panel"><h3>Tudnivalók</h3><p>A PC legyen bekapcsolva és elérhető a lejátszás alatt. A TV USB-lemezére ez a kiadás nem másol automatikusan. Az USB-filmek olvasása a telepített Tizen-appban külön próbálható.</p><p>nCore: engedélyezett API hiányában saját .torrent fájl importálható; automatikus bejelentkezés nincs.</p><button data-action="reconnect">Újrapárosítás / másik PC</button></div>';
    }
    $('content').innerHTML = html;
    if (focusKey && $('modal').classList.contains('hidden')) navigation.restore($('content'), focusKey, true);
  }
  function downloadCards() {
    if (!state.jobs.length) return '<div class="empty"><h3>Még nincs letöltés.</h3><p>A PC böngészőjében válassz egy használatra jogosult .torrent fájlt, vagy adj meg magnet linket.</p></div>';
    return state.jobs.map(function (job) {
      var paused = /stopped|paused/.test(job.status);
      return '<div class="download-card"><h3>' + text(job.title) + '</h3><div class="meta">' + text(job.status) + ' · ' + Math.round((job.progress || 0) * 100) + '% · ↓ ' + bytes(job.downloadSpeed) + '/s · ↑ ' + bytes(job.uploadSpeed) + '/s</div>' +
        '<div class="bar"><span style="width:' + Math.min(100, Math.max(0, (job.progress || 0) * 100)) + '%"></span></div>' +
        (job.error ? '<p class="error">' + text(job.error) + '</p>' : '') + '<div class="actions"><button data-job="' + text(job.id) + '" data-job-action="' + (paused ? 'start' : 'stop') + '">' + (paused ? 'Folytatás' : 'Szünet') + '</button>' +
        (job.videoId ? '<button class="primary" data-ready-video="' + text(job.videoId) + '">Lejátszás</button>' : '<button data-wait="' + text(job.id) + '">' + (state.waiting === job.id ? 'Erre a filmre vársz' : 'Indítás, amint elkészül') + '</button>') + '</div></div>';
    }).join('');
  }
  function details(identifier) {
    state.detailReturn = navigation.capture($('content'));
    state.selected = state.videos.concat(state.movies).filter(function (v) { return v.id === identifier; })[0];
    if (state.selected) { renderDetails(); focusFirst(); }
  }
  function backDetails() {
    state.selected = null; render(); navigation.restore($('content'), state.detailReturn, true);
  }
  function renderDetails() {
    var film = state.selected;
    var local = state.videos.filter(function (v) { return v.id === film.id || (film.movieId && v.movie_id === film.movieId); })[0];
    $('content').innerHTML = hero(film) + '<div class="actions">' +
      (local ? '<button class="primary" data-play="' + text(local.id) + '">' + (local.position > 0 && !local.watched ? 'Folytatás' : 'Lejátszás') + '</button>' + (state.local && !local.usb ? '<button data-send-tv="' + text(local.id) + '">Lejátszás a TV-n</button>' : '') + (!local.usb ? '<button data-favorite="' + text(local.id) + '">' + (local.favorite ? 'Kedvenc eltávolítása' : 'Kedvencekhez') + '</button>' : '') : '<button class="primary" data-action="import">Saját torrent importálása a PC-n</button><button data-action="magnet">Magnet link</button>') +
      '<button data-action="back-details">Vissza</button></div><div class="panel"><p>' + (local ? (local.usb ? 'A videó a TV USB-meghajtójáról játszható le.' : 'A videó a PC-n található. A PC és a hálózati kapcsolat szükséges a lejátszáshoz.') : 'Ehhez a filmhez még nincs helyi videó hozzárendelve. A filmadatok nem adnak hozzáférést torrentforráshoz. Az importálás az aktuális filmhez kapcsolja a letöltést.') + '</p></div>';
  }
  function modal(html) {
    state.modalReturn = {node:document.activeElement, key:navigation.capture($('content'))};
    $('modal-content').innerHTML = html; show('modal', true); focusFirst($('modal-content'));
  }
  function closeModal() {
    show('modal', false);
    if (state.modalReturn && document.documentElement.contains(state.modalReturn.node)) navigation.focus(state.modalReturn.node);
    else navigation.restore($('content'), state.modalReturn && state.modalReturn.key, true);
  }
  function importDialog() {
    if (window.tizen || !state.local) { message('A torrentfájlt a PC-n megnyitott Cinema TV oldalon válaszd ki. Ugyanitt a Magnet link gomb is használható.'); return; }
    modal('<h2>Saját .torrent fájl</h2><p>A teljes torrent a PC-re töltődik, a kész film hálózaton játszható le. A kliens feltölt és seedel is.</p><input id="torrent-file" type="file" accept=".torrent"><div class="actions"><button class="primary" data-action="upload-torrent">Letöltés indítása</button><button data-action="modal-close">Mégse</button></div>');
  }
  function uploadTorrent() {
    var file = $('torrent-file').files[0];
    if (!file) { error(new Error('Válassz egy .torrent fájlt.')); return; }
    var movie = state.selected && state.selected.movieId;
    api('/api/torrent' + (movie ? '?movieId=' + encodeURIComponent(movie) : ''), file, true).then(afterAdd).catch(error);
  }
  function afterAdd(result) { closeModal(); state.waiting = result.id; localStorage.setItem('cinema.waiting', result.id); navigate('downloads'); message('A PC átvette a torrentet. Ha a TV-n szeretnéd az automatikus indítást, ott a Letöltések között jelöld ki ezt a filmet.'); }
  function magnetDialog() {
    modal('<h2>Magnet link</h2><p>Először a metaadatok érkeznek meg. A PC ellenőrzi a teljes méretet és a szabad helyet, majd indul a letöltés.</p><input id="magnet-value" placeholder="magnet:?xt=urn:btih:…"><div class="actions"><button class="primary" data-action="add-magnet">Indítás</button><button data-action="modal-close">Mégse</button></div>');
  }
  function poll() {
    if (!state.token || document.hidden) return;
    api('/api/downloads').then(function (result) {
      state.jobs = result.jobs;
      if (result.error && state.page === 'downloads') message(result.error);
      if (state.page === 'downloads' && !state.selected && !state.playing && $('download-list')) {
        var focusKey = navigation.capture($('download-list'));
        $('download-list').innerHTML = downloadCards();
        if (focusKey && $('modal').classList.contains('hidden')) navigation.restore($('download-list'), focusKey, true);
      }
      var ready = state.jobs.filter(function (job) { return job.id === state.waiting && job.videoId; })[0];
      if (ready && state.settings.autoplay && !state.playing && $('modal').classList.contains('hidden')) {
        state.waiting = ''; localStorage.removeItem('cinema.waiting');
        api('/api/library').then(function (data) { state.videos = data.videos; play(ready.videoId); }).catch(error);
      }
    }).catch(function (e) { if (state.page === 'downloads') error(e); if (automatic && (!e.status || e.status === 401)) connectionLost(e); });
  }
  function saveProgress() {
    if (!state.playing || state.playing.usb) return;
    var position = state.av ? webapis.avplay.getCurrentTime() / 1000 : $('html-player').currentTime;
    var duration = state.av ? webapis.avplay.getDuration() / 1000 : $('html-player').duration;
    if (isFinite(position) && isFinite(duration)) api('/api/progress', {id: state.playing.id, position: position, duration: duration}).catch(function () {});
  }
  function play(identifier) {
    var film = state.videos.filter(function (v) { return v.id === identifier; })[0];
    if (!film) { message('A film nem található. Frissítsd a médiatárat.'); return; }
    if (film.usb) openPlayer(film, film.uri);
    else api('/api/play', {id: identifier}).then(function (result) { openPlayer(film, state.base + result.path); }).catch(error);
  }
  var trackLanguages = {hu:'Magyar',hun:'Magyar',en:'Angol',eng:'Angol',de:'Német',deu:'Német',ger:'Német',fr:'Francia',fra:'Francia',fre:'Francia',es:'Spanyol',spa:'Spanyol',it:'Olasz',ita:'Olasz',ru:'Orosz',rus:'Orosz',pl:'Lengyel',pol:'Lengyel',cs:'Cseh',ces:'Cseh',cze:'Cseh',sk:'Szlovák',slk:'Szlovák',ro:'Román',ron:'Román',rum:'Román',nl:'Holland',dut:'Holland',nld:'Holland',pt:'Portugál',por:'Portugál',sv:'Svéd',swe:'Svéd',no:'Norvég',nor:'Norvég',da:'Dán',dan:'Dán',fi:'Finn',fin:'Finn',ja:'Japán',jpn:'Japán',ko:'Koreai',kor:'Koreai',zh:'Kínai',chi:'Kínai',zho:'Kínai',ar:'Arab',ara:'Arab',tr:'Török',tur:'Török',uk:'Ukrán',ukr:'Ukrán',hr:'Horvát',hrv:'Horvát',sr:'Szerb',srp:'Szerb',bg:'Bolgár',bul:'Bolgár',el:'Görög',ell:'Görög',gre:'Görög',he:'Héber',heb:'Héber',hi:'Hindi',hin:'Hindi',th:'Thai',tha:'Thai',vi:'Vietnámi',vie:'Vietnámi'};
  function note(value) { $('player-note').textContent = value || ''; showChrome(); }
  function showChrome() {
    clearTimeout(state.chromeTimer);
    if (!$('playback')) return;
    $('playback').classList.remove('idle');
    if (!state.playing || $('player-note').textContent || !$('player-tracks').classList.contains('hidden')) return;
    state.chromeTimer = setTimeout(function () {
      if (!state.playing || $('player-note').textContent || !$('player-tracks').classList.contains('hidden')) return;
      $('playback').classList.add('idle');
    }, 4500);
  }
  function trackMeta(track) {
    var raw = track && track.extra_info;
    if (!raw) return {};
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(raw); } catch (e) { return {}; }
  }
  function trackName(track, kind, index) {
    var info = trackMeta(track);
    var code = String(info.language || info.track_lang || info.lang || '').toLowerCase().split(/[-_]/)[0];
    var named = trackLanguages[code] || '';
    var label = info.label || info.title || '';
    if (named && label && label.toLowerCase() !== named.toLowerCase() && label.toLowerCase() !== code) return named + ' · ' + label;
    return named || label || ((kind === 'audio' ? 'Hangsáv ' : 'Felirat ') + (index + 1));
  }
  function rememberStreams() {
    state.audioIndex = state.tracks.audio.length ? String(state.tracks.audio[0].index) : null;
    state.textIndex = null;
    if (!state.av) {
      var video = $('html-player'), audios = video.audioTracks, texts = video.textTracks, i;
      if (audios) for (i = 0; i < audios.length; i++) if (audios[i].enabled) state.audioIndex = String(i);
      if (texts) for (i = 0; i < texts.length; i++) if (texts[i].mode === 'showing') state.textIndex = String(i);
      return;
    }
    var current = [];
    try { current = webapis.avplay.getCurrentStreamInfo() || []; } catch (e) {}
    current.forEach(function (stream) {
      var kind = String(stream.type || '').toUpperCase();
      if (kind === 'AUDIO') state.audioIndex = String(stream.index);
      if (kind === 'TEXT') state.textIndex = String(stream.index);
    });
  }
  function loadTracks() {
    if (!state.playing) return;
    state.tracks = {audio: [], text: []};
    if (state.av) {
      var info = [];
      try { info = webapis.avplay.getTotalTrackInfo() || []; } catch (e) { info = []; }
      info.forEach(function (track) {
        var kind = String(track.type || '').toUpperCase();
        if (kind === 'AUDIO') state.tracks.audio.push(track);
        if (kind === 'TEXT') state.tracks.text.push(track);
      });
    } else {
      var video = $('html-player'), audios = video.audioTracks, texts = video.textTracks, i;
      if (audios) for (i = 0; i < audios.length; i++) state.tracks.audio.push({index: String(i), extra_info: JSON.stringify({language: audios[i].language, label: audios[i].label})});
      if (texts) for (i = 0; i < texts.length; i++) {
        if (texts[i].kind === 'subtitles' || texts[i].kind === 'captions') state.tracks.text.push({index: String(i), extra_info: JSON.stringify({language: texts[i].language, label: texts[i].label})});
      }
    }
    rememberStreams();
    updateTrackLabels();
  }
  function updateTrackLabels() {
    show('player-audio', state.tracks.audio.length > 1);
    show('player-subs', state.tracks.text.length > 0);
    var audio = null, sub = null, n;
    for (n = 0; n < state.tracks.audio.length; n++) if (String(state.tracks.audio[n].index) === String(state.audioIndex)) audio = state.tracks.audio[n];
    for (n = 0; n < state.tracks.text.length; n++) if (String(state.tracks.text[n].index) === String(state.textIndex)) sub = state.tracks.text[n];
    if (audio) $('player-audio').textContent = 'Nyelv: ' + trackName(audio, 'audio', state.tracks.audio.indexOf(audio));
    if (sub) $('player-subs').textContent = 'Felirat: ' + trackName(sub, 'text', state.tracks.text.indexOf(sub));
    else $('player-subs').textContent = 'Felirat: Ki';
  }
  function openTrackMenu(kind) {
    var box = $('player-tracks');
    if (!box.classList.contains('hidden') && box.getAttribute('data-kind') === kind) { show('player-tracks', false); showChrome(); return; }
    var items = kind === 'audio' ? state.tracks.audio : [{index: 'off', off: true}].concat(state.tracks.text);
    box.setAttribute('data-kind', kind);
    box.innerHTML = items.map(function (track, index) {
      var selected = kind === 'audio' ? String(track.index) === String(state.audioIndex) : (track.off ? state.textIndex == null : String(track.index) === String(state.textIndex));
      var label = track.off ? 'Kikapcsolva' : trackName(track, kind, kind === 'audio' ? index : index - 1);
      return '<button data-track="' + kind + '" data-track-index="' + text(track.index) + '"' + (selected ? ' class="primary"' : '') + '>' + text(label) + '</button>';
    }).join('');
    show('player-tracks', true);
    showChrome();
    navigation.focus(box.querySelector('button.primary') || box.querySelector('button'));
  }
  function chooseTrack(kind, index) {
    try {
      if (kind === 'audio') {
        if (state.av) webapis.avplay.setSelectTrack('AUDIO', Number(index));
        else {
          var audios = $('html-player').audioTracks, chosen = Number(index), i;
          if (audios && audios[chosen]) audios[chosen].enabled = true;
          if (audios) for (i = 0; i < audios.length; i++) if (i !== chosen) audios[i].enabled = false;
        }
        state.audioIndex = String(index);
      } else if (index === 'off') {
        if (state.av) webapis.avplay.setSilentSubtitle(true);
        else {
          var texts = $('html-player').textTracks, j;
          if (texts) for (j = 0; j < texts.length; j++) texts[j].mode = 'disabled';
        }
        state.textIndex = null;
      } else {
        if (state.av) { try { webapis.avplay.setSilentSubtitle(false); } catch (ignore) {} webapis.avplay.setSelectTrack('TEXT', Number(index)); }
        else {
          var list = $('html-player').textTracks, picked = Number(index), k;
          if (list) for (k = 0; k < list.length; k++) list[k].mode = k === picked ? 'showing' : 'disabled';
        }
        state.textIndex = String(index);
      }
      note('');
    } catch (e) { note('A sáv nem váltható: ' + (e.message || e)); }
    show('player-tracks', false);
    updateTrackLabels();
    showChrome();
  }
  function watchHtmlTracks(video) {
    function hook(list) { if (list && list.addEventListener) list.addEventListener('addtrack', function () { if (state.playing) loadTracks(); }); }
    hook(video.audioTracks); hook(video.textTracks);
  }
  function openPlayer(film, url) {
    state.playing = film; $('player-title').textContent = film.title; show('playback', true);
    state.tracks = {audio: [], text: []}; state.audioIndex = null; state.textIndex = null;
    show('player-audio', false); show('player-subs', false); show('player-tracks', false);
    $('playback').classList.remove('idle');
    note('Videó előkészítése…');
    state.av = !!(window.webapis && webapis.avplay);
    if (state.av) {
      show('html-player', false); show('av-player', true);
      try {
        webapis.avplay.open(url);
        webapis.avplay.setDisplayRect(0, 0, 1920, 1080);
        webapis.avplay.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX');
        webapis.avplay.setListener({onbufferingstart: function () { note('Pufferelés…'); }, onbufferingcomplete: function () { note(''); loadTracks(); },
          onstreamcompleted: function () { saveProgress(); closePlayer(); }, onerror: function (code) { note('Lejátszási hiba: ' + code + '. Ellenőrizd a kodeket és a PC kapcsolatát.'); }});
        webapis.avplay.prepareAsync(function () {
          if (!state.playing) return;
          loadTracks();
          if (film.position > 0 && !film.watched) webapis.avplay.seekTo(Math.round(film.position * 1000));
          webapis.avplay.play(); note('');
        }, function () { note('A Samsung nem tudta előkészíteni a videót. Ellenőrizd a formátumot és a kapcsolatot.'); });
      } catch (e) { note('AVPlay hiba: ' + e.message); }
    } else {
      show('av-player', false); show('html-player', true);
      var video = $('html-player'); video.src = url;
      watchHtmlTracks(video);
      video.onloadedmetadata = function () { if (film.position > 0 && !film.watched) video.currentTime = film.position; loadTracks(); };
      video.onplaying = function () { note(''); };
      video.onerror = function () { note('A böngésző nem támogatja ezt a videót. A telepített Tizen-app több formátumot támogathat AVPlay segítségével.'); };
      video.onended = closePlayer;
      var promise = video.play(); if (promise && promise.catch) promise.catch(function () { note('A lejátszás indításához nyomd meg az OK / Folytatás gombot.'); });
    }
    $('player-toggle').textContent = 'Szünet'; $('player-toggle').focus();
  }
  function closePlayer() {
    if (!state.playing) return;
    saveProgress();
    clearTimeout(state.chromeTimer);
    if (state.av) { try { webapis.avplay.stop(); webapis.avplay.close(); } catch (_) {} }
    else { $('html-player').pause(); $('html-player').removeAttribute('src'); $('html-player').load(); }
    state.playing = null; state.av = false; $('playback').classList.remove('idle'); show('player-tracks', false); show('playback', false); loadLibrary(); focusFirst();
  }
  function togglePlayer() {
    if (!state.playing) return;
    if (state.av) { var playing = webapis.avplay.getState() === 'PLAYING'; if (playing) webapis.avplay.pause(); else webapis.avplay.play(); $('player-toggle').textContent = playing ? 'Folytatás' : 'Szünet'; }
    else { var v = $('html-player'); if (v.paused) { v.play(); $('player-toggle').textContent = 'Szünet'; } else { v.pause(); $('player-toggle').textContent = 'Folytatás'; } }
  }
  function seek(delta) {
    if (!state.playing) return;
    if (state.av) { try { var duration = webapis.avplay.getDuration(); webapis.avplay.seekTo(Math.max(0, Math.min(duration - 1000, webapis.avplay.getCurrentTime() + delta * 1000))); } catch (_) {} }
    else $('html-player').currentTime = Math.max(0, Math.min($('html-player').duration || 0, $('html-player').currentTime + delta));
  }
  function usb() {
    if (!window.tizen || !tizen.filesystem) return;
    message('USB-meghajtók olvasása…');
    tizen.filesystem.listStorages(function (storages) {
      var external = storages.filter(function (s) { return s.type === 'EXTERNAL' && s.state === 'MOUNTED'; });
      if (!external.length) { message('Nincs olvasható USB-meghajtó.'); return; }
      var found = [], pending = external.length, count = 0;
      function complete() { pending--; if (pending === 0) { state.videos = found; state.usb = true; state.page = 'library'; state.selected = null; render(); message(found.length + ' USB-videó. A PC-s könyvtárhoz válaszd a Kezdőlapot, majd frissíts.'); } }
      function walk(dir, depth) {
        dir.listFiles(function (files) {
          files.forEach(function (file) {
            if (++count > 10000) return;
            if (file.isDirectory && depth < 12) { pending++; walk(file, depth + 1); }
            else if (file.isFile && /\.(mp4|mkv|m4v|webm|avi|mov|ts)$/i.test(file.name)) found.push({id: 'usb-' + found.length, title: file.name, bytes: file.fileSize, uri: file.toURI(), usb: true});
          }); complete();
        }, function () { complete(); });
      }
      external.forEach(function (storage) { tizen.filesystem.resolve(storage.label, function (dir) { walk(dir, 0); }, function () { complete(); }, 'r'); });
    }, function () { message('Az USB-meghajtók olvasása nem engedélyezett ezen a TV-n.'); });
  }
  function action(name) {
    if (name === 'library') navigate('library');
    else if (name === 'receivers-refresh') refreshReceivers();
    else if (name === 'receiver-toggle') { state.receiving = !state.receiving; localStorage.setItem('cinema.receiver', String(state.receiving)); if (!state.receiving) api('/api/receiver', {enabled:false}).catch(error); else receiveRemote(); render(); }
    else if (name === 'apps') navigate('apps');
    else if (name === 'downloads') navigate('downloads');
    else if (name === 'refresh-apps') { closeModal(); apps.refresh(function () { render(); message(appStatus()); }); message('Alkalmazások beolvasása…'); }
    else if (name === 'rescan') { message('Médiatár beolvasása…'); api('/api/rescan', {}).then(function (r) { message(r.count + ' film beolvasva.'); loadLibrary(); }).catch(error); }
    else if (name === 'back-details') backDetails();
    else if (name === 'import') importDialog();
    else if (name === 'upload-torrent') uploadTorrent();
    else if (name === 'modal-close') closeModal();
    else if (name === 'magnet') magnetDialog();
    else if (name === 'add-magnet') api('/api/magnet', {magnet: $('magnet-value').value.trim(), movieId: state.selected && state.selected.movieId, title: state.selected && state.selected.title}).then(afterAdd).catch(error);
    else if (name === 'reconnect') { if (automatic) resumeConnection(); else pairing(); }
    else if (name === 'renew') api('/api/renew-pairing', {}).then(localPairing).catch(error);
    else if (name === 'autoplay') { state.settings.autoplay = !state.settings.autoplay; api('/api/settings', {autoplay: state.settings.autoplay}).then(function () { render(); }).catch(error); }
    else if (name === 'save-settings') api('/api/settings', {max_gib: Number($('max-gib').value), reserve_gib: Number($('reserve-gib').value)}).then(function () { connect(); message('Beállítások mentve.'); }).catch(error);
    else if (name === 'save-tmdb') api('/api/settings', {tmdb_token: $('tmdb-token').value.trim()}).then(function () { connect(); message('TMDb-token mentve.'); }).catch(error);
    else if (name === 'shutdown-ask') modal('<h2>Kikapcsolod a PC-t?</h2><p>A film leáll, a futó letöltés megszakad, és a számítógép néhány másodperc múlva leáll.</p><div class="actions"><button data-action="shutdown-pc">PC kikapcsolása</button><button class="primary" data-action="modal-close">Mégse</button></div>');
    else if (name === 'shutdown-pc') api('/api/power', {action:'shutdown'}).then(function () { closeModal(); message('A PC leáll.'); }).catch(error);
    else if (name === 'search') modal('<h2>Filmkeresés</h2><input id="search-value" placeholder="Filmcím"><div class="actions"><button class="primary" data-action="do-search">Keresés</button><button data-action="modal-close">Mégse</button></div>');
    else if (name === 'do-search') {
      var query = $('search-value').value.trim(); closeModal();
      var matches = state.videos.filter(function (v) { return v.title.toLocaleLowerCase().indexOf(query.toLocaleLowerCase()) >= 0; });
      if (matches.length) { state.page = 'library'; state.videos = matches; render(); message(matches.length + ' helyi találat. A teljes listához frissíts.'); }
      else if (state.settings.tmdb_configured) { navigate('home'); loadCatalog(query); }
      else message('Nincs helyi találat. A TMDb-kereséshez a PC-n állíts be saját tokent.');
    }
  }
  document.addEventListener('click', function (event) {
    var node = event.target.closest('button'); if (!node) return;
    if (state.playing) showChrome();
    if (node.hasAttribute('data-page')) navigate(node.getAttribute('data-page'));
    else if (node.hasAttribute('data-tv-service')) sendService(node.getAttribute('data-receiver'), node.getAttribute('data-tv-service'));
    else if (node.hasAttribute('data-send-tv')) sendToTv(node.getAttribute('data-send-tv'));
    else if (node.hasAttribute('data-remote')) api('/api/remote', {receiverId:node.getAttribute('data-receiver'), action:node.getAttribute('data-remote'), videoId:node.getAttribute('data-remote-video')}).then(function () { closeModal(); message('Parancs elküldve. A TV oldalán látható állapot mutatja, hogy a fogadó jelentkezik-e és játszik-e.'); }).catch(error);
    else if (node.hasAttribute('data-service')) serviceDialog(node.getAttribute('data-service'));
    else if (node.hasAttribute('data-launch-app')) launchApp(node.getAttribute('data-launch-app'));
    else if (node.hasAttribute('data-pin-app')) { apps.togglePin(node.getAttribute('data-pin-app')); render(); }
    else if (node.hasAttribute('data-video')) details(node.getAttribute('data-video'));
    else if (node.hasAttribute('data-action')) action(node.getAttribute('data-action'));
    else if (node.id === 'player-audio') openTrackMenu('audio');
    else if (node.id === 'player-subs') openTrackMenu('text');
    else if (node.hasAttribute('data-track')) chooseTrack(node.getAttribute('data-track'), node.getAttribute('data-track-index'));
    else if (node.hasAttribute('data-play')) play(node.getAttribute('data-play'));
    else if (node.hasAttribute('data-ready-video')) { state.waiting = ''; localStorage.removeItem('cinema.waiting'); play(node.getAttribute('data-ready-video')); }
    else if (node.hasAttribute('data-favorite')) api('/api/favorite', {id: node.getAttribute('data-favorite')}).then(function () { state.selected = null; loadLibrary(); }).catch(error);
    else if (node.hasAttribute('data-job')) api('/api/download-action', {id: node.getAttribute('data-job'), action: node.getAttribute('data-job-action')}).then(poll).catch(error);
    else if (node.hasAttribute('data-wait')) { state.waiting = node.getAttribute('data-wait'); localStorage.setItem('cinema.waiting', state.waiting); poll(); }
  });
  function moveFocus(direction) {
    var scope = !$('pairing').classList.contains('hidden') ? $('pairing') : !$('modal').classList.contains('hidden') ? $('modal') : state.playing ? $('playback') : $('app');
    navigation.move(scope, direction, state.pageFocus[state.page]);
  }
  document.addEventListener('keydown', function (event) {
    var code = event.keyCode, focused = document.activeElement;
    var back = code === 10009 || code === 27 || (code === 8 && focused.tagName !== 'INPUT');
    if (focused.tagName === 'INPUT') {
      // Samsung Done/Cancel dismiss the IME, not the enclosing app dialog.
      if (code === 65376 || code === 65385 || back) {
        if (back && heldKeys.back) { event.preventDefault(); return; }
        if (back) heldKeys.back = true;
        focused.blur();
        var form = focused.closest('.dialog,.settings-form,.panel') || $('content');
        navigation.focus(form.querySelector('button'));
      }
      return;
    }
    if (state.playing && !back) {
      var idle = $('playback').classList.contains('idle');
      if (idle && $('player-tracks').classList.contains('hidden') && ((code >= 37 && code <= 40) || code === 13)) { event.preventDefault(); showChrome(); return; }
      showChrome();
    }
    if (back) {
      event.preventDefault(); event.stopPropagation();
      if (heldKeys.back || event.repeat) return; heldKeys.back = true;
      if (!$('modal').classList.contains('hidden')) closeModal();
      else if (state.playing && !$('player-tracks').classList.contains('hidden')) { show('player-tracks', false); showChrome(); }
      else if (state.playing) closePlayer();
      else if (!$('pairing').classList.contains('hidden')) { show('pairing', false); navigate('apps'); }
      else if (state.selected) backDetails();
      else if (state.page !== 'home') navigate('home');
      else if (window.tizen) modal('<h2>Kilépsz a Cinema TV-ből?</h2><div class="actions"><button id="exit-app">Kilépés</button><button class="primary" data-action="modal-close">Maradok</button></div>');
    } else if (code >= 37 && code <= 40) {
      event.preventDefault();
      var now = Date.now(); if (event.repeat && now - lastMove < 130) return;
      lastMove = now; moveFocus(code);
    }
    else if (code === 13 && focused.tagName === 'BUTTON') {
      event.preventDefault(); event.stopPropagation();
      if (heldKeys.ok || event.repeat) return; heldKeys.ok = true; focused.click();
    }
    else if (state.playing && (code === 10252 || code === 415 || code === 19 || code === 32)) { event.preventDefault(); togglePlayer(); }
    else if (state.playing && code === 417) seek(30);
    else if (state.playing && code === 412) seek(-30);
  });
  document.addEventListener('keypress', function (event) { if (event.keyCode === 13 && heldKeys.ok) event.preventDefault(); });
  document.addEventListener('keyup', function (event) {
    if (event.keyCode === 13 && heldKeys.ok) { event.preventDefault(); heldKeys.ok = false; }
    if (event.keyCode === 10009 || event.keyCode === 27 || event.keyCode === 8 || event.keyCode === 65385) heldKeys.back = false;
  });
  document.addEventListener('focusin', function () {
    if (!state.selected) { var key = navigation.capture($('content')); if (key) state.pageFocus[state.page] = key; }
  });
  window.addEventListener('blur', function () { heldKeys = {}; });
  document.addEventListener('click', function (e) { if (e.target.id === 'exit-app' && window.tizen) tizen.application.getCurrentApplication().exit(); });
  $('pair-submit').onclick = pair; $('usb-open').onclick = usb;
  $('pair-later').onclick = function () { show('pairing', false); navigate('apps'); focusFirst(); };
  document.addEventListener('mousemove', function () { if (state.playing) showChrome(); });
  document.addEventListener('click', function (event) { if (!state.playing || (event.target.closest && event.target.closest('button'))) return; showChrome(); });
  $('player-close').onclick = closePlayer; $('player-toggle').onclick = togglePlayer;
  $('player-rewind').onclick = function () { seek(-30); }; $('player-forward').onclick = function () { seek(30); };
  document.addEventListener('visibilitychange', function () { if (document.hidden && state.playing) { saveProgress(); if (state.av) { try { webapis.avplay.pause(); } catch (_) {} } else $('html-player').pause(); } else if (!document.hidden) { apps.refresh(function () { if (!state.selected && !state.playing) render(); }); } });
  window.addEventListener('beforeunload', saveProgress);
  setInterval(function () { if (state.playing) { try { var p = state.av ? webapis.avplay.getCurrentTime() / 1000 : $('html-player').currentTime; var d = state.av ? webapis.avplay.getDuration() / 1000 : $('html-player').duration; $('player-time').textContent = clock(p) + ' / ' + clock(d); saveProgress(); } catch (_) {} } }, 5000);
  setInterval(poll, 4000);
  setInterval(function () { receiveRemote(); if (state.online && state.local && state.page === 'remote') refreshReceivers(); }, 2000);
  setInterval(function () { if (automatic && !document.hidden && !state.online && !state.connecting) resumeConnection(); }, 8000);
  if (window.tizen) {
    show('usb-open', true);
    try { ['MediaPlayPause','MediaPlay','MediaPause','MediaFastForward','MediaRewind'].forEach(function (name) { tizen.tvinputdevice.registerKey(name); }); } catch (_) {}
    var script = document.createElement('script'); script.src = '$WEBAPIS/webapis/webapis.js';
    script.onload = function () { if (automatic && !state.online) resumeConnection(); }; document.head.appendChild(script);
  }
  render();
  apps.refresh(function () { if (!state.selected && !state.playing) render(); });
  if (automatic) resumeConnection();
  else if (state.token && state.base) connect();
  else if (state.base) api('/api/local-pairing').then(function (r) { $('pairing-pin').value = r.pin; $('server-url').value = state.base; pair(); }).catch(pairing);
  else pairing();
  focusFirst();
}());
