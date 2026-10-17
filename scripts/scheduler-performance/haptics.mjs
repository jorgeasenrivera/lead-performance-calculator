// Preview-only semantics reuse the salesperson names and browser patterns.
export const PATTERNS=Object.freeze({tick:6,taken:[10,40,10],asked:[24,60,24,60,24],refused:[60,40,60]});
export function createHaptics({win,storage,now=()=>Date.now()}={}){
 let preference='full',epoch=0;const issued=new WeakSet();
 if(storage===undefined)try{storage=win?.localStorage;}catch{}
 try{const saved=storage?.getItem('lpcf:pref:buzz');if(saved==='0'||saved==='quiet')preference=saved;}catch{}
 const cancel=()=>{epoch++;};
 return {
  get preference(){return preference;},
  setPreference(value){if(!['0','quiet','full'].includes(value))return false;cancel();preference=value;return true;},
  cancel,
  begin(touch,valid=()=>true){cancel();if(!touch)return null;const token={epoch,at:now(),used:false,valid};issued.add(token);return token;},
  emit(name,token){
   if(!Object.hasOwn(PATTERNS,name)||!token||!issued.has(token)||token.used||token.epoch!==epoch||now()-token.at>30000)return false;
   try{if(!token.valid())return false;}catch{return false;}
   token.used=true;
   if(preference==='0'||preference==='quiet'&&name!=='tick')return false;
   try{
    const native=win?.ReactNativeWebView;
    // A failed native send is not retried through another transport.
    if(typeof native?.postMessage==='function'){native.postMessage(JSON.stringify({type:'buzz',payload:{name,pattern:PATTERNS[name]}}));return true;}
    if(typeof win?.navigator?.vibrate==='function')return win.navigator.vibrate(PATTERNS[name])!==false;
   }catch{}
   return false;
  }
 };
}
const EVENT='sage-preview-haptic';
export function captureHapticAction(doc=globalThis.document){const detail={op:'capture',token:null};doc?.dispatchEvent(new doc.defaultView.CustomEvent(EVENT,{detail}));return detail.token;}
export function feedback(name,token=captureHapticAction(),doc=globalThis.document){const detail={op:'emit',name,token,delivered:false};doc?.dispatchEvent(new doc.defaultView.CustomEvent(EVENT,{detail}));return detail.delivered;}
export function cancelHaptics(doc=globalThis.document){doc?.dispatchEvent(new doc.defaultView.CustomEvent(EVENT,{detail:{op:'cancel'}}));}
const control='button,select,input,summary,[role=button]';
const choices='.botnav-btn,.seg-btn,.sect-chip,.tool-btn,.drawer-item,[data-day],#previous,#next,#today,#day-previous,#day-next,#workspace';
const snapshot=doc=>{
 const app=doc.querySelector('#app');if(app)return JSON.stringify([app.dataset.hapticMonth,app.dataset.hapticDate,app.dataset.hapticView]);
 return [...doc.querySelectorAll('.seg-btn[aria-pressed=true],.sect-chip[aria-pressed=true],.tool-btn[aria-pressed=true],.botnav-btn[aria-current=page]')].map(e=>e.textContent).sort().join('|');
};
export function ownHaptics(doc,dispatcher,valid=()=>true){
 let action=null,contact=null,disposed=false;const listeners=[];
 const allowed=()=>!disposed&&!doc.hidden&&valid();
 const cancel=()=>{dispatcher.cancel();action=null;contact=null;};
 const on=(target,type,fn,options=true)=>{target.addEventListener(type,fn,options);listeners.push(()=>target.removeEventListener(type,fn,options));};
 const usable=el=>el&&!el.disabled&&el.getAttribute('aria-disabled')!=='true'&&!el.closest('[inert],[hidden],[data-nopress],[draggable=true]');
 on(doc,'pointerdown',e=>{
  cancel();const el=e.target.closest?.(control);if(e.isPrimary===false||e.button!==0||!usable(el))return;
  action=dispatcher.begin(e.pointerType==='touch',allowed);contact={el,x:e.clientX,y:e.clientY,before:snapshot(doc),value:el.type==='checkbox'||el.type==='radio'?el.checked:el.value,gesture:false};
 });
 on(doc,'touchstart',e=>{
  if(e.touches.length!==1){cancel();return;}
  const el=e.target.closest?.('.month-days,#sheet');
  if(!el||e.target.closest('button,input,select,textarea,summary,a'))return;
  cancel();action=dispatcher.begin(true,allowed);contact={el,x:e.touches[0].clientX,y:e.touches[0].clientY,gesture:true};
 });
 on(doc,'pointermove',e=>{if(!contact||contact.gesture)return;const b=contact.el.getBoundingClientRect();if(Math.abs(e.clientX-contact.x)>8||Math.abs(e.clientY-contact.y)>8||e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)cancel();});
 on(doc,'pointerup',e=>{if(!contact||contact.gesture)return;const b=contact.el.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)cancel();});
 on(doc,'touchmove',e=>{if(!contact?.gesture)return;if(e.touches.length!==1||Math.abs(e.touches[0].clientY-contact.y)>12&&Math.abs(e.touches[0].clientY-contact.y)>Math.abs(e.touches[0].clientX-contact.x))cancel();});
 for(const type of ['pointercancel','touchcancel','keydown'])on(doc,type,cancel);
 on(doc,'scroll',()=>{if(!contact?.gesture)cancel();},true);
 on(doc,'visibilitychange',()=>{if(doc.hidden)cancel();});
 on(doc.defaultView,'pagehide',cancel);on(doc.defaultView,'scheduler-hide',cancel);on(doc.defaultView,'scheduler-view',cancel);
 on(doc,'click',e=>{
  const el=e.target.closest?.(control),token=action,previous=contact;
  if(!usable(el)||el!==previous?.el||!el.matches(choices))return;
  // React commits discrete selections after the capture listener returns.
  setTimeout(()=>{if(previous.before!==snapshot(doc))dispatcher.emit('tick',token);},0);
 });
 on(doc,'change',e=>{const el=e.target,token=action,previous=contact;if(!usable(el)||el!==previous?.el||!el.matches('select,input[type=checkbox],input[type=radio],input[type=date],input[type=month]'))return;const value=el.type==='checkbox'||el.type==='radio'?el.checked:el.value;if(value!==previous.value)queueMicrotask(()=>dispatcher.emit('tick',token));});
 on(doc,'invalid',()=>dispatcher.emit('refused',action));
 on(doc,EVENT,e=>{const d=e.detail;if(!d||!allowed())return;if(d.op==='capture')d.token=action;else if(d.op==='cancel')cancel();else if(d.op==='emit')d.delivered=dispatcher.emit(d.name,d.token);});
 return {cancel,dispose(){cancel();disposed=true;listeners.forEach(off=>off());}};
}
export function validPlannerFrame(frame,doc,hostWindow){
 try{const url=new URL(frame.src,hostWindow.location.href);return frame.isConnected&&url.origin===hostWindow.location.origin&&['/planner/','/planner/index.html'].includes(url.pathname)&&frame.contentDocument===doc&&frame.contentWindow===doc.defaultView&&frame.closest('dialog')?.open;}catch{return false;}
}
export function standaloneHaptics(win=globalThis.window){if(win.parent!==win)return null;return ownHaptics(win.document,createHaptics({win}));}
