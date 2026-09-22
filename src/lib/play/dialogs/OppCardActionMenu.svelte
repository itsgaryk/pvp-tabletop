<script>
   import { getContext } from 'svelte'
   import ContextMenu from '$lib/components/ContextMenu.svelte'
   import ContextMenuOption from '$lib/components/ContextMenuOption.svelte'
   import { spectating } from '$lib/stores/connection.js'
   import { defaultOpponent, deck as oppDeck, active as oppActive } from '$lib/stores/opponent.js'
   import { OPP_ACTIONS, opponentCardAction } from '$lib/stores/oppAction.js'

   const { openDetails } = getContext('boardActions')

   /*
      The menu for a card of the *other* player's that this player is allowed to
      act on.

      It is the player's own card menu, read from the other side of the table: the
      same entries and the same words - *To Hand*, *To Discard*, *To Bench*, and
      the rest - because it is the same set of places, and a player who has just
      been shown the opponent's top three cards is thinking in exactly those terms.
      What it is not is the same *function*: every entry here is a request to the
      card's owner (`opponentCardAction`), who performs the move on its own board
      and reports it. See docs/reveal.md for why that split is the whole design.

      It is deliberately separate from `OppCardMenu.svelte`, which is the far half's
      menu in **solo**: that one acts on the mirror directly because in solo there
      is no other player, and its entries move a card between the far half's own
      zones. Online the two are the only menus that can be opened on a card of the
      other side, and each refuses the other's situation - `opponent/Card.svelte`
      opens the solo one in solo and this one in a room.

      One card, not a selection: a card's menu speaks for the card that was
      right-clicked, and `opponentCardAction` takes one.
   */

   let menu
   let card = null
   let pile = null
   let revealed = true

   export function open (x, y, _card, _revealed = true, _pile = null) {
      card = _card
      revealed = _revealed
      pile = _pile
      menu.open(x, y)
   }

   function act (action, options = {}) {
      opponentCardAction(card, action, { ...options, pile })
      menu.close()
   }

   /* the card's own face, so its name opens the details panel the way the board's does */
   function show () {
      if (card) openDetails(card)
      menu.close()
   }
</script>

<ContextMenu
   bind:this={menu}
   heading={revealed && card ? card.name : 'Hidden card'}
   headingClick={revealed && card ? show : null}>

   {#if card}
      <!--
         The entries, in the player's own menu's order: a zone of theirs the card
         goes to, and the two that put it into play as one of their Pokemon.
      -->
      <ContextMenuOption click={() => act(OPP_ACTIONS.HAND)} text="To Hand" disabled={$spectating} />
      <ContextMenuOption click={() => act(OPP_ACTIONS.DISCARD)} text="To Discard" disabled={$spectating} />

      <ContextMenuOption click={() => act(OPP_ACTIONS.BENCH)} text="To Bench" disabled={$spectating} />
      <ContextMenuOption click={() => act(OPP_ACTIONS.ACTIVE)} text="To Active" disabled={$spectating} />
      <ContextMenuOption click={() => act(OPP_ACTIONS.STADIUM)} text="To Stadium" disabled={$spectating} />

      <ContextMenuOption click={() => act(OPP_ACTIONS.DECK_SHUFFLE)} text="Shuffle Into Deck" disabled={$spectating || !$oppDeck.length} />
      <ContextMenuOption click={() => act(OPP_ACTIONS.DECK_TOP)} text="To Top of Deck" disabled={$spectating} />
      <ContextMenuOption click={() => act(OPP_ACTIONS.DECK_BOTTOM)} text="To Bottom of Deck" disabled={$spectating} />

      <ContextMenuOption click={() => act(OPP_ACTIONS.LZ)} text="To Lost Zone" disabled={$spectating} />
      <ContextMenuOption click={() => act(OPP_ACTIONS.PRIZES)} text="To Prizes" disabled={$spectating} />
      <ContextMenuOption click={() => act(OPP_ACTIONS.TABLE)} text="To Table" disabled={$spectating} />

      <!--
         *Attach* is the one entry that names a Pokemon of theirs, because it is the
         one that goes *under* one rather than into play as one. There is no
         equivalent of the player's own *Evolve*: an evolution needs a card the
         board does not know is the right one, and the player's own menu lets the
         board's own attach gesture decide that - which is a card of *theirs*
         evolving, a move no card text hands to the other player.
      -->
      <ContextMenuOption
         click={() => act(OPP_ACTIONS.ATTACH)}
         text="Attach to Their Active"
         disabled={$spectating || !$oppActive} />

      <ContextMenuOption click={show} text="Show Details" />
   {/if}
</ContextMenu>
