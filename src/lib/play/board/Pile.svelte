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
   import { solo, onOpponentSlot, onOpponentHalf } from '$lib/stores/solo.js'

   /*
      Only a card of this player's own lands in one of this player's piles.

      In a room that is not a question: the far half belongs to somebody else and
      nothing of theirs is draggable here. In solo both halves are played by the
      same person, and every one of the far half's zones is draggable - so without
      this a card dragged out of the opponent's hand went into the player's own
      hand, discard, deck or prizes, which is a card crossing the table.

      A Pokemon in play on the far half is refused too, and by a different check:
      moving one of those is that half's own business, and dropping it here would
      leave the far half still holding what it carries.

      The two shared zones are the exception, and they are not this pile's: the
      table and the stadium each accept their own half's cards, so a card played
      into a shared cell lands on the half that played it (see opponent/Pile.svelte
      and the two Stadiums).
   */
   const allowDrop = () => $source && $source !== pile &&
      !($solo && (onOpponentHalf($source) || ($source === 'slot' && onOpponentSlot($draggedCard))))

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