<script>
   /*
      One player asking another for permission, and the three things a screen can be doing
      while that is in the air.

      The dialogue is the New Game prompt's, made to serve every ask: it is the same exchange
      - one player wants something of the other's, and it cannot happen until they agree - so
      it is one dialog whose words come from the kind (`KINDS` in stores/consent.js) rather
      than four prompts that look alike.

      Which of the three states this screen is in is decided by *who is looking*:

         the asker      they asked, so they are told the table is waiting and are given
                        nothing to press. Their click was their own consent
         the asker's
         opponent       the only Yes/No in the handshake
         a spectator    watches the handshake and answers none of it: the cards a reveal or a
                        look shows are the players', and a watcher is shown what the room was
                        shown rather than deciding it

      So the dialog takes the screen while it is up: for the player being asked it is a
      decision about somebody else's cards - or about a game still in progress - and for the
      one who asked it is the wait for that decision. It is deliberately not dismissable by
      clicking beside it or pressing Escape: neither of those is a Yes or a No, and a prompt
      that could be waved away would leave the asker waiting on an answer that is never
      coming.
   */
   import { consent, myConsentVote, answerConsent, KINDS } from '$lib/stores/consent.js'
   import { myId, spectating } from '$lib/stores/connection.js'

   $: ask = $consent
   /* the asker is the one waiting; the other player is the one being asked */
   $: mine = Boolean(ask && ask.from && ask.from === $myId)
   $: asked = ask?.fromName || 'The other player'
   /* a spectator watches the handshake and answers none of it */
   $: watching = $spectating
   /* what this kind says, and the name of the player who is asking it */
   $: kind = ask ? KINDS[ask.kind] : null
   $: question = kind ? kind.question : ''
   $: hint = kind ? kind.hint(asked) : ''

   /*
      The prompt is answerable by the player who was asked - **everybody in the room who is
      not the one asking** - and by nobody else: not the asker, who already said yes by
      asking, and not a spectator, whose business the cards are not.

      Every term here is a **store read**, and that is the whole of why it is written out
      rather than asked of `mayAnswerConsent()` in the store. A plain function call in a `$:`
      statement is evaluated once, when the panel is built - when there is no ask at all - so
      the answer was `false` for the rest of the page's life and **nobody was ever given a Yes
      or a No**: the question appeared on both screens with a "waiting for the answer" line
      under it and no way to answer it, on either side. Measured, and it is what the consent
      check found first.
   */
   $: answerable = Boolean(ask) && !mine && !watching && $myConsentVote === null
</script>

{#if ask && kind}
   <div class="consent-backdrop">
      <div class="consent-dialog" role="alertdialog" aria-modal="true" aria-labelledby="consent-text">
         <p id="consent-text" class="consent-title">{mine ? kind.waiting : question}</p>

         <p class="consent-hint">
            {#if mine}
               {asked === 'The other player' ? 'The other player has' : `${asked} has`}
               been asked. Nothing happens until they answer.
            {:else if watching}
               {asked} has asked. The two players are deciding, and nothing happens until they
               agree.
            {:else}
               {hint}
            {/if}
         </p>

         {#if answerable}
            <div class="consent-buttons">
               <button class="consent-yes" on:click|stopPropagation={() => answerConsent(true)}>Yes</button>
               <button class="consent-no" on:click|stopPropagation={() => answerConsent(false)}>No</button>
            </div>
         {:else if !mine && !watching}
            <p class="consent-wait">Waiting for the answer.</p>
         {/if}
      </div>
   </div>
{/if}

<style>
   /*
      z-index 56: over the board and every window the board can open, and under a closed room
      (60). It is above the idle prompt (55) on purpose: the idle prompt is a question
      anybody can answer, and a table in the middle of a handshake is not idle.
   */
   .consent-backdrop {
      position: fixed;
      inset: 0;
      z-index: 56;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.55);
   }

   .consent-dialog {
      @apply flex flex-col items-center gap-3 p-6 rounded-lg text-center;
      min-width: min(22rem, 90vw);
      max-width: min(28rem, 90vw);
      background: var(--bg-color-two);
      color: var(--text-color);
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
   }

   .consent-title {
      @apply text-lg font-bold;
   }

   .consent-hint,
   .consent-wait {
      @apply text-sm;
      color: var(--text-color-two);
   }

   .consent-buttons {
      @apply flex gap-2 mt-1;
   }

   .consent-yes {
      @apply px-6 py-2 font-bold text-white rounded-lg;
      background: var(--primary-color);
   }

   .consent-no {
      @apply px-6 py-2 font-bold rounded-lg;
      background: var(--bg-color-zero);
      color: var(--text-color);
   }
</style>
