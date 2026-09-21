<script>
   import { getContext } from 'svelte'
   import ContextMenu from '$lib/components/ContextMenu.svelte'
   import ContextMenuOption from '$lib/components/ContextMenuOption.svelte'

   import {
      hand, discard, deck, prizes, lz, table,
      cardPile, moveSelection, toActive, toBench, toStadium
   } from '$lib/stores/player.js'
   import { logPrizeLook } from '$lib/stores/logger.js'
   import { spectating } from '$lib/stores/connection.js'

   const { openDetails, startAE } = getContext('boardActions')

   export let selection

   let pile
   let revealed
   let menu

   /*
      What to do once an entry has been taken, if the menu was opened from somewhere
      that wants to know.

      A pile's view is the caller: taking an entry from a card inside a view finishes
      the view, which the menu knows nothing about and should not. It is handed in
      rather than asked for here, because the same menu is opened on the board - a
      card right-clicked there finishes nothing - and because what "finish" means
      belongs to the panel (see `finishAction` in Inspection.svelte).
   */
   let onAction = null

   $: heading = $selection.length === 1 ? (revealed ? $selection[0].name : 'Hidden card') : `${$selection.length} cards`

   /* one card, and its face is known: the name is worth clicking */
   $: canShowDetails = $selection.length === 1 && revealed

   /*
      Whether every card picked up is already in one pile - which is when an entry
      that sends them *there* is an entry that would move nothing.

      It is asked of the cards rather than of `pile`, because one selection can
      hold cards from several zones of the player's own half: right-clicking the
      card in hand while a card on the table is picked up as well must still offer
      *To Hand*, since that is where the table's card would go. With one card
      picked up - the shape this menu is mostly used in - the two are the same
      question, because that card's pile is the pile the menu was opened from.
   */
   $: everyIn = (target) => $selection.length > 0 && $selection.every((card) => cardPile(card) === target)

   /*
      Showing a card is the one thing a player does that the other player cannot
      see, so a face-down prize card is the one card it is worth saying out loud:
      looking at it is information the opponent is entitled to know was taken, even
      though the card itself is not. The rule is in one place, because the double
      click, the space bar and the far half's own menu take the same look (see
      logPrizeLook).
   */
   function showDetails () {
      logPrizeLook(pile, revealed)
      openDetails($selection[0])
   }

   /*
      `onAction` is optional and comes last, so every existing caller reads the same
      as it did: a menu opened from the board or from a slot ends with `menu.close()`
      and nothing else.
   */
   export function open (x, y, _pile, _revealed, _onAction = null) {
      pile = _pile
      revealed = _revealed
      onAction = _onAction
      menu.open(x, y)
   }

   /*
      The end of an entry that *did* something - a card moved. The menu closes first,
      so that whatever is behind it is not looking at an open menu when it acts.

      Two kinds of entry are deliberately not this. *Show Details* opens another
      panel rather than acting, closes nothing, and leaves the card the player is
      reading selected. *Attach* and *Evolve* do not do the thing they say until the
      player has clicked a Pokemon (see `attachEvolve`), so they close the menu and
      nothing else.
   */
   function done () {
      menu.close()
      if (onAction) onAction()
   }

   function moveTo (targetPile, options = {}) {
      moveSelection(targetPile, options)
      done()
   }

   function callThenClose (action) {
      action()
      done()
   }

   function attachEvolve (evo = false) {
      startAE(evo)
      menu.close()
   }
</script>

<ContextMenu bind:this={menu} {heading} headingClick={canShowDetails ? showDetails : null}>
   {#if !everyIn(hand)}
      <ContextMenuOption click={() => moveTo(hand)} text="To Hand" shortcut="h" disabled={$spectating} />
   {/if}
   {#if !everyIn(discard)}
      <ContextMenuOption click={() => moveTo(discard)} text="To Discard" shortcut="d" disabled={$spectating} />
   {/if}

   <ContextMenuOption click={() => callThenClose(toBench)} text="To Bench" shortcut="b" disabled={$spectating} />
   {#if $selection.length === 1}
      <ContextMenuOption click={() => callThenClose(toActive)} text="To Active" shortcut="a" disabled={$spectating} />
      <ContextMenuOption click={() => callThenClose(toStadium)} text="To Stadium" shortcut="g" disabled={$spectating} />
   {/if}

   {#if !everyIn(deck)}
      <ContextMenuOption click={() => moveTo(deck, { shuffle: true })} text="Shuffle Into Deck" shortcut="s" disabled={$spectating} />
      <ContextMenuOption click={() => moveTo(deck)} text="To Top of Deck" shortcut="t" disabled={$spectating} />
      <ContextMenuOption click={() => moveTo(deck, { bottom: true })} text="To Bottom of Deck" shortcut="m" disabled={$spectating} />
   {/if}

   {#if !everyIn(lz)}
      <ContextMenuOption click={() => moveTo(lz)} text="To Lost Zone" shortcut="l" disabled={$spectating} />
   {/if}
   {#if !everyIn(prizes)}
      <ContextMenuOption click={() => moveTo(prizes)} text="To Prizes" shortcut="p" disabled={$spectating} />
   {/if}
   {#if !everyIn(table)}
      <ContextMenuOption click={() => moveTo(table)} text="To Table" shortcut="x" disabled={$spectating} />
   {/if}

   <ContextMenuOption click={() => attachEvolve()} text="Attach" shortcut="q" disabled={$spectating} />
   <ContextMenuOption click={() => attachEvolve(true)} text="Evolve" shortcut="e" disabled={$spectating} />

   {#if $selection.length === 1}
      {#if $deck.length && !everyIn(deck)}
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