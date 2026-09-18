/*
   The diagnostics screen is a snapshot of this browser's live state - the
   transport, the stores, and the boards on screen. None of that exists on the
   server, and rendering it there would only produce a flash of empty values
   before hydration replaced them, so it is rendered on the client only.
*/
export const ssr = false
export const prerender = false
