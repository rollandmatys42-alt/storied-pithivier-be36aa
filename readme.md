# My Arena Email Suite — Web V3

Netlify-ready version. No VPS, Python, Docker or local installation is required.

## Deploy
1. Log in to Netlify.
2. Open https://app.netlify.com/drop
3. Drag the **entire `my-arena-email-suite-v3` folder** into the drop zone.
4. Netlify publishes it at a `netlify.app` URL.

The web version uses a Netlify Function as a secure proxy to the user's Listmonk API. Credentials are kept only in browser memory and are not saved to localStorage. Projects are saved locally in the browser.

The proxy is intentionally restricted to `https://campaigns.my-arenagames.com`.
