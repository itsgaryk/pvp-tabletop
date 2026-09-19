<script>
   import Card from './Card.svelte'
   import { dragging } from '$lib/dnd/pointer.js'

   import { stadium, toStadium, cardSelection as selection } from '$lib/stores/player.js'

   /* DnD */

   import { dnd } from '$lib/dnd/actions.js'
   import { draggedCard, source } from '$lib/dnd/store.js'
   import { solo, onOpponentHalf } from '$lib/stores/solo.js'

   /*
      A card of the player's own may land here from any pile but the Stadium
      itself, and the Stadium holds two of them (see STADIUM_LIMIT): a third is
      the stadium being replaced rather than a drop to refuse, so `toStadium`
      sends the oldest of the two to the discard.

      A card of the far half's may not. The Stadium is shared - both players play
      into the one cell - but each of them plays into *their own* Stadium in it,
      so a card dragged off the opponent's Stadium lands back on theirs rather than
      here, and one out of their hand is played from their own side.
   */
   const allowDrop = () => $source && $source !== 'slot' && $source !== stadium && $selection.length === 1
      && !($solo && onOpponentHalf($source))

   function onDragDrop () {
      toStadium()
   }

   const dndConfig = {
      drop: onDragDrop,
      allowDrop
   }

</script>

<div class="stadium-cards p-1 flex justify-center items-center"
   class:pointer-events-auto={$stadium.length || $dragging}
   use:dnd={dndConfig}>
   {#each $stadium as card (card._id)}
      <Card {card} pile={stadium} />
   {/each}
</div>

<style>
   /*
      Up to two cards, side by side: they are one zone with two cards in it, so
      each takes half of what one card used to and the pair fits where the single
      card did. A card is as large as its half of the band allows and no larger -
      the band is short, so a card wider than it is tall would otherwise be drawn
      past the Stadium and over the bench beside it.
   */
   .stadium-cards {
      gap: calc(var(--scaled-rem) * 0.5);
   }

   .stadium-cards > :global(div) {
      flex: 1 1 0;
      min-width: 0;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
   }

   .stadium-cards :global(img.card) {
      width: 100%;
      height: auto;
      max-height: 100%;
      object-fit: contain;
   }
</style>
