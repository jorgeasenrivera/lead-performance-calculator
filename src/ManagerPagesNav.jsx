import React, { useEffect, useLayoutEffect, useId, useRef, useState } from "react";
import "./manager-pages-nav.css";

const useBrowserLayoutEffect = typeof document === "undefined" ? useEffect : useLayoutEffect;

export default function ManagerPagesNav({ items, value, onChange, Icon, importBadge }) {
  const pages = items.filter(([id]) => id !== "import");
  const [lastPage, setLastPage] = useState(null);
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef(null), trigger = useRef(null), panel = useRef(null);
  const selectionFocus = useRef(null);
  const importing = value === "import";
  const pinned = pages.find(([key]) => key === (importing ? lastPage : value)) || pages[0];

  useBrowserLayoutEffect(() => {
    if (value !== "import") setLastPage(value);
    if (panel.current?.contains(document.activeElement)) trigger.current?.focus();
    setOpen(false);
  }, [value]);
  useBrowserLayoutEffect(() => {
    const destination = selectionFocus.current;
    selectionFocus.current = null;
    // A first visit to a lazy page can hide the shell in Suspense. Only
    // recover focus lost to the document, never take it from another control.
    if (destination === value && document.activeElement === document.body) {
      trigger.current?.focus({ preventScroll: true });
    }
  });

  const close = (restore) => {
    if (restore) trigger.current?.focus();
    setOpen(false);
  };
  useEffect(() => {
    if (!open) return;
    const outside = (event) => {
      if (!root.current?.contains(event.target)) close(panel.current?.contains(document.activeElement));
    };
    document.addEventListener("click", outside);
    return () => document.removeEventListener("click", outside);
  }, [open]);

  const toggle = () => {
    if (open) { close(false); return; }
    const parent = root.current.getBoundingClientRect(), button = trigger.current.getBoundingClientRect();
    root.current.style.setProperty("--sage-nav-origin", Math.round(button.left + button.width / 2 - parent.left) + "px");
    setOpen(true);
  };
  const select = (key, restore = false) => {
    if (restore && key !== value) selectionFocus.current = key;
    close(restore);
    onChange(key);
  };

  return (
    <nav ref={root} className="sage-pages-nav no-print" aria-label="Store pages" onKeyDown={(event) => {
      if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(true); }
    }}>
      <div className="sage-pages-rail">
        <button type="button" className="sage-page-pinned" aria-current={value === pinned[0] ? "page" : undefined}
          onClick={() => select(pinned[0])}>
          <Icon glyph={`manager-nav-${pinned[0]}`} size={16} />{pinned[1]}
        </button>
        <button type="button" className="sage-page-import" aria-current={importing ? "page" : undefined}
          onClick={() => select("import")}>
          <span className="sage-page-intake-icon" aria-hidden="true">
            <span className="sage-page-mouth"><Icon glyph="manager-nav-import-ticket" size={20} className="sage-page-ticket" /></span>
            <Icon glyph="manager-nav-import-slot" size={20} />
            <Icon glyph="manager-nav-import-laser" size={20} className="sage-page-laser" />
          </span>
          Import {importBadge}
        </button>
        <button type="button" className="sage-page-toggle" ref={trigger} aria-controls={id} aria-expanded={open} onClick={toggle}>
          <Icon glyph="manager-nav-pages" size={16} />Pages<Icon glyph="manager-nav-chevron" size={12} className="sage-page-chevron" />
        </button>
      </div>
      <div className="sage-pages-panel" id={id} hidden={!open} ref={panel}>
        {pages.map(([key, label], order) =>
          <button type="button" key={key} data-selected={value === key ? "" : undefined}
            style={{ "--sage-page-order": order }} onClick={() => select(key, true)}>
            <span className="sage-page-iconbox"><Icon glyph={`manager-nav-${key}`} size={16} /></span>{label}
          </button>
        )}
      </div>
    </nav>
  );
}
