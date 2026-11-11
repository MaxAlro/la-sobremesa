// La Sobremesa · capa de datos en tiempo real
// ------------------------------------------------------------
// Ofrece una misma interfaz sobre dos motores:
//  - Firebase Realtime Database (el real, entre dispositivos).
//  - Local (modo de prueba): guarda en este navegador y avisa a las demás pestañas.
//    Sirve para probar con varias pestañas sin Firebase. Se activa con ?local
//    en la dirección, o solo si todavía no hay configuración de Firebase.
//
// Interfaz:
//   db.uid                          id de este dispositivo
//   db.local                        true en modo de prueba
//   await db.get(ruta)              lee una vez
//   await db.set(ruta, valor)       escribe (null borra)
//   await db.update(ruta, cambios)  escribe varias rutas relativas a la vez
//   await db.remove(ruta)
//   db.on(ruta, fn)                 escucha cambios; devuelve una función para dejar de escuchar
//   db.alDesconectar(ruta, valor)   lo que se escribe solo si este dispositivo se desconecta
//   db.alConectar(fn)               se llama al conectar y en cada reconexión
//   await db.transaccion(ruta, fn)  lee y escribe sin choques; fn devuelve undefined para cancelar
//   db.marcaTiempo()                hora del servidor para guardar
//   db.ahora()                      hora estimada del servidor, en ms

import { FIREBASE_CONFIG, FIREBASE_VERSION } from './config.js';

const params = new URLSearchParams(location.search);
const ES_LOCALHOST = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

export function hayFirebase() {
  return !!FIREBASE_CONFIG && !params.has('local');
}

let instancia = null;
export function conectar() {
  instancia ??= hayFirebase() ? conectarFirebase() : Promise.resolve(new Local());
  return instancia;
}

const limpiar = (v) => {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'object') return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    const c = limpiar(x);
    if (c !== null) out[k] = c;
  }
  return Object.keys(out).length ? out : null;
};
const partes = (ruta) => String(ruta).split('/').filter(Boolean);

// ---------------------------------------------------------------- Local
class Local {
  constructor() {
    this.local = true;
    this.K = 'sobremesa-local-db';
    try {
      this.uid = sessionStorage.getItem('sobremesa-local-uid');
      if (!this.uid) {
        this.uid = 'local-' + Math.random().toString(36).slice(2, 10);
        sessionStorage.setItem('sobremesa-local-uid', this.uid);
      }
    } catch { this.uid = 'local-' + Math.random().toString(36).slice(2, 10); }
    this.escuchas = new Set();
    this.desconexion = [];
    this.bc = 'BroadcastChannel' in window ? new BroadcastChannel(this.K) : null;
    this.bc?.addEventListener('message', () => this.avisar());
    addEventListener('storage', (e) => { if (e.key === this.K) this.avisar(); });
    addEventListener('pagehide', () => {
      if (!this.desconexion.length) return;
      const t = this.arbol();
      for (const [r, v] of this.desconexion) this.poner(t, r, v);
      this.guardar(t);
    });
  }
  arbol() { try { return JSON.parse(localStorage.getItem(this.K) || '{}') || {}; } catch { return {}; } }
  guardar(t) {
    try { localStorage.setItem(this.K, JSON.stringify(limpiar(t) || {})); } catch {}
    this.bc?.postMessage(1);
    this.avisar();
  }
  leer(t, ruta) {
    let n = t;
    for (const p of partes(ruta)) { if (n == null || typeof n !== 'object') return null; n = n[p]; }
    return n === undefined ? null : n;
  }
  poner(t, ruta, v) {
    const ps = partes(ruta), ult = ps.pop();
    let n = t;
    for (const p of ps) { if (typeof n[p] !== 'object' || n[p] === null) n[p] = {}; n = n[p]; }
    if (v === null || v === undefined) delete n[ult]; else n[ult] = JSON.parse(JSON.stringify(v));
  }
  async get(ruta) { return limpiar(this.leer(this.arbol(), ruta)); }
  async set(ruta, v) { const t = this.arbol(); this.poner(t, ruta, v); this.guardar(t); }
  async update(ruta, cambios) {
    const t = this.arbol();
    for (const [k, v] of Object.entries(cambios)) this.poner(t, partes(ruta).concat(partes(k)).join('/'), v);
    this.guardar(t);
  }
  async remove(ruta) { return this.set(ruta, null); }
  on(ruta, fn) {
    const e = { ruta, fn, ultimo: undefined };
    this.escuchas.add(e);
    queueMicrotask(() => this.avisarA(e, this.arbol()));
    return () => this.escuchas.delete(e);
  }
  avisarA(e, t) {
    if (!this.escuchas.has(e)) return;
    const v = limpiar(this.leer(t, e.ruta)), j = JSON.stringify(v);
    if (j === e.ultimo) return;
    e.ultimo = j;
    e.fn(v === null ? null : JSON.parse(j));
  }
  avisar() { const t = this.arbol(); for (const e of [...this.escuchas]) this.avisarA(e, t); }
  alDesconectar(ruta, v) { this.desconexion = this.desconexion.filter(([r]) => r !== ruta); this.desconexion.push([ruta, v]); }
  alConectar(fn) { queueMicrotask(fn); return () => {}; }
  async transaccion(ruta, fn) {
    const t = this.arbol(), nuevo = fn(limpiar(this.leer(t, ruta)));
    if (nuevo === undefined) return { ok: false, valor: limpiar(this.leer(t, ruta)) };
    this.poner(t, ruta, nuevo); this.guardar(t);
    return { ok: true, valor: limpiar(nuevo) };
  }
  marcaTiempo() { return Date.now(); }
  ahora() { return Date.now(); }
}

