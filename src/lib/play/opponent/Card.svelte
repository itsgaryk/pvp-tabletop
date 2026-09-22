<script>
   import { getContext } from 'svelte'
   import { cardImage } from '$lib/util/assets.js'
   import cardback from '$lib/assets/cardback_int.png'
   import { solo } from '$lib/stores/solo.js'
   import { spectating } from '$lib/stores/connection.js'
   import { defaultOpponent } from '$lib/stores/opponent.js'
   import { dnd } from '$lib/dnd/actions.js'
   import { draggedCard, source } from '$lib/dnd/store.js'
   import { dragging } from '$lib/dnd/pointer.js'
   import { holdingCtrlOrCmd } from '$lib/util/ctrlcmd.js'
   import { cardSelection as selection, selectCard } from '$lib/stores/player.js'
   import { isActionable } from '$lib/stores/reveal.js'

   const { openDetails, openOppCardMenu, openOppCardActionMenu } = getContext('boardActions')

   export let card
   export let pile
   export let revealed = true

   /*
      Whether this card advertises itself with the pulse (see `.actionable`).

      On in a Reveal, where a window of the other player's cards sits in a grid beside
      cards of the player's own and nothing else says which reply; **off in a Look**,
      where every card in the window is the player's to act on, so a pulse on all of
      them is decoration - and worse than decoration, because a card that is always
      glowing is a card that never reads as *chosen*. The Look window's cards still
      answer a click and still take the selection ring; they just do not shout about it.
   */
   export let pulse = true

   /*
      Whether this card may be acted on as the other player's.

      Two different situations answer yes, and they are the two ways this half is
      somebody the player can play for:

         - **solo**, where the far half is the same person's - the whole half is
           played from this keyboard, which is why its zones are draggable there
         - **a Reveal or a Look**, where the cards of the other half's *deck* have
           been shown to this player on purpose, which is the "allowed to take
           action on this opponent card" property (see docs/reveal.md)

      Nothing else does. A card of the other half's that is merely visible - a
      Stadium in play, a Pokemon on the Bench - is not this player's to touch, and
      the check is the batch rather than the card: a flag written onto the card
      would follow it onto its owner's own board, where it would offer the
      opponent's menu for their own card. That is why the answer lives in a store
      (`reveal.js`) rather than on the card object.
   */
   $: actionable = $solo || isActionable(card)
   /* the pulse is a Reveal's affordance, not a Look's - see `pulse` above */
   $: glowing = actionable && pulse

   /*
      A player may look at the far half's cards where they are on show - a Pokemon
      in play, a Stadium, and now a card a Reveal has shown them - but not what is
      in its hand or its prizes. Those are hidden for a reason, and a double click
      must not be a way round it. A spectator, and solo, may open anything: nothing
      there is a secret from them.
   */
   function onDetails () {
      if ($spectating || $solo) {
         openDetails(card)
         return
      }

      if (!actionable) return

      const hidden = pile === defaultOpponent.hand || pile === defaultOpponent.prizes
      if (!hidden) openDetails(card)
   }

   /*
      Dragging is the far half's own gesture, and in solo it carries a card of that
      half's between its zones.

      A card a Reveal or a Look is showing is the *other* entry: it is not on the board
      at all, so dragging it has nowhere of this board's to land - it is a request to its
      owner, exactly as a menu entry is, and the far half's zones are what take it
      (`opponent/Pile.svelte`, `opponent/Active.svelte`). So a dragged revealed card sets
      the same two stores, and the batch it came from travels as the source because that
      is what the drop needs to find the card on this board's mirror.
   */
   function onDragStart () {
      if ($solo) {
         draggedCard.set(card)
         source.set(pile)
         return
      }

      if (!actionable) return
      draggedCard.set(card)
      source.set(pile)
   }

   function onDrag ({ $card }) {
      if ($card !== card) return
      if (!$solo && !actionable) return
      if (!$selection.includes(card)) selectCard(card, pile, false)
   }

   const dndConfig = { start: onDragStart, drag: onDrag }

   function onClick (e) {
      if (!actionable) return
      /* further up is a click listener that resets the selection, so stop that */
      e.stopPropagation()
      selectCard(card, pile, holdingCtrlOrCmd(e))
   }

   function onCtx (e) {
      if (!actionable || !pile) return
      e.preventDefault()
      e.stopPropagation()
      if (!$selection.includes(card)) selectCard(card, pile, false)

      /*
         Two menus, and the situation picks between them: in solo the far half is
         played from this board, so it is the player's own menu's entries with the
         cards landing on that half (`OppCardMenu`). In a room the card belongs to
         somebody else, so every entry is a request to them - the menu for a card
         the player is *allowed* to act on (`OppCardActionMenu`).

         The pile goes with it, and it is what tells the menu where the card is:
         on the board it is one of the far half's own lists, and in a Reveal or a
         Look it is the batch those windows hand over (see `reveal.js`) - which
         `oppAction.js` recognizes by asking the board's own `piles()`, the same
         way every other "which pile is this card in" is answered.
      */
      if ($solo) openOppCardMenu(e.clientX, e.clientY, pile, card, revealed)
      else openOppCardActionMenu(e.clientX, e.clientY, card, revealed, pile)
   }
