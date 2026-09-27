/*
   The piles a card window can be opened on.

   A card window - *View All* on a deck, a discard, a lost zone, the table, a
   Stadium, or a Look at the opponent's deck - is **one dialog for every pile**:
   `Inspection.svelte` and `OppInspection.svelte` draw the same grid, the same
   Natural/Sorted tabs and the same card, and the two boards' piles are the same
   set of components. So everything that makes one of those windows *this* pile
   rather than another is data rather than markup, and this module is where that
   data lives.

   It is keyed by the pile's **store name**, which is also the wire name and the
   log's key (see docs/terminology.md) - `lz` rather than `lostZone` - because
   that is the one string the board, the log and the relay all already agree on,
   and it is what `pile.name` has been read as since these two windows were
   written (`Inspection.svelte`'s `ZONES[pile?.name]`).

   **A name and not an object**, and that is load-bearing rather than tidy. The
   two boards are two tables of stores and their piles *share every name* while
   being different objects - a player's `discard` and their mirror of the
   opponent's `discard` both call themselves `discard` (see `opponent.js`, which
   marks the mirrors `theirPile` for exactly this reason). So a table keyed by
   identity would need one row per half and could not answer for a spectator's
   second mirror; a table keyed by name answers for all of them at once, which is
   why the same window serves both halves and both seats.

   What is deliberately **not** here, and why:

   - **The log's names and visibility flags.** `logger.js` holds `piles` (what a
     line calls a zone) and `zones` (whether the cards in it may be named), and
     the two are held together by `tools/zone-vocabulary-check.mjs` because a key
     in one and not the other fails *silently* on screen. `logger.js` also needs
     `play` and `pickup`, which are not zones any window opens on, so folding it
     in would mean this table carrying keys no window reads. The two agree on
     every name they share, and the check asserts it.
   - **The grid areas** (`Board.svelte`'s `zoneLabels`). Those are the layout's
     vocabulary, one entry per *cell* rather than per pile - `deck` and `deck2`
     are two areas for two halves - and `docs/board.md` states that list is
     written out on purpose, because the names are the game's words rather than
     the components'.
   - **The diagnostics labels** (`stores/diagnostics.js`). That list is what the
     panel counts, which is a different set again (it counts `stadium` beside the
     piles rather than in them).
   - **Whether a pile's view may be sorted.** Both views render the Natural and
     Sorted tabs for *every* pile they are opened on, with no guard by kind, and
     sorting is by `_id` and changes nothing outside the panel - so there is no
     rule here to state. If one is ever added, it belongs in this table.

   `docs/terminology.md` is the prose authority on the four vocabularies these
   names are written in; this table is the one a *window* reads.
*/

/*
   The seven piles that have a view to open. The six piles a zone draws with a
   count badge and a menu carrying *View All* - `deck`, `hand`, `discard`, `lz`,
   `prizes`, `table` - and the Stadium, which is drawn as a band rather than a
   pile zone and is the seventh thing both inspection windows can be pointed at.
*/
export const PILE_NAMES = ['deck', 'hand', 'discard', 'lz', 'prizes', 'table', 'stadium']

/*
   A pile's window, looked up by the pile's own store name.

   `label` is the pile's name in the game's words, which is what both the window's
   heading and the log's line for the same zone say, so the two cannot disagree
   about what a zone is called.

   `accent` is the one colour a pile's view wears, drawn as a bar beside the name.
   It is here rather than in the panel because a view is one dialog for every pile:
   two of them open side by side - which is how a player reads a deck against a
   discard - are the same panel with different cards in it, and the colour is what
   tells them apart at a glance without reading either heading.

   `movedTo` is where a view's move buttons send the cards picked out of it: the
   places a *search* takes a card out of a **deck** into, which is the move a pile
   view exists for. A discard and a lost zone are public and ordered, so their view
   is a read and they send nothing - the empty list is that rule, and it is why the
   buttons are drawn from here rather than written out in the panel.

   `moveLabel` is what the button says. It is the same string for every pile that
   moves anything today, and it is a field rather than a constant because the
   label belongs to the destination (`Add to bench`) and not to the pile the cards
   are leaving, so a pile that sends them somewhere new states its own wording
   beside its own list.
*/
export const PILE_WINDOWS = {
   deck: {
      label: 'Deck',
      accent: '#4f7fd4',
      movedTo: [
         { pile: 'table', moveLabel: 'Add to table' },
         { pile: 'hand', moveLabel: 'Add to hand' },
         { pile: 'bench', moveLabel: 'Add to bench' },
         { pile: 'discard', moveLabel: 'Add to discard pile' }
      ]
   },
   hand: {
      label: 'Hand',
      accent: '#1ca492',
      movedTo: []
   },
   discard: {
      label: 'Discard',
      accent: '#b4544a',
      movedTo: []
   },
   lz: {
      label: 'Lost Zone',
      accent: '#8b5cf6',
      movedTo: []
   },
   prizes: {
      label: 'Prizes',
      accent: '#d9a521',
      movedTo: []
   },
   table: {
      label: 'Table',
      accent: '#94a3b8',
      movedTo: []
   },
   stadium: {
      label: 'Stadium',
      accent: '#3f9e63',
      movedTo: []
   }
}

/*
   The window for a pile, or a readable stand-in for one that is not in the table.

   A caller always has a pile in hand - it was handed one by an opener - so the
   argument for reading through here is the same one `statusById` gives: a lookup
   that misses must not throw inside a render or a relay handler, where the fault
   is a blank or a wrong panel rather than a wrong number. A pile the table does
   not know is drawn under its own store name, in the panel's own colour, and
   offers no moves - which is what a window on an unknown pile should do rather
   than being something it has to be told.
*/
const FALLBACK_ACCENT = 'var(--primary-color)'

export function pileWindow (pile) {
   const name = typeof pile === 'string' ? pile : pile?.name
   const window = PILE_WINDOWS[name]

   if (window) return window

   return {
      label: name || 'Pile',
      accent: FALLBACK_ACCENT,
      movedTo: []
   }
}

/* every pile's window, in the order PILE_NAMES gives, for a caller that wants the set */
export function pileWindows () {
   return PILE_NAMES.map((name) => PILE_WINDOWS[name])
}
