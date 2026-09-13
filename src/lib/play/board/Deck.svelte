<script>
   import { getContext } from 'svelte'
   import ContextMenuOption from '$lib/components/ContextMenuOption.svelte'
   import Pile from './Pile.svelte'
   import cardback from '$lib/assets/cardback_int.png'
   import { share, spectating } from '$lib/stores/connection.js'
   import { logMove } from '$lib/stores/logger.js'

   import { deck, discard, lz, prizes, draw, shuffle } from '$lib/stores/player.js'
   const { openPile, openSelection } = getContext('boardActions')

   let menu

   function drawX () {
      let x = parseInt(prompt('Draw how many cards?'))
      if (x) draw(x)
   }

   function moveTop (targetPile) {
      const card = deck.pop()
      if (card) {
         targetPile.push(card)
         share('cardsMoved', { cards: [ card._id ], from: 'deck', to: targetPile.name })
         logMove([ card ], 'deck', targetPile.name, { top: true })
      }
   }

   function pickX (bottom = false) {
      let x = parseInt(prompt('Look at how many cards?'))
      if (x) openSelection(deck, x, { bottom })
   }

   /* the click that opens the deck needs to stop propagation,
   so that the document level listener to close the Popup on clickoutside is not immediately fired
   (same for discard and lost zone) */
</script>

<Pile pile={deck} name="Deck" bind:menu={menu}>
   {#if $deck.length > 0}
      <img class="card" src={cardback} alt="" on:click|stopPropagation={() => openPile(deck)} draggable="false">
   {/if}

   <svelte:fragment slot="menu">
      <ContextMenuOption click={() => shuffle()} text="Shuffle" shortcut="s" disabled={$spectating} />
      <ContextMenuOption click={() => draw()} text="Draw" shortcut="1" disabled={$spectating} />
      <ContextMenuOption click={() => drawX()} text="Draw X" shortcut="1...9" disabled={$spectating} />
      <ContextMenuOption click={() => openPile(deck)} text="View All" shortcut="v" />
      <ContextMenuOption click={() => pickX()} text="View Top X" shortcut="Alt+1...9" disabled={$spectating} />
      <ContextMenuOption click={() => pickX(true)} text="View Bottom X" disabled={$spectating} />
      <ContextMenuOption click={() => moveTop(discard)} text="Discard Top Card" disabled={$spectating} />
      <ContextMenuOption click={() => moveTop(lz)} text="Lost Zone Top Card" disabled={$spectating} />
      <ContextMenuOption click={() => moveTop(prizes)} text="Prize Top Card" disabled={$spectating} />
   </svelte:fragment>
</Pile>