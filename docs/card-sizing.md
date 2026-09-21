# A card on the board is the size of the zone it is in

Not a setting: **every zone of the board is a size container**
(`container-type: size` on the zone's cell in `Board.svelte`), so a card in one is
sized in the zone's own units — `100cqw` and `100cqh` are the zone's width and its
height — and scales to **whichever of the two is reached first**, less `--card-gap`
so it never touches the card beside it or the zone's edge. `--card-ratio` (width over
height, in `global.css`) is what turns "the zone's height" into a width, which is the
form `img.card` wants.

What each zone asks for follows from its own layout, and the one that matters is the
new rule for a zone holding more than one card: **the cards are sized by the block they
make together, not by the zone one of them would have had.** The prizes are the
example the rule was written for — a block of two columns, as many rows as it takes,
filling the zone with no gap between the cards, so six prizes are sized by six and
three prizes by three. The hand is
the other arrangement: its cards lie *along* it, so they are sized by the zone's height
and the row scrolls sideways once twenty of them no longer fit.

**The bar a row scrolls with is part of the zone as well.** `--scrollbar` (in
`global.css`) is the height `Horizontal.svelte` draws that bar at, and a row that fills
its zone leaves room for it the way it leaves room for a padding — the hand's row is the
board's *last* row, so a row 10px past the bottom of the zone is a scrollbar down the side
of the whole board. The hand's cards leave room for two more things the same way: the
pile's own `p-1`, which `100cqh` knows nothing about (the arithmetic the prizes work
around too), and the 2px border a card carries on each side, which is drawn outside the
image.

That is a card a little smaller than the zone alone would allow, and it is what keeps the
board exactly the window: nothing on it overflows a zone in either direction, at any
window, with any number of cards in hand or on a bench — which is what `Board.svelte`'s
`h-screen` wrapper scrolling would mean.

This is why `--card-width` is only what a card is where no zone has sized it: in an
inspection, in the deck list, in a dialog — and it is what a slot's cards fall back to if
one is ever put outside the two zones that hold them. Every card a *zone* holds is sized
by that zone, the table's stack included, which is sized by its zone's width (below).

**The rule is stated once, in `global.css`, and the cards in zones wear a class to claim
it.** `img:where(.zone-card).card` is the one place the size is written down; every pile's
own front — what a zone draws, a cardback or a discard's top card — wears `zone-card`.
Nine components used to write that same `min()` out for themselves, two benches carried a
verbatim copy of the same `--slot-card-width`, and each copy was commented with a pointer
to another copy: *a rule in nine places is nine rules*, and five sizes were got wrong in a
copy rather than in the rule (`#109` and `#110` for the prizes and the bench, `#117` to
`#122` for the prizes again, the bench's centring, an attached card cut off at the top of
the row, a slot's cards, and the bench's scroll). `tools/card-sizing-check.mjs` fails if a
zone claims a copy again.

**A rule that is stated once is worth only what it wins.** Writing the size down once did
not, on its own, reach the deck, the discard or the lost zone: the rule was spelled
`:where(.zone-card).card`, on the reasoning that `:where()` is at no specificity and would
therefore *tie* with `img.card` above it and take the later place in source order. It does
not tie. `:where()` contributes nothing, so that selector is a class alone — `(0,1,0)` —
against `img.card`'s `(0,1,1)`, and `img.card` won every time: the three pile fronts kept
the board's fixed `--card-width` (105px) while every other card on the board scaled with
its zone. Nothing in the tree could see it — the class was worn, the formula was in one
place, the build and the docs check were green — and one window size hides it completely:
105px is *too big* for the deck zone at a small window (the card hangs out of its zone over
the rows around it) and *too small* for the same zone at a large one. It took somebody
looking at the board.

