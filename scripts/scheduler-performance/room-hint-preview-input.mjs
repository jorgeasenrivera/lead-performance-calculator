import { createHash } from "node:crypto";

const sha = (value) => createHash("sha256").update(value).digest("hex");
const ROOM_HINT_MANAGER_SHA = "3393a36269e74683e53f70c74782b3b3c5c602f63a6655699249b708a4889196";
const PRECEDING_MANAGER_SHA = "b82d7d8623eb912a4169912cd4e2469627c0a0f4ad4ab8a17542087e3a78a397";
const COMPOSED_MANAGER_SHA = "58e08a9b86351c412ee5a405470a45c9279cb2b462aa7de094c3939775faa20c";
const DUET_MANAGER_SHA = "759e6cb6d170a1ce91b6bed82c5022fcec5310600862a51af444b4ea2fad2483";
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
