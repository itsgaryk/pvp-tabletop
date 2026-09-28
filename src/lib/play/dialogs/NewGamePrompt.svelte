<script>
   /*
      The two halves of "start a new game", which are not the same question.

      One player picks **New Game** in the settings menu. That click is *their* consent -
      they are the one who asked for it - so they are not asked again: they are told that
      the table is waiting on the other player, and the prompt has no button for them
      because there is nothing left for them to answer.

      The **other** player gets the question: a centred Yes/No, which is the only answer
      in the handshake. *Yes* starts the game again; *No* ends it, changes nothing, and
      tells the player who asked, on their own screen, what the answer was.

      So the dialog takes the screen while it is up: for the player being asked it is a
      decision about a game that is still in progress, and for the one who asked it is
      the wait for that decision. It is deliberately not dismissable by clicking beside it
      or pressing Escape - neither of those is a Yes or a No, and a prompt that can be
      waved away leaves the asker waiting on an answer that is never coming.
   */
   import { newGame, myNewGameVote, voteNewGame } from '$lib/stores/newGame.js'
   import { myId, spectating } from '$lib/stores/connection.js'

   $: ask = $newGame.request
   /* the asker is the one waiting; the other player is the one being asked */
   $: mine = Boolean(ask && ask.from && ask.from === $myId)
   $: asked = ask?.fromName || 'The other player'
   /* a spectator watches the handshake and answers none of it */
   $: watching = $spectating
</script>

{#if ask}
   <div class="new-game-backdrop">
      <div class="new-game-dialog" role="alertdialog" aria-modal="true" aria-labelledby="new-game-text">
         {#if mine}
            <p id="new-game-text" class="new-game-title">Waiting for opponent to accept new game</p>
            <p class="new-game-hint">
               {asked === 'The other player' ? 'The other player has' : `${asked} has`}
               been asked to start a new game. Nothing is cleared until they accept.
            </p>
         {:else if watching}
            <p id="new-game-text" class="new-game-title">Starting a new game?</p>
            <p class="new-game-hint">
               {asked} has asked to start a new game. The two players are deciding; nothing
               is cleared until they agree.
            </p>
         {:else}
            <p id="new-game-text" class="new-game-title">Start a new game?</p>
            <p class="new-game-hint">
               {asked} wants to start a new game. Both boards are cleared, you both edit your
               deck again, and the game log starts empty.
            </p>

            {#if $myNewGameVote === null}
               <div class="new-game-buttons">
                  <button class="new-game-yes" on:click|stopPropagation={() => voteNewGame(true)}>Yes</button>
                  <button class="new-game-no" on:click|stopPropagation={() => voteNewGame(false)}>No</button>
               </div>
            {:else}
               <p class="new-game-wait">Waiting for the game to start.</p>
            {/if}
         {/if}
      </div>
   </div>
{/if}

<style>
   /*
      z-index 56: over the board and every window the board can open, and under a closed
      room (60). It is above the idle prompt (55) on purpose: the idle prompt is a
      question anybody can answer, and a game that is being restarted is not idle.
   */
   .new-game-backdrop {
      position: fixed;
      inset: 0;
      z-index: 56;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.55);
   }

   .new-game-dialog {
      @apply flex flex-col items-center gap-3 p-6 rounded-lg text-center;
      min-width: min(22rem, 90vw);
      max-width: min(28rem, 90vw);
      background: var(--bg-color-two);
      color: var(--text-color);
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
   }

   .new-game-title {
      @apply text-lg font-bold;
   }

   .new-game-hint,
   .new-game-wait {
      @apply text-sm;
      color: var(--text-color-two);
   }

   .new-game-buttons {
      @apply flex gap-2 mt-1;
   }

   .new-game-yes {
      @apply px-6 py-2 font-bold text-white rounded-lg;
      background: var(--primary-color);
   }

   .new-game-no {
      @apply px-6 py-2 font-bold rounded-lg;
      background: var(--bg-color-zero);
      color: var(--text-color);
   }
</style>
