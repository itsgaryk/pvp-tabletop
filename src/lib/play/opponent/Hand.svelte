<script>
   import Horizontal from '$lib/components/scroll/Horizontal.svelte'
   import ContextMenuOption from '$lib/components/ContextMenuOption.svelte'
   import Pile from './Pile.svelte'
   import Card from './Card.svelte'
   import { defaultOpponent } from '$lib/stores/opponent.js'
   import { spectating } from '$lib/stores/connection.js'
   import { canReveal, revealHand, farHandRevealed } from '$lib/stores/reveal.js'
   import {
      solo, soloHandIntoPlay, soloHandAttachToActive,
      soloShuffleHandIntoDeck
   } from '$lib/stores/solo.js'

   /* which player's board this component shows */
   export let store = defaultOpponent
   $: ({ hand, handRevealed, discard } = store)

   /*
      A spectator always sees both hands, and in solo it is your own hand too.

      `$farHandRevealed` is the third answer and the one that has to be asked of *this*
      board: `handRevealed` belongs to the board that owns the hand and is set on the
      owner's own screen, so it says nothing about the mirror being drawn here. A Reveal
      Hand sets both - the owner's copy through the event, this one locally - and this half
      draws the hand face up because of it.
   */
   $: revealed = $handRevealed || $farHandRevealed || $spectating || $solo

   /*
      Whether this hand's menu may be opened at all.

      It used to be `$solo` alone, because the only entries on it were solo's: online, the
      far half belonged to somebody else and had nothing to offer. *Reveal Hand* is the
      first entry a room has - it is a request made *to* the hand's owner rather than a
      move of their cards, which is the one kind of thing this half can do online - so the
      menu is reachable whenever that entry could be taken.
   */
   $: reachable = $solo || canReveal()

   let menu

   function discardTop () {
      const card = hand.pop()
      if (card) discard.push(card)
   }

   /*
      Reveal the whole of this hand, to this player and the room's watchers.

      The whole of the gesture is `revealHand` in the store: which hand, what travels, who
      is told and what the log says. It is deliberately not a move on this board: nothing
      in this hand changes, and the owner's copy of it turns face up through the flag the
      event carries.
   */
   function revealTheirHand () {
      revealHand()
      menu.close()
   }
</script>

<Pile pile={hand} name="Hand" showMenu={reachable} bind:menu={menu}>
   <Horizontal>
      <div class="hand-cards">
         {#each $hand as card (card._id)}
            <Card {card} pile={hand} {revealed} />
         {/each}
      </div>
   </Horizontal>

   <!--
      *Reveal Hand* is the room's entry and the only one here that is not solo's, so it is
      the one rendered *disabled* rather than removed when it does not apply (solo, where
      this hand is the player's own and is already face up; a spectator, who has no board
      to reveal from). A menu that changes shape between the two modes is a menu a player
      has to re-learn, which is the same rule `opponent/Deck.svelte` states for its own
      entries.
   -->
   <svelte:fragment slot="menu">
      <ContextMenuOption click={revealTheirHand} text="Reveal Hand" disabled={!canReveal()} />

      <!-- the other half's hand is yours to play in solo -->
      {#if $solo}
         <hr>
         <ContextMenuOption click={() => soloHandIntoPlay('active')} text="Top Card to Active" />
         <ContextMenuOption click={() => soloHandIntoPlay('bench')} text="Top Card to Bench" />
         <ContextMenuOption click={soloHandAttachToActive} text="Attach Top Card to Active" />
         <ContextMenuOption click={discardTop} text="Discard Top Card" />
         <ContextMenuOption click={soloShuffleHandIntoDeck} text="Shuffle Into Deck" />
      {/if}
   </svelte:fragment>
</Pile>

<style>
   /*
      The same shape as the near half's: a card is as tall as the row allows, the
      row is centred while the hand fits and scrolls once it does not.
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

   .hand-cards :global(img.card) {
      /* the zone, less the row's padding, the pile's `p-1`, the scrollbar and the card's
         border: the near half's note, in board/Hand.svelte, in full */
      width: calc((100cqh - 8px - 2 * var(--card-gap) - var(--scrollbar)) * var(--card-ratio) - 4px);
   }
</style>
