<script>
   import { onMount, onDestroy } from 'svelte'
   import { timer, setTimer } from '$lib/stores/player.js'
   import { spectating, seatedPlayers, myId, publishLog, socket } from '$lib/stores/connection.js'
   import TimerPrompt from './dialogs/TimerPrompt.svelte'

   /*
      The game timer. Both players can start, pause and add time to it, and it is
      shared as a value - "this many milliseconds left as of this time" - so every
      client counts down from the same number without any traffic between them.

      The store holds that value in this browser's own clock (the store converts
      it as it arrives), so the countdown below is plain local time and cannot
      stutter as the relay's clock is re-estimated. It is the table's clock rather
      than a board's, so a spectator reads the same copy a player does.
   */
   $: timerStore = timer

   const MINUTE = 60 * 1000
   const GLOW_AT_MS = 15 * MINUTE
   const TICK_MS = 250

   /* the relay's clock, which is what `at` is measured in */
   let now = Date.now()
   let ticker

   let glowing = false
   let glowTimer

   /* what the clock read last tick, so passing a mark can be noticed */
   let lastRemaining = null

   /*
      Set while somebody has just put a time on the clock by hand. Being *set* to
      a value is not the same as *running down* to it, and the run-out behaviour -
      the words across the screen and the log line - belongs to the second one. A
      clock set to zero must not announce that time is up.
   */
   let justSet = false
   let justSetTimer

   let flying = false
   let flyTimer
   let expired = false

   function remainingAt (state, at) {
      if (!state?.running) return Math.max(0, state?.remaining || 0)
      return Math.max(0, (state.remaining || 0) - (at - (state.at || at)))
   }

   $: remaining = remainingAt($timerStore, now)
   $: totalSeconds = Math.ceil(remaining / 1000)
   $: hours = Math.floor(totalSeconds / 3600)
   $: minutes = Math.floor((totalSeconds % 3600) / 60)
   $: seconds = totalSeconds % 60
   $: clock = hours > 0
      ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
      : `${pad(minutes)}:${pad(seconds)}`

   const pad = (value) => String(value).padStart(2, '0')

   /*
      Which player speaks for the clock when it runs out. Both clients notice at
      the same moment, so one of them has to own the log line - the host does,
      which both players can work out from the seats they are sent.
   */
   $: hostId = $seatedPlayers[0]?.id || null

   function ownExpiry () {
      return !$spectating && Boolean(hostId) && hostId === $myId
   }

   function tick () {
      now = Date.now()
      const left = remainingAt($timerStore, now)

      /*
         The glow is for passing the mark, not for being past it: a clock set to
         five minutes does not flash, one that runs down through fifteen does.
      */
      if (lastRemaining !== null && lastRemaining > GLOW_AT_MS && left <= GLOW_AT_MS && left > 0) {
         glowing = true
         clearTimeout(glowTimer)
         glowTimer = setTimeout(() => { glowing = false }, 3000)
      }
      lastRemaining = left

      /* our own countdown has run out: stop the table's clock */
      if ($timerStore.running && left <= 0) {
         setTimer({ running: false, remaining: 0 }, socket.serverNow())
      }

      /*
         Everyone plays the words, and the host writes the log line - but only
         for a clock that stopped moments ago. A board joining a room whose timer
         finished an hour back must not set them off, which is what the `at`
         timestamp is for.
      */
      const justStopped = !$timerStore.running &&
         $timerStore.remaining <= 0 &&
         $timerStore.at > 0 &&
         !justSet &&
         now - $timerStore.at < 5000

      if (justStopped) announceTime()
   }

   /* the clock has been given a time: that is not it running out */
   function noteSet () {
      justSet = true
      clearTimeout(justSetTimer)
      justSetTimer = setTimeout(() => { justSet = false }, 3000)
   }

   function announceTime () {
      if (expired) return
      expired = true

      flying = true
      clearTimeout(flyTimer)
      flyTimer = setTimeout(() => { flying = false }, 4000)

      if (ownExpiry()) publishLog('Time on the Round!')
   }

   /* starting again after it has run out is a fresh run */
   $: if ($timerStore.running) expired = false

   function toggle () {
      const left = remainingAt($timerStore, Date.now())
      if (left <= 0) return

      setTimer({ running: !$timerStore.running, remaining: left }, socket.serverNow())
   }

   /*
      The clock is set rather than nudged: a player clicks it and says what the
      time should be. The six buttons that used to sit either side of it - three
      to take time away, three to add it - could only walk the time towards what
      somebody wanted, one press at a time, and they are gone.
   */
   let prompt

   onMount(() => {
      ticker = setInterval(tick, TICK_MS)
      return () => clearInterval(ticker)
   })

   onDestroy(() => {
      clearInterval(ticker)
      clearTimeout(glowTimer)
      clearTimeout(flyTimer)
      clearTimeout(justSetTimer)
   })
