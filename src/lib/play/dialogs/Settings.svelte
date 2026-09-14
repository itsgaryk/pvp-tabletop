<script>
   import { browser } from '$app/environment'
   import { autoMulligan, scale } from '$lib/stores/settings.js'
   import { powerMarker, setPowerMarker } from '$lib/stores/player.js'
   import { spectating } from '$lib/stores/connection.js'
   import Popup from './Popup.svelte'

   let popup
   export const open = () => popup.open()

   const setScale = (scale) => {
      if (browser) {
         document.documentElement.style.setProperty('--card-scale', scale)
      }
   }

   $: setScale($scale)

   /* the marker shows on the player's own side of the board, and in the log */
   const markers = [
      { value: 'none', label: 'Off' },
      { value: 'vstar', label: 'VStar' },
      { value: 'gx', label: 'GX' }
   ]
</script>

<Popup bind:this={popup}>
   <div class="p-4">
      <div class="p-4 bg-[var(--bg-color-zero)] rounded-t-md">
         <label class="px-1">
            <input type="checkbox" bind:checked={$autoMulligan}>
            Automatically re-shuffle mulligans when starting a new game
         </label>
         <p class="text-sm">
            Disable this option when using cards like Talonflame (STS-96) that break the normal rules of setup.
         </p>
      </div>

      <div class="p-4 bg-[var(--bg-color-zero)]">
         <div class="px-1 font-bold">VSTAR / GX marker</div>
         {#each markers as marker (marker.value)}
            <label class="px-1 block">
               <input
                  type="radio" name="powerMarker" value={marker.value}
                  checked={$powerMarker === marker.value}
                  disabled={$spectating}
                  on:change={() => setPowerMarker(marker.value)}>
               {marker.label}
            </label>
         {/each}
         <p class="text-sm">
            Shows a marker on your side of the board once you have used that power, and writes it to the game log.
         </p>
         {#if $spectating}
            <p class="text-sm italic">A spectator does not show a marker of their own.</p>
         {/if}
      </div>

      <div class="p-4 bg-[var(--bg-color-zero)]">
         <label class="px-1">
            <input type="range" bind:value={$scale} min="0.4" max="1" step="0.05">
            Card Size
         </label>
         <p class="text-sm">
            Scale down the size of card images if the field doesn't fit your screen.
         </p>
      </div>

      <div class="p-4 bg-[var(--bg-color-zero)] rounded-b-md">
         <p class="px-1 text-sm">
            The board is always shown in dark mode.
         </p>
      </div>
   </div>

   <svelte:fragment slot="buttons">
      <button class="action" on:click={() => popup.close()}>Close</button>
   </svelte:fragment>
</Popup>

<style>
   button.action {
      @apply px-3 py-2 rounded-lg font-bold text-white bg-[var(--primary-color)];
   }
</style>