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

The `to` in that row is a **zone's**. The relay's own envelope carries a second `to` —
the audience an event is addressed to — and the two are told apart by shape rather than
by spelling: see [The homonym on the wire](#the-homonym-on-the-wire-the-relays-to).


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

## The homonym in the log: `play`

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

## The homonym on the wire: the relay's `to`

One more `to` shares the wire and is **not a zone at all**: the audience an event is
*addressed* to. A Look, a Reveal Hand and the log line that names what a look found are
sent to some members and not others, and the sender names them as
`{ to: [ memberId, … ] }`; the relay decides the real audience from membership, stores it
as a field of the event, and splices the field out before the payload is delivered
(`audienceOf` / `withoutAudience` in `src/routes/api/relay/events/+server.js`).

So the wire carries `to` twice, one level apart and with two meanings:

| `to` | Where | What it is | Who reads it |
| --- | --- | --- | --- |
| a **zone** | inside a move's payload (`data.to` of `cardsMoved` / `slotsMoved`) | a string: `'hand'`, `'table'`, `'discard'`, … | `getPile()` in `opponent.js` |
| an **audience** | the relay's envelope (`data.to` on the way in, `event.to` on the way out) | a list of member ids | `audienceOf` and the poll's `forMember` |

The two are told apart by **which of them the event is about**, and the two ends ask that
different ways. On the way *in* the relay asks the **shape** — `Array.isArray(data.to)` —
because it has to tell "an audience was asked for" from "this event has no audience", and a
move's zone name is a string that must not be mistaken for one. On the way *out*, where the
payload is stored and delivered, it asks the **name**: `withoutAudience` drops the field only
for an event that is addressed at all, because on those three the field is the audience by
definition and none of them carries a zone.

Asking only whether the field was *there* is what it cost to learn: that deleted the
destination from every move in the game, so no card moved on the other board in any zone, with
nothing thrown and nothing logged. The account is in [gotchas.md](gotchas.md);
`tools/relay-check.mjs` and `tools/zone-sync-check.mjs` are what hold both halves of it now.

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

## What is enforced, and what is not

`tools/zone-vocabulary-check.mjs` derives every place a zone name is written down —
`custom/board.js` (which mints it), `exportBoard()`'s keys, `logger.js`'s two maps,
`diagnostics.js`'s lists, `opponent.js`'s `getPile()`, and `util/piles.js` — and
asserts they agree. It also holds the two slot-name regexes against each other and
against what `slot()` actually mints, and it pins the two deliberate exceptions by
name: Pokémon-in-play (`play`) and the slot zones, so a third one has to be looked at
rather than waved through.

`util/piles.js` is the one of those that is a **window's** vocabulary rather than the
log's or the layout's: it is keyed by the same store names as everything else here,
and holds what a *pile view* reads — the name a window says out loud, the colour it
wears, and where its move buttons send the cards picked out of it. It covers the seven
piles a view can be opened on, which is not the board's whole set: `pickup` is a phase
with no view, and the Bench and the Active spot are slots rather than piles. Both
inspection windows read it, so the near half's view and the far half's cannot disagree
about what a zone is called — and its labels are held against `logger.js`'s, because a
window that says something different from the line the same move writes is two names
for one zone on one screen.

It runs in CI with the other tree checks. What it cannot check is prose: the table
above is compared against the code only for the *board's* zones, so a claim about
semantics — which is most of this document — is still on the reader.

Two things it deliberately does **not** assert, because they are not true of this
board and asserting them would be asserting a tidiness the code does not have:

- That `logger.js`'s two maps have the same keys. `piles` also names the slot
  zones (Bench, Active), which are single slots rather than piles. What is asserted
  is the requirement underneath: everything the log can *name* it can also
  *judge*. Writing the check is what found that it could not — `bench` and
  `active` were in `piles` and missing from `zones`, so a `logMove(…, 'bench')`
  would have missed the lookup and printed card names it was meant to count. Two
  lines fixed it; nothing passes either name today, which is why it had gone
  unnoticed and why it is now pinned.
- That the diagnostics panel counts the same set it labels. It deliberately counts
  fewer: its `PILES` is the pile kinds, and `stadium` is counted beside them rather
  than in the list — it holds a list of up to two rather than a pile, and it gets
  no separate entry.

A check that says what the *semantics* are — that these three names mean the same
thing and those two do not — is not something this can do, and is why the document
exists as well as the tool.
