/*
   The numbers the board asks for: what each question is, and what it will accept.

   A dozen gestures need a count from the player before they can happen - how many
   cards to draw, to look at, to reveal, to reorder, to discard - and each of them
   used to carry its own copy of three things: the question's words, the parse, and
   the bounds. Eleven call sites across six files, and the copies had drifted:

     - the same gesture was asked two ways. *View Top X* on the player's own deck
       asked "Look at how many cards?" while the same entry on the opponent's deck
       asked "Look at how many cards from the top?" - and `opponent/Deck.svelte`
       carried a note promising the two menus "ask for X in the same words", which
       nothing enforced.
     - the same question was *typed* for the same value: `parseInt` for the deck
       questions and `Number` for the damage one, so a cancel behaved differently in
       each family.
     - the bounds were written four different ways: `if (x)`, `if (!asked || asked
       < 1) return`, `if (!x || x < 1) return`, and one call site with no check at all.

   So this module is the one place a question is stated, and `askForNumber` is the
   one place it is put to the player.

   **The table holds the question; the caller keeps its own destination.** What
   happens to the number - `draw`, `openSelection`, `revealTop`, `openDeckOrder`,
   `moveTop`, `slot.damage.set` - stays at the call site, because that is a
   different thing for every one of them and a table of callbacks would be a table
   of the app. What is shared is only what was being copied.

   **Both halves ask with the same entry.** `board/Deck.svelte` and
   `opponent/Deck.svelte` are the two halves of one table, and a gesture that exists
   on both - *Draw X*, *Reveal Top X*, *Discard Top X* - is one row here. The one
   place the halves genuinely differ is the discard, because each discards from a
   deck it reads differently ("your deck" against "the opponent's deck"), and that
   is two rows rather than one row with a prop.

   **A row's `min` is what the gesture needs, and its `max` is what the board has.**
   Every count here comes off the top of a deck, so every one of them needs at least
   one card; `damage` is the exception and says so, because setting a Pokemon's damage
   back to zero is a real thing to want. The ceiling is the other way round: it is not
   a rule about the game but a reading of it, and it is the number of cards in the deck
   the gesture is about - so a reveal cannot ask for more cards than there are, and the
   count a log line reports is a count that happened.
*/

/*
   A row, and what each field is for:

     `question`  what the dialog says. One place, so two menus cannot word the same
                 gesture differently - which is what happened before this table.
     `type`      the kind of number: `'cards'` is a whole number of cards, `'damage'`
                 is a count of damage. It is what tells a fraction to be rounded
                 rather than passed on: half a card is not a card, and the old code
                 would happily draw 2.5 of them.
     `min`       the least that means anything. Every count of cards needs 1 - there
                 is no such gesture as "draw zero" - and damage's floor is 0, because
                 setting a Pokemon back to no damage is a real thing to want and this
                 prompt is the only way to say it.
     `max`       the most the *board* allows, which is a reading of the game rather
                 than a number: it is how many cards the deck has, so it is settled
                 when the prompt is asked rather than written here. The two values a
                 row can name are below, and the call site resolves them - this module
                 imports nothing, so it cannot read a deck itself.
     `maxHint`   whether the ceiling is worth saying in the dialog, for a row where
                 the player could not work it out by looking at their own board.

   The three things a `max` can be. Two are readings of the board:

     OWN_DECK     the deck of the player being asked. They can read its count off the
                  board's own badge, so it needs no hint.
     THEIR_DECK   the deck on the other side of the table. Nobody can read that count
                  - it is one face-down card on both boards - so a rejected number is
                  the only way the player would learn the ceiling.
     EITHER_DECK  whichever deck the gesture is being made on. *Draw X* and *Reveal
                  Top X* exist on both halves, and each is bounded by the deck it was
                  asked of: the caller hands over the one it holds, because in solo
                  the far half is drawn from and revealed from as well.

     and a number is the third thing: only `damage` has one, and it is a bound on the
     input rather than a rule. The app carries no hit points, so there is nothing to
     derive it from. See DAMAGE_MAX.

   **These are the maxima, not the defaults.** The dialog opens empty, as it always
   has; nothing here fills it in.
*/
const OWN_DECK = 'ownDeck'
const THEIR_DECK = 'theirDeck'
const EITHER_DECK = 'eitherDeck'

