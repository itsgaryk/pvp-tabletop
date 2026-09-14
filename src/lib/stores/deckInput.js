import { writable } from './custom/writable.js'

/*
   A request to show the deck import panel. The panel belongs to the page, but
   the lobby is what asks for it (creating or joining a room needs a deck), so
   the request travels through here. Each request bumps the counter, so asking
   again while it is already open still counts.
*/
export const deckInputRequested = writable(0)

export function openDeckInput () {
   deckInputRequested.update((count) => count + 1)
}
