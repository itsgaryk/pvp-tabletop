<script>
   import { getContext } from 'svelte'
   import { cardImage } from '$lib/util/assets.js'
   import { holdingCtrlOrCmd } from '$lib/util/ctrlcmd.js'
   import { share } from '$lib/stores/connection.js'
   import StatusMarker from '$lib/play/StatusMarker.svelte'
   import AbilityStripe from '$lib/play/AbilityStripe.svelte'

   import {
      discard, slotSelection as selection, selectSlot, removeSlot,
      attaching, evolving, attachSelection, cardSelection, selectCard, stadium
   } from '$lib/stores/player.js'

   const { openSlotDetails, openSlotMenu, openDetails, openCardMenu } = getContext('boardActions')

   export let slot

   $: ({ pokemon, trainer, energy, damage, status, abilityUsed } = slot)
   $: if (!$pokemon.length) {
      // discard the slot if it contains no pokemon (they can be moved away through the details view)
      discard.merge([ ...$trainer, ...$energy ])

      share('cardsMoved', { cards: $trainer.map(card => card._id), from: trainer.name, to: 'discard' })
      share('cardsMoved', { cards: $energy.map(card => card._id), from: energy.name, to: 'discard' })

      removeSlot(slot)

      share('slotDiscarded', { slotId: slot.id })
   }

   $: top = $pokemon[ $pokemon.length - 1]

   /*
      How far the cards attached to this Pokemon reach above the top of it, as a length
      a zone can spend - the row of a bench does, because a slot draws outside its own
      box and a zone that scrolls clips at its own (see Bench.svelte). The lifts are
      shares of the card (see global.css), the two cards being the same size, so the
      tallest attached card is what has to fit; a Pokemon carrying neither needs none
      of it.
   */
   $: attachLift = $trainer.length ? 'var(--slot-lift-tool)'
      : ($energy.length ? 'var(--slot-lift-energy)' : '0px')

   /* DnD */

   import { dnd } from '$lib/dnd/actions.js'
   import { draggedCard, source } from '$lib/dnd/store.js'
   import { dragging } from '$lib/dnd/pointer.js'
   import { solo, onOpponentHalf } from '$lib/stores/solo.js'

   /*
      Neither a Pokemon in play nor a card in the Stadium is attached to anything -
      and nor is anything of the far half's. A card out of the opponent's hand
      dragged onto this Pokemon used to be attached to it, underneath a Pokemon
      that is not its owner's.
   */
   const allowDrop = () => $source && $source !== 'slot' && $source !== stadium
      && !($solo && onOpponentHalf($source))

   /* the action hands the pointerdown over as { e } */
   function onDragStart ({ e }) {
      /*
         A pointerdown on an attached card starts a drag of that one card (see
         cardDnd below), so the slot itself must not also pick it up.
      */
      if (e?.target?.closest?.('[data-attached]')) return

      draggedCard.set(slot)
      source.set('slot')
   }

   function onDrag ({ $card }) {
      if ($card !== slot) return
      if (!$selection.includes(slot)) {
         selectSlot(slot)
      }
   }

   function onDragDrop () {
      if (!$attaching && !$evolving && $cardSelection.reduce((b, card) => b && card.card_type === 'pokemon', true)) {
         // neutral drag + all dragged cards are Pokémon, do evolve instead of attaching
         evolving.set(true)
      }
      attachSelection(slot)
   }

   const dndConfig = {
      start: onDragStart,
      drag: onDrag,
      drop: onDragDrop,
      allowDrop
   }

   /* selections analog zu Card.svelte */

   function onClick (e) {
      if ($attaching || $evolving) attachSelection(slot)
      else if (e.altKey) openDetails(top)
      else if (e.shiftKey) openSlotDetails(slot)
      else selectSlot(slot, holdingCtrlOrCmd(e))
   }

   function onCtx (e) {
      if (!$selection.includes(slot)) {
         selectSlot(slot, false)
      }

      openSlotMenu(e.clientX, e.clientY)
   }

   /*
      An attached card can be picked up on its own, without disturbing the
      Pokémon it is attached to. Left-clicking one selects that card (not the
      Pokémon), right-clicking opens the same menu a card in hand gets, and
      dragging one moves just that card - dropping it on another Pokémon attaches
      it there, dropping it on a pile moves it there.

      While an attach or evolve is in progress the click is left alone, so it
      still means "put it on this Pokémon".
   */
   function onCardClick (e, card, pile) {
      if ($attaching || $evolving) return

      e.stopPropagation()
      if (e.altKey) openDetails(card)
      else selectCard(card, pile, holdingCtrlOrCmd(e))
   }

   function onCardCtx (e, card, pile) {
      e.stopPropagation() // the slot's own menu must not open as well

      selectCard(card, pile, false)
      openCardMenu(e.clientX, e.clientY, true)
   }

   /*
      Dragging an attached card drags that card, not the whole slot. (Svelte only
      allows $store references at the top level of a component, so this reads the
      store directly instead.)
   */
   const cardDnd = (card, pile) => ({
      start: () => {
         draggedCard.set(card)
         source.set(pile)
      },
      /* the action hands over the card being dragged as { $card } */
      drag: (state) => {
         if (state.$card !== card) return
         if (!cardSelection.get().includes(card)) {
            selectCard(card, pile, false)
         }
      }
   })
