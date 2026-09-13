<script>
   import { getContext } from 'svelte'
   import { cardImage } from '$lib/util/assets.js'
   import Pile from './Pile.svelte'

   import { defaultOpponent } from '$lib/stores/opponent.js'
   const { openOppPile } = getContext('boardActions')

   $: top = $store.discard[ $store.discard.length - 1 ]

   /* which player's board this component shows */
   export let store = defaultOpponent
</script>

<Pile pile={store.discard} name="Discard">
   {#if $store.discard.length}
      <img class="card" src="{cardImage(top, 'xs')}" alt="{top.name}" on:click|stopPropagation={() => openOppPile(store.discard)}>
   {/if}
</Pile>