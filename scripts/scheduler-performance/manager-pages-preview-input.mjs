import { createHash } from "node:crypto";

const sha = (source) => createHash("sha256").update(source).digest("hex");
const WITH_NAV = "6342a6b9e32e375992d60232890c161181a3bb919825598afd4bbc3617bcee80";
const WITHOUT_NAV = "4cc3c11e926f6157d30339f3a4af75d237078d1ca4e18e8944de66acc49338bc";

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
