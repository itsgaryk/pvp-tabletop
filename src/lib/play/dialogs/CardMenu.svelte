<script>
   import { getContext } from 'svelte'
   import ContextMenu from '$lib/components/ContextMenu.svelte'
   import ContextMenuOption from '$lib/components/ContextMenuOption.svelte'

   import {
      hand, discard, deck, prizes, lz, table,
      moveSelection, toActive, toBench, toStadium
   } from '$lib/stores/player.js'
   import { spectating, publishLog } from '$lib/stores/connection.js'

   const { openDetails, startAE } = getContext('boardActions')

   export let selection

   let pile
   let revealed
   let menu

   $: heading = $selection.length === 1 ? (revealed ? $selection[0].name : 'Hidden card') : `${$selection.length} cards`

   /* one card, and its face is known: the name is worth clicking */
   $: canShowDetails = $selection.length === 1 && revealed

   /*
      Showing a card is the one thing a player does that the other player cannot
      see, so a face-down prize card is the one card it is worth saying out loud:
      looking at it is information the opponent is entitled to know was taken, even
      though the card itself is not. Every other pile a player shows themselves is
      already either face up or their own hand, which is not news.
   */
   function showDetails () {
      if (!revealed && pile === prizes) publishLog('Viewed prize card')
      openDetails($selection[0])
   }

   export function open (x, y, _pile, _revealed) {
      pile = _pile
      revealed = _revealed
      menu.open(x, y)
   }

   function moveTo (targetPile, options = {}) {
      moveSelection(targetPile, options)
      menu.close()
   }

   function callThenClose (action) {
      action()
      menu.close()
   }

   function attachEvolve (evo = false) {
      startAE(evo)
      menu.close()
   }
</script>

<ContextMenu bind:this={menu} {heading} headingClick={canShowDetails ? showDetails : null}>
   {#if pile !== hand}
      <ContextMenuOption click={() => moveTo(hand)} text="To Hand" shortcut="h" disabled={$spectating} />
   {/if}
   {#if pile !== discard}
      <ContextMenuOption click={() => moveTo(discard)} text="To Discard" shortcut="d" disabled={$spectating} />
   {/if}

   <ContextMenuOption click={() => callThenClose(toBench)} text="To Bench" shortcut="b" disabled={$spectating} />
   {#if $selection.length === 1}
      <ContextMenuOption click={() => callThenClose(toActive)} text="To Active" shortcut="a" disabled={$spectating} />
      <ContextMenuOption click={() => callThenClose(toStadium)} text="To Stadium" shortcut="g" disabled={$spectating} />
   {/if}

   {#if pile !== deck}
      <ContextMenuOption click={() => moveTo(deck, { shuffle: true })} text="Shuffle Into Deck" shortcut="s" disabled={$spectating} />
      <ContextMenuOption click={() => moveTo(deck)} text="To Top of Deck" shortcut="t" disabled={$spectating} />
      <ContextMenuOption click={() => moveTo(deck, { bottom: true })} text="To Bottom of Deck" shortcut="m" disabled={$spectating} />
   {/if}

   {#if pile !== lz}
      <ContextMenuOption click={() => moveTo(lz)} text="To Lost Zone" shortcut="l" disabled={$spectating} />
   {/if}
   {#if pile !== prizes}
      <ContextMenuOption click={() => moveTo(prizes)} text="To Prizes" shortcut="p" disabled={$spectating} />
   {/if}
   {#if pile !== table}
      <ContextMenuOption click={() => moveTo(table)} text="To Table" shortcut="x" disabled={$spectating} />
   {/if}

   <ContextMenuOption click={() => attachEvolve()} text="Attach" shortcut="q" disabled={$spectating} />
   <ContextMenuOption click={() => attachEvolve(true)} text="Evolve" shortcut="e" disabled={$spectating} />

   {#if $selection.length === 1}
      {#if $deck.length && pile !== deck}
         <ContextMenuOption click={() => moveTo(deck, { switch: true })} text="Switch With Top of Deck" disabled={$spectating} />
      {/if}
      <!--
         Through showDetails rather than openDetails: this entry is how a face-down
         prize is looked at, and that look is what the log records. The heading does
         the same thing (see headingClick), and only when the face is already known.
      -->
      <ContextMenuOption click={showDetails} text="Show Details" />
   {/if}
</ContextMenu>