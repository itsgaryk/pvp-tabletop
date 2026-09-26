<script>
   import Card from '../board/Card.svelte'
   import Popup from './Popup.svelte'
   import { ctrlA } from '$lib/actions/customEvents.js'
   import { selectPile } from '$lib/stores/player.js'
   import { reveal, revealView, revealOpen, closeReveal, revealCloseAndShuffle } from '$lib/stores/reveal.js'

   /*
      The Reveal window: the cards **this player** showed to the table.

      It is the same panel a pile's view is - the same `Card`, the same scroll
      container, the same foot of actions - because it is the same thing being
      read: a list of cards out of a pile. What it is not is a view *of* a pile: it
      holds the cards of one gesture rather than the contents of a zone, so it has
      no Natural/Sorted tabs (there is one order - the order the deck was read in -
      and it is the order they were revealed in), and no four move buttons (those
      are where a *search* takes a card out of a deck to, and a reveal is not a
      search: the cards are not the revealer's to move).

      **Only the player who took the reveal sees it**, and that is the whole of its
      audience: the cards travel to every board as a batch - that is the permission, so
      an opponent can still act on a card they can see on the board - but the *window* is
      the revealer's, and everyone else is told by the game log, which names the cards
      (see `cardsRevealed` in reveal.js). It is drawn from this client's own copy of the
      batch, so nothing is relayed to draw it: what travels is what was shown.

      A card in here is right-clicked like any other card, and for a card of the
      *other* player's side the menu is the opponent-card menu - which is the whole
      of what the "allowed to take action" property buys (see
      `opponent/Card.svelte` and docs/reveal.md). The `pile` a card is handed is
      the reveal's own selection rather than a store, which is what makes a click
      in this panel a selection like any other (see `selectCard`).
   */

   /*
      A window that draws itself open, for a render that has no event and no click
      to open it with (`tools/render-check.mjs`).

      It is handed straight to `<Popup>`'s own `openOnMount`, which is the same prop
      a pile inspection uses and for the same reason: a panel draws nothing until a
      call opens it, and a call is a click or an event that a render to a string
      does not have. Off everywhere in the app - a Reveal is opened by the relay
      event that states its batch, and by nothing else.
   */
   export let renderOpen = false

   let popup

   /*
      The cards on show, top of the deck first - the batch's live view, so a card
      that has been moved out of the deck goes from the window.

      The batch holds card *ids* and resolves them against the deck it is a view of,
      which is the only way this can work between two boards: a mirror holds copies
      of the cards, not the cards themselves (see `asPile` in reveal.js). `get()` is
      the shape a pile has, so `Ctrl+A`'s `selectPile` and the card menu's `cardPile`
      can be handed this the way they are handed a pile.
   */
   /*
      The cards on show, top of the deck first.

      `revealView` is a store of its own rather than `$reveal.pile.get()`, and the
      difference is the whole reason it exists: the view is pushed by a subscription
      to the *deck*, so a card that leaves the deck leaves the window - including on
      the owner's own board, where the move writes no event for anything else to see.
      `pile` is the batch in a pile's shape, which is what a card is handed so that
      clicking one selects it (see `board/Card.svelte`).
   */
   $: cards = $revealView
   $: pile = $reveal?.pile || null
   /*
      Whose deck this is, in *this* board's words: `ownerHere` was worked out when the
      batch was applied (see `localOwner` in reveal.js), so the heading is a field
      rather than a second copy of the mapping.
   */
   $: owner = $reveal?.ownerHere === 'mine' ? 'Your deck' : "Your opponent's deck"

   /*
      The window follows the batch, both ways, and it is opened by a *call* rather
      than by the batch's arrival: `Popup` draws nothing until `open()` (see the
      note there), and the batch is set by a relay event rather than by a click, so
      this is the one place the two are tied together. The `renderOpen` case never
      reaches it - that render has already opened the panel - and the close half is
      guarded so that it cannot shut a panel the render asked to be open.

      What closes it is the batch being **ended**, not the grid running out of cards -
      `$revealOpen` is that answer, and it is the only one used here. Closing on
      `!cards.length` read "nothing left to show" as "the window is over", and the two
      are not the same: the cards on show are a *view of the deck*, so acting on the
      last one off a reveal empties it, and the window used to close itself the instant
      the player did the thing the window exists to let them do. On a Look that took
      the Close & Shuffle button with it - the player had moved the top two cards and
      was left with no way to shuffle the deck they had just read, which is the one
      ending that kind of card has (reported as *the look window closes with a
      shuffle* failing, with the shuffle still owed). A window with no cards in it and
      its endings still on it is the honest picture: the batch is still live, and the
      deck has not been put back yet.

      `$reveal` is in the condition as well as `$revealOpen`, and that is not
      belt-and-braces either: a panel closed by a click outside or by Escape goes
      through `Popup`'s own close, which does **not** tell this store - so `$revealOpen`
      stays true across it, and the *next* batch then changes a store that is already
      true. The open half would have had nothing new to see and the window would never
      come back. The batch is the thing that is certainly new.
   */
   $: if (popup && $reveal && $revealOpen && !popup.opened()) popup.open()
   $: if (popup && !renderOpen && !$revealOpen && popup.opened()) popup.close()

   /* the whole batch, the same gesture a pile's view answers Ctrl+A with */
   function selectAll () {
      if (pile) selectPile(pile)
   }
