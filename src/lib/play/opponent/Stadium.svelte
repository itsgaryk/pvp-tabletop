<script>
   import Card from './Card.svelte'
   import { defaultOpponent } from '$lib/stores/opponent.js'

   /* which player's board this component shows */
   export let store = defaultOpponent
</script>

<div class="p-1 flex justify-center items-center">
   {#if $store.stadium}
      <Card card={$store.stadium} pile="store.stadium" />
   {/if}
</div>