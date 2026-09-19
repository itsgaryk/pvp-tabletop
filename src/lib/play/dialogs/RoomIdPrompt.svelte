<script>
   /*
      The lobby's one prompt: who you are, and (for joining or watching) which
      room.

      It asks for what the action actually needs rather than having the lobby hold
      it in a box. A name is typed once and remembered, so it opens prefilled on
      every visit after the first; a room code is one short string used once, so
      it opens empty every time.

      Centred over the screen, like the room's own dialogs, with OK and Cancel.
      OK is disabled until what it needs has been typed - an empty name would show
      as nobody in chat and on the other half's nameplate, and an empty code would
      send the lobby looking for a room with no name.

      The name field is first, and it is the one that is always there: create,
      join and spectate all need it, and only the last two need a code.
   */
   import { tick, createEventDispatcher } from 'svelte'
   import { playerName } from '$lib/stores/settings.js'

   const dispatch = createEventDispatcher()

   const TITLES = {
      create: 'Create a room',
      join: 'Which room do you want to join?',
      spectate: 'Which room do you want to watch?',
      rejoin: 'Rejoin your room?'
   }

   let open = false
   let kind = 'join'
   let name = ''
   let code = ''
   let nameField
   let codeField

   /*
      What the action is doing, once OK has been pressed. The prompt runs the
      action itself rather than handing the values back and closing, because that
      is where a failure has to be shown: the main menu is the logo and the
      buttons and nothing else, so "could not join QK4M2P" belongs in the dialog
      that asked for the code, on the form that just failed, not behind it.
   */
   let busy = false
   let error = null

   /* set by the caller: performs the action and answers whether it worked */
   export let run = async () => true

   export function ask (what = 'join') {
      kind = TITLES[what] ? what : 'join'
      name = playerName.get() || ''
      code = ''
      error = null
      busy = false
      open = true
      /* the first thing this action needs, whether or not it already has it */
      tick().then(() => (name.trim() ? codeField : nameField)?.focus())
   }

   $: needsCode = kind === 'join' || kind === 'spectate'
   $: ready = Boolean(name.trim()) && (!needsCode || Boolean(code.trim()))

   async function confirm () {
      const who = name.trim().slice(0, 24)
      const roomId = code.trim().toUpperCase()
      if (busy || !who || (needsCode && !roomId)) return

      /* remembered, so the next prompt opens on it - even if the join fails */
      playerName.set(who)

      busy = true
      error = null
      const done = await run({ name: who, roomId, what: kind })
      busy = false

      if (done === true) open = false
      else error = typeof done === 'string' ? done : 'Could not do that. Try again.'
   }

   function cancel () {
      if (busy) return
      open = false
      error = null
      dispatch('cancelled', { what: kind })
   }

   function onKeydown (e) {
      if (e.key === 'Escape') {
         e.preventDefault()
         cancel()
      }
   }
</script>

{#if open}
   <!--
      A click outside closes it, but not while the action is in flight: the
      request is already going and there would be nowhere to report it.
   -->
   <div class="prompt-backdrop" on:click={cancel} role="presentation">
      <!--
         The click that lands on the dialog itself is not a click outside it: the
         backdrop closes, and the panel does not pass its clicks on.
      -->
      <div
         class="prompt-dialog"
         role="dialog"
         aria-modal="true"
         aria-labelledby="prompt-title"
         on:click|stopPropagation
      >
         <p id="prompt-title" class="prompt-title">{TITLES[kind]}</p>

         <form class="prompt-form" on:submit|preventDefault={confirm} on:keydown={onKeydown}>
            <label class="prompt-field">
               <span>Your Name</span>
               <input
                  bind:this={nameField}
                  bind:value={name}
                  type="text"
                  name="playerName"
                  placeholder="Your Name"
                  maxlength="24"
                  autocomplete="off"
                  required
               >
            </label>

            {#if needsCode}
               <label class="prompt-field">
                  <span>Room ID</span>
                  <input
                     bind:this={codeField}
                     bind:value={code}
                     type="text"
                     name="roomId"
                     placeholder="Room ID"
                     maxlength="8"
                     autocomplete="off"
                     spellcheck="false"
                     required
                  >
               </label>
            {/if}

            <div class="prompt-buttons">
               <button type="submit" class="prompt-ok" disabled={!ready || busy}>
                  {busy ? 'Working…' : 'OK'}
               </button>
               <button type="button" class="prompt-cancel" on:click={cancel} disabled={busy}>Cancel</button>
            </div>

            {#if error}
               <p class="prompt-error" role="alert">{error}</p>
            {/if}
         </form>
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

   .prompt-form {
      @apply flex flex-col items-center gap-3 w-full;
   }

   .prompt-field {
      @apply flex flex-col items-center gap-1 w-full;
   }

   .prompt-field span {
      @apply text-sm;
      color: var(--text-color-two);
   }

   .prompt-field input {
      @apply w-full p-2 text-center rounded-lg;
      border: 1px solid var(--bg-color-three);
      background: var(--input-color);
      color: var(--text-color);
   }

   /* a room code reads as a code: spaced out and upper case */
   .prompt-field input[name="roomId"] {
      @apply uppercase;
      letter-spacing: 0.15em;
   }

   .prompt-buttons {
      @apply flex gap-2 mt-1;
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

   .prompt-cancel:disabled {
      @apply opacity-50;
   }

   /*
      What went wrong, on the form that just failed. The relay's own message is
      included where there is one - "could not join QK4M2P (room QK4M2P is full
      - only spectating is available)" is the sentence worth reading.
   */
   .prompt-error {
      @apply text-sm px-1;
      color: #f87171;
   }
</style>
