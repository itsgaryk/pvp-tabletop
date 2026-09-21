<script>
   import { ctrlA } from '$lib/actions/customEvents.js'
   import Card from '../board/Card.svelte'
   import Popup from './Popup.svelte'

   import { spectating } from '$lib/stores/connection.js'
   import { s } from '$lib/util/strings.js'
   import {
      deck, discard, hand, table,
      shuffle, selectPile, cardSelection, selectionPile,
      moveSelection, toBench
   } from '$lib/stores/player.js'

   /*
      The pile this panel is about. It is set by `open(pile)`, which is what the
      board calls; the prop is the same value arriving from a parent, for a render
      that has no clicks in it (see `tools/render-check.mjs`).
   */
   export let pile = null
   /* opens the panel without a call, for the same reason (see Popup.svelte) */
   export let openOnMount = false

   let popup

   let view = 'natural'

   $: reversedPile = $pile ? $pile.slice().reverse() : []
   $: sortedPile = reversedPile.slice().sort((a, b) => a._id - b._id)

   /*
      The cards this panel is holding, if the selection is its own.

      A pile inspection is a read of a pile, so clicking a card in it selects that
      card off the pile - the same selection a click on the board makes, with the
      same Ctrl to add to it and Ctrl+A for the whole pile (see Popup's ctrlA and
      player.js's selectCard). What this asks is whether that selection is *this*
      pile's, because the selection outlives the panel: it is cleared when the
      board's own click is not stopped, and a card can still be selected on the
      board behind an open panel. The four buttons below are only ever offered for
      the pile the panel is showing, so they cannot move a card the player selected
      somewhere else and then opened a pile over.
   */
   $: selected = $cardSelection.length > 0 && selectionPile === pile
   $: selectedCards = selected ? $cardSelection : []
   $: moves = !$spectating && selected

   export function open (_pile) {
      pile = _pile
      popup.open()
   }

   export function close () {
      popup.close()
   }

   function closeAndShuffle () {
      popup.close()
      shuffle()
   }

   /*
      Where the cards the player picked out of the pile go: the four places a card
      comes out of a deck, a discard or a lost zone into. Three of them are a move
      between piles - `moveSelection` takes the selection, gives it to the target
      and logs it - and the Bench is the other kind of move, since a card put into
      play is a slot with a card under it rather than a card in a list (see
      `toBench`). Both clear the selection and share the move, so the opponent and
      any spectator follow it.
   */
   const movesTo = {
      table: () => moveSelection(table),
      hand: () => moveSelection(hand),
      bench: toBench,
      discard: () => moveSelection(discard)
   }

   /*
      The whole of what one of the four buttons does: the cards the player picked
      go where it says, and the panel closes behind them.

      The shuffle is the deck's, and it is a *shuffle* rather than a tidy-up: a card
      taken out of a deck is a card out of a deck, and what is left of it is
      unknown - the same reason the button below is called Close & Shuffle. The
      other piles are not shuffled: a discard and a lost zone are public and
      ordered, and there is nothing about them for a shuffle to say.

      Closing is what the player means by picking a card out and naming a place for
      it - the decision is made, so the panel gets out from in front of the table -
      and it puts the four buttons on the same footing as the two beside them,
      which is why the move happens first: closing is a popup call, and a popup
      that closed first would have no pile left to read.
   */
   function moveCards (where) {
      movesTo[where]()
      if (pile === deck) shuffle()
      popup.close()
   }
</script>

