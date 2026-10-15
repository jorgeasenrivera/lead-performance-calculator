import React, { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  AppShell,
  BoardRoomPhone,
  StoreHero,
  Board,
} from "../../src/Manager.jsx";
import {
  DEFAULT_TIERS,
  usePhoneLayout,
} from "../../src/LeadPerformanceCalculator.jsx";
import seed from "./fixture.json";
import "./entry.css";
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
  const phone = usePhoneLayout(),
    dialog = useRef(),
    frame = useRef(),
    opener = useRef(),
    scroll = useRef(0);
  const props = {
    config,
    store: seed.store,
    data: seed.data,
    session: { role: "manager", name: "Preview Manager" },
    canSetGoal: false,
    onSaveConfig: noop,
    onSetRestriction: noop,
    onCoach: noop,
    onGoTab: noop,
    onFilter: noop,
    onMove: noop,
    onChange: noop,
    readOnly: true,
  };
  const close = () => {
    if (!dialog.current.open) return;
    const sheet = frame.current?.contentDocument?.querySelector(
      "#sheet:not([hidden])",
    );
    sheet?.querySelector("[data-close]")?.click();
    dialog.current.close();
    document.body.style.overflow = "";
    window.scrollTo({ top: scroll.current, behavior: "instant" });
    opener.current?.focus({ preventScroll: true });
  };
  useEffect(() => {
    const open = (e) => {
      opener.current = e.detail.opener;
      scroll.current = window.scrollY;
      dialog.current.showModal();
      document.body.style.overflow = "hidden";
      dialog.current.querySelector("button").focus();
    };
    // Native modal traversal can leave the document at the iframe boundary.
    // Close that loop explicitly in both directions, using currently visible controls.
    const trapTab = (e) => {
      if (e.key !== "Tab" || !dialog.current.open) return;
      const selector =
        'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex="0"]';
      const visible = (e) =>
        e.getClientRects().length > 0 && !e.closest("[hidden]");
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
    let childDocument;
    const attach = () => {
      childDocument?.removeEventListener("keydown", trapTab);
      childDocument = frame.current.contentDocument;
      childDocument?.addEventListener("keydown", trapTab);
    };
    attach();
    frame.current.addEventListener("load", attach);
    document.addEventListener("keydown", trapTab);
    window.addEventListener("scheduler-open", open);
    window.addEventListener("scheduler-close", close);
    return () => {
      childDocument?.removeEventListener("keydown", trapTab);
      frame.current?.removeEventListener("load", attach);
      document.removeEventListener("keydown", trapTab);
      window.removeEventListener("scheduler-open", open);
      window.removeEventListener("scheduler-close", close);
      document.body.style.overflow = "";
    };
  }, []);
  return (
    <>
      <AppShell
        session={props.session}
        appModule="performance"
        onSignOut={noop}
        onReplayIntro={noop}
        onHelp={noop}
        onToolChange={noop}
        onImport={noop}
        navItems={[]}
        navValue="dashboard"
        navOnChange={noop}
        storeData={seed.data}
        storeName={seed.store.name}
        brand={seed.store.brand}
      >
        <div className="sp-preview-note">
          Fictional preview{" "}
          <span>Performance → Schedule · Nothing is published</span>
        </div>
        <main className="page sp-performance" aria-label="Performance preview">
          {phone ? (
            <BoardRoomPhone {...props} />
          ) : (
            <>
              <StoreHero {...props} />
              <Board {...props} />
            </>
          )}
        </main>
      </AppShell>
      <dialog
        ref={dialog}
        className="sp-dialog"
        aria-labelledby="sp-title"
        onCancel={(e) => {
          e.preventDefault();
          const win = frame.current.contentWindow;
          const sheet = win.document.querySelector("#sheet");
          if (sheet && !sheet.hidden) {
            sheet.querySelector("[data-close]").click();
          } else close();
        }}
      >
        <header className="sp-dialog-bar">
          <button
            type="button"
            onClick={close}
            aria-label="Return to Performance"
          >
            ← Performance
          </button>
          <span id="sp-title">
            Schedule <small>Fictional planning preview</small>
          </span>
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
