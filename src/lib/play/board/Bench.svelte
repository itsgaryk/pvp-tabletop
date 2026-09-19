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
   <div class="bench-slots">
      {#each $bench as slot (slot.id)}
         <Slot bind:slot={slot} />
      {/each}
   </div>
</div>

<style>
   /*
      Five to a row, and the sixth starts a new row.

      Five is the bench a game is played with, so a full bench is one row of it -
      and a bench holding more than that (which solo can, since both halves are one
      person's) wraps rather than shrinking the Pokemon already in play to make
      room for another. The row a Pokemon is in is decided by how many are already
      on the bench, and by nothing else: what is attached *under* one of them is not
      a card on the bench, and is not counted.

      The rows share the zone's height between them, so a second row is a smaller
      card for all of them rather than a card half out of the zone, and each card is
      fitted to the cell it is in - the same rule as every other card on the board
      (see the note over --card-ratio in global.css).
   */
   .bench-slots {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      grid-auto-rows: minmax(0, 1fr);
      place-items: center;
      gap: var(--scaled-rem);
      width: 100%;
      height: 100%;
   }

   .bench-slots :global(.slot) {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      /*
         A slot carries a margin on its right for the cards attached to it, which
         overlap that way on the table. The grid is the spacing here, and the
         margin is set inline by the slot itself, so only `!important` reaches it.
      */
      margin-right: 0 !important;
   }

   /*
      The Pokemon is fitted to its cell. The wrapper around it has to be told its
      height as well: a percentage max-height is measured against the box the image
      is laid out in, and that is the `.pokemon-card` div rather than the slot -
      with no height of its own it resolves against nothing, and the card stayed its
      full size and hung out of the zone.
   */
   .bench-slots :global(.slot .pokemon-card) {
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
   }

   .bench-slots :global(.slot img.card.pokemon) {
      width: auto;
      height: auto;
      max-width: 100%;
      max-height: 100%;
   }
</style>