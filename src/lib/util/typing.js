/*
   Whether a key event is somebody typing rather than playing the board.

   The board is driven by single-key shortcuts - D discards, H goes to hand, a
   digit draws that many - and those listeners are on the document, so they see
   every key pressed anywhere on the page. That is fine until something on the
   page has a text field in it: a room code, or the timer's minutes and seconds,
   where the digit keys are the whole point of the field.

   A button is a narrower case than a field, and it used to be treated as the same
   thing - which swallowed every shortcut wherever a button happened to have
   focus. Clicking Setup leaves that button focused, so a bare key has to reach
   the board from there: on a button, only the two keys that press it belong to
   it, so D still discards and V still opens the deck while it is focused.

   What a button does not decide is which keys are shortcuts at all. A combination
   with Ctrl or Cmd belongs to the browser and to the player's clipboard - Ctrl+V
   pastes - so a shortcut that would otherwise take one asks whether the modifier
   is held (see the deck's own V in Board.svelte).
*/
export function isTyping (target, e = null) {
   if (!target || !target.tagName) return false

   const tag = String(target.tagName).toLowerCase()

   if (tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable === true) {
      return true
   }

   /*
      Enter and Space are how a focused button is pressed, so a shortcut on either
      would do both what the button does and what the shortcut does. Without the
      event there is nothing to judge, so it is treated as the button's - the
      quieter of the two mistakes.
   */
   if (tag === 'button') {
      if (!e) return true
      return e.key === 'Enter' || e.key === ' ' || e.code === 'Space'
   }

   return false
}
