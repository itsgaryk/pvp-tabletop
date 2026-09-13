/*
   The app itself is a single prerendered page, but the relay lives in
   src/routes/api/relay/*, and those routes must run per request. Prerendering
   is therefore opted into by the page rather than the whole app - see
   src/routes/+page.svelte.
*/
export const prerender = false