/*
   The ceiling on damage, and the only ceiling in this table that is written down
   rather than read off a deck.

   There is no rule to derive it from: nothing in this app reads a card's HP, and
   damage here is a number a player types to keep the table honest rather than
   something the app computes. So this bounds the *input*, and it sits well above the
   game - the largest HP ever printed is a few hundred, and a Pokemon that has taken
   more than it has is already knocked out, so nothing legitimate comes close. What it
   is for is the typo: a fat-fingered `999999` shared to the other board as damage.
*/
const DAMAGE_MAX = 999

export const NUMBER_ASKS = {
   draw: { question: 'Draw how many cards?', type: 'cards', min: 1, max: EITHER_DECK, maxHint: false },
   /* *View Top X* on the player's own deck: a private pick off the top, into the selection */
   viewTop: { question: 'Look at how many cards?', type: 'cards', min: 1, max: OWN_DECK, maxHint: false },
   /* *View Top X* on the opponent's deck: a Look, which is that same reading of theirs */
   lookTop: { question: 'Look at how many cards from the top?', type: 'cards', min: 1, max: THEIR_DECK, maxHint: true },
   revealTop: { question: 'Reveal how many cards from the top?', type: 'cards', min: 1, max: EITHER_DECK, maxHint: true },
   reorderTop: { question: 'Reorder how many cards from the top?', type: 'cards', min: 1, max: OWN_DECK, maxHint: false },
   discardTop: { question: 'Discard how many cards from the top of your deck?', type: 'cards', min: 1, max: OWN_DECK, maxHint: false },
   discardTheirTop: { question: 'Discard how many cards from the top of the opponent\'s deck?', type: 'cards', min: 1, max: THEIR_DECK, maxHint: true },
   /* the one row that is not a count of cards: 0 is a value, so the floor is 0 */
   damage: { question: 'How much damage is on the Pokémon?', type: 'damage', min: 0, max: DAMAGE_MAX, maxHint: true }
}

/*
   Which deck a row is bounded by, for the call site that has to answer it. Exported
   as the set rather than as a function, because what a deck *is* - a `player.js`
   store, a mirror, the far half in solo - is the call site's business and not this
   module's.
*/
export const DECK_MAX = { OWN_DECK, THEIR_DECK, EITHER_DECK }

/*
   What a row asks for at most, given the deck it is bounded by - or `Infinity` for a
   row with no ceiling.

   The count is read off the deck itself, so a prompt cannot ask for more cards than
   the deck holds: "reveal 10" on a deck of three is a request the deck cannot answer,
   and the table says so before the store has to refuse it.
*/
export function maxForAsk (id, decks = {}) {
   const row = NUMBER_ASKS[id]
   if (!row) throw new Error(`no number ask is registered as "${id}"`)

   if (row.max === null) return Infinity
   if (row.max === OWN_DECK) return decks.own ?? Infinity
   if (row.max === THEIR_DECK) return decks.theirs ?? Infinity
   /* an either-deck row takes whichever deck the caller is holding */
   if (row.max === EITHER_DECK) return decks.own ?? decks.theirs ?? Infinity

   /* the one row whose ceiling is a number: damage, and it does not need a deck */
   return row.max
}

