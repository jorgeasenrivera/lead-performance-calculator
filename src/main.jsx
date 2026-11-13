import { boardRequest, mountReadOnlyBoard, watchBoardBuild } from "./read-only-board.mjs";

// A wall must never boot the app's session, migration, or reporting effects.
const board = boardRequest(window.location.search);
if (board) {
  const stop = mountReadOnlyBoard({
    request: board,
    root: document.getElementById("root"),
    db: { url: import.meta.env.VITE_SUPABASE_URL, anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY },
  });
  let notice;
  const stopWatching = board.storeId ? watchBoardBuild({ onUpdateBlocked() {
    if (notice) return;
    notice = document.createElement("div");
    notice.setAttribute("role", "status");
    Object.assign(notice.style, { position: "fixed", bottom: "12px", left: "12px", right: "64px", zIndex: "10",
      padding: "10px 14px", background: "#0B1622", color: "#CFE0F0", border: "1px solid #88C6EA", borderRadius: "8px", font: "500 14px/1.4 system-ui" });
    notice.textContent = "A board update is available. This screen is keeping its current view.";
    document.body.appendChild(notice);
  } }) : () => {};
  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) { stop(); stopWatching(); notice?.remove(); }
  });
} else {
  import("./app-entry.jsx");
}
