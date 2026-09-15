<script>
   import { onMount } from 'svelte'
   import { autoMulligan } from '$lib/stores/settings.js'
   import { share, publishLog, spectating } from '$lib/stores/connection.js'
   import { showMessage } from '$lib/stores/message.js'

   import {
      cards, deck, hand, prizes, draw,
      pokemonHidden,
      reset as resetBoard,
      shareBoardstate,
      clearAbilities,
      turn,
      setTurn
   } from '$lib/stores/player.js'
   import { spectatorOpponents, spectatorFlipped } from '$lib/stores/opponent.js'

   /*
      The turn number is the table's, so it is shown from the shared board: our own
      when playing, and the mirror of the player on the top half when watching.
      Both mirrors carry the same number, since whoever changes it tells everyone.
   */
   $: displayTurn = $spectating
      ? ($spectatorFlipped ? spectatorOpponents.bottom : spectatorOpponents.top).turn
      : turn

   /* Game Flow */

   function hasBasic (cards) {
      for (const card of cards) {
         if (card.stage === 'basic') return true
      }
      return false
   }

   $: deckValid = hasBasic($cards)

   function draw7andPutPrizes () {
      resetBoard()

      deck.shuffle()
      draw(7, true)

      for (let i = 0; i < 6; i++) {
         const card = deck.pop()
         if (card) prizes.push(card)
      }
   }

   function setupBoard () {

      if ($autoMulligan) {
         let mulligans = 0
         let hasBasic = false

         while (!hasBasic) {
            draw7andPutPrizes()

            for (const card of $hand) {
               if (card.stage === 'basic') hasBasic = true
            }

            if (!hasBasic) mulligans++
         }

         return mulligans
      }

      // else
      draw7andPutPrizes()
   }

   function setup () {
      if (!deckValid && $autoMulligan) return
      const mulligans = setupBoard()
      if ($autoMulligan) showMessage(`${mulligans} Mulligans`)

      setTurn(0)

      publishLog('Setup' + ($autoMulligan ? ` - ${mulligans} Mulligans` : ''))
      shareBoardstate()
   }

   function reset () {
      resetBoard()
      setTurn(0)

      share('boardReset')
      publishLog('Reset')
   }

   /* the turn counter only counts: drawing for the turn is the player's job */
   function startTurn () {
      setTurn($turn + 1)
   }

   /* the "-" end of the turn row; there is no turn before turn 0 */
   function previousTurn () {
      setTurn($turn - 1)
   }

   /*
      Ending a turn: it goes in the log, the counter moves on, and every Pokémon
      we have stops showing the Ability Used stripe. Clearing those is silent -
      the turn is the one line worth reading.
   */
   function endTurn () {
      publishLog('End Turn')
      startTurn()
      clearAbilities()
   }

   /* Misc. Actions */

   function flipCoin () {
      const heads = Math.floor(Math.random() * 2)
      showMessage('Coin flip result: ' + (heads ? 'HEADS' : 'TAILS'))
      publishLog('Coin flip: ' + (heads ? 'HEADS' : 'TAILS'))
   }

   function switchVisibility () {
      pokemonHidden.update(val => !val)
      share('pokemonToggle', { hidden: pokemonHidden.get() })
   }

   /* Keyboard shortcuts */

   function keydown (e) {
      /* a spectator only watches - none of these shortcuts apply */
      if ($spectating) return

      const key = e.key.toLowerCase()

      if (key === 'n') {
         if (window.confirm('Start new game?')) setup()
      }
      else if (key === 'c') startTurn()
      else if (key === 'f') flipCoin()
      else if (key === 'z') switchVisibility()
   }

   onMount(() => {
      document.addEventListener('keydown', keydown)
      return () => {
         document.removeEventListener('keydown', keydown)
      }
   })
</script>

{#if !$spectating}
   <!--
      The game actions sit under the chat, in the same style as the quick
      messages there, so the board gets the whole width of the window. A
      spectator only watches, so it gets none of them. End Turn counts as a game
      action: it says the turn is over, so it stays usable whatever the chat
      window is showing.
   -->
   <div class="game-actions">
      <button disabled={!deckValid && $autoMulligan} on:click={setup} title="Shortcut: N">Setup</button>
      <button on:click={reset}>Reset</button>
      <button on:click={flipCoin} title="Shortcut: F">Flip Coin</button>
      <button on:click={endTurn} title="End your turn: logs it, moves the turn on, and clears your Ability Used stripes">End Turn</button>
      <button on:click={switchVisibility} title="Shortcut: Z">{$pokemonHidden ? 'Show' : 'Hide'} Pokémon</button>
   </div>
{/if}

<!--
   The turn number is the table's, so a spectator sees it too. Only a player gets
   the ends of the row: a spectator cannot change it.
-->
<div class="turn-row">
   {#if !$spectating}
      <button class="end" on:click={previousTurn} title="One turn back" aria-label="One turn back">−</button>
   {/if}
   <span class="count">Turn <span class="font-bold">{$displayTurn}</span></span>
   {#if !$spectating}
      <button class="end" on:click={startTurn} title="Next turn (Shortcut: C)" aria-label="Next turn">+</button>
   {/if}
</div>

<style>
   .game-actions {
      @apply flex flex-wrap gap-1;
   }

   .game-actions button {
      @apply font-bold text-white bg-[var(--primary-color)] px-2 py-1.5 rounded-md flex-1 whitespace-nowrap;
   }

   .game-actions button:disabled {
      @apply opacity-50;
   }

   .turn-row {
      @apply flex gap-1 mt-1;
   }

   .turn-row .count {
      @apply flex-1 text-center font-bold py-1.5 text-white bg-[var(--primary-color)];
   }

   .turn-row .end {
      @apply w-10 text-lg font-bold leading-none text-white bg-[var(--primary-color)] rounded-md;
   }

   .turn-row .end:first-child {
      @apply rounded-l-md;
   }

   .turn-row .end:last-child {
      @apply rounded-r-md;
   }
</style>
