<script>
   import { setContext, onMount } from 'svelte'
   import { dragging } from '$lib/dnd/pointer.js'
   import { publishLog, spectating, seatedPlayers, myId } from '$lib/stores/connection.js'
   import { pick, shuffle, pokemonHidden, handRevealed } from '$lib/stores/player.js'
   import { holdingCtrlOrCmd } from '$lib/util/ctrlcmd.js'
   import { defaultOpponent, spectatorOpponents, spectatorFlipped } from '$lib/stores/opponent.js'
   import { playerName, zoneBorders } from '$lib/stores/settings.js'
   import { message } from '$lib/stores/message.js'

   import Hand from './board/Hand.svelte'
   import Deck from './board/Deck.svelte'
   import Prizes from './board/Prizes.svelte'
   import Discard from './board/Discard.svelte'
   import LostZone from './board/LostZone.svelte'
   import Bench from './board/Bench.svelte'
   import Active from './board/Active.svelte'
   import Stadium from './board/Stadium.svelte'
   import Table from './board/Temp.svelte'

   import DndCard from './DndCard.svelte'

   import OppHand from './opponent/Hand.svelte'
   import OppDeck from './opponent/Deck.svelte'
   import OppPrizes from './opponent/Prizes.svelte'
   import OppDiscard from './opponent/Discard.svelte'
   import OppLostZone from './opponent/LostZone.svelte'
   import OppBench from './opponent/Bench.svelte'
   import OppActive from './opponent/Active.svelte'
   import OppStadium from './opponent/Stadium.svelte'
   import OppTable from './opponent/Temp.svelte'

   import Inspection from './dialogs/Inspection.svelte'
   import Selection from './dialogs/Selection.svelte'
   import SlotDetails from './dialogs/SlotDetails.svelte'
   import CardDetails from './dialogs/CardDetails.svelte'
   import Message from './dialogs/Message.svelte'
   import CardMenu from './dialogs/CardMenu.svelte'
   import SlotMenu from './dialogs/SlotMenu.svelte'

   import OppInspection from './dialogs/OppInspection.svelte'
   import OppSlotDetails from './dialogs/OppSlotDetails.svelte'
   import OppSlotMenu from './dialogs/OppSlotMenu.svelte'

   import {
      hand, deck, discard, prizes, lz, table, stadium,
      draw,
      cardSelection, slotSelection, selectionPile, selectPile,
      moveSelection, toBench, toActive, toStadium,
      startAttachEvolve,
      resetSelection,
      powerMarker as myPowerMarker,
      powerMarkerUsed as myPowerMarkerUsed,
      togglePowerMarkerUsed
   } from '$lib/stores/player.js'

   /*
      A spectator watches two players, so it needs a mirror per player: the top
      and bottom halves of this board show a different one. A player keeps the
      single default mirror (own board below, opponent above). The mirrors and
      their assignment live in the opponent store, and a spectator can swap the
      two halves for itself without telling anyone.
   */
   $: topStore = $spectating
      ? ($spectatorFlipped ? spectatorOpponents.bottom : spectatorOpponents.top)
      : defaultOpponent
   $: bottomStore = $spectating
      ? ($spectatorFlipped ? spectatorOpponents.top : spectatorOpponents.bottom)
      : defaultOpponent

   /*
      Whose board is on which half, for the name labels. A spectator knows both
      seats from the relay (the first is the top half, unless it has flipped its
      board); a player knows their own name and takes the other seat as the
      opponent's.
   */
   $: seat = (index) => $seatedPlayers[index] || null
   $: topName = $spectating
      ? seat($spectatorFlipped ? 1 : 0)?.name
      : $seatedPlayers.find((player) => player.id !== $myId)?.name
   $: bottomName = $spectating
      ? seat($spectatorFlipped ? 0 : 1)?.name
      : $playerName

   /*
      The VSTAR / GX marker each half shows. A spectator takes both from the
      mirrors it is watching, so the only markers on its board are the players'
      own; a player shows their own on their half and the opponent's on the
      other. Either way the marker is the one belonging to the player on that
      half, so flipping a spectator's board carries it along.
   */
   $: topMarker = $spectating ? topStore.powerMarker : defaultOpponent.powerMarker
   $: bottomMarker = $spectating ? bottomStore.powerMarker : myPowerMarker
   $: topUsed = $spectating ? topStore.powerMarkerUsed : defaultOpponent.powerMarkerUsed
   $: bottomUsed = $spectating ? bottomStore.powerMarkerUsed : myPowerMarkerUsed
   $: markerImage = (marker) => marker === 'vstar' ? '/vstar.png' : '/gx.png'

   let inspectionModal
   let selectionModal
   let slotModal
   let detailsModal
   let messageAlert
   let cardMenu
   let slotMenu

   let oppInspectionModal
   let oppSlotModal
   let oppSlotMenu

   function openPile (pile) {
      inspectionModal.open(pile)
   }

   function openOppPile (pile) {
      oppInspectionModal.open(pile)
   }

   function openSelection (source, count, options = {}) {
      pick(source, count, options)
      selectionModal.open(!!options.bottom, source)
   }

   function openSlotDetails (slot) {
      slotModal.open(slot)
   }

   function openOppSlotDetails (slot) {
      oppSlotModal.open(slot)
   }

   function openDetails (card) {
      detailsModal.open(card)
   }

   function showMessage (message) {
      messageAlert.show(message)
   }

   /*
      Actions that live outside the board (the game buttons under the chat) show
      their messages through a store rather than the board's context.
   */
   message.subscribe((current) => {
      if (current) messageAlert?.show(current.text)
   })

   function openCardMenu (x, y, revealed = true) {
      cardMenu.open(x, y, selectionPile, revealed)
   }

   function openSlotMenu (x, y) {
      slotMenu.open(x, y)
   }

   function openOppSlotMenu (x, y, slot, active) {
      oppSlotMenu.open(x, y, slot, active)
   }

   function startAE (evo = false) { // attach / evolve
      // close any open Deck or Discard pile, so that you can select the pokemon on board
      inspectionModal.close()

      startAttachEvolve(evo)
   }

   setContext('boardActions', {
      openPile, openOppPile,
      openSelection,
      openSlotDetails, openOppSlotDetails,
      openDetails, showMessage,
      openCardMenu, openSlotMenu, openOppSlotMenu,
      startAE
   })

   /* Keyboard shortcuts */

   function keydown (e) {
      const key = e.key.toLowerCase()

      const digit = parseInt(e.code.slice(-1)) // e.code contains the number key pressed, e.g. "Digit1", even if it has been turned into a different key by holding Option on Mac
      if (digit && Number.isInteger(digit)) e.altKey ? openSelection(deck, digit) : draw(digit)

      else if (key === 'd') moveSelection(discard)
      else if (key === 'h') moveSelection(hand)
      else if (key === 'l') moveSelection(lz)
      else if (key === 'p') moveSelection(prizes)
      else if (key === 'b') toBench()
      else if (key === 'a' && !holdingCtrlOrCmd(e)) toActive()
      else if (key === 'g') {
         if ($cardSelection.length) toStadium()
         else if (stadium.val) publishLog(`Stadium: ${stadium.val.name}`)
      }

      else if (key === 's') {
         if ($cardSelection.length || $slotSelection.length) moveSelection(deck, { shuffle: true })
         else shuffle()
      }

      else if (key === 't') moveSelection(deck)
      else if (key === 'm') moveSelection(deck, { bottom: true })

      else if (key === 'q') startAE(false)
      else if (key === 'e') startAE(true)

      else if (key === 'v') openPile(deck)
      else if (key === 'w') openPile(table)

      else if (key === 'w') moveSelection(table) // older version table shortcut without the extra functionality
      else if (key === 'x') {
         if ($cardSelection.length) moveSelection(table)
         else if ($table.length) {
            selectPile(table)
            moveSelection(hand)
         }
      }

      else if (key === 'escape') {
         if (!$dragging) resetSelection() // allow to Esc close popup while dragging a selection from deck
      }
   }

   onMount(() => {
      document.addEventListener('keydown', keydown)
      document.addEventListener('click', resetSelection)

      return () => {
         document.removeEventListener('keydown', keydown)
         document.removeEventListener('click', resetSelection)
      }
   })

