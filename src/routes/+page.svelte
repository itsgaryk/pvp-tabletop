<script>
   import { onMount } from 'svelte'
   import { spectating, room } from '$lib/stores/connection.js'
   import { solo } from '$lib/stores/solo.js'
   import Board from '$lib/play/Board.svelte'
   import Controls from '$lib/play/Controls.svelte'
   import IdlePrompt from '$lib/play/dialogs/IdlePrompt.svelte'
   import GameClosed from '$lib/play/dialogs/GameClosed.svelte'
   import Connection from './Connection.svelte'
   import DeckInput from './DeckInput.svelte'

   /* the board itself is static; only /api/relay/* needs a server */
   export const prerender = true

   /*
      The main menu is the logo and the buttons and nothing else - so while it is
      up the board stands aside rather than sharing the window with it. The menu
      and the board are never both interesting: there is no game to look at yet.
   */
   $: onMenu = !$room && !$solo

   /* the board is dark: there is no light mode to switch to */
   onMount(() => {
      document.documentElement.classList.add('dark')
   })
</script>

<svelte:head>
   <title>PvP Tabletop</title>
</svelte:head>

<!--
   The settings button, the board and the deck panels all stand aside for the main
   menu: it is the logo and the buttons, and nothing else on the window. Each of
   them belongs to a board, and the menu has no board to act on - Edit Deck with
   no game behind it opens a panel over a menu that has nothing to import into.
-->
{#if !onMenu}
   <!-- the settings button (and, for a spectator, the board flip) -->
   <Controls />

   <!-- a spectator has no deck of their own to edit -->
   {#if !$spectating}
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
   The two things that take over the whole screen. Both are about the room rather
   than the board: an idle room asking whether anybody is still playing, and a
   room that has closed while somebody was still in it.
-->
<IdlePrompt />
<GameClosed />
