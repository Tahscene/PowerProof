/**
 * Lazy Firebase loader. Everything Firebase is imported on demand from Google's CDN,
 * so the planner itself (solver + charts) works even if Firebase is not configured.
 */
import { firebaseConfig, APP_CHECK_SITE_KEY, FIREBASE_SDK_VERSION } from '../firebase-config.js';

const CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;
const isPlaceholder = (v) => !v || String(v).includes('PASTE');

export const isConfigured = () => !isPlaceholder(firebaseConfig.apiKey) && !isPlaceholder(firebaseConfig.projectId);
export const isLocalhost = () => ['localhost', '127.0.0.1'].includes(location.hostname);
export const loadModule = (file) => import(`${CDN}/${file}`);

let pending = null;

export function getFirebase() {
  if (!isConfigured()) return Promise.resolve(null);
  if (!pending) {
    pending = (async () => {
      const [{ initializeApp }, check] = await Promise.all([loadModule('firebase-app.js'), loadModule('firebase-app-check.js')]);
      const app = initializeApp(firebaseConfig);
      // Local development: App Check debug provider. The console prints a debug token the first
      // time; register it once under Firebase console > App Check > Apps > Manage debug tokens.
      if (isLocalhost()) self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
      if (isLocalhost() || !isPlaceholder(APP_CHECK_SITE_KEY)) {
        check.initializeAppCheck(app, {
          provider: new check.ReCaptchaEnterpriseProvider(isPlaceholder(APP_CHECK_SITE_KEY) ? 'debug-only' : APP_CHECK_SITE_KEY),
          isTokenAutoRefreshEnabled: true,
        });
      }
      return { app };
    })().catch((err) => { pending = null; throw err; });
  }
  return pending;
}
