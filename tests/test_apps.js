'use strict';
// Contract tests for native API errors and real installed IDs; no TV emulator required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../tv/apps.js'), 'utf8');
function harness(api, values = {}) {
  const pending = new Map(); let next = 0;
  const window = {tizen:api ? {application:api} : undefined, localStorage:{getItem:k=>values[k] || null, setItem:(k,v)=>{values[k]=v;}},
    setTimeout:fn=>{pending.set(++next,fn);return next;}, clearTimeout:id=>pending.delete(id)};
  vm.runInNewContext(source, {window});
  return {apps:window.CinemaApps, pending, values, window};
}
function app(id,name,show=true) { return {id,name,show}; }
let passed = 0;
function test(name,fn) { fn(); passed++; console.log('OK ' + name); }
test('PC browser never discovers or invents native app IDs', () => {
  const h=harness(); h.apps.refresh(); assert.equal(h.apps.status(),'browser'); assert.equal(h.apps.match(h.apps.find('netflix')),null);
  let error; h.apps.launch('guessed.netflix',e=>{error=e;}); assert.ok(error);
});
test('only visible installed user apps may launch; own, hidden and factory apps excluded', () => {
  let launched;
  const h=harness({getCurrentApplication:()=>({appInfo:{id:'own'}}), getAppsInfo:ok=>ok([app('real.netflix','Netflix'),app('own','Cinema TV'),app('hidden','Netflix',false),app('factory','Factory Menu')]), launch:(id,ok)=>{launched=id;ok();}});
  h.apps.refresh(); assert.equal(h.apps.installed().length,1); assert.equal(h.apps.match(h.apps.find('netflix')).id,'real.netflix');
  h.apps.launch('real.netflix',e=>assert.equal(e,undefined)); assert.equal(launched,'real.netflix'); assert.equal(h.apps.recent()[0],'real.netflix');
  h.apps.launch('hidden',e=>assert.ok(e)); assert.equal(launched,'real.netflix');
});
test('ambiguous service names require choosing a real app instead of guessing', () => {
  const h=harness({getAppsInfo:ok=>ok([app('one','Netflix'),app('two','NETFLIX')])});h.apps.refresh();
  assert.equal(h.apps.match(h.apps.find('netflix')),null); h.apps.togglePin('one'); assert.equal(h.apps.pins()[0],'one'); h.apps.togglePin('one'); assert.equal(h.apps.pins().length,0);
});
test('denied API and timeout are visible failure states; stale callbacks cannot replace a newer scan', () => {
  let oldCallback;
  const api={getAppsInfo:ok=>{oldCallback=ok;}}; const h=harness(api); h.apps.refresh(); const old=oldCallback;
  api.getAppsInfo=ok=>ok([app('latest','YouTube')]); h.apps.refresh(); old([app('stale','Netflix')]); assert.equal(h.apps.installed()[0].id,'latest');
  api.getAppsInfo=(ok,fail)=>fail({name:'SecurityError'}); h.apps.refresh(); assert.equal(h.apps.status(),'error');assert.equal(h.apps.failure(),'SecurityError');
  api.getAppsInfo=()=>{};h.apps.refresh();Array.from(h.pending.values())[0]();assert.equal(h.apps.status(),'error');
});
test('failed launch is reported and never recorded as a recent successful app', () => {
  const h=harness({getAppsInfo:ok=>ok([app('n','Netflix')]),launch:(id,ok,fail)=>fail({name:'SecurityError'})});h.apps.refresh();
  let error;h.apps.launch('n',e=>{error=e;});assert.match(error.message,/SecurityError/);assert.equal(h.apps.recent().length,0);
});
test('missing launch API reports firmware limitation without navigating to a website', () => {
  const h=harness({getAppsInfo:ok=>ok([app('n','Netflix')])});h.apps.refresh();let error;h.apps.launch('n',e=>{error=e;});assert.match(error.message,/firmware/);
});
test('streaming advertises only launchable native services and resolves their real IDs on the TV', () => {
  let launched;
  const h=harness({getAppsInfo:ok=>ok([app('region-specific.netflix','Netflix'),app('hidden.youtube','YouTube',false)]),launch:(id,ok)=>{launched=id;ok();}});h.apps.refresh();
  assert.equal(h.apps.availableServices().join(','),'netflix');
  h.apps.launchService('netflix',e=>assert.equal(e,undefined));assert.equal(launched,'region-specific.netflix');
  h.apps.launchService('arbitrary-app-id',e=>assert.ok(e));assert.equal(launched,'region-specific.netflix');
  const browser=harness();browser.apps.refresh();assert.equal(browser.apps.availableServices().length,0);
});
test('installed application without a launch API is never advertised as a PC streaming target', () => {
  const h=harness({getAppsInfo:ok=>ok([app('netflix','Netflix')])});h.apps.refresh();assert.equal(h.apps.availableServices().length,0);
});
test('saved Netflix and Max restore before scanning and survive API errors, timeouts, empty and partial lists', () => {
  let scanned=[app('native.netflix','Netflix'),app('native.max','HBO Max')], fail=false, launched;
  const api={getAppsInfo:(ok,bad)=>fail?bad({name:'UnknownError'}):ok(scanned),launch:(id,ok)=>{launched=id;ok();}};
  const first=harness(api);first.apps.refresh();
  assert.ok(first.values['cinema.installedApps.v1']);
  const restarted=harness(api,first.values);
  assert.equal(restarted.apps.status(),'cached');assert.equal(restarted.apps.availableServices().join(','),'netflix,max');
  let pendingScan;api.getAppsInfo=ok=>{pendingScan=ok;};restarted.apps.refresh();
  assert.equal(restarted.apps.match(restarted.apps.find('netflix')).id,'native.netflix');
  pendingScan([app('native.youtube','YouTube')]);assert.equal(restarted.apps.installed().length,3);
  api.getAppsInfo=ok=>ok([]);restarted.apps.refresh();assert.equal(restarted.apps.installed().length,3);
  api.getAppsInfo=(ok,bad)=>bad({name:'SecurityError'});restarted.apps.refresh();assert.equal(restarted.apps.installed().length,3);
  api.getAppsInfo=()=>{};restarted.apps.refresh();Array.from(restarted.pending.values())[0]();assert.equal(restarted.apps.failure(),'Időtúllépés');assert.equal(restarted.apps.installed().length,3);
  restarted.apps.launchService('netflix',e=>assert.equal(e,undefined));assert.equal(launched,'native.netflix');
  const again=harness(api,first.values);assert.equal(again.apps.match(again.apps.find('max')).id,'native.max');
});
test('a newly observed service ID replaces the shortcut binding and persists without an ambiguous cached match', () => {
  let list=[app('old.netflix','Netflix')];const api={getAppsInfo:ok=>ok(list)};
  const h=harness(api);h.apps.refresh();list=[app('new.netflix','Netflix')];h.apps.refresh();
  assert.equal(h.apps.installed().length,2);assert.equal(h.apps.match(h.apps.find('netflix')).id,'new.netflix');
  assert.equal(harness(api,h.values).apps.match(h.apps.find('netflix')).id,'new.netflix');
});
test('only a confirmed native removal or hidden flag removes a remembered application', () => {
  let list=[app('n','Netflix'),app('m','Max')], launches=0;
  const api={getAppsInfo:ok=>ok(list),launch:(id,ok)=>{launches++;ok();}};
  const h=harness(api);h.apps.refresh();list=[];h.apps.refresh();assert.equal(h.apps.installed().length,2);
  api.getAppInfo=()=>{throw {name:'UnknownError'};};h.apps.launch('n',e=>assert.equal(e,undefined));assert.equal(launches,1);assert.equal(h.apps.installed().length,2);
  api.getAppInfo=()=>{throw {name:'NotFoundError'};};h.apps.launch('n',e=>assert.match(e.message,/nincs telepítve/));assert.equal(launches,1);assert.equal(h.apps.match(h.apps.find('netflix')),null);
  assert.equal(harness(api,h.values).apps.match(h.apps.find('netflix')),null);
  list=[app('m','Max',false)];h.apps.refresh();assert.equal(h.apps.installed().length,0);
});
test('saved user app lists exclude hidden, own and factory entries and are never used in a browser', () => {
  const values={'cinema.installedApps.v1':JSON.stringify({version:1,owner:'own',apps:[app('real','Netflix'),app('hidden','Max',false),app('factory','Factory Menu'),app('own','Cinema TV')],bindings:{netflix:'factory'}})};
  const api={getCurrentApplication:()=>({appInfo:{id:'own'}}),getAppsInfo:()=>{},launch(){}};
  const h=harness(api,values);assert.equal(h.apps.installed().length,1);assert.equal(h.apps.match(h.apps.find('netflix')).id,'real');
  const browser=harness(undefined,values);assert.equal(browser.apps.installed().length,0);assert.equal(browser.apps.availableServices().length,0);
  const other=harness({...api,getCurrentApplication:()=>({appInfo:{id:'other'}})},values);assert.equal(other.apps.installed().length,0);
});
test('a storage failure is visible without losing the working in-memory app list', () => {
  const h=harness({getAppsInfo:ok=>ok([app('n','Netflix')])});
  h.window.localStorage.setItem=()=>{throw new Error('quota');};h.apps.refresh();
  assert.equal(h.apps.match(h.apps.find('netflix')).id,'n');assert.match(h.apps.cacheError(),/tartós mentését/);
  const corrupt=harness({getAppsInfo:ok=>ok([app('n','Netflix')])},{'cinema.installedApps.v1':'not-json'});corrupt.apps.refresh();assert.equal(corrupt.apps.installed().length,1);
});
test('cold-start discovery retries are bounded and an explicit refresh cancels the old retry', () => {
  let scans=0;const api={getAppsInfo:ok=>{scans++;ok([]);}};const h=harness(api);h.apps.refresh();
  for(let i=0;i<2;i++){assert.equal(h.pending.size,1);const [id,fn]=Array.from(h.pending.entries())[0];h.pending.delete(id);fn();}
  assert.equal(scans,3);assert.equal(h.pending.size,0);
  h.apps.refresh();const obsolete=Array.from(h.pending.values())[0];
  api.getAppsInfo=ok=>{scans++;ok([app('n','Netflix')]);};h.apps.refresh();const count=scans;obsolete();assert.equal(scans,count);assert.equal(h.apps.installed().length,1);
});
console.log(passed+' application contract tests passed.');
