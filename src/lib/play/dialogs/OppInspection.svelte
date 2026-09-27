<script>
   import { ctrlA } from '$lib/actions/customEvents.js'
   import Card from '../opponent/Card.svelte'
   import Popup from './Popup.svelte'
   import { selectPile } from '$lib/stores/player.js'
   import { s } from '$lib/util/strings.js'
   import { pileWindow } from '$lib/util/piles.js'

   let pile = null
   let popup

   let view = 'natural'

   /*
      Which pile this is, out of the same table the near half's view reads - so the
      two panels cannot disagree about what a zone is called or what colour it wears.
   */
   $: zone = pileWindow(pile)

   $: reversedPile = $pile ? $pile.slice().reverse() : []
   $: sortedPile = reversedPile.slice().sort((a, b) => a._id - b._id)

   export function open (_pile) {
      pile = _pile
      popup.open()
   }

   export function close () {
      popup.close()
   }
</script>

<Popup bind:this={popup}>
   <div class="flex">
      <button class="flex-1 tab rounded-tl-md" class:active={view === 'natural'} on:click={() => view = 'natural'}>Natural</button>
      <button class="flex-1 tab rounded-tr-md" class:active={view === 'sorted'} on:click={() => view = 'sorted'}>Sorted</button>
   </div>
   <!--
      Which pile of theirs this is, said the way the near half's view says it: the
      zone's colour as a bar, its name, and how many cards are in it.

      This window used to have no heading at all, and the reason it needs one is the
      same one the near half's view gives: a pile view is one dialog for every pile, so
      a view of their discard and a view of their prizes are the same panel with
      different cards in it, and the stack of face-down cards in a deck window says
      nothing about which of their zones it is. The name and the colour are read out of
      `util/piles.js`, so both halves answer to the one table.
   -->
   <div class="zone p-2 border-b border-black" style="--zone-accent: {zone.accent}">
      <span class="swatch"></span>
      <span class="font-bold">{zone.label}</span>
      <span class="count">{$pile?.length ?? 0} {s('card', $pile?.length ?? 0)}</span>
   </div>

   <!--
      Ctrl+A takes the whole pile, the same key the player's own view answers to.
      A spectator cannot select anything, so there it does nothing.
   -->
   <div class="flex flex-wrap gap-1 p-2 inspection"
      tabindex="0" use:ctrlA on:ctrlA={() => selectPile(pile)}>
      {#if view === 'sorted'}
         {#each sortedPile as card (card._id)}
            <Card {card} pile={pile} />
         {/each}
      {:else}
         {#each reversedPile as card (card._id)}
            <Card {card} pile={pile} />
         {/each}
      {/if}
   </div>

   <svelte:fragment slot="buttons">
      <button class="action" on:click={() => popup.close()}>Close</button>
   </svelte:fragment>
</Popup>

<style>
   .inspection {
      --card-width: 136px;
      --card-height: 189px;
   }

   /*
      The heading, in the near half's view's shape: a colour bar in the zone's colour,
      the zone's name, and the card count. The bar is what tells two views of theirs
      apart at a glance, which is the whole reason the heading is here and not just the
      count.
   */
   .zone {
      @apply flex items-center gap-2 border-b border-black;
   }

   .zone .swatch {
      @apply rounded-sm;
      width: 0.75rem;
      height: 0.75rem;
      background-color: var(--zone-accent);
   }

   .zone .count {
      @apply text-sm;
      color: var(--text-color-two);
   }

   button.tab {
      @apply p-2 font-bold;
   }

   button.tab.active {
      @apply text-white bg-[var(--primary-color)];
   }

   button.action {
      @apply px-3 py-2 rounded-lg font-bold text-white bg-[var(--primary-color)];
   }

   div :global(img.card) {
      --shadow-color: transparent; /* the shadow makes it harder to see the active selection on the gray background */
   }
</style>