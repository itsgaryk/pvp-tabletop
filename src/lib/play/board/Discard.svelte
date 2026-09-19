<script>
   import { getContext } from 'svelte'
   import { cardImage } from '$lib/util/assets.js'
   import ContextMenuOption from '$lib/components/ContextMenuOption.svelte'
   import Pile from './Pile.svelte'
   import { share, publishLog, spectating } from '$lib/stores/connection.js'

   import { discard, deck } from '$lib/stores/player.js'
   const { openPile } = getContext('boardActions')

   let menu
   $: top = $discard[ $discard.length - 1 ]

   function shuffleBack () {
      const cards = $discard.map(card => card._id)

      deck.merge($discard)
      discard.clear()
      menu.close()
      deck.shuffle()

      share('cardsMoved', { cards, from: 'discard', to: 'deck' })
      publishLog('Shuffled Discard into Deck')
   }
</script>

<Pile pile={discard} name="Discard" bind:menu={menu}>
   {#if $discard.length}
      <img class="card" src="{cardImage(top, 'xs')}" alt="{top.name}" on:click|stopPropagation={() => openPile(discard)}>
   {/if}

   <svelte:fragment slot="menu">
      <ContextMenuOption click={() => openPile(discard)} text="View All" />
      <ContextMenuOption click={() => shuffleBack()} text="Shuffle All Into Deck" disabled={$spectating} />
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