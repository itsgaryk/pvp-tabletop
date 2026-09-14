<script>
   import { getContext, onMount } from 'svelte'
   import { autoMulligan } from '$lib/stores/settings.js'
   import { share, publishLog, spectating } from '$lib/stores/connection.js'
   import { spectatorFlipped } from '$lib/stores/opponent.js'
   import { cog, flipBoard } from '$lib/icons/paths.js'
   import Icon from '$lib/components/Icon.svelte'
   import Settings from './dialogs/Settings.svelte'

   import {
      cards, deck, hand, prizes, draw,
      vstarUsed, gxUsed, pokemonHidden,
      reset as resetBoard,
      shareBoardstate
   } from '$lib/stores/player.js'

   const { showMessage } = getContext('boardActions')

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

   function startTurn () {
      turn++
      draw()
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

   /*
      Swap which player a spectator sees on which half of the screen. This is a
      local view change: it only re-points the two mirrors on screen, so neither
      player's own view is affected.
   */
   function flipSides () {
      spectatorFlipped.update((flipped) => !flipped)
   }

   let settings // DOM element binding
</script>

{#if !$spectating}
<!--
   A spectator gets no controls at all: every button here acts on the local
   board and many of them also write to chat. Leaving the empty column in place
   would push the board off centre, so only a player sees it.
-->
<div class="self-center flex flex-col gap-2 p-3 w-[170px]">
   <button class="action" disabled={!deckValid && $autoMulligan} on:click={setup} title="Shortcut: N">Setup</button>
   <button class="action" on:click={reset}>Reset</button>

   <div class="flex flex-col rounded-lg border border-gray-400">
      <button on:click={() => startTurn()} class="p-2 rounded-t-lg" title="Shortcut: C" >Turn <span class="font-bold">{turn}</span></button>
      <button on:click={() => vstarUsed.set(!$vstarUsed)} class="toggle p-2" class:on={$vstarUsed}>VSTAR Power</button>
      <button on:click={() => gxUsed.set(!$gxUsed)} class="toggle p-2 rounded-b-lg" class:on={$gxUsed}>GX Attack</button>
   </div>

   <button class="action" on:click={flipCoin} title="Shortcut: F">Flip Coin</button>
   <button class="action" on:click={switchVisibility} title="Shortcut: Z">{$pokemonHidden ? 'Show' : 'Hide'} Pokémon</button>
</div>
{/if}

<!-- settings, and for a spectator the board flip, sit in the corner of the window -->
<div class="fixed top-3 right-3 z-20 flex items-center gap-2">
   <button
      class="rounded-md bg-[var(--bg-color-two)] p-1 shadow"
      title="Settings"
      aria-label="Settings"
      on:click|stopPropagation={() => settings.open()}
   >
      <Icon path={cog} />
   </button>

   {#if $spectating}
      <button
         class="rounded-md bg-[var(--bg-color-two)] p-1 shadow"
         title="Flip Board - switch which player is on which half"
         aria-label="Flip Board"
         aria-pressed={$spectatorFlipped}
         on:click|stopPropagation={flipSides}
      >
         <Icon path={flipBoard} />
      </button>
   {/if}
</div>

<Settings bind:this={settings} />

<style>
   button.action {
      @apply font-bold text-white bg-[var(--primary-color)] px-3 py-1 rounded-lg;
   }

   button.action:disabled {
      @apply font-normal cursor-default border-gray-500 text-gray-600 bg-gray-100;
   }

   button.toggle.on {
      background-color: rgba(254, 240, 138, 0.6);
   }
</style>