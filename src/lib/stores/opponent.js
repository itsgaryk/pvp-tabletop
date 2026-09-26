import { writable } from 'svelte/store'

import { board } from './custom/board.js'
import { slot } from './custom/cards.js'
import { socket, myId, seatedPlayers } from './connection.js'
import { fromRelay } from './timer.js'
import { discardStadium } from './player.js'
import { registerTheirDeck } from './reveal.js'
import { normalizeStatus } from '$lib/util/status.js'
import { normalizeMarkerUsed } from '$lib/util/markers.js'

/* every mirror ever created, so relay events can reach the right ones */
const instances = new Set()

/*
   A read-only mirror of one player's board.

   Most clients only mirror one player, but a spectator mirrors two, so the
   store is a factory rather than a single module-level board: each instance
   tracks the player it belongs to and ignores events aimed at anyone else.
   The instance matching "the other player" is exported at the bottom for the
   normal two-player view.
*/
export function createOpponent () {
   const b = board()

   const { cards, deck, hand, prizes, discard, lz,
      bench, active, stadium, table, pickup,
      powerMarker, powerMarkerUsed,
      turn,
      timer,
      prizesFlipped, handRevealed, pokemonHidden,
      reset, findSlot } = b

   /* which player this mirror belongs to; null means "whoever is not me" */
   let clientId = null

   /*
      Whether relayed events may land in this mirror at all. A spectator builds
      two mirrors for the players it watches but also leaves the normal
      two-player mirror alive (it is created at module level and never unmounts);
      that idle mirror would collect both players' cards into the same slots.
      Switching it off keeps the state on screen the only state in play.
   */
   let enabled = true

   const reload = (deckList) => {
      cards.set(deckList)
      reset()
   }

   /*
      A mirror can legitimately be missing a card (events applied out of order,
      or a mirror that is not the one on screen). `pile.remove` does
      `splice(indexOf(card), 1)`, which with an absent card becomes
      `splice(-1, 1)` and silently deletes the last entry - so never call it
      with nothing, and never push a missing card into a pile.
   */
   const removeCard = (id, pile) => {
      if (!pile) return null

      const card = pile.get().find(c => c._id === id)
      if (!card) return null
      pile.remove(card)
      return card
   }

   const moveCards = (ids, source, target) => {
      if (!target) return
      for (const id of ids) {
         const card = removeCard(id, source)
         if (card) target.push(card)
      }
   }

   /*
      A card the event names that this board does not hold.

      A mirror is handed cards in two ways - a full board state, and the moves that
      follow - and a card can be named by a move *before* anything has told this board
      it exists: a placement that puts a card onto a deck from a zone whose move this
      board never saw. `removeCard` answers nothing for it, and the caller has to
      decide between dropping it (which loses the card from the mirror for good) and
      placing a stand-in, which is what `placeOrdered` needs to put the block in the
      right order. The stand-in carries the id and nothing else, so it is a card-shaped
      placeholder rather than a card: a full board state replaces it, and until then it
      is what keeps the deck's *count* honest.

      Only a caller that is putting a card *into* a pile uses this. A move between two
      zones this board can see must not invent cards, or a stale event would grow the
      board.
   */
   const missingCard = (id, pile) => ({ _id: id, name: null, _placeholder: true, _pile: pile?.name || null })

   const removeSlot = (s) => {
      if (!s) return
      if (active.get() === s) active.set(null)
      else bench.remove(s)
   }

   /* helper */

   const slotRegex = /^([0-9a-z-]{36}).(pokemon|trainer|energy)$/i

   function getPile (name) {
      let regexRes = null

      if (name === 'hand') return hand
      else if (name === 'deck') return deck
      else if (name === 'prizes') return prizes
      else if (name === 'discard') return discard
      else if (name === 'lz') return lz
      else if (name === 'table') return table
      else if (name === 'pickup') return pickup

      else if (regexRes = slotRegex.exec(name)) {
         const id = regexRes[1]
         const type = regexRes[2]
         const s = findSlot(id)
         /* a slot we do not have yet - return nothing rather than throwing */
         return s ? s[type] : null
      }

      else if (name === 'stadium') return stadium
   }

   function applyBoardState ({ cards: list, board: state }) {
      reload(list)
      // all cards are in deck now, move them to where they should be

      moveCards(state.hand, deck, hand)
      moveCards(state.prizes, deck, prizes)
      moveCards(state.discard, deck, discard)
      moveCards(state.lz, deck, lz)
      moveCards(state.table, deck, table)

      const importSlot = (data) => {
         const p = slot(null, data.id)
         moveCards(data.pokemon, deck, p.pokemon)
         moveCards(data.energy, deck, p.energy)
         moveCards(data.trainer, deck, p.trainer)
         p.damage.set(data.damage)
         p.status.set(normalizeStatus(data.status))
         p.abilityUsed.set(Boolean(data.abilityUsed))
         return p
      }

      for (const e of state.bench) bench.add(importSlot(e))
      if (state.active) active.set(importSlot(state.active))

      /*
         The Stadium is a list of that player's own cards in play there. A board
         state from before it held more than one carries a single id, so both
         shapes are read - an older client's event must not throw on the way in.
      */
      const theirStadium = Array.isArray(state.stadium)
         ? state.stadium
         : (state.stadium ? [ state.stadium ] : [])
      moveCards(theirStadium, deck, stadium)

      if (state.powerMarker) powerMarker.set(state.powerMarker)
      powerMarkerUsed.set(normalizeMarkerUsed(state.powerMarkerUsed))
      turn.set(Math.max(0, Number(state.turn) || 0))
      /*
         Hiding follows the state, both ways. It used to be one-way - only ever set
         hidden - so a board state that said "shown" left whatever was there, and a
         half could stay hidden long after its owner had shown it.
      */
      pokemonHidden.set(Boolean(state.pokemonHidden))
      if (state.prizesFlipped) prizesFlipped.set(true)
      if (state.handRevealed) handRevealed.set(true)
   }

   /*
      `from` identifies the player an event came from. An instance with no
      assigned player (the normal two-player view, which mirrors exactly one
      opponent) accepts everything; a spectator's instances each take only their
      own player.
   */
   function accepts (from) {
      if (clientId === null) return true
      return from === clientId
   }

   /* Every relay event for this board, already filtered to this player. */
   const handlers = {
      boardState: (data) => applyBoardState(data),
      deckLoaded: ({ deck: list }) => reload(list),
      boardReset: () => reset(),
      cardsMoved: ({ cards: ids, from, to, position, ordered }) => {
         const pile1 = getPile(from)
         const pile2 = getPile(to)
         if (!pile2) return

         /*
            An ordered move is one placement, not a list of cards that happen to
            travel together: `ids` is the deck order the other player chose, and
            it has to land as that order. So the cards are taken out together and
            put back by the same `placeOrdered` the placing client used - the
            per-card loop below would push the top card in first and leave it at
            the wrong end of the array - and one convention covers both sides:
            `ordered[0]` is the top of the deck, which is the end the deck is
            drawn from.

            This is the placement at the end of a search: the ids arrive in the
            order they were chosen, and the rest of the deck shuffles underneath
            them, which no mirror can mirror and none needs to - a deck's order
            is unreadable to everyone but its owner, and a full board state
            carries the order that matters.

            `ids` names cards the *source* pile holds in the placement this was
            written for, where they are already in the deck: the list is not in
            the destination yet, so `placeOrdered` finds nothing to relocate and
            simply puts the block where it belongs.

            A placement can also be a card *joining* the deck - "To Top of Deck"
            on a card in hand, which is an entry of the opponent-card menu - and
            then the id is in neither pile1 nor pile2 of this board yet, because
            this board never saw the card leave. That case used to fall out of
            this branch entirely: `removeCard` answered nothing, the list came out
            empty, and the card simply never arrived - a mirror quietly one card
            short, in a count nobody is shown and a deck nobody can read. So the
            cards this board does not have are not dropped: they are placed, which
            is what `placeOrdered` does with a card it cannot find to relocate.
         */
         if (ordered) {
            const list = ids.map(id => removeCard(id, pile1) || missingCard(id, pile1))
            if (!list.length) return

            pile2.placeOrdered(list, { bottom: position === 'bottom' })

            return
         }

         for (const id of ids) {
            const card = removeCard(id, pile1)
            if (card) pile2.push(card)
         }
      },
      slotsMoved: ({ slots: ids, to }) => {
         const pile = getPile(to)
         if (!pile) return
         for (const id of ids) {
            const s = findSlot(id)
            if (!s) continue
            removeSlot(s)
            pile.merge([...s.trainer.get(), ...s.energy.get(), ...s.pokemon.get()])
         }
      },
      cardsBenched: ({ cards: items, from }) => {
         const pile = getPile(from)
         for (const { cardId, slotId } of items) {
            const card = removeCard(cardId, pile)
            if (!card) continue
            /*
               A card this board has already put into play itself, with a slot id of its
               own: that is the acting player's optimistic move, and it is the same card
               the owner is now naming. The owner's slot is the one to keep, so the
               stand-in goes - without this the board draws two Pokemon holding one card,
               side by side, until the next full board state (see `optimisticMove` in
               oppAction.js, which is the other half of this).
            */
            for (const s of [ ...bench.get() ]) {
               if (s.id !== slotId && s.pokemon.get().some((c) => c._id === card._id)) bench.remove(s)
            }
            bench.add(slot(card, slotId))
         }
      },
      activeBenched: () => {
         const s = active.get()
         if (!s) return
         active.set(null)
         bench.add(s)
      },
      cardPromoted: ({ cardId, slotId, from }) => {
         const card = removeCard(cardId, getPile(from))
         if (!card) return
         /* the same stand-in the Bench handler removes, in the Active spot */
         for (const s of [ ...bench.get() ]) {
            if (s.pokemon.get().some((c) => c._id === card._id)) bench.remove(s)
         }
         const previous = active.get()
         if (previous && previous.id !== slotId && previous.pokemon.get().some((c) => c._id === card._id)) active.set(null)
         else if (previous) bench.add(previous)
         active.set(slot(card, slotId))
      },
      slotPromoted: ({ slotId }) => {
         const pokemon = bench.get().find(s => s.id === slotId)
         if (!pokemon) return
         bench.remove(pokemon)
         if (active.get()) bench.add(active.get())
         active.set(pokemon)
      },
      cardsEvolved: ({ slotId, cards: ids, from }) => {
         const s = findSlot(slotId)
         if (!s) return
         const pile = getPile(from)
         for (const id of ids) {
            const card = removeCard(id, pile)
            if (card) s.pokemon.push(card)
         }
      },
      cardsAttached: ({ slotId, cards: ids, from }) => {
         const s = findSlot(slotId)
         if (!s) return
         const pile = getPile(from)
         for (const id of ids) {
            const card = removeCard(id, pile)
            if (!card) continue
            if (card.card_type === 'trainer') s.trainer.push(card)
            else s.energy.push(card)
         }
      },
      damageUpdated: ({ slotId, damage }) => {
         const s = findSlot(slotId)
         if (s) s.damage.set(damage)
      },
      statusUpdated: ({ slotId, status }) => {
         const s = findSlot(slotId)
         if (s) s.status.set(normalizeStatus(status))
      },
      abilityUpdated: ({ slotId, used }) => {
         const s = findSlot(slotId)
         if (s) s.abilityUsed.set(Boolean(used))
      },
      /*
         The clock they set. It is converted through the same function the shared
         clock uses: `at` arrives on the relay's clock, so a mirror that kept it
         raw would be holding a value in a different clock from the rest of the
         app, and would read as hours out.
      */
      timerUpdated: (state) => timer.set(fromRelay(state)),
      slotDiscarded: ({ slotId }) => {
         const s = findSlot(slotId)
         if (s) removeSlot(s)
      },
      /*
         A card the other player played into the Stadium.

         It joins that player's own cards there - they may have two in play - and
         then this client answers for its own player, whose cards in the Stadium
         go to their discard: playing a card clears the *other* player's out of
         it. That answer is made here rather than by whoever played, because this
         board is the one that knows what its own player had in play - and in solo
         the answer is registered instead, since nothing is relayed (see player.js
         and solo.js).
      */
      stadiumPlayed: ({ cardId, from }) => {
         const card = removeCard(cardId, getPile(from))
         if (!card) return
         /*
            The card the event names may already be in this mirror's Stadium, put there by
            the acting player's optimistic move (see `optimisticMove` in oppAction.js): that
            board moves the card into the far half's Stadium as soon as the entry is taken,
            and this event is the owner saying the same thing. Adding it again would draw
            the same card twice in the shared cell - the seam `dedupeSlot` closes for the
            Bench, closed here for the Stadium, which is a list rather than a slot.
         */
         if (!stadium.get().some((c) => c._id === card._id)) stadium.push(card)
         discardStadium()
      },
      pokemonToggle: ({ hidden }) => pokemonHidden.set(hidden),
      powerMarker: ({ marker }) => powerMarker.set(marker || 'none'),
      powerMarkerUsed: ({ used }) => powerMarkerUsed.set(normalizeMarkerUsed(used)),
      turnChanged: ({ turn: value }) => turn.set(Math.max(0, Number(value) || 0)),
      prizeToggle: ({ flipped }) => prizesFlipped.set(flipped),
      handToggle: ({ revealed }) => handRevealed.set(revealed)
   }

   /*
      Which half each of this board's piles belongs to, marked on the piles themselves.

      A pile store is a plain object and the two boards' piles share every *name* - the near
      half's `discard` and the far half's `discard` are different stores that both call
      themselves `discard`. So "is this pile one of theirs" cannot be answered by the name,
      and a caller holding only a pile - `dropRevealedCard`, deciding whether a drop is a
      card of somebody else's going onto their own side - had nothing to ask it of.

      Non-enumerable, so it cannot turn up in a spread or a `JSON.stringify` of a pile, and
      marked here rather than looked up from a register: the answer travels with the thing
      being asked about, so a spectator's mirror (`createOpponent` again) answers for itself.
   */
   for (const pile of b.piles()) {
      Object.defineProperty(pile, 'theirPile', { value: true, enumerable: false })
   }

   return {
      ...b,
      get clientId () { return clientId },
      set clientId (id) { clientId = id },

      get enabled () { return enabled },
      set enabled (value) { enabled = !!value },

      apply (name, data, from) {
         if (!enabled) return
         if (!accepts(from)) return
         const handler = handlers[name]
         if (handler) handler(data)
      },

      /* the whole board is gone (left the room, opponent retired) */
      clear () {
         reload([])
      },

      /* the board is thrown away entirely, e.g. a spectator leaving */
      dispose () {
         clientId = null
         reload([])
      }
   }
}

