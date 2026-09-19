<script>
   import { getContext } from 'svelte'
   import ContextMenuOption from '$lib/components/ContextMenuOption.svelte'
   import Pile from './Pile.svelte'
   import Card from './Card.svelte'
   import { defaultOpponent } from '$lib/stores/opponent.js'
   import { spectating } from '$lib/stores/connection.js'
   import {
      solo, soloTogglePrizes, soloShufflePrizes,
      soloShufflePrizesIntoDeck, soloShufflePrizesToBottom
   } from '$lib/stores/solo.js'

   const { openOppPile } = getContext('boardActions')

   /* which player's board this component shows */
   export let store = defaultOpponent
   $: ({ prizes, prizesFlipped } = store)

   let menu

   /* a spectator may look through either player's prizes (read-only, no log) */
   function view () {
      if (!$spectating) return
      openOppPile(prizes)
   }

   function toggle () {
      soloTogglePrizes()
      menu.close()
   }

   function shuffle () {
      soloShufflePrizes()
      menu.close()
   }

   function shuffleBack () {
      soloShufflePrizesIntoDeck()
      menu.close()
   }

   function shuffleBackBottom () {
      soloShufflePrizesToBottom()
      menu.close()
   }
</script>

<Pile pile={prizes} name="Prizes" showMenu={$solo} bind:menu={menu}>
   <div class="prizes" on:click|stopPropagation={view}>
      {#each $prizes as card (card._id)}
         <Card {card} pile={prizes} revealed={$prizesFlipped || $spectating} />
      {/each}
   </div>

   <!-- in solo the other half's prizes are yours to manage, as your own are -->
   <svelte:fragment slot="menu">
      <ContextMenuOption click={toggle} text={$prizesFlipped ? 'Hide Prizes' : 'Show Prizes'} />
      <ContextMenuOption click={shuffle} text="Shuffle" />
      <ContextMenuOption click={shuffleBack} text="Shuffle All Into Deck" />
      <ContextMenuOption click={shuffleBackBottom} text="Shuffle All to Bottom of Deck" />
      <ContextMenuOption click={() => openOppPile(prizes)} text="View All" />
   </svelte:fragment>
</Pile>

<style>
   /*
      The same shape as the near half's: the prizes are a block of two columns that
      fills the zone, so the block is centred in the zone as a whole rather than
      card by card, and its columns and rows share the zone between them.
   */
   .prizes {
      /* content-sized cells, so two prizes in a row touch (see the near half) */
      display: grid;
      grid-template-columns: repeat(2, auto);
      grid-auto-rows: auto;
      place-content: center;
      width: 100%;
      height: 100%;
      gap: 0;
      padding: 0;
      box-sizing: border-box;
   }

   /*
      And each prize is sized by its own cell of that block, with the cards next to
      each other: the transparent 2px border a card carries is not part of the block
      (see the near half), and the selection is drawn inside the card instead. The
      whole selector is global because the card is drawn by Card.svelte, which does
      not carry this component's scope - a scoped `img.card` would not reach it.
   */
   :global(.prizes > div) {
      border-width: 0 !important;
   }

   :global(.prizes img.card.selected) {
      outline: 2px solid var(--selection-color);
      outline-offset: 0;
   }

   :global(.prizes img.card) {
      width: min(
         calc(100cqw / 2),
         calc((100cqh / 3) * var(--card-ratio))
      );
   }
</style>
