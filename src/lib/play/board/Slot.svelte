<script>
   import { getContext } from 'svelte'
   import { cardImage } from '$lib/util/assets.js'
   import { holdingCtrlOrCmd } from '$lib/util/ctrlcmd.js'
   import { share } from '$lib/stores/connection.js'
   import StatusMarker from '$lib/play/StatusMarker.svelte'
   import AbilityStripe from '$lib/play/AbilityStripe.svelte'

   import {
      discard, slotSelection as selection, selectSlot, removeSlot,
      attaching, evolving, attachSelection, cardSelection, selectCard
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

   /* DnD */

   import { dnd } from '$lib/dnd/actions.js'
   import { draggedCard, source } from '$lib/dnd/store.js'
   import { dragging } from '$lib/dnd/pointer.js'

   const allowDrop = () => $source && $source !== 'slot' && $source !== 'stadium'

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

<div class="slot relative w-max z-15" style="margin-right: calc({$energy.length * 25 + $trainer.length * 35}px * var(--card-scale))"
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
         style="bottom: calc(17px * var(--card-scale)); left: calc({(i + 1)* 25}px * var(--card-scale)); z-index: {$cardSelection.includes(nrg) ? 12 : 9 - i}"
         data-attached="energy"
         class:card-attached-selected={$cardSelection.includes(nrg)}
         on:click={(e) => onCardClick(e, nrg, energy)}
         on:contextmenu={(e) => onCardCtx(e, nrg, energy)}
         use:dnd={cardDnd(nrg, energy)}>
   {/each}

   {#each $trainer as tool, i (tool._id)}
      <img src="{cardImage(tool, 'xs')}" alt="{tool.name}" class="card absolute" draggable=false
         style="bottom: calc(34px * var(--card-scale)); left: calc({$energy.length * 25 + (i + 1) * 35}px * var(--card-scale)); z-index: {$cardSelection.includes(tool) ? 12 : 9 - i - $energy.length}"
         data-attached="trainer"
         class:card-attached-selected={$cardSelection.includes(tool)}
         on:click={(e) => onCardClick(e, tool, trainer)}
         on:contextmenu={(e) => onCardCtx(e, tool, trainer)}
         use:dnd={cardDnd(tool, trainer)}>
   {/each}
</div>

<style>
   img.card {
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
      width: calc(calc(var(--card-width) * var(--card-scale)) / 2.5);
      height: calc(calc(var(--card-width) * var(--card-scale)) / 2.5);
   }
</style>