</script>

<Popup bind:this={popup} openOnMount={renderOpen} on:closed={closeReveal}>
   <div class="p-2 border-b border-black">
      <div class="font-bold">Revealed — {owner}</div>
      <div class="text-sm text-[var(--text-color-two)]">
         {cards.length} {cards.length === 1 ? 'card' : 'cards'} · both players can see these
      </div>
      {#if cards.length}
         <div class="hint">
            Click a card to pick it out, Ctrl-click to add, Ctrl+A for all — then right-click
            one to act on its owner's board, or drag one onto it.
         </div>
      {/if}
   </div>

   <div class="cards focus:outline-none inspection"
      tabindex="0" use:ctrlA on:ctrlA={selectAll}>
      {#each cards as card (card._id)}
         <Card {card} {pile} />
      {/each}
   </div>

   <!--
      One button at a time, and never two: Close &amp; Shuffle until the deck has been
      shuffled, Close after. There is deliberately no Close beside the shuffle, for the
      same reason the Look window has none (reported as *remove the "Close" button*): a
      reveal's whole point is that the order the cards were read in does not survive it,
      so a button that closes the window and puts the deck back exactly as it was is the
      one ending this window should not offer. Escape and a click outside still close it
      without shuffling, which is how every panel in the app closes.

      **Once the reveal has been shuffled, the button is Close** and nothing else. A
      reveal is one act with one deck and one ending, so a second shuffle of a deck that
      has already been shuffled would be two endings for one gesture - and a deck
      rearranged a second time for no reason at all. The `shuffled` flag arrives with the
      event, so the button this window offers never depends on who pressed it.

      **Only the revealer is here to press anything**: everyone else was told by the game
      log, which names the cards (see `cardsRevealed` in reveal.js). An opponent can still
      act on a card they can see on the board - the batch is the permission - and the
      endings belong to the player who made the reveal.
   -->
   <svelte:fragment slot="buttons">
      {#if $reveal?.shuffled}
         <button class="action" on:click={() => popup.close()}>Close</button>
      {:else}
         <button class="action" on:click={revealCloseAndShuffle}>Close &amp; Shuffle</button>
      {/if}
   </svelte:fragment>
</Popup>

<style>
   /*
      The same fixed window a pile's view is: one full row of cards, so a reveal of
      two opens the same panel a reveal of ten does and the panel does not resize
      with the batch. It is the same rule `Inspection.svelte` states in full, and it
      is repeated here rather than shared because a component's styles are its own -
      and because the padding is not the same: there is no scrollbar to allow for
      when the batch is at most a handful of cards, so this grid keeps one padding
      on both sides.
   */
   .cards {
      @apply flex flex-wrap justify-center gap-1 p-2;
      width: max-content;
      max-width: 100%;
   }

   .inspection {
      --card-width: 136px;
      --card-height: 189px;
   }

   .hint {
      @apply text-xs mt-1;
      color: var(--text-color-two);
      max-width: 34rem;
   }

   button.action {
      @apply px-3 py-2 rounded-lg font-bold text-white bg-[var(--primary-color)];
   }

   div :global(img.card) {
      --shadow-color: transparent;
   }
</style>
