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
import { useId, useMemo, useState } from "react";
import css from "./scheduler-calendar.css?inline";
import {
  STORE_TIME_ZONE, calendarCells, cellClass, cellLabel, dayDetail, deliveriesMonth, monthText,
  scheduleReview, staffingMonth, storeToday, summaryText,
} from "./scheduler-calendar-model.mjs";

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
  storeId, month, today, reported, roster, departed, daysOff, forcedOff, presentAnyway, scheduleSource, isOff,
  layout = "panel", defaultExpanded = false, selectedDate, onSelectDate, onRetry,
}) {
  const todayDate = today || storeToday();
  const deliveries = useMemo(
    () => deliveriesMonth(reported, { storeId, month, today: todayDate }),
    [reported, storeId, month, todayDate],
  );
  const staffing = useMemo(
    () => staffingMonth({ month, roster, departed, daysOff, forcedOff, presentAnyway, scheduleSource, isOff }),
    [month, roster, departed, daysOff, forcedOff, presentAnyway, scheduleSource, isOff],
  );
  const review = useMemo(() => scheduleReview(scheduleSource, month), [scheduleSource, month]);
  const cells = useMemo(() => calendarCells(month), [month]);

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
  const title = monthText(month);
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
          aria-label={`${title}, calendar. ${summary}`} onClick={() => setExpanded((v) => !v)}>
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
    </div>
  );
}
