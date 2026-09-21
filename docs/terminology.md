# Terminology

The names this project uses for the things on a board, and which of them are the
*same* name. It exists because a zone is keyed in four vocabularies at once and
nothing declared the mapping between them: three of them are written down in
different files, and the fourth is not written down anywhere at all — it is only
visible in what one client puts on the wire and another reads back. That is how
`play` came to mean two unrelated things.

`docs/board.md` is about the board's *layout* and has the same zones in it from
that side. `docs/gotchas.md` records the mistakes this document's table is meant
to prevent. Read this one first when a name looks wrong.

## The four vocabularies

Every zone has up to four names. Only the **wire** name is load-bearing across
the network; the others are internal and each is read by one part of the app.

| Vocabulary | Lives in | Read by | May it be renamed? |
| --- | --- | --- | --- |
| **store** | `custom/board.js` (a pile's own `name`, or a slot's `${id}.pokemon` / `.energy` / `.trainer`) | every store and component | **no** — it is the wire name |
| **grid area** | `Board.svelte`'s `grid-template-areas` and each zone's `.zone` / `.zone2` rule | CSS only | yes, but only with the CSS |
| **wire** | the `from` / `to` of a `cardsMoved` event, and the keys of a `boardState` | `opponent.js`'s `getPile()`, `applyBoardState` | **no** — both ends must agree |
| **log** | `logger.js`'s `piles` and `zones` | log lines, and nothing else | yes — it is internal to that file |

**The store name and the wire name are the same string**, and that is not a
coincidence worth relying on twice: a pile is created with its name
(`pile('lz')`), callers put that same name in the event
(`share('cardsMoved', { from: 'deck', to: targetPile.name })`), and the receiver
looks it up in `getPile()`. So a rename that looks like tidying a store field is
a protocol change, and the receiver's `getPile()` returning `undefined` is how it
fails: `cardsMoved` opens with `if (!pile2) return`, so **the card silently does
not move** on the other board. Nothing throws.

## The zones

| Zone on screen | store / wire | grid area | logger key | diagnostics line |
| --- | --- | --- | --- | --- |
| Hand | `hand` | `hand` / `hand2` | `hand` | `hand` |
| Prizes | `prizes` | `prizes` / `prizes2` | `prizes` | `prizes` |
| Deck | `deck` | `deck` / `deck2` | `deck` | `deck` |
| Discard | `discard` | `discard` / `discard2` | `discard` | `discard` |
| Lost Zone | `lz` | `lz` / `lz2` | `lz` | `lz` (shown as *lost zone*) |
| Bench | `bench` | `bench` / `bench2` | `bench` | `bench` |
| Active spot | `active` | `active` (rows `active1` / `active2`) | `active` | `active` |
| Table | `table` | **`play`** / `play2` | `table` | `table` |
| Stadium | `stadium` | `stadium` / `stadium2` | `stadium` | `stadium` |
| *(Pokémon in play)* | — | — | **`play`** | — |
| *(waiting cards)* | `pickup` | — | `pickup` | `pickup` (shown as *in hand (moving)*) |
| Slot innards | `${id}.pokemon`, `${id}.energy`, `${id}.trainer` | — | matched by `slotRegex` | — |

Three rows are not zones on the board, and each is there because something else
refers to it:

- **Pokémon in play** has no store and no cell. It is the bench and the active
  spot taken together, and it exists only as the log's `play` key, so that one
  visibility flag (`pokemonHidden`) covers both. It is the homonym below.
- **`pickup`** has a store and a wire name and no cell: cards wait there while a
  multi-card selection is resolved, so it is a phase rather than furniture. It is
  the *only* pile with no zone, and `docs/board.md` says so from the layout side.
- **Slot innards** are the three lists inside one Pokémon. Their names are minted
  in `slot()` (`cards.js`) and matched by a regex in two places —
  `slotRegex` in `logger.js` and in `opponent.js` — which is why the *shape* of
  that name matters and the `id` in it is a `crypto.randomUUID()`.

## The one homonym: `play`

`play` means two unrelated things, and they are one word in two vocabularies:

- **in the grid**, `play` is the **table's** cell. `.play2` is given
  `grid-area: play` on purpose, so the two tables share the cell, and
  `.stadium2` shares the stadium's band the same way.
- **in the log**, `play` is the **Pokémon in play** — the bench and the active
  spot together — and there is no store behind it at all.

So `Board.svelte`'s grid area `play` and `logger.js`'s key `play` are different
concepts that happen to share a spelling, and neither is the store `table`.

**Renaming the log's `play` to anything else fails silently and in front of the
wrong person.** `isPublicMove` reads `zones.play` to answer "is this move
public?"; if the lookup misses, both sides fall through to `slotRegex`, the
answer becomes false, and a log line that was supposed to *count* cards starts
*naming* them — *"Moved 2 cards from Deck to Bench"* becomes *"Moved [Pikachu]
from Deck to Bench"*, while Hide Pokémon is on, in front of the player whose
board it is. The key is the only thing holding that flag in place.

