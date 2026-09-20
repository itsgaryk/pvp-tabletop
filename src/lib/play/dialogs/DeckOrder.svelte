<script>
   import { ctrlA } from '$lib/actions/customEvents.js'
   import { spectating } from '$lib/stores/connection.js'
   import Card from '../board/Card.svelte'
   import Popup from './Popup.svelte'

   import { deck, lookAndPlace, resetSelection } from '$lib/stores/player.js'

   let popup

   /*
      The cards being placed, in the order they will sit on the deck: `order[0]`
      is the top of the deck, or the last card when the placement is at the
      bottom. That one convention is the whole of this dialog - the badge a card
      wears is its index here (see Card.svelte), so the player reads their
      placement off the grid.

      This is deliberately not the board's selection: a card selected on the
      board is a card about to be moved somewhere, and this is a card being put
      back where it already is. Keeping them apart also means the document-level
      click that clears the board's selection cannot empty this while the dialog
      is open.
   */
   let order = []
   let shuffleFirst = true

   /*
      How many cards from the top of the deck this dialog is about: 0 for the
      whole deck.

      An *Order Top X* opens it at the top X cards only, which is the same dialog
      over a shorter list - reordering the top of a deck is the placement with the
      shuffle switched off, since those cards are already at the top and shuffling
      them is not what was asked for.
   */
   let topX = 0
   /*
      What the grid shows: the deck top card first - the way a pile is read, and
      the way `Inspection` reads one - or just the top X cards of it.

      Top first means the *last* cell of the grid is the card that leaves next,
      which is worth knowing when reading the code: the array's end is the top of
      the deck (`pop` is a draw), so this reverses it for showing. Card 1 - the
      first card clicked, and the first one drawn - is therefore the last cell of
      the grid, and the first card of the sequence the strip names.
   */
   $: cards = (topX > 0 ? $deck.slice(-topX) : $deck).slice().reverse()

   /*
      A card clicked is a card added to the end of the order, or taken out of it.
      Clicking again is also the way a mistake is undone, and a card already in
      the order and clicked again moves to the end: no separate reordering tool,
      and no drag, which a grid this tall cannot scroll for (a pile inspection is
      a scroll container - see Popup.svelte).
   */
   function mark (card) {
      const i = order.indexOf(card)
      if (i >= 0) order.splice(i, 1)
      else order.push(card)

      order = order
   }

   /*
      Ctrl+A takes everything on show, top of the deck first - the same shortcut,
      meaning the same thing, as the inspection dialog's select-all: it is how a
      player answers a card that searches for *any* number of cards, and how a
      deck that is already in the right order is placed without clicking sixty
      times. Card 1 is the card that was already on top.
   */
   function markAll () {
      order = cards.slice()
   }

   export function open (_topX = 0) {
      topX = Math.max(0, Number(_topX) || 0)
      order = []
      /* the board's selection is left for the board: this dialog has its own */
      resetSelection()
      popup.open()
   }

   export function close () {
      popup.close()
   }

   /*
      Nothing is written until one of these is clicked. The deck is not touched
      while the dialog is open, so closing it - or Escape, or a click outside -
      needs no cleanup at all: no cards have to be put back anywhere.

      What is placed is the cards that were marked, in the order they were marked
      in, and only those. An *Order Top X* is therefore "these first, in this
      order, and the rest of the block keeps the order it had": marking one card
      of the top five brings it to the top and shuffles nothing, and marking none
      of them is not an action. It is the whole of what an order can say - the
      dialog fixes *which* cards are in the block and lets the player decide their
      sequence, rather than asking for an arrangement of cards they did not name.
   */
   function place (bottom = false) {
      if (!order.length) return

      const placing = [ ...order ]
      popup.close()
      order = []
      /*
         An *Order Top X* is not a search and shuffles nothing: the cards are
         already on top of the deck and are going back there.
      */
      lookAndPlace(placing, {
         bottom,
         shuffleFirst: topX > 0 ? false : shuffleFirst,
         search: topX === 0
      })
   }

   function closeAndClear () {
      order = []
      popup.close()
   }

   function onClosed () {
      order = []
   }
</script>

<Popup bind:this={popup} on:closed={onClosed}>
   <div class="p-2 border-b border-black">
      <div class="font-bold">
         {#if topX > 0}
            Putting the top {cards.length} {cards.length === 1 ? 'card' : 'cards'} of the deck back in this order:
         {:else if order.length}
            Putting {order.length} {order.length === 1 ? 'card' : 'cards'} on the deck, in this order:
         {:else}
            Click cards in the order they should sit on the deck. 1 is the top.
         {/if}
      </div>

      {#if order.length}
         <!-- card 1 is the first of them, which is the order they were clicked in -->
         <div class="flex flex-wrap gap-x-2 gap-y-1 mt-1">
            {#each order as card, i (card._id)}
               <span class="step"><span class="n">{i + 1}</span>{card.name}</span>
            {/each}
         </div>
      {/if}
   </div>

   <div class="flex flex-wrap gap-1 p-2 focus:outline-none inspection"
      tabindex="0" use:ctrlA on:ctrlA={markAll}>

      {#each cards as card (card._id)}
         <Card
            {card}
            pile={deck}
            marked={order.includes(card)}
            markedIndex={order.includes(card) ? order.indexOf(card) + 1 : null}
            onMark={mark}
         />
      {/each}
   </div>

   <svelte:fragment slot="buttons">
      <!--
         One action per line (the panel's own rule), so the grid keeps as much of
         the window as it can, and no more of them than the job needs: an *Order
         Top X* is a rearrangement of cards that are already at the top, so it
         has no bottom to send them to and nothing to shuffle - the shuffle is
         the other mode's.
      -->
      {#if topX > 0}
         <button class="action" disabled={!order.length || $spectating} on:click={() => place(false)}>
            Arrange the Top {cards.length} in This Order
         </button>
      {:else}
         <button class="action" disabled={!order.length || $spectating} on:click={() => place(false)}>
            Put on Top in This Order
         </button>
         <button class="action" disabled={!order.length || $spectating} on:click={() => place(true)}>
            Put on Bottom in This Order
         </button>
         <label class="shuffle">
            <input type="checkbox" bind:checked={shuffleFirst}>
            Shuffle the rest of the deck first
         </label>
      {/if}
      <button class="action" on:click={closeAndClear}>Close</button>
   </svelte:fragment>
</Popup>

<style>
   .inspection {
      --card-width: 136px;
      --card-height: 189px;
   }

   /*
      A scroll container clips horizontally as well as vertically, so nothing in
      the body is allowed to hang off its own box (see the badge in Card.svelte).
   */
   .step {
      @apply flex items-center gap-1 text-sm;
   }

   .step .n {
      @apply inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold text-[var(--bg-color-zero)] bg-[var(--primary-color)];
   }

   button.action {
      @apply px-3 py-2 rounded-lg font-bold text-white bg-[var(--primary-color)];
   }

   /* a placement with nothing chosen is not an action yet */
   button.action:disabled {
      @apply opacity-50;
   }

   label.shuffle {
      @apply flex items-center gap-2 font-bold;
   }

   div :global(img.card) {
      --shadow-color: transparent; /* the shadow makes it harder to see the marked cards on the gray background */
   }
</style>
