<script>
   import { getContext } from 'svelte'
   import { cardImage } from '$lib/util/assets.js'
   import cardback from '$lib/assets/cardback_int.png'
   import { solo } from '$lib/stores/solo.js'
   import { spectating } from '$lib/stores/connection.js'
   import { dnd } from '$lib/dnd/actions.js'
   import { draggedCard, source } from '$lib/dnd/store.js'
   import { dragging } from '$lib/dnd/pointer.js'
   import { holdingCtrlOrCmd } from '$lib/util/ctrlcmd.js'
   import { cardSelection as selection, selectCard } from '$lib/stores/player.js'
   import { windows, isActionable } from '$lib/stores/reveal.js'
   import { pinged, pingedCard } from '$lib/stores/ping.js'

   const { openDetails, openOppCardMenu, openOppCardActionMenu, openOppCardPingMenu } = getContext('boardActions')

   export let card
   export let pile
   export let revealed = true

   /*
      Whether this card may be acted on as the other player's.

      Two different situations answer yes, and they are the two ways this half is
      somebody the player can play for:

         - **solo**, where the far half is the same person's - the whole half is
           played from this keyboard, which is why its zones are draggable there
         - **a Reveal, a Look or a Reveal Hand**, where the cards of the other half's
           pile have been shown to this player on purpose, which is the "allowed to
           take action on this opponent card" property (see docs/reveal.md)

      Nothing else does. A card of the other half's that is merely visible - a
      Stadium in play, a Pokemon on the Bench, the cards of a hand whose window is
      open over it - is not this player's to touch, and the check is the batch
      *and the pile the card is being carried by*: a window hands its cards the
      batch, every zone of this board hands the zone, and the rule refuses one
      carrying the other. That is what keeps the permission inside the window, and
      it needs no flag written onto the card - a flag would follow the card onto
      its owner's own board, where it would offer the opponent's menu for their own
      card. The answer lives in a store (`reveal.js`) rather than on the card
      object.

      **`$windows` is not decoration, and it is the second half of the same
      lesson.** `isActionable` reads the batches, their views and the record of
      what has been spent itself, so a statement that only called it would have no
      inputs a compiler can see: it would compile to one about `card` and `pile`,
      run once when the card was created, and keep that answer for the card's whole
      life. Read the store, so a window opening, closing, or changing what it shows
      re-asks the question (the note over `windows` in reveal.js has the report).
   */
   $: actionable = $solo || isActionable(card, pile, $windows)

   /*
      A player may look at the far half's cards wherever they are on show - a Pokemon
      in play, a Stadium, a card played to the table, a card in a pile that is public,
      and a card a Reveal, a Look or a Reveal Hand has shown them - and not at what is
      hidden: the opponent's hand and their prizes, which are drawn as card backs. A
      double click must not be a way round that. A spectator, and solo, may open
      anything: nothing there is a secret from them.

      **What says so is `revealed`, and it is the only thing that can.** The rule used
      to be asked of `actionable`, which is the permission a *window* hands a card -
      and since that permission became "the card as the window carries it" (see
      `isActionable` in reveal.js) a card lying in a zone of the far half is not
      actionable at all, in a room, however visible it is. So the check refused every
      card the far half draws: double clicking the opponent's Stadium or a card they
      played to the table did nothing at all, which is what was reported - *"a player
      should be able to double click on an opponent's card in both the Stadium Zone and
      Table Zone for the Show Details function"*. It had in fact been dead for longer
      than that, and invisibly: `hidden` below it was unreachable, because a card that
      is actionable is one a window is carrying and a window's pile is never the hand.

      `revealed` is the same fact the card's own `<img>` is drawn from - one line below
      in this component, and `$prizesFlipped` or `$handRevealed` where the two hidden
      zones pass it - so a card that is drawn face up is exactly a card that may be
      read, and a prize the owner has turned up is one the table can already see. That
      is the rule `opponent/Slot.svelte` states for a Pokemon in play (*"it is on the
      table, not in a hand"*), and this is the same rule for the cards that are not in
      a slot.
   */
   function onDetails () {
      if ($spectating || $solo) {
         openDetails(card)
         return
      }

      if (!revealed) return

      openDetails(card)
   }

   /*
      Dragging is the far half's own gesture, and in solo it carries a card of that
      half's between its zones.

      A card a Reveal or a Look is showing is the *other* entry: it is not on the board
      at all, so dragging it has nowhere of this board's to land - it is a request to its
      owner, exactly as a menu entry is, and the far half's zones are what take it
      (`opponent/Pile.svelte`, `opponent/Active.svelte`). So a dragged revealed card sets
      the same two stores, and the batch it came from travels as the source because that
      is what the drop needs to find the card on this board's mirror.
   */
   function onDragStart () {
      if ($solo) {
         draggedCard.set(card)
         source.set(pile)
         return
      }

      if (!actionable) return
      draggedCard.set(card)
      source.set(pile)
   }

   function onDrag ({ $card }) {
      if ($card !== card) return
      if (!$solo && !actionable) return
      if (!$selection.includes(card)) selectCard(card, pile, false)
   }

   const dndConfig = { start: onDragStart, drag: onDrag }

   function onClick (e) {
      if (!actionable) return
      /* further up is a click listener that resets the selection, so stop that */
      e.stopPropagation()
      selectCard(card, pile, holdingCtrlOrCmd(e))
   }

   function onCtx (e) {
      if (!pile) return

      /*
         A card of theirs this player may **not** act on is still a card this player may
         point at, and that is most of their board: this component draws three zones of it -
         the hand, the prizes and their Stadium - and every card in them is a card the ping
         menu is for (see `OppCardPingMenu.svelte`; the fourth is the table, which
         `opponent/Temp.svelte` draws and offers the same entry on). It is asked for *first*
         because it is the one menu here that needs nothing else to be true - no window, no
         permission, no selection.

         **`pile.pingable` is the second half of the question, and it is not decoration.**
         This component draws a card of theirs in two situations, and only one of them is a
         zone a ping belongs on: a card lying in a zone, and every card of one of their
         *piles* opened as a view (`OppInspection.svelte` - the deck, the discard and the
         lost zone, where the whole pile is on screen and a card's position is the one
         thing a pile does not show). The marker answers that per zone rather than by a
         list of names here, and it answers for a spectator's mirror too (see the marking
         in `opponent.js`).

         **The selection is deliberately left alone on this path, and that is a rule
         rather than an omission.** Every other branch below picks the card up first,
         because every other menu speaks for what is picked up. A card of the opponent's
         in this board's own selection is a card the board's own keys then act on - Space
         opens the details of the selected card, and *the details of one of their hidden
         cards* is exactly the read this half must not offer - so a gesture that only
         points at a card must not put it in a selection. Nothing else on this path needs
         one: `pingCard` takes the card it is handed.
      */
      if (!$solo && !actionable) {
         if (!pile.pingable) return

         e.preventDefault()
         e.stopPropagation()
         openOppCardPingMenu(e.clientX, e.clientY, card, revealed)
         return
      }

      if (!actionable) return
      e.preventDefault()
      e.stopPropagation()
      if (!$selection.includes(card)) selectCard(card, pile, false)

      /*
         Two menus, and the situation picks between them: in solo the far half is
         played from this board, so it is the player's own menu's entries with the
         cards landing on that half (`OppCardMenu`). In a room the card belongs to
         somebody else, so every entry is a request to them - the menu for a card
         the player is *allowed* to act on (`OppCardActionMenu`).

         The pile goes with it, and it is what tells the menu where the card is:
         on the board it is one of the far half's own lists, and in a Reveal or a
         Look it is the batch those windows hand over (see `reveal.js`) - which
         `oppAction.js` recognizes by asking the board's own `piles()`, the same
         way every other "which pile is this card in" is answered.
      */
      if ($solo) openOppCardMenu(e.clientX, e.clientY, pile, card, revealed)
      else openOppCardActionMenu(e.clientX, e.clientY, card, revealed, pile)
   }
