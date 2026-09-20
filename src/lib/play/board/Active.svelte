<script>
   import Slot from './Slot.svelte'

   import { active, toActive, slotSelection, cardSelection, stadium } from '$lib/stores/player.js'

   /* DnD */

   import { dnd } from '$lib/dnd/actions.js'
   import { draggedCard, source } from '$lib/dnd/store.js'
   import { solo, onOpponentHalf, onOpponentSlot } from '$lib/stores/solo.js'

   /*
      A card of the other half's never lands here. The two halves are separate
      boards even in solo, where the same person plays both - so a card dragged
      from the far half is refused rather than moved onto this player's Active,
      which is what used to happen: the drop was allowed and the card did not
      move so much as attach itself to whatever was already up there. Online the
      far half is somebody else's and is not draggable at all, so this only ever
      applies in solo.

      Both shapes a far drag comes in are refused, and they are not the same
      check: a card carries the pile it came from as its source, while a Pokemon
      in play carries the word 'slot' and is only ever identified by the slot
      itself. Asking `onOpponentHalf` about 'slot' answers "not a pile of the far
      half's" - so a far Pokemon in play was let through here whenever the drop
      landed on the zone rather than on the Pokemon in it, and promoting it put
      the far half's Pokemon - and everything under it - in this player's spot.
   */
   const allowDrop = () => $source && $source !== stadium && $draggedCard !== $active
      && !($solo && (onOpponentHalf($source) || onOpponentSlot($draggedCard)))
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
   <div class="active-slot h-full flex justify-center items-center">
      {#if $active}
         {#key $active.id}
            <Slot bind:slot={$active} />
         {/key}
      {/if}
   </div>
</div>

<style>
   /*
      The card in this zone is the size of the zone, the same as every other card on the
      board - and less the room a fan takes above it (`--slot-card-share`), so a Pokemon
      carrying tools is drawn whole inside the zone rather than over the Pokemon Power
      band above it. The zone is not wide enough for a fan of any length - a fan of a
      card is wider than the card - so what it can give a card is what it has with
      nothing else in it.

      `100cqw` and `100cqh` are this half of the active area (`.active1` / `.active2`,
      which Board.svelte makes a size container), not the whole cell.
   */
   .active-slot {
      --slot-card-width: min(
         calc(100cqw - 2 * var(--card-gap)),
         calc((100cqh - 2 * var(--card-gap)) * var(--slot-card-share) * var(--card-ratio))
      );
   }

   /*
      What the slot declares about itself (see Slot.svelte) is spent as room above it
      here, the way the bench's row spends it: this container centres the *margin* box of
      what is in it, so a Pokemon with a fan is centred with its fan - and without this
      the fan reached over the band above the zone while the card sat in the middle of it.
   */
   .active-slot > :global(.slot) {
      margin-top: var(--attach-lift, 0px);
   }
</style>