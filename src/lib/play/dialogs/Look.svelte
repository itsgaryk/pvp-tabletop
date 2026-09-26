<script>
   import { ctrlA } from '$lib/actions/customEvents.js'
   import Card from '../opponent/Card.svelte'
   import Popup from './Popup.svelte'
   import { selectPile } from '$lib/stores/player.js'
   import { seatedPlayers, spectating } from '$lib/stores/connection.js'
   import { look, lookView, lookOpen, closeLook, lookCloseAndShuffle } from '$lib/stores/reveal.js'

   /*
      The Look window: the cards a Look put on show - the player's own reading, or,
      on a watcher's board, the reading it is watching.

      It is the Reveal window's twin and deliberately not the same component. The
      two differ in three ways that matter, and each of them is a rule rather than
      a style:

         - the audience: a Look is shown to the player who took it and to the room's
           watchers, and never to the owner of the deck that was read
         - the cards: they belong to the other player, so they are drawn by the
           *far half's* card component, which is the one that knows a card of the
           other side can be clicked and right-clicked when the property allows it
         - the ending: Close & Shuffle shuffles the other player's deck, which is
           shared, while the window itself is not - and it belongs to the looker
           alone, so a watcher's window has Close and nothing else

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

   /*
      Whose deck this is. The looker knows without being told - it is the opponent's,
      by definition - and a **watcher** has to be: its board mirrors both players, so
      "the opponent's deck" names no half of its screen. `$look.seat` is the seat the
      looker was reading, which is the only thing either board can agree on, and the
      relay's own list is where the name for it comes from.

      Read off the store here rather than through `lookSeat()` in reveal.js, and that
      is not a style choice: `$: seat = lookSeat()` compiles to a statement whose only
      input a compiler can see is nothing at all, and the heading then kept the value
      it was first built with - a watcher's window always read "your opponent's deck"
      however sure the store was that the seat was seat 0.
   */
   $: seat = $look ? $look.seat : null
   $: whose = seat === null ? "your opponent's deck" : `${nameOf(seat)}'s deck`

   function nameOf (index) {
      const player = $seatedPlayers[index]
      return player?.name || `Player ${index + 1}`
   }

   /*
      The window follows the batch: opened by a call, closed by the batch being ended
      (`$lookOpen`), and **not** by the grid emptying - see the longer note in
      `Reveal.svelte`, which is the same rule for the same reason. It matters more
      here, because the looker's only ending is Close & Shuffle: closing on
      `!cards.length` took that button away exactly when a player had acted on every
      card they looked at and still owed the deck a shuffle.

      `$look` is in the condition for the same reason it is in Reveal's: a panel closed
      by Escape or a click outside leaves `$lookOpen` true, so the next look has to be
      noticed by its *batch* rather than by the flag.
   */
   $: if (popup && $look && $lookOpen && !popup.opened()) popup.open()
   $: if (popup && !renderOpen && !$lookOpen && popup.opened()) popup.close()

   /* the whole batch: the same gesture a pile's view answers Ctrl+A with */
   function selectAll () {
      if (pile) selectPile(pile)
   }
</script>

<Popup bind:this={popup} openOnMount={renderOpen} on:closed={closeLook}>
   <div class="p-2 border-b border-black">
      <div class="font-bold">Look — {whose}</div>
      <div class="text-sm text-[var(--text-color-two)]">
         {cards.length} {cards.length === 1 ? 'card' : 'cards'} ·
         {#if $spectating}the table is shown this look{:else}only you can see these{/if}
      </div>
      <!--
         What a click does, said out loud, because nothing on the card says it: the Look
         window's cards do not pulse (see `pulse` in opponent/Card.svelte), so a ring that
         appears *after* a click is the only feedback there is - and "I cannot select the
         cards" is what a window with no hint and no pulse reports as.

         A watcher gets the other half of that sentence, because for it there is nothing
         to click: a Look travels so that the table can *see* one, and the cards are still
         only the looker's to move (`isActionable` refuses a spectator).
      -->
      {#if cards.length && !$spectating}
         <div class="hint">
            Click a card to pick it out, Ctrl-click to add, Ctrl+A for all — then right-click
            one to act on your opponent's board, or drag one onto it.
         </div>
      {:else if cards.length}
         <div class="hint">
            A Look the table can watch: {whose.replace(/'s deck$/, '')} is reading the top of this
            deck, and the cards are theirs to move.
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
      Close &amp; Shuffle for the player who took the look, and Close for a watcher.

      A Look has one ending rather than two, because the deck it is of is the *other
      player's*: looking at the top of somebody's deck and putting it back in the order
      you found it is a look that leaves no trace but is also the one ending a card that
      says "look at the top X" never has. The shuffle is what the look is for, and the
      panel is finished when it happens - so a second button that only closed the window
      was a choice between the same thing and less (reported as *the look window should
      not have a Close button*).

      Once the shuffle has been made the window stays open with its cards and its
      **no** buttons at all: the ending has happened, and what is left is a reading that
      the player closes the way every other panel in the app closes - Escape, or a click
      outside (`closeLook`). That is the same shape the pile view has for a panel whose
      one action has been taken.

      **A watcher gets Close and nothing else**, for the reason the reveal's window gives
      a spectator nothing to press: a shuffle is somebody else's deck changing, and the
      batch on a watcher's board is not its own look to end. Close is what a read-only
      panel has, which is the shape every inspection dialog in the app already has.

      Escape and an outside click are deliberately left working, because they are how a
      Svelte `Popup` closes everywhere and taking them away would trap a window with no
      button on it.
   -->
   <svelte:fragment slot="buttons">
      {#if $spectating}
         <button class="action" on:click={() => popup.close()}>Close</button>
      {:else if !$look?.shuffled}
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
