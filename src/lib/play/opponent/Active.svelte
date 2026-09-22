<script>
   import Slot from './Slot.svelte'
   import { defaultOpponent } from '$lib/stores/opponent.js'
   import { dnd } from '$lib/dnd/actions.js'
   import { source, draggedCard } from '$lib/dnd/store.js'
   import { cardSelection, resetSelection, selectionByPile } from '$lib/stores/player.js'
   import { solo, soloCardToPlay, soloSlotToActive, onOpponentHalf, onOpponentSlot } from '$lib/stores/solo.js'
   import { dropRevealedCard, isDraggingRevealed, OPP_ACTIONS } from '$lib/stores/oppAction.js'

   /* which player's board this component shows */
   export let store = defaultOpponent
   $: ({ active } = store)

   /*
      In solo a card dragged from the far half can be put in its Active spot - the
      same drop the player's own Active accepts - and so can one of its Pokemon in
      play, which promotes it and sends the Active to the Bench. Only that half's
      own either way: nothing crosses between the halves.

      A card out of a Reveal or a Look is the third gesture: it is not on the board, so
      the drop is a request to its owner (`dropRevealedCard`), and the Active spot is
      the one zone that is not a pile - which is why this is handled here as well as in
      `opponent/Pile.svelte`.
   */
   const allowDrop = () =>
      isDraggingRevealed($draggedCard, $source) ||
      Boolean($solo && (
         onOpponentHalf($source) ||
         ($source === 'slot' && onOpponentSlot($draggedCard))
      ))

   function onDrop () {
      if (dropRevealedCard(store.active, $draggedCard, $cardSelection)) {
         resetSelection()
         return
      }

      if (!$solo) return

      if ($source === 'slot') {
         if (onOpponentSlot($draggedCard)) soloSlotToActive($draggedCard)
         resetSelection()
         return
      }

      if (!onOpponentHalf($source)) return

      /*
         That half's own cards, out of the pile each of them is in: a selection
         there can hold cards from several of its zones (see selectionByPile in
         player.js). The first card of the selection is the one promoted - only one
         Pokemon can be Active - and the rest go to the Bench.
      */
      const first = $cardSelection[0]

      for (const [ from, group ] of selectionByPile(store.piles())) {
         for (const card of group) soloCardToPlay(from, card, card === first ? 'active' : 'bench')
      }

      cardSelection.clear()
   }

   const dndConfig = { drop: onDrop, allowDrop }
</script>

<div use:dnd={dndConfig}>
   <div class="active-slot h-full flex justify-center items-center">
      {#if $active}
         <Slot bind:slot={$active} {store} />
      {/if}
   </div>
</div>

<style>
   /* the near half's active spot, and the arithmetic for it: board/Active.svelte */
   .active-slot {
      --slot-card-width: min(
         calc(100cqw - 2 * var(--card-gap)),
         calc((100cqh - 2 * var(--card-gap)) * var(--slot-card-share) * var(--card-ratio))
      );
      /* the room beside a centred card, which is what a fan of any length is drawn in */
      --slot-fan-room: calc((100cqw - var(--slot-card-width) - 2 * var(--card-gap)) / 2);
   }

   .active-slot > :global(.slot) {
      margin-top: var(--attach-lift, 0px);
      /* no room for the fan in the flow, and the fan's steps divide the room above
         between them, so the Pokemon keeps the place a lone card has and the fan stays
         inside the zone (see board/Active.svelte) */
      --slot-fan-reserve: 0px;
      --slot-fan-step-energy: min(var(--slot-step-energy), calc(var(--slot-fan-room) / var(--slot-fan-count)));
      --slot-fan-step-tool: min(var(--slot-step-tool), calc(var(--slot-fan-room) / var(--slot-fan-count)));
   }
</style>
