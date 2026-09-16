<script>
   import Horizontal from '$lib/components/scroll/Horizontal.svelte'
   import ContextMenuOption from '$lib/components/ContextMenuOption.svelte'
   import Pile from './Pile.svelte'
   import Card from './Card.svelte'
   import { defaultOpponent } from '$lib/stores/opponent.js'
   import { spectating } from '$lib/stores/connection.js'
   import {
      solo, soloHandIntoPlay, soloHandAttachToActive,
      soloShuffleHandIntoDeck
   } from '$lib/stores/solo.js'

   /* which player's board this component shows */
   export let store = defaultOpponent
   $: ({ hand, handRevealed, discard } = store)

   /* a spectator always sees both hands, and in solo it is your own hand too */
   $: revealed = $handRevealed || $spectating || $solo

   let menu

   function discardTop () {
      const card = hand.pop()
      if (card) discard.push(card)
   }
</script>

<Pile pile={hand} name="Hand" showMenu={$solo} bind:menu={menu}>
   <Horizontal>
      <div class="flex gap-2 p-2 m-auto w-max">
         {#each $hand as card (card._id)}
            <Card {card} pile={hand} {revealed} />
         {/each}
      </div>
   </Horizontal>

   <!-- the other half's hand is yours to play in solo -->
   <svelte:fragment slot="menu">
      <ContextMenuOption click={() => soloHandIntoPlay('active')} text="Top Card to Active" />
      <ContextMenuOption click={() => soloHandIntoPlay('bench')} text="Top Card to Bench" />
      <ContextMenuOption click={soloHandAttachToActive} text="Attach Top Card to Active" />
      <ContextMenuOption click={discardTop} text="Discard Top Card" />
      <ContextMenuOption click={soloShuffleHandIntoDeck} text="Shuffle Into Deck" />
   </svelte:fragment>
</Pile>
