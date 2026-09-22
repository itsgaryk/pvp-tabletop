<script context="module">
   let i = 0
   export const elements = new Map()
</script>

<script>
   import { createEventDispatcher, onMount } from 'svelte'
   import { closeAll } from '$lib/components/ContextMenu.svelte'
   import { clickOutside, escape } from '$lib/actions/customEvents.js'
   import { dragging } from '$lib/dnd/pointer.js'
   const dispatch = createEventDispatcher()

   let isOpen = false

   /*
      Where the panel sits. By default it fills the width from the top left, which
      is what a pile or card inspection wants. A popup opened by a button in a
      corner asks for `anchored` instead: it hangs below that button, aligned to
      its right edge, the way a menu beside its button should.
   */
   export let anchored = false

   /*
      Vertically centred instead of pinned near the top. A short panel reads better
      high up, but a tall one - the diagnostics dialog - wants the middle of the
      window, where it is equally reachable from anywhere on the screen.
   */
   export let centered = false

   /*
      A panel is opened by a call, and a component rendered without one draws
      nothing at all - which is every panel, in a check that has no clicks to make
      (`tools/render-check.mjs`). This opens it without the call, so a panel's own
      markup can be rendered and read. Off everywhere in the app.
   */
   export let openOnMount = false

   if (openOnMount) isOpen = true

   export function open () {
      isOpen = true
      closeAll()
   }

   export function close () {
      isOpen = false
   }

   /* so the button that opened it can close it again */
   export function opened () {
      return isOpen
   }

   function closed () {
      if (!isOpen) return // needed since it's called unnecessarily by closeOthers frequently
      isOpen = false
      dispatch('closed') // might have to do cleanup work when this is closed from inside (like shuffling back the cards from Selection)
   }

   // auto closing mechanism, see ContextMenu.svelte

   const j = i++

   onMount(() => {
      elements.set(j, { close: closed })
      return () => {
         elements.delete(j)
      }
   })

   function closeOthers () {
      elements.forEach(({ close }, k) => {
         if (k !== j) close()
		})
	}

   $: if (isOpen) closeOthers()


   /* @note
   when opening the component through a click handler, stop propagation, otherwise the outclick listener will immediately close it again
   */
</script>

{#if isOpen}
   <!--
      As wide as what is in it, and centred rather than pinned to a corner: the same
      gap from the window's left edge as from its right, which is the one thing about
      a panel's placement that a pile view got wrong twice - first centred with a 2rem
      frame, then flush to the left edge, which is not the same gap at all.
   -->
   <div class="popup m-8 z-20 bg-[var(--popup-color)] rounded-md border border-black w-max max-w-[calc(100vw-4rem)]"
      class:anchored
      class:centered
      class:dragging={$dragging}
      use:clickOutside on:outclick={closed}
      use:escape on:esc={closed}>

      <!--
         What the panel was opened to show, and the only part of it that scrolls: a pile
         inspection is a grid of cards taller than any window (see Inspection.svelte), and
         a panel that runs off the bottom of the window has nothing to scroll it with -
         the wheel over it does nothing at all. The actions below stay at its foot, where
         the buttons of a panel belong.
      -->
      <div class="popup-body">
         <slot></slot>
      </div>

      <!--
         One action per line by default: a panel is not a toolbar, so a panel
         with one action of its own gets a full-width button on a line of it.

         `flex-wrap` is what lets a panel with more to do lay its actions out in
         groups beside each other instead - the pile inspection moves cards to a
         zone, which is a second kind of action and reads as its own block beside
         the ones that close the panel (see Inspection.svelte). The groups stay
         apart and drop onto their own line when the panel is too narrow for them,
         rather than shrinking a button until its words no longer fit.

         Rendered only when a panel actually has actions, so the settings menu -
         which has none, since the cog, Escape and a click outside all close it -
         does not carry an empty padded strip along its foot.
      -->
      {#if $$slots.buttons}
         <div class="flex flex-wrap items-start justify-center gap-2 p-2">
            <slot name="buttons"></slot>
         </div>
      {/if}
   </div>
{/if}

<style>
   /*
      A panel sits in the middle of the window. The detail panels used to span the
      window's full width from the top left, so narrowing them to their content left
      them looking pinned to the corner.

      On the panel itself, by class: this was a bare `div` rule, and a Svelte
      component scopes that to every `div` in its own markup - which caught the row of
      actions above and fixed it to the top of the window, over the cards, instead of
      leaving it at the foot of the panel where it is written.
   */
   .popup {
      position: fixed;
      top: 2rem;
      left: 50%;
      transform: translateX(-50%);
      /*
         Taller than the window is not a height a panel can have. It takes what the
         window gives it and hands the rest to its body, which scrolls: without this the
         panel simply ran off the bottom of the window, and a fixed box that is off the
         bottom is a box nothing can scroll to.

         The 6rem is the panel's own margins: `m-8` above and below it (2rem each), on top
         of the `top: 2rem` it is placed at, so the panel keeps the gap from the bottom of
         the window that it keeps from the top.
      */
      display: flex;
      flex-direction: column;
      max-height: calc(100vh - 6rem);
   }

   /*
      `min-height: 0` is load-bearing: a flex child defaults to `min-height: auto`, so a
      scroll container among them grows to its content instead of scrolling it.
   */
   .popup-body {
      min-height: 0;
      overflow-y: auto;
   }

   /*
      A popup opened by a corner button instead sits under it, flush with the same
      edge. Fixed rather than absolute: the button's wrapper is not an ancestor of
      this component, so an absolute panel would measure itself against the page
      and land below the fold.
   */
   .anchored {
      top: 3.25rem;
      left: auto;
      right: 0.75rem;
      transform: none;
      margin: 0;
      max-height: calc(100vh - 4rem);
   }

   /*
      The middle of the window. The base rule already centres it horizontally, so
      this only has to move it down half the viewport and pull it back up by half
      its own height.

      `margin: 0` is load-bearing: the base rule carries `m-8`, and a margin on a
      fixed element with `left: 50%` shifts the box before the transform is
      applied, which parked the dialog a visible 32px right and down of centre.
   */
   .centered {
      top: 50%;
      margin: 0;
      transform: translate(-50%, -50%);
      max-height: calc(100vh - 4rem);
   }

   /*
      **A panel the pointer is over must not swallow a drop.**

      A Reveal or a Look window floats over the middle of the board, and the panels are
      rendered *inside* the board - `Board.svelte` has them as children of `.gameboard`,
      beside the zones they cover. A drag from a window onto the other player's Bench
      therefore has the pointer over the window the whole way, and the window's own grid
      is what `document.elementFromPoint` answers with: the Bench never sees a
      `pointerenter`, never highlights, and never receives the `pointerup` that would
      make the request. The card went nowhere and the window stayed open, reported as
      *dragging into the opponent's bench or active zone closes the window* - which is
      what it looks like from the outside when the drop lands on the window and the
      board underneath never hears about it.

      While a drag is in flight the panel takes no pointer events at all, so the zones
      under it are the ones the pointer is over. Nothing is lost: the drag started from
      the panel, so the panel's own clicks are not the ones being made, `pointerenter`
      and `pointerup` both bubble to the zones from wherever the pointer is, and the
      class is gone the moment the drag ends.
   */
   .dragging {
      pointer-events: none;
   }
</style>