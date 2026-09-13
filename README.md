2-player version of the Pokémon TCG tabletop app.
Built with Svelte 4 + SvelteKit.

**[Live Demo](https://pvp-tabletop-27e7a.ondigitalocean.app)**

## Getting Started
To run it locally, download the repository, run `npm ci` to install dependencies, copy `.env.example` to `.env` (or `.env.development`), and then run `npm run dev`.

To build the app for deployment, run `npm run build`. You can customize the build directory by adding a `.env` file with a `BUILD_DIR` property.

## Deploying to Vercel

The app is a fully prerendered static site (`@sveltejs/adapter-static`), so it deploys as a plain static build — no serverless functions are used. The realtime game server lives elsewhere and is reached over websockets from the browser.

1. Import the repository at [vercel.com/new](https://vercel.com/new). `vercel.json` already configures the install/build commands, the `build` output directory, and Node 22, so the detected defaults do not need to be changed.
2. (Optional) Add the environment variables below under **Project Settings → Environment Variables**. They are read **at build time**, so changing one requires a redeploy (use *Redeploy* without the build cache).
3. Deploy.

This repository can also be deployed with the CLI:

```sh
npm i -g vercel
vercel        # preview deployment
vercel --prod # production deployment
```

### Environment variables

| Variable | Purpose | Default when unset |
| --- | --- | --- |
| `VITE_PVP_SERVER` | Origin of the socket.io server that relays actions between the two players. Must be `http(s)://` and reachable from the browser; the server has to allow your Vercel domain as a CORS/websocket origin. | The public demo server |
| `VITE_LIMITLESS_WEB` | Limitless TCG API used for decklist import. | `https://limitlesstcg.com` |
| `VITE_ENV` | Set to `dev` to log every shared socket event to the console. | `prod` |

Because these values are inlined into the static bundle, they must never hold secrets.

If `VITE_PVP_SERVER` is not set, the build falls back to the public demo server and logs a warning at startup. The app still needs *a* server to create/join rooms — Vercel only hosts the client.

### Project layout notes

- `src/routes/+layout.js` sets `prerender = true`, so every page is generated at build time.
- `vercel.json` pins the output directory to `build` (the adapter default).
- The game/relay server is a separate project; see *Server* below.

## Server
The server-side code for passing actions between the two players is very simple. You can find all the necessary files [here](https://gist.github.com/link--11/b568ca86faca5dd9cf0017927d90451d).
If you don't require any custom actions that are not in the current version, you can use the live demo server during development.
