/*
   The marks a board's player has used: VSTAR and GX are separate powers, so a
   board that shows both tracks them separately.

   It lives here rather than beside one of the stores because both of them need
   it - the player's own board and the mirror of the other half - and those two
   already import each other. A shared helper in a module that imports nothing
   keeps a board state's shape in one place without adding a direction to that
   cycle.
*/

/* nothing used, which is what a board starts as and what 'none' means */
export const NO_MARKS_USED = { vstar: false, gx: false }

/*
   Which marks are used, from whatever a board was holding.

   A board state arrives as data from the relay, so it can carry anything: an
   older client's single boolean, a room replayed from before this was per-mark,
   or nothing at all. Reading `.vstar` off one of those would throw inside a relay
   handler, which is a silent fault on the board rather than a wrong pixel - so
   everything is read through here.
*/
export function normalizeMarkerUsed (used) {
   if (used && typeof used === 'object') {
      return { vstar: Boolean(used.vstar), gx: Boolean(used.gx) }
   }
   return { vstar: Boolean(used), gx: Boolean(used) }
}

/* whether a particular mark has been used, tolerant of the same shapes */
export const markerUsed = (used, which) => Boolean(normalizeMarkerUsed(used)[which])
