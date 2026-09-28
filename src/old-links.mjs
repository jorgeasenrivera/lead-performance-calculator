/**
 * Links from the days of the QR sign-in (C99).
 * -------------------------------------------------------------------------
 * Jorge retired the QR codes on 28 September: the page they opened had been
 * blank on a phone that was not signed in, and people were reaching the line
 * through the desk or their account anyway. Codes are still on posters and in
 * screenshots, and table tags are still stuck to tables until they are rebuilt
 * for accounts. Any of them now opens Sage's own sign-in.
 *
 *   ?q=&d=&t=   the phone line's code      ?o=&d=&t=   the online line's
 *   ?f=&d=&t=   the floor's code           ?f=&tbl=    a table tag
 */
export function isOldCodeLink(search) {
  const p = new URLSearchParams(String(search || ""));
  if (p.get("d") && p.get("t") && (p.get("q") || p.get("o") || p.get("f"))) return true;
  if (p.get("f") && p.get("tbl")) return true;
  return false;
}
