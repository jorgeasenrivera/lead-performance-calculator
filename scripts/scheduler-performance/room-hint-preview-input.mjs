import { createHash } from "node:crypto";

const sha = (value) => createHash("sha256").update(value).digest("hex");
const ROOM_HINT_MANAGER_SHA = "3393a36269e74683e53f70c74782b3b3c5c602f63a6655699249b708a4889196";
const PRECEDING_MANAGER_SHA = "b82d7d8623eb912a4169912cd4e2469627c0a0f4ad4ab8a17542087e3a78a397";
const COMPOSED_MANAGER_SHA = "4856759537c2d4091f060c853ecfebe9b9a596b3c2b9d31098bab6c724346d8d";
const DUET_MANAGER_SHA = "9f468e577bc8e123b4e0589fcf30d7b9d92a4e208ba8b75c0a4b019b9b95d580";
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
