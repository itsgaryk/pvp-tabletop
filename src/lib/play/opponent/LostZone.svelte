<script>
   import { getContext } from 'svelte'
   import { cardImage } from '$lib/util/assets.js'
   import ContextMenuOption from '$lib/components/ContextMenuOption.svelte'
   import Pile from './Pile.svelte'
   import { defaultOpponent } from '$lib/stores/opponent.js'
   import { solo } from '$lib/stores/solo.js'

   const { openOppPile } = getContext('boardActions')

   /* which player's board this component shows */
   export let store = defaultOpponent
   $: ({ lz } = store)
   $: top = $lz[ $lz.length - 1 ]

   let menu
</script>

<Pile pile={lz} name="Lost Zone" showMenu={$solo} bind:menu={menu}>
   {#if $lz.length}
      <img class="card" src="{cardImage(top, 'xs')}" alt="{top.name}" on:click|stopPropagation={() => openOppPile(lz)}>
   {/if}

   <!-- in solo the other half's lost zone is yours to look through, as your own is -->
   <svelte:fragment slot="menu">
      <ContextMenuOption click={() => openOppPile(lz)} text="View All" />
   </svelte:fragment>
</Pile>
