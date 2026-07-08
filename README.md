# 25Mint Focus — Standalone PWA

Portable build of the 25Mint Focus engine (same `focus-suite.js` that powers
pomodorotimer.com.au). Installable PWA, works fully offline, ready to wrap as a
Trusted Web Activity (TWA) for the Google Play Store.

## ✅ Live now

**https://kerembasbug.github.io/25mint-focus/** — deployed via GitHub Pages,
installable today (Add to Home Screen works, runs offline). Verified 2026-07-08.

To ship on the **Play Store** you still need the custom domain (below) so that
`/.well-known/assetlinks.json` is served at the site root — GitHub *project*
pages can't serve a root `.well-known`, but a **custom domain on this same repo**
can. So the only remaining infra step is DNS.

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

## 1. Custom domain (one DNS record — needed for Play Store)

The app is already live on GitHub Pages. To get the Play-Store-ready root domain,
point a subdomain at this same repo:

1. **DNS** (at whoever runs pomodorotimer.com.au DNS): add
   `app  CNAME  kerembasbug.github.io.`
2. In the repo: add a `CNAME` file containing `app.pomodorotimer.com.au`
   (one line), commit. GitHub Pages → Settings already picks it up; enable
   "Enforce HTTPS" once the cert provisions (~15 min).
3. Verify `https://app.pomodorotimer.com.au/` loads and
   `https://app.pomodorotimer.com.au/.well-known/assetlinks.json` returns 200.

That's the only infra step that needs a human (DNS access).

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