It never leaves the log vocabulary, which three things establish — each worth
re-checking rather than assuming:

```sh
grep -rn "'play'" src                    # who says the word at all
grep -rn "logSlotMove\|logBenched\|logPromoted" src   # the three internal users
```

- **It is not a wire zone.** Nothing sends `'play'`; `SlotMenu.svelte` sends the
  cards with `from: slot.pokemon.name` — the `${id}.pokemon` slot name — and then
  writes its log line with `'play'`, because those are the two different
  vocabularies and the call site is where they meet. So `'play'` is a name
  *callers use of the log vocabulary*, not one the log invented for itself.
- **The wire never carries it.** `getPile('play')` returns `undefined` in
  `opponent.js`, and `cardsMoved` opens with `if (!pile2) return`. So a `'play'`
  that ever reached the wire would not move the card, throw, or log an error —
  it would simply do nothing on the other board.
- **Nothing in a `boardState` is called `play` either.** The keys are `hand`,
  `prizes`, `discard`, `lz`, `table`, `active`, `bench` and `stadium` (see
  `exportBoard()` in `custom/board.js`), so a receiver never has to interpret it.

Those three together say `'play'` is a log word and nothing else. That is not the
same as "renaming it is safe", and the difference is the useful part:

**Renaming the map key alone is not safe.** Every call site that writes `'play'`
has to change with it, and a call site left behind does not fail loudly — the
lookup misses, the move reads as private, and the log prints a card name where it
should have printed a count.

**What is safe is adding a key beside it.** `isPublicMove` already builds its own
`zones` map with a `bench:` and an `active:` entry that nothing passes, because
the map holds what the *logger* answers to rather than what its callers say.
Adding a second name for the same idea there costs nothing and touches no caller
— which is the shape this homonym actually wants, and the one to copy.

So the clarity this needs is that the two meanings are written down, which is
this document. A rename that unifies the spellings is a change to the *log
vocabulary* and must take every `'play'` call site with it; it is a separate,
optional job, and not the fix for the homonym.

## Conventions that are not names

These are the other load-bearing conventions in the same family — each one is a
thing you have to know to read the code, and none of them is enforced:

- **The end of a pile's array is its top.** A deck is drawn from with `pop`, a
  card taken off the top is a `pop`, and a pile's own view reads from that end.
  So a list written down top-first goes back in *reversed* at the end — the whole
  subject of the long note over `placeOrdered` in `custom/cards.js`, and of the
  first entry in `docs/gotchas.md`.
- **The `2` suffix means the far half** of the same zone, and nothing else:
  `hand2`, `bench2`, `play2`. It is a grid-area and class suffix, not a store
  name — there is one store per zone per *board*, and the two halves of a
  spectator's screen are two boards, not two suffixes.
- **`lz` is never spelled out.** It is the store name and the wire name; *Lost
  Zone* is what a log line and a zone label say. The abbreviation is load-bearing
  on the wire, so it cannot be expanded without changing both ends.
- **A log line's brackets say whose card is named.** `[Pikachu]` is a card named
  because the move is public; a bare count (*"Moved 2 cards"*) is a move the
  other player may not read. `{Pikachu}` is a Pokémon in play being referred to
  by name in a line about something attached to it. The three forms are the
  visible half of `isPublicMove`, so they are a signal rather than decoration —
  see `logger.js` for which function writes which.
- **A "marker" is not a card.** The VSTAR / GX marker in the Pokémon Power zone
  is a token tracked by `powerMarker` / `powerMarkerUsed`. The Pokémon Power zone
  holds no cards, plays nothing, and is the one zone with no `board/` +
  `opponent/` component pair.

## What is not enforced

Nothing checks this table. Every vocabulary above is a hand-written literal in
its own file, so the entries can drift apart in silence — which is how the `play`
homonym survived every refactoring that has touched `logger.js`, and how a zone
name that is not in any map falls through to a `slotRegex` test that quietly
answers "no".

There are five separate places a zone name is written down:
`custom/board.js` (minting it), `docs/board.md`'s table, `Board.svelte`'s
`grid-template-areas`, `logger.js`'s two maps, and `diagnostics.js`'s `PILES` and
`ZONE_LABELS` lists. A check that derives all five and asserts they agree — and
that every name `logger.js` answers to is one it knows — is worth writing; until
then this document is the only place they are compared.

One thing that check can assert today, exactly, without a browser: what a slot's
sub-piles are named. They are minted in one line of `cards.js` and matched by a
regex in two other files, so the two are checkable against each other:

```sh
grep -rn "crypto.randomUUID" src                        # slot() mints the id
grep -rn "pokemon\\|trainer\\|energy" src/lib/stores/logger.js   # slotRegex
grep -rn "slotRegex" src                                # and who else matches it
```
