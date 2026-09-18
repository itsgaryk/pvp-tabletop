<script>
   import { getContext } from 'svelte'
   import Vertical from '$lib/components/scroll/Vertical.svelte'
   import ContextMenuOption from '$lib/components/ContextMenuOption.svelte'
   import Pile from './Pile.svelte'
   import Card from './Card.svelte'
   import { defaultOpponent } from '$lib/stores/opponent.js'
   import { spectating } from '$lib/stores/connection.js'
   import {
      solo, soloTogglePrizes, soloShufflePrizes,
      soloShufflePrizesIntoDeck, soloShufflePrizesToBottom
   } from '$lib/stores/solo.js'

   const { openOppPile } = getContext('boardActions')

   /* which player's board this component shows */
   export let store = defaultOpponent
   $: ({ prizes, prizesFlipped } = store)

   let menu

   /* a spectator may look through either player's prizes (read-only, no log) */
   function view () {
      if (!$spectating) return
      openOppPile(prizes)
   }

   function toggle () {
      soloTogglePrizes()
      menu.close()
   }

   function shuffle () {
      soloShufflePrizes()
      menu.close()
   }

   function shuffleBack () {
      soloShufflePrizesIntoDeck()
      menu.close()
   }

   function shuffleBackBottom () {
      soloShufflePrizesToBottom()
      menu.close()
   }
</script>

<Pile pile={prizes} name="Prizes" showMenu={$solo} bind:menu={menu}>
   <Vertical>
      <div class="prizes p-1 grid grid-cols-2 gap-1 w-fit" on:click|stopPropagation={view}>
         {#each $prizes as card (card._id)}
            <Card {card} pile={prizes} revealed={$prizesFlipped || $spectating} />
         {/each}
      </div>
   </Vertical>

   <!-- in solo the other half's prizes are yours to manage, as your own are -->
   <svelte:fragment slot="menu">
      <ContextMenuOption click={toggle} text={$prizesFlipped ? 'Hide Prizes' : 'Show Prizes'} />
      <ContextMenuOption click={shuffle} text="Shuffle" />
      <ContextMenuOption click={shuffleBack} text="Shuffle All Into Deck" />
      <ContextMenuOption click={shuffleBackBottom} text="Shuffle All to Bottom of Deck" />
      <ContextMenuOption click={() => openOppPile(prizes)} text="View All" />
   </svelte:fragment>
</Pile>

<style>
   .prizes {
      --card-width: 95px;
      --card-height: 132px;
   }
</style>
