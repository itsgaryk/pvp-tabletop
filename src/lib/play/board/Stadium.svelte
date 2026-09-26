<script>
   import Card from './Card.svelte'
   import { dragging } from '$lib/dnd/pointer.js'

   import { stadium, toStadium, cardSelection as selection } from '$lib/stores/player.js'

   /* DnD */

   import { dnd } from '$lib/dnd/actions.js'
   import { draggedCard, source } from '$lib/dnd/store.js'
   import { solo, onOpponentHalf, soloCardToStadium } from '$lib/stores/solo.js'
   import { isWindowPile } from '$lib/stores/reveal.js'

   /*
      A card of the player's own may land here from any pile but the Stadium
      itself, and the Stadium holds two of them (see STADIUM_LIMIT): a card played
      while they are already at two is the stadium being replaced rather than a
      drop to refuse, so `toStadium` sends the whole of what they had there to the
      discard.

      The Stadium's cell is shared, and each half plays into *its own* Stadium in
      it - so this one stands aside while a card of the far half's is being
      carried, exactly as the near table stands aside for one (see .far-drag in
      Board.svelte). The far half's Stadium lies under this one and takes the drop
      itself, which is where its rules are: a card played there clears the
      *player's* cards out of the Stadium, not the other way round.

      Without that, the two halves of a shared zone disagree about who a card
      belongs to: the far half could not play into its own Stadium at all while
      the player had anything in theirs, because this one was in the way and
      refused the drop.

      A card out of a Reveal or a Look is refused outright (`isWindowPile`): it
      belongs to the other player, and the other player's own Stadium is the one
      that takes it - this cell holds *this* player's cards, and a card out of
      somebody else's deck played here would be one player playing another's card
      as their own.
   */
   $: farDrag = $solo && $dragging && onOpponentHalf($source)

   const allowDrop = () => !isWindowPile($source)
      && $source && $source !== 'slot' && $source !== stadium && $selection.length === 1
      && !farDrag

   function onDragDrop () {
      toStadium()
   }

   const dndConfig = {
      drop: onDragDrop,
      allowDrop
   }

</script>

<div class="stadium-cards p-1 flex justify-center items-center"
   class:pointer-events-auto={($stadium.length || $dragging) && !farDrag}
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
