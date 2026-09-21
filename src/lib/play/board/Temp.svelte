<script>
   import { getContext } from 'svelte'
   import { cardImage } from '$lib/util/assets.js'
   import { holdingCtrlOrCmd } from '$lib/util/ctrlcmd.js'
   import Pile from './Pile.svelte'
   import Vertical from '$lib/components/scroll/Vertical.svelte'
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
   <Vertical>
      <div class="table-zone" on:contextmenu={onCtxStack}>
         <div class="table-stack relative w-max"
            style="margin-bottom: calc({$table.length - 1} * var(--table-step)); margin-right: {$table.length > 1 ? 'var(--table-offset)' : '0px'}"
            on:dblclick={() => openPile(table)}>

            {#each $table as card, i (card._id)}
               <!--
                  One card of the stack, drawn where the stack puts it: the first card
                  is in the flow and sizes the stack, and every card after it is lifted
                  out of the flow and laid over the one above by a step that is a share
                  of the card, so the stack reads as a cascade at any card size.

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
                  style="bottom: calc({-i} * var(--table-step)); left: {i % 2 !== 0 ? 'var(--table-offset)' : '0px'}; z-index: {$cardSelection.includes(card) ? 12 : i + 1}"
                  on:click={(e) => onClick(e, card)}
                  on:contextmenu={(e) => onCtx(e, card)}
                  use:dnd={cardDnd(card)}>
            {/each}
         </div>
      </div>
   </Vertical>

   <svelte:fragment slot="menu">
      <ContextMenuOption click={() => openPile(table)} text="View All" shortcut="w" />
   </svelte:fragment>
</Pile>

<style>
   /*
      The zone the cascade is drawn in: as tall as the table's cell, and scrolled by
      `Vertical` when the stack is taller than that, so a stack of thirteen - 565px in a
      cell of about 285 at 1277x821 - is read by scrolling it rather than by watching it
      cross the border and the rows around the zone, which is what it used to do.

      `safe center` is the centring that can be scrolled: the stack is centred while it
      fits, which is how the table has always been drawn, and starts at the top of the
      zone when it does not. Plain centring overflows *both* ways in a scroll container,
      and the half of it above the start edge is then unreachable - no wheel, no bar, no
      drag gets a player to the first card of a thirteen-card stack.

      `min-height: 100%` is what gives the stack the zone's height to be centred in when
      it is short: this box is the scrollable content, so it is exactly as tall as what is
      in it unless something says otherwise.
   */
   .table-zone {
      min-height: 100%;
      width: 100%;
      display: flex;
      justify-content: safe center;
      align-items: safe center;
   }

   /*
      And the stack keeps its own width in that line. A flex item is shrinkable by default,
      and a stack the zone has squeezed takes its cards down with it - they wear the reset's
      `max-width: 100%`, so a narrower stack is narrower cards, and a card on the table is
      read by looking at it at the size it has always been (see docs/card-sizing.md). The
      cascade *is* a little wider than the zone at a small window - every second card steps
      20px to the right of the stack - and the zone clips that rather than resizing the
      cards, which is what a zone does with what will not fit (see Vertical.svelte).
   */
   .table-stack {
      flex: none;
   }

   /*
      The card is the zone's *width*, and nothing else sizes it: the stack is as tall as it
      is and the zone scrolls it rather than fitting it both ways (see `--table-card-width`
      in global.css, and Vertical.svelte for the zone that does the scrolling). `img.card`
      in the selector is what makes this rule win over the board's own `img.card` - see the
      note over the selected card below, which is the same trap.
   */
   img.card.table-card {
      width: var(--table-card-width);
   }

   /*
      The stack's geometry, and all of it: one card in the flow, the rest absolutely
      placed at the offsets written in the markup, each a share of the card. The card is
      the element that is placed, with nothing between it and the stack - so the offsets
      land where they always did, at whatever size the zone gives the cards (see
      docs/card-sizing.md).

      The `margin-bottom` the markup writes is what tells the zone how far the cascade
      reaches below its first card: the cards below it are out of the flow, so without it
      the stack would be one card tall and a scroll bar would have nothing to scroll. How
      far the cascade reaches is a share of the card too - `(n - 1)` of `--table-step` -
      so the stack a zone scrolls is the same stack at any card size.
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
