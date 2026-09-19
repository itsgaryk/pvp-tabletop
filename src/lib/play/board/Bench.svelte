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
   from the middle. Up and down they are centred in the zone, which is where a card
   in every other zone of the board sits: the row is placed by the zone it fills
   (see .bench-zone) rather than laid against the zone's top, which is where it sat
   while a bench zone happened to be about the height of a card and so read as
   centred. A bench zone is not that height, and a card across the top of one is a
   card sitting in the corner of it.

   It keeps its own card size while it does. A bench with more on it than the zone
   holds is *navigated* rather than shrunk - the row scrolls sideways, as the hand's
   does - because a Pokemon in play is read at the size it was played at, and a card
   that shrinks as the bench fills up is a card that has to be looked at twice. A
   game's bench is five, which fits without scrolling; solo can put any number on
   one, which is where the scrollbar comes in.
-->
<div class="bench-zone p-1 focus:outline-none" use:dnd={dndConfig} tabindex="0" use:ctrlA on:ctrlA={selectAll}>
   <Horizontal>
      <div class="bench-row">
         {#each $bench as slot (slot.id)}
            <Slot bind:slot={slot} />
         {/each}
      </div>
   </Horizontal>
</div>

<style>
   /*
      The zone places the row, and centres it between the top of the zone and the
      bottom of it - where a card in every other zone of the board sits. A grid item
      is what does it here rather than a flex one, for two reasons that were measured:
      a bench card is a fixed size rather than the zone's, so at an ordinary window the
      row is taller than the zone and a column flex item would be shrunk to fit,
      clipping the card inside the row's own scroll container; and a half-empty bench's
      row is narrower than the zone, which a row flex item would narrow further, to its
      own contents, taking the row off the width of the drop target (see .bench-row).
   */
   .bench-zone {
      display: grid;
      align-items: center;
   }

   .bench-row {
      display: flex;
      /*
         The cards sit on the row's bottom edge rather than centred in it: a slot with a
         tool attached is a taller item than one without (see --attach-lift below), and
         centring the items would put the Pokemon beside it half a tool's lift higher
         than it. On the bottom edge, every card in the row is at the same height.
      */
      align-items: flex-end;
      gap: var(--scaled-rem);
      /*
         The row is as wide as its cards, so the scroll container has something to
         scroll: `max-content` lets it grow past the zone, and `min-width: 100%`
         keeps a half-empty bench filling its zone's width for the drop target.

         Its height is its cards' plus the room the fan above them takes (see
         --attach-lift), rather than the zone's - the zone is what places the row, and
         centres it (see .bench-zone) - so the group a slot draws is centred as a whole,
         and a bench taller than the zone overflows it evenly instead of downwards only.
      */
      width: max-content;
      min-width: 100%;
   }

   /*
      What each slot declares about itself (see Slot.svelte): how far the cards attached
      to it reach above its top - 34px for a tool, 17px for an energy, nothing for a
      Pokemon carrying neither. The row spends it as room above that slot, so that the
      row is as tall as the group a slot draws.

      The slot cannot spend it itself: a slot is in the active spot and on the table as
      well, where nothing scrolls and the fan is drawn whole, and it is only the bench
      that scrolls - a scroll container clipping at its own box, `overflow-x: auto`
      making the other axis `auto` too, whatever it says. Unspent, an attached card that
      reached above the row was drawn from the row's top edge down: the top 34px of it,
      the part that says which card it is, was cut off.
   */
   .bench-row > :global(.slot) {
      margin-top: var(--attach-lift, 0px);
   }
</style>