</script>

<DndCard />

<div class="h-screen overflow-y-auto flex-1" on:contextmenu|capture|preventDefault>
   <div class="game flex flex-col h-full max-w-[1920px] m-auto select-none relative">

      <CardMenu bind:this={cardMenu} selection={cardSelection} />
      <SlotMenu bind:this={slotMenu} selection={slotSelection} />

      <Inspection bind:this={inspectionModal} />
      <Selection bind:this={selectionModal} />
      <SlotDetails bind:this={slotModal} />
      <CardDetails bind:this={detailsModal} />

      <OppInspection bind:this={oppInspectionModal} />
      <OppSlotDetails bind:this={oppSlotModal} />
      <OppSlotMenu bind:this={oppSlotMenu} />

      <!--
         Whose board is on each half. The top player's label sits on the right,
         above their hand count, because a top half is read bottom-up: its bar
         and number are at the bottom of the hand row there.
      -->
      {#if topName}
         <div class="nameplate top-1 right-2">{topName}</div>
      {/if}
      {#if bottomName}
         <div class="nameplate bottom-1 left-2">{bottomName}</div>
      {/if}

      <!--
         The VSTAR / GX marker each player shows, in the free space past the
         opponent's deck on their own side: under the top player's deck for the
         bottom half, and the matching spot the other way up for the top half.
         A player's own marker can be clicked to mark the power as used, which
         dims it; the top half's marker faces the player sitting opposite, the way
         their cards do, and stays upright for a spectator who reads both halves.
      -->
      {#if $topMarker !== 'none'}
         <img
            class="power-marker marker-top"
            class:opposite={!$spectating}
            class:used={$topUsed}
            src={markerImage($topMarker)}
            alt={$topMarker === 'vstar' ? 'VSTAR' : 'GX'}>
      {/if}
      {#if $bottomMarker !== 'none'}
         <img
            class="power-marker marker-bottom"
            class:mine={!$spectating}
            class:used={$bottomUsed}
            src={markerImage($bottomMarker)}
            alt={$bottomMarker === 'vstar' ? 'VSTAR' : 'GX'}
            on:click|stopPropagation={togglePowerMarkerUsed}>
      {/if}

      <div class="gameboard min-h-0 relative flex-1" class:zone-borders={$zoneBorders}>

         <!--
            A player sees this half rotated, which is what puts its bar under the
            hand, its counts above the bar, and the right spacing around both. A
            spectator sees both halves, so its copy of this half is laid out the
            same way and the cards are turned back up again ("upright").
         -->
         <div class="hand2" class:flip={!$spectating} class:upright={$spectating}>
            <OppHand store={topStore} />
         </div>

         <div class="prizes2" class:flip={!$spectating} class:upright={$spectating}>
            <OppPrizes store={topStore} />
         </div>

         <div class="deck2" class:flip={!$spectating} class:upright={$spectating}>
            <OppDeck store={topStore} />
         </div>

         <div class="discard2" class:flip={!$spectating} class:upright={$spectating}>
            <OppDiscard store={topStore} />
         </div>

         <div class="lz2" class:flip={!$spectating} class:upright={$spectating}>
            <OppLostZone store={topStore} />
         </div>

         <div class="bench2" class:flip={!$spectating} class:upright={$spectating}>
            <OppBench store={topStore} />
         </div>

         <div class="play2" class:flip={!$spectating} class:upright={$spectating}>
            <OppTable store={topStore} />
         </div>

         <div class="play">
            {#if $spectating}
            <OppTable store={bottomStore} />
         {:else}
            <Table />
         {/if}
         </div>

         <div class="stadium2" class:flip={!$spectating} class:upright={$spectating}>
            <OppStadium store={topStore} />
         </div>

         <div class="stadium">
            {#if $spectating}
            <OppStadium store={bottomStore} />
         {:else}
            <Stadium />
         {/if}
         </div>

         <div class="active">
            <div class="active2" class:flip={!$spectating} class:upright={$spectating}>
               <OppActive store={topStore} />
            </div>
            <div class="active1">
               {#if $spectating}
            <OppActive store={bottomStore} />
         {:else}
            <Active />
         {/if}
            </div>
         </div>

         <div class="bench">
            {#if $spectating}
            <OppBench store={bottomStore} />
         {:else}
            <Bench />
         {/if}
         </div>

         <div class="veil" class:applied={$pokemonHidden}></div>

         <div class="lz" class:spectated={$spectating}>
            {#if $spectating}
            <OppLostZone store={bottomStore} />
         {:else}
            <LostZone />
         {/if}
         </div>

         <div class="discard">
            {#if $spectating}
            <OppDiscard store={bottomStore} />
         {:else}
            <Discard />
         {/if}
         </div>

         <div class="deck" class:spectated={$spectating}>
            {#if $spectating}
            <OppDeck store={bottomStore} />
         {:else}
            <Deck />
         {/if}
         </div>

         <div class="prizes">
            {#if $spectating}
            <OppPrizes store={bottomStore} />
         {:else}
            <Prizes />
         {/if}
         </div>

         <!--
            Never flipped, for a player or a spectator: this half holds either the
            player's own hand, whose pile context menu renders inside this div, or
            a spectator's mirror of the player on the bottom half. Rotating it
            turned the cards and the menu upside down.
         -->
         <div class="hand" class:revealed={$handRevealed && !$spectating}>
            {#if $spectating}
            <OppHand store={bottomStore} />
         {:else}
            <Hand />
         {/if}
         </div>
      </div>

      <Message bind:this={messageAlert} />

   </div>
</div>

<style>
   :global(.dragover) {
      background: rgba(187, 247, 208, 0.5);
   }

   :global(.dragged) {
      @apply opacity-50;
   }

   .game {
      --card-width: 105px;
      --card-height: 145px;
   }

   .game :global(img.card) {
      filter: drop-shadow(1px 1px 2px var(--shadow-color));
   }

   /* whose board is on this half; the top label hangs off the opponent's hand */
   .nameplate {
      position: absolute;
      z-index: 12;
      font-size: 0.75rem;
      font-weight: 700;
      color: var(--text-color-two);
      pointer-events: none;
   }

   /*
      The VSTAR / GX marker: one per player, sitting in the space just past the
      opponent's deck on that player's side of the board. It only exists while a
      player has one turned on in Settings.
   */
   .power-marker {
      position: absolute;
      z-index: 12;
      width: calc(var(--card-width) * var(--card-scale) * 1.15);
      pointer-events: none;
      filter: drop-shadow(0 0 6px var(--selection-color));
   }

   .marker-top {
      right: 16%;
      top: 41%;
   }

   .marker-bottom {
      left: 15%;
      top: 54%;
   }

   /* the top half's marker faces the player sitting opposite, so it is turned */
   .power-marker.opposite {
      transform: scale(-1, -1);
   }

   /* a player's own marker can be clicked: that marks the power as used */
   .power-marker.mine {
      pointer-events: auto;
      cursor: pointer;
   }

   /* used: dimmed by half, and no longer glowing */
   .power-marker.used {
      opacity: 0.5;
      filter: none;
   }

   /*
      Optional zone outlines, from Settings: they draw where each area of the
      board begins and ends, for both players. The active area holds one zone per
      player, and the veil is only a shading over the whole board, so neither is
      outlined as one.
   */
   .gameboard.zone-borders > :global(div:not(.veil)) {
      outline: 1px dashed var(--zone-border-color);
      outline-offset: -1px;
   }

   .gameboard.zone-borders .active > :global(div) {
      outline: 1px dashed var(--zone-border-color);
      outline-offset: -1px;
   }

   /*
      Two gaps that a player's rotated half leaves wider than a spectator's copy
      of the same board, so they are opened back up here. The whole pile moves,
      not just its card, so its count badge stays on the corner of the card.

      - the top player's discard sat against the hand's bar. That half is
        mirrored, so its nudge goes the other way round on screen.
      - the bottom player's deck and lost zone sat against the top player's
        prizes, which run down to the middle of the board.
   */
   .discard2.upright > :global(div) {
      translate: 0 -30px;
   }

   .deck.spectated > :global(div),
   .lz.spectated > :global(div) {
      translate: 0 30px;
   }

   .gameboard {
      display: grid;      grid-template-columns: 0.8fr 0.8fr 1fr 1.5fr 1fr 0.8fr 0.8fr;
      grid-template-rows: 0.9fr 1fr 1fr 1fr 1fr 0.9fr;
      grid-template-areas:
         "hand2 hand2 hand2 hand2 hand2 hand2 hand2"
         ". discard2 bench2 bench2 bench2 prizes2 prizes2"
         "lz2 deck2 stadium active play prizes2 prizes2"
         "prizes prizes stadium active play deck lz"
         "prizes prizes bench bench bench discard ."
         "hand hand hand hand hand hand hand";
      column-gap: var(--scaled-rem);
   }

   /* https://css-tricks.com/preventing-a-grid-blowout/ */
   .gameboard > div {
      min-width: 0;
   }

   .gameboard > div > :global(div:first-child) {
      @apply w-full h-full;
   }

   .prizes {
      grid-area: prizes;
   }

   .stadium {
      grid-area: stadium;
      z-index: 10; /* above opponent's stadium! */
      pointer-events: none; /* to click on opp stadium below - overwritten when own stadium is in play */
   }

   .active {
      grid-area: active;
      display: grid;
      grid-template-rows: 1fr 1fr;
      position: relative;
   }

   .active1 {
      grid-row: 2;
      grid-column: 1;
   }

   .active2 {
      grid-row: 1;
      grid-column: 1;
   }

   .active:before {
      content: ' ';
      display: block;
      position: absolute;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
      opacity: 0.5;
      background-image: url('/pokeball.svg');
      background-size: contain;
      background-repeat: no-repeat;
      background-position: center;
      pointer-events: none;
   }

   .active > div > :global(div:first-child) {
      @apply w-full h-full;
   }

   .bench {
      grid-area: bench;
   }

   .lz {
      grid-area: lz;
   }

   .deck {
      grid-area: deck;
   }

   .discard {
      grid-area: discard;
   }

   .hand {
      grid-area: hand;
      border-top: 2px solid var(--text-color);
   }

   .hand.revealed {
      background: rgba(254, 249, 195, 0.5);
   }

   .play {
      grid-area: play;
      z-index: 11; /* shares table space with opp */
   }

   .prizes2 {
      grid-area: prizes2;
   }

   .bench2 {
      grid-area: bench2;
   }

   .lz2 {
      grid-area: lz2;
   }

   .deck2 {
      grid-area: deck2;
   }

   .discard2 {
      grid-area: discard2;
   }

   .hand2 {
      grid-area: hand2;
      border-top: 2px solid var(--text-color);
   }

   .play2 {
      grid-area: play;
   }

   .stadium2 {
      grid-area: stadium;
   }

   .flip {
      transform: scale(-1, -1);
   }

   .flip :global(img.card) {
      filter: drop-shadow(-1px -1px 2px var(--shadow-color));
   }

   /*
      A spectator's top half is laid out exactly like a player's rotated one, so
      the hand bar, the counts and the spacing around them land where they do on
      the other half of the board - but the cards are turned back up, because a
      spectator reads both halves and the cards themselves must face nobody in
      particular.
   */
   .upright {
      transform: scale(-1, -1);
   }

   .upright :global(img.card) {
      transform: scale(-1, -1);
   }

   /*
      The opponent-side components are drawn for a half that is rotated (see
      .flip and .upright): their cards face the player sitting on that side of
      the table. Anything that has to stay readable by whoever is looking at that
      half - a pile's count, a damage counter, a status marker - is rotated back
      here, in the one place that knows the half is flipped.

      The bottom half is never rotated, so nothing is rotated back there.
   */
   .flip :global(.count),
   .upright :global(.count),
   .flip :global(.counter),
   .upright :global(.counter),
   .flip :global(.marker),
   .upright :global(.marker) {
      transform: scale(-1, -1);
   }

   .veil {
      pointer-events: none;
      grid-row-start: prizes;
      grid-row-end: bench;
      grid-column-start: stadium;
      grid-column-end: bench;
   }

   .veil.applied {
      background-color: rgba(50,50,50,0.3);
      z-index: 15;
   }

</style>