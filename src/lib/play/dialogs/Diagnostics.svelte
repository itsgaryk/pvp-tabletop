<script>
   /*
      The diagnostics panel as a dialog over the board.

      It is a dialog rather than a page on purpose: diagnostics are wanted while a
      game looks wrong, and navigating to another URL reloads the app (the room is
      restored from localStorage, but the board is rebuilt). Opening a panel over
      the top leaves the game exactly as it was, so what you are diagnosing is
      still on screen behind it.

      The panel itself is shared with the standalone /diagnostics page, so the two
      cannot drift apart.
   */
   import Popup from './Popup.svelte'
   import Panel from '$lib/diagnostics/Diagnostics.svelte'

   let popup

   export const open = () => popup.open()
   export const close = () => popup.close()
   export function opened () {
      return popup.opened()
   }
</script>

<Popup bind:this={popup} centered>
   <div class="flex flex-col w-[min(1040px,calc(100vw-3rem))] max-h-[85vh]">
      <header class="flex items-center gap-2 p-3 pb-2">
         <h2 class="font-bold">Diagnostics</h2>
         <span class="text-xs text-[var(--text-color-two)]">this browser, live</span>
         <span class="flex-1"></span>

         <!--
            The way out, in the corner a dialog's close button belongs in. Escape
            and a click outside also close it, but neither is visible, and a panel
            this tall needs one that is.
         -->
         <button
            class="close"
            title="Close"
            aria-label="Close diagnostics"
            on:click={() => popup.close()}
         >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" aria-hidden="true">
               <path d="M6 6l12 12M18 6L6 18" />
            </svg>
         </button>
      </header>

      <!--
         `min-h-0` is what lets this shrink: a flex child defaults to
         `min-height: auto`, so without it a tall panel would push the dialog past
         the bottom of the window instead of scrolling inside it.
      -->
      <div class="px-3 pb-3 overflow-y-auto min-h-0 flex-1">
         <Panel />
      </div>
   </div>
</Popup>

<style>
   .close {
      @apply p-1 rounded-md shrink-0 text-[var(--text-color-two)];
   }

   .close:hover {
      @apply bg-[var(--bg-color-two)] text-[var(--text-color)];
   }

   .close svg {
      width: 1.15rem;
      height: 1.15rem;
      display: block;
   }
</style>
