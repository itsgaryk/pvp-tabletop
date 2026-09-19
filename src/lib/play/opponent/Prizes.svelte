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

   /*
      The same cascade as the near half's: two columns, and each row overlapping the
      one above it, with the rows sharing the zone's height (see the near half for
      the arithmetic).
   */
   const COLUMNS = 2
   const OVERLAP = 0.3

   $: rows = Math.max(1, Math.ceil($prizes.length / COLUMNS))
   $: layout = { '--rows': rows, '--overlap': OVERLAP, '--columns': COLUMNS }

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
   <div class="prizes" style={Object.entries(layout).map(([key, value]) => `${key}: ${value}`).join('; ')} on:click|stopPropagation={view}>
      {#each $prizes as card, i (card._id)}
         <!-- one prize, placed by the row and column it fills -->
         <div class="prize" style="--row: {Math.floor(i / COLUMNS)}; --col: {i % COLUMNS}">
            <Card {card} pile={prizes} revealed={$prizesFlipped || $spectating} />
         </div>
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
      position: relative;
      width: 100%;
      height: 100%;
   }

   /*
      One prize's box, placed by the row and column it fills: the same arithmetic as
      the near half's - card, step, and a block that is exactly the zone's height.
   */
   .prize {
      --card-h: calc((100cqh - 8px) * (1 + var(--overlap)) / (var(--rows) + var(--overlap)));
      --card-w: calc(var(--card-h) * var(--card-ratio));
      --step: calc(var(--card-h) / (1 + var(--overlap)));

      position: absolute;
      top: calc(var(--row) * var(--step));
      left: calc(50% + (var(--col) - var(--columns) / 2) * var(--card-w));
      width: var(--card-w);
      height: var(--card-h);
   }

   /* the card fills the box that was worked out for it, border and all */
   :global(.prizes .prize > div),
   :global(.prizes img.card) {
      width: 100%;
      height: 100%;
   }

   :global(.prizes .prize > div) {
      border-width: 0 !important;
   }

   :global(.prizes img.card.selected) {
      outline: 2px solid var(--selection-color);
      outline-offset: 0;
   }
</style>
