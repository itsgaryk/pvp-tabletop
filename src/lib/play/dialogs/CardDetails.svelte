<script>
   import Modal from '$lib/components/Modal.svelte'
   import { cardImage } from '$lib/util/assets.js'

   let card
   let modal

   export function open (_card) {
      card = _card
      modal.open()
   }
</script>

<Modal bind:this={modal}>
   <img slot="raw" src={cardImage(card)} alt={card.name} class="details">
</Modal>

<style>
   /*
      This view loads the full-resolution card scan, which is taller than the
      window on smaller screens. The global stylesheet only caps `max-width`,
      so cap the height too and let the browser clamp both while keeping the
      card's aspect ratio.
   */
   .details {
      width: auto;
      height: auto;
      max-width: 100vw;
      max-height: 100vh;
      max-height: 100dvh; /* accounts for mobile browser chrome where supported */
      object-fit: contain;
   }
</style>
