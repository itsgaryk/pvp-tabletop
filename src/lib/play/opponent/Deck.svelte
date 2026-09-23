<script>
   import { getContext } from 'svelte'
   import ContextMenuOption from '$lib/components/ContextMenuOption.svelte'
   import Pile from './Pile.svelte'
   import cardback from '$lib/assets/cardback_int.png'
   import { defaultOpponent } from '$lib/stores/opponent.js'
   import { spectating } from '$lib/stores/connection.js'
   import { solo, soloDraw, soloShuffleDeck } from '$lib/stores/solo.js'
   import { canReveal, revealTop, lookTop } from '$lib/stores/reveal.js'
   import { discardTopOfTheirDeck } from '$lib/stores/oppAction.js'

   const { openOppPile } = getContext('boardActions')

   /* which player's board this component shows */
   export let store = defaultOpponent
   $: ({ deck } = store)

   let menu

   /*
      Whether the far half's deck can be reached by *this* player at all, which is
      the whole of when this pile has a menu.

      It is a room with two players in it - solo and a spectator are both refused
      (`canReveal`) - and that is a change from what this pile's menu used to be:
      `showMenu` was `$solo`, because in solo the other half is yours to play. Solo
      keeps its entries and gains nothing (both entries below refuse solo
      themselves); a room gains Reveal and Look, which are the only two reasons a
      player ever opens the other player's deck.
   */
   $: reachable = $solo || canReveal()

   /*
      A spectator may look through either player's deck (read-only, no log) - the
      one gesture this pile has always had. It is kept for a spectator alone,
      because a spectator has nobody to reveal to and solo has nothing here to
      view that it cannot already see.
   */
   function view () {
      if (!$spectating && !$solo) return
      openOppPile(deck)
   }

   /* in solo the other half is yours, so its deck can be drawn from as well */
   function drawX () {
      const x = parseInt(prompt('Draw how many cards?'))
      if (x) soloDraw(x)
   }

   /*
      Reveal the top X cards of this deck, to both players.

      The whole of the gesture is `revealTop` in the store: which cards "the top"
      means, which half owns the deck, and the event that tells the other player.
      What is here is the question - the browser's own prompt, which is how every
      "X" on this board is asked for (Draw X, View Top X, Order Top X).
   */
   function revealTopX () {
      revealTop(deck, parseInt(prompt('Reveal how many cards from the top?')))
   }

   /*
      View the top X cards of this deck, privately.

      The same question and the same reading of the deck, held in this client's own
      state instead of shared - which is the whole of the difference between the
      two entries, and the reason they are separate functions in one module.
   */
   function lookAtTopX () {
      lookTop(parseInt(prompt('Look at how many cards from the top?')))
   }

   /*
      *Discard Top Card* and *Discard Top X*: cards off the top of this deck and straight
      into its owner's discard. The first is the top one, the second is as many as the
      player asks for.

      Both are requests rather than local moves, and the whole of the gesture is
      `discardTopOfTheirDeck` in the store: this board cannot read the top of somebody
      else's deck, so what travels is the *count* and the owner reads its own deck. It is
      the one entry here with no card behind it, which is why the two are one function -
      and why the first does not need to ask, while the second does. The question is the
      same one the player's own deck asks (see `board/Deck.svelte`), so the two menus ask
      for X in the same words.

      Nothing is revealed by either: the cards go from the top of the deck to the discard,
      and the discard is face up, so the *owner* sees what they lost, which is what a
      discard is. The player who asked sees the deck get shorter.
   */
   function discardTopX (ask = true) {
      const count = ask
         ? parseInt(prompt('Discard how many cards from the top of the opponent\'s deck?'))
         : 1

      if (!count || count < 1) return

      discardTopOfTheirDeck(count)
   }
</script>

<!--
   `showMenu` is `reachable`, and every entry below is what it is for: online the
   two reveal/look entries, in solo the five the far half's own player would have.
   A pile with no menu is a pile this board cannot reach, which is what an
   opponent's deck is to a spectator.
-->
<Pile pile={deck} name="Deck" showMenu={reachable} bind:menu={menu}>
   {#if $deck.length > 0}
      <img class="card zone-card" src={cardback} alt="" draggable="false" on:click|stopPropagation={view}>
   {/if}

   <svelte:fragment slot="menu">
      <!--
         Reveal, View and the two discards, for a room. Each is disabled rather than hidden
         where it does not apply, so the menu does not change shape under a player who has
         just learned where the entries are. All four are about the cards of a deck that is
         not this player's to move, which is exactly why all four are requests to its owner
         rather than local moves (see docs/reveal.md).
      -->
      <ContextMenuOption click={revealTopX} text="Reveal Top X" disabled={!canReveal()} />
      <ContextMenuOption click={lookAtTopX} text="View Top X" disabled={!canReveal()} />
      <ContextMenuOption click={() => discardTopX(false)} text="Discard Top Card" disabled={!canReveal()} />
      <ContextMenuOption click={() => discardTopX()} text="Discard Top X" disabled={!canReveal()} />

      <!-- in solo the far half is yours, so it can be drawn from and shuffled -->
      {#if $solo}
         <hr>
         <ContextMenuOption click={() => soloDraw(1)} text="Draw" />
         <ContextMenuOption click={drawX} text="Draw X" />
         <ContextMenuOption click={() => soloDraw(7)} text="Draw 7" />
         <ContextMenuOption click={soloShuffleDeck} text="Shuffle" />
         <ContextMenuOption click={view} text="View All" />
      {/if}
   </svelte:fragment>
</Pile>
