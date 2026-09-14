<script>
   import { browser } from '$app/environment'
   import { darkMode } from '$lib/stores/settings.js'
   import { spectating } from '$lib/stores/connection.js'
   import Board from '$lib/play/Board.svelte'
   import Connection from './Connection.svelte'
   import DeckInput from './DeckInput.svelte'

   /* the board itself is static; only /api/relay/* needs a server */
   export const prerender = true

   $: if (browser) {
      document.documentElement.classList.toggle('dark', $darkMode)
   }
</script>

<svelte:head>
   <title>PvP Tabletop</title>
</svelte:head>

<!-- a spectator has no deck of their own to edit -->
{#if !$spectating}
   <DeckInput />
{/if}

<div class="flex gap-2">
   <Board />
   <Connection />
</div>