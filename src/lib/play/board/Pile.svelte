<script>
   import ContextMenu from '$lib/components/ContextMenu.svelte'
   import { ctrlA } from '$lib/actions/customEvents.js'
   import { down } from '$lib/icons/paths.js'
   import Icon from '$lib/components/Icon.svelte'

   import { selectPile, moveSelection, resetSelection } from '$lib/stores/player.js'

   export let pile
   export let name = null
   export let displayCount = true
   export let menu = undefined

   /* DnD */

   import { dnd } from '$lib/dnd/actions.js'
   import { source, draggedCard } from '$lib/dnd/store.js'
   import { solo, onOpponentSlot } from '$lib/stores/solo.js'

   /*
      A card of the player's own, or - on the table, which both halves share - one
      of the far half's. A Pokemon in play on the far half is not: moving one of
      those is that half's own business (its piles accept the drop), and dropping
      it here would leave the far half still holding what it carries.
   */
   const allowDrop = () => $source && $source !== pile &&
      !($solo && $source === 'slot' && onOpponentSlot($draggedCard))

   function onDragDrop () {
      moveSelection(pile)
   }

   const dndConfig = {
      drop: onDragDrop,
      allowDrop
   }

   let heading
   function openMenu () {
      const rect = heading.getBoundingClientRect()
      menu.open(rect.left, rect.bottom)
   }

   function onCtx (e) {
      resetSelection()
      menu.open(e.clientX, e.clientY)
   }

</script>

<div class="pile p-1 rounded flex flex-col focus:outline-none relative" tabindex="0"
   on:contextmenu={onCtx}
   use:ctrlA on:ctrlA={() => selectPile(pile)}
   use:dnd={dndConfig}>

   {#if name && displayCount}
      <div class="count" on:click={openMenu} bind:this={heading}>
         {$pile.length}
         <div class="name gap-1 items-center"><span>{name}</span> <Icon path={down} class="text-xs" /></div>
      </div>
   {/if}

   <!--
      A pile is a zone, so what a zone puts in it is centred in the zone: the card
      of a pile that draws one, the row of a hand, the block of prizes. The body
      takes whatever room the pile's own markup leaves - the count badge is on top
      of it rather than beside it - and centres what is in it both ways.
   -->
   <div class="pile-body">
      <slot menu={menu}></slot>
   </div>
</div>

<ContextMenu bind:this={menu} heading={name}>
   <slot name="menu"></slot>
</ContextMenu>

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

   .count {
      background-color: var(--overlay-color);
      @apply absolute z-10 top-1 left-1 font-bold p-1 cursor-pointer rounded-md;
   }

   .name {
      display: none;
   }

   .pile:hover .name {
      display: inline-flex;
   }
</style>