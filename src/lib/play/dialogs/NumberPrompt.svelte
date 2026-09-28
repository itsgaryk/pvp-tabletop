<script>
   /*
      A dialog of our own, rather than the browser's own `prompt()`.

      Two things the platform dialog cannot do, and both of them are why this exists:

      1. **It carries Chrome's "Prevent this page from creating additional dialogs"
         checkbox.** Once a player ticks that, every later `window.prompt` in the
         session answers `null` without showing anything - so every count on the board
         silently does nothing, with nothing on screen to say why. That is the worst
         kind of fault this app has: a gesture that looks accepted and does nothing.
      2. **It cannot be typed into strictly.** The browser's input is free text, so
         `parseInt` is left to clean up whatever was typed - and `parseInt('12abc')`
         is 12, which reads as though the player had asked for 12 cards.

      So the input here **accepts digits and nothing else**, on the way in: a character
      that is not a digit never reaches the box, whether it was typed or pasted. Both
      ways in are refused - `keydown` for the keyboard and `paste` for the clipboard -
      because refusing one leaves the other open, and a paste of "4 cards" would sail
      through.

      This is deliberately **not** `<input type="number">`. That type accepts `e`, `+`,
      `-` and `.`, because it is a *floating point* input: a count would take `-5` and
      a damage field would take `1e9`. `inputmode="numeric"` asks a phone for the digit
      keypad without handing the desktop a number field.

      It is asked by `util/asks.js`, which is where the questions and their bounds
      live. The two are wired together by registration rather than by import, and the
      page does it: `NumberPrompt.svelte` imports nothing from the table, and the table
      imports nothing at all - which is what keeps a table of data testable in node,
      with no component and no browser.
   */
   import { tick } from 'svelte'
   import { registerNumberDialog } from '$lib/util/asks.js'

   let row = null
   let text = ''
   let field

   /*
      The question, put to the player. `ask` is what the table calls, and it answers a
      number or `null` for "nothing was asked" - a blank box never becomes a value,
      because OK stays disabled until the box holds one inside the row's range.
   */
   export function ask (question) {
      return new Promise((resolve) => {
         row = question
         answer = resolve

         /*
            Opened on an empty box, as the platform dialog was, and focused so the first
            digit can be typed without reaching for the mouse. `tick` because the input
            does not exist until this render has happened.
         */
         text = ''
         tick().then(() => field?.focus())
      })
   }

   let answer = null

   function settle (value) {
      const resolve = answer
      answer = null
      row = null
      /*
         The box is emptied **before** the dialog is taken down, and that is not
         tidiness. `row` going null re-runs the `$:` statements that read it, and the
         readiness one reads `row.min` - so a box left holding its text is evaluated
         against no row at all, which threw inside Svelte's own update and took the
         confirm with it: the answer never reached the caller. Measured, and it is why
         the reset is here rather than in `ask`.
      */
      text = ''
      if (resolve) resolve(value)
   }

   function confirm () {
      if (ready) settle(number)
   }

   function cancel () {
      settle(null)
   }

   /*
      The readiness is worked out **inline and from `text` directly**, and that is
      load-bearing rather than style.

      It was `parsed() !== null && !tooFew() && !tooMany()` to begin with, with those
      three as functions reading `text` in their own bodies - and Svelte compiles a
      `$:` statement as depending on the variables *it* reads, not on what the functions
      it calls read. So nothing told the compiler that `ready` had anything to do with
      `text`: the box filled, `text` changed, and OK stayed disabled, with the whole
      dialog looking perfectly healthy. Measured in a browser - the value was `'4'`, the
      bounds were `1..60`, and `ready` was `false`.

      So `text` is read here, and `parsed()` exists only for what a function is good for:
      being called from an event handler, where nothing is being tracked.
   */
   $: number = text === '' ? null : Number(text)
   $: ready = row !== null && number !== null && number >= row.min && number <= row.max

   /*
      The range, said out loud when it is worth saying. The ceiling is the deck the
      gesture is about, and for *their* deck nobody can count it off the board - so the
      hint is what stops "reveal 7 of a 3-card deck" from being a guess. A caller that
      does not know the ceiling says the floor alone.
   */
   $: hint = row === null ? '' : row.maxHint && Number.isFinite(row.max)
      ? `Enter a number from ${row.min} to ${row.max}.`
      : `Enter a number of ${row.min} or more.`

   function onKeydown (e) {
      if (e.key === 'Escape') {
         e.preventDefault()
         cancel()
         return
      }

      if (e.key === 'Enter') {
         e.preventDefault()
         /* Enter with nothing acceptable does nothing, rather than closing on null */
         if (ready) confirm()
         return
      }

      /*
         Refused here rather than corrected afterwards. The named control keys are let
         through because the box has to stay editable; anything else that is a single
         character, and is not a digit, is a character this field does not hold.
      */
      const control = [ 'Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Tab' ]
      if (control.includes(e.key)) return

      if (!e.ctrlKey && !e.metaKey && e.key.length === 1 && !/^\d$/.test(e.key)) {
         e.preventDefault()
      }
   }

   /*
      A paste is the other way in, and it is handled rather than refused: pasting "12"
      puts 12 in, pasting "4 cards" puts 4 in, and pasting "abc" leaves the box alone.
      The default is always prevented, because letting it through would put whatever was
      on the clipboard into a field that holds only digits.
   */
   function onPaste (e) {
      e.preventDefault()

      const added = (e.clipboardData?.getData('text') || '').replace(/\D/g, '')
      if (!added) return

      const el = e.target
      const start = el.selectionStart ?? text.length
      const end = el.selectionEnd ?? text.length
      text = text.slice(0, start) + added + text.slice(end)

      /* the caret goes after what was put in, which is where a paste should leave it */
      tick().then(() => {
         const at = start + added.length
         el.setSelectionRange(at, at)
      })
   }

   registerNumberDialog({ ask })
