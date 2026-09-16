<script>
   import ContextMenu from '$lib/components/ContextMenu.svelte'
   import { dnd } from '$lib/dnd/actions.js'
   import { source } from '$lib/dnd/store.js'
   import { cardSelection, moveSelection } from '$lib/stores/player.js'
   import { defaultOpponent } from '$lib/stores/opponent.js'
   import { solo, soloMoveCard, soloCardToPlay } from '$lib/stores/solo.js'

   export let pile
   export let name = null
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

   function onCtx (e) {
      if (!showMenu || !menu) return
      menu.open(e.clientX, e.clientY)
   }

   /*
      Dropping onto a pile of the far half. In solo that half is yours, so a card
      dragged from it lands here; a card dragged from your own board is handed
      over the same way the other piles accept it.
   */
   const allowDrop = () => $solo && $source && $source !== pile

   function onDrop () {
      if (!$solo || !$source) return

      const cards = [ ...$cardSelection ]
      if (!cards.length) return

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
   use:dnd={dndConfig}>

   {#if name}
      <div class="count" on:click={openMenu} bind:this={heading}>
         {$pile.length}
      </div>
   {/if}

   <slot></slot>
</div>

{#if showMenu}
   <ContextMenu bind:this={menu} heading={name}>
      <slot name="menu"></slot>
   </ContextMenu>
{/if}

<style>
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
