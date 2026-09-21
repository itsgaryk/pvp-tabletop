<script>
   import { getContext } from 'svelte'
   import { cardImage } from '$lib/util/assets.js'
   import cardback from '$lib/assets/cardback_int.png'
   import { solo } from '$lib/stores/solo.js'
   import { spectating } from '$lib/stores/connection.js'
   import { defaultOpponent } from '$lib/stores/opponent.js'
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
      A player may look at the far half's cards where they are on show - a Pokemon
      in play, a Stadium - but not what is in its hand or its prizes. Those are
      hidden for a reason, and a double click must not be a way round it. A
      spectator, and solo, may open anything: nothing there is a secret from them.
   */
   function onDetails () {
      if ($spectating || $solo) {
         openDetails(card)
         return
      }

      const hidden = pile === defaultOpponent.hand || pile === defaultOpponent.prizes
      if (!hidden) openDetails(card)
   }

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
      /* the card's own face, so the far half's menu can ask the one log rule */
      openOppCardMenu(e.clientX, e.clientY, pile, card, revealed)
   }
</script>

<div
   on:click={onClick}
   on:contextmenu={onCtx}
   on:dblclick={onDetails}
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
</style>
