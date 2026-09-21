<script>
   import { getContext } from 'svelte'
   import ContextMenuOption from '$lib/components/ContextMenuOption.svelte'
   import Pile from './Pile.svelte'
   import cardback from '$lib/assets/cardback_int.png'
   import { share, spectating } from '$lib/stores/connection.js'
   import { logDeckView, logMove } from '$lib/stores/logger.js'

   import { deck, discard, lz, prizes, draw, shuffle } from '$lib/stores/player.js'
   const { openPile, openDeckOrder, openSelection } = getContext('boardActions')

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

   /*
      Looking through the whole deck to put cards back in a chosen order: the
      search that ends with the player deciding what they draw next. The cards
      never leave the deck, so opening this changes nothing - but it is a look
      through the deck, which the log records the same way View All's does (see
      logDeckView). The placement says the rest, when the cards are actually
      placed (see lookAndPlace).
   */
   function arrangeDeck () {
      logDeckView()
      openDeckOrder()
   }

   /*
      The same, over the top X cards only: reordering what is already on top of
      the deck, which is the job *Ciphermaniac's Codebreaking* is really doing -
      2 cards out of 60 are going back where they came from, in an order the
      player chooses. Nothing is shuffled, so an order the player put there by an
      earlier search survives it.
   */
   function orderTopX () {
      let x = parseInt(prompt('Reorder how many cards from the top?'))
      if (!x || x < 1) return

      logDeckView()

      /* show what there is rather than a number that is not there */
      openDeckOrder(Math.min(x, deck.get().length))
   }

   /*
      The whole deck on screen at once: the menu's View All, and the click on the
      deck's own card. The board's V key takes the same look and writes the same
      line (see logDeckView).
   */
   function viewDeck () {
      logDeckView()
      openPile(deck)
   }

   /* the click that opens the deck needs to stop propagation,
   so that the document level listener to close the Popup on clickoutside is not immediately fired
   (same for discard and lost zone) */
</script>

<Pile pile={deck} name="Deck" bind:menu={menu}>
   {#if $deck.length > 0}
      <img class="card zone-card" src={cardback} alt="" on:click|stopPropagation={viewDeck} draggable="false">
   {/if}

   <svelte:fragment slot="menu">
      <ContextMenuOption click={() => shuffle()} text="Shuffle" shortcut="s" disabled={$spectating} />
      <ContextMenuOption click={() => draw()} text="Draw" shortcut="1" disabled={$spectating} />
      <ContextMenuOption click={() => drawX()} text="Draw X" shortcut="1...9" disabled={$spectating} />
      <ContextMenuOption click={viewDeck} text="View All" shortcut="v" />
      <ContextMenuOption click={() => pickX()} text="View Top X" shortcut="Alt+1...9" disabled={$spectating} />
      <ContextMenuOption click={() => pickX(true)} text="View Bottom X" disabled={$spectating} />
      <ContextMenuOption click={orderTopX} text="Order Top X" disabled={$spectating} />
      <ContextMenuOption click={arrangeDeck} text="Search & Order Deck" disabled={$spectating} />
      <ContextMenuOption click={() => moveTop(discard)} text="Discard Top Card" disabled={$spectating} />
      <ContextMenuOption click={() => moveTop(lz)} text="Lost Zone Top Card" disabled={$spectating} />
      <ContextMenuOption click={() => moveTop(prizes)} text="Prize Top Card" disabled={$spectating} />
   </svelte:fragment>
</Pile>
