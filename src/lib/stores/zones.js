/*
   Which of the board's optional zones this client draws.

   One answer, shared by everything that draws a zone and everything that feeds
   one: the board itself, and the menus that move a card into a zone. They have to
   agree, because a menu offering a zone the board does not draw is a card sent to
   a place nobody can see - so an entry disappears in exactly the case its
   destination does.

   Solo draws every zone. It has no room and so no format, and its Settings still
   offers the marker the Pokemon Power zone holds - hiding the zone a setting is
   about would be hiding the setting's own subject. In a room the format decides,
   for both players and for whoever is watching (see $lib/util/format.js).

   Derived rather than written by whoever last read a format, so there is no
   second copy of the answer to keep in step: the two inputs are the whole of it.
*/
import { derived } from 'svelte/store'
import { solo } from './soloState.js'
import { roomFormat } from './connection.js'
import { showsPowerZone, showsLostZone } from '$lib/util/format.js'

/*
   `ask` is one of the format module's own questions, so each zone below is a
   named answer rather than a rule written a second time in a store.
*/
const shown = (ask) => derived([ solo, roomFormat ], ([ $solo, $format ]) => $solo || ask($format))

/* the Pokemon Power zone, and with it the VSTAR / GX markers it holds */
export const powerZoneShown = shown(showsPowerZone)

/* the Lost Zone */
export const lostZoneShown = shown(showsLostZone)
