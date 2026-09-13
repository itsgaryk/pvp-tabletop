<script>
   import Card from './Card.svelte'
   import { defaultOpponent } from '$lib/stores/opponent.js'

   /* which player's board this component shows */
   export let store = defaultOpponent
   $: ({ stadium } = store)
</script>

<div class="p-1 flex justify-center items-center">
   {#if $stadium}
      <Card card={$stadium} pile={stadium} />
   {/if}
</div>
