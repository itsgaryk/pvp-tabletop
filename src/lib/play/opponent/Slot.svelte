<script>
   import { getContext } from 'svelte'
   import { cardImage } from '$lib/util/assets.js'
   import cardback from '$lib/assets/cardback_int.png'
   import { defaultOpponent } from '$lib/stores/opponent.js'
   import { solo } from '$lib/stores/solo.js'
   import { spectating } from '$lib/stores/connection.js'
   import StatusMarker from '$lib/play/StatusMarker.svelte'
   import AbilityStripe from '$lib/play/AbilityStripe.svelte'
   const { openOppSlotDetails, openOppSlotMenu, openDetails } = getContext('boardActions')

   /* which player's board this component shows */
   export let store = defaultOpponent
   export let slot

   $: ({ pokemonHidden, active } = store)

   /* a status effect can only be set on the Active Pokémon */
   $: isActive = active.get() === slot

   /* these are piles belonging to the slot itself, not to the mirrored board */
   $: ({ pokemon, trainer, energy, damage, status, abilityUsed } = slot)
   $: top = $pokemon[ $pokemon.length - 1]

   /*
      A player only watches the far half, so a single click on its Pokemon does
      nothing: inspecting them belongs to a spectator, and to solo, where that
      half is yours. Right-clicking still opens the menu that records damage,
      status and the ability use, which is a player's business.
   */
   function onClick (e) {
      if ($pokemonHidden) return
      if (!$spectating && !$solo) return

      if (e.altKey) openDetails(top)
      else openOppSlotDetails(slot)
   }

   /*
      Double clicking a Pokemon in play shows the card itself, whoever is looking:
      it is on the table, not in a hand. A single click stays as it was - nothing
      for a player, the slot's contents for a spectator.
   */
   function onDblClick () {
      if ($pokemonHidden || !top) return
      openDetails(top)
   }

   function onCtx (e) {
      if ($pokemonHidden) return
      openOppSlotMenu(e.clientX, e.clientY, slot, isActive)
   }
</script>

<div class="slot relative w-max z-15" style="margin-right: calc({$energy.length * 25 + $trainer.length * 35}px * var(--card-scale))"
   on:click|stopPropagation={onClick}
   on:contextmenu={onCtx}
   on:dblclick={onDblClick}>

   {#if $damage}
      <span class="counter absolute bottom-1 left-1 z-15 rounded-full p-4 bg-red-500 text-white font-bold flex justify-center items-center">{$damage}</span>
   {/if}

   <StatusMarker status={$status} />

   {#if top}
      <div class="pokemon-card relative">
         <img
            src="{$pokemonHidden ? cardback : cardImage(top, 'xs')}"
            alt="{$pokemonHidden ? 'Hidden PokÃ©mon' : top.name}"
            class="card pokemon relative z-10" draggable=false>
         <AbilityStripe used={abilityUsed} />
      </div>
   {/if}

   {#each $energy as nrg, i (nrg._id)}
      <img src="{cardImage(nrg, 'xs')}" alt="{nrg.name}" class="card absolute" draggable=false
         style="bottom: calc(17px * var(--card-scale)); left: calc({(i + 1)* 25}px * var(--card-scale)); z-index: {9 - i}">
   {/each}

   {#each $trainer as tool, i (tool._id)}
      <img src="{cardImage(tool, 'xs')}" alt="{tool.name}" class="card absolute" draggable=false
         style="bottom: calc(34px * var(--card-scale)); left: calc({$energy.length * 25 + (i + 1) * 35}px * var(--card-scale)); z-index: {9 - i - $energy.length}">
   {/each}
</div>

<style>
   img.card {
      @apply box-content border-2 border-transparent rounded-md;
   }

   /* rotated back by the flipped half this slot is shown in (see Board.svelte) */
   .counter {
      width: calc(var(--card-width) * var(--card-scale) / 2.5);
      height: calc(var(--card-width) * var(--card-scale) / 2.5);
   }
</style>