// ---------------------------------------------------------------- Firebase
async function conectarFirebase() {
  // En localhost se puede apuntar a una copia del SDK y al emulador para probar:
  //   ?sdk=/ruta/al/sdk&emulador=127.0.0.1:9000
  const base = (ES_LOCALHOST && params.get('sdk')) || `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
  const [{ initializeApp }, A, D] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-auth.js`),
    import(`${base}/firebase-database.js`)
  ]);
  const app = initializeApp(FIREBASE_CONFIG);
  const auth = A.getAuth(app);
  const base_ = D.getDatabase(app);
  const emu = ES_LOCALHOST && params.get('emulador');
  if (emu) {
    const [h, p] = emu.split(':');
    D.connectDatabaseEmulator(base_, h, Number(p));
    A.connectAuthEmulator(auth, `http://${h}:${params.get('emuauth') || 9099}`, { disableWarnings: true });
  }
  const usuario = await new Promise((ok, mal) => {
    const fin = A.onAuthStateChanged(auth, (u) => { if (u) { fin(); ok(u); } });
    A.signInAnonymously(auth).catch(mal);
  });
  let desfase = 0;
  D.onValue(D.ref(base_, '.info/serverTimeOffset'), (s) => { desfase = s.val() || 0; });
  const r = (ruta) => D.ref(base_, ruta);
  return {
    local: false,
    uid: usuario.uid,
    async get(ruta) { return (await D.get(r(ruta))).val(); },
    set: (ruta, v) => D.set(r(ruta), v ?? null),
    update: (ruta, c) => D.update(r(ruta), c),
    remove: (ruta) => D.remove(r(ruta)),
    on(ruta, fn) { return D.onValue(r(ruta), (s) => fn(s.val()), (e) => console.warn('Sin permiso para leer', ruta, e)); },
    alDesconectar(ruta, v) { return v === null ? D.onDisconnect(r(ruta)).remove() : D.onDisconnect(r(ruta)).set(v); },
    alConectar(fn) { return D.onValue(r('.info/connected'), (s) => { if (s.val() === true) fn(); }); },
    async transaccion(ruta, fn) {
      const res = await D.runTransaction(r(ruta), (actual) => fn(actual), { applyLocally: false });
      return { ok: res.committed, valor: res.snapshot.val() };
    },
    marcaTiempo: () => D.serverTimestamp(),
    ahora: () => Date.now() + desfase
  };
}
