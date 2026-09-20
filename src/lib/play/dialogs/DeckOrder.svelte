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

   /* top of the deck first, which is how the deck is read (see Inspection.svelte) */
   $: topFirst = $deck.slice().reverse()

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
      Ctrl+A takes the whole deck, in the order it is already in - the same
      shortcut, meaning the same thing, as the inspection dialog's select-all: it
      is how a player answers a card that searches for *any* number of cards, and
      how a deck that is already in the right order is placed without clicking
      sixty times.
   */
   function markAll () {
      order = topFirst.slice()
   }

   export function open () {
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
   */
   function place (bottom = false) {
      if (!order.length) return

      const cards = [ ...order ]
      popup.close()
      order = []
      lookAndPlace(cards, { bottom, shuffleFirst })
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
         {#if order.length}
            Putting {order.length} {order.length === 1 ? 'card' : 'cards'} on the deck, in this order:
         {:else}
            Click cards in the order they should sit on the deck. 1 is the top.
         {/if}
      </div>

      {#if order.length}
         <!-- the last card is the top of the deck, so it is the one named first -->
         <div class="flex flex-wrap gap-x-2 gap-y-1 mt-1">
            {#each order.slice().reverse() as card, i (card._id)}
               <span class="step"><span class="n">{order.length - i}</span>{card.name}</span>
            {/each}
         </div>
      {/if}
   </div>

   <div class="flex flex-wrap gap-1 p-2 focus:outline-none inspection"
      tabindex="0" use:ctrlA on:ctrlA={markAll}>

      {#each topFirst as card (card._id)}
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
         Three actions, one per line (the panel's own rule), so the grid keeps as
         much of the window as it can: the placement either end, and the shuffle
         the search asks for between the two.
      -->
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
