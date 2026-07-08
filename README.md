# 25Mint Focus — Standalone PWA

Portable build of the 25Mint Focus engine (same `focus-suite.js` that powers
pomodorotimer.com.au). Installable PWA, works fully offline, ready to wrap as a
Trusted Web Activity (TWA) for the Google Play Store.

## Contents

| File | Purpose |
|---|---|
| `index.html` | App shell (no Liquid — plain HTML) |
| `focus-suite.js` | Engine — identical to theme asset; shop links use `window.FS_SHOP_BASE` |
| `focus-suite.css` | Styles — identical to theme asset |
| `manifest.webmanifest` | PWA manifest (standalone, icons, shortcuts) |
| `sw.js` | Service worker — precaches shell, cache-first, offline support |
| `icons/` | 192/512 + maskable-512 app icons |
| `twa-manifest.json` | Bubblewrap config for Play Store packaging |
| `_app-markup.liquid` / `_app-markup.html` | Source markup reference (synced from theme snippet) |

**Keeping in sync with the theme:** the engine lives canonically in the Shopify
theme (`assets/focus-suite.js`). When it changes, re-download it here (and vice
versa). Only difference allowed: none — `FS_SHOP_BASE` handles the environment.

## 1. Deploy (required before Play Store)

Shopify cannot serve `/.well-known/assetlinks.json`, so the PWA must live on its
own host. Recommended: **`app.pomodorotimer.com.au`** as a static site.

Options:
- **Coolify server** (already running for the WooCommerce staging): create a
  "Static" service, point it at this folder (or a git repo containing it), map
  the subdomain, done.
- Cloudflare Pages / Netlify: drag-and-drop this folder.

Then add DNS: `app` CNAME → the host. HTTPS is mandatory (both handle it).

Verify after deploy: `https://app.pomodorotimer.com.au/` loads, and Lighthouse
"Installable" check passes.

## 2. Package for Play Store (Bubblewrap)

```bash
npm i -g @bubblewrap/cli
cd focus-app
bubblewrap init --manifest https://app.pomodorotimer.com.au/manifest.webmanifest
# (or: bubblewrap build using the provided twa-manifest.json)
bubblewrap build
```

- First run downloads JDK + Android SDK automatically (~1GB).
- It will create `android.keystore` — **BACK THIS FILE UP**; losing it means you
  can never update the app on Play Store.
- Output: `app-release-signed.apk` + `app-release-bundle.aab` (upload the `.aab`).

## 3. Digital Asset Links (removes browser URL bar)

After the first build, Bubblewrap prints the app's SHA-256 fingerprint
(also: `bubblewrap fingerprint`). Put it in
`/.well-known/assetlinks.json` **on the app host**:

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "au.com.pomodorotimer.focus",
    "sha256_cert_fingerprints": ["<FINGERPRINT_FROM_BUBBLEWRAP>"]
  }
}]
```

Note: when publishing via Play Console with **Play App Signing** (default),
use the fingerprint from Play Console → Setup → App integrity (it re-signs
the app), not the local keystore one.

## 4. Play Console

1. Create app (au.com.pomodorotimer.focus), category: Productivity, free.
2. Upload the `.aab`, fill store listing (title "25Mint Focus — Pomodoro Timer",
   screenshots from the deployed PWA at phone size, feature graphic 1024×500).
3. Content rating questionnaire (no ads, no UGC, no data collected — everything
   is localStorage-only, which also makes the Data Safety form trivial).
4. Submit for review.

## Local dev

```bash
python3 -m http.server 8471
# open http://localhost:8471
```

Tested (2026-07-08, Playwright): boot, SW active, manifest valid, timer runs,
offline reload works, session persists offline, FS_SHOP_BASE wired. 7/7 pass.