</script>

<!--
   Under the turn row, and only in a room: it is the table's clock, not a lobby
   setting. A spectator watches it; the controls are the players'.

   The clock itself is the control that sets it - a player clicks the time to say
   what it should be - and the one button left beside it starts and pauses. A
   spectator gets the time and neither of those.
-->
<div class="timer-row">
   {#if !$spectating}
      <button
         class="control"
         on:click={toggle}
         disabled={remaining <= 0}
         title={$timerStore.running ? 'Pause the clock' : 'Start the clock'}
         aria-label={$timerStore.running ? 'Pause the clock' : 'Start the clock'}
      >⏯️</button>
   {/if}

   {#if $spectating}
      <span class="clock" class:glowing class:expired={remaining <= 0 && !$timerStore.running}>{clock}</span>
   {:else}
      <button
         class="clock"
         class:glowing
         class:expired={remaining <= 0 && !$timerStore.running}
         on:click={() => { noteSet(); prompt.ask() }}
         title="Set the timer"
         aria-label="Set the timer"
      >{clock}</button>
   {/if}
</div>

{#if flying}
   <div class="time-up" aria-hidden="true">Time on the Round!</div>
{/if}

<TimerPrompt bind:this={prompt} />

<style>
   .timer-row {
      @apply flex items-center gap-1 mt-1;
   }

   /*
      The clock is a button now - clicking it is how the time is set - so it has
      to say so: the same shape and type as before, with a pointer and a hover
      state that the bare span never needed.
   */
   .clock {
      @apply flex-1 text-center font-bold py-1.5 rounded-md tabular-nums;
      color: var(--text-color);
      background: var(--bg-color-two);
   }

   button.clock {
      cursor: pointer;
      border: 1px solid var(--bg-color-three);
   }

   button.clock:hover {
      border-color: var(--primary-color);
   }

   /* passing the fifteen minute mark */
   .clock.glowing {
      animation: timer-glow 1s ease-in-out 3;
   }

   .clock.expired {
      color: var(--message-color);
   }

   @keyframes timer-glow {
      0%, 100% { box-shadow: 0 0 0 rgba(250, 204, 21, 0); }
      50% { box-shadow: 0 0 18px 4px rgba(250, 204, 21, 0.85); }
   }

   .control {
      @apply px-2 py-1.5 font-bold rounded-md text-white whitespace-nowrap;
      background: var(--primary-color);
   }

   .control:disabled {
      @apply opacity-50;
   }

   /* time is up: the words cross the screen once, left to right */
   .time-up {
      position: fixed;
      top: 45%;
      left: 0;
      z-index: 40;
      font-size: clamp(1.5rem, 5vw, 4rem);
      font-weight: 800;
      color: var(--message-color);
      text-shadow: 0 2px 12px rgba(0, 0, 0, 0.55);
      white-space: nowrap;
      pointer-events: none;
      animation: fly-across 3.5s ease-in-out forwards;
   }

   @keyframes fly-across {
      from { transform: translateX(-110%); opacity: 0; }
      15% { opacity: 1; }
      85% { opacity: 1; }
      to { transform: translateX(100vw); opacity: 0; }
   }
</style>
