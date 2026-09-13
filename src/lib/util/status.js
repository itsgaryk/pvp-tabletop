/*
   Status effects a Pokémon can have.

   `side` is where the marker sits on the card: confusion, paralysis and sleep
   go on the left of the card, poison and burn take the right, which is where
   the old plain marker used to live. Only one status can be on a Pokémon at a
   time, so setting one replaces whatever was there.
*/
export const STATUSES = [
   { id: 'confusion', label: 'Confusion', emoji: '❓', side: 'left' },
   { id: 'paralysed', label: 'Paralysed', emoji: '⚡', side: 'left' },
   { id: 'sleep', label: 'Sleep', emoji: '💤', side: 'left' },
   { id: 'poison', label: 'Poison', emoji: '💀', side: 'right' },
   { id: 'burn', label: 'Burn', emoji: '🔥', side: 'right' }
]

export function statusById (id) {
   return STATUSES.find(status => status.id === id) || null
}
