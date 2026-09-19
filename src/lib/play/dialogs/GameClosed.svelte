<script>
   /*
      A room that ended while somebody was still in it.

      Several things close a room on purpose, and each is worth different words:
      a player who left, a player who vanished and did not come back, a room
      whose second player never arrived, a table nobody answered for, or a
      deployment that replaced the code the game was being played on. The relay
      says which, in the reason it left behind, so the wording here is a label on
      its answer rather than a second opinion about what happened.

      Either way everyone else still in it is told, and this is what they see:
      the game is closed, and they are back at the main menu behind it, so the
      only thing to do is acknowledge that.

      Centred, over the board, with nothing else to click: the board behind it is
      already empty, so the dialog is not hiding a decision - the OK button is
      the whole of it.
   */
   import { gameClosedReason, dismissGameClosed } from '$lib/stores/connection.js'

   /*
      What each reason reads as. An unknown one still says the game is closed,
      because that is the part that is certainly true.
   */
   const MESSAGES = {
      playerLeft: 'Room closed: player left the room',
      opponentTimeout: 'Room closed: opponent did not join',
      rejoinTimeout: 'Room closed: player did not rejoin',
      allPlayersLeft: 'Room closed: all players left the room',
      idle: 'Room closed: nobody answered the idle prompt',
      restart: 'Room closed: the game server was updated'
   }
   $: message = MESSAGES[$gameClosedReason] || 'Game closed. Returned to the main menu'
</script>

{#if $gameClosedReason}
   <div class="closed-backdrop">
      <div class="closed-dialog" role="alertdialog" aria-modal="true" aria-labelledby="game-closed-text">
         <p id="game-closed-text">{message}</p>
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
