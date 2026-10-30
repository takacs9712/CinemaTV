'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const source = fs.readFileSync(require('node:path').join(__dirname,'../tv/connection.js'),'utf8');
const secret = 'private-test-device-key-with-enough-entropy';
const config = {server:'http://192.168.1.50:8790',port:8790,hostname:'cinema-pc',enrollment:secret,discoveryId:crypto.createHash('sha256').update(secret).digest('hex')};
async function run() {
  const calls = []; let active = 0, maxActive = 0;
  const window = {crypto:crypto.webcrypto,webapis:{network:{getIp:()=> '192.168.1.208'}},setTimeout,clearTimeout};
  class XHR {
    open(method,url) { this.method=method;this.url=url; }
    setRequestHeader() { throw new Error('Discovery must never send authorization'); }
    send(body) {
      assert.equal(body,undefined); assert.equal(this.method,'GET');
      assert.ok(!this.url.includes(secret)); calls.push(this.url); active++; maxActive=Math.max(maxActive,active);
      this.timer=setTimeout(()=> {
        active--;
        const url=new URL(this.url);
        this.status=200;
        const content='Cinema TV discovery:'+config.discoveryId+':'+url.searchParams.get('nonce');
        // A forged response at the old address must not win the race.
        this.responseText=JSON.stringify({proof:url.hostname==='192.168.1.77' ? crypto.createHmac('sha256',secret).update(content).digest('hex') : '0'.repeat(64)});
        this.onload();
      },1);
    }
    abort() { clearTimeout(this.timer); }
  }
  window.XMLHttpRequest=XHR;
  vm.runInNewContext(source,{window,Promise,Uint8Array});
  const found=await window.CinemaConnection.find(config,'http://192.168.1.50:8790');
  assert.equal(found,'http://192.168.1.77:8790');
  assert.ok(maxActive<=8);
  assert.ok(calls.some(url=>url.includes('cinema-pc')));
  const targets=Array.from(window.CinemaConnection.targets(config,'http://192.168.1.50:8790','10.1.2.208'));
  assert.ok(targets.includes('http://10.1.2.77:8790'));
  assert.ok(targets.includes('http://192.168.1.77:8790'));
  assert.ok(targets.length<=511);
  assert.equal(new Set(targets).size,targets.length);
  const invalid=Array.from(window.CinemaConnection.targets({...config,server:'http://8.8.8.8:8790',hostname:'attacker.invalid'},'https://attacker.invalid','8.8.8.8'));
  assert.equal(invalid.length,0);
  window.crypto=undefined;
  await assert.rejects(window.CinemaConnection.find(config,''),/biztonságos/);
  console.log('OK changed PC and TV addresses reconnect using verified HMAC proof; forged servers rejected; bounded private-network search; no credentials sent during discovery.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
