<script>
   import { draggedCard, source, dragOffset } from '$lib/dnd/store.js'
   import { pos, dragging } from '$lib/dnd/pointer.js'
   import { cardImage } from '$lib/util/assets.js'
   import cardback from '$lib/assets/cardback_int.png'

   import { cardSelection, slotSelection, prizes, prizesFlipped } from '$lib/stores/player.js'
   import { prizes as oppPrizes, prizesFlipped as oppPrizesFlipped } from '$lib/stores/opponent.js'

   let card
   let selection
   $: {
      if ($source === 'slot') {
         const $pokemon = $draggedCard.pokemon.get()
         card = $pokemon[$pokemon.length - 1]
         selection = slotSelection
      }
      else {
         card = $draggedCard
         selection = cardSelection
      }
   }

   /*
      A prize that is face down is carried face down. It is the one pile whose cards
      are laid out face down in front of their owner, so the card under the pointer
      is the one thing that would give it away - and it is not a peek at the prize
      either, because a player picks their prizes up without turning them over:
      taking one is a move on the board, not a look at the card.

      Both halves answer this, because in solo the far half's prizes are played from
      the same pointer: each half's cards are face down unless that half has shown
      them.
   */
   $: faceDown = ($source === prizes && !$prizesFlipped) ||
      ($source === oppPrizes && !$oppPrizesFlipped)
</script>

{#if $dragging && card}
   <div class="absolute z-30 pointer-events-none select-none" style="top: {$pos.y - $dragOffset.y}px; left: {$pos.x - $dragOffset.x}px;">
      {#if $selection.length > 1}
         <span class="absolute top-0 right-0 transform translate-x-[50%] translate-y-[-50%] px-2 py-1 rounded-full text-[var(--bg-color-zero)] bg-[var(--text-color)] font-bold">{$selection.length}</span>
      {/if}
      <img class="card" src={faceDown ? cardback : cardImage(card, 'xs')} alt={faceDown ? 'Hidden Card' : card.name}>
   </div>
{/if}