The `img` is now outside the `:where()`: `img:where(.zone-card).card` is a type and a class,
`(0,1,1)`, exactly what `img.card` is, so the tie is real and source order is what decides
it. `tools/card-sizing-check.mjs` no longer recognises the selector by its shape — it
*measures* the specificity of both rules, and fails if the zone's stops reaching the cards.

Two things that look like this rule are deliberately not it:

- **The size cannot be a value on the board.** `100cqw` and `100cqh` are whichever zone
  the *card* is in, and a custom property is inherited unresolved — so a `--card-width`
  holding this `min()` on `.game` would be resolved against the zone of every card on the
  board, the table's stack included, which is exactly what the next point forbids.
- **`:where()` and the `img` outside it are both doing work.** The class is at no
  specificity *of its own*, which is what lets a zone redirect its own cards: the hand's
  row sizes its cards by the zone's height and two things `100cqh` knows nothing about, and
  `.hand-cards img.card` in `Hand.svelte` is `(0,2,1)`, so it beats this rule whatever this
  rule says. The `img` outside the `:where()` is what keeps this one at `(0,1,1)`, high
  enough to tie with `img.card` and no higher — see the paragraph above for what the
  selector costs without it.

**The table's stack is the one place a card is sized by its zone's *width* alone.** It is
the exception that proves the rule above rather than one to it: a stack taller than its cell
is *scrolled* by the cell ([board.md](board.md) has the table itself), so there is no height
for a card to fit into, and what the zone has to give is its width — less the pile's own
`p-1`, a `--card-gap` so the cascade does not touch the edge, and the bar the zone scrolls
with, times `--table-card-share`, which is the one card of a cascade that is `1 + 20/105`
cards wide. It is stated once, in `global.css`, because the two tables are one stack drawn
in a cell they share. Its cards are the reason the class is worn per card rather than handed
down from the board: `img:where(.zone-card).card` fits a card *both* ways, which a card in a
scrolling stack must not be. Before this, a table's cards were the board's fixed
`--card-width` — 105px of a 123px cell at 1277x821 — so the cascade was wider than the zone
it was in and reached over its neighbours at any small window, and a dozen cards ran
straight through the zone's border and over the rows around it. `--card-width` is still what
a card is where no zone has sized it: a dialog's, and a slot's fallback outside the two
zones that hold them.

**A marker on a card is a share of the card, digits included.** The damage counter's circle
has always been one (`--slot-width / 2.5`, in both slots) while the number in it was the
page's own font size, in a box that also carried a `1rem` padding: at a small card the
circle shrank, the number did not, and it stood out of the circle on all four sides — a huge
marker on a small Pokémon, which is how it was reported. Both are shares of the counter now
(`font-size: calc(var(--size) / 2)`, and no padding), so a three-digit counter fits its
circle at any card size, the way a status marker's emoji has always been a share of its own
(`StatusMarker.svelte`). The rest of what sits on a card was already written this way: the
status markers, the ability stripe, and the glow of a selection, which is an outline and
costs no room at all ([selection.md](selection.md)).

**There is no card size setting any more.** It was a slider over `--card-scale`, and
once the cards were the zones' it did nothing useful and one thing that was worse than
nothing: `--card-scale` multiplied the board's own spacing (`--scaled-rem`, the grid's
column gap, and `--card-gap`), so a slider left at anything but its default moved every
zone — a board scaled to 0.5 had narrower gaps, wider columns and cards that changed
size with them. `--scaled-rem` is a plain `1rem` and `--card-gap` a plain `4px`, and
nothing a card is sized by can be set from the menu.

The four nudges that used to sit on three of those piles are gone with it. The top
player's discard, and the bottom player's deck and lost zone, were each translated 30px
off the middle of their zone to open up two gaps the rotated half leaves tighter than
it reads — which was right while a card sat against its zone's corner and wrong the
moment cards were centred in their zones: the deck's card hung over the discard's row,
and the discard's sat half out of its own.

