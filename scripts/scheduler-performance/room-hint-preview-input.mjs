import { createHash } from "node:crypto";

const sha = (value) => createHash("sha256").update(value).digest("hex");
const ROOM_HINT_MANAGER_SHA = "3393a36269e74683e53f70c74782b3b3c5c602f63a6655699249b708a4889196";
const PRECEDING_MANAGER_SHA = "b82d7d8623eb912a4169912cd4e2469627c0a0f4ad4ab8a17542087e3a78a397";
const COMPOSED_MANAGER_SHA = "4cc3c11e926f6157d30339f3a4af75d237078d1ca4e18e8944de66acc49338bc";
const DUET_MANAGER_SHA = "7d5d45691eac734b7f21743b26af403089f039ef98c9dea276c7a653d89b08ea";
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
