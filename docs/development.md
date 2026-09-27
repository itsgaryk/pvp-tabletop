# Project layout notes

- A zone is named four different ways, and only one of those names crosses the
  network. Before renaming a store field, a pile's `name`, or anything in
  `logger.js`, read **[terminology.md](terminology.md)** — the store name *is*
  the wire name, so a rename that looks like tidying is a protocol change and the
  receiver fails silently. `docs/board.md` has the layout side of the same zones.
- A pile's **view** is one dialog for two windows (`Inspection.svelte` and
  `OppInspection.svelte`) over seven piles, so what makes one of those windows
  *this* pile rather than another is data in `src/lib/util/piles.js` and not
  markup: the name it says, the colour it wears, and where its move buttons send
  the cards. A pile added or renamed there has to keep its label equal to
  `logger.js`'s name for the same zone, which `tools/zone-vocabulary-check.mjs`
  asserts. `src/lib/util/` is where a table like this belongs when more than one
  store or component needs it — it imports nothing, so it cannot add a direction
  to a cycle (the same reason `status.js` and `markers.js` are there).
- `src/routes/+page.svelte` opts into `prerender = true`; the root layout sets
  `prerender = false` so the `api/relay` routes stay dynamic.
- `vercel.json` holds the framework preset only — the output directory comes
  from the adapter's Build Output.
- Gameplay code talks to `share()` / `react()` in `src/lib/stores/connection.js`
  and never touches the transport directly. That direction is deliberate: the
  transport must not import gameplay, or the two modules evaluate while each
  other is half-built (it is a 500 on every page load, not a subtle bug). What
  the transport needs back — "empty this board, the room is gone" — gameplay
  registers with `onBoardCleanup()` instead.
- `src/lib/relay/maintain.js` is everything the poll decides on the room it has
  already read: whether the room is still a game, who has gone stale, and whether
  to prompt or close. It runs on the poll's one exit path, so all four ways a
  poll can end are maintained identically.
- `.github/workflows/ci.yml` runs `tools/relay-check.mjs` against a dev server
  with second-scale idle windows, then `npm run build`. It never touches a real
  database, so a push cannot spend a metered quota.
