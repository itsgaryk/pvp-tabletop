<script>
   import Card from './Card.svelte'
   import { defaultOpponent } from '$lib/stores/opponent.js'
   import { solo, soloCardToStadium, onOpponentHalf } from '$lib/stores/solo.js'
   import { cardSelection, resetSelection } from '$lib/stores/player.js'

   /* DnD */

   import { dnd } from '$lib/dnd/actions.js'
   import { draggedCard, source } from '$lib/dnd/store.js'

   /* which player's board this component shows */
   export let store = defaultOpponent
   $: ({ stadium } = store)

   /*
      The mirror of the near half's Stadium: it accepts the far half's *own* cards,
      so each player plays into their own Stadium in the shared cell. In solo that
      half is played by the same person, so its cards are draggable - and a card of
      the player's that landed here would be a card crossing the table.

      The near Stadium lies over this one, so a drop reaches it while that half's
      Stadium is empty and nothing is being dragged into it (see .stadium in
      Board.svelte); when it is not empty, this half plays from its own menu.
   */
   const allowDrop = () => $solo && $source && $source !== stadium && $source !== 'slot'
      && $cardSelection.length === 1 && onOpponentHalf($source)

   function onDrop () {
      const card = $cardSelection[0]
      if (!card) return
      soloCardToStadium($source, card)
      resetSelection()
   }

   const dndConfig = { drop: onDrop, allowDrop }
</script>

<div class="stadium-cards p-1 flex justify-center items-center"
   use:dnd={dndConfig}>
   {#each $stadium as card (card._id)}
      <Card {card} pile={stadium} />
   {/each}
</div>

<style>
   /*
      The same shape as the near half's: up to two cards side by side, each taking
      half of what one card used to so that the pair fits the band. Both halves
      ask for it rather than sharing one rule, the way the prizes do - each zone
      component carries its own sizing.
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
