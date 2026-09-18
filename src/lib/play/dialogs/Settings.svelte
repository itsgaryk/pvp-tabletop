<script>
   import { browser } from '$app/environment'
   import { autoMulligan, scale, zoneBorders } from '$lib/stores/settings.js'
   import { powerMarker, setPowerMarker } from '$lib/stores/player.js'
   import { spectating } from '$lib/stores/connection.js'
   import Popup from './Popup.svelte'
   import Diagnostics from './Diagnostics.svelte'

   let popup
   export const open = () => popup.open()
   export const close = () => popup.close()

   /*
      Opening the dialog closes this menu: a Popup closes every other Popup when it
      opens, so the settings menu gets out of the way by itself.
   */
   let diagnostics

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

   /* the button in the corner toggles this menu, so it has to ask whether it is open */
   export function opened () {
      return popup.opened()
   }
</script>

<!--
   controls asks the popup whether it is open, so the button can close it.

   There is no Close button in here: the cog toggles the menu, Escape closes it,
   and a click anywhere outside it closes it too, so a button for it was one way
   too many to do the same thing.
-->
<Popup bind:this={popup} anchored>
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

      <div class="p-4 bg-[var(--bg-color-zero)]">
         <label class="px-1">
            <input type="checkbox" bind:checked={$zoneBorders}>
            Show borders around the board zones
         </label>
         <p class="text-sm">
            Outlines each area of the board - hand, deck, discard, lost zone, prizes, bench, active, stadium and play - for both players.
         </p>
      </div>

      <div class="p-4 bg-[var(--bg-color-zero)]">
         <p class="px-1 text-sm">
            The board is always shown in dark mode.
         </p>
      </div>

      <!--
         Last on purpose. This is a diagnostic rather than a setting, so it does
         not belong among the things you change while playing, but it should be
         findable the moment something looks wrong.

         It opens a dialog rather than navigating: going to another page reloads
         the app and rebuilds the board, which is exactly the thing you are trying
         to look at while it is still wrong.
      -->
      <div class="p-4 bg-[var(--bg-color-zero)] rounded-b-md">
         <button class="diagnostics-link" on:click|stopPropagation={() => diagnostics.open()}>
            Diagnostics
         </button>
         <p class="text-sm">
            Relay health, the current room, the seat order and the events this browser has received -
            for telling a broken board apart from a broken client.
         </p>
      </div>
   </div>
</Popup>

<Diagnostics bind:this={diagnostics} />

<style>
   /*
      A button, not a link: it opens a panel over the board instead of going to
      another page. Styled to still read as the link it looks like.
   */
   .diagnostics-link {
      @apply px-1 underline;
   }
</style>
