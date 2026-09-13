<script>
   import Pile from './Pile.svelte'
   import cardback from '$lib/assets/cardback_int.png'
   import { defaultOpponent } from '$lib/stores/opponent.js'

   /* which player's board this component shows */
   export let store = defaultOpponent
   $: ({ deck } = store)
</script>

<Pile pile={deck} name="Deck">
   {#if $deck.length > 0}
      <img class="card" src={cardback} alt="" draggable="false">
   {/if}
</Pile>
