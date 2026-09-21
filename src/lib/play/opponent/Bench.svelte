<script>
   import Slot from './Slot.svelte'
   import Horizontal from '$lib/components/scroll/Horizontal.svelte'
   import { defaultOpponent } from '$lib/stores/opponent.js'
   import { ctrlA } from '$lib/actions/customEvents.js'
   import { dnd } from '$lib/dnd/actions.js'
   import { source, draggedCard } from '$lib/dnd/store.js'
   import { cardSelection, resetSelection, selectSlot, selectionByPile } from '$lib/stores/player.js'
   import { solo, soloCardToPlay, soloSlotToBench, onOpponentHalf, onOpponentSlot } from '$lib/stores/solo.js'

   /* which player's board this component shows */
   export let store = defaultOpponent
   $: ({ bench, active } = store)

   /*
      In solo a card dragged from the far half can be put on its Bench - the same
      drop the player's own Bench accepts. A Pokemon in play lands here only when
      it is that half's Active, which is the Active being benched, the way your own
      moves between the two spots.
   */
   const allowDrop = () => $solo && (
      ($source === 'slot' && onOpponentSlot($draggedCard) && $draggedCard === $active) ||
      ($source !== 'slot' && onOpponentHalf($source) && !$bench.includes($source))
   )

   function onDrop () {
      if (!$solo || !$source) return

      if ($source === 'slot') {
         if (onOpponentSlot($draggedCard)) soloSlotToBench($draggedCard)
         resetSelection()
         return
      }

      /*
         That half's own cards, out of the pile each of them is in: a selection
         there can hold cards from several of its zones (see selectionByPile in
         player.js), and the one the drag started on is not where the rest are.
      */
      for (const [ from, group ] of selectionByPile(store.piles())) {
         for (const card of group) soloCardToPlay(from, card, 'bench')
      }
      cardSelection.clear()
   }

   const dndConfig = { drop: onDrop, allowDrop }

   /* the keyboard's select-all, the same one the player's own Bench answers to */
   function selectAll () {
      if (!$solo) return

      resetSelection()
      for (const slot of $bench) {
         selectSlot(slot, true)
      }
   }
</script>

<!--
   The bench fills up from its near edge, as it always has, and keeps its card size:
   a bench with more on it than the zone holds scrolls sideways rather than shrinking.
   Across the zone it is centred up and down, the same way the near half's bench is -
   the two are one row of cards that differ in whose they are, and in which half of
   the board they sit on, rather than in how they are laid out.
-->
<div class="bench-zone p-1 focus:outline-none" tabindex="0"
   use:dnd={dndConfig}
   use:ctrlA on:ctrlA={selectAll}>
   <Horizontal>
      <div class="bench-row">
         {#each $bench as slot (slot.id)}
            <Slot bind:slot={slot} {store} />
         {/each}
      </div>
   </Horizontal>
</div>

<style>
   /* the near half's zone, and the reasons for it, in full: board/Bench.svelte */
   .bench-zone {
      display: grid;
      align-items: center;
      --slot-card-width: var(--bench-card-width);
   }

   .bench-row {
      display: flex;
      /* the near half's row, and the reasons for both of these, in full:
         board/Bench.svelte */
      align-items: flex-end;
      gap: var(--scaled-rem);
      width: max-content;
      min-width: 100%;
   }

   .bench-row > :global(.slot) {
      margin-top: var(--attach-lift, 0px);
   }
</style>