/*
   The single mirror used by the normal two-player view. A spectator creates its
   own instances and assigns each one a player.
*/
export const defaultOpponent = createOpponent()

/*
   The mirror's deck, handed to `reveal.js` so a Reveal or a Look can read the far
   half's deck without importing this module - that import would be a cycle
   (player.js imports reveal.js, this imports player.js, so reveal.js importing this
   closes the loop, and a cycle here is a 500 on every page load rather than a subtle
   bug: see the note in connection.js).

   It is one direction only: reveal.js exposes `registerTheirDeck` and this calls it.
   The registration is what reveal.js waits for, and a Reveal or a Look taken before
   it lands has no far deck to read, which is the correct answer rather than an error.

   **It is a function of the looker, and that is what a watcher needs.** A Reveal
   names a half and each board has the same two halves, so one store is enough for
   it. A Look is one player's reading of the other's deck, and a watcher's board
   mirrors *both* players - so "the deck being looked at" is a different mirror
   depending on who took the look, and the answer is a seat rather than a half. The
   seats are the relay's (`setPlayers`), the halves are this board's own, and this
   module is the one that owns both.
*/
/*
   Which deck store a Look by `lookerId` is a view of.

   `null` - and the looker's own member id - is a look this board took, and the
   answer is the single mirror: the same deck every reveal of "theirs" reads. The
   own id is checked here rather than left to the caller because the two boards send
   the same event: a player's own `cardsLooked` comes back through the relay like
   anybody's, and a watcher's board is the only one that has two mirrors to tell
   apart. A player's spectator mirrors exist but are switched off (`seat` in
   `createSpectatorOpponents`), so resolving against them would show an empty window
   and poll for ever - the cards are in the ordinary mirror.

   Any other member id is a look taken by one of the two players a watcher is
   showing, and the answer is the mirror of the seat that player is *not*: a look
   reads the far half of the looker's own board, which is the other seat's deck.
*/
function theirDeckFor (lookerId) {
   if (!lookerId || lookerId === myId.get()) return defaultOpponent.deck

   const players = seatedPlayers.get()
   const index = players.findIndex((player) => player?.id === lookerId)
   if (index === -1) return defaultOpponent.deck

   /*
      The halves a watcher shows are the two seats in order (`setPlayers`), so the
      deck a look is a view of is the other seat's mirror. Which *screen* half that
      mirror is on is the flip's business and not this one's: the batch is resolved
      against the mirror of the seat, so flipping the board moves the window's cards
      with the rest of that player's board rather than leaving them behind.
   */
   return index === 0 ? spectatorOpponents.bottom.deck : spectatorOpponents.top.deck
}

