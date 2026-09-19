import { storable } from './custom/storable.js'

export let autoMulligan = storable(true, 'auto_mulligan')

/*
   There is no card size any more. A card on the board is the size of the zone it
   is in (see global.css), which is not a thing a slider can improve on, and the
   slider it replaced was still scaling the board's own spacing under the cards -
   so a setting left at anything but its default moved every zone.
*/

/* outline each zone of the board, to check where one begins and the next ends */
export let zoneBorders = storable(false, 'zone_borders')

/* the name shown in chat and on the board, set in the lobby */
export let playerName = storable('', 'player_name')
