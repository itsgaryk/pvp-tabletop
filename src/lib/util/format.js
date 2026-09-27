/*
   The formats a room can be played in.

   A format is chosen when the room is made and belongs to the room: both players
   and every watcher are told which one it is rather than asked, so a room reads
   the same on every screen. That is why it lives here, in a module that imports
   nothing, rather than beside the board - the relay stamps it into the room's
   metadata and the client reads it back, and neither side owns the words.

   Only the card pool really differs between the three, and this app enforces no
   deck legality at all (see docs/mechanics.md). What a format does decide here is
   which parts of the board exist: the Lost Zone and the Pokemon Power zone - with
   the VSTAR / GX markers it holds - are both things a format can take away,
   because a zone a format's cards can never reach is a zone worth not drawing.
   The three answers are below, one function each, and they are deliberately not
   the same question asked three times: the two zones leave the board for
   different reasons.
*/

/* the three, in the order the create-room prompt offers them */
export const FORMATS = [
   { value: 'standard', label: 'Standard' },
   { value: 'glc', label: 'Gym Leader Challenge' },
   { value: 'expanded', label: 'Expanded' }
]

/* what a room is played in unless its creator said otherwise */
export const DEFAULT_FORMAT = 'standard'

/*
   A format from anywhere - a room made before formats existed, a request body a
   client made up, a relay reply - read as one of the three. An unknown value is
   the default rather than an error: the metadata is data from the store, and a
   room whose format cannot be read is a room played as Standard, not a board that
   throws on the way in.
*/
export function normalizeFormat (value) {
   return FORMATS.some((format) => format.value === value) ? value : DEFAULT_FORMAT
}

/*
   The marker a format puts on each player's own half of the board: the pair in
   Expanded, and neither mark in the other two.

   Expanded is the one format whose card pool carries both Rule Box powers - GX
   from the Sun & Moon sets and VSTAR from the Sword & Shield ones - so it is the
   one that has anything to track. Standard and Gym Leader Challenge show nothing:
   GX cards rotated out of Standard, and Gym Leader Challenge allows no Pokemon
   with a Rule Box at all. So neither format has a power to mark, and a board in
   one of them carries no tokens rather than a pair that can never be clicked
   meaningfully.
*/
export function markerForFormat (format) {
   return normalizeFormat(format) === 'expanded' ? 'both' : 'none'
}

/*
   Whether a format's board has a Pokemon Power zone at all - the band of the
   Stadium's cell each player's marker sits in.

   It goes with the markers, and with the same reasoning: the zone holds no cards,
   so in a format with no Rule Box powers it is a band of empty board between a
   player's bench and the Stadium. A zone nothing can ever be put in is not a zone
   worth drawing, so Standard and Gym Leader Challenge do not draw it and the
   Stadium takes the whole cell instead.
*/
export const showsPowerZone = (format) => normalizeFormat(format) === 'expanded'

/*
   Whether a format's board has a Lost Zone.

   Standard is the one that does not: the Lost Zone came in with the Sword &
   Shield sets and rotated out of Standard with them, so a Standard board has no
   zone to send a card to and none to draw. Gym Leader Challenge and Expanded both
   keep theirs, so this is *not* the same answer as `showsPowerZone` - the two
   zones leave the board for different reasons and a format can have one without
   the other.
*/
export const showsLostZone = (format) => normalizeFormat(format) !== 'standard'
