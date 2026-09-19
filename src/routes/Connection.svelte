<script>
   import { onMount, onDestroy } from 'svelte'
   import Chat from './Chat.svelte'
   import Spinner from './Spinner.svelte'
   import GameActions from '$lib/play/GameActions.svelte'
   import Icon from '$lib/components/Icon.svelte'
   import RoomIdPrompt from '$lib/play/dialogs/RoomIdPrompt.svelte'
   import { check, copy } from '$lib/icons/paths.js'
   import { PVP_SERVER } from '$lib/util/env.js'
   import {
      connected, room, spectating, spectators, chat,
      createRoom, joinRoom, spectateRoom, leaveRoom, roomSummary, roomError,
      idle, resume, socket, waiting
   } from '$lib/stores/connection.js'
   import { solo, startSolo, exitSolo } from '$lib/stores/solo.js'

   let roomId = ''

   /*
      The room code is asked for by a prompt rather than typed into the lobby, so
      the lobby has no field in it: joining and spectating are buttons, and the
      prompt is opened by whichever of them was pressed.
   */
   let prompt

   /* the room code's copy button shows a tick for a moment after a copy */
   let copied = false
   let copiedTimer = null

   /* Is the game relay usable? This distinguishes "the server is not
      configured" from "you have not joined a room yet", which is the
      difference that matters on a fresh Vercel deploy with no database. */
   let relay = { state: 'checking', error: null }
   let busy = false
   let failure = null

   /* Lobby status for the code being typed: once both seats are taken the
      lobby is locked and only spectating is offered. */
   let status = null
   let statusTimer = null

   onMount(async () => {
      try {
         const res = await fetch(`${PVP_SERVER}/api/relay/health`)
         const body = await res.json()
         relay = res.ok && body.relay
            ? { state: 'ok', error: null }
            : { state: 'error', error: body.error || `relay responded ${res.status}` }
      } catch (err) {
         relay = { state: 'error', error: err.message }
      }
   })

   /*
      The last thing the relay transport recorded going wrong.

      Failures used to end at console.error, so a board could sit there quietly
      wrong with nothing on screen to say why - which is how the spectator bugs
      survived so many rounds. Watched on a timer rather than by subscribing,
      because the transport's record is a plain array rather than a store.
   */
   let relayFault = null
   let faultTimer = null

   onMount(() => {
      const watch = () => { relayFault = socket.lastError() }
      watch()
      faultTimer = setInterval(watch, 1000)
   })

   onDestroy(() => clearInterval(faultTimer))

   $: if (roomId.length >= 6) scheduleStatus(roomId)
   else status = null

   function scheduleStatus (id) {
      clearTimeout(statusTimer)
      statusTimer = setTimeout(async () => {
         const summary = await roomSummary(id.toUpperCase().trim())
         if (summary && !summary.error) status = summary
      }, 400)
   }

   /* the relay's own message is more use than "could not", so show it too */
   const why = (fallback) => ($roomError ? `${fallback} (${$roomError})` : fallback)

   async function create () {
      busy = true
      failure = null
      const res = await createRoom()
      if (!res) failure = why('Could not create a room.')
      busy = false
   }

   /*
      All three of the lobby's actions start by asking: who you are, and for two
      of them which room. One prompt, and which button opened it is what decides
      what happens to what comes back.
   */
   function askForRoom (what) {
      failure = null
      prompt.ask(what)
   }

   async function onRoomChosen (event) {
      roomId = event.detail.roomId

      if (event.detail.what === 'create') await create()
      else if (event.detail.what === 'spectate') await spectate()
      else await join()
   }

   async function join () {
      busy = true
      failure = null
      const res = await joinRoom(roomId)
      if (!res) {
         failure = status?.locked
            ? 'That lobby is locked - both seats are taken. Spectate instead.'
            : why(`Could not join ${roomId.toUpperCase()}.`)
      }
      busy = false
   }

   async function spectate () {
      busy = true
      failure = null
      const res = await spectateRoom(roomId)
      if (!res) failure = why(`Could not spectate ${roomId.toUpperCase()}.`)
      busy = false
   }

   /*
      Copy the room code from beside the code itself, the way the harness copies
      a prompt: the button turns into a tick for a moment so the copy is visible
      without a label.
   */
   function copyRoomCode () {
      navigator.clipboard.writeText($room).then(() => {
         copied = true
         clearTimeout(copiedTimer)
         copiedTimer = setTimeout(() => { copied = false }, 2000)
      })
   }

   function leave () {
      if ($solo) {
         exitSolo()
         return
      }
      if (!window.confirm('Sure?')) return
      leaveRoom()
   }

   /* solo's own log: the game lines, with chat left out - there is no chat */
   $: logLines = $chat.filter((entry) => entry.type !== 'chat')

   /*
      The clock on a waiting room: a player who vanished and has not come back.
      It is a deadline on the relay's clock, so the seconds are worked out
      against `serverNow()` on a tick. Without the tick the number would sit
      still until something else re-rendered the page.

      The other wait a room can be under - for a second player to arrive at all -
      is deliberately not shown. A room on that clock is one player sitting alone
      in it, and a countdown to being thrown back to the lobby is not something
      they need on screen while they wait; the ending, if it comes, says so.
   */
   let now = Date.now()
   onMount(() => {
      const ticker = setInterval(() => { now = Date.now() }, 250)
      return () => clearInterval(ticker)
   })

   const pad = (value) => String(value).padStart(2, '0')

   function countdown (deadlineAt) {
      const left = Math.max(0, Number(deadlineAt || 0) - socket.serverNow())
      const seconds = Math.ceil(left / 1000)
      return `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`
   }

   /* `now` is read so the countdown is recomputed on every tick of the clock */
   $: rejoinLeft = $waiting && now >= 0 ? countdown($waiting.deadlineAt) : null

   function chatTime (time) {
      const format = { hour: '2-digit', minute: '2-digit', second: '2-digit' }
      return (new Date(time)).toLocaleTimeString([], format)
   }
