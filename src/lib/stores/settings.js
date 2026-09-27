import { browser } from '$app/environment'
import { storable } from './custom/storable.js'

/*
   Auto-mulligan is off, and there is no control for it: the Mulligans block is
   gone from the settings menu, so this store is what is left of the feature -
   the setting, its persisted key and the loop in GameActions.svelte that reads
   it. Nothing switches it on, which is the point: set it to true from the
   console (`localStorage.setItem('auto_mulligan', 'true')`) to bring the
   behaviour and its log line back for a test. See docs/mechanics.md#mulligans.

   A value stored while the checkbox was on the menu is dropped rather than
   obeyed: the default changed, and a `true` left in a player's browser would
   have outvoted it and kept redrawing hands with nothing on screen to say why.
   The cost is that the console write above is undone by the next page load,
   which is the right way round for a setting that no longer has a control.
*/
if (browser) localStorage.removeItem('auto_mulligan')

export let autoMulligan = storable(false, 'auto_mulligan')

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
