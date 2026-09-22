import { browser } from '$app/environment'

/*
   Development-only handles onto the stores, put on `window` so a browser check can
   ask what the app actually holds instead of inferring it from the DOM.

   Why this exists: a check that reads the board can only see what the board draws,
   and half of what this app is about is invisible in the drawing - which pile a card
   is in, what a window's batch is, whether an event arrived at all. Working that out
   from badges and card counts is possible and it is how every check here started;
   what it cannot do is tell "the card moved to the wrong pile" from "the card did
   not move", because both look like a number that did not change.

   It is a debug window, not an API: nothing in the app imports from it in the other
   direction, every handle is the store itself, and it is behind `browser && dev` so
   a production bundle does not carry it. Add to it freely - the only rule is that it
   stays a *read* of what the app holds rather than a way to change it, because a
   check that drives the game through here is not testing the app's own paths.

      window.__pvp.player.deck.get().length
      window.__pvp.opponent.hand.get()
      window.__pvp.reveal.get()
*/
export async function devDebug () {
   if (!browser || !import.meta.env.DEV) return

   const player = await import('$lib/stores/player.js')
   const opponent = await import('$lib/stores/opponent.js')
   const reveal = await import('$lib/stores/reveal.js')
   const oppAction = await import('$lib/stores/oppAction.js')
   const connection = await import('$lib/stores/connection.js')
   const dnd = await import('$lib/dnd/store.js')
   const { get: dndSource } = await import('svelte/store')

   globalThis.__pvp = {
      player, opponent, reveal, oppAction, connection,
      /*
         What a drag is carrying, which is what a check about a drop has to ask: the
         stores are module state rather than a store on the app's own handle, and "the
         drop did nothing" and "the drag never started" look identical from the DOM.
         `isBatch` is the same test `isDraggingRevealed` makes - a source that is not one
         of the far half's own lists is a window's batch.
      */
      drag: () => {
         const source = dndSource(dnd.source)
         const card = dndSource(dnd.draggedCard)
         return {
            card: card?.name || null,
            cardId: card?._id || null,
            source: source ? (source.name || typeof source) : null,
            isBatch: Boolean(source && !opponent.defaultOpponent.piles().includes(source))
         }
      },
      /* the pile counts the diagnostics panel reads, so a check and the panel agree */
      counts: () => ({
         deck: player.deck.get().length,
         hand: player.hand.get().length,
         discard: player.discard.get().length,
         theirDeck: opponent.defaultOpponent.deck.get().length,
         theirHand: opponent.defaultOpponent.hand.get().length,
         theirDiscard: opponent.defaultOpponent.discard.get().length
      }),
      /*
         Which pile a batch is about, as `{ owner, senderIsMe, cards }`. A reveal is
         applied by two different routes - the revealer's own batch, and the event the
         other board receives - and only one of them may be true of a given client;
         `senderIsMe` is the local half of that answer and never travels.
      */
      batches: () => {
         const batch = (b) => (b ? { owner: b.owner, senderIsMe: b.senderIsMe, pileName: b.pileName, cards: b.cards } : null)
         return {
            reveal: batch(reveal.reveal.get()),
            look: batch(reveal.look.get()),
            revealOpen: reveal.revealOpen.get(),
            lookOpen: reveal.lookOpen.get(),
            ownerHere: reveal.revealOwnerHere(),
            /* which batch is still following its deck - see `watched` in reveal.js */
            watched: reveal.watched(),
            trailed: reveal.trace.length,
            trail: reveal.trace
         }
      },
      /*
         The last request one board made and the last one it answered, so a check can
         tell "the event never arrived" from "it arrived and was refused": the
         refusals in oppAction.js leave no other trace at all.
      */
      lastAction: () => JSON.parse(JSON.stringify(oppAction.trace)),
      /*
         Every event name this client has a listener for, which is what the relay's
         "handled" column reports and what an event arriving with no listener looks
         like from the outside. A name that is absent is an event this board will
         receive and drop without a trace.
      */
      listeners: () => [ ...connection.socket.listeners.keys() ].sort()
   }

   return globalThis.__pvp
}
