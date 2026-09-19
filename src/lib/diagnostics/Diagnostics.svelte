<script>
   /*
      Diagnostics: the answers to "is it the state or the client?" in one place.

      Everything here is a *snapshot* of this browser, taken on one timer and read
      imperatively, so the sections cannot disagree with each other the way six
      separate questions to a console would. It observes and reports; it changes
      nothing and sends nothing.

      Two halves, deliberately side by side:

        the transport - what the relay delivered, what this client did with it,
                        and what has gone wrong. `ignored` on an event is the
                        line that explains a board that "received everything".

        the boards    - zone counts read through exportBoard(), which is the same
                        shape the relay is sent. So "deck 45, hand 7" here is the
                        number this client is publishing, and if the other half
                        disagrees, the fault is in between rather than in the state.

      The relay's own view of the room is a different question, answered from
      outside by `node tools/room-log.mjs <ROOM>`.

      This is the panel alone, with no page or dialog around it, because it is shown
      in two places: the settings menu, as a dialog over the board, and the
      standalone /diagnostics page. Both must show the same thing.
   */
   import { onMount } from 'svelte'
   import { PVP_SERVER, APP_ENV, HAS_EXTERNAL_SERVER } from '$lib/util/env.js'
   import {
      socket, connected, room, spectating, spectators,
      seatedPlayers, myId, idle, roomError, restored
   } from '$lib/stores/connection.js'
   import { solo } from '$lib/stores/solo.js'
   import { relayEvents, clearRelayEvents, boardZones, ZONE_LABELS } from '$lib/stores/diagnostics.js'
   import { exportBoard as exportMine } from '$lib/stores/player.js'
   import { defaultOpponent, spectatorOpponents } from '$lib/stores/opponent.js'

   /* how often the snapshot is retaken; fast enough to watch, cheap enough to leave open */
   const REFRESH_MS = 500

   let health = { state: 'checking', body: null, error: null, probed: false }
   let copied = false
   let copiedTimer = null
   let timer = null
   let snapshot = null

   /*
      The relay's health, as this client sees it. `probe` asks the store a
      question, which costs one write - worth doing when something is wrong, not
      worth doing on a timer, so it is a button rather than part of the refresh.
   */
   async function checkHealth (probe = false) {
      health = { ...health, state: 'checking' }
      try {
         const res = await fetch(`${PVP_SERVER}/api/relay/health${probe ? '?probe=1' : ''}`)
         const body = await res.json()
         health = {
            state: res.ok && body.relay !== false ? 'ok' : 'error',
            body,
            error: res.ok ? null : (body.error || `HTTP ${res.status}`),
            probed: probe
         }
      } catch (err) {
         health = { state: 'error', body: null, error: err.message, probed: probe }
      }
   }

   const seatName = (id) => {
      const seat = (socket.players || []).find((player) => player?.id === id)
      if (seat) return seat.name || `seat ${(socket.players || []).indexOf(seat) + 1}`
      return id ? `${String(id).slice(0, 8)}…` : 'nobody'
   }

   /*
      The mirror boards. A player has one (the opponent's half); a spectator has
      two, one per seat; in solo the second half is the same person's. Which seat
      each mirror was pointed at is the thing worth printing - a mirror pointed at
      the wrong player renders an empty half and looks like a relay fault.
   */
   function mirrorRows () {
      if (socket.spectating) {
         return [spectatorOpponents.top, spectatorOpponents.bottom].map((mirror, index) => ({
            label: `${index === 0 ? 'top' : 'bottom'} half`,
            seat: mirror.clientId ? seatName(mirror.clientId) : 'nobody seated',
            enabled: mirror.enabled,
            zones: boardZones(mirror.exportBoard())
         }))
      }

      return [{
         label: solo.get() ? 'second board (solo)' : 'opponent mirror',
         seat: defaultOpponent.clientId ? seatName(defaultOpponent.clientId) : (solo.get() ? 'solo' : 'whoever is not you'),
         enabled: defaultOpponent.enabled,
         zones: boardZones(defaultOpponent.exportBoard())
      }]
   }

   function build () {
      return {
         at: Date.now(),
         url: typeof location !== 'undefined' ? location.href : null,
         env: { appEnv: APP_ENV, pvpServer: PVP_SERVER || '(same origin)', external: HAS_EXTERNAL_SERVER },
         relay: health,

         transport: {
            connected: socket.connected,
            loopRunning: socket.active,
            roomId: socket.roomId,
            role: socket.role,
            memberId: socket.id,
            cursor: socket.cursor,
            seats: socket.seats,
            players: socket.players || [],
            opponentPresent: socket.opponentPresent,
            skewMs: Math.round(socket.skew),
            idleForMs: socket.idleFor(),
            markedIdle: socket.isIdle,
            documentHidden: socket.hidden(),
            pollInFlight: Boolean(socket.controller),
            /* actions waiting for their turn under the send pace */
            pending: socket.pending,
            lastError: socket.lastError(),
            errors: [...socket.errors].reverse().slice(0, 8)
         },

         view: {
            room: room.get(),
            connected: connected.get(),
            spectating: spectating.get(),
            spectators: spectators.get(),
            seatedPlayers: seatedPlayers.get(),
            myId: myId.get(),
            idle: idle.get(),
            solo: solo.get(),
            restored: restored.get(),
            roomError: roomError.get()
         },

         me: boardZones(exportMine()),
         mirrors: mirrorRows(),
         events: [...relayEvents.get()].reverse()
      }
   }

   /*
      Taken once up front, not only in onMount, so the first paint already has
      values rather than a frame of "collecting…". It sits after the declarations
      above because build() calls into them. Nothing here touches the DOM: it reads
      the stores, the transport's own counters, and exportBoard().
   */
   snapshot = build()

   onMount(() => {
      checkHealth()
      timer = setInterval(() => { snapshot = build() }, REFRESH_MS)
      return () => clearInterval(timer)
   })

   const age = (ms) => {
      if (ms == null) return '-'
      const s = Math.max(0, Math.round(ms / 1000))
      if (s < 60) return `${s}s`
      const m = Math.floor(s / 60)
      if (m < 60) return `${m}m ${s % 60}s`
      return `${Math.floor(m / 60)}h ${m % 60}m`
   }

   const json = (value) => JSON.stringify(value)

   function copyReport () {
      const text = JSON.stringify(snapshot, null, 2)
      navigator.clipboard.writeText(text).then(() => {
         copied = true
         clearTimeout(copiedTimer)
         copiedTimer = setTimeout(() => { copied = false }, 2000)
      })
   }

   const zoneLine = (zones) => ZONE_LABELS
      .filter(([key]) => zones[key])
      .map(([key, label]) => `${label} ${zones[key]}`)
      .join(' · ') || 'nothing on the board'

   /* an event nobody handled, which is the one worth colouring */
   $: ignoredCount = snapshot ? snapshot.events.filter((event) => !event.handled).length : 0
