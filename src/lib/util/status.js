/*
   Status effects a Pokémon can have.

   A card has two marked corners. Confusion, paralysis and sleep share the left
   one and replace each other there. Poison and burn share the right one, and a
   card can carry both at once - the second one sits under the first - because a
   Pokémon can be poisoned and burned at the same time.
*/
export const STATUSES = [
   { id: 'confusion', label: 'Confusion', emoji: '❓', side: 'left' },
   { id: 'paralysed', label: 'Paralysed', emoji: '⚡', side: 'left' },
   { id: 'sleep', label: 'Sleep', emoji: '💤', side: 'left' },
   { id: 'poison', label: 'Poison', emoji: '💀', side: 'right' },
   { id: 'burn', label: 'Burn', emoji: '🔥', side: 'right' }
]

export const SIDES = ['left', 'right']

/* how many markers fit on a corner, top to bottom */
const CAPACITY = { left: 1, right: 2 }

export function statusById (id) {
   return STATUSES.find(status => status.id === id) || null
}

/* the status ids on one corner of the card, in the order they are drawn */
export function statusesOn (status, side) {
   const value = status?.[side]
   const list = Array.isArray(value) ? value : (value ? [value] : [])
   return list.filter(id => statusById(id)).slice(0, CAPACITY[side])
}

export function emptyStatus () {
   return { left: [], right: [] }
}

/*
   Coerce whatever arrived - over the relay, or from a board state - into the
   { left, right } shape. A single id is accepted too, so a payload from an
   earlier version still lands in the right corner.
*/
export function normalizeStatus (value) {
   const status = { left: [], right: [] }
   if (!value) return status

   if (typeof value === 'string') {
      const effect = statusById(value)
      if (effect) status[effect.side] = [effect.id]
      return status
   }

   for (const side of SIDES) status[side] = statusesOn(value, side)
   return status
}

/*
   Add a status to its own corner, or take it off if it is already there. The
   other corner is never touched, so poisoning a sleeping Pokémon leaves it
   asleep.
*/
export function toggleStatus (status, id) {
   const effect = statusById(id)
   const current = normalizeStatus(status)
   if (!effect) return current

   const onSide = current[effect.side]
   const next = onSide.includes(effect.id)
      ? onSide.filter(each => each !== effect.id)
      : [...onSide, effect.id].slice(-CAPACITY[effect.side])

   return { ...current, [effect.side]: next }
}