/*
   Ask for one of those numbers, and answer with a number the gesture can use or
   with `null` for "there is nothing to do".

   `decks` is what answers a row's `max`, and it is the caller's to give because only
   the caller knows which stores it is holding: `{ own: 47, theirs: 12 }` from the two
   halves. A row with no ceiling ignores it, and so does a call site that does not pass
   it - the bound is then absent rather than wrong.

   One answer for the three ways a prompt comes back without a number, and they are
   the reason this exists rather than a table alone:

     - **cancel** is refused, and it is the one that has to be read deliberately:
       `Number(null)` is **0**, so a floor of 0 - the damage row - would have taken a
       cancelled prompt as "set the damage to zero". Nothing was asked is not a value.
     - **an empty box** is refused for a count, and is 0 for damage, which is what it
       did before there was a table.
     - **anything unreadable** is refused. It used to travel straight into
       `slot.damage.set(NaN)` and onto the relay, where the other board drew it.

   A number above the ceiling is **brought down to it** rather than refused, and that
   is a judgement worth stating: asking to reveal 10 of a 3-card deck is a player
   reaching past the end of the deck, and the honest reading of that gesture is "all of
   them" - which is what the stores already did quietly (`draw` stops when the deck
   runs out, `topCount` takes `Math.min`). What the ceiling adds is that the number the
   *log line* reports is the number that happened, instead of a count nobody drew.

   So an unknown id is the only thing here that throws. It is a typo in this
   repository rather than anything a player can do, and three other spellings of
   "nothing was asked" would hide it: a `{ question: undefined }` prompt is a dialog
   that says `undefined` and a gesture that silently does nothing.
*/
/*
   The dialog that asks, registered by `NumberPrompt.svelte` rather than imported.

   The same direction `reveal.js` uses for the piles it must not import, and for the
   same reason: this module holds the questions and their bounds, and that is data
   worth being able to test with no component and no browser (`tools/ask-check.mjs`
   does exactly that). Importing the component here would make a table of data depend
   on Svelte, a stylesheet and a browser.
*/
let dialog = null

export function registerNumberDialog (next) {
   dialog = next
}

/*
   Ask for one of those numbers, and answer with a number the gesture can use or with
   `null` for "there is nothing to do".

   It is `async` because the question is put by a dialog of ours rather than by the
   browser, and a dialog is a thing that comes back later. Every caller awaits it.

   `decks` is what answers a row's `max`, and it is the caller's to give because only
   the caller knows which stores it is holding: `{ own: 47, theirs: 12 }` from the two
   halves. A row with no ceiling ignores it, and so does a call site that does not pass
   it - the bound is then absent rather than wrong.

   One answer for the ways a prompt comes back without a number, and they are the
   reason this exists rather than a table alone:

     - **cancel** is refused, and it is the one that has to be read deliberately: a
       floor of 0 - the damage row - must not take "nothing was asked" as "set the
       damage to zero". Nothing was asked is not a value.
     - **anything unreadable** is refused. It used to travel straight into
       `slot.damage.set(NaN)` and onto the relay, where the other board drew it. The
       dialog no longer lets it be typed at all, so this is the second line of it.

   A number above the ceiling is **brought down to it** rather than refused, and that is
   a judgement worth stating: asking to reveal 10 of a 3-card deck is a player reaching
   past the end of the deck, and the honest reading of that gesture is "all of them" -
   which is what the stores already did quietly (`draw` stops when the deck runs out,
   `topCount` takes `Math.min`). What the ceiling adds is that the number the *log line*
   reports is the number that happened, instead of a count nobody drew.

   So an unknown id is the only thing here that throws. It is a typo in this repository
   rather than anything a player can do, and other spellings of "nothing was asked"
   would hide it: a `{ question: undefined }` prompt is a dialog that says `undefined`
   and a gesture that silently does nothing.
*/
export async function askForNumber (id, decks = {}) {
   const prompt = NUMBER_ASKS[id]
   if (!prompt) throw new Error(`no number ask is registered as "${id}"`)

   /*
      A missing dialog is a wiring fault, not a player's - and it is worth throwing for
      rather than answering `null`, which would be every count on the board silently
      doing nothing with the page looking perfectly healthy.
   */
   if (!dialog) throw new Error('no number dialog is registered - is NumberPrompt mounted?')

   const max = maxForAsk(id, decks)
   const answer = await dialog.ask({ ...prompt, max })

   /* cancel, or a dialog that closed without an answer */
   if (answer === null || answer === undefined) return null

   const parsed = Number(answer)

   /* `Number.isFinite` and not `isNaN`: it is what keeps Infinity and NaN out together */
   if (!Number.isFinite(parsed)) return null

   /* half a card is not a card: a count is a whole number, and 2.5 becomes 2 */
   const value = prompt.type === 'cards' ? Math.trunc(parsed) : parsed

   /*
      The floor is checked before the ceiling, and the order matters: a cleared deck has
      a ceiling of zero, and clamping "draw 5" up against it would answer 0 - a gesture
      the caller would then run, doing nothing. Asking for more cards than a deck holds
      is "all of them"; asking anything of an empty deck is nothing to do.
   */
   if (value < prompt.min) return null

   const within = Math.min(value, max)
   if (within < prompt.min) return null

   return within
}
