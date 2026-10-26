// JSON-shaped stored values, with object key order irrelevant and absence kept
// distinct from a present undefined property. No coercion of null, zero or units.
export function isDeepStrictEqual(a,b) {
  if (Object.is(a,b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ak=Object.keys(a),bk=Object.keys(b);
  return ak.length===bk.length && ak.every(k=>Object.hasOwn(b,k)&&isDeepStrictEqual(a[k],b[k]));
}
