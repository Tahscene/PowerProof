/**
 * Real-time dispatch between the manager, the line display and the report panel.
 *  - With Firebase configured: Cloud Firestore (works across devices).
 *  - Without it: localStorage (works across tabs of one browser) so the demo never dead-ends.
 * Collections: pp_state/current (the approved plan) and pp_events (worker reports and acknowledgements).
 */
import { getFirebase, loadModule, isConfigured } from './firebase.js';

const LS_STATE = 'pp_state_current';
const LS_EVENTS = 'pp_events_log';

export async function createSync({ onState, onEvents }) {
  if (isConfigured()) {
    try {
      const { app } = await getFirebase();
      const fs = await loadModule('firebase-firestore.js');
      const db = fs.getFirestore(app);
      const stateRef = fs.doc(db, 'pp_state', 'current');
      fs.onSnapshot(stateRef, (snap) => {
        const d = snap.exists() ? snap.data({ serverTimestamps: 'estimate' }) : null;
        onState(d ? { ...d, approvedAtMs: d.approvedAt?.toMillis?.() ?? Date.now() } : null);
      });
      const q = fs.query(fs.collection(db, 'pp_events'), fs.orderBy('ts', 'desc'), fs.limit(30));
      fs.onSnapshot(q, (snap) => onEvents(snap.docs.map((x) => {
        const d = x.data({ serverTimestamps: 'estimate' });
        return { id: x.id, ...d, tsMs: d.ts?.toMillis?.() ?? Date.now() };
      })));
      return {
        mode: 'firestore',
        approve: (plan) => fs.setDoc(stateRef, { ...plan, approvedAt: fs.serverTimestamp() }),
        reset: () => fs.setDoc(stateRef, { planId: null, approvedAt: fs.serverTimestamp() }),
        event: (ev) => fs.addDoc(fs.collection(db, 'pp_events'), { ...ev, ts: fs.serverTimestamp() }),
      };
    } catch (err) {
      console.warn('Firestore unavailable, using local mode:', err);
    }
  }
  const readEvents = () => { try { return JSON.parse(localStorage.getItem(LS_EVENTS) || '[]'); } catch { return []; } };
  const readState = () => { try { return JSON.parse(localStorage.getItem(LS_STATE) || 'null'); } catch { return null; } };
  const push = () => { onState(readState()); onEvents(readEvents()); };
  window.addEventListener('storage', push);
  setTimeout(push, 0);
  return {
    mode: 'local',
    approve: async (plan) => { localStorage.setItem(LS_STATE, JSON.stringify({ ...plan, approvedAtMs: Date.now() })); push(); },
    reset: async () => { localStorage.setItem(LS_STATE, JSON.stringify({ planId: null, approvedAtMs: Date.now() })); push(); },
    event: async (ev) => { localStorage.setItem(LS_EVENTS, JSON.stringify([{ id: String(Date.now()), ...ev, tsMs: Date.now() }, ...readEvents()].slice(0, 30))); push(); },
  };
}