/*
   It is registered after the two spectator mirrors below are built, because
   `theirDeckFor` reaches for them: a function declaration is hoisted, so this could
   sit above them, but the registration is what makes `reveal.js` start asking and
   the mirrors are what it answers with.
*/
registerTheirDeck(theirDeckFor)

/* the default mirror must receive relay events like every other instance */
register(defaultOpponent)

export const {
   cards, deck, hand, prizes, discard, lz,
   bench, active, stadium, table, pickup,
   powerMarker,
   prizesFlipped, handRevealed, pokemonHidden,
   reset, findSlot
} = defaultOpponent

/*
   Which mirror a board component shows is passed down as a `store` prop, so a
   spectator can point each half of the screen at a different player.
*/

function register (instance) {
   instances.add(instance)
   return () => instances.delete(instance)
}

/*
   Spectator mirrors, one per player. Each is registered so relay events reach
   it, and it only accepts events from the player it was given.
*/
/*
   Point one spectator mirror at a player.

   An empty seat switches the mirror off rather than leaving it with
   `clientId === null`, which would mean "accept every player" and mirror the
   other player a second time.
*/
function seat (mirror, id) {
   if (!id) {
      mirror.enabled = false
      mirror.clientId = null
      mirror.clear()
      return
   }

   if (mirror.clientId !== id) {
      mirror.clear()
      mirror.clientId = id
   }
   mirror.enabled = true
}

