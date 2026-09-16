<script>
   import { getContext } from 'svelte'
   import ContextMenu from '$lib/components/ContextMenu.svelte'
   import ContextMenuOption from '$lib/components/ContextMenuOption.svelte'
   import { defaultOpponent } from '$lib/stores/opponent.js'
   import { soloMoveCard, soloCardToPlay, soloCardAttach } from '$lib/stores/solo.js'

   const { openDetails } = getContext('boardActions')

   /*
      A card on the far half, in solo: the other side is yours too, so a card there
      can be moved the way one of your own can be. Online this menu is never
      opened - the other half belongs to somebody else.
   */
   let menu
   let pile = null
   let card = null

   export function open (x, y, _pile, _card) {
      pile = _pile
      card = _card
      menu.open(x, y)
   }

   function move (target, label) {
      soloMoveCard(pile, card, target, label)
      menu.close()
   }

   function toPlay (where) {
      soloCardToPlay(pile, card, where)
      menu.close()
   }

   function attach () {
      soloCardAttach(pile, card)
      menu.close()
   }

   function show () {
      openDetails(card)
      menu.close()
   }

   $: ({ hand, discard, lz, prizes, deck, active } = defaultOpponent)
</script>

<ContextMenu bind:this={menu} heading={card?.name} headingClick={card ? show : null}>
   {#if card}
      <ContextMenuOption click={() => toPlay('active')} text="To Active" />
      <ContextMenuOption click={() => toPlay('bench')} text="To Bench" />
      <ContextMenuOption click={attach} text="Attach to Active" disabled={!$active} />

      {#if pile !== hand}
         <ContextMenuOption click={() => move(hand, 'Moved to hand')} text="To Hand" />
      {/if}
      {#if pile !== discard}
         <ContextMenuOption click={() => move(discard, 'Discarded')} text="To Discard" />
      {/if}
      {#if pile !== lz}
         <ContextMenuOption click={() => move(lz, 'Sent to the Lost Zone')} text="To Lost Zone" />
      {/if}
      {#if pile !== prizes}
         <ContextMenuOption click={() => move(prizes, 'Moved to prizes')} text="To Prizes" />
      {/if}
      {#if pile !== deck}
         <ContextMenuOption click={() => move(deck, 'Put on top of the deck')} text="To Deck" />
      {/if}

      <ContextMenuOption click={show} text="Show Details" />
   {/if}
</ContextMenu>
