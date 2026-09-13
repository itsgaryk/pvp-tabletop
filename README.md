2-player version of the Pokémon TCG tabletop app.
Built with Svelte 4 + SvelteKit.

**[Live Demo](https://pvp-tabletop-27e7a.ondigitalocean.app)**

## Getting Started
To run it locally, download the repository, run `npm ci` to install dependencies, copy `.env.example` to `.env` (or `.env.development`), and then run `npm run dev`.

To build the app for deployment, run `npm run build`. You can customize the build directory by adding a `.env` file with a `BUILD_DIR` property.

## Deploying to Vercel

The app is a fully prerendered static site (`@sveltejs/adapter-static`), so it deploys as a plain static build — no serverless functions are used. The realtime game server lives elsewhere and is reached over websockets from the browser.

1. Import the repository at [vercel.com/new](https://vercel.com/new). `vercel.json` already configures the framework preset and the install/build commands plus the `build` output directory, so the detected defaults do not need to be changed.
2. (Optional) Add the environment variables below under **Project Settings → Environment Variables**. They are read **at build time**, so changing one requires a redeploy (use *Redeploy* without the build cache).
3. Deploy.

Node is not configured in `vercel.json` — that file has no such property, and including one makes Vercel reject the project with *"should NOT have additional property"*. The build runs on Vercel's default Node version, and `engines.node` in `package.json` (`>=18.13`) is the floor. To pin an exact version, use **Project Settings → General → Node.js Version**.

This repository can also be deployed with the CLI:

```sh
npm i -g vercel
vercel        # preview deployment
vercel --prod # production deployment
```

### Environment variables

All three are **optional** and all three are **client-side**. The app is a static bundle, so Vite inlines their values into the JavaScript during `npm run build` — they are not read by any server at runtime. Because of that they must never hold secrets (anything in them is visible to anyone who opens the deployed app), and changing one requires a redeploy.

| Variable | What it controls | Example value | Unset behaviour |
| --- | --- | --- | --- |
| `VITE_PVP_SERVER` | Origin of the socket.io server that relays moves and chat between the two players. The browser opens a websocket to it directly, so it must be reachable from the public internet and must accept your Vercel domain as an origin. | `https://pvp-tabletop-27e7a.ondigitalocean.app` | Falls back to that public demo server and logs a warning in the browser console |
| `VITE_LIMITLESS_WEB` | Base URL of the Limitless TCG API used by "Import Deck" / "Import Random Deck" (`/api/dm/import`, `/api/dm/random`). | `https://limitlesstcg.com` | Falls back to `https://limitlesstcg.com` |
| `VITE_ENV` | Debug switch. When set to `dev`, every shared socket event is logged to the browser console. | `prod` | Treated as `prod` (no event logging) |

You can leave all three blank on a first deploy: the app builds and runs against the public demo server. Set `VITE_PVP_SERVER` once you host your own relay server (see *Server* below) — otherwise everyone using your deployment shares the demo server's rooms.

Do not confuse these `VITE_*` variables with Vercel's own system variables (`VERCEL_URL`, `VERCEL_ENV`, …). Vercel shows its system variables alongside yours in that screen; only the three above are read by this project.

### Project layout notes

- `src/routes/+layout.js` sets `prerender = true`, so every page is generated at build time.
- `vercel.json` pins the output directory to `build` (the adapter default).
- The game/relay server is a separate project; see *Server* below.

## Server
The server-side code for passing actions between the two players is very simple. You can find all the necessary files [here](https://gist.github.com/link--11/b568ca86faca5dd9cf0017927d90451d).
If you don't require any custom actions that are not in the current version, you can use the live demo server during development.
