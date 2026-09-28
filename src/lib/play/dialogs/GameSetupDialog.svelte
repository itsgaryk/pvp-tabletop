<script>
   /*
      Deciding who goes first: the coin toss, and the choice it hands to one player.

      It is one dialog with two questions in it, because it is one exchange: the player the room
      picked calls Heads or Tails, the coin comes up, and whoever called it right says whether
      they want to go first or second. Which of the two is on screen is the phase, and who it is
      on screen *for* is which seat the player holds.

      It takes the screen while it is up, and that is the point rather than a side effect: a coin
      toss decided while one player is drawing cards is not a decision, and the two questions are
      each a commitment. So the backdrop covers the board *and* the panel beside it, the way the
      Import Deck window does, and the dialog's own buttons are the only thing that can be
      pressed. It cannot be dismissed by Escape or by clicking beside it: neither of those is a
      call or a choice, and a player who waved it away would leave the other one waiting on an
      answer that is never coming.

      While the *other* player is being asked, this board is told so rather than shown nothing -
      the table has stopped, and a board that went quiet with no explanation reads as a fault.
   */
   import {
      gameSetup, callsCoin, choosesOrder, callCoin, chooseOrder
   } from '$lib/stores/gameSetup.js'
   import { spectating, seatedPlayers, myId } from '$lib/stores/connection.js'
   import { solo } from '$lib/stores/solo.js'

   $: state = $gameSetup

   /*
      The other player, for the wording a player reads while they wait.

      It is resolved in a `$:` statement rather than by calling a function in the markup, and
      that is not a style choice: the seats arrive from the relay *after* the dialog's host is
      built, so a name read once at setup time would have been "The other player" for the rest
      of the page's life. The reply an answer-carrying gesture gives is read the same way, for
      the same reason (see ConsentPrompt.svelte).
   */
   $: other = $seatedPlayers.find((player) => player?.id !== $myId)?.name || 'The other player'

   /*
      The two questions, and who is being asked each of them.

      `mine` is the whole of what decides whether this player gets buttons: they are the one the
      room picked to call the coin, or the one who called it right. Everybody else - the other
      player, and every watcher - is told what is happening and given nothing to press.
   */
   $: calling = callsCoin()
   $: ordering = choosesOrder()
   $: open = !$solo && !$spectating && (state.phase === 'coin' || state.phase === 'order')

   /* the face the coin came up, in the words the log used for it */
   $: face = state.result === 'heads' ? 'Heads' : 'Tails'
   $: call = state.call === 'heads' ? 'Heads' : 'Tails'
</script>

{#if open}
   <!--
      The backdrop is the lock. It is a sibling of nothing in particular and it covers the window,
      so a click meant for a card, a pile or the chat lands here and does nothing instead.
   -->
   <div class="setup-backdrop" role="presentation">
      <div class="setup-dialog" role="alertdialog" aria-modal="true" aria-labelledby="setup-title">
         {#if state.phase === 'coin'}
            <!--
               The toss. The player who was picked is asked to call it; the other player is told
               that the call is being made, because the game has stopped until it is.
            -->
            <p id="setup-title" class="setup-title">Determining player order</p>

            {#if calling}
               <p class="setup-hint">Call the coin toss.</p>
               <div class="setup-buttons">
                  <button on:click|stopPropagation={() => callCoin('heads')}>Heads</button>
                  <button on:click|stopPropagation={() => callCoin('tails')}>Tails</button>
               </div>
            {:else}
               <p class="setup-hint">
                  {other} is calling the coin toss. The game starts once the order is decided.
               </p>
            {/if}

         {:else if !ordering}
            <!--
               The coin has come up and the winner is deciding. The call and its result are said
               here as well as in the log: this is the moment the table is waiting on, and a player
               watching a dialog with no words in it would not know which way the toss went.
            -->
            <p id="setup-title" class="setup-title">Determining player order</p>
            <p class="setup-hint">
               {#if state.you.chooser === 'you'}
                  You called {call}, and the coin came up {face}.
               {:else}
                  {other} called {call}, and the coin came up {face}.
               {/if}
            </p>
            <p class="setup-hint">
               {#if state.you.winner === 'you'}
                  You won the toss and are choosing.
               {:else}
                  {other} won the toss and is choosing.
               {/if}
            </p>

         {:else}
            <!--
               The choice itself: going first or second. The whole point of winning the toss is
               this, so it is the winner's alone and the button they press is what the log records.
            -->
            <p id="setup-title" class="setup-title">You won the toss</p>
            <p class="setup-hint">Would you like to go first or second?</p>
            <div class="setup-buttons">
               <button on:click|stopPropagation={() => chooseOrder('first')}>First</button>
               <button on:click|stopPropagation={() => chooseOrder('second')}>Second</button>
            </div>
         {/if}
      </div>
   </div>
{/if}

<style>
   /*
      z-index 46: over the board and everything it opens, and over the sidebar's own controls -
      this is a lock rather than a message, so nothing behind it may be reached. It sits under
      the Import Deck window (45 is *below* this one, and a deck window is not up at the same
      time as a toss anyway), and under the room's own dialogs.
   */
   .setup-backdrop {
      position: fixed;
      inset: 0;
      z-index: 46;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.55);
   }

   .setup-dialog {
      @apply flex flex-col items-center gap-3 p-6 rounded-lg text-center;
      min-width: min(22rem, 90vw);
      max-width: min(28rem, 90vw);
      background: var(--bg-color-two);
      color: var(--text-color);
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
   }

   .setup-title {
      @apply text-lg font-bold;
   }

   .setup-hint {
      @apply text-sm;
      color: var(--text-color-two);
   }

   /*
      All four answers are the same button, because the two questions are the same size: Heads
      and Tails are a call rather than a preference, and First and Second are both real choices
      in this game. Colouring one of a pair would say the game recommended it, and it does not.
   */
   .setup-buttons {
      @apply flex gap-2 mt-1;
   }

   .setup-buttons button {
      @apply px-6 py-2 font-bold text-white rounded-lg;
      background: var(--primary-color);
   }
</style>
