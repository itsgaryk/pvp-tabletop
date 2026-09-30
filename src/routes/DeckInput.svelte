<script>
   /*
      Import Deck: the window a deck arrives through.

      A player pastes a decklist and it is posted verbatim to the Limitless TCG API -
      nothing is parsed here, and the cards that come back are the deck (see
      docs/mechanics.md). *Import Random Deck* asks the same API for a list the
      player has not written, behind a confirmation, because it is the one button
      here that replaces whatever is in the box.

      It is a window in the middle of the board rather than a panel beside it, and in
      a room it is the first thing a player meets: creating or joining opens it and
      leaves no way out until a deck has imported cleanly (see `required`). Solo
      keeps its two buttons - *Import Deck 1* and *Import Deck 2*, one per half - and
      opens this same window for whichever half was asked for. **A room has no such
      button**: the window is the app's to open there (joining, and again when a new
      game clears the board), so nothing sits in the corner of a room's board asking
      for it.
   */
   import { fade } from 'svelte/transition'
   import { importDeck } from '$lib/stores/player.js'
   import { importOpponentDeck, solo } from '$lib/stores/solo.js'
   import { room } from '$lib/stores/connection.js'
   import { showMessage } from '$lib/stores/message.js'
   import { newGameCount } from '$lib/stores/newGame.js'
   import RoomCode from '$lib/components/RoomCode.svelte'
   import Spinner from './Spinner.svelte'

   /*
      Which deck this window imports. In solo both halves are the same person, so the
      second window gives the opponent's half a deck of its own.
   */
   export let target = 'me'

   $: opponent = target === 'opponent'
   $: label = $solo ? (opponent ? 'Import Deck 2' : 'Import Deck 1') : 'Import Deck'
   $: importInto = opponent ? importOpponentDeck : importDeck

   /*
      Whether a deck has landed here since this board appeared.

      A room's window is unclosable until it has: the deck is what the table is for,
      and a window that could be dismissed would leave a player sitting at an empty
      board with nothing to import into. Once one has landed the window is theirs
      again and closes like any other - and a room asks for it a second time through
      its own handshake rather than through a button (see `seenNewGame` below).
   */
   let imported = false

   let isOpen = false
   /* a room opens the window itself; solo opens it from a button */
   $: if ($room && !$solo && !imported) isOpen = true
   $: required = Boolean($room) && !$solo && !imported

   /*
      And a new game opens it again, for both players at once.

      It does not need to be *asked for* here, because this window is where the next deck
      comes from and the new game has just cleared the old one off the board - a player
      left looking at an empty table with no window has to be told to press the button,
      which is a step the game can take for them. What decides that a new game started is
      the room's own handshake (see stores/newGame.js); this only watches the count it
      raises, which clears `imported` as well: the deck behind that flag has just been
      thrown away, so the window is required again rather than an ordinary one.
   */
   let seenNewGame = $newGameCount

   $: if ($newGameCount !== seenNewGame) {
      seenNewGame = $newGameCount
      imported = false
      isOpen = true
   }

   let txt = ''
   let response = ''
   let loading = false
   let loadingRandom = false
   let confirming = false

   /*
      What came back, and what to do about it.

      **The two imports are held to different rules, and deliberately so.**

      A list the player typed is checked: the API's own errors, and the one rule the
      app adds - sixty cards, which is the sum the Setup button's deck is built from.
      A list they did *not* type is not: there is nothing in a random deck for them to
      correct, so a check that refused one would leave them at a window with no way to
      satisfy it. A random deck closes the window as soon as cards have arrived, and
      the API's own words are worth showing only when none did.

      None of this is a gate on the *board* - the cards are loaded before this runs
      (see importDeck in player.js) - it is a gate on this window, which closes only
      on an import it has nothing to complain about.
   */
   function done (res, random) {
      loading = false
      loadingRandom = false

      /*
         `cards` and `errors` are arrays whatever the API sent, because
         util/fetch-web.js settles the shape before anything reads it - and that is
         the answer the random endpoint needed: it sends no `errors` key at all, so
         asking for `res.errors.length` on it threw, after the board had been given
         the deck and before the window was ever told, which is a deck on the board
         behind a window that would not close.
      */

      if (random) {
         if (!res.cards.length) {
            response = res.errors.join("\n") || 'The deck API sent no cards.'
            return
         }
         succeed()
         return
      }

      const count = res.cards.reduce((c, card) => c + card.count, 0)

      if (res.errors.length) {
         response = res.errors.join("\n")
         return
      }

      if (count !== 60) {
         response = 'Decklist is not 60 cards!'
         return
      }

      succeed()
   }

   function succeed () {
      response = ''
      confirming = false
      imported = true
      isOpen = false

      /*
         The one thing that says the window closed for the right reason. It lands in
         the middle of the board and fades on its own (see dialogs/Message.svelte).
      */
      showMessage('Deck successfully imported')
   }

   /*
      No answer came: the request ran out of time, or the API could not be reached.

      Nothing was loaded, so nothing on the board changes - the spinner stops, the
      reason is on screen, and the button is there to press again. Without this the
      window simply span for ever, and in a room, where it cannot be dismissed until a
      deck lands, a player had no way out of it at all (see util/fetch-web.js).
   */
   function failed (message) {
      loading = false
      loadingRandom = false
      response = message
   }

   function doImport () {
      response = ''
      loading = true
      importInto(txt, (res) => done(res, false), false, failed)
   }

   /* the random import asks first: the button replaces whatever is in the box */
   function askRandom () {
      response = ''
      confirming = true
   }

   function randomImport () {
      confirming = false
      response = ''
      loadingRandom = true
      importInto('', (res) => done(res, true), true, failed)
   }

   /* the one way out, and only once a deck is in - see `required` */
   function close () {
      if (required) return
      isOpen = false
      confirming = false
   }
