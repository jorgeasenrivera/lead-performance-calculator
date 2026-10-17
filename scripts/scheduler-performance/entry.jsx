import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AppShell,
  CoachingPanel,
  SegControl,
  BoardRoomPhone,
  StoreHero,
  Board,
} from "../../src/Manager.jsx";
import {
  DEFAULT_TIERS,
  PixIcon,
  usePhoneLayout,
} from "../../src/LeadPerformanceCalculator.jsx";
import seed from "./fixture.json";
import "./entry.css";
import "./shared-system.css";
import {navigatePage} from "./shared-motion.mjs";
import {createHaptics,ownHaptics,validPlannerFrame} from "./haptics.mjs";
const noop = () => {};
const config = {
  stores: [seed.store],
  roles: [
    { id: "sales", name: "Sales Associate", onBoard: true, coaching: true },
    { id: "service", name: "Service to Sales", onBoard: true },
    { id: "manager", name: "Manager", onBoard: false },
    { id: "bdc", name: "BDC", onBoard: false },
  ],
  standards: {
    [seed.store.id]: {
      sales: { tiers: DEFAULT_TIERS },
      service: { tiers: DEFAULT_TIERS },
    },
  },
  holidays: [],
};
function Preview() {
  const [haptics]=useState(()=>createHaptics({win:window}));
  const [touchFeedback,setTouchFeedback]=useState(haptics.preference);
  useEffect(()=>{const owner=ownHaptics(document,haptics);return()=>owner.dispose();},[haptics]);
  useEffect(()=>{const bar=document.querySelector('.botnav');if(!bar)return;const root=document.documentElement,measure=()=>root.style.setProperty('--sage-bottomnav-height',bar.getBoundingClientRect().height+'px');measure();const observer=new ResizeObserver(measure);observer.observe(bar);return()=>{observer.disconnect();root.style.removeProperty('--sage-bottomnav-height');};},[]);
  const [coachId,setCoachId]=useState(null);
  const [returnLabel,setReturnLabel]=useState(null),returnRoute=useRef(null),routeEpoch=useRef(0);
  const [section,setSection]=useState("dashboard"),[data,setData]=useState(seed.data);
  const selectSection=value=>navigatePage(()=>setSection(value));
  useEffect(()=>{const warn=e=>{if(data!==seed.data){e.preventDefault();e.returnValue="";}};window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);},[data]);
  const phone = usePhoneLayout(),
    dialog = useRef(),
    frame = useRef(),
    opener = useRef(),
    scroll = useRef(0),
    input = useRef("keyboard");
  const props = {
    config,
    store: seed.store,
    data,
    session: { role: "manager", name: "Jordan Lee" },
    canSetGoal: false,
    onSaveConfig: noop,
    onSetRestriction: noop,
    onCoach: person=>{setCoachId(person.id);selectSection("coaching");},
    onGoTab: noop,
    onFilter: noop,
    onMove: noop,
    onChange: setData,
    readOnly: true,
  };
  const historyReturn=useRef(true),historyBackPending=useRef(false),lastPlannerEntry=useRef(null);
  const close = (restoreDetails = true, fromHistory = false) => {
    haptics.cancel();
    if (!dialog.current.open) return;
    if(!fromHistory && history.state?.sageSchedulerPreview){if(historyBackPending.current)return;historyBackPending.current=true;historyReturn.current=restoreDetails!==false;history.back();return;}
    frame.current?.contentWindow?.dispatchEvent(new CustomEvent("scheduler-hide"));
    const sheet = frame.current?.contentDocument?.querySelector(
      "#sheet:not([hidden])",
    );
    if (sheet) sheet.hidden = true;
    const route=returnRoute.current;returnRoute.current=null;setReturnLabel(null);
    const epoch=++routeEpoch.current;
    dialog.current.close();
    document.body.style.overflow = "";
    window.scrollTo({ top: scroll.current, behavior: "instant" });
    const target = opener.current?.isConnected && opener.current.getClientRects().length ? opener.current : document.querySelector(".sp-calendar-toggle") || document.querySelector(".sp-calendar-entry");
    target?.focus({ preventScroll: true });
    if(restoreDetails && route)requestAnimationFrame(()=>{if(routeEpoch.current===epoch&&!dialog.current.open)route();});
  };
  useEffect(() => {
    const rememberPointer=e=>{input.current=e.pointerType||"mouse";};
    const rememberKeyboard=()=>{input.current="keyboard";};
    document.addEventListener("pointerdown",rememberPointer,true);
    document.addEventListener("keydown",rememberKeyboard,true);
    const open = (e) => {
      haptics.cancel();
      if(dialog.current.open)return;
      lastPlannerEntry.current=e.detail;
      if(!history.state?.sageSchedulerPreview)history.pushState({...history.state,sageSchedulerPreview:true},"",location.href);
      routeEpoch.current++;returnRoute.current=e.detail.resumeDetails||null;setReturnLabel(e.detail.returnLabel||null);
      opener.current = e.detail.opener;
      scroll.current = window.scrollY;
      dialog.current.showModal();
      frame.current.contentWindow?.dispatchEvent(new CustomEvent("scheduler-view", {detail:{day:e.detail.day,store:e.detail.store,input:e.detail.input==="keyboard"?"keyboard":input.current}}));
      document.body.style.overflow = "hidden";
      (e.detail.day ? frame.current.contentDocument?.querySelector(".day-heading") : dialog.current.querySelector("button"))?.focus();
    };
    const historyChanged=()=>{
      historyBackPending.current=false;
      if(history.state?.sageSchedulerPreview){if(!dialog.current.open&&lastPlannerEntry.current)open({detail:{...lastPlannerEntry.current,day:undefined}});}
      else {const restore=historyReturn.current;historyReturn.current=true;close(restore,true);}
    };
    window.addEventListener('popstate',historyChanged);
    // Native modal traversal can leave the document at the iframe boundary.
    // Close that loop explicitly in both directions, using currently visible controls.
    const trapTab = (e) => {
      if (e.defaultPrevented || e.key !== "Tab" || !dialog.current.open) return;
      const selector =
        'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex="0"]';
      const visible = (e) =>
        e.getClientRects().length > 0 && !e.closest("[hidden],[inert]");
      const outer = [...dialog.current.querySelectorAll(selector)].filter(
        visible,
      );
      const inner = [
        ...(frame.current.contentDocument?.querySelectorAll(selector) || []),
      ].filter(visible);
      const first = outer[0],
        last = inner.at(-1) || outer.at(-1);
      const active = e.target.ownerDocument.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    let childDocument,childHaptics;
    const attach = () => {
      childHaptics?.dispose();
      childDocument?.removeEventListener("keydown", trapTab);
      childDocument = frame.current.contentDocument;
      if(childDocument)childHaptics=ownHaptics(childDocument,haptics,()=>validPlannerFrame(frame.current,childDocument,window));
      childDocument?.addEventListener("keydown", trapTab);
    };
    attach();
    frame.current.addEventListener("load", attach);
    document.addEventListener("keydown", trapTab);
    window.addEventListener("scheduler-open", open);
    window.addEventListener("scheduler-close", close);
    return () => {
      document.removeEventListener("pointerdown",rememberPointer,true);
      document.removeEventListener("keydown",rememberKeyboard,true);
      childHaptics?.dispose();
      childDocument?.removeEventListener("keydown", trapTab);
      frame.current?.removeEventListener("load", attach);
      document.removeEventListener("keydown", trapTab);
      window.removeEventListener("popstate",historyChanged);
      window.removeEventListener("scheduler-open", open);
      window.removeEventListener("scheduler-close", close);
      document.body.style.overflow = "";
    };
  }, []);
  return (
    <>
      <AppShell
        session={props.session}
        appModule="perf"
        onSignOut={noop}
        onReplayIntro={undefined}
        onHelp={()=>{const about=document.querySelector(".sp-about");about.open=true;requestAnimationFrame(()=>about.querySelector("summary").focus());about.scrollIntoView({block:"nearest"});}}
        onToolChange={noop}
        onImport={undefined}
        navItems={[["dashboard","Dashboard"],["coaching","Coaching"]]}
        navValue={section}
        navOnChange={setSection}
        storeData={data}
        storeName={seed.store.name}
        brand={seed.store.brand}
      >
        <main className="page sp-performance" aria-label={section==="coaching"?"Coaching":"Performance"}>
          {!phone&&<SegControl items={[["dashboard","Dashboard"],["coaching","Coaching"]]} value={section} onChange={setSection}/>}
          {section==="coaching"?<CoachingPanel initialPerson={coachId} config={config} store={seed.store} data={data} onChange={setData} userName="Jordan Lee"/>:phone ? (
            <BoardRoomPhone {...props} />
          ) : (
            <>
              <StoreHero {...props} />
              <Board {...props} />
            </>
          )}
        </main>
        <details className="sp-about"><summary><PixIcon glyph="question" size={16}/>About this preview</summary><p>Performance, Coaching and Schedule use sample records. Changes stay in this page and are lost on refresh. No live data is connected and no schedule is published. Other tools and account actions are unavailable here.</p><label className="sp-touch-preference">Touch feedback <select aria-describedby="touch-feedback-help" value={touchFeedback} onChange={e=>{haptics.setPreference(e.target.value);setTouchFeedback(e.target.value);}}><option value="full">All feedback</option><option value="quiet">Quiet: selections only</option><option value="0">Off</option></select></label><p id="touch-feedback-help">For this page only. Your saved phone preference is used initially. Touch feedback depends on your device; visible feedback is always shown.</p></details>
      </AppShell>
      <dialog
        ref={dialog}
        className="sp-dialog"
        aria-labelledby="sp-title"
        onCancel={(e) => {
          e.preventDefault();
          const win = frame.current.contentWindow;
          const sheet = win.document.querySelector("#sheet");
          if (sheet && win.document.querySelector("#mobile-day-dialog:not([hidden])") && !sheet.hidden && sheet.getClientRects().length) {
            sheet.querySelector("[data-close]").click();
          } else close();
        }}
      >
        <header className="sp-dialog-bar">
          <button
            type="button"
            onClick={()=>close()}
            data-context-back={returnLabel ? "true" : undefined}
            aria-label={returnLabel ? "Back to "+returnLabel : "Back to dashboard"}
          >
            <PixIcon glyph="arrowleft" size={16} /> <span>{returnLabel ? "Back to "+returnLabel : "Back to dashboard"}</span>
          </button>
          <h1 id="sp-title">Schedule</h1>
          {returnLabel && <button type="button" onClick={()=>close(false)} aria-label="Close Schedule and return to Performance"><PixIcon glyph="close" size={16}/></button>}
        </header>
        <iframe
          ref={frame}
          src="/planner/index.html"
          title="Monthly schedule planner"
        />
      </dialog>
    </>
  );
}
createRoot(document.getElementById("root")).render(<Preview />);
