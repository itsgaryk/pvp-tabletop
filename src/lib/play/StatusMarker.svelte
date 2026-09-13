<script>
   import { statusById } from '$lib/util/status.js'

   /* the status effect a Pokémon has, as its id, or null for none */
   export let status = null

   $: effect = statusById(status)

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

   const SIDES = { left: 'left-1', right: 'right-1' }
</script>

{#if effect}
   <!--
      "marker" carries the same size as a damage counter, and opts into the rule
      that turns readable things back the right way up inside a flipped half
      (see Board.svelte) - the opponent's half is rotated, so an unrotated emoji
      there would be upside down.
   -->
   <span
      class="marker absolute top-1 z-15 rounded-full flex justify-center items-center select-none
         {BACKGROUNDS[effect.id]} {SIDES[effect.side]}"
      title={effect.label}
   >{effect.emoji}</span>
{/if}

<style>
   .marker {
      width: calc(var(--card-width) * var(--card-scale) / 2.5);
      height: calc(var(--card-width) * var(--card-scale) / 2.5);
      font-size: calc(var(--card-width) * var(--card-scale) / 4.5);
      line-height: 1;
   }
</style>
