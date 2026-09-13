<script>
   import { getContext } from 'svelte'
   import ContextMenu from '$lib/components/ContextMenu.svelte'
   import ContextMenuOption from '$lib/components/ContextMenuOption.svelte'
   import { STATUSES } from '$lib/util/status.js'

   import { share, publishLog, spectating } from '$lib/stores/connection.js'
   const { openOppSlotDetails } = getContext('boardActions')

   let slot
   let isActive = false
   /* the status effects are only listed once their menu entry is clicked */
   let statusOpen = false
   let menu

   export function open (x, y, _slot, _isActive = false) {
      slot = _slot
      isActive = _isActive
      statusOpen = false
      menu.open(x, y)
   }

   function setDamage () {
      let x = Number(prompt('How much damage is on the Pokémon?'))
      slot.damage.set(x)
      share('oppDamageUpdated', { slotId: slot.id, damage: x })
   }

   /*
      Marking their Pokémon is how a status effect actually gets applied: it is
      shared as a normal status update, so the Pokémon's owner applies it to
      their own board and every board watching sees it. Choosing the status it
      already has takes it off again.
   */
   function applyStatus (status) {
      const next = slot.status.get() === status ? null : status
      slot.status.set(next)
      share('statusUpdated', { slotId: slot.id, status: next })
      menu.close()
   }

   function target () {
      publishLog(`Target: ${slot.name}`)
      menu.close()
   }
</script>

<ContextMenu bind:this={menu} heading={slot?.name}>
   <!-- setting damage, a status or a target all change the game -->
   <ContextMenuOption click={setDamage} text="Set Damage" disabled={$spectating} />

   {#if isActive}
      <ContextMenuOption
         click={() => statusOpen = !statusOpen}
         text="Set Status Effect"
         shortcut={statusOpen ? '▾' : '▸'}
         disabled={$spectating} />

      {#if statusOpen}
         {#each STATUSES as status (status.id)}
            <ContextMenuOption click={() => applyStatus(status.id)} disabled={$spectating}>
               <span class="flex items-center gap-2 pl-3">
                  <span class="w-4 text-center">{status.emoji}</span>
                  {status.label}
                  {#if slot.status.get() === status.id}<span class="ml-auto">✓</span>{/if}
               </span>
            </ContextMenuOption>
         {/each}

         {#if slot.status.get()}
            <ContextMenuOption click={() => applyStatus(null)} disabled={$spectating}>
               <span class="pl-3">Clear Status Effect</span>
            </ContextMenuOption>
         {/if}
      {/if}
   {/if}

   <ContextMenuOption click={target} text="Declare Target" disabled={$spectating} />
   <ContextMenuOption click={() => openOppSlotDetails(slot)} text="Show All" />
</ContextMenu>
