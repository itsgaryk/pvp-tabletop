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

   /*
      Which pile this is, for the panel to say out loud and to colour itself by - and
      which is therefore also what decides what the panel *offers*.

      A pile view is the same dialog for every pile, so without this a deck, a
      discard and a lost zone are one screen with different cards in it: there is
      nothing on the panel to say which one it is, and nothing to make two of them
      side by side read as two views rather than one. The name and the colour come
      from the pile's own store name - the one vocabulary the board, the log and the
      wire all agree on (see docs/terminology.md) - so a pile cannot be given a
      label that does not belong to it.

      A pile with no entry is a pile nobody has a view for: `pickup` is a phase
      rather than a zone, and it is shown by the multi-card dialog instead.
   */
   const ZONES = {
      deck: { label: 'Deck', accent: '#4f7fd4' },
      hand: { label: 'Hand', accent: '#1ca492' },
      discard: { label: 'Discard', accent: '#b4544a' },
      lz: { label: 'Lost Zone', accent: '#8b5cf6' },
      prizes: { label: 'Prizes', accent: '#d9a521' },
      table: { label: 'Table', accent: '#94a3b8' },
      stadium: { label: 'Stadium', accent: '#3f9e63' }
   }

   $: zone = ZONES[pile?.name] || { label: pile?.name || 'Pile', accent: 'var(--primary-color)' }
   /*
      The deck is the pile the four moving buttons belong to: they are the four
      places a *search* takes a card out of a deck to, which is the move this panel
      was built around. A discard and a lost zone are public and ordered, so their
      view is a read - the cards, and the one button that closes it (see
      docs/selection.md).
   */
   $: isDeck = pile === deck

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
      comes out of a deck into. Three of them are a move between piles -
      `moveSelection` takes the selection, gives it to the target and logs it - and
      the Bench is the other kind of move, since a card put into play is a slot with
      a card under it rather than a card in a list (see `toBench`). Both clear the
      selection and share the move, so the opponent and any spectator follow it.
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
      unknown - the same reason the button below is called Close & Shuffle. Nothing
      else is shuffled: a discard and a lost zone are public and ordered, and there
      is nothing about them for a shuffle to say.

      Closing is what the player means by picking a card out and naming a place for
      it - the decision is made, so the panel gets out from in front of the table -
      and it puts the four buttons on the same footing as the two beside them,
      which is why the move happens first: closing is a popup call, and a popup
      that closed first would have no pile left to read.
   */
   function moveCards (where) {
      movesTo[where]()
      if (isDeck) shuffle()
      popup.close()
   }
</script>

