<script>
   import Slot from './Slot.svelte'
   import { defaultOpponent } from '$lib/stores/opponent.js'
   import { dnd } from '$lib/dnd/actions.js'
   import { source } from '$lib/dnd/store.js'
   import { cardSelection } from '$lib/stores/player.js'
   import { solo, soloCardToPlay, onOpponentHalf } from '$lib/stores/solo.js'

   /* which player's board this component shows */
   export let store = defaultOpponent
   $: ({ active } = store)

   /*
      In solo a card dragged from the far half can be put in its Active spot - the
      same drop the player's own Active accepts. Only that half's own cards: cards
      do not cross between the halves.
   */
   const allowDrop = () => $solo && onOpponentHalf($source)

   function onDrop () {
      if (!$solo || !onOpponentHalf($source)) return

      const cards = [ ...$cardSelection ]
      const first = cards.shift()
      if (first) soloCardToPlay($source, first, 'active')
      /* only one Pokemon can be Active, so the rest go to the Bench */
      for (const card of cards) soloCardToPlay($source, card, 'bench')

      cardSelection.clear()
   }

   const dndConfig = { drop: onDrop, allowDrop }
</script>

<div use:dnd={dndConfig}>
   <div class="h-full flex justify-center items-center">
      {#if $active}
         <Slot bind:slot={$active} {store} />
      {/if}
   </div>
</div>
