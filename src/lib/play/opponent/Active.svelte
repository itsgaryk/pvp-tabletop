<script>
   import Slot from './Slot.svelte'

   import { defaultOpponent } from '$lib/stores/opponent.js'


   /* which player's board this component shows */
   export let store = defaultOpponent
</script>

<div>
   <div class="h-full flex justify-center items-center">
      {#if $store.active}
         <Slot bind:slot={$store.active} />
      {/if}
   </div>
</div>