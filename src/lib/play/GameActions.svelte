<script>
   import { onMount, onDestroy } from 'svelte'
   import { autoMulligan } from '$lib/stores/settings.js'
   import { share, publishLog, spectating, myId, seatedPlayers } from '$lib/stores/connection.js'
   import { showMessage } from '$lib/stores/message.js'
   import { isTyping } from '$lib/util/typing.js'

   /*
      The board half of the room's opening: `onDeal` is the deal this module knows how to make,
      `onStart` is what starting a game does to a board, and the two questions in between are
      the dialog's (`play/dialogs/GameSetupDialog.svelte`). What the flow itself is - the phases,
      the coin, who is ready - is `stores/gameSetup.js`, which owns none of this and asks for it by
      registering, so the import points one way.

      The ready list is read here rather than asked of the store's `isReady()`, and that is the rule
      this feature keeps having to relearn: see the note over `waiting` below.
   */
   import {
      gameSetup, myMulligans, ready,
      takeMulligan, redrawHand, onDeal, onRedraw, onStart, resetSetup, flipCoin
   } from '$lib/stores/gameSetup.js'

   /*
      `pokemonHidden` still has a reader here - `switchVisibility`, which is still on
      the `Z` key and still what a room's Setup calls - but no longer a button that
      names the state on screen: the Hide Pokemon button is out of the row, and the
      same action is a shortcut only (see the row's own comment).
   */
   import {
      cards, deck, hand, prizes, draw,
      pokemonHidden,
      reset as resetBoard,
      shareBoardstate,
      clearAbilities,
      turn,
      setTurn,
      setTimer
   } from '$lib/stores/player.js'
   import { onNewGameStart } from '$lib/stores/newGame.js'
   import { DEFAULT_TIMER_MS } from '$lib/stores/timer.js'
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

   /*
      **A `$:` is only as reactive as the stores the expression itself names.** Svelte decides a
      statement's dependencies from the identifiers in it, so a store read *inside a function the
      expression calls* is invisible: `disabled={!canStartSetup()}`, `class:glow={isReady()}` and
      `waiting = isReady()` named no store at all, and the compiler emitted each as a bare
      assignment **outside** the component's update function - answered once, at instance creation,
      and never again. Symptoms came from that one mistake, all reproduced on the running app:

         the button    a *Game Setup* button that was greyed out for the life of the page for the
                       player who joined second, so the setup could not be started from that board
         the gate      once enabled it never greyed again, so a pressable button silently did nothing
         the row       pressing *Ready* put the player in the room's ready list, `isReady()`
                       answered `true` when asked from the handler, and the button went on drawing
                       "Ready" with no tick, because the value it drew was frozen before `myId` had
                       even arrived

      What is left of that here is `waiting`, and it asks the list directly rather than through
      `isReady()`, because "have *I* pressed it" is a question about `$myId` as much as about the
      list.
   */
   $: waiting = Boolean($myId) && $gameSetup.ready.includes($myId)

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

   /*
      The deal, and everything a board does when its game is set up.

      It is one function because it is one motion - shuffle, seven cards, six prizes, turn
      back to zero - and it is reached two ways: solo's *Setup* button, and the room's
      `gameSetup` flow, which calls the same function through `onDeal` the moment both players
      have settled the turn order. The room does not go through the button at all, which is
      what makes the deal a consequence of the phase rather than of a click.

      **It publishes nothing.** The room's opening hand is not an event at the table, and the
      board it deals already says so; whether a *line* is written is the caller's business, and
      solo's button is the only caller that writes one. That also keeps the deal safe to run
      from a replayed phase, which a reloading board does.
   */
   function setup () {
      if (!deckValid && $autoMulligan) return 0
      const mulligans = setupBoard()
      if ($autoMulligan) showMessage(`${mulligans} Mulligans`)

      /* both sides are yours in solo, so both get set up */
      if ($solo) draw7andPutPrizesOpponent()

      setTurn(0)

      /*
         Setting up hides your Pokemon: a fresh board is not meant to be read over your
         shoulder, and it is the same action a player's own Z key takes rather than a copy of
         it. In solo the button that takes it back is on screen, so it glows: that is the one
         thing the log line does not mention, and the glow stays until the button is pressed.

         In a room nothing draws the glow - the room's row has no such button, because the veil
         is not this player's to lift: it comes off when *both* players have pressed Ready
         (see `onStart` below). The flag is still set and cleared with the button in solo only.

         Solo is playing both sides yourself, so there is nobody to hide them from and the call
         is skipped there entirely.

         Hidden before the board is shared, not after: whoever is watching us takes the state
         from either the event or the board state, and the board state has to agree with it.
      */
      if (!$solo) {
         setVisibility(true)
         hideGlow = true
      }

      shareBoardstate()

      return mulligans
   }

   /*
      Starting the game, on the board that just dealt.

      The four things a start is, and they are the flow's rather than the flow's board's - which
      is why they live here and are *registered* with `onStart`: the flow decides when a game
      has begun, and this decides what beginning does to this player's board.

         the veil      off. Both players are ready, so there is nothing left to keep from either
                       of them, and it is set as a state rather than toggled because the two
                       boards reach this at different moments and a toggle would hide the board
                       of whichever arrived second
         the clock     started, from the room's own default. Entering a room leaves it paused at
                       fifty minutes (see stores/timer.js), so a game that has begun is the one
                       thing that sets it running
         the turn      on by one, so the opening turn is turn 1 rather than the 0 a deal leaves
         the row       gone, because `phase` is `live` and the row only draws before that

      None of it is sent: the clock and the turn are shared values each board applies for itself
      (both are `setTimer` and `setTurn`, which publish), and the veil is a `pokemonToggle` like
      any other.
   */
   function startGame () {
      setVisibility(false)

      setTimer({ running: true, remaining: DEFAULT_TIMER_MS })

      /*
         **The opening turn is stated, not counted.** A game begins at turn 1, so this says so -
         and it is deliberately not `$turn + 1`.

         Two things are wrong with counting from wherever the counter happens to be. A deal leaves
         it at 0 (see `setup` below), so `+1` is *usually* right; but the two boards reach `live`
         independently and each applies the clock and the turn for itself, and a single extra
         entry into this function - the second player's `setupReady` arriving at a board that had
         already begun - advanced it again. Measured on two browsers: the game started, the log
         said so once, and the turn row read **Turn 2**. The guard that makes a start once per
         phase is above; this is the half that does not depend on it being airtight.

         Setting it in two steps is how the counter is *forced* rather than nudged: `setTurn`
         ignores a value it is already holding, so this resets to zero whatever the last game left
         behind - or a stray `+` press during the opening - and then states the opening turn. Both
         calls are shared like any other turn change, and the second is the one that reaches the
         other board.
      */
      setTurn(0)
      setTurn(1)
   }

   /* the flow asks for the deal, the redraw and the start; this module owns what they do */
   onDeal(() => setup())
   onRedraw(() => redraw())
   onStart(() => startGame())

   /*
      A game started again forgets the setup that came before it.

      *New Game* does not leave the room, so the flow is never told the table has moved on: its
      "this deal has happened" and "the game has started" guards would still be set, and the
      second game in a room would deal nothing and start nothing. `player.js` registers its own
      half of the restart with `onNewGameStart`, and this is the other half - the flow's.
   */
   onNewGameStart(() => resetSetup())

   /*
      The *Mulligan*'s redraw: the hand goes back into the deck, the deck is shuffled, and seven
      fresh cards come off the top. The prizes stay where they are, and the turn counter is not
      touched - **a mulligan is not a new game**, so it is deliberately not `setup()`, which
      would also put the turn back to zero and re-deal the prizes.

      It is silent and it publishes nothing on its own: the two lines the table reads are the
      flow's (`takeMulligan`), and the new hand reaches the opponent's mirror with the board
      state the deal after it shares. Nothing here goes in the log, because *Drew 7* is not what
      a mulligan is called.
   */
   function redraw () {
      for (const card of $hand) deck.push(card)

      hand.clear()
      deck.shuffle()
      draw(7, true)

      shareBoardstate()
   }

   /*
      The Mulligan button: a redraw, and the two lines that say what it was.

      The count and the hand are the flow's (see `takeMulligan`), and the redraw is this
      module's. The order is the one the two lines are read in: the count is written, the redraw
      runs, and then `$hand` is read for the cards it produced.
   */
   function mulligan () {
      takeMulligan(() => redrawHand(), () => $hand)
   }

   /*
      Solo's Setup button: the same deal, and the one caller that writes a line about it.

      The auto-mulligan's count belongs in that line and is not the manual button's count -
      it is what the deal had to do to find a Basic, not what the player chose - so it is
      taken from the deal's own answer rather than from the flow.
   */
   function setupSolo () {
      const drawn = setup()
      publishLog('Setup' + ($autoMulligan ? ` - ${drawn} Mulligans` : ''))
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

   /*
      The `F` key's coin, and the room's *Flip Coin* used to be this. The flip itself is the
      store's - one coin, so that a standalone flip and the one in a toss cannot disagree about
      what a coin is - and what is here is the two things a *player's* flip does with the answer:
      it is shown in the middle of the screen and written to the log.
   */
   function flip () {
      const result = flipCoin()
      showMessage('Coin flip result: ' + (result === 'heads' ? 'HEADS' : 'TAILS'))
      publishLog('Coin flip: ' + (result === 'heads' ? 'HEADS' : 'TAILS'))
   }

   function switchVisibility () {
      setVisibility(!pokemonHidden.get())
      /* the player has taken the action, so the button stops asking to be found */
      hideGlow = false
   }

   /* hiding and showing, as a state rather than a toggle */
   function setVisibility (hidden) {
      pokemonHidden.set(hidden)
      share('pokemonToggle', { hidden })
   }

   /*
      Solo's Setup hides the board for you, and its button says which one did it. It
      stays lit until the button is clicked rather than fading on a timer: the glow is
      the only thing that tells a player their own board is hidden, and a few seconds
      is not long enough to be sure it was seen. In a room the same flag is set and
      drawn nowhere - the row has no glowable button - so it is `Z` that clears it.
   */
   let hideGlow = false

   /* Keyboard shortcuts */

   function keydown (e) {
      /* a spectator only watches - none of these shortcuts apply */
      if ($spectating) return
      /*
         A shortcut must not fire while somebody is typing, or Enter in the chat
         box would end the turn, and not on the two keys that press a focused
         button, or Enter would do both what the button does and what the shortcut
         does. The rest of the keyboard still belongs to the player: the same guard
         is on the board's own shortcuts (see $lib/util/typing.js).
      */
      if (isTyping(e.target, e)) return

      const key = e.key.toLowerCase()

      if (key === 'enter') {
         e.preventDefault()
         endTurn()
      }
      else if (key === 'c') startTurn()
      else if (key === 'f') flip()
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
      **A room has no button to begin with.** There used to be one - *Game Setup*, on its own row
      above the turn, pressed by both players in turn - and the opening it started now starts
      itself: it waits on the two decks, which the room can see for itself, so a press asked the
      players to confirm something nothing was waiting on. The board is held by the opening dialog
      until both have imported, and it is that dialog which says so.

      What is left above the turn is the row the *game* uses: **Flip Coin** and **End Turn**, once
      the game is under way. The opening's own two controls - *Ready* and *Mulligan* - are not in
      this column at all; they are the prompt below.
   -->
   {#if !$solo && $gameSetup.phase === 'deal'}
      <!--
         **The opening hand is asked for in the middle of the window, not in the panel.**

         The two buttons are the pair that decides the hand the player is looking at, so they
         belong where the hand is rather than in a corner beside the board: *Ready* and *Mulligan*
         were the last row of the sidebar, at the opposite end of the screen from the seven cards
         they are about.

         **It is not a lock, and it must not become one.** Whether to keep a hand or shuffle it
         back is a question about the cards in front of the player, so the board stays readable and
         reachable while the prompt is up - the backdrop is transparent and takes no clicks, and
         only the card itself answers the pointer. Every other centred dialog in a room covers the
         window; this one is the one that must not.

         **It stays until both players have pressed Ready**, and that is exactly what the phase
         says: the flow moves to `live` when the second name joins the ready list (see `begin` in
         stores/gameSetup.js), and this draws on nothing else - so the press that starts the game
         is the same event that takes the prompt off both screens.

         The order of the two is the one the row had: *Ready* first, *Mulligan* beside it.
      -->
      <div class="setup-prompt">
         <div class="setup-card" role="dialog" aria-labelledby="opening-hand-title">
            <p class="setup-title" id="opening-hand-title">Your opening hand</p>
            <p class="setup-hint">
               {waiting
                  ? 'Ready - waiting for the other player.'
                  : 'Keep this hand and press Ready, or shuffle it back and draw a new one.'}
            </p>

            <div class="setup-row">
               <button
                  class="ready"
                  disabled={waiting}
                  title={waiting ? 'Waiting for the other player' : 'Ready to start the game'}
                  on:click={ready}
               >{waiting ? 'Ready ✓' : 'Ready'}</button>

               <!--
                  The mulligan, drawn with the count it is about to write: the button says how many
                  this player has taken rather than making them read the log to find out. Green,
                  because it is the one button here that is the player's own rather than the
                  table's, and the grey it had read as disabled.
               -->
               <button
                  class="mulligan"
                  title="Shuffle this hand back and draw a new one, keeping your prizes"
                  on:click={mulligan}
               >{$myMulligans > 0 ? `Mulligan (${$myMulligans})` : 'Mulligan'}</button>
            </div>
         </div>
      </div>
   {/if}

   <!--
      And the row the game itself runs on: **Flip Coin** and **End Turn**, the two actions a room
      has always had and had no button for at all while the opening was the only thing above the
      turn. They arrive with the game, in the place the log has been feeding all along, and during
      the opening they are on `F` and `Enter` alone - there is no turn to end and no reason to flip
      a coin while the opening hand is still being decided.
   -->
   {#if !$solo && $gameSetup.phase === 'live'}
      <div class="game-actions">
         <button on:click={flip} title="Shortcut: F">Flip Coin</button>
         <button on:click={endTurn} title="End your turn (Shortcut: Enter): logs it, moves the turn on, and clears your Ability Used stripes">End Turn</button>
      </div>
   {/if}

   <!--
      Solo keeps the row it had, and it is the only place it is left. Both halves
      are one person's, so there is no Hide Pokemon button - there is nobody to hide
      from - while Flip Coin and End Turn are the solo player's own controls, and the
      Setup button's glow is the one thing on screen that says the setup just hid the
      boards. A room hides Flip Coin and End Turn rather than removing them: they are
      still the game's, and still on `F` and `Enter` (see the shortcuts above).

      Solo's Setup writes its line, because its row is the solo player's own and the
      button is the only way in - the room's deal keeps quiet (see `setup`).
   -->
   {#if $solo}
      <div class="game-actions">
         <button class:glow={hideGlow} disabled={!deckValid && $autoMulligan} on:click={setupSolo}>Setup</button>
         <button on:click={flip} title="Shortcut: F">Flip Coin</button>
         <button on:click={endTurn} title="End your turn (Shortcut: Enter): logs it, moves the turn on, and clears your Ability Used stripes">End Turn</button>
      </div>
   {/if}
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
   /*
      The opening hand, centred in the window.

      `pointer-events: none` on the layer and `auto` on the card is the whole of "this is not a
      lock": the layer is the size of the window, so a click meant for a card, a pile or the chat
      passes through it, and only the two buttons and the card's own text take the pointer.

      `z-index: 47` puts it over the board and everything the board opens - cards are 9-15, a card
      being dragged 30, the settings cog 20, the clock's time-up banner 40 - and over the two windows
      the opening itself uses, the Import Deck window at 45 and the setup dialog at 46. It stays
      under the room's own dialogs: the timer prompt's 52, the idle prompt's 55, a consent prompt's
      56 and a closed room's 60. Those are about the room rather than about this hand, and they have
      to be readable over it.
   */
   .setup-prompt {
      position: fixed;
      inset: 0;
      z-index: 47;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
   }

   .setup-card {
      @apply flex flex-col items-center gap-3 p-6 rounded-lg text-center;
      pointer-events: auto;
      min-width: min(20rem, 90vw);
      max-width: min(26rem, 90vw);
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
      The pair itself: side by side and sharing the width of the card.

      **Ready carries a tick and no animation.** A press that sets a glowing button pulsing for as
      long as the other player takes is a light nobody can turn off, and what it was saying - *this
      one is done, and is waiting* - the tick says on its own.
   */
   .setup-row {
      @apply flex gap-1 w-full;
   }

   .setup-row button {
      @apply flex-1 font-bold px-2 py-1.5 rounded-md whitespace-nowrap;
   }

   /*
      The Mulligan is the green one and Ready is the blue one. Green is not decoration: the
      mulligan is the only button in this row that is *this player's own* - it buys another hand
      and changes nothing on the other board - and the grey it wore read as a disabled button
      sitting beside a live one.
   */
   .setup-row .mulligan {
      @apply text-white bg-green-600;
   }

   .setup-row .ready {
      @apply text-white bg-[var(--primary-color)];
   }

   /*
      A player who has pressed Ready keeps its colour rather than dimming: `disabled` is what the
      second press would do, not what the button is saying, and the tick beside the word is the
      whole of the feedback. **There is no glow** - a press that sets a light pulsing for as long
      as the other player takes is a light nobody can turn off.
   */
   .setup-row .ready:disabled {
      @apply opacity-100;
   }

   /*
      The row the game itself runs on, **Flip Coin** and **End Turn**.

      `mt-1` is the spacing rule for the whole column under the log: this is the first row of
      buttons under the game log, and it is the same distance from the log as the turn row below it
      is from this one (`mt-1` there and on the clock). It had no margin of its own, so the log sat
      hard against it while everything under it was spaced - the gap a player reads as one stack
      was two different sizes.
   */
   .game-actions {
      @apply flex flex-wrap gap-1 mt-1;
   }

   .game-actions button {
      @apply font-bold text-white bg-[var(--primary-color)] px-2 py-1.5 rounded-md flex-1 whitespace-nowrap;
   }

   .game-actions button:disabled {
      @apply opacity-50;
   }

   /*
      Solo's Setup hides the boards for you, and its button shows which one did it. The pulse
      repeats rather than stopping after a couple of beats: it stays until the button is
      clicked, which for a player who is mid-turn may be a while. It is the only glow left in
      this component - the room's *Ready* had the same one and it is gone.
   */
   .game-actions button.glow {
      animation: hide-glow 1s ease-in-out infinite;
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
