<script>
   import Horizontal from '$lib/components/scroll/Horizontal.svelte'
   import ContextMenuOption from '$lib/components/ContextMenuOption.svelte'
   import Pile from './Pile.svelte'
   import Card from './Card.svelte'
   import { defaultOpponent } from '$lib/stores/opponent.js'
   import { spectating } from '$lib/stores/connection.js'
   import { canReveal, revealHand } from '$lib/stores/reveal.js'
   import {
      solo, soloHandIntoPlay, soloHandAttachToActive,
      soloShuffleHandIntoDeck
   } from '$lib/stores/solo.js'

   /* which player's board this component shows */
   export let store = defaultOpponent
   $: ({ hand, handRevealed, discard } = store)

   /*
      A spectator always sees both hands, and in solo it is your own hand too.

      A **Reveal Hand does not add itself here**, and that is deliberate: the hand stays
      drawn as card backs while the window over it shows every card (*when "Reveal Hand" is
      selected the cards in the hand zone should remain as Hidden Cards*). There is no flag
      to add - the gesture sets none - so this expression is the same one it always was.
   */
   $: revealed = $handRevealed || $spectating || $solo

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
      is told and what the log says. It is deliberately not a move on this board and not a
      change to how the hand is drawn either: nothing in the hand changes, and the zone goes
      on showing card backs - the window is where the cards are.

      **This is the zone's route to the entry, and each card of the hand is the other one.**
      A right click on a card in this zone opens `OppCardPingMenu`, which offers the same
      *Reveal Hand* for the same reason - the window shows the whole of the hand, so the
      card it was asked from makes no difference - and takes it through this very function's
      store call rather than a second copy of it. Which is why the two are asserted together
      in `tools/reveal-check.mjs`: one gesture, two places to ask for it.
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
