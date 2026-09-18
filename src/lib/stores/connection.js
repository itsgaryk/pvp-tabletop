/*
   Connection to the game relay.

   The relay ships as server routes inside this same project (see
   src/routes/api/relay), so there is no separate game server to deploy and
   VITE_PVP_SERVER is normally left unset. Set it only to point the client at a
   different relay - a self-hosted socket.io server, for example.

   `socket` keeps the small surface the rest of the app was written against
   (on / off / emit / connect), and `share` / `react` wrap it, so gameplay code
   did not have to change. See src/lib/relay/client.js for the transport.
*/

import { PVP_SERVER, APP_ENV } from '$lib/util/env.js'
import { HttpSocket } from '$lib/relay/client.js'
import { writable } from './custom/writable.js'
import { playerName } from './settings.js'
import { solo } from './soloState.js'

export let room = writable(null)
export let connected = writable(false)
export let chat = writable([])
export let spectating = writable(false)
export let spectators = writable(0)
/* the two playing seats: [{ id, name }] in join order */
export let seatedPlayers = writable([])
/* our own member id, so a player can tell which seat is theirs */
export let myId = writable(null)

export const socket = new HttpSocket({ baseUrl: PVP_SERVER })

socket.on('connect', () => {
   connected.set(true)
})

socket.on('disconnect', () => {
   connected.set(false)
})

/*
   Ten minutes without anything happening on this board: the relay is being
   checked for lazily, and the player is told, because news can now take up to
   half a minute to arrive. Any click or key puts it straight back.
*/
export let idle = writable(false)

socket.on('idle', ({ idle: value }) => idle.set(Boolean(value)))

export function resume () {
   idle.set(false)
   return socket.resume()
}

/*
   Coming back to the tab that was in a room: the client remembers the room and
   the seat, so a reload lands back in the same game rather than the lobby - or,
   for a player, rather than being refused a seat in their own room because the
   relay still counts them as sitting in it.
*/
export let restored = writable(false)

if (typeof window !== 'undefined') {
   socket.resumeSession(playerName.get()).then((res) => {
      restored.set(Boolean(res))
   })
}

function connect () {
   socket.connect()
}

/* Rooms */

/*
   What went wrong with the last room request, for the lobby to show. A bare
   "could not create a room" hides the one thing worth knowing - a database that
   is over quota, or missing - so the relay's own message is kept.
*/
export let roomError = writable(null)

export function createRoom () {
   connect()
   return socket.createRoom(playerName.get()).catch((err) => {
      console.error('[pvp-tabletop] could not create a room', err)
      roomError.set(err.message)
      return null
   })
}

export function joinRoom (roomId) {
   connect()
   return socket.joinRoom(roomId, playerName.get()).catch((err) => {
      console.error(`[pvp-tabletop] could not join room ${roomId}`, err)
      roomError.set(err.message)
      return null
   })
}

/* Watch a game without taking a playing seat. */
export function spectateRoom (roomId) {
   connect()
   return socket.spectateRoom(roomId, playerName.get()).catch((err) => {
      console.error(`[pvp-tabletop] could not spectate room ${roomId}`, err)
      roomError.set(err.message)
      return null
   })
}

export function leaveRoom () {
   return socket.leaveRoom(room.get()).catch((err) => {
      console.error('[pvp-tabletop] could not leave the room', err)
      return null
   })
}

/*
   How many playing seats are taken, and whether they are all taken. A locked
   lobby only accepts spectators, so the UI uses this to offer "Spectate Game"
   instead of "Join Room".
*/
export async function roomSummary (roomId) {
   try {
      const res = await fetch(`${PVP_SERVER}/api/relay/room?roomId=${encodeURIComponent(roomId)}`)
      if (!res.ok) return null
      return await res.json()
   } catch {
      return null
   }
}

async function refreshSummary (roomId) {
   const summary = await roomSummary(roomId)
   if (summary && typeof summary.spectators === 'number') spectators.set(summary.spectators)
}

