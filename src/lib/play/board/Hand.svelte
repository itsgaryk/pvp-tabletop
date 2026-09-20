<script>
   import ContextMenuOption from '$lib/components/ContextMenuOption.svelte'
   import Horizontal from '$lib/components/scroll/Horizontal.svelte'
   import Pile from './Pile.svelte'
   import Card from './Card.svelte'
   import { share, publishLog, spectating } from '$lib/stores/connection.js'

   import { hand, deck, discard, handRevealed } from '$lib/stores/player.js'

   let menu

   function moveAll (targetPile) {
      const cards = $hand.map(card => card._id)

      targetPile.merge($hand)
      hand.clear()
      menu.close()

      share('cardsMoved', { cards, from: 'hand', to: targetPile.name })
   }

   function discardAll () {
      moveAll(discard)
      publishLog('Discarded Hand')
   }

   function shuffleBack () {
      const count = $hand.length
      moveAll(deck)
      deck.shuffle()

      publishLog(`Shuffled Hand (${count}) into Deck`)
   }

   function marnie () {
      const cards = $hand.map(card => card._id)
      const count = cards.length

      hand.shuffle()
      while ($hand.length) {
         deck.unshift(hand.pop())
      }

      menu.close()

      share('cardsMoved', { cards, from: 'hand', to: 'deck' }) // order of opponents cards does not matter
      publishLog(`Shuffled Hand (${count}) to bottom of Deck`)
   }

   function discardRandom () {
      if (!$hand.length) return
      const card = $hand[Math.floor(Math.random() * $hand.length)]
      hand.remove(card)
      discard.push(card)

      share('cardsMoved', { cards: [ card._id ], from: 'hand', to: 'discard' })
      publishLog(`Randomly discarded [${card.name}] from Hand`)
   }

   function switchVisibility () {
      handRevealed.update(val => !val)
      menu.close()
      share('handToggle', { revealed: handRevealed.get() })
   }
</script>

<Pile pile={hand} name="Hand" bind:menu={menu}>
   <Horizontal>
      <div class="hand-cards">
         {#each $hand as card (card._id)}
            <Card {card} pile={hand} />
         {/each}
      </div>
   </Horizontal>

   <svelte:fragment slot="menu">
      <ContextMenuOption click={() => discardAll()} text="Discard All" disabled={$spectating} />
      <ContextMenuOption click={() => shuffleBack()} text="Shuffle All Into Deck" disabled={$spectating} />
      <ContextMenuOption click={() => marnie()} text="Shuffle All to Bottom of Deck" disabled={$spectating} />
      <ContextMenuOption click={() => discardRandom()} text="Discard Random Card" disabled={$spectating} />
      <ContextMenuOption click={switchVisibility} text={$handRevealed ? 'Hide Hand' : 'Reveal Hand'} disabled={$spectating} />
   </svelte:fragment>
</Pile>

<style>
   /*
      The hand is the one zone whose cards lie *along* it rather than sharing it: a
      hand of twenty has to stay readable, so a card is as tall as the row allows
      and the row scrolls sideways past that. `min-width: 100%` is what centres the
      cards while they fit - the row is at least the zone, so `justify-content`
      has something to centre them in - and `max-content` lets it grow past the
      zone and scroll once they do not.
   */
   .hand-cards {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--card-gap);
      padding: var(--card-gap);
      width: max-content;
      min-width: 100%;
      height: 100%;
   }

   /*
      A card is the height of the hand, less what has to fit around it: the row's own
      `padding`, the pile's `p-1` under that (which `100cqh` knows nothing about, the
      same 8px the prizes work with), the bar a hand that does not fit draws under it
      (`--scrollbar`), and the card's own 2px border top and bottom - drawn outside the
      image, so it is the card's height rather than its width that the formula has to
      be shortened by.

      All of it used to be missed, which left the row over the bottom of the zone: this
      is the board's last row, and 2px past it is a scrollbar on the whole board (see
      Board.svelte).
   */
   .hand-cards :global(img.card) {
      width: calc((100cqh - 8px - 2 * var(--card-gap) - var(--scrollbar)) * var(--card-ratio) - 4px);
   }
</style>