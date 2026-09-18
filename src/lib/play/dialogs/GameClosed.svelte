<script>
   /*
      A room that ended while somebody was still in it.

      Two things close a room on purpose: a player leaving (the room is a game,
      and a game with nobody sitting in a playing seat is over) and an idle
      prompt nobody answered. Either way everyone else still in it is told, and
      this is what they see: the game is closed, and they are back in the lobby
      behind it, so the only thing to do is acknowledge that.

      Centred, over the board, with nothing else to click: the board behind it is
      already empty, so the dialog is not hiding a decision - the OK button is
      the whole of it.
   */
   import { gameClosed, dismissGameClosed } from '$lib/stores/connection.js'
</script>

{#if $gameClosed}
   <div class="closed-backdrop">
      <div class="closed-dialog" role="alertdialog" aria-modal="true" aria-labelledby="game-closed-text">
         <p id="game-closed-text">Game closed. Returned to lobby</p>
         <button class="closed-ok" on:click|stopPropagation={dismissGameClosed}>OK</button>
      </div>
   </div>
{/if}

<style>
   /*
      z-index 60: over every dialog the board can raise, because this one is
      about the room rather than about a card - whatever was open went with it.
   */
   .closed-backdrop {
      position: fixed;
      inset: 0;
      z-index: 60;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.55);
   }

   .closed-dialog {
      @apply flex flex-col items-center gap-4 p-6 rounded-lg text-center;
      min-width: min(20rem, 90vw);
      background: var(--bg-color-two);
      color: var(--text-color);
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
   }

   .closed-dialog p {
      @apply text-lg font-bold;
   }

   .closed-ok {
      @apply px-6 py-2 font-bold text-white rounded-lg;
      background: var(--primary-color);
   }
</style>
