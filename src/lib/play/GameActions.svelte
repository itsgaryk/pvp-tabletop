<script>
   import { onMount } from 'svelte'
   import { autoMulligan } from '$lib/stores/settings.js'
   import { share, publishLog, spectating } from '$lib/stores/connection.js'
   import { showMessage } from '$lib/stores/message.js'

   import {
      cards, deck, hand, prizes, draw,
      pokemonHidden,
      reset as resetBoard,
      shareBoardstate
   } from '$lib/stores/player.js'

   /* Game Flow */
   let turn = 0

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

      turn = 0

      publishLog('Setup' + ($autoMulligan ? ` - ${mulligans} Mulligans` : ''))
      shareBoardstate()
   }

   function reset () {
      resetBoard()
      turn = 0

      share('boardReset')
      publishLog('Reset')
   }

   /* the turn counter only counts: drawing for the turn is the player's job */
   function startTurn () {
      turn++
   }

   /* right-clicking takes a turn back, and there is no turn before the first */
   function previousTurn () {
      if (turn > 1) turn--
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
      spectator only watches, so it gets none of them.
   -->
   <div class="game-actions">
      <button disabled={!deckValid && $autoMulligan} on:click={setup} title="Shortcut: N">Setup</button>
      <button on:click={reset}>Reset</button>
      <button on:click={flipCoin} title="Shortcut: F">Flip Coin</button>
      <button on:click={switchVisibility} title="Shortcut: Z">{$pokemonHidden ? 'Show' : 'Hide'} Pokémon</button>
      <button
         on:click={startTurn}
         on:contextmenu|preventDefault={previousTurn}
         title="Shortcut: C — right-click to go back a turn">Turn <span class="font-bold">{turn}</span></button>
   </div>
{/if}

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
</style>
