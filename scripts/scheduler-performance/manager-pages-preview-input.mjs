import { createHash } from "node:crypto";

const sha = (source) => createHash("sha256").update(source).digest("hex");
const WITH_NAV = "3d27a0e78e4c7943a6e1f280c2a1b6e9477d9f7ae4a00150bad8a7771c07c6a4";
const WITHOUT_NAV = "eb546a60c96a9e22fde29a4bdfacf7c6fc468cd00fda25591893cb5119f77a6a";

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
