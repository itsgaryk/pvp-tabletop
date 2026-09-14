<script>
   import { statusById, SIDES } from '$lib/util/status.js'

   /* the status effects a Pokémon has: { left, right }, each a status id or null */
   export let status = null

   /*
      One entry per corner that is actually marked, keyed by that corner: the two
      corners are independent, so a card can carry both at once.
   */
   $: effects = SIDES.map((side) => {
      const effect = statusById(status?.[side])
      return effect ? { side, effect } : null
   }).filter(Boolean)

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

{#each effects as { side, effect } (side)}
   <!--
      "marker" carries the same size as a damage counter, and opts into the rule
      that turns readable things back the right way up inside a flipped half
      (see Board.svelte) - the opponent's half is rotated, so an unrotated emoji
      there would be upside down.
   -->
   <span
      class="marker absolute top-1 z-15 rounded-full flex justify-center items-center select-none
         {BACKGROUNDS[effect.id]} {POSITIONS[side]}"
      title={effect.label}
   >{effect.emoji}</span>
{/each}

<style>
   .marker {
      width: calc(var(--card-width) * var(--card-scale) / 2.5);
      height: calc(var(--card-width) * var(--card-scale) / 2.5);
      font-size: calc(var(--card-width) * var(--card-scale) / 4.5);
      line-height: 1;
   }
</style>
