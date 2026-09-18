<script>
   /*
      An idle room is asked whether anybody is still playing.

      The relay decides when to ask (nothing has been *done* in the room for
      RELAY_IDLE_MS) and puts the prompt in the room's event log like any other
      event, so it arrives on the poll - and a client that joins or reloads
      halfway through the prompt replays into it and sees the time that is
      actually left, not a fresh ten minutes.

      The countdown is therefore computed against the relay's clock from the
      prompt's own timestamp, exactly as the game timer counts down from `at`:
      the two browsers may disagree about the time of day, so only the relay's
      clock is trustworthy here.

      Either player can answer, and answering is shared - one click takes the
      prompt off both players' screens.
   */
   import { onMount, onDestroy } from 'svelte'
   import {
      socket, idlePromptAt, dismissIdlePrompt, spectating, solo
   } from '$lib/stores/connection.js'

   /* how often the displayed seconds are recomputed */
   const TICK_MS = 250

   let now = Date.now()
   let ticker

   onMount(() => {
      ticker = setInterval(() => { now = Date.now() }, TICK_MS)
      return () => clearInterval(ticker)
   })

   onDestroy(() => clearInterval(ticker))

   const pad = (value) => String(value).padStart(2, '0')

   /*
      What is left, on the relay's clock: `at` is when the relay raised the
      prompt, so the amount left is the same number for everybody however late
      they arrived. `serverNow()` is read here rather than in the template so the
      countdown is recomputed on every tick - it re-estimates the relay's clock
      against this browser's, which `now` does not.
   */
   $: left = $idlePromptAt && now >= 0
      ? Math.max(0, $idlePromptAt.at + $idlePromptAt.promptMs - socket.serverNow())
      : 0
   $: totalSeconds = Math.ceil(left / 1000)
   $: clock = `${pad(Math.floor(totalSeconds / 60))}:${pad(totalSeconds % 60)}`
</script>

{#if $idlePromptAt && !$solo}
   <div class="idle-backdrop">
      <div class="idle-dialog" role="alertdialog" aria-modal="true" aria-labelledby="idle-text">
         <p id="idle-text">Still playing?</p>
         <p class="idle-hint">
            Nobody has moved anything in this room for a while. It will close when this
            countdown runs out.
         </p>
         <p class="idle-clock" aria-live="polite">{clock}</p>

         {#if !$spectating}
            <button class="idle-go" on:click|stopPropagation={dismissIdlePrompt}>Still playing</button>
         {:else}
            <p class="idle-watch">Waiting for a player to answer.</p>
         {/if}
      </div>
   </div>
{/if}

<style>
   /* below the "game closed" dialog: that one is about the room being over */
   .idle-backdrop {
      position: fixed;
      inset: 0;
      z-index: 55;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.5);
   }

   .idle-dialog {
      @apply flex flex-col items-center gap-3 p-6 rounded-lg text-center;
      min-width: min(22rem, 90vw);
      background: var(--bg-color-two);
      color: var(--text-color);
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
   }

   .idle-dialog p:first-child {
      @apply text-lg font-bold;
   }

   .idle-hint,
   .idle-watch {
      @apply text-sm;
      color: var(--text-color-two);
   }

   .idle-clock {
      @apply text-3xl font-bold tabular-nums;
   }

   .idle-go {
      @apply px-6 py-2 font-bold text-white rounded-lg;
      background: var(--primary-color);
   }
</style>
