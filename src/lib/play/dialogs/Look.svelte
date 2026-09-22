<script>
   import { ctrlA } from '$lib/actions/customEvents.js'
   import Card from '../opponent/Card.svelte'
   import Popup from './Popup.svelte'
   import { selectPile } from '$lib/stores/player.js'
   import { look, lookView, lookOpen, closeLook, lookCloseAndShuffle } from '$lib/stores/reveal.js'

   /*
      The Look window: the cards *this* player was shown privately.

      It is the Reveal window's twin and deliberately not the same component. The
      two differ in three ways that matter, and each of them is a rule rather than
      a style:

         - the audience: a Look is shown to one player, so nothing about it is
           shared and nothing about it may be (see `reveal.js`)
         - the cards: they belong to the other player, so they are drawn by the
           *far half's* card component, which is the one that knows a card of the
           other side can be clicked and right-clicked when the property allows it
         - the ending: Close & Shuffle shuffles the other player's deck, which is
           shared, while the window itself is not

      That is the same split the board itself makes between `board/` and
      `opponent/`: the two halves are two components because a card on the far half
      is not the same object as a card on the near one.
   */

   /*
      Opens from the batch already in the store, for a render that has no click to
      make (`tools/render-check.mjs`). It goes straight to `<Popup>`'s own
      `openOnMount`, and it is off everywhere in the app: a Look is opened by the
      deck's own menu entry and by nothing else. See the same prop in
      `Reveal.svelte`.
   */
   export let renderOpen = false

   let popup

   /*
      The cards on show, top of the deck first - the order the deck is read in, so
      the first card of the grid is the card that would be drawn next.

      `lookView` is a store of its own, pushed by a subscription to the deck, so a
      card that leaves the deck leaves the window (see `revealView` in reveal.js).
      `pile` is the batch in a pile's shape, which is what a card is handed.
   */
   $: cards = $lookView
   $: pile = $look?.pile || null

   $: if (popup && $lookOpen && cards.length && !popup.opened()) popup.open()
   $: if (popup && !renderOpen && (!cards.length || !$lookOpen) && popup.opened()) popup.close()

   /* the whole batch: the same gesture a pile's view answers Ctrl+A with */
   function selectAll () {
      if (pile) selectPile(pile)
   }
</script>

<Popup bind:this={popup} openOnMount={renderOpen} on:closed={closeLook}>
   <div class="p-2 border-b border-black">
      <div class="font-bold">Look — your opponent's deck</div>
      <div class="text-sm text-[var(--text-color-two)]">
         {cards.length} {cards.length === 1 ? 'card' : 'cards'} · only you can see these
      </div>
   </div>

   <div class="cards focus:outline-none inspection"
      tabindex="0" use:ctrlA on:ctrlA={selectAll}>
      {#each cards as card (card._id)}
         <Card {card} {pile} revealed={true} />
      {/each}
   </div>

   <!--
      Close, and Close &amp; Shuffle while there is still a shuffle to make. A Look is
      private, so only this player ever sees the pair - but the flag is the batch's,
      the same field the Reveal window reads, so the two windows cannot disagree about
      whether the deck has been shuffled.
   -->
   <svelte:fragment slot="buttons">
      <button class="action" on:click={() => popup.close()}>Close</button>
      {#if !$look?.shuffled}
         <button class="action" on:click={lookCloseAndShuffle}>Close &amp; Shuffle</button>
      {/if}
   </svelte:fragment>
</Popup>

<style>
   /* the Reveal window's grid, and the reasons there: a fixed one-row window */
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
