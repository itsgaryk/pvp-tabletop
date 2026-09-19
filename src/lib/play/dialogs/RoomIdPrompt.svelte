<script>
   /*
      The room code, asked for when it is needed rather than held in a box in the
      lobby.

      A code is one short string used once, and a text field sitting in the lobby
      is a field the rest of the lobby has to be arranged around - which is what
      this replaces: joining and spectating are buttons the same size as every
      other button, and the code is asked for by the prompt that actually needs it.

      Centred over the screen, like the room's own dialogs, with OK and Cancel.
      OK is disabled until something is typed, so an empty confirmation cannot
      send the lobby looking for a room called "".

      The code is upper-cased as it is typed: the relay normalizes room ids, so a
      code typed in lower case works either way, but showing it back the way the
      lobby does everywhere else means a mistyped code is visible while it is
      being typed rather than only after the join fails.
   */
   import { tick, createEventDispatcher } from 'svelte'

   const dispatch = createEventDispatcher()

   let open = false
   let code = ''
   let field
   let what = 'join'

   export function ask (kind = 'join') {
      what = kind
      code = ''
      open = true
      /* the field is the only thing here worth focusing, and it is not there yet */
      tick().then(() => field?.focus())
   }

   function confirm () {
      const roomId = code.trim().toUpperCase()
      if (!roomId) return
      open = false
      dispatch('confirmed', { roomId, what })
   }

   function cancel () {
      open = false
      dispatch('cancelled', { what })
   }

   function onKeydown (e) {
      if (e.key === 'Enter') {
         e.preventDefault()
         confirm()
      } else if (e.key === 'Escape') {
         e.preventDefault()
         cancel()
      }
   }
</script>

{#if open}
   <div class="prompt-backdrop" on:click={cancel} role="presentation">
      <!--
         The click that lands on the dialog itself is not a click outside it: the
         backdrop closes, and the panel does not pass its clicks on.
      -->
      <div
         class="prompt-dialog"
         role="dialog"
         aria-modal="true"
         aria-labelledby="room-id-text"
         on:click|stopPropagation
      >
         <p id="room-id-text" class="prompt-title">
            {what === 'spectate' ? 'Which room do you want to watch?' : 'Which room do you want to join?'}
         </p>

         <label class="prompt-field">
            <span>Room ID</span>
            <input
               bind:this={field}
               bind:value={code}
               on:keydown={onKeydown}
               type="text"
               name="roomId"
               placeholder="Room ID"
               maxlength="8"
               autocomplete="off"
               spellcheck="false"
            >
         </label>

         <div class="prompt-buttons">
            <button class="prompt-ok" disabled={!code.trim()} on:click={confirm}>OK</button>
            <button class="prompt-cancel" on:click={cancel}>Cancel</button>
         </div>
      </div>
   </div>
{/if}

<style>
   /* z-index 50: over the lobby, under the room's own dialogs (55 and 60) */
   .prompt-backdrop {
      position: fixed;
      inset: 0;
      z-index: 50;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.55);
   }

   .prompt-dialog {
      @apply flex flex-col items-center gap-4 p-6 rounded-lg text-center;
      min-width: min(20rem, 90vw);
      background: var(--bg-color-two);
      color: var(--text-color);
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
   }

   .prompt-title {
      @apply text-lg font-bold;
   }

   .prompt-field {
      @apply flex flex-col items-center gap-1 w-full;
   }

   .prompt-field span {
      @apply text-sm;
      color: var(--text-color-two);
   }

   .prompt-field input {
      @apply w-full p-2 text-center rounded-lg uppercase;
      border: 1px solid var(--bg-color-three);
      background: var(--input-color);
      color: var(--text-color);
      letter-spacing: 0.15em;
   }

   .prompt-buttons {
      @apply flex gap-2;
   }

   .prompt-ok {
      @apply px-6 py-2 font-bold text-white rounded-lg;
      background: var(--primary-color);
   }

   .prompt-ok:disabled {
      @apply opacity-50;
   }

   .prompt-cancel {
      @apply px-6 py-2 font-bold rounded-lg;
      background: var(--bg-color-zero);
      color: var(--text-color);
   }
</style>