</script>

<div
   on:click={onClick}
   on:contextmenu={onCtx}
   on:dblclick={onDetails}
   class="border-2 border-transparent rounded-md"
   class:actionable={glowing}
   class:dragged={$dragging && $selection.includes(card) && ($solo || actionable)}
   class:selected={actionable && $selection.includes(card)}
   use:dnd={dndConfig}>
   {#if revealed}
      <img class="card" src="{cardImage(card, 'xs')}" alt="{card.name}" draggable=false>
   {:else}
      <img class="card" src={cardback} alt="Hidden Card" draggable=false>
   {/if}
</div>

<style>
   /*
      The same two states the player's own cards use, and the same colours: a
      selection is `--selection-color` wherever it is (see board/Card.svelte), which
      is what every other selected thing on either half draws with. This used to be
      `--primary-color` here - the accent the board uses for a *marked* card, a
      different idea - so a card selected on the far half was picked out in the
      wrong colour, and did so under a comment claiming the two halves matched.
   */
   .selected {
      @apply border-[var(--selection-color)];
      --shadow-color: transparent;
   }

   .dragged {
      opacity: 0.5;
   }

   /*
      A card this player may act on is picked out where it lies.

      It has to be, and this is the one thing about the property that is not
      obvious: a card that can be clicked looks *exactly* like one that cannot -
      the same face, in the same grid, in a window the player is reading - and the
      only feedback a click gives is a ring that appears *after* it. A Reveal's
      cards are the other player's, so the default assumption is that they are
      inert, and a player who assumes that never finds the menu. So the cards that
      answer are the ones that say so - in a Reveal, where a card of the other
      player's is only one or two of the cards on screen. In a Look every card in the
      window answers, so there is nothing to single out and the caller turns the pulse
      off (`pulse` above).

      It is an `outline` and not the `border` the selected state uses, and that is
      not a style choice: the card wears Windi's `border-2 border-transparent` from its
      own markup, and a scoped rule here compiles to a class of the same specificity,
      later in the sheet - so an outline is what can be drawn *beside* the ring a
      selection draws rather than instead of it. The two are on screen together the
      moment a revealed card is clicked, and a border would have been one or the other.

      That `border-transparent` is load-bearing and was dropped once: without it
      `border-2` draws in `currentColor`, so **every** card of the other half's wore a
      2px pale ring - a "permanent white border" on the opponent's hand, reported
      exactly that way. A wrapper around a card is a box that draws things.

      It is a *pulse* because the difference has to be visible at a glance without
      being mistaken for a selection, which is `--selection-color` and is already
      spoken for. Only the outline *colour* is animated, and an outline takes no
      room, so a card cannot move when it starts to glow - which is the same rule
      the selection ring follows (see docs/selection.md, rule 2).
   */
   .actionable {
      outline: 2px solid var(--primary-color);
      outline-offset: -2px;
      animation: actionable 1.8s ease-in-out infinite;
   }

   @keyframes actionable {
      0%, 100% {
         outline-color: var(--primary-color);
      }
      50% {
         outline-color: rgba(255, 255, 255, 0.9);
      }
   }
</style>
