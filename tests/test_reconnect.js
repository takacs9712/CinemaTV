'use strict';
// Run the real UI through an outage, recovery, and a late pre-outage timeout.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../tv/app.js'),'utf8');
async function run() {
  const nodes=new Map(), intervals=new Map(), requests=[];
  function node() {
    const classes=new Set(['hidden']);
    return {textContent:'',innerHTML:'',tagName:'BUTTON',classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle:(x,on)=>on?classes.add(x):classes.delete(x)},
      getAttribute:()=>null,querySelectorAll:()=>[],querySelector:()=>null,focus(){},appendChild(){}};
  }
  const get=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
  const document={hidden:false,activeElement:node(),head:node(),getElementById:get,createElement:node,addEventListener(){},querySelectorAll:()=>[],querySelector:()=>node()};
  const values={'cinema.token':'saved-device-token','cinema.server':'http://192.168.1.50:8790','cinema.binding':'own-pc'};
  const storage={getItem:k=>values[k]||null,setItem:(k,v)=>{values[k]=v;},removeItem:k=>{delete values[k];}};
  let holdDownload=false, failReceiver=false, delayed;
  class XHR {
    open(method,url){this.url=url;this.method=method;}
    setRequestHeader(){}
    send(body){
      const path=new URL(this.url).pathname;requests.push({path,body:body&&JSON.parse(body)});
      if(path==='/api/downloads'&&holdDownload){delayed=this;return;}
      queueMicrotask(()=>{
        if(path==='/api/receiver'&&failReceiver){failReceiver=false;this.onerror();return;}
        this.status=200;this.responseText=JSON.stringify(path==='/api/settings'?{local:false,tmdb_configured:false}:path==='/api/library'?{videos:[]}:path==='/api/downloads'?{jobs:[]}:{command:null});this.onload();
      });
    }
  }
  const apps={services:[],pins:()=>[],recent:()=>[],installed:()=>[],refresh:fn=>fn(),availableServices:()=>['netflix']};
  const window={CinemaBootstrap:{server:values['cinema.server'],enrollment:'private',discoveryId:'own-pc'},CinemaConnection:{find:()=>Promise.resolve('http://192.168.1.77:8790')},CinemaApps:apps,tizen:{tvinputdevice:{registerKey(){}}},addEventListener(){}};
  window.document=document;
  const context={window,document,localStorage:storage,location:{protocol:'file:'},navigator:{userAgent:'Tizen'},XMLHttpRequest:XHR,Promise,setInterval:(fn,ms)=>intervals.set(ms,fn)};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../tv/navigation.js'),'utf8'),context);
  vm.runInContext(source,context);
  const flush=()=>new Promise(resolve=>setImmediate(resolve));
  await flush();
  assert.equal(get('connection').textContent,'PC csatlakoztatva');
  holdDownload=true;intervals.get(4000)();assert.ok(delayed);
  failReceiver=true;intervals.get(2000)();await flush();
  assert.equal(get('connection').textContent,'Várakozás a PC-re…');
  intervals.get(8000)();await flush();
  assert.equal(get('connection').textContent,'PC csatlakoztatva');
  delayed.ontimeout();await flush();
  assert.equal(get('connection').textContent,'PC csatlakoztatva');
  assert.equal(get('message').textContent,'');
  assert.ok(get('pairing').classList.contains('hidden'));
  assert.equal(requests.filter(x=>x.path==='/api/receiver').at(-1).body.status,'Készen áll');
  assert.ok(!requests.some(x=>x.path==='/api/pair'));
  assert.equal(values['cinema.server'],'http://192.168.1.77:8790');
  console.log('OK real UI reconnects without a PIN, clears the outage message, and ignores a late timeout from the old connection.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
