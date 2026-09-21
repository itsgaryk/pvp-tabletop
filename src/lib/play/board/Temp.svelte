<script>
   import { getContext } from 'svelte'
   import { cardImage } from '$lib/util/assets.js'
   import { holdingCtrlOrCmd } from '$lib/util/ctrlcmd.js'
   import Pile from './Pile.svelte'
   import ContextMenuOption from '$lib/components/ContextMenuOption.svelte'

   import { table, cardSelection, selectCard } from '$lib/stores/player.js'
   const { openPile, openCardMenu } = getContext('boardActions')

   /*
      The table is a stack of cards, drawn as a cascade: the first card sizes the
      stack and every card after it is laid over the one above at its own offset.

      Every card in it is picked up **on its own**, the way a card attached under a
      Pokemon is (see Slot.svelte): a click selects that card rather than the whole
      stack, Ctrl/Cmd adds it to the selection, right-clicking one opens that card's
      menu, and dragging one carries that card. The stack as a whole is still here -
      *View All* is the double click and the W key, and the zone's own menu opens on
      the part of it no card is on - but nothing selects the whole table at once,
      which is why the zone asks its Pile for no Ctrl+A (see `selectAll` there).
   */

   /* DnD */

   import { dnd } from '$lib/dnd/actions.js'
   import { draggedCard, source } from '$lib/dnd/store.js'
   import { dragging } from '$lib/dnd/pointer.js'

   function onClick (e, card) {
      // the document's own listener resets the selection, so stop that
      e.stopPropagation()

      selectCard(card, table, holdingCtrlOrCmd(e)) // if ctrl is pressed, add to selection instead of overwriting
   }

   /*
      Right clicking a card is that card's menu rather than the table's: it is one
      card of the stack that was clicked, so it is one card the menu is about. The
      table's own menu (View All) is on the stack's background and on the W key.
   */
   function onCtx (e, card) {
      e.stopPropagation() // to not get overridden by the pile level context menu

      if (!$cardSelection.includes(card)) {
         selectCard(card, table, false)
      }

      openCardMenu(e.clientX, e.clientY)
   }

   /*
      Dragging a card drags that card. (Svelte only allows $store references at the
      top level of a component, so this reads the store directly instead.)
   */
   const cardDnd = (card) => ({
      start: () => {
         draggedCard.set(card)
         source.set(table)
      },
      /* the action hands over the card being dragged as { $card } */
      drag: (state) => {
         if (state.$card !== card) return
         if (!cardSelection.get().includes(card)) {
            selectCard(card, table, false)
         }
      }
   })

   /*
      The background of the stack - the part of it no card covers - is the zone's
      own: right clicking there opens the table's menu, and an empty table opens
      nothing at all, the way the far half's empty table does not.
   */
   function onCtxStack (e) {
      if (!$table.length) {
         e.stopPropagation() // don't open the menu if table is empty
      }
   }

</script>

<Pile pile={table} name="Table" displayCount={false} selectAll={false}>
   <div class="h-full flex justify-center items-center" on:contextmenu={onCtxStack}>
      <div class="relative w-max"
         style="margin-bottom: {($table.length - 1) * 35}px; margin-right: {$table.length > 1 ? 20 : 0}px"
         on:dblclick={() => openPile(table)}>

         {#each $table as card, i (card._id)}
            <!--
               One card of the stack, at the offset it is drawn at: the first is in
               the flow and sizes the stack, and every one after it is laid over the
               one above by a fixed step, so the stack reads as a cascade.

               The wrapper is what carries the click, the selection and the drag,
               and its z-index is its place in the stack (a selected card comes to
               the front, because a ring drawn on a card the next one is painted
               over is a ring nobody can see - see docs/selection.md).
            -->
            <div class="table-card"
               class:stacked={i > 0}
               class:selected={$cardSelection.includes(card)}
               class:dragged={$dragging && $cardSelection.includes(card)}
               style="bottom: -{i * 35}px; left: {i % 2 !== 0 ? 20 : 0}px; z-index: {$cardSelection.includes(card) ? 12 : i + 1}"
               on:click={(e) => onClick(e, card)}
               on:contextmenu={(e) => onCtx(e, card)}
               use:dnd={cardDnd(card)}>

               <img class="card" src="{cardImage(card, 'xs')}" alt={card.name} draggable="false">
            </div>
         {/each}
      </div>
   </div>

   <svelte:fragment slot="menu">
      <ContextMenuOption click={() => openPile(table)} text="View All" shortcut="w" />
   </svelte:fragment>
</Pile>

<style>
   /*
      The stack's geometry: one card in the flow, the rest absolutely placed at the
      offsets written in the markup. The wrapper is not the card's size - an `img`
      carries the board's card width and the wrapper is only as wide as what is in
      it - so nothing here changes how big a card on the table is (see
      docs/card-sizing.md: the table's cards are the one place a card keeps its own
      size rather than the zone's).
   */
   .table-card {
      position: relative;
   }

   .table-card.stacked {
      position: absolute;
   }

   /*
      A selected card glows like a selected card anywhere else on the board (see
      docs/selection.md), drawn as an *outline* rather than as the border a card in
      the hand wears: the wrapper is placed by the offsets above, so a 2px border
      would move the card it is drawn around - and shift the whole cascade with it.
      An outline costs no room.

      The glow is the same short drop-shadow the cards attached under a Pokemon use,
      for the same reason: this card is part of a stack, and the point of the glow
      is to pick it out of the cards around it.
   */
   .table-card.selected {
      outline: 2px solid var(--selection-color);
      outline-offset: -2px;
      filter: drop-shadow(0 0 6px var(--selection-color));
      --shadow-color: transparent;
   }
</style>
