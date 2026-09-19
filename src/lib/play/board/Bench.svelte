<script>
   import Slot from './Slot.svelte'
   import { ctrlA } from '$lib/actions/customEvents.js'

   import { active, bench, toBench, resetSelection, selectSlot, stadium } from '$lib/stores/player.js'

   /* DnD */

   import { dnd } from '$lib/dnd/actions.js'
   import { draggedCard, source } from '$lib/dnd/store.js'
   import { solo, onOpponentHalf, onOpponentSlot } from '$lib/stores/solo.js'

   /*
      A card in the Stadium is not dragged onto the bench: it is in play as a
      Stadium, and its menu is where it is moved out of play. The comparison is
      against the pile itself rather than its name, because a card dragged off the
      Stadium carries the Stadium as its source the way every other pile's cards
      carry theirs.

      Nor is anything of the far half's: in solo a card out of the opponent's hand
      used to be put on this player's bench, and one of their Pokemon in play came
      with everything under it. Only this player's own cards go into play here.
   */
   const allowDrop = () => $source && $source !== stadium
      && ($source !== 'slot' || $draggedCard === $active)
      && !($solo && (onOpponentHalf($source) || onOpponentSlot($draggedCard)))

   function onDragDrop () {
      toBench()
   }

   const dndConfig = {
      drop: onDragDrop,
      allowDrop
   }

   function selectAll () {
      resetSelection()
      for (const slot of $bench) {
         selectSlot(slot, true)
      }
   }

</script>

<!--
   The bench's Pokemon sit against the near edge, the way they always have: the
   bench fills up from the left as it is played into, rather than growing outwards
   from the middle.
-->
<div class="p-1 flex items-center focus:outline-none" use:dnd={dndConfig} tabindex="0" use:ctrlA on:ctrlA={selectAll}>
   <div class="flex gap-[var(--scaled-rem)] min-w-0">
      {#each $bench as slot (slot.id)}
         <Slot bind:slot={slot} />
      {/each}
   </div>
</div>