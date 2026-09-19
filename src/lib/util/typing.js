/*
   Whether a key event is somebody typing rather than playing the board.

   The board is driven by single-key shortcuts - D discards, H goes to hand, a
   digit draws that many - and those listeners are on the document, so they see
   every key pressed anywhere on the page. That is fine until something on the
   page has a text field in it: a room code, or the timer's minutes and seconds,
   where the digit keys are the whole point of the field.

   A button counts as typing here because Enter activates it, and without that a
   focused "End Turn" would both end the turn and trigger whatever shortcut Enter
   carries.
*/
export function isTyping (target) {
   if (!target || !target.tagName) return false

   const tag = String(target.tagName).toLowerCase()
   return tag === 'input' || tag === 'textarea' || tag === 'select' ||
      tag === 'button' || target.isContentEditable === true
}
