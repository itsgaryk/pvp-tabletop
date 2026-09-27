<script>
   import { getContext } from 'svelte'
   import ContextMenu from '$lib/components/ContextMenu.svelte'
   import ContextMenuOption from '$lib/components/ContextMenuOption.svelte'
   import { spectating } from '$lib/stores/connection.js'
   import { pingCard } from '$lib/stores/ping.js'

   const { openDetails } = getContext('boardActions')

   /*
      The menu for a card of the other player's that is lying in one of their zones:
      the one thing a player may do with such a card is *point at it*.

      **Why it is a menu of its own rather than an entry on `OppCardActionMenu`**, which
      is the other menu a card of theirs can open in a room. That one is the player's own
      card menu read from the other side of the table: every entry on it is a request to
      the card's owner to move it, and its whole situation is a window that handed the
      player somebody else's card to act on (see docs/reveal.md). A ping requests nothing
      and is offered on exactly the cards that menu refuses - the opponent's hand, their
      prizes, their Stadium, the cards they played to the table, and the Pokemon in play
      whose menu is `OppSlotMenu` - so the two menus have opposite rules about the same
      card and neither can be written as a mode of the other.

      It is also not the three zones that hold a *pile* - the deck, the discard and the lost
      zone - which are the cards a player may not ping at all: each is one card on screen
      whatever is in it, and the whole of it is read in a view (`OppInspection.svelte`),
      which draws those cards with this same component. So "may this card be pinged" is
      asked of the pile it is drawn with (`pingable`, marked in `opponent.js`) rather than
      assumed from the fact that it belongs to the other player - see
      `opponent/Card.svelte`, which is where the question is put.

      What it shares with every other menu on this board is the heading: the card's own
      name, which is a way into its details, and *Hidden card* for one this player cannot
      read - the same words `OppCardActionMenu` and the player's own `CardMenu` use,
      because it is the same fact, and the same flag (`revealed`) answers all three. A
      double click opens the same card, so the heading is a convenience and not the only
      way in.
   */

   let menu
   let card = null
   let revealed = true

   export function open (x, y, _card, _revealed = true) {
      card = _card
      revealed = _revealed
      menu.open(x, y)
   }

   /*
      Pinging is a player's gesture and never a spectator's, and the entry says so
      rather than being removed for one: the menus on this board keep their shape
      between the two roles, so a spectator sees the entry it cannot take (the same
      rule `opponent/Deck.svelte` states for the four entries a spectator cannot take
      either). `pingCard` refuses one as well - the relay would refuse it too.
   */
   function ping () {
      pingCard(card, revealed)
      menu.close()
   }

   function show () {
      if (card) openDetails(card)
      menu.close()
   }
</script>

<ContextMenu
   bind:this={menu}
   heading={revealed && card ? card.name : 'Hidden card'}
   headingClick={revealed && card ? show : null}>

   <ContextMenuOption click={ping} text="Ping Card" disabled={$spectating} />
</ContextMenu>
