<script>
   import { getContext, onDestroy } from 'svelte'
   import { get } from 'svelte/store'
   import ContextMenu from '$lib/components/ContextMenu.svelte'
   import ContextMenuOption from '$lib/components/ContextMenuOption.svelte'
   import { spectating } from '$lib/stores/connection.js'
   import { deck as oppDeck, active as oppActive } from '$lib/stores/opponent.js'
   import { cardSelection } from '$lib/stores/player.js'
   import { OPP_ACTIONS, opponentCardAction } from '$lib/stores/oppAction.js'

   const { openDetails } = getContext('boardActions')

   /*
      The menu for a card of the *other* player's that this player is allowed to
      act on.

      It is the player's own card menu, read from the other side of the table: the
      same entries and the same words - *To Hand*, *To Discard*, *To Bench*, and
      the rest - because it is the same set of places, and a player who has just
      been shown the opponent's top three cards is thinking in exactly those terms.
      What it is not is the same *function*: every entry here is a request to the
      card's owner (`opponentCardAction`), who performs the move on its own board
      and reports it. See docs/reveal.md for why that split is the whole design.

      It is deliberately separate from `OppCardMenu.svelte`, which is the far half's
      menu in **solo**: that one acts on the mirror directly because in solo there
      is no other player, and its entries move a card between the far half's own
      zones. Online the two are the only menus that can be opened on a card of the
      other side, and each refuses the other's situation - `opponent/Card.svelte`
      opens the solo one in solo and this one in a room.

      One card or several. The entries act on **the window's selection**, not on the card
      that was right-clicked, which is how every other card menu on this board behaves: a
      card clicked is picked up, and the menu speaks for what is picked up (see
      `CardMenu.svelte`). So a player can pick three cards out of a reveal with Ctrl-click
      and send all three to their opponent's discard with one entry.

      What bounds it is the *pile*: only the selected cards that are in the same pile as
      the clicked one are carried, because a request names one pile and the owner reads it
      that way. In a Reveal or a Look that is every card in the window - they are one
      batch - and it is also what keeps a card of the opponent's selected on the board
      behind the window from being swept up with them.
   */

   let menu
   let card = null
   let pile = null
   let revealed = true

   /* what the entries act on and what the heading says - one answer, worked out in `refresh` */
   let picked = []
   let title = 'Hidden card'

   export function open (x, y, _card, _revealed = true, _pile = null) {
      card = _card
      revealed = _revealed
      pile = _pile
      refresh()
      menu.open(x, y)
   }

   /*
      What an entry acts on: the clicked card together with the rest of the selection that
      is in the same pile. The clicked card is always in it, whether or not it was
      selected - right-clicking a card that is not picked up picks it up first
      (`opponent/Card.svelte`), so this is the same answer for a card that was.

      `pile.get` rather than `pile.get()`: a card in a window carries the *batch*, and
      solo's own menu passes the far half's real pile. Both have `get`, and a batch
      answers with the same cards the window is drawing.
   */
   function acting (selection = []) {
      if (!card) return []

      if (!selection.includes(card)) return [ card ]

      const same = selection.filter((c) => (typeof pile?.get === 'function' ? pile.get().includes(c) : true))
      return same.length ? same : [ card ]
   }

   /*
      The heading, and *when* it is worked out, is the whole of this note.

      It was written `$: picked = acting($cardSelection)`, and that compiled to a
      dependency on `$cardSelection` **alone** - not on `card`, not on `pile` - so Svelte
      only re-ran it when the selection changed. The menu is opened *after* the selection:
      a right-click picks the card up (`opponent/Card.svelte`) and then calls `open`. So the
      last run of that statement happened while `card` was still null, `acting` returned
      the empty list, and the heading fell back to the clicked card's own name - `Card60`
      for a two-card selection - and stayed there.

      `open` and the selection are therefore the two moments this is worked out, and they
      are explicit calls rather than a `$:` line, because a `$:` line is exactly what
      quietly lost one of its inputs. `picked` is a plain variable: `act()` reads it, so
      what an entry acts on and what the heading says are the same answer by construction.
   */
   function refresh () {
      picked = acting(get(cardSelection))
      title = !revealed || !card ? 'Hidden card' : (picked.length > 1 ? `${picked.length} cards` : card.name)
   }

   onDestroy(cardSelection.subscribe(() => {
      if (card) refresh()
   }))

   function act (action, options = {}) {
      opponentCardAction(picked, action, { ...options, pile })
      menu.close()
   }

   /* the card's own face, so its name opens the details panel the way the board's does */
   function show () {
      if (card) openDetails(card)
      menu.close()
   }
</script>

<ContextMenu
   bind:this={menu}
   heading={title}
   headingClick={revealed && card ? show : null}>

   {#if card}
      <!--
         The entries, in the player's own menu's order: a zone of theirs the cards go
         to, and the two that put a card into play as one of their Pokemon.

         **The Stadium and the Table are not here, and that is a rule rather than an
         omission.** Both are cells the two halves meet in, and each half plays its *own*
         cards into them - so a card out of somebody else's deck has no business in either,
         from the menu or from a drag (see `actionForPile`, which is the drag's half of the
         same answer). They were entries here until this was reported.
      -->
      <ContextMenuOption click={() => act(OPP_ACTIONS.HAND)} text="To Hand" disabled={$spectating} />
      <ContextMenuOption click={() => act(OPP_ACTIONS.DISCARD)} text="To Discard" disabled={$spectating} />

      <ContextMenuOption click={() => act(OPP_ACTIONS.BENCH)} text="To Bench" disabled={$spectating} />
      <ContextMenuOption click={() => act(OPP_ACTIONS.ACTIVE)} text="To Active" disabled={$spectating} />

      <ContextMenuOption click={() => act(OPP_ACTIONS.DECK_SHUFFLE)} text="Shuffle Into Deck" disabled={$spectating || !$oppDeck.length} />
      <ContextMenuOption click={() => act(OPP_ACTIONS.DECK_TOP)} text="To Top of Deck" disabled={$spectating} />
      <ContextMenuOption click={() => act(OPP_ACTIONS.DECK_BOTTOM)} text="To Bottom of Deck" disabled={$spectating} />

      <ContextMenuOption click={() => act(OPP_ACTIONS.LZ)} text="To Lost Zone" disabled={$spectating} />
      <ContextMenuOption click={() => act(OPP_ACTIONS.PRIZES)} text="To Prizes" disabled={$spectating} />

      <!--
         *Attach* is the one entry that names a Pokemon of theirs, because it is the one
         that goes *under* one rather than into play as one. There is no equivalent of the
         player's own *Evolve*: an evolution needs a card the board does not know is the
         right one, and the player's own menu lets the board's own attach gesture decide
         that - which is a card of *theirs* evolving, a move no card text hands to the
         other player.

         It is also one of the two entries that act on a single card - "put these three
         cards under your Active" is not a move either board has - so it says which card
         it means when more than one is picked out.
      -->
      <ContextMenuOption
         click={() => act(OPP_ACTIONS.ATTACH)}
         text={picked.length > 1 ? 'Attach the First to Their Active' : 'Attach to Their Active'}
         disabled={$spectating || !$oppActive} />

      <ContextMenuOption click={show} text="Show Details" />
   {/if}
</ContextMenu>