</script>

{#if isOpen}
   <!--
      The board stands behind the window, dimmed, and a click on the backdrop is the
      close a player asks for by stepping outside it. In a room that has not imported
      yet there is no close at all: `required` refuses it, the backdrop included.
   -->
   <div class="import-backdrop" role="presentation" transition:fade={{ duration: 120 }} on:click={close}>
      <div
         class="import-window"
         role="dialog"
         aria-modal="true"
         aria-label={label}
         on:click|stopPropagation
      >
         {#if !required}
            <button class="import-close" on:click={close}>Close</button>
         {/if}

         <p class="import-title">{label}</p>

         <!--
            **The room's code, while the deck is being imported.**

            This window is `position: fixed; inset: 0` at `z-index: 45`, so it covers the panel
            beside the board - which is where the code and its copy button have always been. A room
            opens this window by itself and will not let it be dismissed until a deck lands, so
            without this there is a stretch of a game's setup in which the code cannot be copied at
            all. Reported from play: *"during game setup the game room code cannot be copied"*.

            It follows the title for the same reason: a player pasting a list and a player reading
            the code out to somebody are both looking at the top of this window.

            It draws nothing in solo, which is the component's own rule rather than a condition
            here (see components/RoomCode.svelte).
         -->
         <div class="import-room">
            <RoomCode label="Room code" />
         </div>

         <textarea
            class="import-text"
            placeholder="Paste a decklist here"
            spellcheck="false"
            bind:value={txt}
            on:keydown|stopPropagation
         ></textarea>

         <button class="import-go button-with-spinner" on:click={doImport}>
            Import Deck
            {#if loading}
               <Spinner />
            {/if}
         </button>

         <!--
            Directly below Import Deck, in the order the two are read in: the random
            one is the second way to fill the box, not a second panel.
         -->
         <button class="import-random button-with-spinner" on:click={askRandom}>
            Import Random Deck
            {#if loadingRandom}
               <Spinner />
            {/if}
         </button>

         <!--
            Only when there is something to say. An empty paragraph here is a gap
            between two buttons that is not the window's own: the confirmation below
            is one flex gap away from the button above it, and an element reserving
            room for a message that has not been written pushed it two gaps and a line
            further down than that.
         -->
         {#if response}
            <p class="import-response" role="alert">{response}</p>
         {/if}

         {#if confirming}
            <div
               class="import-confirm"
               role="alertdialog"
               aria-modal="true"
               aria-label="Import a random deck?"
               on:click|stopPropagation
            >
               <p>Import a random deck?</p>
               <div class="import-confirm-buttons">
                  <button class="import-ok" on:click={randomImport}>OK</button>
                  <button class="import-cancel" on:click={() => (confirming = false)}>Cancel</button>
               </div>
            </div>
         {/if}
      </div>
   </div>
{:else if $solo}
   <!--
      The button that asks for the window. It is solo's alone, one per half, side by
      side, because both halves are the same person's. A room draws none: its window is
      the app's to open (joining, and a new game clearing the board), so a button in
      the corner of the board would be a second way to ask for a window the room
      already knows when to put up.
   -->
   <button class="fixed z-14 top-0 left-0 bg-blue-500 !rounded-none !rounded-br-md !p-3" class:second={opponent} on:click={() => isOpen = true}>{label}</button>
{/if}

<style>
   button {
      @apply p-2 rounded-md text-white font-bold;
   }

   /* the second half's button sits beside the first */
   button.second {
      left: 7.5rem;
   }

   /*
      Above the board and every layer of it - a card being dragged is 30, the
      settings cog 20 - and below the room's own dialogs (the timer's 52, the idle
      prompt's 55, a closed room's 60): those are about the room rather than about
      this player's deck, and they have to be readable over it.
   */
   .import-backdrop {
      position: fixed;
      inset: 0;
      z-index: 45;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.55);
   }

   .import-window {
      @apply flex flex-col gap-3 p-4 rounded-lg;
      position: relative;
      width: min(42rem, 92vw);
      max-height: 90vh;
      overflow-y: auto;
      background: var(--bg-color-two);
      color: var(--text-color);
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
   }

   .import-close {
      @apply self-start px-3 py-1;
      background: var(--bg-color-three);
   }

   .import-title {
      @apply text-lg font-bold text-center;
   }

   /*
      The room's code, above a hairline that keeps it out of the way of the deck. The code belongs
      to the room rather than to this window, which is about a deck - and the rule is what says so,
      rather than another line of prose at the top of the window a player is pasting into.
   */
   .import-room {
      @apply w-full pb-2;
      border-bottom: 1px solid var(--bg-color-three);
   }

   /*
      The box the list is pasted into: a plain textarea, because the API parses the
      decklist and this window deliberately knows nothing about its shape.
   */
   .import-text {
      @apply h-[38vh] p-2 rounded-md;
      border: 1px solid var(--bg-color-three);
      color: var(--text-color);
   }

   /*
      The API's errors, or the reason nothing came back, in the space the window grows
      by when there is one. It reserves nothing when it is empty - it is not rendered
      at all then - because the room it would keep is a gap between the buttons that
      the window's own spacing does not have.
   */
   .import-response {
      @apply whitespace-pre;
      color: var(--text-color-two);
   }

   /*
      The random import's question: the one button here that throws away what the
      player has typed, so it asks with its own OK and Cancel rather than acting.
   */
   .import-confirm {
      @apply flex flex-col items-center gap-2 p-3 rounded-md;
      background: var(--bg-color-zero);
   }

   .import-confirm-buttons {
      @apply flex gap-2;
   }

   .import-ok {
      @apply px-6 py-2;
      background: var(--primary-color);
   }

   .import-cancel {
      @apply px-6 py-2;
      background: var(--bg-color-three);
   }

   .import-go {
      @apply w-full;
      background: var(--primary-color);
   }

   /*
      Both imports are the same size and shape, one above the other: they are two
      ways to fill the same board, and one of them being smaller would read as one
      of them mattering less.
   */
   .import-random {
      @apply w-full;
      background: var(--primary-color);
   }

   .button-with-spinner {
      @apply flex gap-4 justify-center items-center;
   }
</style>
