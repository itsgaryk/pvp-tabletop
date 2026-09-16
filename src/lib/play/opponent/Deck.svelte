<script>
   import { getContext } from 'svelte'
   import ContextMenuOption from '$lib/components/ContextMenuOption.svelte'
   import Pile from './Pile.svelte'
   import cardback from '$lib/assets/cardback_int.png'
   import { defaultOpponent } from '$lib/stores/opponent.js'
   import { spectating } from '$lib/stores/connection.js'
   import { solo, soloDraw, soloShuffleDeck } from '$lib/stores/solo.js'

   const { openOppPile } = getContext('boardActions')

   /* which player's board this component shows */
   export let store = defaultOpponent
   $: ({ deck } = store)

   let menu

   /* a spectator may look through either player's deck (read-only, no log) */
   function view () {
      if (!$spectating && !$solo) return
      openOppPile(deck)
   }

   /* in solo the other half is yours, so its deck can be drawn from as well */
   function drawX () {
      const x = parseInt(prompt('Draw how many cards?'))
      if (x) soloDraw(x)
   }
</script>

<Pile pile={deck} name="Deck" showMenu={$solo} bind:menu={menu}>
   {#if $deck.length > 0}
      <img class="card" src={cardback} alt="" draggable="false" on:click|stopPropagation={view}>
   {/if}

   <svelte:fragment slot="menu">
      <ContextMenuOption click={() => soloDraw(1)} text="Draw" />
      <ContextMenuOption click={drawX} text="Draw X" />
      <ContextMenuOption click={() => soloDraw(7)} text="Draw 7" />
      <ContextMenuOption click={soloShuffleDeck} text="Shuffle" />
      <ContextMenuOption click={view} text="View All" />
   </svelte:fragment>
</Pile>
