<script>
   import { getContext } from 'svelte'
   import ContextMenuOption from '$lib/components/ContextMenuOption.svelte'
   import Pile from './Pile.svelte'
   import cardback from '$lib/assets/cardback_int.png'
   import { share, spectating } from '$lib/stores/connection.js'
   import { logDeckView, logMove } from '$lib/stores/logger.js'
   import { canReveal, revealTop } from '$lib/stores/reveal.js'

   import { deck, discard, lz, prizes, draw, shuffle } from '$lib/stores/player.js'
   const { openPile, openDeckOrder, openSelection } = getContext('boardActions')

   let menu

   function drawX () {
      let x = parseInt(prompt('Draw how many cards?'))
      if (x) draw(x)
   }

   /*
      The top card, or the top `count` of them, off this deck and into `targetPile`.

      One card and X cards are the same move written once, because the things that have to
      agree are the end of the deck (the *end* of its array - see `placeOrdered` in
      custom/cards.js), the event and the log line. X travels as one `cardsMoved` rather
      than X of them: it is one gesture, the same way a multi-card selection crosses the
      wire per pile rather than per card (see docs/selection.md).

      The count is clamped to the deck: "discard 5" on a deck of 3 is a request the deck
      cannot answer, and a prompt is not the place to argue about it.
   */
   function moveTop (targetPile, count = 1) {
      const cards = []
      for (let i = 0; i < Math.min(count, deck.get().length); i++) {
         const card = deck.pop()
         if (!card) break
         cards.push(card)
         targetPile.push(card)
      }

      if (!cards.length) return

      share('cardsMoved', { cards: cards.map((card) => card._id), from: 'deck', to: targetPile.name })
      logMove(cards, 'deck', targetPile.name, { top: true })
   }

   /*
      *Discard Top X*: the top of the player's own deck straight to the discard, however
      many the player asks for. *Discard Top Card* is the same entry with X already
      answered.
   */
   function discardTopX () {
      const asked = parseInt(prompt('Discard how many cards from the top of your deck?'))
      if (!asked || asked < 1) return

      moveTop(discard, asked)
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

   /*
      Reveal the top X cards of the player's own deck, to both players.

      It is the opponent's deck's own entry with this deck behind it, and the whole
      of it is `revealTop` in the store: which cards "the top" means, which half
      owns the deck, and the event that shows the other player. What is here is the
      question, which every "X" on this board asks with the browser's own prompt
      (Draw X, View Top X, Order Top X).
   */
   function revealTopX () {
      revealTop(deck, parseInt(prompt('Reveal how many cards from the top?')))
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
      <!--
         Reveal, which is a shared act: the opponent is shown these cards too, and
         either player may act on them afterwards. It is disabled rather than
         absent outside a room - solo has nobody to reveal to - so the menu does
         not change shape between the two modes (see docs/reveal.md).
      -->
      <ContextMenuOption click={revealTopX} text="Reveal Top X" disabled={!canReveal()} />
      <ContextMenuOption click={arrangeDeck} text="Search & Order Deck" disabled={$spectating} />
      <ContextMenuOption click={() => moveTop(discard)} text="Discard Top Card" disabled={$spectating} />
      <ContextMenuOption click={discardTopX} text="Discard Top X" disabled={$spectating} />
      <ContextMenuOption click={() => moveTop(lz)} text="Lost Zone Top Card" disabled={$spectating} />
      <ContextMenuOption click={() => moveTop(prizes)} text="Prize Top Card" disabled={$spectating} />
   </svelte:fragment>
</Pile>
