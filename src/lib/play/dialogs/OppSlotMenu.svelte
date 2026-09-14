<script>
   import { getContext } from 'svelte'
   import ContextMenu from '$lib/components/ContextMenu.svelte'
   import ContextMenuOption from '$lib/components/ContextMenuOption.svelte'
   import { STATUSES, statusById, statusesOn, normalizeStatus, toggleStatus, emptyStatus } from '$lib/util/status.js'
   import { logStatus, logStatusCleared, logAbilityUsed } from '$lib/stores/logger.js'

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
      their own board and every board watching sees it. Confusion, paralysis and
      sleep share the left corner of the card, poison and burn the right (both at
      once), and setting one never touches the other corner.
   */
   function applyStatus (id) {
      const effect = statusById(id)
      if (!effect) return

      const before = normalizeStatus(slot.status.get())
      const next = toggleStatus(before, effect.id)
      const applied = !statusesOn(before, effect.side).includes(effect.id)

      slot.status.set(next)
      share('statusUpdated', { slotId: slot.id, status: next })
      logStatus(slot.name, effect.label, applied)
      menu.close()
   }

   function clearStatusEffects () {
      const before = normalizeStatus(slot.status.get())
      if (!statusesOn(before, 'left').length && !statusesOn(before, 'right').length) {
         menu.close()
         return
      }

      slot.status.set(emptyStatus())
      share('statusUpdated', { slotId: slot.id, status: emptyStatus() })
      logStatusCleared(slot.name)
      menu.close()
   }

   function target () {
      publishLog(`Target: ${slot.name}`)
      menu.close()
   }

   /*
      The ability stripe is on their Pokémon, and marking it works the same way a
      status effect does: it is shared, their board keeps it, and they publish it
      again as their own.
   */
   function toggleAbility () {
      const used = !slot.abilityUsed.get()
      slot.abilityUsed.set(used)
      share('abilityUpdated', { slotId: slot.id, used })
      logAbilityUsed(slot.name, used)
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
                  {#if statusesOn(slot.status.get(), status.side).includes(status.id)}<span class="ml-auto">✓</span>{/if}
               </span>
            </ContextMenuOption>
         {/each}

         {#if statusesOn(slot.status.get(), 'left').length || statusesOn(slot.status.get(), 'right').length}
            <ContextMenuOption click={clearStatusEffects} disabled={$spectating}>
               <span class="pl-3">Clear Status Effects</span>
            </ContextMenuOption>
         {/if}
      {/if}
   {/if}

   <ContextMenuOption click={target} text="Declare Target" disabled={$spectating} />
   <ContextMenuOption click={toggleAbility} text="Ability Used" shortcut={slot?.abilityUsed.get() ? '✓' : null} disabled={$spectating} />
   <ContextMenuOption click={() => openOppSlotDetails(slot)} text="Show All" />
</ContextMenu>