export function createSpectatorOpponents () {
   const top = createOpponent()
   const bottom = createOpponent()
   register(top)
   register(bottom)
   seat(top, null)
   seat(bottom, null)

   return {
      top,
      bottom,

      /*
         Seat the two players on the two halves of the screen. The relay tells
         us who they are - as { id, name } since the seats carry names now - so
         this is decided up front rather than guessed from whichever board state
         happens to arrive first.
      */
      setPlayers (players) {
         const [first, second] = (players || [])
            .map((player) => player?.id ?? player)
            .filter(Boolean)
         seat(top, first)
         seat(bottom, second)
      },

      clear () {
         seat(top, null)
         seat(bottom, null)
      }
   }
}

export function registerOpponent (instance) {
   return register(instance)
}

/*
   The two mirrors a spectator uses, one per player, created once at module
   level so they are not tied to a component's lifetime.
*/
export const spectatorOpponents = createSpectatorOpponents()

/*
   Which half of a spectator's screen shows which player. Flipping is a local
   view change: it swaps the two mirrors on screen and tells the relay nothing,
   so neither player's own view moves.
*/
export const spectatorFlipped = writable(false)

const RELAY_EVENTS = [
   'boardState', 'deckLoaded', 'boardReset', 'cardsMoved', 'slotsMoved',
   'cardsBenched', 'activeBenched', 'cardPromoted', 'slotPromoted',
   'cardsEvolved', 'cardsAttached', 'damageUpdated', 'statusUpdated',
   'slotDiscarded', 'stadiumPlayed', 'pokemonToggle', 'powerMarker', 'powerMarkerUsed', 'turnChanged', 'timerUpdated', 'prizeToggle', 'handToggle', 'abilityUpdated'
]