</script>

{#if row}
   <!--
      The same shape as the lobby's prompt and the clock's: a backdrop over everything,
      and a centred panel. Nothing else on the board is reachable while it is up, which
      is also what keeps the selection a slot action is about from changing under the
      answer.
   -->
   <div class="number-backdrop" on:click={cancel} role="presentation">
      <div
         class="number-dialog"
         role="dialog"
         aria-modal="true"
         aria-labelledby="number-prompt-question"
         on:click|stopPropagation
      >
         <p id="number-prompt-question" class="question">{row.question}</p>

         <form class="form" on:submit|preventDefault={confirm}>
            <input
               bind:this={field}
               bind:value={text}
               type="text"
               name="number"
               inputmode="numeric"
               autocomplete="off"
               spellcheck="false"
               maxlength="6"
               aria-describedby="number-prompt-hint"
               on:keydown={onKeydown}
               on:paste={onPaste}
            >

            <p id="number-prompt-hint" class="hint">{hint}</p>

            <div class="buttons">
               <button type="submit" class="ok" disabled={!ready}>OK</button>
               <button type="button" class="cancel" on:click={cancel}>Cancel</button>
            </div>
         </form>
      </div>
   </div>
{/if}

<style>
   /*
      z-index 54: over every panel the board raises (20-40) and the lobby's prompt (50),
      and over the clock's (52), but under the idle prompt (55) and a closed room (60).
      A count is below the two dialogs that are about the room rather than about a card.
   */
   .number-backdrop {
      position: fixed;
      inset: 0;
      z-index: 54;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.55);
   }

   .number-dialog {
      @apply flex flex-col items-center gap-3 p-6 rounded-lg text-center;
      min-width: min(20rem, 90vw);
      background: var(--bg-color-two);
      color: var(--text-color);
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
   }

   .question {
      @apply text-lg font-bold;
   }

   .form {
      @apply flex flex-col items-center gap-2 w-full;
   }

   input {
      @apply w-full p-2 text-center text-lg font-bold rounded-lg;
      border: 1px solid var(--bg-color-three);
      background: var(--input-color);
      color: var(--text-color);
      /* a count reads as a number, so its digits are not proportional */
      font-variant-numeric: tabular-nums;
   }

   .hint {
      @apply text-sm;
      color: var(--text-color-two);
   }

   .buttons {
      @apply flex gap-2 mt-1;
   }

   .ok {
      @apply px-6 py-2 font-bold text-white rounded-lg;
      background: var(--primary-color);
   }

   .cancel {
      @apply px-6 py-2 font-bold rounded-lg;
      background: var(--bg-color-zero);
      color: var(--text-color);
   }

   .ok:disabled {
      @apply opacity-50;
   }
</style>
