<script>
   import { onMount } from 'svelte'
   import { spectating } from '$lib/stores/connection.js'
   import Board from '$lib/play/Board.svelte'
   import Controls from '$lib/play/Controls.svelte'
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
{/if}

<div class="flex gap-2">
   <Board />
   <Connection />
</div>
