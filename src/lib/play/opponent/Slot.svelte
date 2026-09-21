<script>
   import { getContext } from 'svelte'
   import { cardImage } from '$lib/util/assets.js'
   import cardback from '$lib/assets/cardback_int.png'
   import { defaultOpponent } from '$lib/stores/opponent.js'
   import { solo, soloSlotAttach, onOpponentHalf } from '$lib/stores/solo.js'
   import { spectating } from '$lib/stores/connection.js'
   import { holdingCtrlOrCmd } from '$lib/util/ctrlcmd.js'
   import StatusMarker from '$lib/play/StatusMarker.svelte'
   import AbilityStripe from '$lib/play/AbilityStripe.svelte'

   import {
      cardSelection, slotSelection, selectCard, selectSlot,
      attaching, evolving
   } from '$lib/stores/player.js'

   import { dnd } from '$lib/dnd/actions.js'
   import { draggedCard, source } from '$lib/dnd/store.js'
   import { dragging } from '$lib/dnd/pointer.js'

   const { openOppSlotDetails, openOppSlotMenu, openSlotDetails, openDetails, openOppCardMenu } = getContext('boardActions')

   /* which player's board this component shows */
   export let store = defaultOpponent
   export let slot

   $: ({ pokemonHidden, active } = store)

   /* a status effect can only be set on the Active Pokémon */
   $: isActive = active.get() === slot

   /* these are piles belonging to the slot itself, not to the mirrored board */
   $: ({ pokemon, trainer, energy, damage, status, abilityUsed } = slot)
   $: top = $pokemon[ $pokemon.length - 1]

   /* how far this Pokemon's attached cards reach above it: the near half's note, in
      board/Slot.svelte, in full */
   $: attachLift = $trainer.length ? 'var(--attach-lift-tool)'
      : ($energy.length ? 'var(--attach-lift-energy)' : '0px')

   /* DnD */

   /*
      A card of that half's own can be dropped on one of its Pokémon in solo: the
      same drop your own half accepts. Nothing crosses between the halves, so the
      drag has to have started on this one.
   */
   const allowDrop = () => $solo && onOpponentHalf($source) && $source !== 'slot'

   /* the action hands the pointerdown over as { e } */
   function onDragStart ({ e }) {
      if (!$solo) return
      /*
         A pointerdown on an attached card starts a drag of that one card (see
         cardDnd below), so the slot itself must not also pick it up.
      */
      if (e?.target?.closest?.('[data-attached]')) return

      draggedCard.set(slot)
      source.set('slot')
   }

   function onDrag ({ $card }) {
      if (!$solo || $card !== slot) return
      if (!$slotSelection.includes(slot)) selectSlot(slot)
   }

   function onDragDrop () {
      if (!$solo) return
      /* a plain drag of Pokémon evolves; anything else attaches */
      let evo = $evolving
      if (!$attaching && !evo && $cardSelection.reduce((b, card) => b && card.card_type === 'pokemon', true)) evo = true

      soloSlotAttach(slot, evo)
   }

   const dndConfig = {
      start: onDragStart,
      drag: onDrag,
      drop: onDragDrop,
      allowDrop
   }

   /*
      A player only watches the far half, so what the clicks mean there is decided
      by who is looking. A spectator inspects; in solo that half is yours, so its
      Pokémon is selected exactly the way your own is - the click picks it up, Alt
      shows the card, Shift its contents, and an Attach or Evolve in progress makes
      the click mean "put it on this one". Right-clicking records damage, status
      and the ability use, which is a player's business either way.
   */
   function onClick (e) {
      if ($pokemonHidden) return
      if (!$spectating && !$solo) return

      if ($solo) {
         if ($attaching || $evolving) soloSlotAttach(slot, $evolving)
         else if (e.altKey) openDetails(top)
         else if (e.shiftKey) openSlotDetails(slot)
         else selectSlot(slot, holdingCtrlOrCmd(e))
         return
      }

      if (e.altKey) openDetails(top)
      else openOppSlotDetails(slot)
   }

   /*
      Double clicking a Pokemon in play shows the card itself, whoever is looking:
      it is on the table, not in a hand. In solo the whole slot is yours, so it
      opens what double clicking your own half's Pokemon opens - the Pokemon's
      moves and abilities, its damage, and the cards under it.
   */
   function onDblClick () {
      if ($pokemonHidden || !top) return

      if ($solo) openSlotDetails(slot)
      else openDetails(top)
   }

   function onCtx (e) {
      if ($pokemonHidden) return
      /* the menu belongs to the Pokemon, so the click selects it first */
      if ($solo && !$slotSelection.includes(slot)) selectSlot(slot, false)

      openOppSlotMenu(e.clientX, e.clientY, slot, isActive)
   }

   /*
      An attached card can be picked up on its own, without disturbing the Pokémon
      it is attached to - exactly as on your own half. Left-clicking one selects
      that card (not the Pokémon), right-clicking opens the same menu a card in
      that half's hand gets, and dragging one moves just that card.
   */
   function onCardClick (e, card, pile) {
      if (!$solo || $attaching || $evolving) return

      e.stopPropagation()
      if (e.altKey) openDetails(card)
      else selectCard(card, pile, holdingCtrlOrCmd(e))
   }

   function onCardCtx (e, card, pile) {
      if (!$solo) return

      e.stopPropagation() // the slot's own menu must not open as well
      selectCard(card, pile, false)
      openOppCardMenu(e.clientX, e.clientY, pile, card)
   }

   /* (Svelte only allows $store references at the top level, so the stores are
      read directly here.) */
   const cardDnd = (card, pile) => ({
      start: () => {
         if (!$solo) return
         draggedCard.set(card)
         source.set(pile)
      },
      drag: (state) => {
         if (!$solo || state.$card !== card) return
         if (!cardSelection.get().includes(card)) {
            selectCard(card, pile, false)
         }
      }
   })
