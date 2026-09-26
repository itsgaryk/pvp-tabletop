<script>
   import Slot from './Slot.svelte'

   import { active, toActive, slotSelection, cardSelection, stadium } from '$lib/stores/player.js'

   /* DnD */

   import { dnd } from '$lib/dnd/actions.js'
   import { draggedCard, source } from '$lib/dnd/store.js'
   import { solo, onOpponentHalf, onOpponentSlot } from '$lib/stores/solo.js'
   import { isWindowPile } from '$lib/stores/reveal.js'

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

      A card out of a Reveal or a Look is refused by `isWindowPile` for the same
      reason one of the far half's is: it belongs to the other player, and the
      other player's Active spot is the one that takes it (`opponent/Active.svelte`,
      which is where the request is made).
   */
   const allowDrop = () => !isWindowPile($source) && $source && $source !== stadium && $draggedCard !== $active
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

      /*
         The room this zone has for a Pokemon's fan, which is the one thing about a fan
         the zone has to decide: a fan is as long as the cards attached to it make it,
         and this zone cannot grow or scroll to hold one - so the fan is given the room
         that is left beside a card centred in the zone, and divides *that* between its
         cards (see Slot.svelte). A fan of two energies is untouched by it; a fan of
         twenty is drawn as twenty overlapping edges inside the zone rather than
         marching out over the bench or the Stadium.

         A card's own 2px borders are drawn outside the width this measures (the card
         keeps `--card-gap` from its zone's edge, the way every other card does), so the
         room is the gap's worth less than the free space: the last card of a fan that
         has filled it ends inside the zone rather than on its line.
      */
      --slot-fan-room: calc((100cqw - var(--slot-card-width) - 2 * var(--card-gap)) / 2);
   }

   /*
      What the slot declares about itself (see Slot.svelte) is spent as room above it
      here, the way the bench's row spends it: this container centres the *margin* box of
      what is in it, so a Pokemon with a fan is centred with its fan - and without this
      the fan reached over the band above the zone while the card sat in the middle of it.

      Nothing is reserved beside it, though, and that is the other half of this rule: the
      fan is drawn behind and beside the Pokemon here, so the box this container centres
      is the card alone. Reserving the fan's length asked a *fixed-width* line for room
      that grows with every card attached: the Pokemon was pulled left out of its own
      zone, and once the line was wider than the zone the slot inside it was squeezed -
      which is what "the layout falls apart" was (see the note over `max-width` in
      Slot.svelte). The Pokemon keeps the place a lone card has, however many cards are
      attached to it, and the fan stays inside the zone.
   */
   .active-slot > :global(.slot) {
      margin-top: var(--attach-lift, 0px);
      --slot-fan-reserve: 0px;
      --slot-fan-step-energy: min(var(--slot-step-energy), calc(var(--slot-fan-room) / var(--slot-fan-count)));
      --slot-fan-step-tool: min(var(--slot-step-tool), calc(var(--slot-fan-room) / var(--slot-fan-count)));
   }
</style>