**The prizes cascade.** Two columns — the table a game is played with — and each row
overlapping the one above it, so ten prizes still read as the two columns they were
dealt as rather than growing sideways. The rows are the zone's height between them and
the last row's cards end exactly at the bottom of it, so nothing hangs out of the zone
however many there are; a card put into the prizes fills the next spot down, and the
whole pile is sized by how many rows it makes.

**The bench keeps its card size and scrolls.** A bench is five Pokémon, which fits, and
solo can put any number on one — so a bench that no longer fits is *navigated* rather
than shrunk, the way the hand is: the row scrolls sideways, and every Pokémon on it stays
the size the zone gives it. A card that shrinks as the bench fills up is a card that has
to be looked at twice, and a second row would have shrunk the whole bench to make room
for itself.

The row fills from its near edge and is **centred up and down in its zone**, which is
where a card in every other zone of the board sits. Keeping its own card size is what
made that visible: the row used to be laid against the top of the zone, which reads as
centred only while a bench zone happens to be about the height of a card — and a bench
zone is not, so a card sat in the corner of one.

Both benches are placed by their own box (`.bench-zone`, in the near half's component and
in the far half's): `display: grid` with `align-items: center`. The row cannot centre
*itself* inside its scroll container — that container is already the height of the row,
so centring within it would move nothing — and a grid item is what leaves the row what it
was: `flex items-center` would make the row a fit-content flex item, so a half-empty
bench's row would be only as wide as the cards on it and an empty one would have no width
at all, and the zone's whole width is the row's drop target.

**A slot's cards are the size of the zone too, and so are the steps its fan keeps.** The
active spot and the bench hold a Pokémon with whatever is attached to it, and both ask
their zone for the card: `--slot-card-width`, which `Slot.svelte` uses for the card *and*
for the cards attached to it. The bench's is `--bench-card-width` in `global.css` —
because there are two benches, and they are one row of cards that differ in whose they
are rather than in how big they are — while the two active spots declare their own, since
they are not that rule. A slot used to keep a fixed 105px card while the zone around it
did not, so a window short enough to leave the bench zone less than a card tall — the 821px
window the browser checks run at is one — drew cards over the bottom of the zone, and over
the top of it as well once the row was centred in one.

Every step the fan is laid out with is a **share of the card** rather than a pixel
(`--attach-step-energy` and `--attach-step-tool` for the 25px and 35px a fan steps
sideways, `--attach-lift-energy` and `--attach-lift-tool` for the 17px and 34px it is
lifted by, in `global.css`): a fan that kept its pixels while its cards shrank is a fan of
a different size than the card it is behind. The lift is also how far an attached card
reaches above the top of the card it is under, the two being the same size, so a zone has
to leave room for it: `--slot-card-share` is what is left of a zone's height for the card
once the tallest fan fits above it, and both slot zones spend their height through it.

The room is spent in each zone's own way, and each is where the zone already does its own
placing. The bench's row spends it as `margin-top` on a slot, so the row is as tall as the
group a slot draws, and its cards line up on their bottom edges rather than centred in it
— a slot carrying a tool is a taller item than one without, and centring the items would
put the Pokémon beside it half a lift higher. The active spot's own box spends it the same
way, since that container centres the *margin* box of what is in it: without it the fan
reached over the Pokémon Power band above the zone while the card sat in the middle of it.

It has to be the zone's row or box that spends it rather than the slot, and it is the two
slot zones alone that have to spend it at all. Nothing scrolls in the active spot, and the
table's stack is not a slot at all; the bench is the one that scrolls, and a scroll
container clips at its own box — `overflow-x: auto` makes the other axis `auto` too,
whatever it says — so an attached card that reached above the row was drawn from the row's
top edge down: the top of it, the part with the card's name on it, was cut off.

**A fan is as long as the cards attached to it make it, and only a zone that cannot make
room for one tightens it.** That is the same distinction as the lift, one axis over, and it
is what `--slot-fan-step-energy` and `--slot-fan-step-tool` say: the steps the fan is
*actually drawn* with, as against the ones the card gives it. In a role where the fan simply
gets longer — the bench, whose row is as long as it takes and scrolls — the two are the same
values, and a fan of twenty steps out exactly as a fan of two does. The active spot is the
one zone that can neither grow nor scroll, so it is the one that spends `--slot-fan-room`,
the space left beside a card centred in it, and divides that between the cards attached: a
fan of two energies is untouched, and a fan of twenty is twenty overlapping edges inside the
zone rather than a row marching out over the Stadium. What makes it a *fan* rather than a row
of cards is that the steps only ever tighten — never widen past the card's own share — so
consecutive cards always overlap, in order.

**A slot reserves that fan in the flow of its zone, unless the zone says not to.** The room a
fan takes on the right is `--slot-fan`, and a slot's right margin is
`var(--slot-fan-reserve, var(--slot-fan))`: the fan's own length by default, and the two
benches want exactly that, because a slot there is one of several in a row and the next
Pokémon must not be drawn over the fan of the one before it. The active spot reserves none of
it (`--slot-fan-reserve: 0px`) and that is the fix this rule was written for: it is a
*fixed-width* line, so a margin growing with every card attached asked it for room it did not
have — the Pokémon was pulled left out of its own zone, and the slot itself was squeezed once
the line was full. What is beside the card in the active spot is the fan drawn behind it, and
the card is to keep the place a lone card has however many cards are attached to it. See
[gotchas.md](gotchas.md) for what that squeeze did to the cards.

**And a card is never the size of the box it is drawn in.** `max-width: none` on a slot's
card, in both halves, because the reset this app wears puts `max-width: 100%` on every image
and an attached card's box is the slot it is drawn from: any box narrower than the card — a
squeezed slot, a Pokémon whose image has not arrived — resized the cards while the steps they
were placed with, shares of the *card*, did not. That is a fan of small cards with gaps
between them, and it is one line to prevent rather than one line to notice. `tools/fan-check.mjs`
measures the four promises of this section in a browser; `tools/card-sizing-check.mjs` asserts
the lines are still there.

**A prize stays face down while it is moved, and looking at one is said out loud.** The
card under the pointer in a drag is drawn from the card's face, so picking a face-down
prize up used to turn it over — both a look at a card nobody has taken yet and a lie,
since taking a prize turns nothing over; the drag preview draws the back for a pile
whose cards are face down.

And **looking at a face-down prize writes *Viewed prize card* to the game log**: it is
the one private look a player takes that the opponent cannot see, so the log says it
happened even though the card is not named. The rule is *a prize card, still face down*
and nothing else, so it lives in one place (`logPrizeLook` in `logger.js`) rather than at
each of the four things that take that look: the double click on a card, the card menu's
**Show Details**, the space bar, and the far half's own card menu in solo (which writes
the line in that half's name). **A prize that has been turned face up writes nothing** —
Show Prizes, or a spectator, who is handed every face — because a card both players can
read is not news.

Neither of those changes what a prize *is* on screen. The ring a selected prize draws,
and why it is an outline with the box lifted over the row below it rather than the
border a card in the hand wears, is in
[selection.md](selection.md#the-prizes-where-the-arithmetic-forces-the-outline); the
arithmetic above is exactly what forces it. `node tools/prize-check.mjs` measures both
halves of this in a browser.

Two things are not sized this way, and each is deliberate:

- **A zone's name** is sized by its own words. Nor is it a container: a size container
  is laid out as if it had no contents, which for a name whose whole size *is* its
  contents is a name that collapses to nothing.
- **The table's stack** — its cards are the zone's *width* and not its height, because a
  stack taller than the cell is scrolled by the cell rather than fitted into it (above, and
  [board.md](board.md)). Its cards are read by looking at them, at the size its zone gives
  them, and it is the one place on the board holding cards that is not a slot (see the bench
  and the active spot for what a slot does instead).
