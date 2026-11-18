import { createHash } from "node:crypto";

const sha = (source) => createHash("sha256").update(source).digest("hex");
const WITH_NAV = "db81bdc6e646951999768e5b511283b80738debaee098cf4af913f08d7879d82";
const WITHOUT_NAV = "4856759537c2d4091f060c853ecfebe9b9a596b3c2b9d31098bab6c724346d8d";

// A production shell slot is not part of the frozen synthetic preview.
const shell = [
  ["  storeData, storeName, brand, children, corner, rooms, sectionNav,\n",
    "  storeData, storeName, brand, children, corner, rooms,\n"],
  ['      {sectionNav || <SectionStrip items={navItems} value={navValue} onChange={navOnChange}\n' +
    '        appModule={appModule} storeData={storeData} />}',
    '      <SectionStrip items={navItems} value={navValue} onChange={navOnChange}\n' +
    '        appModule={appModule} storeData={storeData} />'],
];
export function managerPagesPreviewInput(source) {
  if (sha(source) !== WITH_NAV) return source;
  for (const [from, to] of shell) {
    if (source.split(from).length !== 2) throw Error("Manager pages preview anchor changed.");
    source = source.replace(from, to);
  }
  if (sha(source) !== WITHOUT_NAV) throw Error("Manager pages preview did not restore the approved source.");
  return source;
}
