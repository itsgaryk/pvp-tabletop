<script>
   import Card from './Card.svelte'
   import { defaultOpponent } from '$lib/stores/opponent.js'

   /* which player's board this component shows */
   export let store = defaultOpponent
   $: ({ stadium } = store)
</script>

<div class="stadium-cards p-1 flex justify-center items-center">
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
