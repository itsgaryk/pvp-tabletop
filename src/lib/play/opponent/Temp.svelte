<script>
   import { cardImage } from '$lib/util/assets.js'
   import Pile from './Pile.svelte'

   import { defaultOpponent } from '$lib/stores/opponent.js'


   /* which player's board this component shows */
   export let store = defaultOpponent
</script>

<Pile pile={store.table}>
   <div class="h-full flex justify-center items-center">
      <div class="relative w-max"
         style="margin-bottom: {($store.table.length - 1) * 35}px; margin-right: {$store.table.length > 1 ? 20 : 0}px">

         {#if $store.table.length > 0}
            <img class="card" src="{cardImage($store.table[0], 'xs')}" alt={$store.table[0].name} draggable="false">
            {#each $store.table as card, i (card._id)}
               {#if i >= 1}
                  <img class="card absolute" src="{cardImage(card, 'xs')}" alt={card.name} draggable="false"
                     style="bottom: -{i * 35}px; left: {i % 2 !== 0 ? 20 : 0}px">
               {/if}
            {/each}
         {/if}
      </div>
   </div>
</Pile>