socket.on('createdRoom', ({ roomId, role }) => {
   spectating.set(role === 'spectator')
   myId.set(socket.id)
   room.set(roomId)
   refreshSummary(roomId)
})

socket.on('joinedRoom', ({ roomId, role }) => {
   spectating.set(role === 'spectator')
   myId.set(socket.id)
   room.set(roomId)
   refreshSummary(roomId)
})

socket.on('spectatingRoom', ({ roomId }) => {
   spectating.set(true)
   myId.set(socket.id)
   room.set(roomId)
   refreshSummary(roomId)
})

/* which two members hold the playing seats, and what they are called */
socket.on('seated', ({ players }) => {
   seatedPlayers.set(players || [])
})

socket.on('leftRoom', () => {
   room.set(null)
   spectating.set(false)
   spectators.set(0)
   seatedPlayers.set([])
   myId.set(null)
   chat.set([])
})

socket.on('opponentJoined', () => {
   pushToChat('joined the room', 'important')
})

socket.on('opponentLeft', () => {
   pushToChat('left the room', 'important')
})

/* keeps the watcher count current for everyone, without polling the lobby */
socket.on('spectatorChanged', ({ spectators: count }) => {
   if (typeof count === 'number') spectators.set(count)
})

/* Chat / Log */

function updateChat (message, type, self, name = null) {
   chat.update(history => {
      history.push({
         message,
         time: Date.now(),
         type,
         self,
         /*
            Our own lines carry our name; the relay names everyone else's. In solo
            there is no name worth showing - both halves are the same person - so
            the two sides are Player 1 and Player 2.
         */
         name: name || (self ? (solo.get() ? 'Player 1' : (playerName.get() || null)) : null)
      })
      return history
   })
}

/*
   Chat is the one thing a spectator is allowed to send, so it does not go
   through share() (which refuses to act while spectating). The relay itself
   decides what a member may post.
*/
export function publishToChat (message, type, name = null) {
   /*
      In solo there is no room and no relay, but the game log still has something
      to say - setup, draws, moves - so it is written locally and nothing is sent.
   */
   if (solo.get()) {
      updateChat(message, type, 1, name)
      return
   }

   if (!room.get()) return
   updateChat(message, type, 1, name)
   socket.emit('chatMessage', { message, type })
}

export function pushToChat (message, type) {
   updateChat(message, type, 0)
}

export function publishLog (message) {
   publishToChat(message, 'log')
}

/* the relay stamps chat so both players see the same order, and names the sender */
socket.on('chatMessage', ({ message, type, time, name }, meta, { local } = {}) => {
   /*
      publishToChat already wrote this line locally, so the sender's own copy is
      never rendered again: the transport skips it on the poll, and `local`/`self`
      cover the case where it is handed back some other way.
   */
   if (local || meta?.self) return

   chat.update(history => {
      history.push({ message, time: time ?? Date.now(), type, self: 0, name: name || null })
      return history
   })
})

/* Game State */

export function share (event, data) {
   /*
      A spectator is read-only: every state change in the app funnels through
      share(), so refusing here is what stops a spectator from touching the
      game. The relay also rejects writes from a non-player member.
   */
   if (spectating.get()) return

   if (APP_ENV === 'dev') console.log('Sharing event ' + event, data)

   /*
      Nowhere to send it. In solo that is the design, and a board in the lobby
      that has not joined a room yet is normal too - so neither is a fault. What
      is not normal is a transport that still believes it is in a room: then the
      event really was lost, and it used to go without a word, which reads
      exactly like the relay having ignored it.
   */
   if (!room.get()) {
      if (!solo.get() && socket.roomId) {
         socket.recordError(`send:${event}`, `the event was dropped: room is ${room.get()}, the relay still has ${socket.roomId}`)
      }
      return
   }

   socket.emit(event, {
      ...data, room: room.get()
   })
}

export function react (event, cb) {
   socket.on(event, cb)

   return () => {
      socket.off(event, cb)
   }
}

if (APP_ENV === 'dev') {
   socket.onAny((eventName, ...args) => {
      console.log('received event ' + eventName)
   })
}
