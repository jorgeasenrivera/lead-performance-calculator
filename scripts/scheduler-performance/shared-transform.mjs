// Text uses the browser root size; non-text geometry stays in its original units.
export function relativeTypography(css){return css.replace(/((?:font-size|line-height|font)\s*:\s*)([^;{}]+)(?=[;}])/g,(_,property,value)=>property+value.replace(/(\d*\.?\d+)px\b/g,(_,n)=>`${Number(n)/16}rem`));}
function relativeTemplate(source,name){const marker=`const ${name} = \``,start=source.indexOf(marker),end=source.indexOf('\n`;',start);if(start<0||end<start)throw Error('Typography boundary changed: '+name);return source.slice(0,start+marker.length)+relativeTypography(source.slice(start+marker.length,end))+source.slice(end);}
// These transforms run only after build.mjs verifies the production source pins.
function once(source,from,to){if(source.split(from).length!==2)throw Error('Shared preview anchor changed: '+from.slice(0,80));return source.replace(from,to);}
export function sharedCore(source){
 source=relativeTemplate(source,"SAGE_CSS");
 const buzzStart=source.indexOf('function buzz(pattern, tick) {'),buzzEnd=source.indexOf('// bridge to the native app shell',buzzStart);
 if(buzzStart<0||buzzEnd<buzzStart)throw Error('Preview haptic ownership boundary changed');
 source=source.slice(0,buzzStart)+'function buzz() {}\n'+source.slice(buzzEnd);

 const start=source.indexOf("const PRESS_SEL ="),marker='  window.addEventListener("pointercancel", pressUp, { capture: true, passive: true });\n}',end=source.indexOf(marker,start)+marker.length;
 if(start<0||end<start)throw Error('Press owner boundary changed');
 source=source.slice(0,start)+`function pressDown(e){previewPressDown(e,buzz);}
function pressMove(e){previewPressMove(e);}
function pressUp(){previewPressUp();}
if(typeof window!=="undefined"){
 window.addEventListener("pointerdown",pressDown,{capture:true,passive:true});
 window.addEventListener("pointermove",pressMove,{capture:true,passive:true});
 window.addEventListener("pointerup",pressUp,{capture:true,passive:true});
 window.addEventListener("pointercancel",pressUp,{capture:true,passive:true});
}\n`+source.slice(end);
 source=once(source,'const switchTool = (mod) => {\n    if (mod === appModule) return;',`const switchTool = (mod) => {
    if (mod === appModule) {clearToolMove();previewToolIntent(null);return;}
    if(previewReduced()){clearToolMove();previewToolIntent(null);applyTool(mod);return;}
    previewToolIntent(()=>{clearToolMove();applyTool(mod);});`);
 source=once(source,'        applyTool(mod);','        previewToolIntent(null);applyTool(mod);');
 return 'import {pressDown as previewPressDown,pressMove as previewPressMove,pressUp as previewPressUp,reduced as previewReduced,setToolIntent as previewToolIntent} from "/scripts/scheduler-performance/shared-motion.mjs";\n'+source;
}
export function sharedManager(source){
 source=relativeTemplate(source,"MANAGER_CSS");
 // The isolated preview remembers recap presentation only for this page visit.
 source=once(source,'try { recapPresented(seenKey, signalRecapSeen, localStorage); } catch { recapPresented(seenKey, signalRecapSeen, null); }','recapPresented(seenKey, signalRecapSeen, null);');
 source=once(source,'try { localStorage.setItem(seenKey, "1"); } catch { /* private mode: it shows again, which is survivable */ }','signalRecapSeen.add(seenKey);');
 source=once(source,'function CoachingPanel({ config, store, data, onChange, userName }) {','function CoachingPanel({ config, store, data, onChange, userName, initialPerson }) {');
 source=once(source,'function CoachingPanel({ config, store, data, onChange, userName, initialPerson }) {\n  const phone = usePhoneLayout();',`function CoachingPanel({ config, store, data, onChange, userName, initialPerson }) {
  const [phone,setPhone]=useState(()=>matchMedia('(max-width:700px)').matches);
  useEffect(()=>{const mq=matchMedia('(max-width:700px)'),update=()=>setPhone(mq.matches);mq.addEventListener('change',update);return()=>mq.removeEventListener('change',update);},[]);`);
 source=once(source,'const [openId, setOpenId] = useState(null);\n  const M = data.months?.[ym()];','const [openId, setOpenId] = useState(initialPerson||null);\n  const M = data.months?.[ym()];');
 source=once(source,'if (t) return { background: frTagColor(t), color: frTagLight(t) ? "#15211B" : "#fff" };\n    return { background: `hsl(${hueFromName(p.a.name)} 52% 42%)` };','const background=t?frTagColor(t):`hsl(${hueFromName(p.a.name)} 52% 42%)`;return {background,color:previewInk(background)};');
 const phoneStart=source.indexOf('function CoachingPhone('),phoneEnd=source.indexOf('function CoachingPanel(',phoneStart);
 if(phoneStart<0||phoneEnd<phoneStart)throw Error('Coaching boundary changed');
 let phone=source.slice(phoneStart,phoneEnd);
 phone=once(phone,'scored, withData, top, topAvg })','scored, withData, top, topAvg, initialPerson })');
 phone=once(phone,'const [pop, setPop] = useState(null);','const [pop, setPop] = useState(initialPerson?{k:"person",id:initialPerson}:null);');
 phone=once(phone,'const avStyle = (name) => ({ background: `hsl(${hueFromName(name)} 52% 42%)` });','const avStyle = name => {const background=`hsl(${hueFromName(name)} 52% 42%)`;return {background,color:previewInk(background)};};');
 source=source.slice(0,phoneStart)+phone+source.slice(phoneEnd);
 source=once(source,'if (phone) return <CoachingPhone config=','if (phone) return <CoachingPhone initialPerson={initialPerson} config=');
 const popStart=source.indexOf('function FrPop({'),popEnd=source.indexOf('/**',popStart);
 if(popStart<0||popEnd<popStart)throw Error('Shared detail dialog boundary changed');
 source=source.slice(0,popStart)+`function FrPop({title,onClose,children,cls}){
  const sheetRef=useRef(null),[open,setOpen]=useState(true),closedChildren=useRef(null);
  const present=previewPresence(open,sheetRef);
  const close=()=>{closedChildren.current=children;setOpen(false);};
  useSelectorFocus(open,sheetRef,close);
  useLayoutEffect(()=>{if(children!==closedChildren.current)setOpen(true);},[children]);
  useEffect(()=>{if(!present&&children===closedChildren.current)onClose();},[present,children,onClose]);
  const name=children?.props?.row?.a?.name;
  return createPortal(<div className="fr-pop" data-presence={open?"open":"closing"} aria-hidden={!open} inert={open?undefined:""} onClick={e=>{if(e.target===e.currentTarget)close();}}>
   <div className={"fr-sheet"+(cls?" "+cls:"")} role="dialog" aria-modal="true" aria-label={name?"Coaching for "+name:title} ref={sheetRef}>
    <button type="button" className="fr-x x-close" onClick={close} aria-label="Close"><PixIcon glyph="close" size={15}/></button>{children}
   </div></div>,document.body);
 }

`+source.slice(popEnd);
 const start=source.indexOf('function tabMove(dir, apply) {'),end=source.indexOf('function SegControl(',start);
 if(start<0||end<start)throw Error('Tab owner boundary changed');
 source=source.slice(0,start)+`function tabMove(dir,apply){clearTabMove();previewNavigate(typeof apply==='function'?apply:()=>{});}\n\n`+source.slice(end);
 source=once(source,'<div className="seg" ref={wrapRef}>','<div className="seg" role="group" aria-label="View options" ref={wrapRef}>');
 source=once(source,'className={"seg-btn" + (shown === id ? " active" : "")','aria-pressed={shown === id} className={"seg-btn" + (shown === id ? " active" : "")');
 source=once(source,'className={"tool-btn " + (value === id ? "on" : "")}','aria-pressed={value === id} className={"tool-btn " + (value === id ? "on" : "")}');
 source=once(source,'type="button" aria-selected={value === id}','type="button" aria-pressed={value === id}');
 source=once(source,'className={"sect-chip" + (value === id ? " on" : "")}','aria-pressed={value === id} className={"sect-chip" + (value === id ? " on" : "")}');
 source=once(source,'behavior: "smooth" });\n  }, [value]);','behavior: previewReduced()?"instant":"smooth" });\n  }, [value]);');
 source=source.replaceAll('root.classList.contains("sage-signal-reduce")','(root.classList.contains("sage-signal-reduce")||root.classList.contains("manager-signal-reduce"))');
 source=once(source,'const node = ref.current;\n    const controls','const node = ref.current;\n    const releaseInert=previewInertOutside(node);\n    const controls');
 source=once(source,"document.removeEventListener('keydown', onKey, true);\n      //", "document.removeEventListener('keydown', onKey, true);\n      releaseInert();\n      //");
 source=once(source,'className={"coach-row " + (openId === r.a.id ? "on" : "")}', 'aria-pressed={openId === r.a.id} className={"coach-row " + (openId === r.a.id ? "on" : "")}');
 source=once(source,'const pickerRef = useRef(null);','const pickerRef = useRef(null);\n  const pickerPresent=previewPresence(picking,pickerRef);');
 source=once(source,'{picking && <div className="botnav-scrim"','{pickerPresent && <div className="botnav-scrim" data-presence={picking?"open":"closing"}');
 source=once(source,'{picking && !solo && <div id={pickerId} ref={pickerRef}', '{pickerPresent && !solo && <div id={pickerId} ref={pickerRef} data-presence={picking?"open":"closing"} aria-hidden={!picking} inert={picking?undefined:""}');
 source=once(source,'const drawerRef = useRef(null);','const drawerRef = useRef(null);\n  const drawerPresent=previewPresence(open,drawerRef);');
 const lockStart=source.indexOf('  // Lock body scroll while the drawer'),lockEnd=source.indexOf('  const tools =',lockStart);
 if(lockStart<0||lockEnd<lockStart)throw Error('Drawer scroll owner boundary changed');source=source.slice(0,lockStart)+source.slice(lockEnd);
 source=once(source,'className={"drawer-root no-print " + (open ? "open" : "")}','data-presence={open?"open":"closing"} className={"drawer-root no-print " + (drawerPresent ? "open" : "")}');
 // Unsupported connected tools stay disabled in this isolated, auth-free fixture.
 source=once(source,'<span className="dotnum"','<span role="img" className="dotnum"');
 source=once(source,'aria-pressed={value === id} className={"tool-btn "','disabled={id!=="perf"} aria-pressed={value === id} className={"tool-btn "');
 source=once(source,'type="button" aria-pressed={value === id}','type="button" disabled aria-pressed={value === id}');
 source=once(source,'{BAR_TOOLS.slice(0, 2).map(([id, label, glyph]) => <button type="button" key={id}','{BAR_TOOLS.slice(0, 2).map(([id, label, glyph]) => <button type="button" disabled={id!=="perf"} key={id}');
 source=once(source,'{QUEUE_TOOLS.map(q => <button type="button" key={q.id}','{QUEUE_TOOLS.map(q => <button type="button" disabled key={q.id}');
 source=once(source,'<button key={id} className={"drawer-item " + (appModule','<button disabled key={id} className={"drawer-item " + (appModule');
 source=once(source,'<button className="bm-item" onClick={() => { setOpen(false); setAcct(true); }}>','<button disabled className="bm-item" onClick={() => { setOpen(false); setAcct(true); }}>');
 source=once(source,'<button className="bm-item" onClick={() => { setOpen(false); onSignOut(); }}>','<button disabled className="bm-item" onClick={() => { setOpen(false); onSignOut(); }}>');
 // The account popup is a small nonmodal dialog with ordinary buttons.
 const brandStart=source.indexOf('function BrandMenu('),brandEnd=source.indexOf('/* ---------------- Repairing',brandStart);
 if(brandStart<0||brandEnd<brandStart)throw Error('Account popup boundary changed');
 let brand=source.slice(brandStart,brandEnd);
 brand=once(brand,'aria-haspopup="menu"','aria-haspopup="dialog"');
 brand=once(brand,'className="brand-menu" role="menu"','className="brand-menu" role="dialog" aria-label="Account menu"');
 brand=once(brand,'    const away = (e) =>',`    const trigger=ref.current?.querySelector('.brand-btn');
    ref.current?.querySelector('.brand-menu button:not(:disabled)')?.focus({preventScroll:true});
    const away = (e) =>`);
 brand=once(brand,'    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };',`    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc);
      if(document.activeElement===document.body||ref.current?.contains(document.activeElement))trigger?.focus({preventScroll:true});
    };`);
 source=source.slice(0,brandStart)+brand+source.slice(brandEnd);
 // Family identifiers style primitives without enabling disconnected destinations.
 source=once(source,'disabled={id!=="perf"} aria-pressed={value === id} className={"tool-btn "','data-sage-family={id} disabled={id!=="perf"} aria-pressed={value === id} className={"tool-btn "');
 source=once(source,'type="button" disabled aria-pressed={value === id}','type="button" data-sage-family={id} disabled aria-pressed={value === id}');
 source=once(source,'<button type="button" disabled={id!=="perf"} key={id}','<button type="button" data-sage-family={id} disabled={id!=="perf"} key={id}');
 source=once(source,'<button type="button" className={"botnav-btn" + (queueOn','<button type="button" data-sage-family={queueOn?appModule:"floor"} className={"botnav-btn" + (queueOn');
 source=once(source,'<button type="button" className="botnav-btn" aria-haspopup="dialog"','<button type="button" data-sage-family="more" className="botnav-btn" aria-haspopup="dialog"');
 source=once(source,'<button type="button" disabled key={q.id}','<button type="button" data-sage-family={q.id} disabled key={q.id}');
 source=once(source,'<div className="sect-strip no-print" ref={ref}>','<div className="sect-strip no-print" role="group" aria-label="Performance sections" ref={ref}>');
 source=once(source,'<button key={id} className={"drawer-item " + (value === id','<button aria-current={value === id?"page":undefined} key={id} className={"drawer-item " + (value === id');
 // The global press owner already owns the touch tick, including cancellation.
 const shell=source.indexOf('function AppShell('),haptic=source.indexOf('  /* On the manager\'s phone every control ticks',shell),hapticEnd=source.indexOf('\n  return (\n    <Shell',haptic)+1;
 if(haptic<0||hapticEnd<haptic)throw Error('Shell press boundary changed');source=source.slice(0,haptic)+source.slice(hapticEnd);
 return 'import {readableInk as previewInk,usePresence as previewPresence,inertOutside as previewInertOutside,navigatePage as previewNavigate,reduced as previewReduced} from "/scripts/scheduler-performance/shared-motion.mjs";\n'+source;
}
