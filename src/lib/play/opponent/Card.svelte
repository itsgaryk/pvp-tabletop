<script>
   import { getContext } from 'svelte'
   import { cardImage } from '$lib/util/assets.js'
   import cardback from '$lib/assets/cardback_int.png'
   import { solo } from '$lib/stores/solo.js'

   const { openDetails, openOppCardMenu } = getContext('boardActions')

   export let card
   export let pile
   export let revealed = true

   /*
      In solo the other half is yours, so its cards have their own menu. The event
      is stopped here: without that it carries on to the pile behind the card,
      which opens the pile's menu over the top of this one.
   */
   function onCtx (e) {
      if (!$solo || !pile) return
      e.preventDefault()
      e.stopPropagation()
      openOppCardMenu(e.clientX, e.clientY, pile, card)
   }
</script>

<div class="border-2 border-transparent rounded-md" on:contextmenu={onCtx}>
   {#if revealed}
      <img class="card" src="{cardImage(card, 'xs')}" alt="{card.name}" draggable=false on:dblclick={() => openDetails(card)}>
   {:else}
      <img class="card" src={cardback} alt="Hidden Card" draggable=false>
   {/if}
</div>