<script>
   import { onMount } from 'svelte'
   import { spectating } from '$lib/stores/connection.js'
   import { solo } from '$lib/stores/solo.js'
   import Board from '$lib/play/Board.svelte'
   import Controls from '$lib/play/Controls.svelte'
   import IdlePrompt from '$lib/play/dialogs/IdlePrompt.svelte'
   import GameClosed from '$lib/play/dialogs/GameClosed.svelte'
   import Connection from './Connection.svelte'
   import DeckInput from './DeckInput.svelte'

   /* the board itself is static; only /api/relay/* needs a server */
   export const prerender = true

   /* the board is dark: there is no light mode to switch to */
   onMount(() => {
      document.documentElement.classList.add('dark')
   })
</script>

<svelte:head>
   <title>PvP Tabletop</title>
</svelte:head>

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

<div class="flex gap-2">
   <Board />
   <Connection />
</div>

<!--
   The two things that take over the whole screen. Both are about the room rather
   than the board: an idle room asking whether anybody is still playing, and a
   room that has closed while somebody was still in it.
-->
<IdlePrompt />
<GameClosed />
