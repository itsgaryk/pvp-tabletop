<script>
   /*
      One player's Pokemon Power zone: the band of the Stadium's cell on that
      player's side of it, between their own bench and the Stadium.

      It is the one zone that holds no cards. What it holds is the player's
      VSTAR / GX marker - the tokens a deck's own power is tracked with - which is
      why the marker left the loose space past the opponent's deck, where it used
      to float: a token belongs to a zone, and this is the zone for it.

      One component rather than the board/opponent pair every other zone needs: a
      Power zone shows no cards and reads no board store. What it shows is the
      marker of the player on that half, which Board.svelte has already worked out
      - for a player, for a spectator's two mirrors and for a flipped solo board -
      so being handed it is all this has to do. `opposite` is the one real
      difference between the halves: the far one is drawn facing the player
      sitting opposite, the way their cards are.

      The marks are sized by this zone rather than by Settings' card size: they
      fill the band they are in, so a window that is short, or a cell that is
      squeezed, takes the tokens with it instead of letting them spill over the
      Stadium.
   */
   import { markerUsed } from '$lib/util/markers.js'

   /* 'none' | 'vstar' | 'gx' | 'both' */
   export let marker = 'none'
   /* which of the marks have been used, one flag each (see $lib/util/markers.js) */
   export let used = { vstar: false, gx: false }
   /* the player on this half may click their own marks, and nobody else's */
   export let mine = false
   /* drawn for the far half, which faces the player sitting opposite */
   export let opposite = false
   /* clicking a mark says that power has been used, or takes that back */
   export let onToggle = () => {}

   /*
      The marks on this half. 'both' draws VSTAR and GX together - for a deck that
      has one of each - with VSTAR first, so the pair reads the same way up on
      both halves whichever way round the half is drawn.
   */
   $: marks = marker === 'both' ? ['vstar', 'gx'] : (marker === 'none' ? [] : [marker])

   const src = (mark) => mark === 'vstar' ? '/vstar.png' : '/gx.png'
   const alt = (mark) => mark === 'vstar' ? 'VSTAR' : 'GX'

   function toggle (mark) {
      if (!mine) return
      onToggle(mark)
   }
</script>

{#if marks.length}
   <!--
      A half showing both is two marks rather than one, each clickable on its own:
      they are separate powers, so using VSTAR must not dim - or write to the log
      about - GX.

      They sit side by side, which is the one thing the zone decides about them:
      the band is wide and short, so the pair lies along it rather than stacking
      out of it, and the two share the band's width in proportion to their shapes
      so that they come out the same height.
   -->
   <div class="power-marker" class:pair={marks.length > 1} class:opposite>
      {#each marks as mark (mark)}
         <img
            class="mark {mark}"
            class:mine
            class:used={markerUsed(used, mark)}
            src={src(mark)}
            alt={alt(mark)}
            on:click|stopPropagation={() => toggle(mark)}
         >
      {/each}
   </div>
{/if}

<style>
   /*
      The marks are sized by the band they are in, not by Settings' card size: a
      band is a quarter of the Stadium's cell, so a short window or a squeezed
      column takes the tokens with it instead of letting them spill over the
      Stadium and the bench beside it. The drop shadow is the glow the marker has
      always had, which is also what the used state takes away.
   */
   .power-marker {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: calc(var(--scaled-rem) * 0.5);
      width: 100%;
      height: 100%;
      /* the band is the zone's, and a token is not a thing to drop a card on */
      pointer-events: none;
      filter: drop-shadow(0 0 6px var(--selection-color));
   }

   /*
      One mark: as tall as the band, and as wide as its own shape asks for - with
      the band's width as the ceiling, since the two images are wider than they
      are tall and one of them is wider than a narrow column.
   */
   .power-marker .mark {
      display: block;
      height: 100%;
      width: auto;
      max-width: 100%;
      object-fit: contain;
   }

   /*
      Both marks: they share the band's width in proportion to their own shapes -
      which is what keeps them the same *height*, the dimension a wide, short band
      has to give. The two logos are drawn from images of different shapes, so
      forcing one width on both would either leave the taller one sticking out of
      the band or shrink the wider one to a lesser-looking token.
   */
   .power-marker.pair .mark {
      flex: 1 1 0;
      min-width: 0;
      width: auto;
   }

   .power-marker.pair .mark.vstar {
      flex-grow: 1.878;
   }

   .power-marker.pair .mark.gx {
      flex-grow: 1.566;
   }

   /*
      The top half is drawn upside down, so its marks are turned the way its cards
      are - and the pair's order is turned back, so VSTAR still reads first on
      both halves.
   */
   .power-marker.opposite {
      transform: scale(-1, -1);
   }

   .power-marker.opposite.pair {
      flex-direction: row-reverse;
   }

   /* a player's own marks can be clicked: that says the power has been used */
   .power-marker .mark.mine {
      pointer-events: auto;
      cursor: pointer;
   }

   /* used: dimmed by half, and no longer glowing */
   .power-marker .mark.used {
      opacity: 0.5;
      filter: none;
   }
</style>
