<script>
   import { getContext } from 'svelte'
   import Pile from './Pile.svelte'
   import cardback from '$lib/assets/cardback_int.png'
   import { defaultOpponent } from '$lib/stores/opponent.js'
   import { spectating } from '$lib/stores/connection.js'

   const { openOppPile } = getContext('boardActions')

   /* which player's board this component shows */
   export let store = defaultOpponent
   $: ({ deck } = store)

   /* a spectator may look through either player's deck (read-only, no log) */
   function view () {
      if (!$spectating) return
      openOppPile(deck)
   }
</script>

<Pile pile={deck} name="Deck">
   {#if $deck.length > 0}
      <img class="card" src={cardback} alt="" draggable="false" on:click|stopPropagation={view}>
   {/if}
</Pile>