</script>

<div class="p-4 min-w-[350px] w-[min(20%,500px)] flex flex-col h-screen">
   {#if !$room && !$solo}
      {#if relay.state === 'error'}
         <div class="bg-red-500 text-white text-sm rounded-md p-3 mb-4">
            <div class="font-bold mb-1">Game relay unavailable</div>
            <div class="text-xs break-words">{relay.error}</div>
            <div class="text-xs mt-2 opacity-90">
               On Vercel, attach a Redis/KV integration to this project and redeploy.
            </div>
         </div>
      {:else if relay.state === 'checking'}
         <div class="flex gap-3 items-center justify-center text-sm mb-4">
            checking relay <Spinner />
         </div>
      {/if}

      <div class="flex flex-col justify-center gap-3">
         <!--
            Playing both sides yourself needs no room and no relay, so it comes
            before the name: it is the shortest way onto a board.
         -->
         <button class="connect" on:click={startSolo}>Play Solo</button>
         <hr>

         <!--
            No name field and no Room ID field: the prompt each button opens asks
            for what that button needs, so these are plain buttons and all of them
            are the same size as each other.
         -->
         <button class="connect" on:click={() => askForRoom('create')} disabled={busy}>Create Room</button>
         <hr>
         <button class="connect" on:click={() => askForRoom('join')} disabled={busy || status?.locked}>Join Room</button>
         <button class="connect" on:click={() => askForRoom('spectate')} disabled={busy}>Spectate Game</button>

         {#if status?.locked}
            <div class="text-xs text-center text-[var(--text-color-two)]">
               This lobby is full - {status.players}/{status.maxPlayers} players.
               You can watch as a spectator.
            </div>
         {/if}

         {#if failure}
            <div class="text-sm text-red-500">{failure}</div>
         {/if}
      </div>

   {:else}
      <div class="flex flex-col gap-1 mb-5">
         {#if !$connected && !$solo}
            <div class="flex gap-3 items-center justify-center bg-yellow-400 text-black p-1 rounded-md mb-2">
               lost connection
               <Spinner />
            </div>
         {/if}

         <div class="text-center font-bold">
            {#if $solo}
               <div class="text-sm text-[var(--text-color-two)]">Solo - both sides are yours</div>
            {:else}
               <div class="flex items-center justify-center gap-1 text-sm text-[var(--text-color-two)]">
                  <span>{$room}</span>
                  <button
                     class="rounded p-0.5 hover:bg-[var(--bg-color-two)]"
                     title={copied ? 'Copied' : 'Copy room code'}
                     aria-label="Copy room code"
                     on:click={copyRoomCode}
                  >
                     <Icon path={copied ? check : copy} class="text-[8px]" />
                  </button>
               </div>
            {/if}
         </div>

         <!-- the same watcher line for a player and for a spectator -->
         {#if $spectators > 0 && !$solo}
            <div class="text-center text-xs text-[var(--text-color-two)]">
               {$spectators} {$spectators === 1 ? 'spectator' : 'spectators'}
            </div>
         {/if}
      </div>

      <!--
         Nothing has happened here for ten minutes, so the board is being checked
         for lazily. Saying so, with a way to catch up at once, beats a board that
         silently lags behind.
      -->
      {#if $idle && !$solo}
         <div class="flex items-center gap-2 p-2 mb-2 rounded-md text-sm bg-[var(--bg-color-two)]">
            <span class="flex-1">Idle for 10 minutes - updates may be delayed.</span>
            <button class="px-2 py-1 font-bold rounded-md text-white bg-[var(--primary-color)]" on:click={resume}>Reconnect</button>
         </div>
      {/if}

      <!--
         Waiting for a player who vanished. The room is being held for them, so
         this is a pause rather than an ending - and the ending, if it comes, says
         so in the dialog.
      -->
      {#if rejoinLeft && !$solo}
         <div class="notice">
            <span class="flex-1">A player left without leaving - waiting for them to rejoin</span>
            <span class="tabular-nums font-bold">{rejoinLeft}</span>
         </div>
      {/if}

      <!--
         The log, and only the log: there is nobody to chat to and nothing to
         catch up on when both sides are yours, but what happened on the board is
         worth keeping. It is written here rather than through the chat window so
         that it does not depend on that window's tabs.
      -->
      {#if $solo}
         <div class="solo-log">
            {#each logLines as entry}
               <p>
                  <span class="who">[{entry.name || 'Player 1'}] {chatTime(entry.time)}</span>
                  {entry.message}
               </p>
            {/each}
         </div>
      {:else}
         <Chat />
      {/if}

      <!-- the game actions sit under the chat, so the board gets the full width -->
      <GameActions />

      <button class="mt-4 text-center" on:click={leave}>
         {$solo ? 'Leave Solo' : ($spectating ? 'Stop Spectating' : 'Leave Room')}
      </button>

   {/if}

   <!--
      The last relay fault, if there was one. A silent failure is the expensive
      kind, so the reason is on screen rather than only in the console. The full
      picture is behind Settings > Diagnostics, rather than sitting on the board.
   -->
   <div class="mt-2 flex flex-col gap-1 text-xs text-[var(--text-color-two)]">
      {#if relayFault}
         <div class="text-red-500 break-words">
            relay: {relayFault.kind} - {relayFault.message}
         </div>
      {/if}
   </div>
</div>

<!--
   The room-code prompt, centred over the lobby. It is a sibling of the panel
   rather than inside it, so the dialog is not laid out by the lobby's column.
-->
<RoomIdPrompt bind:this={prompt} on:confirmed={onRoomChosen} />

<style>
   button.connect {
      @apply py-2 px-3 font-bold text-white bg-[var(--primary-color)] rounded-lg;
      /* every lobby button is the same size, the width of the panel it sits in */
      @apply w-full;
   }

   button.connect:disabled {
      @apply opacity-50;
   }

   /* the notice a waiting room shows: the same shape as the idle one */
   .notice {
      @apply flex items-center gap-2 p-2 mb-2 rounded-md text-sm bg-[var(--bg-color-two)];
   }

   /* solo's log window, styled like the chat window's list */
   .solo-log {
      @apply flex-1 p-2 mb-2 border border-dark-50 rounded-md overflow-y-scroll bg-[var(--input-color)];
      max-height: 40vh;
   }

   .solo-log p {
      @apply break-words;
   }

   .solo-log .who {
      @apply text-sm text-[var(--text-color-two)];
   }
</style>
