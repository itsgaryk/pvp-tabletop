<script>
   /*
      The pile inspection dialog, open over a pile, for `tools/render-check.mjs`.

      A panel draws nothing until a call opens it - `open(pile)` says what it is
      about and then shows it - and a component rendered to a string is handed no
      calls at all: `bind:this` does not bind in a server render, so a wrapper
      cannot reach the dialog's own `open` either. What it can do is *be* the
      state: this renders the dialog already showing the pile it was handed, which
      is what the board would have done.

      It is not part of the app: nothing on a board wants a dialog that opens
      itself. It is here so the render check can reach a panel's own markup, which
      is otherwise invisible to every tool in this repository.
   */
   import Inspection from '$lib/play/dialogs/Inspection.svelte'
   import { hand } from '$lib/stores/player.js'

   export let pile = hand
</script>

<Inspection {pile} openOnMount />
