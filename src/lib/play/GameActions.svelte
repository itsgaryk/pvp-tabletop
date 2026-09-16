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
   import { spectatorOpponents, spectatorFlipped, defaultOpponent } from '$lib/stores/opponent.js'
   import { solo } from '$lib/stores/solo.js'
   import GameTimer from './GameTimer.svelte'

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

   /*
      Solo only: the same setup for the half that is normally the opponent's.
      There is no relay to do it through, so it is done to that board directly.
   */
   function draw7andPutPrizesOpponent () {
      const opp = defaultOpponent
      opp.reset()

      opp.deck.shuffle()
      for (let i = 0; i < 7; i++) {
         const card = opp.deck.pop()
         if (card) opp.hand.push(card)
      }

      for (let i = 0; i < 6; i++) {
         const card = opp.deck.pop()
         if (card) opp.prizes.push(card)
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

      /* both sides are yours in solo, so both get set up */
      if ($solo) draw7andPutPrizesOpponent()

      setTurn(0)

      publishLog('Setup' + ($autoMulligan ? ` - ${mulligans} Mulligans` : ''))
      shareBoardstate()

      /*
         Setting up hides your Pokemon: a fresh board is not meant to be read over
         your shoulder, and the button says so by glowing for a moment - it is the
         one thing that changed that the log line does not mention. Solo is
         playing both sides yourself, so there is nobody to hide them from.
      */
      if (!$solo) {
         setVisibility(true)
         glowHideButton()
      }
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
      setVisibility(!pokemonHidden.get())
   }

   /* hiding and showing, as a state rather than a toggle */
   function setVisibility (hidden) {
      pokemonHidden.set(hidden)
      share('pokemonToggle', { hidden })
   }

   /* the Hide Pokemon button says so for a moment when Setup does it for you */
   let hideGlow = false
   let glowTimer

   function glowHideButton () {
      hideGlow = true
      clearTimeout(glowTimer)
      glowTimer = setTimeout(() => { hideGlow = false }, 2500)
   }

   /* Keyboard shortcuts */

   /*
      A shortcut must not fire while somebody is typing, or Enter in the chat box
      would end the turn, and not while a button has focus, or Enter would do both
      what the button does and what the shortcut does.
   */
   function isTyping (target) {
      if (!target || !target.tagName) return false
      const tag = target.tagName.toLowerCase()
      return tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button' || target.isContentEditable
   }

   function keydown (e) {
      /* a spectator only watches - none of these shortcuts apply */
      if ($spectating) return
      if (isTyping(e.target)) return

      const key = e.key.toLowerCase()

      if (key === 'enter') {
         e.preventDefault()
         endTurn()
      }
      else if (key === 'n') {
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
      <button on:click={endTurn} title="End your turn (Shortcut: Enter): logs it, moves the turn on, and clears your Ability Used stripes">End Turn</button>
      <!-- hiding Pokemon is about what the other player can see; solo has no other player -->
      {#if !$solo}
         <button class="glowable" class:glow={hideGlow} on:click={switchVisibility} title="Shortcut: Z">{$pokemonHidden ? 'Show' : 'Hide'} Pokémon</button>
      {/if}
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

<!--
   The table's clock, under the turn, and only in a room. Not in solo: a clock
   against yourself is not a clock.
-->
{#if !$solo}
   <GameTimer />
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

   /* Setup hides the board for you, and the button shows which one did it */
   .game-actions button.glow {
      animation: hide-glow 1s ease-in-out 2;
   }

   @keyframes hide-glow {
      0%, 100% { box-shadow: 0 0 0 rgba(250, 204, 21, 0); }
      50% { box-shadow: 0 0 14px 3px rgba(250, 204, 21, 0.9); }
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