<Popup bind:this={popup} {openOnMount} flush>
   <div class="flex">
      <button class="flex-1 tab rounded-tl-md" class:active={view === 'natural'} on:click={() => view = 'natural'}>Natural</button>
      <button class="flex-1 tab rounded-tr-md" class:active={view === 'sorted'} on:click={() => view = 'sorted'}>Sorted</button>
   </div>

   <!--
      What the player has picked out of the pile, said in words at the head of the
      grid - the same reading as the order strip an *Order Deck* keeps above its
      cards (see DeckOrder.svelte), for the same reason: a card picked out of a
      pile is one click away from leaving it, and a count and a list is what makes
      "the three I clicked" a thing the player can check before they say where
      they go.

      It is above the grid rather than below it, and outside the scroll container,
      so it stays on screen while the player scrolls down a pile of sixty to pick
      the rest - which is exactly when they want to know what they have. It keeps
      its line whether or not anything is selected, so the grid does not jump the
      moment a card is clicked, and it says what a click does when there is
      nothing to report.
   -->
   <div class="notice p-2 border-b border-black">
      {#if selected}
         <span class="font-bold">{selectedCards.length} {s('card', selectedCards.length)} picked out:</span>
         {selectedCards.map(card => card.name).join(', ')}
      {:else}
         Click a card to pick it out of the pile. Ctrl-click adds to the selection, Ctrl+A takes it all.
      {/if}
   </div>

   <div class="cards focus:outline-none inspection"
      tabindex="0" use:ctrlA on:ctrlA={() => selectPile(pile)}>

      {#if view === 'sorted'}
         {#each sortedPile as card (card._id)}
            <Card {card} pile={pile} />
         {/each}
      {:else}
         {#each reversedPile as card (card._id)}
            <Card {card} pile={pile} />
         {/each}
      {/if}
   </div>

   <svelte:fragment slot="buttons">
      <div class="flex flex-wrap items-start justify-center gap-4">
         <div class="flex flex-col items-stretch gap-2">
            <button class="action" on:click={() => popup.close()}>Close</button>
            {#if pile === deck}
               <button class="action" on:click={closeAndShuffle}>Close & Shuffle</button>
            {/if}
         </div>

         <!--
            The cards the player picked out of the pile, to a zone at the table:
            two by two, beside the buttons that close the panel. Disabled rather
            than hidden when nothing is selected, so the panel's foot does not
            change shape under a click, and a spectator sees the actions it cannot
            take. Each one is the whole decision - the cards go, and the panel
            closes and the deck is shuffled (see moveCards).
         -->
         <div class="grid grid-cols-2 gap-2">
            <button class="action" disabled={!moves} on:click={() => moveCards('table')}>Add to table</button>
            <button class="action" disabled={!moves} on:click={() => moveCards('hand')}>Add to hand</button>
            <button class="action" disabled={!moves} on:click={() => moveCards('bench')}>Add to bench</button>
            <button class="action" disabled={!moves} on:click={() => moveCards('discard')}>Add to discard pile</button>
         </div>
      </div>
   </svelte:fragment>
</Popup>

<style>
   /*
      The grid of cards, and the one place a pile's padding is worked out.

      The grid is as wide as the panel, so a row that does not fill it leaves the
      room it did not use along one side - which is a margin down the right of a
      pile whose cards fit seven to a row, and moves to the left of it at a window
      where they fit six. `justify-content: center` splits that left-over room
      between the two sides, so a row that is not full reads as a grid rather than
      as a row that ran out.

      The left-hand length is the window's edge: the panel is `flush` (Popup.svelte)
      and `--popup-edge` is what it keeps, so the cards sit the same distance from
      the window as the line above them does. There is no panel frame left to pad
      against - see `flush` for why there is not.

      The right-hand length is the same plus the scrollbar. A pile taller than the
      window scrolls, and a vertical scrollbar takes its width out of the box it is
      drawn in - so without this the cards would keep their padding from the left
      edge and their padding *less* the scrollbar from the right one, which puts the
      right-hand gap visibly inside the left-hand one. `--popup-scrollbar` is the
      width it takes back, and it is a value rather than a measurement because CSS
      has no length for "how wide is this scrollbar": 15px is Chrome's on Windows and
      on Linux, and a browser whose bar is a different width is out by that difference
      rather than by the whole padding. A pile short enough not to scroll has no bar
      to take anything, so its right-hand padding is that much wider; this panel is
      opened on a whole pile, so that is the rarer case.
   */
   .cards {
      --popup-scrollbar: 15px;

      @apply flex flex-wrap justify-center gap-1;
      /*
         The left-hand length is the panel's own edge (`--popup-edge`, from `flush`
         in Popup.svelte), so the cards keep the same gap from the window's left edge
         as the line above them and the panel keeps from the top; the fallback is
         what a centred panel would use, where the panel's edge is its own margin
         rather than the window's. The right-hand length is that, less the scrollbar
         - see the note above.
      */
      padding: var(--popup-edge, 0.5rem) calc(var(--popup-edge, 0.5rem) + var(--popup-scrollbar)) var(--popup-edge, 0.5rem) var(--popup-edge, 0.5rem);
   }

   .inspection {
      --card-width: 136px;
      --card-height: 189px;
   }

   button.tab {
      @apply p-2 font-bold;
   }

   button.tab.active {
      @apply text-white bg-[var(--primary-color)];
   }

   button.action {
      @apply px-3 py-2 rounded-lg font-bold text-white bg-[var(--primary-color)];
   }

   /* a pile with nothing picked out of it is not a pile to move anything out of */
   button.action:disabled {
      @apply opacity-50;
   }

   div :global(img.card) {
      --shadow-color: transparent; /* the shadow makes it harder to see the active selection on the gray background */
   }
</style>
