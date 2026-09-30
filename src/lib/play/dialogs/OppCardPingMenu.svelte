<script>
   import { getContext } from 'svelte'
   import ContextMenu from '$lib/components/ContextMenu.svelte'
   import ContextMenuOption from '$lib/components/ContextMenuOption.svelte'
   import { spectating } from '$lib/stores/connection.js'
   import { canReveal, revealHand } from '$lib/stores/reveal.js'
   import { pingCard } from '$lib/stores/ping.js'

   const { openDetails } = getContext('boardActions')

   /*
      The menu for a card of the other player's that is lying in one of their zones: a
      player may **point at it**, and - for a card in their **hand** - ask for the whole
      of that hand, which is the *Reveal Hand* the hand zone's own menu carries.

      **Why it is a menu of its own rather than an entry on `OppCardActionMenu`**, which
      is the other menu a card of theirs can open in a room. That one is the player's own
      card menu read from the other side of the table: every entry on it is a request to
      the card's owner to move it, and its whole situation is a window that handed the
      player somebody else's card to act on (see docs/reveal.md). What this menu offers
      asks for no move at all: a ping names the card and changes nothing, and a Reveal
      Hand shows the player the hand the card came from without a card of it moving - and
      both are offered on exactly the cards that menu refuses - the opponent's hand, their
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

      **And a hand's second entry is the zone's entry, reached from a card.** *Reveal Hand*
      shows the whole of the other player's hand, so *which* card of it was right-clicked
      makes no difference to what happens: this is the same entry `opponent/Hand.svelte`
      renders on the zone's menu, calling the same `revealHand`, and it belongs here
      because a hand is the one pile whose gesture is about the whole of it. It is asked of
      the pile for the same reason the ping is (`theirHand`, marked in `opponent.js`), and
      that is what keeps it off the cards of their prizes, their Stadium and their table -
      and off the cards of a Reveal Hand *window*, whose pile is a batch wearing the hand's
      own name. Which is also why it is drawn *below* the ping rather than above it: the
      menu a player already knows keeps the shape it had, and the entry a hand adds is the
      one that was not there before.

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

   /* the pile the card is drawn with, which is what says whether a hand is behind it */
   let pile = null

   export function open (x, y, _card, _revealed = true, _pile = null) {
      card = _card
      revealed = _revealed
      pile = _pile
      menu.open(x, y)
   }

   /*
      Pinging is a player's gesture and never a spectator's, and the entry says so
      rather than being removed for one: the menus on this board keep their shape
      between the two roles, so a spectator sees the entry it cannot take (the same
      rule `opponent/Deck.svelte` states for the four entries a spectator cannot take
      either). `pingCard` refuses one as well - the relay would refuse it too.

      *Reveal Hand* is drawn disabled on the same rule, and `canReveal` is what refuses
      it: solo has nobody to reveal to (both halves are one person) and a spectator owns
      no board to reveal from. A spectator looking at a card of a hand therefore sees both
      entries and may take neither, which is exactly what that hand's own zone menu
      already shows it.
   */
   function ping () {
      pingCard(card, revealed)
      menu.close()
   }

   /*
      Reveal the whole of the hand this card lies in - the zone's own gesture, taken from
      the card it was right-clicked on. Which hand that is, who is shown it and what the
      log says are `revealHand`'s, the same one function `opponent/Hand.svelte` calls, so
      the two routes cannot come to mean two different things; the marker above is only
      what decides whether the entry is drawn at all.
   */
   function revealTheirHand () {
      revealHand()
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

   <!--
      The hand zone's entry, offered on each card of the hand: drawn only where the pile
      behind the card is that hand, and disabled outside a room rather than removed, the
      way the zone's own menu draws it.
   -->
   {#if pile?.theirHand}
      <ContextMenuOption click={revealTheirHand} text="Reveal Hand" disabled={!canReveal()} />
   {/if}
</ContextMenu>
