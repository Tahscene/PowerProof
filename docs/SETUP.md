# Setup: Firebase (free Spark plan, no billing account)

Everything below stays on the no-cost **Spark** plan. Do not link a billing account: the Gemini Developer API free tier, Firebase Hosting, Firestore and App Check (reCAPTCHA Enterprise, up to 10,000 assessments a month) all work without one.

## 1. Create the project
1. Open <https://console.firebase.google.com>, click **Add project**, name it, disable Google Analytics.
2. **Project settings > Your apps > Web (`</>`)**, register an app, copy the `firebaseConfig` object.
3. Paste its values into `firebase-hosting/public/firebase-config.js`. These values are public identifiers, not secrets.

## 2. Gemini through Firebase AI Logic
1. Console: **AI Services > AI Logic > Get started**.
2. Choose **Gemini Developer API** (the no-cost option) and finish the guided workflow. It enables the required APIs and enforces App Check for AI Logic.
3. The model name is set in `firebase-config.js` (`GEMINI_MODEL`). Check <https://firebase.google.com/docs/ai-logic/models> and change it if the name has moved on.

## 3. App Check (required to call Gemini from a web page)
Firebase requires App Check for AI Logic (enforced automatically since July 2026, mandatory from 2 November 2026).
1. Console: **App Check > Apps >** your web app **> reCAPTCHA Enterprise**. It sends you to the reCAPTCHA Enterprise page in Google Cloud.
2. Create a website key with the domains `YOUR_PROJECT_ID.web.app` and `YOUR_PROJECT_ID.firebaseapp.com`. Copy the **site key**.
3. Paste the site key into the Firebase console (App Check) and into `APP_CHECK_SITE_KEY` in `firebase-config.js`.
4. Check **App Check > APIs**: Firebase AI Logic must read **Enforced**.

On the Spark plan only four reCAPTCHA score levels (0.1, 0.3, 0.7, 0.9) are available. That is enough here.

## 4. Firestore
Console: **Firestore Database > Create database** (production mode). The rules in `firestore.rules` are deployed from this repository in step 6.

## 5. Run locally
```bash
cd firebase-hosting
npm run serve            # python http.server on http://localhost:5000
```
On `localhost` the app uses the App Check **debug provider**. Open the browser console, copy the printed debug token, and add it under **App Check > Apps > (menu) > Manage debug tokens**. Never commit that token.

## 6. Deploy
```bash
npm install -g firebase-tools
firebase login
firebase use --add                       # pick your project (or edit .firebaserc)
firebase deploy --only hosting,firestore:rules
```
The site is then live at `https://YOUR_PROJECT_ID.web.app`.

## Troubleshooting
| Symptom in the app | Cause |
|---|---|
| Chip says "Gemini: not connected" | `firebase-config.js` still has `PASTE_...` values |
| "Gemini blocked the request" | App Check not enforced/registered, or the debug token is not added (localhost) |
| "Free Gemini quota reached" | Free-tier rate limit; wait a minute (answers are cached in the browser) |
| Chip says "Sync: this browser only" | Firestore not created or rules not deployed; the demo falls back to localStorage |
