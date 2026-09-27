<script>
   import { zoneBorders } from '$lib/stores/settings.js'
   import { powerMarker, setPowerMarker } from '$lib/stores/player.js'
   import { solo } from '$lib/stores/solo.js'
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

   /*
      The marker shows on the player's own side of the board, and in the log.

      It is solo's setting alone. In a room the format decides it, and does so for
      both players and every watcher at once - a room made as Expanded puts both
      marks on both halves, and Standard and Gym Leader Challenge put neither on
      either, because neither has a Power zone to put them in (see
      $lib/util/format.js). So there is nothing here to choose: a control that
      could only disagree with the room is not a setting.
   */
   const markers = [
      { value: 'none', label: 'Off' },
      { value: 'vstar', label: 'VStar' },
      { value: 'gx', label: 'GX' },
      { value: 'both', label: 'Both' }
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
   <!--
      One block per setting, each with the same shape: a heading, then the
      control. Every block carries a heading of its own - a checkbox with no title
      above it reads as a stray line rather than a setting - and the first and
      last are rounded to close the panel. Which blocks there are can differ
      between solo and a room, so the rounding is on the ones that come first and
      last in both rather than on a count: `first` is on the marker in solo and on
      the zones in a room, the two blocks that can open the panel.

      The one line explaining what a setting does is only there where the control
      does not already say it. A checkbox that reads "Show borders around the
      board zones" does not need a paragraph naming the zones as well.

      The Mulligans block is gone: auto-mulligan is off and stays off unless
      somebody reaches into localStorage, so the panel is the settings a player
      can actually change. The setting, its default and the loop that reads it are
      kept - see src/lib/stores/settings.js and docs/mechanics.md#mulligans - and
      with it gone the first block is the marker in solo and the board zones in a
      room, which is why both carry `first`.
   -->
   <div class="p-4">
      <!-- solo's own marker setting; a room's format is what decides it there -->
      {#if $solo}
         <div class="setting first">
            <div class="title">VSTAR / GX marker</div>
            {#each markers as marker (marker.value)}
               <label class="px-1 block">
                  <input
                     type="radio" name="powerMarker" value={marker.value}
                     checked={$powerMarker === marker.value}
                     on:change={() => setPowerMarker(marker.value)}>
                  {marker.label}
               </label>
            {/each}
         </div>
      {/if}

      <div class="setting first">
         <div class="title">Board zones</div>
         <label class="px-1">
            <input type="checkbox" bind:checked={$zoneBorders}>
            Show borders around the board zones
         </label>
      </div>

      <!--
         Last on purpose. This is a diagnostic rather than a setting, so it does
         not belong among the things you change while playing, but it should be
         findable the moment something looks wrong.

         It opens a dialog rather than navigating: going to another page reloads
         the app and rebuilds the board, which is exactly the thing you are trying
         to look at while it is still wrong.
      -->
      <div class="setting last">
         <div class="title">Diagnostics</div>
         <button class="diagnostics-link" on:click|stopPropagation={() => diagnostics.open()}>
            Open the diagnostics panel
         </button>
      </div>
   </div>
</Popup>

<Diagnostics bind:this={diagnostics} />

<style>
   /*
      The panel's blocks, which used to be written out at each one. The spacing,
      the background and the rounding are the same for all of them, so a setting
      cannot end up looking unlike its neighbours.
   */
   .setting {
      @apply p-4 bg-[var(--bg-color-zero)];
   }

   .setting.first {
      @apply rounded-t-md;
   }

   .setting.last {
      @apply rounded-b-md;
   }

   /* the heading every setting has, in the one style */
   .setting .title {
      @apply px-1 font-bold;
   }

   /*
      A button, not a link: it opens a panel over the board instead of going to
      another page. Styled to still read as the link it looks like.
   */
   .diagnostics-link {
      @apply px-1 underline;
   }
</style>
