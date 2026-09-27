<script>
	import { fade } from 'svelte/transition'

   /*
      A short-lived note in the middle of the board: a coin flip's result, and the
      deck import's own "Deck successfully imported". The store belongs to the board
      rather than to the window that raised the note, so a note outlives whatever was
      on screen when it was written.

      `time` is how long it stays up before it fades; the default is the two seconds
      a note is worth reading for.
   */
   let active = false
   let message

   let timeout

   export function show (_message, time = 2000) {
      if (timeout) clearTimeout(timeout)

      message = _message
      active = true

      timeout = setTimeout(() => {
         active = false
      }, time)
   }
</script>

{#if active}
   <!--
      Centred on the board rather than hung under its top edge: a note is about what
      just happened rather than a banner, and the middle is where the eye already is
      (see docs/board.md). It takes no pointer events of its own.
   -->
   <div class="alert" transition:fade={{ duration: 200 }}>
      {message}
   </div>
{/if}

<style>
   .alert {
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      padding: 0.5rem;
      border-radius: 0.375rem;
      background: #c084fc; /* purple-400 */
      pointer-events: none;
   }
</style>
