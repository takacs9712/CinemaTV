'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
async function run(){
  const handlers={},nodes=new Map();let document;
  function element(id,tag='DIV',attrs={}){
    const classes=new Set(['hidden']);
    return {id,tagName:tag,children:[],offsetWidth:100,offsetHeight:50,scrollLeft:0,
      classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle:(x,on)=>on?classes.add(x):classes.delete(x)},
      getAttribute:k=>k==='id'?id:attrs[k]??null,hasAttribute:k=>k==='id'?!!id:k in attrs,
      matches:selector=>selector.includes('button.primary')&&attrs.class==='primary',
      closest:()=>null,contains(other){return this===other||this.children.includes(other);},
      querySelectorAll(){return this.children;},querySelector(){return this.children[0]||null;},
      getBoundingClientRect:()=>({left:100,right:200,top:150,bottom:200,width:100,height:50}),
      focus(){document.activeElement=this;},blur(){document.activeElement=get('body');},appendChild(){},click(){},
      set innerHTML(value){this.html=value;if(id==='modal-content'&&value.includes('Kilépsz'))this.children=[element('exit-app','BUTTON'),element('stay','BUTTON',{'data-action':'modal-close',class:'primary'})];},get innerHTML(){return this.html||'';}
    };
  }
  function get(id){if(!nodes.has(id))nodes.set(id,element(id));return nodes.get(id);}
  document={activeElement:get('body'),hidden:false,getElementById:get,createElement:()=>element(''),head:element('head'),documentElement:{contains:()=>true},querySelector:()=>null,querySelectorAll:()=>[],addEventListener:(name,fn)=>(handlers[name]??=[]).push(fn)};
  function event(name,code,repeat=false){const e={keyCode:code,repeat,prevented:false,preventDefault(){this.prevented=true;},stopPropagation(){}};(handlers[name]||[]).forEach(fn=>fn(e));return e;}
  const storage={'cinema.server':'http://192.168.1.50:8790','cinema.token':'saved','cinema.binding':'own'};
  class XHR{open(method,url){this.url=url;}setRequestHeader(){}send(){queueMicrotask(()=>{this.status=200;this.responseText=JSON.stringify(this.url.endsWith('/api/settings')?{local:false}:this.url.endsWith('/api/library')?{videos:[]}:{command:null});this.onload();});}}
  const window={document,innerHeight:1080,scrollBy(){},CinemaBootstrap:{server:storage['cinema.server'],discoveryId:'own'},CinemaConnection:{find:()=>Promise.resolve(storage['cinema.server'])},CinemaApps:{services:[],pins:()=>[],recent:()=>[],refresh:fn=>fn(),availableServices:()=>[]},tizen:{tvinputdevice:{registerKey(){}}},addEventListener(){}};
  const context=vm.createContext({window,document,localStorage:{getItem:k=>storage[k]||null,setItem:(k,v)=>storage[k]=v},navigator:{userAgent:'Tizen'},location:{protocol:'file:'},XMLHttpRequest:XHR,Promise,setInterval(){}});
  for(const file of ['navigation.js','app.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../tv',file),'utf8'),context);
  await new Promise(resolve=>setImmediate(resolve));
  let firstClicks=0,secondClicks=0;
  const first=element('first','BUTTON'),second=element('second','BUTTON');
  first.click=()=>{firstClicks++;second.focus();};second.click=()=>{secondClicks++;};first.focus();
  event('keydown',13);event('keydown',13);event('keydown',13,true);
  assert.equal(firstClicks,1);assert.equal(secondClicks,0,'held OK must not activate the newly focused control');
  assert.ok(event('keypress',13).prevented);assert.ok(event('keyup',13).prevented);
  event('keydown',13);event('keyup',13);assert.equal(secondClicks,1);
  event('keydown',10009);assert.ok(!get('modal').classList.contains('hidden'));
  assert.equal(document.activeElement.id,'stay','exit confirmation defaults to staying in the app');
  event('keydown',10009);event('keydown',10009,true);assert.ok(!get('modal').classList.contains('hidden'),'held Back must not cascade through screens');
  event('keyup',10009);event('keydown',10009);assert.ok(get('modal').classList.contains('hidden'));assert.equal(document.activeElement,second);event('keyup',10009);
  event('keydown',10009);event('keyup',10009);
  const input=element('input','INPUT'),form=element('form'),done=element('done','BUTTON');form.children=[done];input.closest=()=>form;input.focus();
  event('keydown',65385);assert.equal(document.activeElement,done);assert.ok(!get('modal').classList.contains('hidden'),'IME Cancel must not close the app dialog');
  input.focus();assert.equal(event('keydown',37).prevented,false);assert.equal(event('keydown',8).prevented,false);
  console.log('OK held OK activates once; held Back cannot cascade; exit defaults to Stay; IME Cancel closes the keyboard without closing the dialog; text editing remains native.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
