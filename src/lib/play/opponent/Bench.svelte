<script>
   import Slot from './Slot.svelte'
   import { defaultOpponent } from '$lib/stores/opponent.js'
   import { ctrlA } from '$lib/actions/customEvents.js'
   import { dnd } from '$lib/dnd/actions.js'
   import { source, draggedCard } from '$lib/dnd/store.js'
   import { cardSelection, resetSelection, selectSlot } from '$lib/stores/player.js'
   import { solo, soloCardToPlay, soloSlotToBench, onOpponentHalf, onOpponentSlot } from '$lib/stores/solo.js'

   /* which player's board this component shows */
   export let store = defaultOpponent
   $: ({ bench, active } = store)

   /*
      In solo a card dragged from the far half can be put on its Bench - the same
      drop the player's own Bench accepts. A Pokemon in play lands here only when
      it is that half's Active, which is the Active being benched, the way your own
      moves between the two spots.
   */
   const allowDrop = () => $solo && (
      ($source === 'slot' && onOpponentSlot($draggedCard) && $draggedCard === $active) ||
      ($source !== 'slot' && onOpponentHalf($source) && !$bench.includes($source))
   )

   function onDrop () {
      if (!$solo || !$source) return

      if ($source === 'slot') {
         if (onOpponentSlot($draggedCard)) soloSlotToBench($draggedCard)
         resetSelection()
         return
      }

      for (const card of [ ...$cardSelection ]) {
         soloCardToPlay($source, card, 'bench')
      }
      cardSelection.clear()
   }

   const dndConfig = { drop: onDrop, allowDrop }

   /* the keyboard's select-all, the same one the player's own Bench answers to */
   function selectAll () {
      if (!$solo) return

      resetSelection()
      for (const slot of $bench) {
         selectSlot(slot, true)
      }
   }
</script>

<div class="p-1 flex items-center focus:outline-none" tabindex="0"
   use:dnd={dndConfig}
   use:ctrlA on:ctrlA={selectAll}>
   <div class="p-1 flex gap-[var(--scaled-rem)] min-w-0">
      {#each $bench as slot (slot.id)}
         <Slot bind:slot={slot} {store} />
      {/each}
   </div>
</div>
