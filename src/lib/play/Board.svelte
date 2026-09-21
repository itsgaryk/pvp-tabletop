<script>
   import { setContext, onMount } from 'svelte'
   import { dragging } from '$lib/dnd/pointer.js'
   import { source as dragSource } from '$lib/dnd/store.js'
   import { publishLog, spectating, seatedPlayers, myId } from '$lib/stores/connection.js'
   import { pick, shuffle, pokemonHidden, handRevealed } from '$lib/stores/player.js'
   import { holdingCtrlOrCmd } from '$lib/util/ctrlcmd.js'
   import { isTyping } from '$lib/util/typing.js'
   import { defaultOpponent, spectatorOpponents, spectatorFlipped, handRevealed as oppHandRevealed } from '$lib/stores/opponent.js'
   import { solo, onOpponentSelection, onOpponentHalf, soloSelectedTo } from '$lib/stores/solo.js'
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
   import PowerZone from './PowerZone.svelte'

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
   import DeckOrder from './dialogs/DeckOrder.svelte'
   import Selection from './dialogs/Selection.svelte'
   import SlotDetails from './dialogs/SlotDetails.svelte'
   import CardDetails from './dialogs/CardDetails.svelte'
   import Message from './dialogs/Message.svelte'
   import CardMenu from './dialogs/CardMenu.svelte'
   import SlotMenu from './dialogs/SlotMenu.svelte'

   import OppInspection from './dialogs/OppInspection.svelte'
   import OppSlotDetails from './dialogs/OppSlotDetails.svelte'
   import OppSlotMenu from './dialogs/OppSlotMenu.svelte'
   import OppCardMenu from './dialogs/OppCardMenu.svelte'

   import {
      hand, deck, discard, prizes, lz, table, stadium,
      draw,
      cardSelection, slotSelection, selectionPile, selectPile,
      moveSelection, toBench, toActive, toStadium,
      startAttachEvolve,
      resetSelection,
      powerMarker as myPowerMarker,
      powerMarkerUsed as myPowerMarkerUsed,
      togglePowerMarkerUsed,
      toggleAbilityUsed
   } from '$lib/stores/player.js'

   /*
      A spectator watches two players, so it needs a mirror per player: the top
      and bottom halves of this board show a different one. A player keeps the
      single default mirror (own board below, opponent above). The mirrors and
      their assignment live in the opponent store, and a spectator can swap the
      two halves for itself without telling anyone.
   */
   /*
      In solo both halves are the same person, so the flip swaps them: your own
      board moves to the top half and the mirror of the other side comes down.
      Same control, same store as a spectator's flip.
   */
   $: soloSwapped = $solo && $spectatorFlipped

   /*
      Whether the far half is drawn the right way up, and so whether the near half
      is turned over.

      A player sees the far half rotated - its cards face them across the table - so
      the two are opposites, and there are three states behind them: a player (flip,
      not upright), a spectator (upright: it is looking at a board rather than
      sitting at one), and solo (upright, for the same reason). Named once because
      the far half's nine zones each ask, and two of them had spelled the pair
      differently: a change to the rule is a change to all nine.
   */
   $: topUpright = $spectating || $solo
   $: topFlipped = !topUpright

   /*
      Whether the thing under the pointer belongs to the half played from the top of
      the screen - the opponent, in solo. The two shared cells (the table and the
      Stadium) are the only places it matters: each half plays into its own of the
      two, so the near one stands aside while one of the far half's cards is being
      carried and lets the drop reach the far one underneath.
   */
   $: farDrag = $solo && $dragging && onOpponentHalf($dragSource)


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
   $: topMarker = $spectating
      ? topStore.powerMarker
      : (soloSwapped ? myPowerMarker : defaultOpponent.powerMarker)
   $: bottomMarker = $spectating
      ? bottomStore.powerMarker
      : (soloSwapped ? defaultOpponent.powerMarker : myPowerMarker)
   $: topUsed = $spectating
      ? topStore.powerMarkerUsed
      : (soloSwapped ? myPowerMarkerUsed : defaultOpponent.powerMarkerUsed)
   $: bottomUsed = $spectating
      ? bottomStore.powerMarkerUsed
      : (soloSwapped ? defaultOpponent.powerMarkerUsed : myPowerMarkerUsed)
   /*
      The name of each player's Pokemon Power zone, written in the band of the
      Stadium's cell that is that player's own while Settings -> Board zones is
      on. Like Lost Zone, the break between the two words is written in rather
      than left to the width of the zone, so both halves read the same way.
   */
   const powerLabel = 'Pokemon\nPower'

   /*
      The name of each zone, to be written in the middle of it while the zone
      borders are turned on in Settings - they are a pair, a border to see where a
      zone begins and a name to say which one it is.

      One label per cell of the board's grid, which is why the table appears once:
      both players play into the same cell, so its two zones are drawn on top of
      one another and share the one name. Two cells are the exception, because
      each holds more than one zone per player and is labelled in its own markup
      instead: the active area (one zone per player, so a name per player), and
      the Stadium's cell (three bands, so a name per band - the two Pokemon Power
      zones and the Stadium between them).

      A name of more than one word is broken over its words (see .zone-label), so
      it reads as a small centred block rather than one long line across a zone.
      The names are the ones the game uses, which are not always the words the
      zone's own component goes by: the discard pile is a Discard, the prize cards
      are Prizes, and the active spot is an Active.
   */
   const zoneLabels = [
      { area: 'hand2', text: 'Hand' },
      { area: 'prizes2', text: 'Prizes' },
      { area: 'deck2', text: 'Deck' },
      { area: 'discard2', text: 'Discard' },
      { area: 'lz2', text: 'Lost\nZone' },
      { area: 'bench2', text: 'Bench' },
      { area: 'play', text: 'Table' },
      { area: 'prizes', text: 'Prizes' },
      { area: 'bench', text: 'Bench' },
      { area: 'lz', text: 'Lost\nZone' },
      { area: 'discard', text: 'Discard' },
      { area: 'deck', text: 'Deck' },
      { area: 'hand', text: 'Hand' }
   ]

   /* the active area holds one of these per player, so it is written twice */
   const activeLabel = 'Active'

   let inspectionModal
   let deckOrderModal
   let selectionModal
   let slotModal
   let detailsModal
   let messageAlert
   let cardMenu
   let slotMenu

   let oppInspectionModal
   let oppSlotModal
   let oppSlotMenu
   let oppCardMenu

   function openPile (pile) {
      inspectionModal.open(pile)
   }

   /*
      Looking through the deck in order to put cards back on top of it (or under
      it) in a chosen order: a search that ends with the player deciding what
      their next draw is (Ciphermaniac's Codebreaking). It is its own dialog
      rather than a mode of the inspection one, because that one only reads the
      deck and this one is a placement.

      `topX` opens it at the top X cards only, which is the same dialog over a
      shorter list and the same rearrangement with nothing shuffled - and with
      the deck itself as the default: placing cards from the whole deck on top of
      it is how a deck that has just been searched is put back in a chosen order.
   */
   function openDeckOrder (topX = 0) {
      deckOrderModal.open(topX)
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

   /*
      The far half's Pokemon. In solo that half is the player's own, so it gets the
      player's own menu: the same entries and wording, with a movement landing on
      that half because that is where the selection is (see SlotMenu). Online that
      Pokemon belongs to somebody else, so the menu is the one a player uses on the
      other side of the table - damage, status effects, a declared target.
   */
   function openOppSlotMenu (x, y, slot, active) {
      if ($solo) slotMenu.open(x, y)
      else oppSlotMenu.open(x, y, slot, active)
   }

   /* a single card on the far half, which is only reachable in solo */
   function openOppCardMenu (x, y, pile, card) {
      oppCardMenu.open(x, y, pile, card)
   }

   function startAE (evo = false) { // attach / evolve
      // close any open Deck or Discard pile, so that you can select the pokemon on board
      inspectionModal.close()

      startAttachEvolve(evo)
   }

   setContext('boardActions', {
      openPile, openOppPile,
      openDeckOrder,
      openSelection,
      openSlotDetails, openOppSlotDetails,
      openDetails, showMessage,
      openCardMenu, openSlotMenu, openOppSlotMenu, openOppCardMenu,
      startAE
   })

   /* Keyboard shortcuts */

   /*
      In solo the far half is yours too, so a selection can have been made over
      there. Both halves share one selection, so each key has to ask which board
      it is meant for: the same key that moves your own selection moves that
      half's own zones, and never carries a card across the table into yours.
   */
   const farSelected = () => $solo && onOpponentSelection()

   function keydown (e) {
      /*
         Somebody typing is not somebody playing. Every shortcut below is a bare
         key, and this listener is on the document, so without this guard a room
         code or the timer's minutes and seconds would be drawn, discarded and
         moved about as they were typed.
      */
      if (isTyping(e.target, e)) return

      const key = e.key.toLowerCase()

      const digit = parseInt(e.code.slice(-1)) // e.code contains the number key pressed, e.g. "Digit1", even if it has been turned into a different key by holding Option on Mac
      if (digit && Number.isInteger(digit)) e.altKey ? openSelection(deck, digit) : draw(digit)

      else if (key === 'd') farSelected() ? soloSelectedTo('discard') : moveSelection(discard)
      else if (key === 'h') farSelected() ? soloSelectedTo('hand') : moveSelection(hand)
      else if (key === 'l') farSelected() ? soloSelectedTo('lz') : moveSelection(lz)
      else if (key === 'p') farSelected() ? soloSelectedTo('prizes') : moveSelection(prizes)
      else if (key === 'b') farSelected() ? soloSelectedTo('bench') : toBench()
      else if (key === 'a' && !holdingCtrlOrCmd(e)) farSelected() ? soloSelectedTo('active') : toActive()
      else if (key === 'g') {
         if (farSelected()) soloSelectedTo('stadium')
         else if ($cardSelection.length) toStadium()
         /*
            With nothing selected, G says what is in play there - which is now up
            to two cards rather than the one, and was read off a store that has no
            `.val`, so this line had never said anything at all.
         */
         else if ($stadium.length) publishLog(`Stadium: ${$stadium.map((card) => card.name).join(', ')}`)
      }

      else if (key === 's') {
         if (farSelected()) soloSelectedTo('deck', { shuffle: true })
         else if ($cardSelection.length || $slotSelection.length) moveSelection(deck, { shuffle: true })
         else shuffle()
      }

      else if (key === 't') farSelected() ? soloSelectedTo('deck') : moveSelection(deck)
      else if (key === 'm') farSelected() ? soloSelectedTo('deck', { bottom: true }) : moveSelection(deck, { bottom: true })

      /*
         Space shows the selected card's details - the keyboard's version of
         clicking its name at the top of its menu. A selected Pokemon in play
         counts as a card here, since that is what its name refers to. With the
         details already up, space puts them away again.
      */
      else if (e.code === 'Space' || key === ' ') {
         if (detailsModal.opened()) {
            e.preventDefault()
            detailsModal.close()
            return
         }

         const card = $cardSelection.length === 1
            ? $cardSelection[0]
            : ($slotSelection.length === 1 ? $slotSelection[0].pokemon.get().at(-1) : null)

         if (card) {
            e.preventDefault()
            openDetails(card)
         }
      }

      else if (key === 'q') startAE(false)
      else if (key === 'e') startAE(true)

      /* u marks the selected Pokemon's ability as used (or takes that back) */
      else if (key === 'u') toggleAbilityUsed()

      /*
         View All is V, and only V. Ctrl+V is how a player pastes a room code or a
         message, and opening the deck on top of the paste is the one thing a
         paste must not do: a combination with the command modifier is the
         browser's and the clipboard's, not the board's.
      */
      else if (key === 'v' && !holdingCtrlOrCmd(e)) openPile(deck)
      else if (key === 'w') openPile(table)

      else if (key === 'w') moveSelection(table) // older version table shortcut without the extra functionality
      else if (key === 'x') {
         if (farSelected()) soloSelectedTo('table')
         else if ($cardSelection.length) moveSelection(table)
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
      <DeckOrder bind:this={deckOrderModal} />
      <Selection bind:this={selectionModal} />
      <SlotDetails bind:this={slotModal} />
      <CardDetails bind:this={detailsModal} />

      <OppInspection bind:this={oppInspectionModal} />
      <OppSlotDetails bind:this={oppSlotModal} />
      <OppSlotMenu bind:this={oppSlotMenu} />
      <OppCardMenu bind:this={oppCardMenu} />

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
         The VSTAR / GX marker each player shows lives in that player's Pokemon
         Power zone - the band of the Stadium's cell between their bench and the
         Stadium - so it is drawn there rather than here (see .stadium-area).
      -->

      <div class="gameboard min-h-0 relative flex-1" class:zone-borders={$zoneBorders}>

         <!--
            The zones' names, from Settings: they are drawn with the zone borders
            and only then, in the middle of each zone. A label is not a part of the
            board - a zone is what a card is dropped on and clicked in - so it
            takes no pointer events at all and cannot be selected, the way the
            outline itself cannot.

            They come first in the board, before the zones they name, and that is
            what puts them *under* the cards: whatever a zone draws comes after
            them, so a card in the middle of a zone covers the name of the zone
            rather than the other way round. A name is a caption on the board, not
            something to be read through the cards.

            They are placed by the name of the grid area they belong to, and each
            one is a direct child of the board rather than of the half it names:
            a label inside a rotated half would be drawn upside down. That is also
            what lets the table and the stadium have one label between two halves
            (see zoneLabels).
         -->
         {#if $zoneBorders}
            {#each zoneLabels as label (label.area)}
               <div class="zone-label" style:grid-area={label.area}>{label.text}</div>
            {/each}
         {/if}

          <!--
            A player sees this half rotated, which is what puts its bar under the
            hand, its counts above the bar, and the right spacing around both. A
            spectator sees both halves, so its copy of this half is laid out the
            same way and the cards are turned back up again ("upright").

            Solo reads both halves too, so this one is always laid out as a top
            half with its cards turned back up - the hand included, flipped or not.
            The hand's pile menu is portalled out of the rotated subtree (see
            ContextMenu.svelte), so turning the half does not turn the menu with it.
         -->
         <div class="hand2" class:flip={topFlipped} class:upright={topUpright}>
            {#if soloSwapped}<Hand />{:else}<OppHand store={topStore} />{/if}
         </div>

         <div class="prizes2" class:flip={topFlipped} class:upright={topUpright}>
            {#if soloSwapped}<Prizes />{:else}<OppPrizes store={topStore} />{/if}
         </div>

         <div class="deck2" class:flip={topFlipped} class:upright={topUpright}>
            {#if soloSwapped}<Deck />{:else}<OppDeck store={topStore} />{/if}
         </div>

         <div class="discard2" class:flip={topFlipped} class:upright={topUpright}>
            {#if soloSwapped}<Discard />{:else}<OppDiscard store={topStore} />{/if}
         </div>

         <div class="lz2" class:flip={topFlipped} class:upright={topUpright}>
            {#if soloSwapped}<LostZone />{:else}<OppLostZone store={topStore} />{/if}
         </div>

         <div class="bench2" class:flip={topFlipped} class:upright={topUpright}>
            {#if soloSwapped}<Bench />{:else}<OppBench store={topStore} />{/if}
         </div>

         <div class="play2" class:flip={topFlipped} class:upright={topUpright}>
            <OppTable store={topStore} />
         </div>

         <!--
            The two tables share the one grid cell, so the player's own is the one
            on top (see .play below) however the board is flipped: a card dropped
            in the middle lands on the table being played rather than on the other
            half's. While it is empty and nothing is being dragged it takes no
            pointer events, which is what lets a click reach the other half's table
            lying underneath it.

            In solo it also stands aside while a card of the far half's is being
            carried: the table is shared, but each half plays onto *its own* table
            in it, so the far half's cards belong on the far table underneath. The
            same class does it for the Stadium's cell, in the Stadium itself.
         -->
         <div class="play" class:empty={$solo && !$table.length && !$dragging} class:far-drag={farDrag}>
            {#if $spectating}
            <OppTable store={bottomStore} />
         {:else}
            <Table />
         {/if}
         </div>

         <!--
            The Stadium's cell, which is three bands rather than one: the far
            half's Pokemon Power zone, the Stadium both players play into, and the
            near half's Pokemon Power zone. The Power zones take half the cell
            between them - a quarter each, at the top and the bottom - so each
            player's VSTAR / GX marker sits between their own bench and the
            Stadium, and the Stadium keeps the middle half it always had.

            The two Stadiums still share the one band, the player's own on top
            (see .stadium): a card dropped in the middle lands on the table being
            played rather than on the other half's, and flipping the board must
            not take the player's own out of reach.
         -->
         <div class="stadium-area">
            <!--
               Three names for the one cell - one per band - and they come first,
               the way the board's own names come before the zones they name: a
               caption belongs on the empty part of a zone, and a card or a token
               in the middle of one covers its name rather than the other way
               round.
            -->
            {#if $zoneBorders}
               <div class="zone-label power-label power-label-top">{powerLabel}</div>
               <div class="zone-label power-label power-label-mid">Stadium</div>
               <div class="zone-label power-label power-label-bottom">{powerLabel}</div>
            {/if}

            <div class="power2">
               <PowerZone marker={$topMarker} used={$topUsed} opposite={!$spectating} />
            </div>

            <div class="stadium2" class:flip={topFlipped} class:upright={topUpright}>
               <OppStadium store={topStore} />
            </div>

            <div class="stadium">
               {#if $spectating}
               <OppStadium store={bottomStore} />
            {:else}
               <Stadium />
            {/if}
            </div>

            <div class="power">
               <PowerZone marker={$bottomMarker} used={$bottomUsed} mine={!$spectating} onToggle={togglePowerMarkerUsed} />
            </div>
         </div>

         <div class="active">
            <!--
               This cell is the one that holds two zones, so it carries two names:
               its own grid splits into the two players' active spots, and each
               label is centred in the row it names rather than in the cell. They
               come before the two zones, the way the board's own labels come
               before the board's: a name is under the Pokemon in the spot, not
               over it.
            -->
            {#if $zoneBorders}
               <div class="zone-label active-label active-label-top">{activeLabel}</div>
               <div class="zone-label active-label active-label-bottom">{activeLabel}</div>
            {/if}

            <div class="active2" class:flip={topFlipped} class:upright={topUpright}>
               {#if soloSwapped}<Active />{:else}<OppActive store={topStore} />{/if}
            </div>
            <div class="active1">
               {#if $spectating}
            <OppActive store={bottomStore} />
         {:else if soloSwapped}
            <OppActive store={topStore} />
         {:else}
            <Active />
         {/if}
            </div>
         </div>

         <div class="bench">
            {#if $spectating}
            <OppBench store={bottomStore} />
         {:else if soloSwapped}
            <OppBench store={topStore} />
         {:else}
            <Bench />
         {/if}
         </div>

         <!--
            The veil: the shading drawn over the Pokemon in play while Hide Pokemon
            is on. One rectangle per zone that holds Pokemon - the active area, and
            each half's bench - because those are the zones it is about.

            It is *not* a zone itself: each rectangle is placed by the area it
            covers rather than declared as one, so it is outside both the zone
            outlines and the zone names. It used to be a single rectangle across the
            middle of the board, which also shaded the Stadium's cell (and the
            Pokemon Power bands inside it) and the table - zones holding no Pokemon,
            and ones a player still has to read while their own are hidden.
         -->
         {#each ['active', 'bench2', 'bench'] as area (area)}
            <div class="veil" class:applied={$pokemonHidden} style="grid-area: {area}"></div>
         {/each}

         <div class="lz">
            {#if $spectating}
            <OppLostZone store={bottomStore} />
         {:else if soloSwapped}
            <OppLostZone store={topStore} />
         {:else}
            <LostZone />
         {/if}
         </div>

         <div class="discard">
            {#if $spectating}
            <OppDiscard store={bottomStore} />
         {:else if soloSwapped}
            <OppDiscard store={topStore} />
         {:else}
            <Discard />
         {/if}
         </div>

         <div class="deck">
            {#if $spectating}
            <OppDeck store={bottomStore} />
         {:else if soloSwapped}
            <OppDeck store={topStore} />
         {:else}
            <Deck />
         {/if}
         </div>

         <div class="prizes">
            {#if $spectating}
            <OppPrizes store={bottomStore} />
         {:else if soloSwapped}
            <OppPrizes store={topStore} />
         {:else}
            <Prizes />
         {/if}
         </div>

         <!--
            Never flipped, for a player or a spectator: this half holds either the
            player's own hand, whose pile context menu renders inside this div, or
            a spectator's mirror of the player on the bottom half. Rotating it
            turned the cards and the menu upside down.

            The "revealed" tint says whose hand this is showing, so a flipped solo
            board follows the hand that is down here now (the other half's) rather
            than the player's own, which has moved to the top.
         -->
         <div class="hand" class:revealed={!$spectating && (soloSwapped ? $oppHandRevealed : $handRevealed)}>
            {#if $spectating}
            <OppHand store={bottomStore} />
         {:else if soloSwapped}
            <OppHand store={topStore} />
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

   /*
      What `--card-width` is on the board: the size a card keeps where no zone has
      sized it. The table's stack is the one that matters - its cards are read by
      looking at them rather than by fitting, so they keep their own size - and it
      is also what the slot's pieces fall back to (see Slot.svelte).

      A card in a zone is not sized from here: it asks the zone it is in, through
      the `.zone-card` rule in global.css. It has to be a rule at the card rather
      than a value on the board, because `100cqw` and `100cqh` are whichever zone
      the *card* is in, and a custom property is inherited unresolved - so a
      `--card-width` given to the whole board would be resolved against every
      card's own zone, including the table's stack, which is not a zone-sized card.
   */
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
      The Stadium's cell is three bands, and the two Pokemon Power zones are the
      quarter of it above the Stadium and the quarter below.

      That is where the VSTAR / GX markers went. They used to be absolutely placed
      in the free space past the opponent's deck - a token floating on the board
      rather than a thing in a zone - and each player's now sits between their own
      bench and the Stadium, on their own side of the table. The two zones take
      half the cell between them and the Stadium keeps the middle half.

      The bands take no clicks of their own: a Power zone holds a token rather
      than a card, so the only thing in it that answers the pointer is a player's
      own mark (see PowerZone.svelte).
   */
   .stadium-area {
      grid-area: stadium;
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr) minmax(0, 2fr) minmax(0, 1fr);
      min-width: 0;
      min-height: 0;
   }

   .stadium-area > .power2,
   .stadium-area > .power {
      grid-column: 1;
      pointer-events: none;
   }

   .stadium-area > .power2 {
      grid-row: 1;
   }

   .stadium-area > .power {
      grid-row: 3;
   }

   /* the two Stadiums share the middle band, the player's own on top of it */
   .stadium-area > .stadium2,
   .stadium-area > .stadium {
      grid-row: 2;
      grid-column: 1;
   }

   /* each band's name is centred in its own band, not in the cell */
   .power-label {
      grid-column: 1;
   }

   .power-label-top {
      grid-row: 1;
   }

   .power-label-mid {
      grid-row: 2;
   }

   .power-label-bottom {
      grid-row: 3;
   }

   /*
      Optional zone outlines, from Settings: they draw where each area of the
      board begins and ends, for both players. The active area holds one zone per
      player, the Stadium's cell holds three bands, and the veil is only a shading
      over the whole board - so the cells are outlined for where they are, and the
      zones inside them for what they hold. Neither is a zone's name: a label sits
      inside a zone rather than being one.

      A solid line at half strength, so the outline reads as a line drawn on the
      board rather than as another dashed box competing with the cards.
   */
   .gameboard.zone-borders > :global(div:not(.veil):not(.zone-label)) {
      outline: 1px solid var(--zone-border-color);
      outline-offset: -1px;
   }

   .gameboard.zone-borders .active > :global(div:not(.zone-label)),
   .gameboard.zone-borders .stadium-area > :global(div:not(.zone-label)) {
      outline: 1px solid var(--zone-border-color);
      outline-offset: -1px;
   }

   /*
      The name of a zone, in the middle of it - drawn with the outlines above, so
      that a line says where a zone begins and a word says which zone it is.

      Half strength, with nothing behind it, and under the cards: the name is a
      caption for the zone rather than a thing on the board, so a card in the
      middle of the zone covers it. The half strength is the *colour's* rather
      than the element's on purpose - `opacity` would make the name a layer of its
      own, and it would then be drawn over the card in any zone whose own markup
      is not positioned, which the stadium's is not. pre-line is what puts the
      words of a two-word name on separate lines, and nothing here can be clicked,
      dragged or selected: the zone under it is what the board reacts to, and a
      label that swallowed a click would be a hole in the middle of every zone.
   */
   .zone-label {
      align-self: center;
      justify-self: center;
      color: var(--zone-label-color);
      font-size: 0.7rem;
      font-weight: 700;
      line-height: 1.15;
      text-align: center;
      white-space: pre-line;
      pointer-events: none;
      user-select: none;
   }

   /*
      The active area is the one cell holding a zone per player, so it holds a
      label per player as well - each centred in its own row of that cell rather
      than in the cell as a whole.
   */
   .active-label {
      grid-column: 1;
   }

   .active-label-top {
      grid-row: 1;
   }

   .active-label-bottom {
      grid-row: 2;
   }

   /*
      Three piles used to be nudged off the middle of their zones - the top
      player's discard up, and the bottom player's deck and lost zone down - to
      open up two gaps the rotated half leaves tighter than it reads, and to keep
      the bottom player's cards off the top player's prizes.

      There is nothing left to nudge. A card is centred in its zone now (see the
      note over `--card-ratio` in global.css), so a 30px shift is a card sitting
      30px below the middle of the zone it belongs to: the deck's card hung over
      the discard's row, and the discard's sat half out of its own. The zones are
      the spacing now, and the grid's own tracks are what the nudges were making up
      for.
   */

   /*
      minmax(0, …) keeps every zone exactly its share of the grid: `fr` on its own
      has an automatic minimum, so a zone with more in it - a full hand, a pile of
      prizes - grew its row and squeezed the others. With the floors at zero the
      zones land in the same place, at the same size, in either view and whatever
      is on the board.
   */
   .gameboard {
      display: grid;
      grid-template-columns:
         minmax(0, 0.8fr) minmax(0, 0.8fr) minmax(0, 1fr) minmax(0, 1.5fr)
         minmax(0, 1fr) minmax(0, 0.8fr) minmax(0, 0.8fr);
      grid-template-rows:
         minmax(0, 0.9fr) minmax(0, 1fr) minmax(0, 1fr)
         minmax(0, 1fr) minmax(0, 1fr) minmax(0, 0.9fr);
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

   /*
      Every zone is a size container, so a card in one can be sized by it: `100cqw`
      and `100cqh` are the zone's own width and height, and each zone's component
      asks for the lower of the two (see the note over `--card-ratio` in
      global.css).

      Two things a zone is not: a zone's *name*, which is sized by its own words,
      and the veil, which is a shading over several zones. A size container is also
      sized as if it had no contents, so either of those would collapse to nothing.

      Two cells hold more than one zone per player, so their zones are a level down
      and are the containers rather than the cell: the active area's two rows, and
      the three bands of the Stadium's cell. A size container also means its
      contents cannot change its size, which is what the grid's `minmax(0, …)`
      tracks are already there for.
   */
   .gameboard > div:not(.zone-label):not(.veil),
   .active > div:not(.zone-label),
   .stadium-area > div:not(.zone-label) {
      container-type: size;
   }

   /*
      A zone's component fills its zone. Not a zone's name, though, and that needs
      saying: the first of the active area's two names is the first child of that
      cell, so it was stretched to the whole zone - which put its words at the top
      of the zone rather than in the middle of it. A name is sized by its own
      words (see .zone-label).

      The Stadium's bands and the active area's rows need saying too: they are one
      level down from the cell a component is asked to fill, so the rule is not
      reached through them.
   */
   .gameboard > div > :global(div:first-child:not(.zone-label)) {
      @apply w-full h-full;
   }

   .prizes {
      grid-area: prizes;
   }

   .stadium {
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

   .active > div > :global(div:first-child:not(.zone-label)),
   .stadium-area > div > :global(div:first-child:not(.zone-label)) {
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
      /* the middle band of the Stadium's cell, which the two Stadiums share */
      grid-row: 2;
      grid-column: 1;
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
      The two tables share one grid cell and the player's own is the one on top, so
      while it is empty and nothing is being dragged it stands aside and lets
      clicks through to the other half's table underneath it (see the .play div).

      `pointer-events` is inherited, so standing aside here takes the whole table
      with it and the drop lands on the far half's - which is where a card of that
      half's belongs, and where the rule that a play clears the *other* player's
      Stadium is applied the right way round.
   */
   .play.empty,
   .play.far-drag {
      pointer-events: none;
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
   .upright :global(.marker),
   .flip :global(.ability-stripe),
   .upright :global(.ability-stripe) {
      transform: scale(-1, -1);
   }

   /*
      The veil takes no pointer events and is placed by the area it covers (see the
      markup): the active area, and each half's bench. Half strength over whatever
      is under it, and above the cards so that what is hidden is actually obscured.
   */
   .veil {
      pointer-events: none;
   }

   .veil.applied {
      background-color: rgba(50,50,50,0.3);
      z-index: 15;
   }

</style>