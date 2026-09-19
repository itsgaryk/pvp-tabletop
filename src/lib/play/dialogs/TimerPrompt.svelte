<script>
   /*
      Setting the table's clock.

      The clock has one value and one owner per change - whoever sets it tells
      everybody - so this is a normal board action: the time is applied and
      shared, not held here. What it replaces is the row of adjustment buttons
      that used to sit either side of the clock: six buttons that could only walk
      the time towards what you wanted, one press at a time.

      The two fields are minutes and seconds, each capped at 60 because that is
      all a minutes-and-seconds field can hold. The cap is applied as you type
      rather than on confirmation, so the number on screen is always the number
      that will be set.

      Centred over the board, like the room's own dialogs, with OK and Cancel.
      Opening it does not start or stop the clock: setting a time is not the same
      as running it, and the clock's running state is carried through untouched.
   */
   import { tick, createEventDispatcher } from 'svelte'
   import { timer, setTimer } from '$lib/stores/player.js'
   import { remainingAt } from '$lib/stores/timer.js'

   const dispatch = createEventDispatcher()

   /* a fresh room's clock, which is what a field opens on when there is no time set */
   const DEFAULT_MINUTES = 50

   let open = false
   let minutes = DEFAULT_MINUTES
   let seconds = 0
   let minuteField

   /*
      What the clock reads now, in whole seconds: rounded up, so 10:00.4 is not
      shown as 10:00. The reading comes from the timer store, so a running clock
      is aged the same way here as it is on the clock itself.
   */
   function currentSeconds () {
      return Math.ceil(remainingAt(timer.get()) / 1000)
   }

   export function ask () {
      const left = currentSeconds()
      /* a clock that has run out opens on the default: nothing to carry over */
      const from = left > 0 ? left : DEFAULT_MINUTES * 60

      minutes = Math.min(60, Math.floor(from / 60))
      seconds = Math.min(60, Math.floor(from % 60))
      open = true
      tick().then(() => minuteField?.select())
   }

   /* a minutes-or-seconds field: digits only, and never more than 60 */
   function clamp (value) {
      const digits = String(value ?? '').replace(/\D/g, '').slice(0, 2)
      if (digits === '') return 0
      return Math.min(60, Number(digits))
   }

   function confirm () {
      const total = (clamp(minutes) * 60 + clamp(seconds)) * 1000
      open = false

      /*
         The running state is carried through: a paused clock stays paused, and
         one that has run out stays stopped until it is started again. The value
         is given to `setTimer` in the browser's own reading, and that is what
         publishes it on the relay's.
      */
      const running = timer.get().running && total > 0
      setTimer({ running, remaining: total })
      dispatch('set', { remaining: total })
   }

   function cancel () {
      open = false
      dispatch('cancelled')
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
   <div class="timer-backdrop" on:click={cancel} role="presentation">
      <div
         class="timer-dialog"
         role="dialog"
         aria-modal="true"
         aria-labelledby="timer-text"
         on:click|stopPropagation
      >
         <p id="timer-text" class="timer-title">Set the timer</p>

         <div class="timer-fields">
            <label>
               <input
                  bind:this={minuteField}
                  bind:value={minutes}
                  on:keydown={onKeydown}
                  on:input={() => (minutes = clamp(minutes))}
                  type="text"
                  inputmode="numeric"
                  name="timerMinutes"
                  maxlength="2"
                  autocomplete="off"
               >
               <span>minutes</span>
            </label>

            <span class="timer-colon">:</span>

            <label>
               <input
                  bind:value={seconds}
                  on:keydown={onKeydown}
                  on:input={() => (seconds = clamp(seconds))}
                  type="text"
                  inputmode="numeric"
                  name="timerSeconds"
                  maxlength="2"
                  autocomplete="off"
               >
               <span>seconds</span>
            </label>
         </div>

         <p class="timer-hint">Each field takes up to 60.</p>

         <div class="timer-buttons">
            <button class="timer-ok" on:click={confirm}>OK</button>
            <button class="timer-cancel" on:click={cancel}>Cancel</button>
         </div>
      </div>
   </div>
{/if}

<style>
   /* z-index 52: over the board, under the idle prompt (55) and a closed room (60) */
   .timer-backdrop {
      position: fixed;
      inset: 0;
      z-index: 52;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.55);
   }

   .timer-dialog {
      @apply flex flex-col items-center gap-3 p-6 rounded-lg text-center;
      min-width: min(20rem, 90vw);
      background: var(--bg-color-two);
      color: var(--text-color);
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
   }

   .timer-title {
      @apply text-lg font-bold;
   }

   .timer-fields {
      @apply flex items-end gap-2;
   }

   .timer-fields label {
      @apply flex flex-col items-center gap-1;
   }

   .timer-fields input {
      @apply w-20 p-2 text-center text-2xl font-bold rounded-lg tabular-nums;
      border: 1px solid var(--bg-color-three);
      background: var(--input-color);
      color: var(--text-color);
   }

   .timer-fields span {
      @apply text-xs;
      color: var(--text-color-two);
   }

   .timer-colon {
      @apply text-2xl font-bold pb-6;
   }

   .timer-hint {
      @apply text-xs;
      color: var(--text-color-two);
   }

   .timer-buttons {
      @apply flex gap-2;
   }

   .timer-ok {
      @apply px-6 py-2 font-bold text-white rounded-lg;
      background: var(--primary-color);
   }

   .timer-cancel {
      @apply px-6 py-2 font-bold rounded-lg;
      background: var(--bg-color-zero);
      color: var(--text-color);
   }
</style>
