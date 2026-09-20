<script>
   import { writable } from '$lib/stores/custom/writable.js'

   /* whether the Pokémon this sits on has used its ability this game */
   export let used = writable(false)
</script>

{#if $used}
   <span class="ability-stripe">Ability Used</span>
{/if}

<style>
   /*
      A band across the middle of the card, on its own colour so it reads at a
      glance from either side of the board.
   */
   .ability-stripe {
      position: absolute;
      left: 0;
      right: 0;
      top: 50%;
      /* centring lives in `translate`, so `transform` is left for the board to
         turn this back up on a rotated half (see Board.svelte) */
      translate: 0 -50%;
      z-index: 11;
      display: block;
      padding: 0.15em 0;
      background: #00ffe6;
      color: #000;
      /* the width of the card it crosses: a slot's is the zone's (see Slot.svelte) */
      font-size: calc(var(--slot-width, var(--card-width)) * 0.135);
      font-weight: 700;
      line-height: 1.5;
      letter-spacing: 0.02em;
      text-align: center;
      text-transform: uppercase;
      white-space: nowrap;
      pointer-events: none;
   }
</style>
