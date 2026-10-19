/**
 * The scheduler calendar, as a screen.
 * -------------------------------------------------------------------------
 * A month of actual daily deliveries, and for any date who is listed off. It
 * draws what src/scheduler-calendar-model.mjs hands it and nothing else: it does
 * not fetch, does not write, does not read the store, and nothing imports it yet.
 * The caller binds the app's own roster, days off and delivery snapshot to props.
 *
 * Month and store are the caller's. This surface never picks a month for itself,
 * so the delivery snapshot and the grid cannot disagree about which one is shown.
 */
import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import css from "./scheduler-calendar.css?inline";
import {
  STORE_TIME_ZONE, calendarCells, cellClass, cellLabel, dayDetail, deliveriesMonth, monthText,
  scheduleReview, staffingMonth, storeToday, summaryText, validMonth,
} from "./scheduler-calendar-model.mjs";
import { useReportedMonth } from "./use-reported-month.mjs";
import { currentReportedAuth, loadedUnder } from "./scheduler-load-context.mjs";

// The approved month editor, fetched only when somebody asks to plan the month.
const SchedulerEditor = lazy(() => import("./scheduler-editor.jsx"));
// With no backend there is no sign-in to follow: the entry reads as it did, with nothing delivered.
const NO_AUTH = Object.freeze({
  subscribe: () => () => {},
  getSnapshot: () => NO_AUTH_SNAPSHOT,
  getAccessToken: () => Promise.resolve(null),
});
const NO_AUTH_SNAPSHOT = Object.freeze({ principalEpoch: null, disposed: true });
const DISCARD = "Close the editor and discard this page’s unsaved changes?";

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];
const SOURCE_WORDS = { manager: "Marked off by a manager", schedule: "From the schedule", "on file": "On file" };

