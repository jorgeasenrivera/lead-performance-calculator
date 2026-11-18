import { createHash } from "node:crypto";
import { CURRENT_MANAGER_SHA } from "./historical-manager-fixture.mjs";

const sha = (source) => createHash("sha256").update(source).digest("hex");
const PEOPLE_MANAGER_SHA = "9f468e577bc8e123b4e0589fcf30d7b9d92a4e208ba8b75c0a4b019b9b95d580";

// Undo only the two reviewed People expressions in memory, before handing the
// original approved input to the historical fixture. No other source qualifies.
const inverses = [
  [
    "          out[k] = deliveredUnits(st);",
    "          out[k] = (st?.internetUnits ?? 0) + (st?.phoneUnits ?? 0)\n" +
    "                 + (st?.showroomUnits ?? 0) + (st?.campaignUnits ?? 0);",
  ],
  [
    "    if (!st) return 0;\n    return deliveredUnits(st);\n  };\n  const strangers = useMemo(() => unclaimed(data), [data]);",
    "    if (!st) return 0;\n" +
    "    return (st.internetUnits ?? 0) + (st.phoneUnits ?? 0) + (st.showroomUnits ?? 0) + (st.campaignUnits ?? 0);\n" +
    "  };\n  const strangers = useMemo(() => unclaimed(data), [data]);",
  ],
];

export function peoplePreviewInput(source) {
  // All other inputs go through the original fixture gate unchanged.
  if (sha(source) !== PEOPLE_MANAGER_SHA) return source;

  for (const [from, to] of inverses) {
    if (source.split(from).length !== 2) throw Error("People preview input anchor changed.");
    source = source.replace(from, to);
  }
  if (sha(source) !== CURRENT_MANAGER_SHA) throw Error("People preview did not restore the approved Manager input.");
  return source;
}