</script>

<div class="slot relative w-max z-15"
   style="--attach-lift: {attachLift}; --slot-fan-count: {$energy.length + $trainer.length || 1}; --slot-fan: calc({$energy.length} * var(--slot-step-energy) + {$trainer.length} * var(--slot-step-tool))"
   class:dragged={$dragging && $selection.includes(slot)}
   on:click|stopPropagation={onClick}
   on:contextmenu={onCtx}
   on:dblclick={() => openSlotDetails(slot)}
   use:dnd={dndConfig}>

   {#if $damage}
      <span class="counter absolute bottom-1 left-1 z-15 rounded-full p-4 bg-red-500 text-white font-bold flex justify-center items-center">{$damage}</span>
   {/if}

   <StatusMarker status={$status} />

   {#if top}
      <div class="pokemon-card relative">
         <img src="{cardImage(top, 'xs')}" alt="{top.name}" draggable=false
            class="card pokemon relative z-10"
            class:selected={$selection.includes(slot)}
            class:target={$attaching || $evolving}
            class:attach={$attaching} class:evolve={$evolving}>
         <AbilityStripe used={abilityUsed} />
      </div>
   {/if}

   {#each $energy as nrg, i (nrg._id)}
      <img src="{cardImage(nrg, 'xs')}" alt="{nrg.name}" class="card absolute" draggable=false
         style="bottom: var(--slot-lift-energy); left: calc({i + 1} * var(--slot-fan-step-energy)); z-index: {$cardSelection.includes(nrg) ? 12 : 9 - i}"
         data-attached="energy"
         class:card-attached-selected={$cardSelection.includes(nrg)}
         on:click={(e) => onCardClick(e, nrg, energy)}
         on:contextmenu={(e) => onCardCtx(e, nrg, energy)}
         use:dnd={cardDnd(nrg, energy)}>
   {/each}

   {#each $trainer as tool, i (tool._id)}
      <img src="{cardImage(tool, 'xs')}" alt="{tool.name}" class="card absolute" draggable=false
         style="bottom: var(--slot-lift-tool); left: calc({$energy.length} * var(--slot-fan-step-energy) + {i + 1} * var(--slot-fan-step-tool)); z-index: {$cardSelection.includes(tool) ? 12 : 9 - i - $energy.length}"
         data-attached="trainer"
         class:card-attached-selected={$cardSelection.includes(tool)}
         on:click={(e) => onCardClick(e, tool, trainer)}
         on:contextmenu={(e) => onCardCtx(e, tool, trainer)}
         use:dnd={cardDnd(tool, trainer)}>
   {/each}
</div>

<style>
   .slot {
      /*
         A slot's cards are the size of the zone it is in, the same as every other card
         on the board: the zone a slot is in says what that is (`--slot-card-width`, set
         by the active spot and the bench), and a slot outside one - none is, today -
         keeps the size the dialogs use.

         The steps the cards attached to it keep are shares of it (see global.css): the
         fan grows and shrinks with the card, and a bench can spend the lift as room
         (--attach-lift, read by the bench).
      */
      --slot-width: var(--slot-card-width, var(--card-width));
      --slot-step-energy: calc(var(--slot-width) * var(--attach-step-energy));
      --slot-step-tool: calc(var(--slot-width) * var(--attach-step-tool));
      --slot-lift-energy: calc(var(--slot-width) * var(--attach-lift-energy));
      --slot-lift-tool: calc(var(--slot-width) * var(--attach-lift-tool));

      /*
         The steps the fan is actually drawn with, as against the ones the card gives
         it. They are the same thing wherever the fan has room to be as long as it is,
         which is the bench: its row is as long as it takes and scrolls (see
         Bench.svelte). The one zone that cannot do that is the active spot, so it is
         the one that tightens them - a fan that has to fit inside a box divides the
         room it is given between its cards rather than leaving the box (see
         Active.svelte). Everything the fan is placed with reads these, so a tightened
         fan is still a fan: the cards keep overlapping in the same order.
      */
      --slot-fan-step-energy: var(--slot-step-energy);
      --slot-fan-step-tool: var(--slot-step-tool);

      /*
         What the fan is worth in the flow this slot is in, which is its own length
         unless the zone it is in says otherwise: a slot in a row of slots - the bench -
         keeps the room its fan takes, so the next Pokemon is not drawn over it, and
         the row scrolls when the room runs out. The active spot reserves none of it
         (see Active.svelte): nothing is beside it, and its Pokemon is to keep the
         place a lone card has however many cards are attached to it.
      */
      margin-right: var(--slot-fan-reserve, var(--slot-fan, 0px));

      /*
         And a slot is the size of its card whatever line it is in. A flex item is
         shrinkable by default, and a slot whose box was squeezed would draw its
         Pokemon - and place its fan - against a box narrower than the card the zone
         gave it: the fan's steps are shares of the card, so the cards would come out
         apart from one another rather than overlapping (see `max-width` below).
      */
      flex: none;
   }

   img.card {
      width: var(--slot-width);
      /*
         A card is the size the zone gives it, and **never the size of the box it is
         drawn in**. The reset this app wears puts `max-width: 100%` on every image,
         and the box an attached card is drawn in is the slot it is attached to: when
         that box was narrower than the card - a squeezed slot, a Pokemon whose image
         has not arrived - every card was clamped to the box while the step it was
         placed with, a share of the *card*, was not. A fan of small cards with gaps
         between them is what that looks like, and it is the bug this line is here to
         make impossible: nothing a card is drawn in may resize it.
      */
      max-width: none;
      @apply box-content border-2 border-transparent rounded-md;
   }

   img.card.selected {
      @apply border-[var(--selection-color)];
   }

   /*
      An attached card shows its selection as a glow around the card, and comes
      to the front (see the z-index in the markup) so the whole card can be seen
      - otherwise most of it hides behind the Pokémon in front of it and a glow
      on a sliver is easy to miss. The .slot part outranks the plain card
      drop-shadow rule in Board.svelte.
   */
   .slot img.card-attached-selected {
      outline: 2px solid var(--selection-color);
      outline-offset: -2px;
      filter: drop-shadow(0 0 6px var(--selection-color));
      --shadow-color: transparent;
   }

   .target {
      filter: drop-shadow(0px 0px 10px var(--drop-shadow-color)) !important;
   }

   .target.attach {
      --drop-shadow-color: purple;
   }

   .target.evolve {
      --drop-shadow-color: blue;
   }

   :global(.slot.dragover) .pokemon {
      @apply border-green-500;
   }

   .counter {
      width: calc(var(--slot-width) / 2.5);
      height: calc(var(--slot-width) / 2.5);
   }
</style>