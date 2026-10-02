/* The workbook's store names, as Sage knows them. A name that is not here is
   reported and skipped, never guessed: the three Holler Nissan stores, Holler
   Infiniti and Genesis are not Sage stores yet. "Drivers Mart" with no town is
   Winter Park (Jorge, 2 October). */
export const WORKBOOK_STORES = {
  "holler honda": "holler-honda",
  "classic honda": "classic-honda",
  "holler hyundai": "holler-hyundai",
  "audi north orlando": "audi-north-orlando",
  "classic mazda": "classic-mazda",
  "drivers mart": "driver-s-mart-winter-park",
  "drivers mart - sanford": "driver-s-mart-sanford",
  // one sheet (November 2016) labels Winter Park "Drivers Mart- WP"; no sheet
  // has a plain "Drivers Mart" figure for those two weeks, so it fills a gap
  "drivers mart - wp": "driver-s-mart-winter-park",
  "mazda lakeland": "mazda-lakeland",
  "vinfast orlando": "vinfast-orlando",
  "holler ford": "holler-ford",
  "east orlando mitsubishi": "east-orlando-mitsubishi",
  "audi daytona": "audi-daytona",
};
export const STORE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const normName = (s) => String(s).toLowerCase().replace(/\s*-\s*/g, " - ").replace(/\s+/g, " ").trim();
export const storeIdFor = (raw, map = WORKBOOK_STORES) => map[normName(raw)] || null;
