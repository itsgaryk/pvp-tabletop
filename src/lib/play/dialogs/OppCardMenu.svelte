<script>
   import { getContext } from 'svelte'
   import ContextMenu from '$lib/components/ContextMenu.svelte'
   import ContextMenuOption from '$lib/components/ContextMenuOption.svelte'
   import { defaultOpponent } from '$lib/stores/opponent.js'
   import { logPrizeLook } from '$lib/stores/logger.js'
   import { OPPONENT, soloMoveCard, soloCardToPlay, soloCardAttach, soloCardToStadium } from '$lib/stores/solo.js'

   const { openDetails } = getContext('boardActions')

   /*
      A card on the far half, in solo: the other side is yours too, so a card there
      can be moved the way one of your own can be - to any zone of that half, or
      into play as one of its Pokemon. Online this menu is never opened; the other
      half belongs to somebody else.
   */
   let menu
   let pile = null
   let card = null
   let revealed = true

   export function open (x, y, _pile, _card, _revealed = true) {
      pile = _pile
      card = _card
      revealed = _revealed
      menu.open(x, y)
   }

   function move (target, label, options = {}) {
      soloMoveCard(pile, card, target, label, options)
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

   function toStadium () {
      soloCardToStadium(pile, card)
      menu.close()
   }

   function show () {
      /*
         The far half's face-down prize, looked at in solo: the same line the near
         half's writes, in that half's name, because the log is a record of what
         was done at the table and both halves are played at the same one. What
         counts as that look is the one rule, and the card's own face is what it
         asks (see logPrizeLook): a far half whose prizes are already shown says
         nothing, the way a face-up prize on your own half says nothing.
      */
      logPrizeLook(pile, revealed, OPPONENT)
      openDetails(card)
      menu.close()
   }

   $: ({ hand, discard, lz, prizes, deck, table, stadium, active } = defaultOpponent)
</script>

<ContextMenu bind:this={menu} heading={card?.name} headingClick={card ? show : null}>
   {#if card}
      <ContextMenuOption click={() => toPlay('active')} text="To Active" />
      <ContextMenuOption click={() => toPlay('bench')} text="To Bench" />
      <ContextMenuOption click={attach} text="Attach to Active" disabled={!$active} />

      {#if pile !== hand}
         <ContextMenuOption click={() => move(hand, 'Moved to their hand')} text="To Hand" />
      {/if}
      {#if pile !== discard}
         <ContextMenuOption click={() => move(discard, 'Discarded')} text="To Discard" />
      {/if}
      {#if pile !== stadium}
         <ContextMenuOption click={toStadium} text="To Stadium" />
      {/if}
      {#if pile !== deck}
         <ContextMenuOption click={() => move(deck, 'Shuffled into their deck', { shuffle: true })} text="Shuffle Into Deck" />
         <ContextMenuOption click={() => move(deck, 'Put on top of their deck')} text="To Top of Deck" />
         <ContextMenuOption click={() => move(deck, 'Put on the bottom of their deck', { bottom: true })} text="To Bottom of Deck" />
      {/if}
      {#if pile !== lz}
         <ContextMenuOption click={() => move(lz, 'Sent to the Lost Zone')} text="To Lost Zone" />
      {/if}
      {#if pile !== prizes}
         <ContextMenuOption click={() => move(prizes, 'Moved to their prizes')} text="To Prizes" />
      {/if}
      {#if pile !== table}
         <ContextMenuOption click={() => move(table, 'Moved to the table')} text="To Table" />
      {/if}

      <ContextMenuOption click={show} text="Show Details" />
   {/if}
</ContextMenu>
