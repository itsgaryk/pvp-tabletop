<script>
   import { getContext } from 'svelte'
   import { cardImage } from '$lib/util/assets.js'
   import { holdingCtrlOrCmd } from '$lib/util/ctrlcmd.js'
   import Pile from './Pile.svelte'
   import Vertical from '$lib/components/scroll/Vertical.svelte'
   import ContextMenuOption from '$lib/components/ContextMenuOption.svelte'
   import { defaultOpponent } from '$lib/stores/opponent.js'
   import { solo } from '$lib/stores/solo.js'
   import { cardSelection, selectCard } from '$lib/stores/player.js'

   /* DnD */

   import { dnd } from '$lib/dnd/actions.js'
   import { draggedCard, source } from '$lib/dnd/store.js'
   import { dragging } from '$lib/dnd/pointer.js'

   const { openOppPile, openOppCardMenu } = getContext('boardActions')

   /* which player's board this component shows */
   export let store = defaultOpponent
   $: ({ table } = store)

   /*
      The far half's table, drawn the same way the player's own is: a cascade, with
      every card in it picked up on its own and the handlers on the card's own image
      - see board/Temp.svelte for why there is no wrapper around it, which is the
      stack's geometry rather than a style.

      In solo that half is the player's too, so its cards are selectable - each one
      by itself, with Ctrl/Cmd to add, and its own menu on a right click. Online the
      half belongs to somebody else, so nothing here is clickable: the handlers
      return, as `opponent/Card.svelte`'s do, and the click falls through to the
      board's own listener and clears the selection.
   */

   function onClick (e, card) {
      if (!$solo) return
      /* further up is a click listener that reset the selection, so stop that */
      e.stopPropagation()
      selectCard(card, table, holdingCtrlOrCmd(e))
   }

   function onCtx (e, card) {
      if (!$solo) return

      e.preventDefault()
      e.stopPropagation()
      if (!$cardSelection.includes(card)) selectCard(card, table, false)
      openOppCardMenu(e.clientX, e.clientY, table, card)
   }

   const cardDnd = (card) => ({
      start: () => {
         if (!$solo) return
         draggedCard.set(card)
         source.set(table)
      },
      drag: (state) => {
         if (!$solo || state.$card !== card) return
         if (!cardSelection.get().includes(card)) selectCard(card, table, false)
      }
   })

   /* an empty table opens nothing, the way the player's own empty table does not */
   function onCtxStack (e) {
      if (!$table.length) e.stopPropagation()
   }
</script>

<Pile pile={table} name="Table" displayCount={false} showMenu={$solo} selectAll={false}>
   <Vertical>
      <div class="table-zone" on:contextmenu={onCtxStack}>
         <div class="table-stack relative w-max"
            style="margin-bottom: calc({$table.length - 1} * var(--table-step))"
            on:dblclick={() => openOppPile(table)}>

            {#each $table as card, i (card._id)}
               <img class="card table-card"
                  class:stacked={i > 0}
                  class:selected={$solo && $cardSelection.includes(card)}
                  class:dragged={$solo && $dragging && $cardSelection.includes(card)}
                  src="{cardImage(card, 'xs')}" alt={card.name} draggable="false"
                  style="bottom: calc({-i} * var(--table-step)); z-index: {$solo && $cardSelection.includes(card) ? 12 : i + 1}"
                  on:click={(e) => onClick(e, card)}
                  on:contextmenu={(e) => onCtx(e, card)}
                  use:dnd={cardDnd(card)}>
            {/each}
         </div>
      </div>
   </Vertical>

   <svelte:fragment slot="menu">
      <ContextMenuOption click={() => openOppPile(table)} text="View All" />
   </svelte:fragment>
</Pile>

<style>
   /* the near half's zone, scroller and all: board/Temp.svelte, in full */
   .table-zone {
      min-height: 100%;
      width: 100%;
      display: flex;
      justify-content: safe center;
      align-items: safe center;
   }

   /* the near half's stack and the width it keeps, in full: board/Temp.svelte */
   .table-stack {
      flex: none;
   }

   /* the near half's card, sized by the zone's width, in full: board/Temp.svelte */
   img.card.table-card {
      width: var(--table-card-width);
   }

   /* the near half's stack, and the reasons for this, in full: board/Temp.svelte */
   .table-card {
      position: relative;
   }

   .table-card.stacked {
      position: absolute;
   }

   /*
      The same two states the player's own cards use, and the same colours - with
      `img.card` in the selector for the same specificity reason (board/Temp.svelte
      has the arithmetic).
   */
   img.card.table-card.selected {
      outline: 2px solid var(--selection-color);
      outline-offset: -2px;
      filter: drop-shadow(0 0 6px var(--selection-color));
      --shadow-color: transparent;
   }

   .table-card.dragged {
      @apply opacity-50;
   }
</style>
