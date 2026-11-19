import { createHash } from "node:crypto";

const sha = (source) => createHash("sha256").update(source).digest("hex");
const WITH_NAV = "17de0d26c06578a97b5daae50f05d07f16f6c14cdbfa278a02bdb549f59fae0e";
const WITHOUT_NAV = "d3fe0b82dd6efb3b06625e2077ec7923ebe727708dc43a9bdfcba6206a2ad1f6";

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
