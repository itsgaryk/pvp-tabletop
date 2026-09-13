<script>
   import { getContext } from 'svelte'
   import { cardImage } from '$lib/util/assets.js'
   import Pile from './Pile.svelte'
   import { defaultOpponent } from '$lib/stores/opponent.js'
   const { openOppPile } = getContext('boardActions')

   /* which player's board this component shows */
   export let store = defaultOpponent
   $: ({ discard } = store)
   $: top = $discard[ $discard.length - 1 ]
</script>

<Pile pile={discard} name="Discard">
   {#if $discard.length}
      <img class="card" src="{cardImage(top, 'xs')}" alt="{top.name}" on:click|stopPropagation={() => openOppPile(discard)}>
   {/if}
</Pile>
