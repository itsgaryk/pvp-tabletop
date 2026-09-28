<script>
   import { onMount } from 'svelte'
   import { spectating, room } from '$lib/stores/connection.js'
   import { solo } from '$lib/stores/solo.js'
   import Board from '$lib/play/Board.svelte'
   import Controls from '$lib/play/Controls.svelte'
   import IdlePrompt from '$lib/play/dialogs/IdlePrompt.svelte'
   import ConsentPrompt from '$lib/play/dialogs/ConsentPrompt.svelte'
   import GameSetupDialog from '$lib/play/dialogs/GameSetupDialog.svelte'
   import GameClosed from '$lib/play/dialogs/GameClosed.svelte'
   import NumberPrompt from '$lib/play/dialogs/NumberPrompt.svelte'
   import Connection from './Connection.svelte'
   import DeckInput from './DeckInput.svelte'
   import { devDebug } from '$lib/util/dev-debug.js'

   /* the board itself is static; only /api/relay/* needs a server */
   export const prerender = true

   /*
      The main menu is the logo and the buttons and nothing else - so while it is
      up the board stands aside rather than sharing the window with it. The menu
      and the board are never both interesting: there is no game to look at yet.
   */
   $: onMenu = !$room && !$solo

   /*
      The board is dark: there is no light mode to switch to.

      `data-hydrated` is set here, and it is here rather than in a check because there
      is no other way for anything outside the app to know that the client has taken
      over. A server-rendered page and a hydrated one look identical - the markup is the
      same string - so a browser check that waits for a *word* on the page is satisfied
      by the server's own output and sails on into a lobby that does nothing. That is
      exactly the shape of the harness faults `docs/gotchas.md` collects, and the mark
      costs one attribute: `document.documentElement.dataset.hydrated`.
   */
   onMount(() => {
      document.documentElement.classList.add('dark')
      document.documentElement.dataset.hydrated = 'true'
      devDebug()
   })
</script>

<svelte:head>
   <title>PvP Tabletop</title>
</svelte:head>

<!--
   The settings button, the board and the deck windows all stand aside for the main
   menu: it is the logo and the buttons, and nothing else on the window. Each of
   them belongs to a board, and the menu has no board to act on - Import Deck with
   no game behind it opens a window over a menu that has nothing to import into.
-->
{#if !onMenu}
   <!-- the settings button (and, for a spectator, the board flip) -->
   <Controls />

   <!-- a spectator has no deck of their own to import -->
   {#if !$spectating}
      <!--
         The player's own deck. In a room this window opens by itself and stays up
         until a deck has imported; in solo it is the button *Import Deck 1*.
      -->
      <DeckInput />

      <!-- in solo the opponent's half is yours as well, so it gets its own deck -->
      {#if $solo}
         <DeckInput target="opponent" />
      {/if}
   {/if}
{/if}

<div class="flex gap-2">
   {#if !onMenu}
      <Board />
   {/if}
   <Connection />
</div>

<!--
   The things that take over the whole screen. All of them are about the room rather than the
   board: an idle room asking whether anybody is still playing, one player asking the other to
   start the game again, the opening toss that decides who goes first, and a room that has
   closed while somebody was still in it.
-->
<IdlePrompt />
<ConsentPrompt />
<GameSetupDialog />
<GameClosed />

<!--
   The board's own number prompt. It lives here rather than inside the board because it
   is asked from both halves and from the slot menus as well - anywhere a gesture needs
   a count. It registers itself with `util/asks.js` when it is created, which is how the
   ask table hands a question to a dialog without importing a component.
-->
<NumberPrompt />
