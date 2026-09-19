<script>
   import { getContext } from 'svelte'
   import { cardImage } from '$lib/util/assets.js'
   import ContextMenuOption from '$lib/components/ContextMenuOption.svelte'
   import Pile from './Pile.svelte'

   import { lz } from '$lib/stores/player.js'
   const { openPile } = getContext('boardActions')

   let menu
   $: top = $lz[ $lz.length - 1 ]
</script>

<Pile pile={lz} name="Lost Zone" bind:menu={menu}>
   {#if $lz.length}
      <img class="card" src="{cardImage(top, 'xs')}" alt="{top.name}" on:click|stopPropagation={() => openPile(lz)}>
   {/if}

   <svelte:fragment slot="menu">
      <ContextMenuOption click={() => openPile(lz)} text="View All" />
   </svelte:fragment>
</Pile>

<style>
   /*
      The card is the size of the zone it is in: the lower of the zone's width and
      height, less a few pixels so it does not touch the zone's edge (see the note
      over --card-ratio in global.css).
   */
   img.card {
      width: min(calc(100cqw - 2 * var(--card-gap)), calc((100cqh - 2 * var(--card-gap)) * var(--card-ratio)));
   }
</style>