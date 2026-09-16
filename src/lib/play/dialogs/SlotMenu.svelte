<script>
   import { getContext } from 'svelte'
   import ContextMenu from '$lib/components/ContextMenu.svelte'
   import ContextMenuOption from '$lib/components/ContextMenuOption.svelte'
   import { share } from '$lib/stores/connection.js'
   import { logMove } from '$lib/stores/logger.js'
   import { STATUSES, statusesOn } from '$lib/util/status.js'

   import {
      hand, discard, active,
      moveSelection, toActive, toBench, removeSlot,
      setStatus, clearStatus, toggleAbilityUsed
   } from '$lib/stores/player.js'

   const { openSlotDetails, openDetails } = getContext('boardActions')

   export let selection

   $: top = $selection.length === 1 ? $selection[0].pokemon.get().at(-1) : null
   $: heading = top ? top.name : `${$selection.length} Pokémon`

   let menu
   /* the status effects are only listed once their menu entry is clicked */
   let statusOpen = false

   /* the Pokemon's name is a card, so clicking it shows that card */
   function showDetails () {
      if (top) openDetails(top)
   }

   export function open (x, y) {
      statusOpen = false
      menu.open(x, y)
   }

   function applyStatus (status) {
      setStatus(status)
      menu.close()
   }

   function applyClear () {
      clearStatus()
      menu.close()
   }

   /*
      The ability stripe is per Pokémon rather than per corner, so it is a plain
      toggle and its tick shows on the entry itself.
   */
   function toggleAbility () {
      toggleAbilityUsed()
      menu.close()
   }

   /* move actions analog zu CardMenu.svelte */

   function moveTo (targetPile, options = {}) {
      moveSelection(targetPile, options)
      menu.close()
   }

   function callThenClose (action) {
      action()
      menu.close()
   }

   function damage (e) {
      const dmg = e.altKey ? 50 : 10
      for (const slot of $selection) {
         slot.damage.update(before => Number(before) + dmg)
         share('damageUpdated', { slotId: slot.id, damage: slot.damage.get() })
      }
   }

   function heal (e) {
      let dmg = e.altKey ? 50 : 10

      let dmgLeft = false

      for (const slot of $selection) {
         const before = slot.damage.get()
         if (dmg > before) slot.damage.set(0)
         else slot.damage.set(before - dmg)

         if (before > dmg) dmgLeft = true

         share('damageUpdated', { slotId: slot.id, damage: slot.damage.get() })
      }

      if (!dmgLeft) menu.close()
   }

   function setDamage () {
      let x = Number(prompt('How much damage is on the Pokémon?'))
      for (const slot of $selection) {
         slot.damage.set(x)
         share('damageUpdated', { slotId: slot.id, damage: x })
      }
   }

   function returnPokemon () {
      for (const slot of $selection) {
         const pokemon = slot.pokemon.get()
         const trainer = slot.trainer.get()
         const energy = slot.energy.get()

         hand.merge(pokemon)
         discard.merge(energy)
         discard.merge(trainer)
         removeSlot(slot)

         share('cardsMoved', { cards: pokemon.map(card => card._id), from: slot.pokemon.name, to: 'hand' })
         share('cardsMoved', { cards: energy.map(card => card._id), from: slot.energy.name, to: 'discard' })
         share('cardsMoved', { cards: trainer.map(card => card._id), from: slot.trainer.name, to: 'discard' })

         share('slotDiscarded', { slotId: slot.id })

         if (trainer.length || energy.length) {
            logMove([ ...trainer, ...energy ], slot.name, 'discard')
         }
         logMove(pokemon, 'play', 'hand')
      }

      menu.close()
   }

   function discardEnergy () {
      for (const slot of $selection) {
         const cards = slot.energy.get().slice()

         discard.merge(slot.energy.get())
         slot.energy.clear()

         share('cardsMoved', { cards: cards.map(card => card._id), from: slot.energy.name, to: 'discard' })
         logMove(cards, slot.energy.name, 'discard')
      }
      menu.close()
   }

</script>

<ContextMenu bind:this={menu} {heading} headingClick={top ? showDetails : null}>
   <ContextMenuOption click={damage} text="Damage" />
   <ContextMenuOption click={heal} text="Heal" />
   <ContextMenuOption click={setDamage} text="Set Damage" />

   <!-- a stripe marks the ability as used, and the log names the Pokémon -->
   <ContextMenuOption click={toggleAbility}>
      <span class="flex w-full items-center gap-2">
         Ability Used
         {#if $selection.length === 1 && $selection[0].abilityUsed.get()}<span>✓</span>{/if}
         <span class="ml-auto text-[var(--text-color-two)]">u</span>
      </span>
   </ContextMenuOption>

   <!--
      A status effect only applies to the Active Pokémon, so it is offered for
      that one alone. Confusion, paralysis and sleep share the left corner of the
      card, poison and burn share the right (both at once); choosing a status the
      corner already has takes that one off.
   -->
   {#if $selection.length === 1 && $selection[0] === $active}
      <ContextMenuOption
         click={() => statusOpen = !statusOpen}
         text="Set Status Effect"
         shortcut={statusOpen ? '▾' : '▸'} />

      {#if statusOpen}
         {#each STATUSES as status (status.id)}
            <ContextMenuOption click={() => applyStatus(status.id)}>
               <span class="flex items-center gap-2 pl-3">
                  <span class="w-4 text-center">{status.emoji}</span>
                  {status.label}
                  {#if statusesOn($active.status.get(), status.side).includes(status.id)}<span class="ml-auto">✓</span>{/if}
               </span>
            </ContextMenuOption>
         {/each}

         {#if statusesOn($active.status.get(), 'left').length || statusesOn($active.status.get(), 'right').length}
            <ContextMenuOption click={applyClear}>
               <span class="pl-3">Clear Status Effects</span>
            </ContextMenuOption>
         {/if}
      {/if}
   {/if}

   <hr>
   {#if $selection.length === 1 && $selection[0] !== $active}
      <ContextMenuOption click={() => callThenClose(toActive)} text="Move to Active" shortcut="a" />
   {/if}
   {#if $selection.includes($active)}
      <ContextMenuOption click={() => callThenClose(toBench)} text="Move to Bench" shortcut="b" />
   {/if}

   <ContextMenuOption click={() => moveTo(discard)} text="Discard All" shortcut="d" />
   <ContextMenuOption click={() => moveTo(hand)} text="Return to Hand" shortcut="h" />
   <ContextMenuOption click={() => returnPokemon()} text="Return Pokémon, Discard Rest" />
   <ContextMenuOption click={() => discardEnergy()} text="Discard All Energy" />

   {#if $selection.length === 1}
      <hr>
      <ContextMenuOption click={() => openSlotDetails($selection[0])} text="Show All" />
   {/if}
</ContextMenu>