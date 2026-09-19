<script>
   import Slot from './Slot.svelte'

   import { active, toActive, slotSelection, cardSelection } from '$lib/stores/player.js'

   /* DnD */

   import { dnd } from '$lib/dnd/actions.js'
   import { draggedCard, source } from '$lib/dnd/store.js'
   import { solo, onOpponentHalf } from '$lib/stores/solo.js'

   /*
      A card of the other half's never lands here. The two halves are separate
      boards even in solo, where the same person plays both - so a card dragged
      from the far half is refused rather than moved onto this player's Active,
      which is what used to happen: the drop was allowed and the card did not
      move so much as attach itself to whatever was already up there. Online the
      far half is somebody else's and is not draggable at all, so this only ever
      applies in solo.
   */
   const allowDrop = () => $source && $source !== 'stadium' && $draggedCard !== $active
      && !($solo && onOpponentHalf($source))
      && ($slotSelection.length <= 1 && $cardSelection.length <= 1)

   function onDragDrop () {
      // if the drop caused an attach / evolve on the child Slot, the selection is empty by now and the call will do nothing
      toActive()
   }

   const dndConfig = {
      drop: onDragDrop,
      allowDrop
   }

</script>

<div use:dnd={dndConfig}>
   <div class="h-full flex justify-center items-center">
      {#if $active}
         {#key $active.id}
            <Slot bind:slot={$active} />
         {/key}
      {/if}
   </div>
</div>