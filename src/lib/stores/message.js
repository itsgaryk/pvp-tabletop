import { writable } from './custom/writable.js'

/*
   Short-lived messages shown in the middle of the screen - a coin flip result,
   how many mulligans a setup took. The dialog that renders them lives with the
   board, but the actions that raise them do not have to: they only need this.
*/
export const message = writable(null)

export function showMessage (text) {
   message.set({ text, id: Date.now() })
}