for (const name of RELAY_EVENTS) {
   socket.on(name, (data, meta) => {
      /*
         Every mirror is offered every event, and each one decides whether it
         applies. One mirror failing must not stop the others: a spectator keeps
         an unrendered "default" mirror alongside its two real ones, and that
         default accumulates both players' state, so slot lookups fail there
         first. Without this guard its exception starved the mirrors that are
         actually on screen - a trainer attached to a Pokemon in play, for
         example, never reached the spectator's board.
      */
      for (const instance of instances) {
         try {
            instance.apply(name, data, meta?.from)
         } catch (err) {
            console.error(`[opponent] mirror failed to apply "${name}"`, err)
         }
      }
   })
}

socket.on('leftRoom', () => {
   spectatorOpponents.clear()
   spectatorFlipped.set(false)
   /* back to the normal two-player mirror for the next room */
   defaultOpponent.enabled = true
   for (const instance of instances) instance.clear()
})

/* the relay tells us who holds the playing seats; seat them on the two halves */
socket.on('seated', ({ players }) => {
   spectatorOpponents.setPlayers(players)

   /*
      A spectator does not render the normal two-player mirror, but it is never
      unmounted either, so it would quietly collect both players' cards into the
      same slots while the two real mirrors are on screen. Switch it off.
   */
   defaultOpponent.enabled = !socket.spectating
})
