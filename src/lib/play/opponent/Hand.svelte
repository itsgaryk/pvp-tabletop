<script>
   import Horizontal from '$lib/components/scroll/Horizontal.svelte'
   import Pile from './Pile.svelte'
   import Card from './Card.svelte'
   import { defaultOpponent } from '$lib/stores/opponent.js'
   import { spectating } from '$lib/stores/connection.js'

   /* which player's board this component shows */
   export let store = defaultOpponent
   $: ({ hand, handRevealed } = store)

   /* a spectator always sees both hands */
   $: revealed = $handRevealed || $spectating
</script>

<Pile pile={hand} name="Hand">
   <Horizontal>
      <div class="flex gap-2 p-2 m-auto w-max">
         {#each $hand as card (card._id)}
            <Card {card} pile={hand} {revealed} />
         {/each}
      </div>
   </Horizontal>
</Pile>