const when = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : new Intl.DateTimeFormat("en-US", {
    timeZone: STORE_TIME_ZONE, month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(d);
};
const BASIS = { report_sent: "report sent", report_received: "report received" };

export default function SchedulerCalendar({
  storeId, month, today, reported, principalEpoch, roster, departed, daysOff, forcedOff, presentAnyway, scheduleSource, isOff,
  staffingReady = true, layout = "panel", defaultExpanded = false, selectedDate, onSelectDate, onRetry, onExpandedChange,
}) {
  const todayDate = today || storeToday();
  const monthOk = validMonth(month);
  const deliveries = useMemo(
    () => deliveriesMonth(reported, { storeId, month, today: todayDate, principalEpoch }),
    [reported, storeId, month, todayDate, principalEpoch],
  );
  const staffing = useMemo(
    () => staffingMonth({ month, roster, departed, daysOff, forcedOff, presentAnyway, scheduleSource, isOff, ready: staffingReady }),
    [month, roster, departed, daysOff, forcedOff, presentAnyway, scheduleSource, isOff, staffingReady],
  );
  const review = useMemo(() => (staffingReady ? scheduleReview(scheduleSource, month) : { present: false }), [scheduleSource, month, staffingReady]);
  const cells = useMemo(() => (monthOk ? calendarCells(month) : []), [month, monthOk]);

  const [own, setOwn] = useState(null);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const controlled = selectedDate !== undefined;
  const picked = controlled ? selectedDate : own;
  // A date from another month is not selected here, so changing month never leaves a stale sheet.
  const detail = picked && deliveries.days.some((d) => d.date === picked) ? dayDetail(picked, deliveries, staffing) : null;
  const choose = (date) => {
    const next = picked === date ? null : date;
    if (!controlled) setOwn(next);
    if (onSelectDate) onSelectDate(next);
  };
  const byDate = new Map(deliveries.days.map((d) => [d.date, d]));
  const panelId = useId();
  const compact = layout === "compact";
  const title = monthOk ? monthText(month) : "This month";
  const summary = summaryText(deliveries);

  const grid = (
    <div className="sc-panel" id={panelId} hidden={compact && !expanded}>
      <div className="sc-weekdays" aria-hidden="true">{WEEKDAYS.map((w, i) => <span key={i}>{w}</span>)}</div>
      <div className="sc-grid" role="group" aria-label={`${title}, one button for each date`}>
        {cells.map((date, i) => {
          if (!date) return <span key={"b" + i} className="sc-blank" aria-hidden="true" />;
          const row = byDate.get(date);
          return (
            <button key={date} type="button" className={"sc-day " + cellClass(row, todayDate)}
              data-date={date} aria-label={cellLabel(row)} aria-pressed={picked === date}
              aria-current={date === todayDate ? "date" : undefined} onClick={() => choose(date)}>
              {Number(date.slice(8))}
            </button>
          );
        })}
      </div>
      <p className="sc-key">Brighter green means more delivered. A dashed date has no recorded count.</p>
      {review.present && (
        <p className="sc-schedule">
          {`Schedule from ${review.file || "a file"}${review.at && when(review.at) ? ", applied " + when(review.at) : ""}: ${review.offDays} ${review.offDays === 1 ? "day" : "days"} off for ${review.people} ${review.people === 1 ? "person" : "people"}.`}
          {review.needsReview ? ` ${review.unmatched} ${review.unmatched === 1 ? "name" : "names"} did not match anyone on the roster. Review before relying on it.` : ""}
        </p>
      )}
      {detail && <DaySheet detail={detail} />}
    </div>
  );

  return (
    <section className="sc-calendar" data-layout={layout} aria-label={`Deliveries calendar, ${title}`}>
      <style>{css}</style>
      {compact ? (
        <button type="button" className="sc-toggle" aria-expanded={expanded} aria-controls={panelId}
          aria-label={`${title}, calendar. ${summary}`} onClick={() => { const next = !expanded; setExpanded(next); if (onExpandedChange) onExpandedChange(next); }}>
          <span className="sc-toggle-month">{title}</span>
          <span className="sc-note">Delivered this month</span>
        </button>
      ) : (
        <div className="sc-head">
          <h2>{title}</h2>
          <p className="sc-note">Delivered this month</p>
        </div>
      )}
      <p className="sc-summary" role="status">{summary}</p>
      {deliveries.reason === "unavailable" && onRetry ? <button type="button" className="sc-retry" onClick={onRetry}>Try again</button> : null}
      {grid}
    </section>
  );
}

function DaySheet({ detail }) {
  const { asOf, split } = detail;
  const stamp = asOf && when(asOf.timestamp);
  return (
    <div className="sc-sheet" role="region" aria-label={`${detail.title}, day details`}>
      <h3>{detail.title}</h3>
      <p className="sc-delivered">
        <span className="sc-delivered-label">Delivered</span>
        <strong className="sc-delivered-value">{detail.deliveredValue}</strong>
      </p>
      {split && <p className="sc-fine">{`New ${split.new} · Used ${split.used}`}</p>}
      {stamp && <p className="sc-fine">{`As of ${stamp}, ${BASIS[asOf.basis] || "report"}. Not final.`}</p>}

      {!detail.staffingReady ? <p className="sc-fine">{"This store's schedule is not loaded yet."}</p> : <>
      <h4>Off</h4>
      {detail.off.length ? (
        <ul>
          {detail.off.map((p) => (
            <li key={p.id}>
              {p.name}
              <span className="sc-source">{` · ${SOURCE_WORDS[p.source]}${p.file ? ", " + p.file : ""}`}</span>
            </li>
          ))}
        </ul>
      ) : <p className="sc-fine">{detail.scheduleKnown ? "No one is listed off." : "No schedule is on file for this month."}</p>}

      {detail.overridden.length > 0 && (
        <p className="sc-fine">{`Listed off but worked: ${detail.overridden.map((p) => p.name).join(", ")}.`}</p>
      )}
      {detail.present.length > 0 && (
        <p className="sc-fine">{`Marked present by a manager: ${detail.present.map((p) => p.name).join(", ")}.`}</p>
      )}
      {detail.notListedOff.length > 0 && (
        <details>
          <summary>{`Not listed off (${detail.notListedOff.length})`}</summary>
          <p className="sc-fine">Not being listed off does not say a person is working. Shift lengths are not known.</p>
          <ul>{detail.notListedOff.map((p) => <li key={p.id}>{p.name}</li>)}</ul>
        </details>
      )}
      </>}
    </div>
  );
}

/**
 * The entry the dashboard places: one button on a wide screen, the calendar's own
 * toggle on a phone, and the open and closed state for either. It binds the
 * store's own records to the calendar and nothing more.
 *
 * Whose records these are is checked here, on every render, before anything is
 * drawn: the loaded document must name the selected store (`data.__storeId`). While
 * the app has selected store B and still holds store A's data, no person, day off
 * or schedule file from A reaches the screen. The inner body is keyed by store, so
 * an open sheet or a chosen date never carries over either.
 *
 * `reported` is the reader's snapshot and `principalEpoch` the session epoch the
 * caller holds now; without both the deliveries read "not loaded" and the days off
 * still show. `isOff` is the app's own (data, id, date) rule.
 */
export function SchedulerCalendarEntry(props) {
  return <EntryBody key={props.store?.id ?? "none"} {...props} />;
}

function EntryBody({ store, data, isOff, layout = "panel", reported = null, principalEpoch }) {
  const [open, setOpen] = useState(false);
  const [compactOpen, setCompactOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(null);
  const [planning, setPlanning] = useState(false);
  const opener = useRef(null);
  const planner = useRef(null);
  const guard = useRef(null);
  const panelId = useId();
  const todayDate = storeToday();
  const month = todayDate.slice(0, 7);
  const auth = currentReportedAuth() || NO_AUTH;
  // The sign-in, read in the same render as everything drawn from it.
  const identity = useSyncExternalStore(auth.subscribe, auth.getSnapshot, auth.getSnapshot);
  const marked = typeof store?.id === "string" && store.id !== "" && data != null && data.__storeId === store.id;
  // Records count only if they were loaded for this store under the sign-in that is current now. Where there
  // is no sign-in to follow (no backend) the store mark alone decides, as it always did.
  const stamp = loadedUnder(data);
  const followed = auth !== NO_AUTH;
  const fresh = marked && stamp !== null && stamp.storeId === store.id && stamp.epoch === identity.principalEpoch && identity.disposed !== true;
  const bound = followed ? fresh : marked;
  const rule = useMemo(() => (bound && typeof isOff === "function" ? (id, date) => isOff(data, id, date) : null), [bound, data, isOff]);
  // The reader is told what is loaded for this store; for any other state it answers idle or loading, so what is
  // drawn can only be the answer for this store, this month and this sign-in, never an earlier one relabelled.
  const active = layout === "compact" ? compactOpen : open;
  const view = useReportedMonth({ auth, storeId: store?.id ?? null, loadedStoreId: followed && fresh ? data.__storeId : null, month, active });
  const snapshot = useMemo(() => reported || { status: view.status, days: view.days, storeId: store?.id ?? null, month, principalEpoch: identity.principalEpoch },
    [reported, view.status, view.days, store, month, identity.principalEpoch]);
  const epoch = principalEpoch ?? identity.principalEpoch;

  // A change of store or sign-in takes the editor away at once; there is no question to ask about records that are no longer this person's.
  useEffect(() => { if (planning && !(followed && fresh)) setPlanning(false); }, [planning, followed, fresh]);
  // Leaving the page with changes in the editor asks first.
  useEffect(() => {
    if (!planning) return undefined;
    const leaving = (e) => { if (guard.current && guard.current.hasDraft()) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", leaving);
    return () => window.removeEventListener("beforeunload", leaving);
  }, [planning]);
  // Close, the scrim and Escape all come here; the editor's own Escape has asked already and closes directly.
  const requestClose = () => {
    if (guard.current && guard.current.hasDraft() && !window.confirm(DISCARD)) return false;
    setPlanning(false);
    if (planner.current) planner.current.focus();
    return true;
  };
  const canPlan = followed && fresh;
  const plan = canPlan ? (
    <button type="button" ref={planner} className="sc-retry" aria-haspopup="dialog" onClick={() => setPlanning(true)}>Plan the month</button>
  ) : null;
  const editor = planning ? (
    <EditorDialog id={panelId + "-plan"} label={`Plan the month, ${monthText(month)}`} onRequestClose={requestClose}>
      <Suspense fallback={<p role="status">Opening the planner.</p>}>
        <SchedulerEditor store={store} data={data} isOff={isOff} timezone={STORE_TIME_ZONE}
          principalEpoch={identity.principalEpoch} dataEpoch={stamp ? stamp.epoch : undefined}
          guardRef={guard} onClose={() => { setPlanning(false); if (planner.current) planner.current.focus(); }} />
      </Suspense>
    </EditorDialog>
  ) : null;
  const calendar = (
    <SchedulerCalendar storeId={store?.id} month={month} today={todayDate} reported={snapshot} principalEpoch={epoch}
      staffingReady={bound} roster={bound ? data.roster : undefined} departed={bound ? data.departed : undefined}
      daysOff={bound ? data.daysOff : undefined} forcedOff={bound ? data.forcedOff : undefined}
      presentAnyway={bound ? data.presentAnyway : undefined} scheduleSource={bound ? data.scheduleSource : undefined}
      isOff={rule} layout={layout} selectedDate={selectedDate} onSelectDate={setSelectedDate}
      onRetry={view.retry} onExpandedChange={setCompactOpen} />
  );
  if (layout === "compact") return <>{calendar}{compactOpen ? plan : null}{editor}</>;
  // The side rail is too narrow for a month of full-size dates, so on a wide screen the
  // calendar opens as a dialog, the way the approved calendar does.
  const close = () => { setOpen(false); if (opener.current) opener.current.focus(); };
  return (
    <div className="sc-entry">
      <style>{css}</style>
      <button type="button" ref={opener} className="sc-toggle" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => setOpen((v) => !v)}>
        <span className="sc-toggle-month">Deliveries calendar</span>
        <span className="sc-note">{monthText(month)}</span>
      </button>
      {open ? <CalendarDialog id={panelId} label={`Deliveries calendar, ${monthText(month)}`} onClose={close}>{calendar}{plan}</CalendarDialog> : null}
      {editor}
    </div>
  );
}

// A modal over the dashboard: focus moves in, Tab stays in, Escape or the scrim or Close
// gives focus back to the button that opened it, and the page behind does not scroll.
function CalendarDialog({ id, label, onClose, children }) {
  const box = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const el = box.current;
    el.querySelector(".sc-close").focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); closeRef.current(); return; }
      if (e.key !== "Tab") return;
      const tabbable = [...el.querySelectorAll("button, summary, [tabindex]:not([tabindex='-1'])")].filter((n) => !n.disabled && n.getClientRects().length);
      if (!tabbable.length) return;
      const first = tabbable[0], last = tabbable[tabbable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("keydown", onKey, true); document.body.style.overflow = overflow; };
  }, []);
  return createPortal(
    <div className="sc-scrim" onClick={(e) => { if (e.target === e.currentTarget) closeRef.current(); }}>
      <div className="sc-dialog" id={id} ref={box} role="dialog" aria-modal="true" aria-label={label}>
        <div className="sc-dialog-bar">
          <h2>Deliveries calendar</h2>
          <button type="button" className="sc-close" onClick={() => closeRef.current()}>Close</button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

// The planner in a modal of its own. Close, the scrim and Escape ask the entry, which asks about unsaved changes
// before it lets go; the page behind does not scroll while it is open.
function EditorDialog({ id, label, onRequestClose, children }) {
  const box = useRef(null);
  const closeRef = useRef(onRequestClose);
  closeRef.current = onRequestClose;
  useEffect(() => {
    const el = box.current;
    el.querySelector(".sc-close").focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Everything else on the page is out of reach while the planner is open: no click, tap, key or screen reader can
    // take the person to another tab or room from behind it. The only way out is the dialog, which asks about unsaved changes.
    const rest = [...document.body.children].filter((n) => n !== el.parentElement && !n.hasAttribute("inert"));
    for (const n of rest) n.setAttribute("inert", "");
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); closeRef.current(); } };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = overflow;
      for (const n of rest) n.removeAttribute("inert");
    };
  }, []);
  return createPortal(
    <div className="sc-scrim" onClick={(e) => { if (e.target === e.currentTarget) closeRef.current(); }}>
      <div className="sc-dialog" id={id} ref={box} role="dialog" aria-modal="true" aria-label={label}>
        <div className="sc-dialog-bar">
          <h2>Plan the month</h2>
          <button type="button" className="sc-close" onClick={() => closeRef.current()}>Close</button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
