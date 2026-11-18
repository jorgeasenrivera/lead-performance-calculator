import { createHash } from "node:crypto";

const sha = (value) => createHash("sha256").update(value).digest("hex");
const ROOM_HINT_MANAGER_SHA = "3393a36269e74683e53f70c74782b3b3c5c602f63a6655699249b708a4889196";
const PRECEDING_MANAGER_SHA = "b82d7d8623eb912a4169912cd4e2469627c0a0f4ad4ab8a17542087e3a78a397";
const COMPOSED_MANAGER_SHA = "3a1fabc3fbe6669995449b25a72c1c4a56a5f597a0beb27538939d981b3418d1";
const DUET_MANAGER_SHA = "73c3d15c566441bb9a3b134164411a3d9f7baa64316244ced63193b92c36076e";
const exactInputs = new Map([[ROOM_HINT_MANAGER_SHA, PRECEDING_MANAGER_SHA], [COMPOSED_MANAGER_SHA, DUET_MANAGER_SHA]]);
const current = "<p className=\"hint\">{k === \"floor\" ? \"Leave blank to open Live Floor 1 hour before the store opens, or at 8:00 AM if store hours aren’t set. A time you set for a weekday takes priority. Store time.\" : \"Blank means the desk opens it, as before. Store time.\"}</p>";
const previous = "<p className=\"hint\">Blank means the desk opens it, as before. Store time.</p>";

// A copy-only change does not modify the frozen Scheduler preview source.
export function roomHintPreviewInput(source) {
  const preceding = exactInputs.get(sha(source));
  if (!preceding) return source;
  if (source.split(current).length !== 2) throw Error("Rooms hint preview input anchor changed.");
  const restored = source.replace(current, previous);
  if (sha(restored) !== preceding) throw Error("Rooms hint preview input changed.");
  return restored;
}
