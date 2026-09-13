<script>
   export let pile
   export let name = null
   export let menu = undefined
</script>

<div class="p-1 rounded flex flex-col focus:outline-none relative" tabindex="0">

   {#if name}
      <div class="count">{$pile.length}</div>
   {/if}

   <slot></slot>
</div>

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