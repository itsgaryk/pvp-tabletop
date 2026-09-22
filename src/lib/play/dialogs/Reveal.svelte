<script>
   import Card from '../board/Card.svelte'
   import Popup from './Popup.svelte'
   import { ctrlA } from '$lib/actions/customEvents.js'
   import { selectPile } from '$lib/stores/player.js'
   import { reveal, revealOpen, closeReveal, revealCloseAndShuffle } from '$lib/stores/reveal.js'

   /*
      The Reveal window: the cards one player showed to both of them.

      It is the same panel a pile's view is - the same `Card`, the same scroll
      container, the same foot of actions - because it is the same thing being
      read: a list of cards out of a pile. What it is not is a view *of* a pile: it
      holds the cards of one gesture rather than the contents of a zone, so it has
      no Natural/Sorted tabs (there is one order - the order the deck was read in -
      and it is the order they were revealed in), and no four move buttons (those
      are where a *search* takes a card out of a deck to, and a reveal is not a
      search: the cards are not the revealer's to move).

      Both players see this window, because a Reveal is a shared act. It is drawn
      from each client's own copy of the batch (`reveal.js`), so the two windows
      are the same cards in the same order without a window ever being relayed:
      what travels is what was shown, and this is how each board draws it.

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
      The cards on show, top of the deck first.

      The batch holds card *objects* - taken from the pile the reveal named when
      the event was applied - so a card that has left the deck since is simply not
      one of them any more, which is the right answer: it is no longer one of the
      cards that were shown. `get()` is the one method every caller of a pile needs
      (`Ctrl+A`'s `selectPile`, and the card menu's `cardPile`), so the batch is
      handed about in the same shape a pile is.
   */
   $: cards = $reveal?.cards || []
   $: owner = $reveal?.owner === 'mine' ? 'Your deck' : "Your opponent's deck"
   /* the batch, in the shape a pile has, which is what a card needs (see `asPile`) */
   $: pile = $reveal?.pile || null

   /*
      The window follows the batch, both ways, and it is opened by a *call* rather
      than by the batch's arrival: `Popup` draws nothing until `open()` (see the
      note there), and the batch is set by a relay event rather than by a click, so
      this is the one place the two are tied together. The `renderOpen` case never
      reaches it - that render has already opened the panel - and the close half is
      guarded so that it cannot shut a panel the render asked to be open.
   */
   $: if (popup && $revealOpen && cards.length && !popup.opened()) popup.open()
   $: if (popup && !renderOpen && (!cards.length || !$revealOpen) && popup.opened()) popup.close()

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
   </div>

   <div class="cards focus:outline-none inspection"
      tabindex="0" use:ctrlA on:ctrlA={selectAll}>
      {#each cards as card (card._id)}
         <Card {card} {pile} />
      {/each}
   </div>

   <!--
      Close, and Close &amp; Shuffle: the same pair the deck's own view carries,
      for the same reason. A shuffle is the *deck's* state rather than the
      window's, so it is shared with the other player - and the deck it is about is
      the one the batch names, which is why the action comes from the store rather
      than being written here (see `revealCloseAndShuffle`).
   -->
   <svelte:fragment slot="buttons">
      <button class="action" on:click={() => popup.close()}>Close</button>
      <button class="action" on:click={revealCloseAndShuffle}>Close &amp; Shuffle</button>
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

   button.action {
      @apply px-3 py-2 rounded-lg font-bold text-white bg-[var(--primary-color)];
   }

   div :global(img.card) {
      --shadow-color: transparent;
   }
</style>
