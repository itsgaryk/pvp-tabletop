<script>
   /*
      The room's opening, on screen: the lock that holds the board until both players have a deck,
      the coin toss, and the choice it hands to one of them.

      ---------------------------------------------------------------------------
      It is a lock before it is a dialog
      ---------------------------------------------------------------------------
      A player sits down and imports a deck. Until **both** have one there is no game to play, so
      this is up from the moment a room has two players in it and it covers the whole window: the
      board, the cards, the chat and the panel beside them. Everything behind it is out of reach,
      which is the point - the cards on the table are not anybody's until the game has begun.

      **It is not a prompt and it is not a gate.** There is no button to press: the opening starts
      by itself the moment the second deck lands (see `startSetup` in the store, which the store
      calls for itself), so this says what the room is waiting for and goes when it has it. It is
      drawn *under* the Import Deck window, which is the one thing a player still needs while it is
      up.

      It then carries the two questions of the toss, so there is one element for the whole opening
      and which of its states is on screen is the phase:

         idle     a deck is still missing. Nothing to press; the game begins on its own
         coin     the player the room picked calls Heads or Tails
         order    the coin has come up, and whoever called it right chooses first or second

      And it goes the moment the order is settled: both boards deal, and **both players are free
      again** - that is what the order being decided means.

      ---------------------------------------------------------------------------
      It cannot be dismissed, and that is deliberate
      ---------------------------------------------------------------------------
      Neither a click beside it nor `Escape` is a call, a choice, or a deck imported. The Import
      Deck window is the one other thing shaped like this, and for the same reason: a window that
      could be waved away would leave the other player waiting on something that is never coming.

      ---------------------------------------------------------------------------
      Why every `$:` here names a store
      ---------------------------------------------------------------------------
      **Svelte 4 hoists a `$:` with no reactive dependency out of the component's update function
      and runs it once, at instance creation.** `calling = callsCoin()` named no store and no
      reactive variable - `callsCoin` reads `gameSetup.get()` and `myId.get()` *inside itself*,
      which the compiler cannot see - so it was compiled to a bare assignment and answered once.
      Measured on the running app: the dialog came up for the coin with `calling` stuck at its
      first value of `false`, so **neither player was ever offered Heads or Tails** and both were
      told the other one was calling.

      Passing `state.phase` in is what makes the dependency visible, and it is the rule for every
      expression below. `lock` and `blind` read `$gameSetup` and `$myId` directly for the same
      reason. See docs/gotchas.md.
   */
   import {
      gameSetup, callsCoin, choosesOrder, callCoin, chooseOrder, decksReady
   } from '$lib/stores/gameSetup.js'
   import { spectating, seatedPlayers, myId, room } from '$lib/stores/connection.js'
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
      The states, each with the store it is about named in the expression.

      `locked` is the board being held, and there are two reasons for it, which is why it is two
      terms rather than one:

         the import   a room with two players in it where **a deck is still missing**. The board is
                      covered until both have imported, and the dialog says so
         the toss     the coin and the order, once both decks are in. Both are decisions about the
                      game rather than about a deck, and neither can be made while cards are being
                      moved
      
      It is **not** up for `deal` or `live`: the moment the order is settled the boards deal and
      both players are free again - that is the point of the order being decided.

      **`$room` is included, and that is load-bearing.** The phase is `idle` on a board that has
      never been anywhere, so a lock drawn on the phase alone covers the **main menu** - measured:
      *Setting up the game* over the logo and the Play Solo button, on a page with no table to lock.

      `$decksReady` is read here rather than asked of a call, for the reason every `$:` in this file
      gives: a store read inside a function is invisible to the compiler.
   */
   $: calling = callsCoin(state.phase)
   $: ordering = choosesOrder(state.phase)
   $: importing = $gameSetup.phase === 'idle' && !$decksReady
   $: tossing = $gameSetup.phase === 'coin' || $gameSetup.phase === 'order'
   $: open = Boolean($room) && !$solo && !$spectating && $myId !== null && (importing || tossing)

   /* the face the coin came up, in the words the log used for it */
   $: face = state.result === 'heads' ? 'Heads' : 'Tails'
   $: call = state.call === 'heads' ? 'Heads' : 'Tails'
</script>

{#if open}
   <!--
      The backdrop is the lock. It covers the window, so a click meant for a card, a pile or the
      chat lands here and does nothing instead. The *Game Setup* button and *Leave Room* live in
      the panel beside the board, which this is over - and the panel is why the dialog is centred
      rather than sized to the board: the two controls a player still has are behind it on purpose,
      and the dialog is the only thing that answers the pointer.
   -->
   <div class="setup-backdrop" role="presentation">
      <div class="setup-dialog" role="alertdialog" aria-modal="true" aria-labelledby="setup-title">
         {#if importing}
            <!--
               The lock, while a deck is missing. **It is not a button prompt**: the game begins by
               itself the moment the second deck lands (see `startOpening` in the store), so this
               says what the room is waiting for and nothing else. The Import Deck window is over
               this dialog rather than under it, which is why the wording can point at it.
            -->
            <p id="setup-title" class="setup-title">Setting up the game</p>
            <p class="setup-hint">
               Both players need to import a deck before the game can begin
            </p>

         {:else if state.phase === 'coin'}
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
