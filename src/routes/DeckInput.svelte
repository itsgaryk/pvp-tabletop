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
      opens this same window for whichever half was asked for.
   */
   import { fade } from 'svelte/transition'
   import { importDeck } from '$lib/stores/player.js'
   import { importOpponentDeck, solo } from '$lib/stores/solo.js'
   import { room } from '$lib/stores/connection.js'
   import { showMessage } from '$lib/stores/message.js'
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
      again - reopening it to import another deck is an ordinary, closable window.
   */
   let imported = false

   let isOpen = false
   /* a room opens the window itself; solo opens it from a button */
   $: if ($room && !$solo && !imported) isOpen = true
   $: required = Boolean($room) && !$solo && !imported

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

      /* an answer that is not an import's: there is no deck in it to speak of */
      if (!Array.isArray(res?.cards)) {
         response = res?.error || 'The deck API sent something that is not a deck.'
         return
      }

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

         <p class="import-response" role="alert">{response}</p>

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
{:else}
   <!--
      The button that asks for the window. In a room it reads *Import Deck*; solo has
      one per half, side by side, because both halves are the same person's.
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
      The box the list is pasted into: a plain textarea, because the API parses the
      decklist and this window deliberately knows nothing about its shape.
   */
   .import-text {
      @apply h-[38vh] p-2 rounded-md;
      border: 1px solid var(--bg-color-three);
      color: var(--text-color);
   }

   .import-response {
      @apply whitespace-pre;
      min-height: 1.5rem;
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
