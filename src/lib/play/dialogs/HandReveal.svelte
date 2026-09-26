<script>
   import { ctrlA } from '$lib/actions/customEvents.js'
   import Card from '../opponent/Card.svelte'
   import Popup from './Popup.svelte'
   import { selectPile } from '$lib/stores/player.js'
   import { spectating } from '$lib/stores/connection.js'
   import { handReveal, handRevealView, handRevealOpen, closeHandReveal } from '$lib/stores/reveal.js'

   /*
      The Reveal Hand window: the whole of one player's hand, shown to the player who asked
      for it.

      It is `Look.svelte` with the pile changed and the ending taken away, and it is a copy
      rather than a parameter for the same reason the Look window is a copy of the Reveal
      window rather than the same component: the differences are rules, and a rule that is
      a prop is a rule a caller can pass wrongly. All three windows draw cards out of a
      pile that is not the reader's, so all three share the far half's card component - and
      the three do not share an *ending*, which is the thing each of them states for
      itself:

         - a Reveal ends with Close &amp; Shuffle, because the top of a deck was read and the
           order it was read in should not survive it
         - a Look ends with Close &amp; Shuffle, because the deck is the other player's
         - a Reveal Hand ends with **Close and nothing else**: a hand is not read in an
           order, so there is no order to lose, and there is no deck to put back. A
           shuffle here would rearrange a player's hand for no reason at all.

      The audience is the Look's - the player who asked, and the room's watchers - and is
      decided by the relay rather than here (see `handRevealed` and `audienceOf`). The
      hand's owner is shown the log line and their own hand turning face up, and is not
      handed the ids: a hand is the pile its owner does not read, and an id out of one is
      exactly what it withholds.

      A card in here behaves like a card in a Reveal or a Look, because it *is* one: the
      batch it was handed is the permission (`isActionable`), so it can be clicked, added
      to with Ctrl-click, taken whole with Ctrl+A, right-clicked for the opponent-card
      menu, and dragged onto its owner's zones. That is what was asked for - *card
      selection in the Reveal Hand window should be the same as the card selection in
      Reveal and Look windows* - and it is not implemented here: the window hands the card
      the same batch-shaped pill the other two do, and everything downstream is the same
      code.
   */

   /*
      Opens from the batch already in the store, for a render that has no click to make
      (`tools/render-check.mjs`). Off everywhere in the app: a Reveal Hand is opened by the
      hand's own menu entry and by nothing else. See the same prop in `Reveal.svelte`.
   */
   export let renderOpen = false

   let popup

   /*
      The cards on show, in the order the hand holds them.

      `handRevealView` is a store of its own, pushed by a subscription to the hand, so a
      card that leaves the hand leaves the window - including on the owner's own board,
      where a move writes no event for anything else to see (see `viewOf` in reveal.js).
      `pile` is the batch in a pile's shape, which is what a card is handed so that
      clicking one selects it.
   */
   $: cards = $handRevealView
   $: pile = $handReveal?.pile || null

   /*
      The window follows the batch, opened by a call and closed by the batch being ended -
      not by the grid emptying (see the longer note in `Reveal.svelte`, which is the same
      rule for the same reason). `$handReveal` is in the condition as well as
      `$handRevealOpen`, because a panel closed by Escape or a click outside leaves the flag
      true and the *next* batch then has to be what brings it back.
   */
   $: if (popup && $handReveal && $handRevealOpen && !popup.opened()) popup.open()
   $: if (popup && !renderOpen && !$handRevealOpen && popup.opened()) popup.close()

   /* the whole batch: the same gesture a pile's view answers Ctrl+A with */
   function selectAll () {
      if (pile) selectPile(pile)
   }
</script>

<Popup bind:this={popup} openOnMount={renderOpen} on:closed={closeHandReveal}>
   <div class="p-2 border-b border-black">
      <div class="font-bold">Revealed Hand</div>
      <div class="text-sm text-[var(--text-color-two)]">
         {cards.length} {cards.length === 1 ? 'card' : 'cards'} ·
         {#if $spectating}the table is shown this hand{:else}only you can see this hand{/if}
      </div>
      <!--
         What a click does, said out loud, because nothing on the card says it: a window's
         cards do not pulse (`pulse={false}` here, for the same reason a Look turns it off -
         every card in the window answers, so a glow on all of them is decoration), so a
         ring that appears *after* a click is the only feedback there is. "I cannot select
         the cards" is what a window with no hint and no pulse reports as, which is how the
         Look window's own hint came to be written.

         A watcher gets the other half of that sentence, because for it there is nothing to
         click: a spectator is refused by `isActionable`.
      -->
      {#if cards.length && !$spectating}
         <div class="hint">
            Click a card to pick it out, Ctrl-click to add, Ctrl+A for all — then right-click
            one to act on its owner's board, or drag one onto it.
         </div>
      {:else if cards.length}
         <div class="hint">
            A Reveal Hand the table can watch: the cards are their owner's to move, and this
            window is a reading of it.
         </div>
      {/if}
   </div>

   <div class="cards focus:outline-none inspection"
      tabindex="0" use:ctrlA on:ctrlA={selectAll}>
      {#each cards as card (card._id)}
         <Card {card} {pile} revealed={true} pulse={false} />
      {/each}
   </div>

   <!--
      **Close, and only Close.** There is no shuffle and so there is no *Close &amp;
      Shuffle*: the two things that ending exists for are both about a deck (the order the
      top was read in, and the fact that the deck belongs to somebody else), and neither is
      true of a hand. So this is the shape every read-only panel in the app has - one
      button that closes it - with Escape and an outside click left working as they are
      everywhere.
   -->
   <svelte:fragment slot="buttons">
      <button class="action" on:click={() => popup.close()}>Close</button>
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