<Popup bind:this={popup} {openOnMount}>
   <div class="flex">
      <button class="flex-1 tab rounded-tl-md" class:active={view === 'natural'} on:click={() => view = 'natural'}>Natural</button>
      <button class="flex-1 tab rounded-tr-md" class:active={view === 'sorted'} on:click={() => view = 'sorted'}>Sorted</button>
   </div>

   <!--
      Which pile this is: its name, how many cards are in it, and the one colour that
      is that zone's own (see ZONES). A pile view is one dialog for every pile, so
      without a heading of its own a deck, a discard and a lost zone are the same
      screen with different cards in it - and the colour is what says which one it is
      from across the table, without reading anything.

      The count is `$pile`'s length and not `pile`'s: the prop is the *store*, and a
      store has no length - `pile?.length ?? 0` reads as zero cards in every pile
      ever opened, silently, because the fallback is a number. It is the mistake the
      `$` exists to prevent and it is invisible on screen until somebody counts the
      cards in a view that says 0. The render check counts them (see
      `tools/render-check.mjs`).
   -->
   <div class="zone p-2 border-b border-black" style="--zone-accent: {zone.accent}">
      <span class="swatch"></span>
      <span class="font-bold">{zone.label}</span>
      <span class="count">{$pile?.length ?? 0} {s('card', $pile?.length ?? 0)}</span>
   </div>

   <!--
      What the player has picked out of the pile, said in words under the heading -
      the same reading as the order strip an *Order Deck* keeps above its cards (see
      DeckOrder.svelte), for the same reason: a card picked out of a pile is one
      click away from leaving it, and a count and a list is what makes "the three I
      clicked" a thing the player can check before they say where they go.

      It is above the grid rather than below it, and outside the scroll container,
      so it stays on screen while the player scrolls down a pile of sixty to pick
      the rest - which is exactly when they want to know what they have. It keeps
      its line whether or not anything is selected, so the grid does not jump the
      moment a card is clicked, and it says what a click does when there is nothing
      to report.
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
            {#if isDeck}
               <button class="action" on:click={closeAndShuffle}>Close & Shuffle</button>
            {/if}
         </div>

         <!--
            The cards the player picked out of the pile, to a zone at the table: two
            by two, beside the buttons that close the panel - and only in the deck's
            view, because they are the four places a *search* takes a card out of a
            deck to, which is the move this panel exists for. A discard and a lost
            zone are read and closed: nothing comes out of them into play.

            Disabled rather than hidden when nothing is selected, so the panel's foot
            does not change shape under a click, and a spectator sees the actions it
            cannot take. Each one is the whole decision - the cards go, and the panel
            closes and the deck is shuffled (see moveCards).
         -->
         {#if isDeck}
            <div class="grid grid-cols-2 gap-2">
               <button class="action" disabled={!moves} on:click={() => moveCards('table')}>Add to table</button>
               <button class="action" disabled={!moves} on:click={() => moveCards('hand')}>Add to hand</button>
               <button class="action" disabled={!moves} on:click={() => moveCards('bench')}>Add to bench</button>
               <button class="action" disabled={!moves} on:click={() => moveCards('discard')}>Add to discard pile</button>
            </div>
         {/if}
      </div>
   </svelte:fragment>
</Popup>

<style>
   /*
      Which pile this is, said in a heading of its own: a colour bar in the zone's
      colour, the zone's name, and how many cards are in it.

      The colour is the whole of why this is here rather than the count alone. A pile
      view is one dialog for every pile, so two of them open side by side - which is
      how a player reads a deck against a discard - are the same panel with different
      cards in it: the bar is what tells them apart at a glance, and the name is what
      settles it. The colour arrives as `--zone-accent` from `ZONES`, so there is one
      place a zone's colour is decided rather than one per zone.
   */
   .zone {
      @apply flex items-center gap-2 border-b border-black;
   }

   .zone .swatch {
      @apply rounded-sm;
      width: 0.75rem;
      height: 0.75rem;
      background-color: var(--zone-accent);
   }

   /*
      The count is the pile's own length, drawn the way the pile's badge on the board
      draws it: the number, and then whether it is one card or several.
   */
   .zone .count {
      @apply text-sm;
      color: var(--text-color-two);
   }

   /*
      The grid of cards, and the one place a pile's padding is worked out.

      `width: max-content` is what makes the panel a *fixed window* rather than one
      the pile sizes: without it the grid is as wide as the panel, the panel is only
      as wide as the grid, and the two settle on however many cards the longest row
      happened to hold - so a pile of three opened a narrow panel, a pile of sixty a
      wide one, and the panel changed size as cards were moved in and out of it. With
      it the grid is the width of one full row of 136px cards, always: about seven of
      them, and a short pile is short *inside* a window of that same size. Nothing
      about the panel then depends on how many cards there are, which is also why it
      needs no placement of its own - the base rule centres it, and a fixed box that
      is centred stays where it is put.

      `max-width: 100%` is the one case where the window is not the size it says it
      is: a window too narrow for a full row has to fit in it anyway, so the grid takes
      the room there is and the cards wrap to fewer to a row.

      The right-hand padding is the left-hand padding plus the scrollbar. A pile
      taller than the window scrolls, and a vertical scrollbar takes its width out of
      the box it is drawn in - so without this the cards would keep their padding from
      the left edge and their padding *less* the scrollbar from the right one, which
      puts the right-hand gap visibly inside the left-hand one. `--popup-scrollbar` is
      the width it takes back, and it is a value rather than a measurement because CSS
      has no length for "how wide is this scrollbar": 15px is Chrome's on Windows and
      on Linux, and a browser whose bar is a different width is out by that difference
      rather than by the whole padding. A pile short enough not to scroll has no bar
      to take anything, so its right-hand padding is that much wider.

      `justify-content: center` is what a row that is not full does with the room it
      did not use: it splits it between the two sides, so the last row of a pile reads
      as a grid rather than as a row that ran out.

      `--popup-padding` is the one length both paddings are worked out from, so a
      change to how close the cards sit to the panel's edge is a change to one number.
   */
   .cards {
      --popup-padding: 0.5rem;
      --popup-scrollbar: 15px;

      @apply flex flex-wrap justify-center gap-1;
      width: max-content;
      max-width: 100%;
      padding: var(--popup-padding) calc(var(--popup-padding) + var(--popup-scrollbar)) var(--popup-padding) var(--popup-padding);
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
