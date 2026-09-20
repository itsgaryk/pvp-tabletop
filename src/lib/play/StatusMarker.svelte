<script>
   import { statusById, statusesOn } from '$lib/util/status.js'

   /* the status effects a Pokémon has: { left, right }, each a list of ids */
   export let status = null

   /*
      One entry per marker, keyed by corner and row: a corner can hold more than
      one (poison and burn share the right one, stacked).
   */
   $: markers = ['left', 'right'].flatMap((side) =>
      statusesOn(status, side).map((id, row) => ({ side, row, effect: statusById(id) }))
   )

   /*
      Class names are spelled out here rather than in the status table so the
      CSS generator can see them.
   */
   const BACKGROUNDS = {
      confusion: 'bg-green-500',
      paralysed: 'bg-yellow-500',
      sleep: 'bg-gray-500',
      poison: 'bg-purple-500',
      burn: 'bg-red-500'
   }

   const POSITIONS = { left: 'left-1', right: 'right-1' }
</script>

{#each markers as { side, row, effect } (`${side}-${effect.id}`)}
   <!--
      "marker" carries the same size as a damage counter, and opts into the rule
      that turns readable things back the right way up inside a flipped half
      (see Board.svelte) - the opponent's half is rotated, so an unrotated emoji
      there would be upside down.
   -->
   <span
      class="marker absolute z-15 rounded-full flex justify-center items-center select-none
         {BACKGROUNDS[effect.id]} {POSITIONS[side]}"
      style="--row: {row}"
      title={effect.label}
   >{effect.emoji}</span>
{/each}

<style>
   .marker {
      /*
         Small enough that a corner's markers stay in the top half of the card:
         the ability stripe crosses its middle, and a marker that reached it would
         cover the words. The card it sits on is a slot's, which is the zone's
         (see Slot.svelte).
      */
      --size: calc(var(--slot-width, var(--card-width)) / 4);
      width: var(--size);
      height: var(--size);
      font-size: calc(var(--size) / 2);
      line-height: 1;
      /* the first marker sits at the corner, the next one under it */
      top: calc(0.25rem + var(--row, 0) * (var(--size) + 0.25rem));
   }
</style>
