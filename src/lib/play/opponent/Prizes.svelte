<script>
   import { getContext } from 'svelte'
   import Vertical from '$lib/components/scroll/Vertical.svelte'
   import Pile from './Pile.svelte'
   import Card from './Card.svelte'
   import { defaultOpponent } from '$lib/stores/opponent.js'
   import { spectating } from '$lib/stores/connection.js'

   const { openOppPile } = getContext('boardActions')

   /* which player's board this component shows */
   export let store = defaultOpponent
   $: ({ prizes, prizesFlipped } = store)

   /* a spectator may look through either player's prizes (read-only, no log) */
   function view () {
      if (!$spectating) return
      openOppPile(prizes)
   }
</script>

<Pile pile={prizes} name="Prizes">
   <Vertical>
      <div class="prizes p-1 grid grid-cols-2 gap-1 w-fit" on:click|stopPropagation={view}>
         {#each $prizes as card (card._id)}
            <Card {card} pile={prizes} revealed={$prizesFlipped || $spectating} />
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
