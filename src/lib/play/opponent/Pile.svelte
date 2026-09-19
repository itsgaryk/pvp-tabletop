<script>
   import ContextMenu from '$lib/components/ContextMenu.svelte'
   import { ctrlA } from '$lib/actions/customEvents.js'
   import { dnd } from '$lib/dnd/actions.js'
   import { source, draggedCard } from '$lib/dnd/store.js'
   import { cardSelection, resetSelection, selectPile } from '$lib/stores/player.js'
   import { defaultOpponent } from '$lib/stores/opponent.js'
   import {
      solo, soloMoveCard, soloCardToPlay,
      soloSlotToDiscard, soloSlotToPile,
      onOpponentHalf, onOpponentSlot
   } from '$lib/stores/solo.js'

   export let pile
   export let name = null
   /*
      The number belongs to the piles that are counted. The table is not one of
      them - it is where cards are played rather than a pile anybody counts - and
      it asks for no number (see Temp.svelte). It always did: the prop was named by
      the caller and never declared here, and a prop that is not declared is a prop
      that is dropped, so the count was drawn on the table of every board (a
      player's, a spectator's and solo's far half). Same prop and same default as
      the player's own piles, so the two halves cannot disagree about it.
   */
   export let displayCount = true
   /*
      A menu is only wired where a caller asks for one - in solo, where the other
      half is yours too. Online, an opponent's pile stays unclickable.
   */
   export let showMenu = false
   export let menu = undefined

   let heading

   function openMenu () {
      if (!showMenu || !menu) return
      const rect = heading.getBoundingClientRect()
      menu.open(rect.left, rect.bottom)
   }

   /*
      Right clicking the pile itself does what it does on your own half: the
      selection goes first, then the pile's own menu. Online there is no menu to
      open, so this is left to the half's owner.
   */
   function onCtx (e) {
      if (!showMenu || !menu) return
      resetSelection()
      menu.open(e.clientX, e.clientY)
   }

   /*
      Dropping onto a pile of the far half. In solo that half is yours, so a card
      dragged from it lands here; a card dragged from your own board is handed
      over the same way the other piles accept it.
   */
   /* only the far half's own cards land here: nothing crosses between halves */
   const allowDrop = () => $solo && $source && $source !== pile && (
      onOpponentHalf($source) ||
      ($source === 'slot' && onOpponentSlot($draggedCard))
   )

   function onDrop () {
      if (!$solo || !$source) return

      /* a Pokemon in play dropped on a pile goes there with everything under it */
      if ($source === 'slot') {
         const s = $draggedCard
         if (onOpponentSlot(s)) {
            if (pile === defaultOpponent.discard) soloSlotToDiscard(s)
            else soloSlotToPile(s, pile, name || 'pile')
         }
         resetSelection()
         return
      }

      const cards = [ ...$cardSelection ]
      if (!cards.length) return

      if (!onOpponentHalf($source)) return

      for (const card of cards) {
         if (pile === defaultOpponent.bench) soloCardToPlay($source, card, 'bench')
         else if (pile === defaultOpponent.discard) soloMoveCard($source, card, pile, 'Discarded')
         else soloMoveCard($source, card, pile)
      }

      cardSelection.clear()
   }

   const dndConfig = { drop: onDrop, allowDrop }
</script>

<div class="p-1 rounded flex flex-col focus:outline-none relative" tabindex="0"
   on:contextmenu={onCtx}
   use:ctrlA on:ctrlA={() => { if (showMenu) selectPile(pile) }}
   use:dnd={dndConfig}>

   {#if name && displayCount}
      <div class="count" on:click={openMenu} bind:this={heading}>
         {$pile.length}
      </div>
   {/if}

   <!--
      The same shape as the near half's: a zone centres what it holds, so the body
      takes whatever room the pile's own markup leaves and centres it both ways.
      The count badge is a layer over it, not a box beside it.
   -->
   <div class="pile-body">
      <slot></slot>
   </div>
</div>

{#if showMenu}
   <ContextMenu bind:this={menu} heading={name}>
      <slot name="menu"></slot>
   </ContextMenu>
{/if}

<style>
   .pile-body {
      flex: 1 1 auto;
      min-width: 0;
      min-height: 0;
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
   }

   /*
      The count is rotated back by whoever flips this half (see .flip in
      Board.svelte), so it reads upright whether this pile is shown on a player's
      rotated top half or on a spectator's board, which is never rotated.
   */
   .count {
      background-color: var(--overlay-color);
      @apply absolute z-10 top-1 left-1 font-bold p-1 rounded-md;
   }
</style>
