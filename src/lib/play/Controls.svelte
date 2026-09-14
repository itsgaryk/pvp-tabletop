<script>
   import { spectating } from '$lib/stores/connection.js'
   import { spectatorFlipped } from '$lib/stores/opponent.js'
   import { cog, flipBoard } from '$lib/icons/paths.js'
   import Icon from '$lib/components/Icon.svelte'
   import Settings from './dialogs/Settings.svelte'

   /*
      Swap which player a spectator sees on which half of the screen. This is a
      local view change: it only re-points the two mirrors on screen, so neither
      player's own view is affected.
   */
   function flipSides () {
      spectatorFlipped.update((flipped) => !flipped)
   }

   let settings // DOM element binding
</script>

<!-- settings, and for a spectator the board flip, sit in the corner of the window -->
<div class="fixed top-3 right-3 z-20 flex items-center gap-2">
   <button
      class="rounded-md bg-[var(--bg-color-two)] p-1 shadow"
      title="Settings"
      aria-label="Settings"
      on:click|stopPropagation={() => settings.open()}
   >
      <Icon path={cog} />
   </button>

   {#if $spectating}
      <button
         class="rounded-md bg-[var(--bg-color-two)] p-1 shadow"
         title="Flip Board - switch which player is on which half"
         aria-label="Flip Board"
         aria-pressed={$spectatorFlipped}
         on:click|stopPropagation={flipSides}
      >
         <Icon path={flipBoard} />
      </button>
   {/if}
</div>

<Settings bind:this={settings} />
