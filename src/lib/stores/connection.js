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

export let room = writable(null)
export let connected = writable(false)
export let chat = writable([])

export const socket = new HttpSocket({ baseUrl: PVP_SERVER })

socket.on('connect', () => {
   connected.set(true)
})

socket.on('disconnect', () => {
   connected.set(false)
})

function connect () {
   socket.connect()
}

/* Rooms */

export function createRoom () {
   connect()
   return socket.createRoom().catch((err) => {
      console.error('[pvp-tabletop] could not create a room', err)
      return null
   })
}

export function joinRoom (roomId) {
   connect()
   return socket.joinRoom(roomId).catch((err) => {
      console.error(`[pvp-tabletop] could not join room ${roomId}`, err)
      return null
   })
}

export function leaveRoom () {
   return socket.leaveRoom(room.get()).catch((err) => {
      console.error('[pvp-tabletop] could not leave the room', err)
      return null
   })
}

socket.on('createdRoom', ({ roomId }) => {
   room.set(roomId)
})

socket.on('joinedRoom', ({ roomId }) => {
   room.set(roomId)
})

socket.on('leftRoom', () => {
   room.set(null)
   chat.set([])
})

socket.on('opponentJoined', () => {
   pushToChat('joined the room', 'important')
})

socket.on('opponentLeft', () => {
   pushToChat('left the room', 'important')
})

/* Chat / Log */

function updateChat (message, type, self) {
   chat.update(history => {
      history.push({
         message,
         time: Date.now(),
         type,
         self
      })
      return history
   })
}

export function publishToChat (message, type) {
   if (!room.get()) return
   updateChat(message, type, 1)
   share('chatMessage', { message, type })
}

export function pushToChat (message, type) {
   updateChat(message, type, 0)
}

export function publishLog (message) {
   publishToChat(message, 'log')
}

/* the relay stamps chat so both players see the same order */
socket.on('chatMessage', ({ message, type, time }, meta, { local }) => {
   /*
      publishToChat already wrote this line locally, and the transport hands a
      sent event straight back to local listeners so a player sees their own
      board moves. Both would append the sender's own message a second time,
      labelled as the opponent's, so ignore them here.
   */
   if (local || meta?.self) return

   chat.update(history => {
      history.push({ message, time: time ?? Date.now(), type, self: 0 })
      return history
   })
})

/* Game State */

export function share (event, data) {
   if (APP_ENV === 'dev') console.log('Sharing event ' + event, data)
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