</script>

<!--
   `relative` is not decoration here: a pinged card is raised over its neighbours (see
   `.pinged` in global.css), and a `z-index` on a *static* box is quietly ignored. A card
   in a hand row is a flex item and would be honoured either way, but the same component
   draws a card of a pile view and a prize, which are neither.
-->
<div
   on:click={onClick}
   on:contextmenu={onCtx}
   on:dblclick={onDetails}
   class="relative border-2 border-transparent rounded-md"
   class:dragged={$dragging && $selection.includes(card) && ($solo || actionable)}
   class:selected={actionable && $selection.includes(card)}
   class:pinged={pingedCard($pinged, card, 'far')}
   use:dnd={dndConfig}>
   {#if revealed}
      <img class="card" src="{cardImage(card, 'xs')}" alt="{card.name}" draggable=false>
   {:else}
      <img class="card" src={cardback} alt="Hidden Card" draggable=false>
   {/if}
</div>

<style>
   /*
      The same two states the player's own cards use, and the same colours: a
      selection is `--selection-color` wherever it is (see board/Card.svelte), which
      is what every other selected thing on either half draws with. This used to be
      `--primary-color` here - the accent the board uses for a *marked* card, a
      different idea - so a card selected on the far half was picked out in the
      wrong colour, and did so under a comment claiming the two halves matched.
   */
   .selected {
      @apply border-[var(--selection-color)];
      --shadow-color: transparent;
   }

   .dragged {
      opacity: 0.5;
   }

   /*
      There is deliberately no `.actionable` rule here, and the absence is the note.

      A card this player may act on used to be picked out where it lies: a 2px
      `--primary-color` outline whose *colour* breathed on a 1.8s loop, drawn as an
      outline so it cost no room and could sit beside the selection ring. It was the
      affordance for the permission - a card that can be clicked looks exactly like one
      that cannot, and a Reveal's cards are the other player's, so the default assumption
      is that they are inert.

      It was removed for two reasons, and the first is a rule rather than a preference:
      the *permission* it advertised was wrong. A card moved to the owner's hand stayed
      actionable - the batch still held its id and the hand is a pile a window is a live
      view of - so the outline said "you may still move this" about a card that had been
      moved, which is how it was reported (*this shouldn't be happening*). That is fixed
      where it belongs, in `isActionable` (`spentIds` in reveal.js), and it is fixed for
      every window rather than for the one that was looked at.

      The second is that a card that is *always* glowing is a card that never reads as
      chosen, and in solo the whole far half glows - so the animation was asking to be
      mistaken for the selection ring. The windows say what a click does in words instead
      (`Look.svelte`, `HandReveal.svelte`), which is the feedback that does not need a
      loop to be noticed.

      **The pinged card is the other kind of glow and it is not this one back again.**
      `class:pinged` above is a card this player has *pointed at* - a ping lasts two
      seconds and is over, it is amber rather than the selection's blue, and it is drawn
      on the cards this half refuses to act on at all as well as on the ones it allows
      (see `.pinged` in global.css, and `stores/ping.js`, which is the clock). So it is
      not an affordance: nothing about the card changes, and there is no state to be
      mistaken for a selection, because it is gone by the time a player could look twice.

      Which card it lights is `pingedCard`, and `'far'` is this half of the question: ids
      are handed out per board, so the same id names a card of the player's and a card of
      the opponent's, and the half is what tells the two apart on one screen.
   */
</style>
