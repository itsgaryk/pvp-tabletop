<script>
   /*
      The diagnostics screen as a page.

      The panel is shared with the dialog in the settings menu, so the two show
      exactly the same thing; this file is only the page around it. It is kept
      because it is linkable and self-contained - handy for a bug report, or for
      looking at diagnostics without a game open.
   */
   import { onMount } from 'svelte'
   import Diagnostics from '$lib/diagnostics/Diagnostics.svelte'

   /* the board is dark: there is no light mode to switch to */
   onMount(() => {
      document.documentElement.classList.add('dark')
   })
</script>

<svelte:head>
   <title>Diagnostics - PvP Tabletop</title>
</svelte:head>

<div class="p-4 max-w-[1100px] mx-auto flex flex-col gap-4">
   <header class="flex items-center gap-3 flex-wrap">
      <h1 class="text-xl font-bold">Diagnostics</h1>
      <span class="text-sm text-[var(--text-color-two)]">this browser, live</span>
      <span class="flex-1"></span>
      <a class="px-2 py-1 text-sm rounded-md primary" href="/">Back to the board</a>
   </header>

   <Diagnostics />
</div>
