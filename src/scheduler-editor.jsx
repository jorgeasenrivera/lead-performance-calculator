/**
 * The approved month editor, hosted.
 * -------------------------------------------------------------------------
 * Mounts scripts/scheduler-performance/month-app-core.mjs (the editor the preview shows) in a frame
 * of its own, so its stylesheet, which styles `body` and `:root`, cannot reach this page and nothing
 * on this page reaches it. It reads the records it is handed through src/scheduler-editor-adapter.mjs,
 * and it writes nothing: no request, no storage. What a person changes lives in the frame until it
 * closes, and the screen says so. Nothing imports this file yet.
 *
 * The records are taken when the editor opens for a store. A different store, or a new sign-in
 * (`principalEpoch`), opens a fresh editor and drops the old one with whatever was unapplied.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import css from "../scripts/scheduler-performance/planner.css?inline";
import shared from "../scripts/scheduler-performance/shared-system.css?inline";
import { mountMonthApp } from "../scripts/scheduler-performance/month-app-core.mjs";
import { editorProps } from "./scheduler-editor-adapter.mjs";

const REASONS = {
  "not-ready": "This store’s people are still loading.",
  timezone: "The store’s time zone is not available.",
  store: "This store cannot be opened.",
};

// A frame document with the editor's own two stylesheets and one place to mount.
const FRAME = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><style>${shared}</style></head><body><main id="app"></main></body></html>`;

export default function SchedulerEditor({
  store, data, isOff, timezone, now, principalEpoch = 0, day, title = "Plan the month",
  onClose, onSummary, onError, confirm,
}) {
  const frame = useRef(null);
  const [loaded, setLoaded] = useState(null);
  const [failed, setFailed] = useState(false);
  // Latest callbacks without remounting the editor when a parent re-renders.
  const latest = useRef({});
  latest.current = { onClose, onSummary, onError, confirm, day };
  const ready = Boolean(store) && data?.__storeId === store.id;
  const identity = `${store?.id}|${principalEpoch}`;
  // One snapshot per store and sign-in. A later change to `data` is not applied to an open editor.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const built = useMemo(() => editorProps({ store, data, isOff, timezone, now, ready }), [identity, ready, timezone]);

  useEffect(() => { setFailed(false); }, [identity]);

  useEffect(() => {
    // `loaded` names the store it loaded for, so a frame left over from the last store is never mounted into.
    if (!built.ok || !loaded || loaded.identity !== identity || !loaded.frame.isConnected) return undefined;
    const { frame: host } = loaded;
    let handle = null;
    try {
      const doc = host.contentDocument;
      handle = mountMonthApp({
        root: doc.getElementById("app"),
        stores: built.stores,
        assignmentForDay: built.assignmentForDay,
        today: built.today,
        index: built.index,
        embedded: true,
        keyTarget: doc,
        confirm: (message) => (latest.current.confirm ? latest.current.confirm(message) : host.contentWindow.confirm(message)),
        onSummary: (detail) => latest.current.onSummary?.(detail),
        onClose: () => latest.current.onClose?.(),
        onError: (error) => latest.current.onError?.(error),
      });
      if (latest.current.day) handle.view({ day: latest.current.day, store: built.stores[0].id });
    } catch (error) {
      setFailed(true);
      latest.current.onError?.(error);
    }
    return () => handle?.dispose();
  }, [built, loaded, identity]);

  if (!built.ok) return <p role="status">{REASONS[built.reason] || "The editor is not available."}</p>;
  if (failed) return <p role="alert">The editor could not open. Close it and try again.</p>;
  return (
    <iframe
      key={identity}
      ref={frame}
      title={title}
      srcDoc={FRAME}
      onLoad={(e) => setLoaded({ identity, frame: e.currentTarget })}
      style={{ border: 0, width: "100%", height: "100%", minHeight: "70vh", background: "transparent" }}
    />
  );
}
