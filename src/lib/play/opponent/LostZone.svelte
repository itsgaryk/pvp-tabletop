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

<style>
   /*
      The same rule as the near half's: the card is the size of the zone it is in,
      the lower of the zone's width and height, less a few pixels of gap.
   */
   img.card {
      width: min(calc(100cqw - 2 * var(--card-gap)), calc((100cqh - 2 * var(--card-gap)) * var(--card-ratio)));
   }
</style>
