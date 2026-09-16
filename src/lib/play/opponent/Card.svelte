<script>
   import { getContext } from 'svelte'
   import { cardImage } from '$lib/util/assets.js'
   import cardback from '$lib/assets/cardback_int.png'
   import { solo } from '$lib/stores/solo.js'
   import { dnd } from '$lib/dnd/actions.js'
   import { draggedCard, source } from '$lib/dnd/store.js'
   import { dragging } from '$lib/dnd/pointer.js'
   import { holdingCtrlOrCmd } from '$lib/util/ctrlcmd.js'
   import { cardSelection as selection, selectCard } from '$lib/stores/player.js'

   const { openDetails, openOppCardMenu } = getContext('boardActions')

   export let card
   export let pile
   export let revealed = true

   /*
      In solo the other half is yours, so its cards behave like your own: a click
      selects, a drag picks them up, and a right click opens their menu. Online
      none of this is wired - the cards there belong to somebody else - which is
      what the solo guards are for.
   */

   function onDragStart () {
      if (!$solo) return
      draggedCard.set(card)
      source.set(pile)
   }

   function onDrag ({ $card }) {
      if (!$solo || $card !== card) return
      if (!$selection.includes(card)) selectCard(card, pile, false)
   }

   const dndConfig = { start: onDragStart, drag: onDrag }

   function onClick (e) {
      if (!$solo) return
      /* further up is a click listener that resets the selection, so stop that */
      e.stopPropagation()
      selectCard(card, pile, holdingCtrlOrCmd(e))
   }

   function onCtx (e) {
      if (!$solo || !pile) return
      e.preventDefault()
      e.stopPropagation()
      if (!$selection.includes(card)) selectCard(card, pile, false)
      openOppCardMenu(e.clientX, e.clientY, pile, card)
   }
</script>

<div
   on:click={onClick}
   on:contextmenu={onCtx}
   on:dblclick={() => openDetails(card)}
   class="border-2 border-transparent rounded-md"
   class:dragged={$solo && $dragging && $selection.includes(card)}
   class:selected={$solo && $selection.includes(card)}
   use:dnd={dndConfig}>
   {#if revealed}
      <img class="card" src="{cardImage(card, 'xs')}" alt="{card.name}" draggable=false>
   {:else}
      <img class="card" src={cardback} alt="Hidden Card" draggable=false>
   {/if}
</div>

<style>
   /* the same two states the player's own cards use */
   .selected {
      border-color: var(--primary-color);
   }

   .dragged {
      opacity: 0.5;
   }
</style>
