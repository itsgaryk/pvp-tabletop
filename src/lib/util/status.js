/*
   Status effects a Pokémon can have.

   There are two markers, one per corner of the card, and they are independent:
   confusion, paralysis and sleep all take the left corner and replace each
   other there, while poison and burn take the right corner and replace each
   other there. A Pokémon can carry one of each at the same time - putting it to
   sleep does not take its poison off, and poisoning it does not wake it up.
*/
export const STATUSES = [
   { id: 'confusion', label: 'Confusion', emoji: '❓', side: 'left' },
   { id: 'paralysed', label: 'Paralysed', emoji: '⚡', side: 'left' },
   { id: 'sleep', label: 'Sleep', emoji: '💤', side: 'left' },
   { id: 'poison', label: 'Poison', emoji: '💀', side: 'right' },
   { id: 'burn', label: 'Burn', emoji: '🔥', side: 'right' }
]

export const SIDES = ['left', 'right']

export const NO_STATUS = { left: null, right: null }

export function statusById (id) {
   return STATUSES.find(status => status.id === id) || null
}

/*
   Coerce whatever arrived - over the relay, or from a board state - into the
   { left, right } shape. An id on its own is accepted too, so a client that
   still sends the old single-status payload only loses the other corner.
*/
export function normalizeStatus (value) {
   const status = { ...NO_STATUS }
   if (!value) return status

   if (typeof value === 'string') {
      const effect = statusById(value)
      if (effect) status[effect.side] = effect.id
      return status
   }

   for (const side of SIDES) {
      const effect = statusById(value[side])
      status[side] = effect ? effect.id : null
   }
   return status
}
