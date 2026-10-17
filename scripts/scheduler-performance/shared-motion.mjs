import {useLayoutEffect,useRef,useState} from 'react';
// Proposed shared durations use the approved review ranges, not platform detection.
export const motion={control:120,pointerEnter:140,touchEnter:240,exit:160,tab:160};
let input='keyboard',contact=null,toolIntent=null;
const active=new Set();
export const inputKind=()=>input;
export const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches||document.documentElement.matches('.manager-signal-reduce,.sage-signal-reduce');
if(typeof document!=='undefined'){
 document.addEventListener('pointerdown',e=>{input=e.pointerType||'mouse';},true);
 document.addEventListener('keydown',e=>{input='keyboard';if(!e.repeat&&(e.key===' '||e.key==='Enter'))pressDown(e);},true);
 document.addEventListener('keyup',pressUp,true);window.addEventListener('blur',pressUp);
 const finish=()=>{if(reduced()){for(const done of [...active])done();const apply=toolIntent;toolIntent=null;apply?.();}};
 matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',finish);
 new MutationObserver(finish).observe(document.documentElement,{attributes:true,attributeFilter:['class']});
}
export function setToolIntent(apply){toolIntent=apply;}
export function pressDown(e,buzz){
 if(e.isPrimary===false){pressUp();return;}
 if(e.button!=null&&e.button!==0)return;
 const el=e.target?.closest?.('button,[role="button"],a.btn');
 if(!el||el.disabled||el.getAttribute('aria-disabled')==='true'||el.closest('[inert],[data-nopress],[draggable="true"]'))return;
 pressUp();el.dataset.sagePressed='true';
 const tick=e.pointerType==='touch'&&buzz?setTimeout(()=>{if(contact?.el===el)buzz(6,true);},50):null;
 contact={el,tick,x:e.clientX,y:e.clientY};
}
export function pressMove(e){if(contact&&contact.x!=null&&(Math.abs(e.clientX-contact.x)>8||Math.abs(e.clientY-contact.y)>8))pressUp();}
export function pressUp(){if(!contact)return;clearTimeout(contact.tick);delete contact.el.dataset.sagePressed;contact=null;}
let locks=0,priorOverflow='';
function lockScroll(){if(!locks++) {priorOverflow=document.body.style.overflow;document.body.style.overflow='hidden';}let done=false;return()=>{if(!done){done=true;if(!--locks)document.body.style.overflow=priorOverflow;}};}
const inertOwners=new WeakMap();
export function inertOutside(node){const held=[];for(let current=node;current&&current!==document.body;current=current.parentElement){for(const sibling of current.parentElement?.children||[]){if(sibling===current||['STYLE','SCRIPT','LINK'].includes(sibling.tagName))continue;let state=inertOwners.get(sibling);if(!state){state={count:0,original:sibling.inert};inertOwners.set(sibling,state);}state.count++;sibling.inert=true;held.push(sibling);}}let released=false;return()=>{if(released)return;released=true;for(const el of held){const state=inertOwners.get(el);if(state&&!--state.count){el.inert=state.original;inertOwners.delete(el);}}};}
export function usePresence(open,ref){
 const [retained,setRetained]=useState(open),run=useRef(null),openNow=useRef(open);openNow.current=open;
 const present=open||retained;
 useLayoutEffect(()=>{if(!present)return;return lockScroll();},[present]);
 useLayoutEffect(()=>{
  const node=ref.current;if(!node)return;
  const previous=run.current,from=previous?getComputedStyle(node).transform:null;
  previous?.cancel();
  if(open)setRetained(true);
  let ended=false,timer,animation;
  const done=()=>{if(ended)return;ended=true;clearTimeout(timer);active.delete(done);animation?.cancel();run.current=null;if(!openNow.current)setRetained(false);};
  const cancel=()=>{if(ended)return;ended=true;clearTimeout(timer);active.delete(done);animation?.cancel();};
  run.current={cancel};
  if(reduced()){done();return;}
  const distance=input==='touch'?10:2,duration=open?(input==='touch'?motion.touchEnter:motion.pointerEnter):motion.exit;
  animation=node.animate([{transform:from||`translateY(${open?distance:0}px)`},{transform:`translateY(${open?0:distance}px)`}],{duration,easing:'cubic-bezier(.2,.8,.2,1)',fill:'forwards'});
  active.add(done);animation.finished.then(done,()=>{});timer=setTimeout(done,duration+100);
 },[open]);
 useLayoutEffect(()=>()=>run.current?.cancel(),[]);
 return present;
}
let pageAnimation=null;
export function navigatePage(apply){
 const node=document.querySelector('.sp-performance,.page'),from=pageAnimation&&node?getComputedStyle(node).transform:'none';
 pageAnimation?.cancel();pageAnimation=null;
 apply();if(!node||reduced())return;
 // One outer surface moves. Children, icons and text remain opaque and still.
 const start=from!=='none'?from:`translateY(${input==='touch'?8:0}px)`;
 const animation=pageAnimation=node.animate([{transform:start},{transform:'translateY(0)'}],{duration:motion.tab,easing:'ease-out'});
 const done=()=>{active.delete(done);animation.cancel();if(pageAnimation===animation)pageAnimation=null;};active.add(done);animation.finished.then(done,()=>active.delete(done));
}

// Preserve each person's hue while choosing the higher-contrast label ink.
export function readableInk(background){
 let rgb;
 if(/^#[\da-f]{6}$/i.test(background))rgb=[1,3,5].map(i=>parseInt(background.slice(i,i+2),16)/255);
 else {const m=/^hsl\(([\d.]+) ([\d.]+)% ([\d.]+)%\)$/.exec(background);if(!m)throw Error('Unsupported avatar color');const h=Number(m[1])/30,s=Number(m[2])/100,l=Number(m[3])/100,a=s*Math.min(l,1-l);rgb=[0,8,4].map(n=>{const k=(n+h)%12;return l-a*Math.max(-1,Math.min(k-3,9-k,1));});}
 const linear=c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4;
 const lum=rgb.map(linear).reduce((n,c,i)=>n+c*[.2126,.7152,.0722][i],0);
 const dark=[21,33,27].map(c=>linear(c/255)).reduce((n,c,i)=>n+c*[.2126,.7152,.0722][i],0);
 return (lum+.05)/(dark+.05)>=1.05/(lum+.05)?'#15211B':'#fff';
}
