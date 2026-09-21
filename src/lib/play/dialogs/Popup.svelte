<script context="module">
   let i = 0
   export const elements = new Map()
</script>

<script>
   import { createEventDispatcher, onMount } from 'svelte'
   import { closeAll } from '$lib/components/ContextMenu.svelte'
   import { clickOutside, escape } from '$lib/actions/customEvents.js'
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
      Against the left edge of the window, rather than centred in it with the same
      gap on both sides. A panel that is a *grid of the whole window's width* - the
      pile inspection - wants the window's edges rather than a frame around them:
      there is no second column of anything beside it to be centred between, and
      the frame only spends room that the cards would otherwise have. The right
      edge keeps `--popup-edge`, so the panel is not touching the scrollbar.

      By class rather than by rewriting the base rule, so that a panel asks for it:
      the panels that are a short list of actions in the middle of the window are
      still centred, and the rule above says why.
   */
   export let flush = false

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
      As wide as what is in it, and centred rather than pinned to a corner - unless
      the panel asks to be `flush`, which is a panel that is the width of the window
      and wants the window's edges rather than a frame around them (the pile
      inspection, see Inspection.svelte).
   -->
   <div class="popup m-8 z-20 bg-[var(--popup-color)] rounded-md border border-black w-max max-w-[calc(100vw-4rem)]"
      class:anchored
      class:centered
      class:flush
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

      The pile inspection is the exception, and asks for `flush`: it is a grid as
      wide as the window, so centring it only spends the window's edges on a frame
      around it. See `.flush` below.

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
      Against the left edge of the window, with the panel's own frame left behind.

      `left: 0` rather than the base rule's `left: 50%`: the panel is not being
      centred, so there is nothing to translate - and `transform: none` is
      load-bearing for the same reason it is in `.centered`, because a transform
      left on would move a panel that is already where it belongs. The margins go
      entirely, including the top one the base class carries, so the two lengths
      that depend on them are restated here rather than inherited wrong.

      `--popup-edge` is the gap that survives: on the right, from the window's own
      scrollbar, and on the top, because a panel against the left edge is not a
      panel in the window's corner. It is a variable on the panel rather than a
      number here so that the panel's own stylesheet can keep the two gaps in step
      with each other - the inspection's cards sit against the panel's edges, so
      its card padding and this want to be the same length.
   */
   .flush {
      --popup-edge: 1rem;

      top: var(--popup-edge);
      left: 0;
      right: var(--popup-edge);
      margin: 0;
      transform: none;
      max-width: calc(100vw - var(--popup-edge));
      max-height: calc(100vh - 2 * var(--popup-edge));
   }
</style>