# Android App Links using CrossRummyMatchMaking

This branch adds public routes to the **existing** matchmaking Worker. No additional Worker or D1 migration is required.

| URL | Response |
| --- | --- |
| `GET https://cross-rummy-matchmaking.g-saikirangoud99740.workers.dev/.well-known/assetlinks.json` | Android Digital Asset Links JSON |
| `GET https://cross-rummy-matchmaking.g-saikirangoud99740.workers.dev/join/K7PX4Q` | Mobile-friendly fallback page with the code and an Open Cross Rummy link |
| `POST /invites/join/K7PX4Q` | Existing PlayFab-authenticated join API (unchanged) |

The GET page does NOT join the game on its own: Android verified App Links launch Unity directly when installed, and Unity must send the authenticated POST.

## 1. Prepare Play signing certificate

In **Google Play Console > Test and release > App integrity > App signing** copy the **App signing key certificate SHA-256** fingerprint. Never copy the private key or password.

Set the Worker variable (either a Wrangler `vars` entry or Cloudflare dashboard Worker Settings > Variables):

```json
"ANDROID_APP_SHA256_FINGERPRINTS": "AA:BB:...(32 hex bytes in colon-separated SHA-256 format)"
```

For locally signed APK testing, optionally include the local build's signing SHA-256 as a second comma-separated fingerprint. Both must be a full 32-byte SHA-256 fingerprint. The endpoint returns HTTP 503 rather than fake verification data if the variable is missing or malformed.

## 2. Use the existing Cloudflare default Worker domain

For testing, no custom DNS or custom domain is required. Deploy the same
`cross-rummy-matchmaking` Worker with its normal `workers.dev` URL:

`https://cross-rummy-matchmaking.g-saikirangoud99740.workers.dev`

Both `/.well-known/assetlinks.json` and `/join/<CODE>` are served by
that hostname. Leave its `workers.dev` route enabled in Cloudflare.
When switching to `crossrummy.com`, change QR/share URL, Android manifest
host, and host-specific association endpoint together.

## 3. Deploy branch

```bash
git fetch origin
git switch feature/android-app-links-20261027
npm install
npm run typecheck
npx wrangler deploy
```

Branch changes must be merged/deployed before they'll reach production. **No database migrations** are necessary for App Links.

## 4. Verify public URLs

```bash
curl -i https://cross-rummy-matchmaking.g-saikirangoud99740.workers.dev/.well-known/assetlinks.json
curl -i https://cross-rummy-matchmaking.g-saikirangoud99740.workers.dev/join/K7PX4Q
```

Expected: the first returns HTTP 200 application/json with the correct package name `com.trilightstudios.crossrummy` and matching SHA-256; the second returns HTTP 200 text/html. The example code isn't guaranteed to represent a live lobby; only the authenticated join endpoint determines its validity.

## 5. Unity Android client

- Use package ID `com.trilightstudios.crossrummy` and install a build signed by a fingerprint included in the JSON.
- On the exported MAIN/LAUNCHER activity, use `android:exported="true"`, `android:launchMode="singleTask"` and the intent-filter:
  ```xml
  <intent-filter android:autoVerify="true">
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="https" android:host="crossrummy.com"
          android:pathPrefix="/join/" />
  </intent-filter>
  ```
  Make sure the filter belongs to the actual Unity activity after the Android manifest merge. Preserve Firebase Messaging activity behavior.
- The QR code and Share button must publish `https://cross-rummy-matchmaking.g-saikirangoud99740.workers.dev/join/<CODE>` (no `workers.dev` URL).
- Subscribe to `Application.deepLinkActivated`, and inspect `Application.absoluteURL` on cold start. Parse and uppercase the six-character code, retain it during PlayFab login, and call `InviteClient.JoinOpenInvite(code)` once authenticated. Handle canceled/expired/full lobby responses.
- Existing `nexus_7` feature branch `feature/mainmenu-v2-classic-lounge-20261019` contains these client changes. Verify it is merged into the actual client build and check that a cold-start link received before login is still processed after login.

## 6. Verify on Android device

```bash
adb shell pm verify-app-links --re-verify com.trilightstudios.crossrummy
adb shell pm get-app-links com.trilightstudios.crossrummy
adb shell am start -a android.intent.action.VIEW -d "https://cross-rummy-matchmaking.g-saikirangoud99740.workers.dev/join/K7PX4Q"
```

Only a link with a **real pending invitation** can join a lobby. Test with two different PlayFab logins. Closing the host's invite popup cancels a pending invite.

If the Android app isn't installed, the fallback page offers a custom-scheme Open Cross Rummy link and displays the invite code. This is **not deferred deep linking** after installing the game. iOS Universal Links are not covered by Android's assetlinks.json.
