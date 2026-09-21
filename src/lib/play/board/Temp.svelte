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

      The handlers are on the card's own `img` rather than on a wrapper around it,
      and that is the geometry rather than a style: the offsets below *are* how the
      stack is drawn, and a wrapper around an absolutely positioned card is a
      shrink-to-fit box whose available width the `left` offset cuts into - the
      card's `max-width: 100%` then follows that box down, so a wrapped stack draws
      its cards at two different sizes. A card attached under a Pokemon is written
      the same way, for the same reason (see docs/selection.md).
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
               One card of the stack, drawn where the stack puts it: the first card
               is in the flow and sizes the stack, and every card after it is lifted
               out of the flow and laid over the one above by a fixed step, so the
               stack reads as a cascade.

               The card's own image carries the click, the selection and the drag,
               and its z-index is its place in the stack - a selected card comes to
               the front, because a ring drawn on a card the next one is painted over
               is a ring nobody can see (see docs/selection.md).
            -->
            <img class="card table-card"
               class:stacked={i > 0}
               class:selected={$cardSelection.includes(card)}
               class:dragged={$dragging && $cardSelection.includes(card)}
               src="{cardImage(card, 'xs')}" alt={card.name} draggable="false"
               style="bottom: {-i * 35}px; left: {i % 2 !== 0 ? 20 : 0}px; z-index: {$cardSelection.includes(card) ? 12 : i + 1}"
               on:click={(e) => onClick(e, card)}
               on:contextmenu={(e) => onCtx(e, card)}
               use:dnd={cardDnd(card)}>
         {/each}
      </div>
   </div>

   <svelte:fragment slot="menu">
      <ContextMenuOption click={() => openPile(table)} text="View All" shortcut="w" />
   </svelte:fragment>
</Pile>

<style>
   /*
      The stack's geometry, and all of it: one card in the flow, the rest absolutely
      placed at the offsets written in the markup. The card is the element that is
      placed, with nothing between it and the stack - so a card on the table is the
      size it always was, and the offsets land where they always did (see
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
      A selected card glows like a selected card anywhere else on the board, drawn as
      an `outline` rather than as the border a card in the hand wears: the offsets
      above place the card, so a 2px border would move the card it is drawn around -
      and shift the rest of the cascade with it. An outline costs no room, and the
      glow is the same short drop-shadow the cards attached under a Pokemon use.

      `img.card` in the selector is load-bearing, and is why this rule is not written
      `.table-card.selected`: `Board.svelte` sets a `filter` of its own on `img.card`
      (`.game img.card`, which with each component's scope class is (0,3,1)), so a
      rule carrying three classes loses on specificity and the glow is simply not
      drawn, in silence. `img.card.table-card.selected` is (0,4,1) and wins wherever
      the two stylesheets land - the same trap, and the same answer, as the card's
      size in docs/card-sizing.md.
   */
   img.card.table-card.selected {
      outline: 2px solid var(--selection-color);
      outline-offset: -2px;
      filter: drop-shadow(0 0 6px var(--selection-color));
      --shadow-color: transparent;
   }
</style>
