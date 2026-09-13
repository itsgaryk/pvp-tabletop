import { PVP_SERVER, APP_ENV } from '$lib/util/env.js'
import { writable } from './custom/writable.js'
import { io } from 'socket.io-client'

export let room = writable(null)
export let connected = writable(false)
export let chat = writable([])

export const socket = io(PVP_SERVER, {
   transports: [ 'websocket' ],
   autoConnect: false
})

socket.on('connect', () => {
   connected.set(true)
   if (room.get()) { // re-join room when re-connection after disconnect
      joinRoom(room.get())
   }
})

socket.on('disconnect', () => {
   connected.set(false)
})

function connect () {
   if (!connected.get()) {
      socket.connect()
   }
}

/* Rooms */

export function createRoom () {
   connect()
   socket.emit('createRoom')
}

export function joinRoom (roomId) {
   connect()
   socket.emit('joinRoom', { roomId })
}

export function leaveRoom () {
   socket.emit('leaveRoom', { roomId: room.get() })
   chat.set([])
}

socket.on('createdRoom', ({ roomId }) => {
   room.set(roomId)
})

socket.on('joinedRoom', ({ roomId }) => {
   room.set(roomId)
})

socket.on('leftRoom', () => {
   room.set(null)
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

socket.on('chatMessage', ({ message, type }) => {
   pushToChat(message, type)
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