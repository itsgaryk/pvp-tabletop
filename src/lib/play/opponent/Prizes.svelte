<script>
   import Vertical from '$lib/components/scroll/Vertical.svelte'
   import Pile from './Pile.svelte'
   import Card from './Card.svelte'

   import { defaultOpponent } from '$lib/stores/opponent.js'

   /* which player's board this component shows */
   export let store = defaultOpponent
</script>

<Pile pile={store.prizes} name="Prizes">
   <Vertical>
      <div class="store.prizes p-1 grid grid-cols-2 gap-1 w-fit">
         {#each $store.prizes as card (card._id)}
            <Card {card} pile={store.prizes} revealed={$store.prizesFlipped} />
         {/each}
      </div>
   </Vertical>
</Pile>

<style>
   .prizes {
      --card-width: 95px;
      --card-height: 132px;
   }
</style>