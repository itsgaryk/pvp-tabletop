<!--
   A zone that scrolls its contents *down* rather than across - Horizontal.svelte is the
   other one, and the hand and the benches are what scroll with that. This one fills the
   box it is given and clips at it, so what is inside is drawn inside the zone however
   much of it there is (see board/Temp.svelte, the table's stack).

   Centring what is in it is the caller's own business, exactly as it is for Horizontal:
   only the caller knows whether its contents want centring, and a scrolling zone wants
   the centring that *gives up* when the contents are bigger than the box, which is not a
   property of the scroller.
-->
<div class="overflow-y-auto vertical">
   <slot></slot>
</div>

<style>
   .vertical {
      width: 100%;
      height: 100%;
      max-width: 100%;
      /*
         The other axis is auto rather than hidden, and both are said out loud: `overflow-y:
         auto` alone would make `overflow-x` auto as well, but a zone that *crops* what is in
         it is the one thing a zone holding cards must not do - a cropped card is a card a
         player cannot read. What the zone holds is sized to fit it (see --table-card-width),
         so the horizontal bar this can ask for only ever appears if that arithmetic is
         wrong, which is a sight better than losing the edge of a card in silence.
      */
      overflow-x: auto;
      scrollbar-color: var(--primary-color) #f5f5f5;
      scrollbar-width: thin;
   }

   .vertical::-webkit-scrollbar-track {
      box-shadow: inset 0 0 6px rgba(0, 0, 0, 0.3);
      border-radius: 10px;
      background-color: #f5f5f5;
   }

   .vertical::-webkit-scrollbar {
      width: 8px;
      background-color: #f5f5f5;
   }

   .vertical::-webkit-scrollbar-thumb {
      border-radius: 10px;
      box-shadow: inset 0 0 6px rgba(0, 0, 0, 0.3);
      background-color: var(--primary-color);
   }
</style>