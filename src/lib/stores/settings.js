import { storable } from './custom/storable.js'

export let autoMulligan = storable(true, 'auto_mulligan')
export let scale = storable(1.0, 'scale')

/* outline each zone of the board, to check where one begins and the next ends */
export let zoneBorders = storable(false, 'zone_borders')

/* the name shown in chat and on the board, set in the lobby */
export let playerName = storable('', 'player_name')