</script>

<div class="flex flex-col gap-3">
   <div class="flex items-center gap-2 flex-wrap">
      <button class="control" on:click={() => checkHealth(true)}>Probe store</button>
      <button class="control" on:click={copyReport}>{copied ? 'Copied' : 'Copy report'}</button>
      <span class="flex-1"></span>
      <span class="text-xs text-[var(--text-color-two)]">snapshot every {REFRESH_MS} ms</span>
   </div>

   <p class="text-xs text-[var(--text-color-two)]">
      "Probe store" makes the relay write and expire a key (one command) - use it when something
      is wrong, not repeatedly. The relay's own view of a room is a separate question:
      <code>node tools/room-log.mjs &lt;ROOM&gt;</code>.
   </p>

   {#if !snapshot}
      <div class="text-sm">collecting…</div>
   {:else}
      <div class="flex flex-col gap-3">
         <!-- --------------------------------------------------------- relay -->
         <section class="card">
            <h2>Relay</h2>
            {#if snapshot.relay.state === 'checking'}
               <div class="row">checking {snapshot.relay.probed ? '(with a store probe)' : ''}…</div>
            {:else if snapshot.relay.state === 'error'}
               <div class="row bad">
                  <span>unavailable</span>
                  <span>{snapshot.relay.error}</span>
               </div>
               {#if snapshot.relay.body?.hint}<div class="row"><span>hint</span><span>{snapshot.relay.body.hint}</span></div>{/if}
            {:else}
               <div class="row"><span>store</span><span>{snapshot.relay.body.store}{snapshot.relay.body.from ? ` (from ${snapshot.relay.body.from})` : ''}</span></div>
               <div class="row"><span>store answered</span><span>{snapshot.relay.body.checked ? 'yes - a probe write succeeded' : 'not asked (no command spent)'}</span></div>
               <div class="row"><span>poll settings</span><span>hold {snapshot.relay.body.poll?.waitMs} ms, check every {snapshot.relay.body.poll?.intervalMs} ms</span></div>
            {/if}
            <div class="row"><span>relay base</span><span>{snapshot.env.pvpServer}</span></div>
            <div class="row"><span>env</span><span>{snapshot.env.appEnv}</span></div>
         </section>

         <!-- ----------------------------------------------------- transport -->
         <section class="card">
            <h2>Transport</h2>
            <div class="row"><span>connected</span><span>{snapshot.transport.connected ? 'yes' : 'no'}{snapshot.transport.loopRunning ? '' : ' - poll loop not running'}</span></div>
            <div class="row"><span>room / role</span><span>{snapshot.transport.roomId || 'none'} / {snapshot.transport.role || 'none'}</span></div>
            <div class="row"><span>member</span><span>{snapshot.transport.memberId || 'none'}</span></div>
            <div class="row"><span>cursor</span><span>{snapshot.transport.cursor} (events after this are pending)</span></div>
            <div class="row"><span>seats (join order)</span><span>
               {#if snapshot.transport.players.length}
                  {snapshot.transport.players.map((player, i) => `${i + 1}. ${player.name || 'unnamed'} (${String(player.id).slice(0, 8)}…)`).join('   ')}
               {:else}none taken{/if}
            </span></div>
            <div class="row"><span>other side present</span><span>
               {snapshot.transport.opponentPresent === null ? 'not yet known' : (snapshot.transport.opponentPresent ? 'yes' : 'no')}
            </span></div>
            <div class="row"><span>clock skew</span><span>{snapshot.transport.skewMs} ms (relay minus this browser)</span></div>
            <div class="row"><span>idle</span><span>
               {snapshot.transport.markedIdle ? 'yes - checked lazily' : 'no'}, quiet for {age(snapshot.transport.idleForMs)}
               {snapshot.transport.documentHidden ? ' (tab hidden)' : ''}
            </span></div>
            <div class="row"><span>poll in flight</span><span>{snapshot.transport.pollInFlight ? 'yes' : 'no'}</span></div>
            <div class="row" class:bad={snapshot.transport.pending > 0}>
               <span>queued to send</span>
               <span>{snapshot.transport.pending}
                  {snapshot.transport.pending === 0
                     ? '- nothing waiting'
                     : '- sending is paced, so these go out a few a second rather than all at once'}</span>
            </div>

            {#if snapshot.transport.lastError}
               <div class="row bad">
                  <span>last relay error</span>
                  <span>{age(snapshot.at - snapshot.transport.lastError.at)} ago · {snapshot.transport.lastError.kind} · {snapshot.transport.lastError.message}</span>
               </div>
            {:else}
               <div class="row good"><span>last relay error</span><span>none recorded this session</span></div>
            {/if}

            {#if snapshot.transport.errors.length > 1}
               <details>
                  <summary class="text-sm">{snapshot.transport.errors.length} most recent faults</summary>
                  {#each snapshot.transport.errors as error}
                     <div class="row"><span>{age(snapshot.at - error.at)} ago</span><span>{error.kind} · {error.message}</span></div>
                  {/each}
               </details>
            {/if}
         </section>

         <!-- ---------------------------------------------------- app stores -->
         <section class="card">
            <h2>App store</h2>
            <div class="row"><span>room</span><span>{snapshot.view.room || 'none'} {snapshot.view.roomError ? `· last room error: ${snapshot.view.roomError}` : ''}</span></div>
            <div class="row"><span>mode</span><span>
               {snapshot.view.solo ? 'solo (no relay, no room)' : snapshot.view.spectating ? 'spectating' : snapshot.view.room ? 'playing' : 'main menu'}
            </span></div>
            <div class="row"><span>spectators</span><span>{snapshot.view.spectators}</span></div>
            <div class="row"><span>connected / idle</span><span>{json(snapshot.view.connected)} / {json(snapshot.view.idle)}</span></div>
            <div class="row"><span>my member id</span><span>{snapshot.view.myId || 'none'}</span></div>
            <div class="row"><span>seated players</span><span>{snapshot.view.seatedPlayers.length ? json(snapshot.view.seatedPlayers) : 'none'}</span></div>
            <div class="row"><span>restored session</span><span>{json(snapshot.view.restored)}</span></div>
         </section>

         <!-- --------------------------------------------------------- boards -->
         <section class="card">
            <h2>Boards</h2>
            <div class="row">
               <span>your board{snapshot.view.spectating ? ' (not shown to a spectator)' : ''}</span>
               <span>{snapshot.me.total} cards · {zoneLine(snapshot.me)}</span>
            </div>
            {#each snapshot.mirrors as mirror}
               <div class="row" class:bad={!mirror.enabled}>
                  <span>{mirror.label} · {mirror.seat}{mirror.enabled ? '' : ' · disabled'}</span>
                  <span>{mirror.zones.total} cards · {zoneLine(mirror.zones)}</span>
               </div>
            {/each}
         </section>

         <!-- --------------------------------------------------------- events -->
         <section class="card">
            <h2>
               Events this client received
               {#if ignoredCount}<span class="bad">· {ignoredCount} ignored (no handler)</span>{/if}
               <button class="control ml-2 text-xs" on:click={clearRelayEvents}>clear</button>
            </h2>

            {#if !snapshot.events.length}
               <div class="row"><span>nothing yet</span><span>the relay has not delivered an event to this browser this session</span></div>
            {:else}
               <table>
                  <thead>
                     <tr><th>age</th><th>seq</th><th>event</th><th>from</th><th>handled</th></tr>
                  </thead>
                  <tbody>
                     {#each snapshot.events.slice(0, 20) as event}
                        <tr class:bad={!event.handled}>
                           <td>{age(snapshot.at - event.at)}</td>
                           <td>{event.seq ?? '-'}</td>
                           <td>{event.name}</td>
                           <td>
                              {#if !event.received}local
                              {:else if event.self}you
                              {:else if event.from}{seatName(event.from)}
                              {:else}relay{/if}
                              {event.local ? ' (local)' : ''}
                           </td>
                           <td>{event.handled ? 'yes' : 'IGNORED'}</td>
                        </tr>
                     {/each}
                  </tbody>
               </table>
               {#if snapshot.events.length > 20}
                  <div class="text-xs text-[var(--text-color-two)] mt-1">showing the latest 20 of {snapshot.events.length} kept</div>
               {/if}
            {/if}
         </section>
      </div>
   {/if}
</div>

<style>
   .card {
      @apply p-3 rounded-md bg-[var(--bg-color-zero)] flex flex-col gap-1;
   }

   h2 {
      @apply font-bold text-sm mb-1 flex items-center;
   }

   .row {
      @apply flex gap-3 text-sm;
   }

   /* the label column is fixed so the values line up and can be scanned */
   .row > span:first-child {
      @apply w-[190px] shrink-0 text-[var(--text-color-two)];
   }

   .row > span:last-child {
      @apply break-all;
   }

   .row.bad > span:last-child,
   .bad {
      @apply text-red-500 font-bold;
   }

   .row.good > span:last-child {
      @apply text-[var(--primary-color)];
   }

   details summary {
      @apply cursor-pointer text-[var(--text-color-two)];
   }

   table {
      @apply w-full text-sm;
   }

   th {
      @apply text-left text-[var(--text-color-two)] font-normal;
   }

   td, th {
      @apply py-0.5 pr-3;
   }

   code {
      @apply px-1 rounded bg-[var(--bg-color-two)];
   }

   .control {
      @apply px-2 py-1 text-sm rounded-md bg-[var(--bg-color-two)];
   }
</style>