</script>

<div class="slot relative w-max z-15"
   style="--attach-lift: {attachLift}; --slot-fan-count: {$energy.length + $trainer.length || 1}; --slot-fan: calc({$energy.length} * var(--slot-step-energy) + {$trainer.length} * var(--slot-step-tool))"
   class:dragged={$solo && $dragging && $slotSelection.includes(slot)}
   on:click|stopPropagation={onClick}
   on:contextmenu={onCtx}
   on:dblclick={onDblClick}
   use:dnd={dndConfig}>

   {#if $damage}
      <span class="counter absolute bottom-1 left-1 z-15 rounded-full p-4 bg-red-500 text-white font-bold flex justify-center items-center">{$damage}</span>
   {/if}

   <StatusMarker status={$status} />

   {#if top}
      <div class="pokemon-card relative">
         <img
            src="{$pokemonHidden ? cardback : cardImage(top, 'xs')}"
            alt="{$pokemonHidden ? 'Hidden Pokémon' : top.name}"
            class="card pokemon relative z-10" draggable=false
            class:selected={$solo && $slotSelection.includes(slot)}
            class:target={$solo && ($attaching || $evolving)}
            class:attach={$solo && $attaching} class:evolve={$solo && $evolving}>
         <AbilityStripe used={abilityUsed} />
      </div>
   {/if}

   {#each $energy as nrg, i (nrg._id)}
      <img src="{cardImage(nrg, 'xs')}" alt="{nrg.name}" class="card absolute" draggable=false
         style="bottom: var(--slot-lift-energy); left: calc({i + 1} * var(--slot-fan-step-energy)); z-index: {$solo && $cardSelection.includes(nrg) ? 12 : 9 - i}"
         data-attached="energy"
         class:card-attached-selected={$solo && $cardSelection.includes(nrg)}
         on:click={(e) => onCardClick(e, nrg, energy)}
         on:contextmenu={(e) => onCardCtx(e, nrg, energy)}
         use:dnd={cardDnd(nrg, energy)}>
   {/each}

   {#each $trainer as tool, i (tool._id)}
      <img src="{cardImage(tool, 'xs')}" alt="{tool.name}" class="card absolute" draggable=false
         style="bottom: var(--slot-lift-tool); left: calc({$energy.length} * var(--slot-fan-step-energy) + {i + 1} * var(--slot-fan-step-tool)); z-index: {$solo && $cardSelection.includes(tool) ? 12 : 9 - i - $energy.length}"
         data-attached="trainer"
         class:card-attached-selected={$solo && $cardSelection.includes(tool)}
         on:click={(e) => onCardClick(e, tool, trainer)}
         on:contextmenu={(e) => onCardCtx(e, tool, trainer)}
         use:dnd={cardDnd(tool, trainer)}>
   {/each}
</div>

<style>
   .slot {
      /* the near half's slot, steps and all: board/Slot.svelte, in full */
      --slot-width: var(--slot-card-width, var(--card-width));
      --slot-step-energy: calc(var(--slot-width) * var(--attach-step-energy));
      --slot-step-tool: calc(var(--slot-width) * var(--attach-step-tool));
      --slot-lift-energy: calc(var(--slot-width) * var(--attach-lift-energy));
      --slot-lift-tool: calc(var(--slot-width) * var(--attach-lift-tool));
      /* the steps the fan is drawn with, which the active spot tightens */
      --slot-fan-step-energy: var(--slot-step-energy);
      --slot-fan-step-tool: var(--slot-step-tool);
      /* what the fan is worth in the flow: its length, unless the zone says otherwise */
      margin-right: var(--slot-fan-reserve, var(--slot-fan, 0px));
      /* a slot is the size of its card whatever line it is in */
      flex: none;
   }

   img.card {
      width: var(--slot-width);
      /* a card is the size the zone gives it, never the size of the box it is drawn
         in - the reset's `max-width: 100%` is what put a squeezed slot's cards out of
         step with the fan's steps (see board/Slot.svelte) */
      max-width: none;
      @apply box-content border-2 border-transparent rounded-md;
   }

   /* the same states the player's own Pokemon use */
   img.card.selected {
      @apply border-[var(--selection-color)];
      --shadow-color: transparent;
   }

   .dragged {
      @apply opacity-50;
   }

   /* an attached card that is selected, shown the way the player's own shows it */
   .slot img.card-attached-selected {
      outline: 2px solid var(--selection-color);
      outline-offset: -2px;
      filter: drop-shadow(0 0 6px var(--selection-color));
      --shadow-color: transparent;
   }

   /* an Attach / Evolve in progress: this Pokemon is a legal target */
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

   /* rotated back by the flipped half this slot is shown in (see Board.svelte) */
   .counter {
      width: calc(var(--slot-width) / 2.5);
      height: calc(var(--slot-width) / 2.5);
   }
</style>
