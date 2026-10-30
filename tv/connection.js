/* Find the paired PC without sending credentials to other LAN devices. ES5. */
(function (root) {
  'use strict';
  function privateIp(value) {
    var parts = String(value || '').split('.');
    if (parts.length !== 4 || parts.some(function (p) { return !/^\d{1,3}$/.test(p) || Number(p) > 255; })) return false;
    return Number(parts[0]) === 10 || (Number(parts[0]) === 192 && Number(parts[1]) === 168) ||
      (Number(parts[0]) === 172 && Number(parts[1]) >= 16 && Number(parts[1]) <= 31);
  }
  function ascii(value) { return new Uint8Array(String(value).split('').map(function (c) { return c.charCodeAt(0); })); }
  function hex(bytes) { return Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  function targets(config, last, ip) {
    var result = [], seen = {}, port = Number(config.port) || 8790;
    function add(base) { if (!seen[base]) { seen[base] = true; result.push(base); } }
    [last, config.server].forEach(function (base) {
      var match = /^http:\/\/([\d.]+)(?::\d+)?$/.exec(base || '');
      if (match && privateIp(match[1])) add(base);
    });
    if (/^[a-z0-9][a-z0-9-]{0,62}$/.test(config.hostname || '')) add('http://' + config.hostname + ':' + port);
    // Prefer the TV's current network, then the previous PC network. Bound the
    // search to these two home /24 ranges; never scan public addresses.
    [ip, (String(last || config.server).match(/http:\/\/([\d.]+)/) || [])[1]].forEach(function (address) {
      if (!privateIp(address)) return;
      var prefix = address.split('.').slice(0, 3).join('.') + '.';
      for (var n = 1; n < 255; n++) add('http://' + prefix + n + ':' + port);
    });
    return result;
  }
  function find(config, last) {
    var crypto = root.crypto;
    if (!crypto || !crypto.subtle || !crypto.getRandomValues) return Promise.reject(new Error('A TV biztonságos PC-felismerése nem érhető el.'));
    var nonce = hex(crypto.getRandomValues(new Uint8Array(16))), ip = '';
    try { ip = root.webapis.network.getIp(); } catch (_) {}
    var candidates = targets(config, last, ip);
    return crypto.subtle.importKey('raw', ascii(config.enrollment), {name:'HMAC', hash:'SHA-256'}, false, ['verify']).then(function (key) {
      return new Promise(function (resolve, reject) {
        var next = 0, active = 0, done = false, requests = [];
        function finish(base) {
          if (done) return;
          done = true; root.clearTimeout(deadline);
          requests.forEach(function (request) { request.abort(); });
          if (base) resolve(base); else reject(new Error('A PC-re várunk. Ha a Cinema TV szerver elindul, automatikusan csatlakozunk.'));
        }
        var deadline = root.setTimeout(function () { finish(); }, 60000);
        function pump() {
          if (done) return;
          if (next >= candidates.length && active === 0) { finish(); return; }
          while (!done && active < 8 && next < candidates.length) probe(candidates[next++]);
        }
        function probe(base) {
          var xhr = new root.XMLHttpRequest(), settled = false; active++; requests.push(xhr);
          function complete(found) { if (settled) return; settled = true; active--; if (found) finish(base); else pump(); }
          xhr.open('GET', base + '/api/discover?id=' + config.discoveryId + '&nonce=' + nonce, true);
          xhr.timeout = 1200;
          xhr.onerror = xhr.ontimeout = function () { complete(false); };
          xhr.onload = function () {
            var proof;
            try { proof = JSON.parse(xhr.responseText).proof; } catch (_) { complete(false); return; }
            if (xhr.status !== 200 || !/^[a-f0-9]{64}$/.test(proof || '')) { complete(false); return; }
            var signature = new Uint8Array(proof.match(/../g).map(function (p) { return parseInt(p, 16); }));
            crypto.subtle.verify('HMAC', key, signature, ascii('Cinema TV discovery:' + config.discoveryId + ':' + nonce)).then(complete, function () { complete(false); });
          };
          try { xhr.send(); } catch (_) { complete(false); }
        }
        pump();
      });
    });
  }
  root.CinemaConnection = {find:find, targets:targets};
}(window));
