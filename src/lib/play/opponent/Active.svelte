<script>
   import Slot from './Slot.svelte'
   import { defaultOpponent } from '$lib/stores/opponent.js'
   import { dnd } from '$lib/dnd/actions.js'
   import { source, draggedCard } from '$lib/dnd/store.js'
   import { cardSelection, resetSelection, selectionByPile } from '$lib/stores/player.js'
   import { solo, soloCardToPlay, soloSlotToActive, onOpponentHalf, onOpponentSlot } from '$lib/stores/solo.js'

   /* which player's board this component shows */
   export let store = defaultOpponent
   $: ({ active } = store)

   /*
      In solo a card dragged from the far half can be put in its Active spot - the
      same drop the player's own Active accepts - and so can one of its Pokemon in
      play, which promotes it and sends the Active to the Bench. Only that half's
      own either way: nothing crosses between the halves.
   */
   const allowDrop = () => $solo && (
      onOpponentHalf($source) ||
      ($source === 'slot' && onOpponentSlot($draggedCard))
   )

   function onDrop () {
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
   }

   .active-slot > :global(.slot) {
      margin-top: var(--attach-lift, 0px);
   }
</style>
