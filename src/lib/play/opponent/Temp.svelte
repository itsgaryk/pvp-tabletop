<script>
   import { getContext } from 'svelte'
   import { cardImage } from '$lib/util/assets.js'
   import Pile from './Pile.svelte'
   import ContextMenuOption from '$lib/components/ContextMenuOption.svelte'
   import { defaultOpponent } from '$lib/stores/opponent.js'
   import { solo } from '$lib/stores/solo.js'
   import { cardSelection, selectPile } from '$lib/stores/player.js'

   /* DnD */

   import { dnd } from '$lib/dnd/actions.js'
   import { draggedCard, source } from '$lib/dnd/store.js'
   import { dragging } from '$lib/dnd/pointer.js'

   const { openOppPile } = getContext('boardActions')

   /* which player's board this component shows */
   export let store = defaultOpponent
   $: ({ table } = store)

   let menu
   $: top = $table[$table.length - 1]

   function selected (selection) {
      for (const card of $table) {
         if (selection.includes(card)) return true
      }
      return false
   }

   /*
      In solo the table on the far half is yours too, so it is picked up the way
      your own is: the whole pile at once, by clicking it or by dragging the card
      on top of it.
   */
   function selectAll () {
      if ($solo) selectPile(table)
   }

   function onDragStart () {
      if (!$solo) return
      draggedCard.set(top)
      source.set(table)
   }

   function onDrag ({ $card }) {
      if (!$solo || $card !== top) return
      if (!$cardSelection.includes(top)) {
         selectAll()
      }
   }

   const dndConfig = {
      start: onDragStart,
      drag: onDrag
   }

   /* an empty table opens nothing, the way the player's own empty table does not */
   function onCtx (e) {
      if (!$table.length) e.stopPropagation()
   }
</script>

<Pile pile={table} name="Table" displayCount={false} showMenu={$solo} bind:menu={menu}>
   <div class="h-full flex justify-center items-center" on:contextmenu={onCtx}>
      <div class="relative w-max"
         style="margin-bottom: {($table.length - 1) * 35}px; margin-right: {$table.length > 1 ? 20 : 0}px"
         class:selected={$solo && selected($cardSelection)}
         class:dragged={$solo && $dragging && $cardSelection.includes(top)}
         on:click|stopPropagation={selectAll}
         on:dblclick={() => openOppPile(table)}
         use:dnd={dndConfig}>

         {#if $table.length > 0}
            <img class="card" src="{cardImage($table[0], 'xs')}" alt={$table[0].name} draggable="false">
            {#each $table as card, i (card._id)}
               {#if i >= 1}
                  <img class="card absolute" src="{cardImage(card, 'xs')}" alt={card.name} draggable="false"
                     style="bottom: -{i * 35}px; left: {i % 2 !== 0 ? 20 : 0}px">
               {/if}
            {/each}
         {/if}
      </div>
   </div>

   <svelte:fragment slot="menu">
      <ContextMenuOption click={() => openOppPile(table)} text="View All" />
   </svelte:fragment>
</Pile>

<style>
   .selected {
      --drop-shadow-color: #fbbf24;
      filter: drop-shadow(0px 0px 10px var(--drop-shadow-color)) !important;
   }

   .dragged {
      @apply opacity-50;
   }
</style>
