<script>
   import { getContext } from 'svelte'
   import ContextMenu from '$lib/components/ContextMenu.svelte'
   import ContextMenuOption from '$lib/components/ContextMenuOption.svelte'

   import { share, publishLog, spectating } from '$lib/stores/connection.js'
   const { openOppSlotDetails } = getContext('boardActions')

   let slot
   let menu

   export function open (x, y, _slot) {
      slot = _slot
      menu.open(x, y)
   }

   function setDamage () {
      let x = Number(prompt('How much damage is on the Pokémon?'))
      slot.damage.set(x)
      share('oppDamageUpdated', { slotId: slot.id, damage: x })
   }

   function target () {
      publishLog(`Target: ${slot.name}`)
      menu.close()
   }
</script>

<ContextMenu bind:this={menu} heading={slot?.name}>
   <!-- setting damage and declaring a target both change the game -->
   <ContextMenuOption click={setDamage} text="Set Damage" disabled={$spectating} />
   <ContextMenuOption click={target} text="Declare Target" disabled={$spectating} />
   <ContextMenuOption click={() => openOppSlotDetails(slot)} text="Show All" />
</ContextMenu>