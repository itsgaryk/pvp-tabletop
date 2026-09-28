<script>
   import { getContext } from 'svelte'
   import ContextMenu from '$lib/components/ContextMenu.svelte'
   import ContextMenuOption from '$lib/components/ContextMenuOption.svelte'
   import { STATUSES, statusById, statusesOn, normalizeStatus, toggleStatus, emptyStatus } from '$lib/util/status.js'
   import { askForNumber } from '$lib/util/asks.js'
   import { logStatus, logStatusCleared } from '$lib/stores/logger.js'

   import { share, spectating } from '$lib/stores/connection.js'
   import { pingCard } from '$lib/stores/ping.js'
   import { solo, soloSlotToDiscard, soloSlotToActive, soloSlotToBench } from '$lib/stores/solo.js'
   const { openOppSlotDetails, openDetails } = getContext('boardActions')

   let slot
   let isActive = false

   /* their Pokemon's name is a card too, so clicking it shows that card */
   function showDetails () {
      const top = slot?.pokemon.get().at(-1)
      if (top) openDetails(top)
   }
   /* the status effects are only listed once their menu entry is clicked */
   let statusOpen = false
   let menu

   export function open (x, y, _slot, _isActive = false) {
      slot = _slot
      isActive = _isActive
      statusOpen = false
      menu.open(x, y)
   }

   async function setDamage () {
      const x = await askForNumber('damage')
      if (x === null) return

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

   /*
      Pinging the Pokemon - the entry that used to be *Declare Target*.

      It is the one entry on this menu that does not change the game: nothing is marked,
      no state is shared and nobody answers it. What it does is point at the card, in the
      log and with a two-second glow on both boards (see `pingCard`), which is what a
      player wants when they say *this one* across the table - and the log line is
      `Ping:` rather than `Target:`, because there is no target to declare: the entry
      records that a card was pointed at, not that anything is aimed at it.

      The name it is pinged under is the Pokemon's, and it is true here: this menu is only
      opened on a Pokemon this player can see. A board its owner has hidden is the other
      case, and it takes the card menu instead - a ping names a hidden card as a hidden
      card (see opponent/Slot.svelte).
   */
   function ping () {
      pingCard(slot?.pokemon.get().at(-1))
      menu.close()
   }

   /*
      In solo the other half is yours, so its Pokémon can be taken off the board
      or moved between the Active spot and the Bench, the same as your own.
   */
   function sendToDiscard () {
      soloSlotToDiscard(slot)
      menu.close()
   }

   function moveToActive () {
      soloSlotToActive(slot)
      menu.close()
   }

   function moveToBench () {
      soloSlotToBench(slot)
      menu.close()
   }
</script>

<ContextMenu bind:this={menu} heading={slot?.name} headingClick={slot ? showDetails : null}>
   <!-- setting damage and a status change the game; a ping only points at the card -->
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

   <ContextMenuOption click={ping} text="Ping Card" disabled={$spectating} />

   {#if $solo}
      {#if isActive}
         <ContextMenuOption click={moveToBench} text="Move to Bench" />
      {:else}
         <ContextMenuOption click={moveToActive} text="Move to Active" />
      {/if}
      <ContextMenuOption click={sendToDiscard} text="Send to Discard" />
   {/if}

   <ContextMenuOption click={() => openOppSlotDetails(slot)} text="Show All" />
</ContextMenu>
