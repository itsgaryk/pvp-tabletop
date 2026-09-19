<script>
   import { getContext } from 'svelte'
   import ContextMenuOption from '$lib/components/ContextMenuOption.svelte'
   import Pile from './Pile.svelte'
   import Card from './Card.svelte'
   import { share, publishLog, spectating } from '$lib/stores/connection.js'

   import { prizes, deck, prizesFlipped } from '$lib/stores/player.js'

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
   <div class="prizes">
      {#each $prizes as card (card._id)}
         <Card {card} pile={prizes} revealed={$prizesFlipped} />
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
      The prizes form a block - two columns, and as many rows as it takes - and the
      *block* is what is centred in the zone, rather than each card being centred on
      its own. Filling the zone is what does both: the columns share its width and
      the rows share its height, so the block is the zone and it is centred in it.

      No gap and no padding between them: a prize face down next to a prize face
      down reads as one row of card backs, and the six of them are a block - the
      spacing they had was a cell each, and what it bought was the look of a grid of
      loose cards rather than a pile counted in two columns.
   */
   .prizes {
      /*
         The columns and rows are the cards' own size rather than a share of the
         zone, so that the two in a row touch: a `1fr` cell is wider than a card
         whose height is what limits it, and the difference came out as a gap
         between them.
      */
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
      The border a card is drawn inside (2px on each side, transparent until it is
      selected) is not part of the block: it is what put 4px between two prizes in a
      row, because a cell sized by a card that carries one is a cell 4px wider than
      the card in it. The selection is the same 2px drawn inside the card instead.
   */
   :global(.prizes > div) {
      border-width: 0 !important;
   }

   :global(.prizes img.card.selected) {
      outline: 2px solid var(--selection-color);
      outline-offset: 0;
   }

   /*
      A prize is as large as its own cell of that block allows - the lower of the
      cell's width and the cell's height - which is the "collectively" in the rule
      (see the note over --card-ratio in global.css): six prizes are sized by the
      block six of them make, not by the zone one of them would have had.

      The whole selector is global on purpose: the card is drawn by Card.svelte, so
      it does not carry this component's scope and a scoped `img.card` would not
      reach it at all - which is a size that silently falls back to the card's own.
   */
   :global(.prizes img.card) {
      width: min(
         calc(100cqw / 2),
         calc((100cqh / 3) * var(--card-ratio))
      );
   }
</style>