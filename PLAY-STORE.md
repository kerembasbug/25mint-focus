# 25Mint Focus — Google Play submission runbook

Everything needed to publish the Android app (a TWA wrapping the PWA at
`app.pomodorotimer.com.au`). The signed **AAB is already built** — see step 3.

---

## Build artifacts (already produced)
Location: `/Volumes/MAINBACKUP/pomodorotimer/focus-app-android/`
- **`25mint-focus-release.aab`** — upload this to Play Console (2.0 MB, signed with upload key).
- `25mint-focus-release.apk` — for sideload testing on a device (`adb install`).
- `android.keystore` + `keystore-password.txt` — **⚠️ BACK THESE UP SECURELY (password manager + offline copy). If lost, you can never push an update to this app.** Never commit them to git.
- Upload-key SHA-256: `7B:51:1F:5B:C7:4E:C6:C9:8E:AA:80:A6:76:5A:0E:B3:E7:D6:CD:6C:05:BA:A6:AE:A0:BD:43:B3:94:36:05:E5`
- Package name (permanent): `au.com.pomodorotimer.focus` · versionName 2.0.0 / versionCode 2

## Store listing assets (ready)
In `focus-app/screenshots/`:
- `feature-graphic.png` (1024×500) — Play feature graphic
- `play-1-timer.png`, `play-2-shop.png`, `play-3-stats.png`, `play-4-sounds.png` (1080×2280) — phone screenshots
- App icon 512×512: `focus-app/icons/icon-512.png`

## Store listing copy
- **App name** (≤30): `25Mint Focus: Pomodoro Timer`
- **Short description** (≤80): `Free Pomodoro timer with focus sounds, breathing, stats & a study-timer shop.`
- **Full description**:
```
Focus in 25-minute sprints — and actually enjoy it. 25Mint Focus is a free,
all-in-one focus toolkit that works fully offline. No account, no ads.

⏱ POMODORO TIMER
Classic 25/5 and deep-work 50/10 presets, plus 15/3 and fully custom lengths.
Auto-start breaks, a full-screen focus mode, and a session that keeps running
even if you switch away.

🎧 FOCUS SOUNDS
Mix brown, pink and white noise with rain, ocean waves, café and forest —
all generated on-device, so they work with no internet.

🫁 BREATHE
A guided 4-4-4-4 box-breathing exercise to reset between sessions.

📊 STATS & STREAKS
Automatic session tracking, a daily goal, a 7-day chart and a 4-month heatmap —
all stored privately on your device.

✅ TASKS
A simple task list that counts a 🍅 for every focus session you finish.

🌙 DARK MODE
Light, dark or automatic.

🛒 FOCUS TIMER SHOP
Love the method? Browse physical Pomodoro cubes and study timers, with secure
checkout handled by our store.

Free, private, and offline-first. Your focus data never leaves your device.
```
- **Category**: Productivity · **Tags**: pomodoro, focus, study timer
- **Privacy policy URL**: `https://pomodorotimer.com.au/policies/privacy-policy`
- **Content rating**: Everyone (no objectionable content, no ads, no UGC)
- **Data safety**: No personal data collected or shared. Focus stats are stored
  only in the device's local storage. The Shop tab loads public product data and
  opens checkout on pomodorotimer.com.au (physical goods). Declare "No data collected".

---

## Steps to go live

### 1. DNS — point the app subdomain at GitHub Pages (YOU)
At your domain host (wherever pomodorotimer.com.au DNS lives):
```
app   CNAME   kerembasbug.github.io.
```
Tell me when it's added and I'll flip on the custom domain (add the `CNAME` file
to the repo + verify `https://app.pomodorotimer.com.au/` loads and serves
`/.well-known/assetlinks.json`). HTTPS provisions automatically (~15 min).

> The AAB targets `app.pomodorotimer.com.au`, so the app only works once this
> domain is live. Until then it's build-verified but not launchable.

### 2. Upload the AAB (YOU, in Play Console)
Create app → Productivity → Free. Under **Production** (or Internal testing first,
recommended), upload `25mint-focus-release.aab`. Keep **Play App Signing** enabled
(the default).

### 3. Get the Play App Signing fingerprint → finish assetlinks (YOU tell me, I apply)
Play Console → **Setup → App integrity → App signing** shows a **SHA-256
certificate fingerprint**. Send it to me; I'll replace `REPLACE_WITH_PLAY_APP_SIGNING_SHA256`
in `.well-known/assetlinks.json` and push. (Both the upload key and the Play key
are listed, so verification works for sideloaded test builds and production.)
Once assetlinks is live with that fingerprint, the app opens with **no URL bar**.

### 4. Complete the listing (YOU)
Fill store listing (copy + assets above), Data safety, Content rating, target
audience, then submit for review. First review is typically 1–3 days (new
accounts can take longer).

---

## Notes
- Notifications are disabled in this build for a clean first review; the in-app
  chime + session-complete card still work. Can be enabled in a later version.
- To ship an update later: bump `versionCode`/`versionName` in
  `focus-app-android/app/build.gradle`, rebuild (`./run-build.sh`), re-sign
  (jarsigner for the AAB), upload. Same keystore required.
