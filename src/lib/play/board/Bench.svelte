<script>
   import Slot from './Slot.svelte'
   import Horizontal from '$lib/components/scroll/Horizontal.svelte'
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

   It keeps its own card size while it does. A bench with more on it than the zone
   holds is *navigated* rather than shrunk - the row scrolls sideways, as the hand's
   does - because a Pokemon in play is read at the size it was played at, and a card
   that shrinks as the bench fills up is a card that has to be looked at twice. A
   game's bench is five, which fits without scrolling; solo can put any number on
   one, which is where the scrollbar comes in.
-->
<div class="p-1 focus:outline-none" use:dnd={dndConfig} tabindex="0" use:ctrlA on:ctrlA={selectAll}>
   <Horizontal>
      <div class="bench-row">
         {#each $bench as slot (slot.id)}
            <Slot bind:slot={slot} />
         {/each}
      </div>
   </Horizontal>
</div>

<style>
   .bench-row {
      display: flex;
      align-items: center;
      gap: var(--scaled-rem);
      /*
         The row is as wide as its cards, so the scroll container has something to
         scroll: `max-content` lets it grow past the zone, and `min-width: 100%`
         keeps a half-empty bench filling its zone's width for the drop target.
      */
      width: max-content;
      min-width: 100%;
   }
</style>
