<script>
   /*
      The room's code, and the button that copies it.

      It is a component of its own because it is drawn in three places, and the last two are the
      reason it exists at all: the panel beside the board, the **Import Deck window**
      (`z-index: 45`), and the **opening dialog** (`46`).

      Both of those cover the window - each is `position: fixed; inset: 0` - so while the game is
      being set up the code in the panel is behind a backdrop and cannot be reached, reported from
      play as *"during game setup the game room code cannot be copied"*. That is the one moment a
      player most needs it: the other player has not arrived yet, or has, and the code is the thing
      that gets them to the same table.

      **Outside a room it draws nothing**, which is what makes it safe to drop into a window that
      solo opens for itself as well (see `routes/DeckInput.svelte`).
   */
   import { room } from '$lib/stores/connection.js'
   import Icon from '$lib/components/Icon.svelte'
   import { check, copy } from '$lib/icons/paths.js'

   /*
      A word in front of the code, for the two dialogs. The panel does not want one - it is the
      header of a room, and a bare code there is unambiguous - while a code alone in the middle of
      the Import Deck window says nothing about what it is.
   */
   export let label = ''

   /* the copy button shows a tick for a moment after a copy, the way the lobby's prompt does */
   let copied = false
   let copiedTimer = null

   function copyRoomCode () {
      navigator.clipboard.writeText($room).then(() => {
         copied = true
         clearTimeout(copiedTimer)
         copiedTimer = setTimeout(() => { copied = false }, 2000)
      })
   }
</script>

{#if $room}
   <div class="room-code">
      {#if label}
         <span class="room-code-label">{label}</span>
      {/if}
      <span class="room-code-value">{$room}</span>
      <button
         class="room-code-copy"
         title={copied ? 'Copied' : 'Copy room code'}
         aria-label="Copy room code"
         on:click={copyRoomCode}
      >
         <Icon path={copied ? check : copy} class="text-[8px]" />
      </button>
   </div>
{/if}

<style>
   .room-code {
      @apply flex items-center justify-center gap-1 text-sm text-[var(--text-color-two)];
   }

   /*
      The hover is a rule of its own rather than `hover:` inside the `@apply`, and that is not a
      style choice: a variant written that way compiles under Vite - the Windi preprocessor rewrites
      the `@apply` before Svelte ever parses the block - and **fails the raw compile
      `tools/render-check.mjs` does**, with `Semicolon or block is expected` and no file named. So
      `npm run build` is green while the CI job that renders is red.
   */
   .room-code-copy {
      @apply rounded p-0.5;
   }

   .room-code-copy:hover {
      background: var(--bg-color-two);
   }
</style>
