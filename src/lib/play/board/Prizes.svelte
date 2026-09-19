<script>
   import { getContext } from 'svelte'
   import ContextMenuOption from '$lib/components/ContextMenuOption.svelte'
   import Pile from './Pile.svelte'
   import Card from './Card.svelte'
   import { share, publishLog, spectating } from '$lib/stores/connection.js'

   import { prizes, deck, prizesFlipped } from '$lib/stores/player.js'

   /*
      The prizes cascade only once there are more than the six a game is dealt.

      Six is three rows of two, and they sit *next* to one another: that is the table
      a game starts with, and it is read at a glance. A seventh is a card put into the
      prizes, and from there the rows overlap - the pile grows downwards in the two
      columns it was dealt as rather than sideways, because a pile of ten should not
      be a wider table.

      `rows` is counted here rather than in CSS because the arithmetic needs it, and a
      stylesheet cannot count its own children. With no overlap the same formula below
      is the plain "the rows share the height" case, so one covers both.
   */
   const COLUMNS = 2
   const CASCADE_AFTER = 3   /* rows: the six prizes a game is dealt */
   const OVERLAP = 0.3

   $: rows = Math.max(1, Math.ceil($prizes.length / COLUMNS))
   $: overlap = rows > CASCADE_AFTER ? OVERLAP : 0
   $: layout = { '--rows': rows, '--overlap': overlap, '--columns': COLUMNS }

   let menu

   function switchVisibility () {
      prizesFlipped.update(val => !val)
      menu.close()
      share('prizeToggle', { flipped: prizesFlipped.get() })
   }

   function shuffle () {
      prizes.shuffle()
      menu.close()
      publishLog('Shuffled Prizes')
   }

   function shuffleBack () {
      const cards = $prizes.map(card => card._id)
      const count = cards.length

      deck.merge($prizes)
      prizes.clear()
      menu.close()
      deck.shuffle()

      share('cardsMoved', { cards, from: 'prizes', to: 'deck' })
      publishLog(`Shuffled Prizes (${count}) into Deck`)
   }

   function shuffleBackBottom () {
      const cards = $prizes.map(card => card._id)
      const count = cards.length

      /* shuffle the prizes first, then place them under the deck - index 0 is
         the bottom, matching the hand's "to bottom of Deck" behaviour */
      prizes.shuffle()
      while ($prizes.length) {
         deck.unshift(prizes.pop())
      }
      menu.close()

      share('cardsMoved', { cards, from: 'prizes', to: 'deck' }) // order of opponents cards does not matter
      publishLog(`Shuffled Prizes (${count}) to bottom of Deck`)
   }

   const { openSelection } = getContext('boardActions')

   function pickupPrizes () {
      openSelection(prizes, $prizes.length)
   }

</script>

<Pile pile={prizes} name="Prizes" bind:menu={menu}>
   <div class="prizes" style={Object.entries(layout).map(([key, value]) => `${key}: ${value}`).join('; ')}>
      {#each $prizes as card, i (card._id)}
         <!-- one prize, placed by the row and column it fills -->
         <div class="prize" style="--row: {Math.floor(i / COLUMNS)}; --col: {i % COLUMNS}">
            <Card {card} pile={prizes} revealed={$prizesFlipped} />
         </div>
      {/each}
   </div>

   <svelte:fragment slot="menu">
      <ContextMenuOption click={switchVisibility} text={$prizesFlipped ? 'Hide Prizes' : 'Show Prizes'} disabled={$spectating} />
      <ContextMenuOption click={shuffle} text="Shuffle" disabled={$spectating} />
      <ContextMenuOption click={shuffleBack} text="Shuffle All Into Deck" disabled={$spectating} />
      <ContextMenuOption click={shuffleBackBottom} text="Shuffle All to Bottom of Deck" disabled={$spectating} />
      <ContextMenuOption click={pickupPrizes} text="Inspect Prizes" disabled={$spectating} />
   </svelte:fragment>
</Pile>

<style>
   /*
      The prizes cascade: two columns, and each row overlapping the one above it.

      Every prize is placed by the row and column it fills (see the markup), which is
      what a cascade needs and a grid cannot say: the columns share the zone's width,
      the rows are a step apart, and the step is shorter than a card so that one row
      lies over the one below it. The last row's cards end exactly at the bottom of the
      zone, so nothing hangs out of it however many prizes there are.
   */
   .prizes {
      position: relative;
      width: 100%;
      height: 100%;
   }

   /*
      One prize's box. The arithmetic, in the zone's own units:

         card   = (zone height - the pile's padding) x (1 + overlap) / (rows + overlap)
         step   = card / (1 + overlap)     the row pitch, a card's overlap shorter
         block  = (rows - 1) x step + card = what is inside the pile, exactly

      and the columns are one card wide each, centred, so the two in a row touch. The
      8px is the pile's own `p-1` padding, which `100cqh` knows nothing about: without
      it the block is 8px too tall for the space it is laid out in and the last row
      hangs over the zone's edge.
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

   /*
      The 2px a card carries (transparent until it is selected) is drawn inside its
      box rather than added to it, or two prizes in a row would sit 4px apart.
   */
   :global(.prizes img.card.selected) {
      outline: 2px solid var(--selection-color);
      outline-offset: 0;
   }

   /*
      The border a card is drawn inside (2px on each side, transparent until it is
      selected) is part of the box the arithmetic worked out, so it is drawn inside
      that box rather than added to it - otherwise two prizes in a row would sit 4px
      apart.
   */
   :global(.prizes .prize > div) {
      border-width: 0 !important;
   }

   :global(.prizes img.card.selected) {
      outline: 2px solid var(--selection-color);
      outline-offset: 0;
   }

   /*
      A prize is as large as its own cell of the block allows - the lower of the
      cell's width and the cell's height - and the block is as many columns as the
      prizes need. CSS is told the width of the block by the count rather than
      counting the cards itself: three rows is the table, so the seventh prize is
      what makes a third column, the tenth a fourth, and so on.

      The whole selector is global on purpose: the card is drawn by Card.svelte, so
      it does not carry this component's scope and a scoped `img.card` would not
      reach it at all - which is a size that silently falls back to the card's own.
   */
   :global(.prizes img.card) {
      width: 100%;
      height: 100%;
   }
</style>