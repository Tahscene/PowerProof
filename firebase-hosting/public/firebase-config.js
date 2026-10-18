/**
 * The ONLY file you edit to connect your own Firebase project.
 *
 * None of these values is a secret: a Firebase web config only identifies your
 * project. Access is protected by Firestore security rules and by Firebase App
 * Check (reCAPTCHA Enterprise), not by hiding this file. No Gemini API key is
 * stored anywhere in this repository: Firebase AI Logic holds it server-side.
 */
export const FIREBASE_SDK_VERSION = '12.19.0';

export const firebaseConfig = {
  apiKey: 'AIzaSyDuUrfR2lrpPPTUIOnle3gmmLy_uBnTLsU',
  authDomain: 'powerproof-144a1.firebaseapp.com',
  projectId: 'powerproof-144a1',
  storageBucket: 'powerproof-144a1.firebasestorage.app',
  messagingSenderId: '712550713824',
  appId: '1:712550713824:web:86f316dd1f505de98c8385',
};

// Public site key from reCAPTCHA Enterprise (Firebase console > App Check > Apps).
export const APP_CHECK_SITE_KEY = '6Le7GvUtAAAAADF05aC5-695vs2mLKrfBO8Dj0jZ';

// Gemini model served through Firebase AI Logic. Check the current list at
// https://firebase.google.com/docs/ai-logic/models and change it here if needed.
export const GEMINI_MODEL = 'gemini-3.8-flash';