<script>
   import { getContext } from 'svelte'
   import ContextMenuOption from '$lib/components/ContextMenuOption.svelte'
   import Pile from './Pile.svelte'
   import Card from './Card.svelte'
   import { defaultOpponent } from '$lib/stores/opponent.js'
   import { cardSelection } from '$lib/stores/player.js'
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
      The same as the near half's: two columns next to one another for the six a game
      is dealt, cards that keep that size as prizes are taken, and a cascade once
      there are more (see the near half).
   */
   const COLUMNS = 2
   const CASCADE_AFTER = 3
   const OVERLAP = 0.3

   $: rows = Math.max(1, Math.ceil($prizes.length / COLUMNS))
   $: overlap = rows > CASCADE_AFTER ? OVERLAP : 0
   $: layout = {
      '--rows': rows,
      '--size-rows': Math.max(CASCADE_AFTER, rows),
      '--overlap': overlap,
      '--columns': COLUMNS
   }

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
         <!--
            one prize, placed by the row and column it fills. The box carries the
            selection as well as the card does, because past six prizes the rows
            overlap and the selected one has to be drawn over its neighbours (see
            the style below).
         -->
         <div class="prize" class:selected={$cardSelection.includes(card)} style="--row: {Math.floor(i / COLUMNS)}; --col: {i % COLUMNS}">
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
      the near half's - a size taken from the rows a dealt table has, a step, and a
      block centred in the zone (see the near half).
   */
   .prize {
      --avail: calc(100cqh - 8px);
      --card-h: calc(var(--avail) * (1 + var(--overlap)) / (var(--size-rows) + var(--overlap)));
      --card-w: calc(var(--card-h) * var(--card-ratio));
      --step: calc(var(--card-h) / (1 + var(--overlap)));
      --block-h: calc((var(--rows) - 1) * var(--step) + var(--card-h));

      position: absolute;
      top: calc((var(--avail) - var(--block-h)) / 2 + var(--row) * var(--step));
      left: calc(50% + (var(--col) - var(--columns) / 2) * var(--card-w));
      width: var(--card-w);
      height: var(--card-h);
   }

   /* the card fills the box that was worked out for it, border and all */
   .prizes .prize > :global(div),
   .prizes :global(img.card) {
      width: 100%;
      height: 100%;
   }

   /*
      The card's own 2px border is taken out of the box rather than added to it, and
      a selected prize draws those 2px as an outline instead - the wrapper *is* the
      box here, so a live border would shrink and shift the image and step the prize
      out of the block the cascade worked out. The rule is at the wrapper, which is
      what carries the selection class, and only the card itself is `:global()` - it
      belongs to another component, while `.prizes` and `.prize` belong to this one
      (see the near half, where the arithmetic and the reasoning are written out).
   */
   .prizes .prize > :global(div) {
      border-width: 0;
   }

   .prizes .prize > :global(div.selected) {
      outline: 2px solid var(--selection-color);
      outline-offset: 0;
   }

   /* and lifted over the neighbours it overlaps once there are more than six */
   .prize.selected {
      z-index: 1;
   }
</style>
