<script>
   /*
      The room's opening, on screen: the lock that holds the board until both players have a deck,
      the coin toss, and the choice it hands to one of them.

      ---------------------------------------------------------------------------
      It is a lock before it is a dialog
      ---------------------------------------------------------------------------
      A player sits down and imports a deck. Until **both** have one there is no game to play, so
      the board is covered from the moment a room has two players in it: the board, the cards, the
      chat and the panel beside them. Everything behind is out of reach, which is the point - the
      cards on the table are not anybody's until the game has begun.

      **This is the second of the two things that cover the board, and the order they come in is
      the whole of the layering.**

         the Import Deck window   `z-index: 45`. It is up first, it is where the deck comes from, and
                                  it says what it is for. **It is the thing that covers the board
                                  while this player has no deck**
         this dialog              `z-index: 46`. It comes up when the import window has gone

      A dialog at 46 drawn while that window is at 45 covers *it* - every one of its buttons and its
      textarea included - so a player who has not imported cannot import. That is what happened:
      reported from play as *"player is still unable to import the deck"*, with the import window
      visible underneath. So this does not draw until **this player's own deck has landed** (see
      `imported`), which is also the order the two were asked for: the import window first, and the
      setup message after it closes.

      **It is not a prompt and it is not a gate.** There is no button to press: the opening starts
      by itself the moment the second deck lands (see `startSetup` in the store, which the store
      calls for itself), so this says what the room is waiting for and goes when it has it.

      It then carries the two questions of the toss, so there is one element for the whole opening
      and which of its states is on screen is the phase:

         idle     this player has imported, the other has not. Nothing to press
         coin     the player the room picked calls Heads or Tails
         order    the coin has come up, and whoever called it right chooses first or second

      And it goes the moment the order is settled: both boards deal, and **both players are free
      again** - that is what the order being decided means.

      ---------------------------------------------------------------------------
      It cannot be dismissed, and that is deliberate
      ---------------------------------------------------------------------------
      Neither a click beside it nor `Escape` is a call or a choice. The Import Deck window is the one
      other thing shaped like this, and for the same reason: a window that could be waved away would
      leave the other player waiting on something that is never coming.

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
   import { cards } from '$lib/stores/player.js'
   import { solo } from '$lib/stores/solo.js'
   import RoomCode from '$lib/components/RoomCode.svelte'

   $: state = $gameSetup

   /*
      **Whether this board has a deck**, which is the one thing that decides whether the lock may
      cover the Import Deck window.

      It is watched here rather than read from the store's `decksReady`, and the two are different
      questions: `decksReady` is "both players have one", and this is "I have". The dialog needs its
      own half, because the window it must not cover belongs to this player. `$cards` is the same
      list the Import Deck window itself watches to decide that an import has landed - the card list
      a player imported *is* the deck - so the two cannot disagree about what importing means.

      It **latches**: a player who has imported keeps it, whatever happens to the list afterwards,
      which is the same reading the import window takes of the same store. Read as `$cards` rather
      than subscribed in `onMount`, for the reason every other `$:` in this file gives - and one
      more: `onMount` does not run on the server, so a component that latched there would draw
      nothing at all to `tools/render-check.mjs`, which is how the lock is checked.
   */
   let imported = false
   $: if ($cards.length) imported = true

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

      `waiting` is the board being held while a deck is missing - **this player's own deck**, and
      `imported` is what says so. That is not the same question as `decksReady`, which is about
      both boards, and the difference is the whole of this dialog's relationship with the Import
      Deck window:

         a deck missing here      the Import Deck window is up, at `z-index: 45`, covering the board
                                  and saying the same thing in its own words. This dialog stays
                                  **down**: it sits at 46, over that window, so drawing it here took
                                  the import buttons' clicks and left the player unable to import at
                                  all - reported from play, and the reason `open` asks `imported`
                                  rather than `decksReady`
         imported, waiting        the import window has closed on a successful import and the other
                                  player has not finished. *Now* this dialog is the thing covering
                                  the board, and it says what the room is waiting for
         both decks in            the opening starts by itself (see `startSetup` in the store)

      `tossing` covers the coin and the order. Both are decisions about the game rather than about a
      deck, and neither can be made while cards are being moved.

      It is **not** up for `deal` or `live`: the moment the order is settled the boards deal and
      both players are free again - that is the point of the order being decided.

      **`$room` is included, and that is load-bearing.** The phase is `idle` on a board that has
      never been anywhere, so a lock drawn on the phase alone covers the **main menu** - measured:
      *Setting up the game* over the logo and the Play Solo button, on a page with no table to lock.

      Every store is read here rather than asked of a call, for the reason the notes below give: a
      store read inside a function is invisible to the compiler.
   */
   $: calling = callsCoin(state.phase)
   $: ordering = choosesOrder(state.phase)
   $: importing = $gameSetup.phase === 'idle' && imported && !$decksReady
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

         <!--
            **The room's code, under whichever question this dialog is asking.**

            It is here because this is the lock: it is `position: fixed; inset: 0` at `z-index: 46`,
            so the copy button in the panel beside the board - the one place the code has always
            been - is behind it and cannot be clicked. Setting a game up is exactly when a player
            wants the code: their opponent has not arrived, or has, and the code is what gets them
            to the same table. Reported from play as *"during game setup the game room code cannot
            be copied"*.

            It draws nothing on the main menu or in solo, which is the component's own rule rather
            than a condition here (see components/RoomCode.svelte).
         -->
         <div class="setup-room">
            <RoomCode label="Room code" />
         </div>
      </div>
   </div>
{/if}

<style>
   /*
      z-index 46: over the board and everything it opens, and over the sidebar's own controls - this
      is a lock rather than a message, so nothing behind it may be reached.

      **And it is over the Import Deck window, which is at 45** - deliberately, and the reason this
      component does not draw until *this* player has a deck. Two things cover the board in a room
      and only one of them can be the one a player is answering; the import window is first because
      it is where the deck comes from, and this is second because it is about the other player. A
      lock drawn over a window a player still has to click is a window that cannot be clicked, which
      is what *"player is still unable to import the deck"* was. The other player's import window,
      if it opens after this one is up, is the one thing that would be behind it - and that is their
      own screen and the last thing either player needs to press, so it stays where it is.
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

   /*
      The room's code at the foot of the dialog, under a hairline. It is not part of the question
      above it - it belongs to the room rather than to this step of the opening - and the rule is
      what says so, rather than another sentence of prose at the one moment a player is being asked
      to decide something.
   */
   .setup-room {
      @apply w-full pt-2;
      border-top: 1px solid var(--bg-color-three);
   }
</style>
