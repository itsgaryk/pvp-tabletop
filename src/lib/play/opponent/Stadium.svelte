<script>
   import Card from './Card.svelte'
   import { defaultOpponent } from '$lib/stores/opponent.js'
   import { solo, soloCardToStadium, onOpponentHalf } from '$lib/stores/solo.js'
   import { cardSelection, resetSelection } from '$lib/stores/player.js'
   import { dropRevealedCard, isDraggingRevealed } from '$lib/stores/oppAction.js'

   /* DnD */

   import { dnd } from '$lib/dnd/actions.js'
   import { draggedCard, source } from '$lib/dnd/store.js'

   /* which player's board this component shows */
   export let store = defaultOpponent
   $: ({ stadium } = store)

   /*
      The mirror of the near half's Stadium: it accepts the far half's *own* cards,
      so each player plays into their own Stadium in the shared cell. In solo that
      half is played by the same person, so its cards are draggable - and a card of
      the player's that landed here would be a card crossing the table.

      The near Stadium lies over this one, so a drop reaches it while that half's
      Stadium is empty and nothing is being dragged into it (see .stadium in
      Board.svelte); when it is not empty, this half plays from its own menu.

      **A card out of a Reveal or a Look is the second gesture it takes**, the same one
      `opponent/Pile.svelte` takes: the Stadium is a shared *cell* but each half keeps its
      own list in it, so a window's card dropped here goes into the owner's own, and the
      request is the same one the menu's *To Stadium* would make. This zone was the one
      drop target in the far half that had no such branch - so the drag highlighted
      nothing, no request went out, and the card left the window and landed nowhere.
   */
   /*
      **Asked with no arguments, and that is the point**: this component builds its drop
      config as a plain object, so `$draggedCard` and `$source` inside `allowDrop` are read
      once at initialisation and stay empty. `isDraggingRevealed` reads the drag stores when
      it is not handed them, so this form is the live one.
   */
   const allowDrop = () =>
      isDraggingRevealed() ||
      Boolean($solo && $source && $source !== stadium && $source !== 'slot'
         && $cardSelection.length === 1 && onOpponentHalf($source))

   function onDrop () {
      /* a card out of a window is a request to its owner, not a move on this board */
      if (dropRevealedCard(stadium, $draggedCard, $cardSelection)) {
         resetSelection()
         return
      }

      const card = $cardSelection[0]
      if (!card) return
      soloCardToStadium($source, card)
      resetSelection()
   }

   const dndConfig = { drop: onDrop, allowDrop }
</script>

<div class="stadium-cards p-1 flex justify-center items-center"
   use:dnd={dndConfig}>
   {#each $stadium as card (card._id)}
      <Card {card} pile={stadium} />
   {/each}
</div>

<style>
   /*
      The same shape as the near half's: up to two cards side by side, each taking
      half of what one card used to so that the pair fits the band. Both halves
      ask for it rather than sharing one rule, the way the prizes do - each zone
      component carries its own sizing.
   */
   .stadium-cards {
      gap: calc(var(--scaled-rem) * 0.5);
   }

   .stadium-cards > :global(div) {
      flex: 1 1 0;
      min-width: 0;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
   }

   .stadium-cards :global(img.card) {
      width: 100%;
      height: auto;
      max-height: 100%;
      object-fit: contain;
   }
</style>
