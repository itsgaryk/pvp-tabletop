<script>
   import Horizontal from '$lib/components/scroll/Horizontal.svelte'
   import Pile from './Pile.svelte'
   import Card from './Card.svelte'

   import { defaultOpponent } from '$lib/stores/opponent.js'
   import { spectating } from '$lib/stores/connection.js'

   /* a spectator always sees both hands */
   $: revealed = $store.handRevealed || $spectating

   /* which player's board this component shows */
   export let store = defaultOpponent
</script>

<Pile pile={store.hand} name="Hand">
   <Horizontal>
      <div class="flex gap-2 p-2 m-auto w-max">
         {#each $store.hand as card (card._id)}
            <Card {card} pile={store.hand} {revealed} />
         {/each}
      </div>
   </Horizontal>
</Pile>
