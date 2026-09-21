<script>
   import { getContext } from 'svelte'
   import { cardImage } from '$lib/util/assets.js'
   import { holdingCtrlOrCmd } from '$lib/util/ctrlcmd.js'
   import { dnd } from '$lib/dnd/actions.js'
   import { draggedCard, source } from '$lib/dnd/store.js'
   import { dragging } from '$lib/dnd/pointer.js'
   import cardback from '$lib/assets/cardback_int.png'

   import { cardSelection as selection, selectCard } from '$lib/stores/player.js'
   import { logPrizeLook } from '$lib/stores/logger.js'
   const { openDetails, openCardMenu } = getContext('boardActions')

   export let card
   export let pile
   export let revealed = true

   /*
      A card marked for a placement, and where it sits in that placement.

      A search ends by putting cards back in a chosen order, and the order is the
      whole of what the player is deciding: the badge is that order (1 is the top
      of the deck), so a marked card can be read as a position rather than only as
      "chosen". `markedIndex` is null for a card that is not marked.
   */
   export let marked = false
   export let markedIndex = null
   export let onMark = null

   /*
      Marking replaces the selection's meaning for this card: a grid that is
      ordering cards does not also want a selection, and `pile` here is the deck,
      which is exactly the pile `selectCard` refuses to see as a "selection pile"
      in the inspection dialog. So when the parent brings a marking handler, the
      click marks and nothing else. The drag handlers are left alone - a card
      being dragged is a card being moved somewhere, which is a different board.
   */
   function onMarkClick (e) {
      e.stopPropagation()
      onMark(card)
   }

   /*
      Double clicking a card shows it, which for a face-down prize is a look at one
      nobody has taken - the same look the menu's Show Details and the space bar
      take, so it says the same thing in the log. Every other pile a player can show
      themselves is either face up already or their own hand, which is not news.
   */
   function onDetails () {
      logPrizeLook(pile, revealed)
      openDetails(card)
   }

   function onDragStart () {
      draggedCard.set(card)
      source.set(pile)
   }

   function onDrag ({ $card }) {
      if ($card !== card) return
      if (!$selection.includes(card)) {
         selectCard(card, pile, false)
      }
   }

   const dndConfig = {
      start: onDragStart,
      drag: onDrag
   }

   function onClick (e) {
      // further up is a click listener that reset the selection, so stop that
      e.stopPropagation()

      selectCard(card, pile, holdingCtrlOrCmd(e)) // if ctrl is pressed, add to selection instead of overwriting
   }

   function onCtx (e) {
      e.stopPropagation() // to not get overridden by the pile level context menu

      if (!$selection.includes(card)) {
         selectCard(card, pile, false)
      }

      /*
         The pile goes with it, because a card in a pile's *view* is a card whose
         menu finishes the view when one of its entries is taken (see
         Board.svelte's openCardMenu). A card on the board passes the same pile and
         nothing comes of it: there is no view open over the board's own zones.
      */
      openCardMenu(e.clientX, e.clientY, revealed, pile)
   }

</script>

<div
   on:click={onMark ? onMarkClick : onClick}
   on:contextmenu={onCtx}
   on:dblclick={onDetails}
   class="relative border-2 border-transparent rounded-md"
   class:dragged={$dragging && $selection.includes(card)}
   class:selected={$selection.includes(card)}
   class:marked
   use:dnd={dndConfig}>

   {#if revealed}
      <img class="card" src="{cardImage(card, 'xs')}" alt="{card.name}" draggable=false>
   {:else}
      <img class="card" src={cardback} alt="Hidden Card" draggable=false>
   {/if}

   {#if marked}
      <!-- the card's place in the order being built, 1 being the top of the deck -->
      <span class="mark" aria-label="position {markedIndex}">{markedIndex}</span>
   {/if}
</div>

<style>
   .selected {
      @apply border-[var(--selection-color)];
      --shadow-color: transparent;
   }

   /*
      Marked is its own colour rather than the selection's: a card in a placement
      is not a card selected on the board, and the two can be on screen together.
   */
   .marked {
      @apply border-[var(--primary-color)];
      --shadow-color: transparent;
   }

   /*
      Inside the card, not over its edge: a pile inspection is a scroll container
      (see Popup.svelte), and `overflow-y: auto` clips horizontally too - whose
      value is never visible - so a badge hanging off the corner of a card would
      simply not be drawn.
   */
   .mark {
      @apply absolute top-1 right-1 px-2 py-1 rounded-full font-bold text-[var(--bg-color-zero)] bg-[var(--primary-color)];
   }
</style>