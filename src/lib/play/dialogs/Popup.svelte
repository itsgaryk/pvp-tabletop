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
   <!-- as wide as what is in it, and centred rather than pinned to a corner -->
   <div class="m-8 z-20 bg-[var(--popup-color)] rounded-md border border-black w-max max-w-[calc(100vw-4rem)]"
      class:anchored
      use:clickOutside on:outclick={closed}
      use:escape on:esc={closed}>

      <slot></slot>
      <!-- one action per line: a panel is not a toolbar -->
      <div class="flex flex-col items-center gap-2 p-2">
         <slot name="buttons"></slot>
      </div>
   </div>
{/if}

<style>
   /*
      The inspection and detail panels sit in the middle of the window. They used
      to span its full width from the top left, so narrowing them to their content
      left them looking pinned to the corner.
   */
   div {
      position: fixed;
      top: 2rem;
      left: 50%;
      transform: translateX(-50%);
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
   }
</style>