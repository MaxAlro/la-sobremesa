// La Sobremesa · Basta
// ------------------------------------------------------------
// Sale una letra; cada quien llena sus categorías en su celular. Quien termina todas canta
// ¡Basta! y los demás tienen unos segundos. Luego se revisa categoría por categoría:
// 100 si nadie más la puso, 50 si se repite, 0 si está vacía, no empieza con la letra o la mesa la anula.
//
// Dónde vive cada cosa (dentro de salas/<CODIGO>):
//   publico/estado   lo escribe el anfitrión:
//                    { tipo: 'basta', fase: preparando | escribiendo | revisando | resultados | fin,
//                      ronda, opciones { rondas, tiempo, dificiles }, categorias [], letra, usadas,
//                      inicio (hora en que se ve la letra), limite (hora en que se acaba el tiempo, o null),
//                      basta { uid, hasta }, avance { uid: llenas }, orden [], puntos { uid: total },
//                      respuestas { uid: { categoría: texto } }, jugaron [], cat (la que se revisa),
//                      votos { cat: { uid: { quienVota: true } } }, ajustes { cat: { 'uid~uid': true|false } },
//                      listos { uid: true }, tabla { uid: [puntos por categoría] }, historial [{ letra, puntos }] }
//   acciones/<uid>   lo que manda cada jugador (solo lo lee el anfitrión):
//                    hoja { ronda, r: { categoría: texto } }, basta (ronda), voto { ronda, cat, no: { uid: true } },
//                    listo { ronda, cat }
//
// No hace falta cambiar las reglas de Firebase: usa las mismas rutas que Llena el hueco.
// Las reglas del juego las aplica el celular del anfitrión (función motor). Si se desconecta,
// el control pasa a otro jugador y su celular sigue desde donde iba.

import { abrirSala, existeSala, codigoValido } from '../../nucleo/sala.js';

const Q = new URLSearchParams(location.search);
const CODIGO = (Q.get('sala') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
const PANTALLA = Q.get('rol') === 'pantalla';
const DE_PRUEBA = ['local', 'sdk', 'emulador', 'emuauth'];

const GRACIA = 5000;   // ms que tienen los demás después del ¡Basta!
const MARGEN = 1500;   // ms extra para que lleguen las últimas respuestas
const SORTEO = 3000;   // ms que gira la letra antes de verse
const LARGO = 40;      // letras por respuesta
const MIN_CAT = 3, MAX_CAT = 12;
const FACILES = 'ABCDEFGHIJLMNOPRSTUV', DIFICILES = 'KQWXYZ';
const CLASICAS = ['Nombre', 'Apellido', 'Ciudad o país', 'Animal', 'Fruta o verdura', 'Color', 'Cosa'];
const SUGERENCIAS = ['Famoso', 'Comida', 'Marca', 'Película o serie', 'Profesión', 'Parte del cuerpo', 'Deporte', 'Canción o cantante', 'Flor o planta', 'Algo de la cocina', 'Excusa para llegar tarde', 'Apodo'];
const OPCIONES = { rondas: 5, tiempo: 0, dificiles: false };
const TIEMPOS = [[0, 'Sin límite'], [60, '1 min'], [120, '2 min'], [180, '3 min']];
const PREP_GUARDADA = 'sobremesa-basta-prep';
const HOJA_GUARDADA = 'sobremesa-basta-hoja';

const $app = document.getElementById('app');
const css = getComputedStyle(document.documentElement);
const token = (n) => css.getPropertyValue(n).trim();
const esc = (s) => String(s ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const inicial = (n) => esc(String(n || '?').trim().charAt(0).toUpperCase());
const lista = (v) => (Array.isArray(v) ? v : Object.keys(v || {}).sort((a, b) => a - b).map((k) => v[k])).filter((x) => x !== null && x !== undefined);
// Firebase puede devolver un objeto { 0: …, 2: … } como lista con huecos: esto lee igual ambos
const de = (o, k) => (o == null ? undefined : o[k]);
const limpio = (t) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, LARGO);
const azar = (xs) => xs[Math.floor(Math.random() * xs.length)];
const igual = (a, b) => JSON.stringify(ordenar(a ?? null)) === JSON.stringify(ordenar(b ?? null));
function ordenar(v) {
  if (Array.isArray(v)) return v.map(ordenar);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, ordenar(v[k])]));
  return v;
}
const reloj = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

function direccion(ruta, extra = {}) {
  const u = new URL(ruta, location.href);
  for (const k of DE_PRUEBA) if (Q.has(k)) u.searchParams.set(k, Q.get(k));
  for (const [k, v] of Object.entries(extra)) if (v != null) u.searchParams.set(k, v);
  return u.toString();
}
let yendo = false;
function irSala() { if (yendo) return; yendo = true; location.replace(direccion('../../sala/', { c: CODIGO, rol: PANTALLA ? 'pantalla' : null })); }

let avisoT;
function aviso(texto, ms = 2600) {
  const a = document.getElementById('aviso');
  a.textContent = texto; a.classList.add('ver');
  clearTimeout(avisoT); avisoT = setTimeout(() => a.classList.remove('ver'), ms);
}

// ------------------------------------------------------------ calificar
// Sin acentos, sin mayúsculas, solo letras y números: "Camión" = "camion", "Sobre mesa" = "sobremesa"
export const base = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
// Además, los sonidos que se confunden al escribir cuentan igual y las letras dobles cuentan como una:
// b/v, s/z/c suave, y/ll, g/j suave, h muda, k/qu/c fuerte. "Monnarca" = "Monarca", "Baca" = "Vaca".
export function clave(t) {
  return base(t)
    .replace(/ch/g, '1')
    .replace(/qu([ei])/g, 'k$1')
    .replace(/c([ei])/g, 's$1')
    .replace(/c/g, 'k')
    .replace(/z/g, 's')
    .replace(/v/g, 'b')
    .replace(/ll/g, 'y')
    .replace(/g([ei])/g, 'j$1')
    .replace(/h/g, '')
    .replace(/(.)\1+/g, '$1');
}
// Letras de diferencia (de más, de menos, cambiada o volteada)
function distancia(a, b) {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 2) return 3;
  const d = Array.from({ length: m + 1 }, (_, i) => { const r = new Array(n + 1).fill(0); r[0] = i; return r; });
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[m][n];
}
// Se perdona una letra en palabras de 6 o más y dos desde las 10; las cortas tienen que coincidir (Mango ≠ Manga)
export function parecidas(a, b) {
  const x = clave(a), y = clave(b);
  if (x === y) return true;
  const n = Math.min(x.length, y.length);
  const tolera = n >= 10 ? 2 : n >= 6 ? 1 : 0;
  return tolera > 0 && distancia(x, y) <= tolera;
}
const par = (a, b) => (a < b ? `${a}~${b}` : `${b}~${a}`);

// Califica una categoría: { uid: { t, motivo, no: [quién la marcó], pts, grupo, tam } }
// motivo: 'vacia' | 'letra' | 'anulada' | null (vale)
export function calificar(e, cat) {
  const L = base(e.letra);
  const jug = lista(e.jugaron);
  const votos = de(e.votos, cat) || {};
  const votantes = jug.length - 1;
  const res = {};
  for (const u of jug) {
    const t = limpio(de(de(e.respuestas, u), cat));
    const no = Object.keys(votos[u] || {}).filter((v) => v !== u && jug.includes(v));
    let motivo = null;
    if (!t) motivo = 'vacia';
    else if (base(t)[0] !== L) motivo = 'letra';
    else if (votantes > 0 && no.length * 2 > votantes) motivo = 'anulada';
    res[u] = { t, motivo, no, pts: 0, grupo: null, tam: 0 };
  }
  // Las que valen se juntan en grupos de respuestas iguales o parecidas; el anfitrión puede juntar o separar a mano
  const val = jug.filter((u) => !res[u].motivo);
  const padre = Object.fromEntries(val.map((u) => [u, u]));
  const raiz = (u) => (padre[u] === u ? u : (padre[u] = raiz(padre[u])));
  const ajustes = de(e.ajustes, cat) || {};
  for (let i = 0; i < val.length; i++) {
    for (let j = i + 1; j < val.length; j++) {
      const a = val[i], b = val[j], manual = ajustes[par(a, b)];
      if (manual === true || (manual !== false && parecidas(res[a].t, res[b].t))) padre[raiz(a)] = raiz(b);
    }
  }
  const tam = {};
  val.forEach((u) => { const r = raiz(u); tam[r] = (tam[r] || 0) + 1; });
  val.forEach((u) => { const r = raiz(u); res[u].grupo = r; res[u].tam = tam[r]; res[u].pts = tam[r] > 1 ? 50 : 100; });
  return res;
}

// ------------------------------------------------------------ estado de esta página
const ui = {
  sala: null, st: null, activo: false,
  acciones: {}, accionesListas: false,
  hoja: { ronda: null, r: {} }, clave: null, menu: false, verPuntos: false,
  voto: { ronda: null, cat: null, no: {} }, listo: null, juntando: null,
  prep: null
};

function prepGuardada() { try { return JSON.parse(localStorage.getItem(PREP_GUARDADA) || 'null'); } catch { return null; } }
function guardarPrep() { try { const { nueva, ...p } = ui.prep; localStorage.setItem(PREP_GUARDADA, JSON.stringify(p)); } catch {} }
function iniciarPrep(e) {
  if (ui.prep) return;
  const g = prepGuardada() || {};
  const cats = lista(e.categorias).length ? lista(e.categorias) : lista(g.categorias).length ? lista(g.categorias) : CLASICAS;
  ui.prep = { ...OPCIONES, ...(g.opciones || {}), ...(e.opciones || {}), categorias: [...cats], nueva: '' };
}

async function iniciar() {
  if (!codigoValido(CODIGO) || !(await existeSala(CODIGO))) return irSala();
  let primera = true, resolver;
  const lista0 = new Promise((r) => { resolver = r; });
  const sala = await abrirSala(CODIGO, {
    alCambiar: (st) => { if (primera) { primera = false; resolver(st); } else if (ui.activo) cambio(st); },
    alPerder: irSala
  });
  const st0 = await lista0;
  if (PANTALLA) await sala.entrarComo('pantalla');
  else if (st0.jugadores[sala.uid]) await sala.entrarComo('jugador', { nombre: st0.jugadores[sala.uid].nombre, color: st0.jugadores[sala.uid].color });
  else { sala.cerrar(); return irSala(); }
  ui.sala = sala; ui.activo = true;
  window.__juego = { ui, sala, calificar, parecidas }; // para pruebas
  document.body.classList.toggle('modo-pantalla', PANTALLA);
  if (PANTALLA) mantenerEncendida();
  cambio(sala.estado());
  setInterval(tic, 250);
}

let apagarHost = null;
function vigilarHost(soy) {
  if (soy && !apagarHost) {
    apagarHost = ui.sala.db.on(`${ui.sala.raiz}/acciones`, (v) => { ui.acciones = v || {}; ui.accionesListas = true; motor(); });
  } else if (!soy && apagarHost) { apagarHost(); apagarHost = null; ui.accionesListas = false; }
}

function cambio(st) {
  if (!st) return;
  if (st.juego !== 'basta') return irSala();
  if (st.rol === 'jugador' && !st.jugadores[st.yo]) return irSala();
  const antes = ui.st?.estado || {};
  ui.st = st;
  const e = st.estado || {};
  if (e.ronda !== ui.hoja.ronda && e.fase === 'escribiendo') cargarHoja(e.ronda);
  if (e.ronda !== antes.ronda || e.cat !== antes.cat || e.fase !== antes.fase) { ui.juntando = null; }
  if (e.fase === 'escribiendo' && e.basta && !antes.basta) guardarHoja(true);
  if (st.soyAnfitrion && (e.fase === 'preparando' || e.fase === 'fin' || !e.fase)) iniciarPrep(e);
  vigilarHost(st.soyAnfitrion);
  motor();
  pintar();
}

// ------------------------------------------------------------ la hoja de cada jugador
function cargarHoja(ronda) {
  ui.hoja = { ronda, r: {} };
  try {
    const g = JSON.parse(localStorage.getItem(`${HOJA_GUARDADA}-${ui.sala?.uid}`) || 'null');
    if (g && g.codigo === CODIGO && g.ronda === ronda) ui.hoja.r = g.r || {};
  } catch {}
}
let hojaT = null;
function guardarHoja(ya = false) {
  clearTimeout(hojaT);
  if (ui.hoja.ronda == null || PANTALLA) return Promise.resolve();
  try { localStorage.setItem(`${HOJA_GUARDADA}-${ui.sala.uid}`, JSON.stringify({ codigo: CODIGO, ...ui.hoja })); } catch {}
  const mandar = () => {
    const r = {};
    for (const [k, v] of Object.entries(ui.hoja.r)) { const t = limpio(v); if (t) r[k] = t; }
    return ui.sala.db.set(`${ui.sala.raiz}/acciones/${ui.sala.uid}/hoja`, { ronda: ui.hoja.ronda, r }).catch((x) => console.warn(x));
  };
  if (ya) return mandar();
  hojaT = setTimeout(mandar, 350);
  return Promise.resolve();
}
const llenas = (r, n) => { let k = 0; for (let i = 0; i < n; i++) if (limpio(de(r, i))) k++; return k; };

// ------------------------------------------------------------ motor (solo en el celular del anfitrión)
let ocupado = false, otraVez = false, programado = false, forzarCat = null;
function motor() {
  if (programado) return;
  programado = true;
  setTimeout(() => { programado = false; correrMotor(); }, 0);
}
async function correrMotor() {
  if (!ui.st?.soyAnfitrion || !ui.accionesListas) return;
  if (ocupado) { otraVez = true; return; }
  ocupado = true;
  try { await paso(); } catch (x) { console.error('motor', x); }
  ocupado = false;
  if (otraVez) { otraVez = false; motor(); }
}
const guardar = (cambios) => {
  cambios['publico/actividad'] = ui.sala.db.marcaTiempo();
  return ui.sala.db.update(ui.sala.raiz, cambios);
};

async function paso() {
  const st = ui.st, e = st.estado || {}, A = ui.acciones || {}, ahora = ui.sala.db.ahora();
  if (e.tipo !== 'basta') return;
  const n = lista(e.categorias).length;

  if (e.fase === 'escribiendo') {
    const cambios = {};
    // Cuántas categorías lleva cada quien (la tele lo muestra, sin decir qué)
    const avance = {};
    for (const [u, a] of Object.entries(A)) if (a?.hoja?.ronda === e.ronda) { const k = llenas(a.hoja.r, n); if (k) avance[u] = k; }
    if (!igual(avance, e.avance || {})) cambios['publico/estado/avance'] = Object.keys(avance).length ? avance : null;
    if (!e.basta) {
      const quien = Object.entries(A).find(([u, a]) => a?.basta === e.ronda && a?.hoja?.ronda === e.ronda && llenas(a.hoja.r, n) === n && st.jugadores[u]);
      if (quien) cambios['publico/estado/basta'] = { uid: quien[0], hasta: ahora + GRACIA };
      else if (e.limite && ahora >= e.limite) cambios['publico/estado/basta'] = { uid: null, hasta: e.limite };
    } else if (ahora >= e.basta.hasta + MARGEN) {
      // Plumas abajo: se juntan las respuestas de todos
      const respuestas = {}, jugaron = lista(e.orden).filter((u) => st.jugadores[u]);
      for (const [u, a] of Object.entries(A)) {
        if (a?.hoja?.ronda !== e.ronda) continue;
        const r = {};
        for (let i = 0; i < n; i++) { const t = limpio(de(a.hoja.r, i)); if (t) r[i] = t; }
        if (Object.keys(r).length) { respuestas[u] = r; if (!jugaron.includes(u)) jugaron.push(u); }
      }
      Object.assign(cambios, {
        'publico/estado/fase': 'revisando', 'publico/estado/cat': 0, 'publico/estado/respuestas': Object.keys(respuestas).length ? respuestas : null,
        'publico/estado/jugaron': jugaron, 'publico/estado/votos': null, 'publico/estado/ajustes': null, 'publico/estado/listos': null,
        'publico/estado/avance': null
      });
    }
    if (Object.keys(cambios).length) await guardar(cambios);
    return;
  }

  if (e.fase === 'revisando') {
    const cat = e.cat || 0, cambios = {};
    const jug = lista(e.jugaron);
    const votos = votosDe(e, cat, A), listos = {};
    for (const [u, a] of Object.entries(A)) if (a?.listo?.ronda === e.ronda && a.listo.cat === cat) listos[u] = true;
    if (!igual(votos, de(e.votos, cat) || {})) cambios[`publico/estado/votos/${cat}`] = Object.keys(votos).length ? votos : null;
    if (!igual(listos, e.listos || {})) cambios['publico/estado/listos'] = Object.keys(listos).length ? listos : null;
    const esperados = st.lista.filter((j) => j.conectado && jug.includes(j.uid));
    const todos = esperados.length > 0 && esperados.every((j) => listos[j.uid]);
    if (todos || forzarCat === `${e.ronda}-${cat}`) {
      forzarCat = null;
      const e2 = { ...e, votos: conCat(e.votos, cat, votos) };
      if (cat + 1 < n) Object.assign(cambios, { 'publico/estado/cat': cat + 1, 'publico/estado/listos': null });
      else Object.assign(cambios, cerrarRonda(st, e2));
    }
    if (Object.keys(cambios).length) await guardar(cambios);
  }
}

function votosDe(e, cat, A) {
  const jug = lista(e.jugaron), votos = {};
  for (const [v, a] of Object.entries(A)) {
    const vo = a?.voto;
    if (vo?.ronda !== e.ronda || vo.cat !== cat || !jug.includes(v)) continue;
    for (const t of Object.keys(vo.no || {})) if (t !== v && jug.includes(t)) (votos[t] ||= {})[v] = true;
  }
  return votos;
}
function conCat(v, cat, valor) {
  const o = {};
  if (Array.isArray(v)) v.forEach((x, i) => { if (x != null) o[i] = x; });
  else Object.assign(o, v || {});
  o[cat] = valor;
  return o;
}

function cerrarRonda(st, e) {
  const cats = lista(e.categorias), jug = lista(e.jugaron);
  const tabla = {}, deLaRonda = {}, puntos = { ...(e.puntos || {}) };
  jug.forEach((u) => { tabla[u] = cats.map(() => 0); });
  cats.forEach((_, c) => { const r = calificar(e, c); jug.forEach((u) => { tabla[u][c] = r[u].pts; }); });
  jug.forEach((u) => { deLaRonda[u] = tabla[u].reduce((a, b) => a + b, 0); puntos[u] = (puntos[u] || 0) + deLaRonda[u]; });
  const historial = lista(e.historial).concat([{ letra: e.letra, puntos: deLaRonda }]);
  return {
    'publico/estado/fase': 'resultados', 'publico/estado/votos': e.votos, 'publico/estado/tabla': tabla,
    'publico/estado/deLaRonda': deLaRonda, 'publico/estado/puntos': puntos, 'publico/estado/historial': historial,
    'publico/estado/listos': null, 'publico/estado/cat': null
  };
}

function sortearLetra(usadas, dificiles) {
  const todas = (FACILES + (dificiles ? DIFICILES : '')).split('');
  const libres = todas.filter((l) => !String(usadas || '').includes(l));
  return azar(libres.length ? libres : todas);
}
function datosDeRonda(e, ronda, orden) {
  const ahora = ui.sala.db.ahora(), opciones = e.opciones || OPCIONES;
  let usadas = String(e.usadas || '');
  const todas = FACILES + (opciones.dificiles ? DIFICILES : '');
  if ([...todas].every((l) => usadas.includes(l))) usadas = '';
  const letra = sortearLetra(usadas, opciones.dificiles);
  const inicio = ahora + SORTEO;
  return {
    ronda, fase: 'escribiendo', letra, usadas: usadas + letra, inicio,
    limite: opciones.tiempo ? inicio + opciones.tiempo * 1000 : null, orden,
    basta: null, avance: null, respuestas: null, jugaron: null, cat: null, votos: null, ajustes: null,
    listos: null, tabla: null, deLaRonda: null
  };
}

async function empezar() {
  const st = ui.st, p = ui.prep;
  const categorias = p.categorias.map(limpio).filter(Boolean).slice(0, MAX_CAT);
  if (categorias.length < MIN_CAT) return aviso(`Pon al menos ${MIN_CAT} categorías`);
  const jugadores = st.lista.filter((j) => j.conectado);
  if (jugadores.length < 2) return aviso('Se necesitan al menos 2 jugadores');
  const opciones = { rondas: p.rondas, tiempo: p.tiempo, dificiles: p.dificiles };
  guardarPrep();
  const orden = jugadores.map((j) => j.uid);
  const base0 = { tipo: 'basta', opciones, categorias, usadas: '' };
  const estado = { ...base0, ...datosDeRonda(base0, 1, orden), puntos: Object.fromEntries(orden.map((u) => [u, 0])), historial: null };
  await guardar({ 'publico/estado': estado, acciones: null });
}

async function siguienteRonda() {
  const st = ui.st, e = st.estado;
  if (e.ronda >= (e.opciones?.rondas || OPCIONES.rondas)) return guardar({ 'publico/estado/fase': 'fin' });
  const orden = lista(e.orden).filter((u) => st.jugadores[u]);
  st.lista.forEach((j) => { if (!orden.includes(j.uid)) orden.push(j.uid); });
  const cambios = { acciones: null };
  for (const [k, v] of Object.entries(datosDeRonda(e, e.ronda + 1, orden))) cambios[`publico/estado/${k}`] = v;
  await guardar(cambios);
}

// ------------------------------------------------------------ reloj de la página
const RUEDA = (FACILES + DIFICILES).split('');
function tic() {
  const st = ui.st, e = st?.estado;
  if (!e || e.tipo !== 'basta') return;
  const ahora = ui.sala.db.ahora();
  if (st.soyAnfitrion && e.fase === 'escribiendo' && (e.basta || e.limite)) motor();
  if (e.fase !== 'escribiendo') return;
  // Cuando cambia el momento (gira la letra → se escribe → plumas abajo) se vuelve a pintar
  if (claveVista(st, e) !== ui.clave) { pintar(); return; }
  document.querySelectorAll('[data-rueda]').forEach((x) => { x.textContent = azar(RUEDA); });
  document.querySelectorAll('[data-reloj]').forEach((x) => {
    if (x.dataset.reloj === 'basta' && e.basta) x.textContent = String(Math.max(0, Math.ceil((e.basta.hasta - ahora) / 1000)));
    if (x.dataset.reloj === 'limite' && e.limite) x.textContent = reloj(e.limite - ahora);
  });
}
function momento(e) {
  const ahora = ui.sala.db.ahora();
  if (ahora < (e.inicio || 0)) return 'sorteo';
  if (e.basta && ahora >= e.basta.hasta) return 'cerrada';
  return e.basta ? 'basta' : 'abierta';
}

// ------------------------------------------------------------ pintar
function claveVista(st, e) { return e.fase === 'escribiendo' ? `${e.ronda}|${momento(e)}` : null; }

function pintar() {
  const st = ui.st;
  if (!st) return;
  const e = st.estado || {};
  if (PANTALLA) { ui.clave = claveVista(st, e); return pintarPantalla(st, e); }
  const clave = claveVista(st, e);
  // Mientras se escribe no se vuelve a dibujar la hoja (se cerraría el teclado): solo lo que cambia alrededor
  if (clave && clave === ui.clave && document.querySelector('.hoja')) { refrescarHoja(st, e); return; }
  ui.clave = clave;
  const a = document.activeElement;
  const foco = a?.dataset?.foco ? { k: a.dataset.foco, ini: a.selectionStart, fin: a.selectionEnd } : null;
  $app.innerHTML = `<main class="jugador">${barra(st, e)}${cuerpo(st, e)}${tablaPuntos(st, e)}</main>`;
  if (foco) { const t = document.querySelector(`[data-foco="${foco.k}"]`); if (t && !t.disabled) { t.focus(); try { t.setSelectionRange(foco.ini, foco.fin); } catch {} } }
}

const nombre = (st, uid) => st.jugadores[uid]?.nombre || '—';
const colorDe = (st, uid) => st.jugadores[uid]?.color || token('--jugador-1');
const totalRondas = (e) => e.opciones?.rondas || OPCIONES.rondas;

function barra(st, e) {
  return `<div class="barra">
    <a class="marca" href="${esc(direccion('../../'))}">La <em>Sobremesa</em></a>
    <div class="barra-der">
      <span class="codigo-mini">${esc(CODIGO)}</span>
      ${st.soyAnfitrion ? `<div class="envoltura-menu"><button class="rol" data-accion="menu" aria-expanded="${ui.menu}">Anfitrión ▾</button>${ui.menu ? `<div class="menu" role="menu">
        ${e.fase && e.fase !== 'preparando' ? '<button data-accion="reiniciar">Empezar otra partida</button>' : ''}
        <button data-accion="a-sala">Volver a la sala</button>
      </div>` : ''}</div>` : ''}
    </div>
  </div>`;
}

function cuerpo(st, e) {
  if (e.tipo !== 'basta' || e.fase === 'preparando' || !e.fase) return preparar(st, e);
  if (e.fase === 'escribiendo') return escribiendo(st, e);
  if (e.fase === 'revisando') return revisando(st, e);
  if (e.fase === 'resultados') return resultados(st, e);
  if (e.fase === 'fin') return final(st, e);
  return '';
}

const reglasCortas = () => `<details class="panel reglas"><summary>Cómo se juega</summary><ol>
  <li>Sale una letra al azar y cada quien llena sus categorías con palabras que empiecen con ella.</li>
  <li>Quien llene todas puede cantar ¡Basta! y los demás tienen ${GRACIA / 1000} segundos para terminar.</li>
  <li>Se revisa categoría por categoría. Si una respuesta no vale, márcala: se anula si la marca la mayoría.</li>
  <li>100 puntos si nadie más la puso, 50 si se repite, 0 si está vacía o no empieza con la letra. Los errores de ortografía se perdonan.</li></ol></details>`;

function preparar(st, e) {
  if (!st.soyAnfitrion) {
    return `<div class="panel espera"><h1 class="titulo">Basta</h1><p>Esperando a que <b>${esc(st.nombreAnfitrion || 'el anfitrión')}</b> prepare la partida…</p></div>${reglasCortas()}`;
  }
  iniciarPrep(e);
  const p = ui.prep, conectados = st.lista.filter((j) => j.conectado).length;
  const sugeridas = SUGERENCIAS.concat(CLASICAS).filter((s) => !p.categorias.some((c) => base(c) === base(s)));
  const puede = conectados >= 2 && p.categorias.length >= MIN_CAT;
  return `<div class="panel prep">
    <h1 class="titulo">Basta</h1>
    <span class="etiqueta">Categorías · ${p.categorias.length}</span>
    <div class="cats">${p.categorias.map((c, i) => `<span class="cat">${esc(c)}<button data-accion="quitar-cat" data-i="${i}" aria-label="Quitar ${esc(c)}">✕</button></span>`).join('')}</div>
    ${p.categorias.length < MAX_CAT ? `<form class="agregar" data-accion="form-cat"><input class="campo" data-foco="nueva-cat" id="nuevaCat" maxlength="24" placeholder="Otra categoría…" value="${esc(p.nueva)}" autocomplete="off"><button class="btn" type="submit">Agregar</button></form>
    <div class="sugerencias">${sugeridas.map((s) => `<button data-accion="sugerida" data-c="${esc(s)}">+ ${esc(s)}</button>`).join('')}</div>` : `<p class="sub">Máximo ${MAX_CAT} categorías.</p>`}
    <span class="etiqueta">Rondas</span>
    <div class="contador"><button class="btn" data-accion="rondas" data-d="-1" aria-label="Menos">−</button><b>${p.rondas}</b><button class="btn" data-accion="rondas" data-d="1" aria-label="Más">+</button></div>
    <span class="etiqueta">Tiempo por ronda</span>
    <div class="segmentos">${TIEMPOS.map(([s, t]) => `<button class="btn" data-accion="tiempo" data-s="${s}" aria-pressed="${p.tiempo === s}">${t}</button>`).join('')}</div>
    <label class="interruptor"><input type="checkbox" data-accion="dificiles" ${p.dificiles ? 'checked' : ''}><span><b>Letras difíciles</b><small>También pueden salir K, Q, W, X, Y y Z.</small></span></label>
    <button class="btn pri grande" data-accion="empezar" ${puede ? '' : 'disabled'}>${conectados < 2 ? 'Falta 1 jugador para empezar' : p.categorias.length < MIN_CAT ? `Pon al menos ${MIN_CAT} categorías` : `Empezar con ${conectados}`}</button>
  </div>${reglasCortas()}`;
}

function cabezaLetra(e, sub) {
  const sorteo = momento(e) === 'sorteo';
  return `<div class="letra-fila">
    <div class="carta letra-carta ${sorteo ? 'girando' : ''}" ${sorteo ? 'data-rueda' : ''}>${sorteo ? '?' : esc(e.letra)}</div>
    <div class="letra-info"><span class="etiqueta">Ronda ${e.ronda} de ${totalRondas(e)}</span><b class="titulo" style="font-size:1.3rem">${sorteo ? 'Sorteando la letra…' : `Todo con ${esc(e.letra)}`}</b>${sub || ''}</div>
  </div>`;
}

function escribiendo(st, e) {
  const m = momento(e);
  if (m === 'sorteo') return `${cabezaLetra(e)}<div class="panel espera"><p>Prepárate: en un momento sale la letra.</p></div>`;
  const cats = lista(e.categorias), cerrada = m === 'cerrada';
  const filas = cats.map((c, i) => {
    const v = ui.hoja.r[i] || '';
    return `<label class="renglon ${clasesRenglon(v, e)}"><span class="etiqueta"><span>${esc(c)}</span><span class="ojo">${ojo(v, e)}</span></span>
      <input class="campo" data-cat="${i}" data-foco="cat-${i}" maxlength="${LARGO}" value="${esc(v)}" placeholder="${esc(e.letra)}…" autocomplete="off" autocapitalize="words" spellcheck="false" enterkeyhint="${i < cats.length - 1 ? 'next' : 'done'}" ${cerrada ? 'disabled' : ''}></label>`;
  }).join('');
  return `${cabezaLetra(e, `<span class="reloj" id="subLetra">${subLetra(st, e)}</span>`)}
    <div id="estadoHoja">${estadoHoja(st, e)}</div>
    <form class="hoja" autocomplete="off" onsubmit="return false">${filas}</form>
    <div class="pie-fijo" id="pieHoja">${pieHoja(st, e)}</div>`;
}
const clasesRenglon = (v, e) => (limpio(v) ? (base(v)[0] === base(e.letra) ? 'lleno' : 'mal') : '');
const ojo = (v, e) => (limpio(v) && base(v)[0] !== base(e.letra) ? `No empieza con ${esc(e.letra)}` : '');
function subLetra(st, e) {
  if (e.limite && !e.basta) return `Quedan <span data-reloj="limite">${reloj(e.limite - ui.sala.db.ahora())}</span>`;
  return '';
}
function estadoHoja(st, e) {
  const m = momento(e);
  if (m === 'cerrada') return '<div class="cartel tranquilo"><b>Plumas abajo</b><span>Juntando las respuestas de todos…</span></div>';
  if (m === 'basta') {
    const quien = e.basta.uid;
    const texto = !quien ? 'Se acabó el tiempo. Termina lo que puedas.' : quien === st.yo ? 'Lo cantaste tú. Los demás tienen unos segundos.' : `${esc(nombre(st, quien))} ya terminó. Apúrate con lo que te falta.`;
    return `<div class="cartel"><b>¡BASTA! · <span data-reloj="basta">${Math.max(0, Math.ceil((e.basta.hasta - ui.sala.db.ahora()) / 1000))}</span></b><span>${texto}</span></div>`;
  }
  const otros = st.lista.filter((j) => j.uid !== st.yo && (e.avance || {})[j.uid]);
  const n = lista(e.categorias).length;
  return otros.length ? `<div class="chips">${otros.map((j) => `<span class="chip ${(e.avance[j.uid] || 0) >= n ? 'listo' : ''}">${esc(j.nombre)} ${e.avance[j.uid]}/${n}</span>`).join('')}</div>` : '';
}
function pieHoja(st, e) {
  const m = momento(e), n = lista(e.categorias).length, k = llenas(ui.hoja.r, n);
  if (m !== 'abierta') return '';
  return k === n
    ? '<button class="btn pri grande basta" data-accion="basta">¡Basta!</button>'
    : `<button class="btn grande basta" disabled>Llena todo para cantar ¡Basta! (${k}/${n})</button>`;
}
function refrescarHoja(st, e) {
  const est = document.getElementById('estadoHoja'), pie = document.getElementById('pieHoja'), sub = document.getElementById('subLetra');
  const h1 = estadoHoja(st, e), h2 = pieHoja(st, e), h3 = subLetra(st, e);
  if (est && est.dataset.h !== h1) { est.innerHTML = h1; est.dataset.h = h1; }
  if (pie && pie.dataset.h !== h2) { pie.innerHTML = h2; pie.dataset.h = h2; }
  if (sub && sub.dataset.h !== h3) { sub.innerHTML = h3; sub.dataset.h = h3; }
}

function revisando(st, e) {
  const cats = lista(e.categorias), cat = e.cat || 0, res = calificar(e, cat), jug = lista(e.jugaron);
  const misVotos = ui.voto.ronda === e.ronda && ui.voto.cat === cat ? ui.voto.no : {};
  const soyListo = ui.listo === `${e.ronda}-${cat}`;
  const juego = jug.includes(st.yo);
  const filas = ordenRevision(st, e, res).map((u) => {
    const r = res[u], yo = u === st.yo;
    const votable = juego && !yo && r.motivo !== 'vacia' && r.motivo !== 'letra';
    const marcado = !!misVotos[u];
    let ctrl = '';
    if (votable) ctrl += `<button class="btn voto" data-accion="voto" data-uid="${esc(u)}" aria-pressed="${marcado}">✕ No vale</button>`;
    if (st.soyAnfitrion && !r.motivo) ctrl += botonGrupo(u, r, res);
    return `<div class="resp ${yo ? 'yo' : ''} ${claseResp(r)}">
      <span class="av" style="background:${esc(colorDe(st, u))}">${inicial(nombre(st, u))}</span>
      <div class="txt"><small>${yo ? 'Tú' : esc(nombre(st, u))}${r.no.length ? ` · ✕ ${r.no.length}` : ''}</small><b>${r.t ? esc(r.t) : 'sin respuesta'}</b></div>
      <div class="pts"><b>${r.pts}</b><small>${notaResp(r, e)}</small></div>${ctrl}
    </div>`;
  }).join('');
  const listos = e.listos || {}, conectados = st.lista.filter((j) => j.conectado && jug.includes(j.uid));
  const faltan = conectados.filter((j) => !listos[j.uid]);
  return `<div class="cabeza"><span class="etiqueta">Categoría ${cat + 1} de ${cats.length} · Letra ${esc(e.letra)}</span><h2 class="titulo">${esc(cats[cat])}</h2></div>
    ${ui.juntando ? `<p class="aviso-local">Toca "Juntar aquí" en la respuesta que es igual a la de ${esc(nombre(st, ui.juntando))}. <button class="enlace" data-accion="cancelar-juntar">Cancelar</button></p>` : ''}
    <div class="respuestas">${filas}</div>
    <p class="sub">${juego ? 'Si una respuesta no vale, márcala. Se anula si la marca la mayoría.' : 'Te sumaste a media ronda: miras esta revisión y juegas la siguiente.'}</p>
    <div class="chips">${conectados.map((j) => `<span class="chip ${listos[j.uid] ? 'listo' : ''}">${listos[j.uid] ? '✓ ' : ''}${esc(j.nombre)}</span>`).join('')}</div>
    ${juego ? `<div class="pie-fijo"><button class="btn ${soyListo ? '' : 'pri'} grande" data-accion="listo">${soyListo ? `Esperando a ${faltan.length} · cambiar de opinión` : cat + 1 < cats.length ? 'Listo, siguiente categoría' : 'Listo, ver resultados'}</button></div>` : ''}
    ${st.soyAnfitrion && faltan.length ? `<button class="enlace" data-accion="forzar">Pasar sin esperar a ${faltan.map((j) => esc(j.nombre)).join(', ')}</button>` : ''}`;
}
function ordenRevision(st, e, res) {
  // Las repetidas juntas, para que se vea qué se juntó con qué
  return lista(e.jugaron).slice().sort((a, b) => {
    const ga = res[a].grupo || `~${a}`, gb = res[b].grupo || `~${b}`;
    return (res[b].tam - res[a].tam) || ga.localeCompare(gb) || nombre(st, a).localeCompare(nombre(st, b), 'es');
  });
}
const claseResp = (r) => (r.motivo === 'vacia' ? 'cero vacia' : r.motivo ? 'cero' : r.tam > 1 ? 'repetida' : '');
function notaResp(r, e) {
  if (r.motivo === 'vacia') return 'vacía';
  if (r.motivo === 'letra') return `no empieza con ${esc(e.letra)}`;
  if (r.motivo === 'anulada') return 'anulada';
  return r.tam > 1 ? `repetida · ${r.tam}` : '';
}
function botonGrupo(u, r, res) {
  if (ui.juntando) {
    if (ui.juntando === u) return '';
    const otro = res[ui.juntando];
    if (!otro || otro.motivo || otro.grupo === r.grupo) return '';
    return `<button class="btn voto" data-accion="juntar-aqui" data-uid="${esc(u)}">Juntar aquí</button>`;
  }
  return r.tam > 1
    ? `<button class="btn voto" data-accion="separar" data-uid="${esc(u)}" title="No es igual a las otras">Separar</button>`
    : `<button class="btn voto" data-accion="juntar" data-uid="${esc(u)}" title="Es igual a otra respuesta">Juntar</button>`;
}

function resultados(st, e) {
  const cats = lista(e.categorias), jug = lista(e.jugaron), tabla = e.tabla || {}, dl = e.deLaRonda || {};
  const mio = de(tabla, st.yo);
  const { tope, mejores } = mejorRonda(st, e);
  const yoMejor = mejores.includes(st.yo) && tope > 0;
  const mias = mio ? `<div class="panel mis">${cats.map((c, i) => {
    const pts = de(mio, i) || 0, t = limpio(de(de(e.respuestas, st.yo), i));
    return `<div class="mi-fila"><small>${esc(c)}</small><span>${t ? esc(t) : '—'}</span><b class="${pts === 0 ? 'cero' : pts === 50 ? 'rep' : ''}">${pts}</b></div>`;
  }).join('')}</div>` : '';
  const ultima = e.ronda >= totalRondas(e);
  return `<div class="celebra ${yoMejor ? 'mia' : ''}"><span class="etiqueta">Ronda ${e.ronda} · Letra ${esc(e.letra)}</span>
      <h2>${mio ? `+${dl[st.yo] || 0} puntos` : `${esc(nombres(st, mejores))}: ${tope}`}</h2>
      ${yoMejor ? `<p class="sub">${mejores.length > 1 ? '¡Empataste la mejor ronda de la mesa!' : '¡La mejor ronda de la mesa!'}</p>` : mio && tope ? `<p class="sub">La mejor ronda: ${esc(nombres(st, mejores))} con ${tope}</p>` : ''}</div>
    ${mias}
    <span class="etiqueta">Cómo van</span>
    <div class="lista-puntos">${posiciones(st, e).map((x) => filaPuntos(st, e, x, true)).join('')}</div>
    ${st.soyAnfitrion ? `<div class="pie-fijo"><button class="btn pri grande" data-accion="siguiente">${ultima ? 'Ver quién ganó' : `Siguiente ronda (${e.ronda + 1} de ${totalRondas(e)})`}</button></div>`
      : `<p class="sub centrado">${esc(st.nombreAnfitrion || 'El anfitrión')} pasa a la ${ultima ? 'tabla final' : 'siguiente ronda'}.</p>`}`;
}

// Quién hizo más puntos en la ronda (puede haber empate)
function mejorRonda(st, e) {
  const dl = e.deLaRonda || {}, jug = lista(e.jugaron);
  const tope = Math.max(0, ...jug.map((u) => dl[u] || 0));
  return { tope, mejores: tope > 0 ? jug.filter((u) => (dl[u] || 0) === tope) : [] };
}
function nombres(st, uids) {
  const ns = uids.map((u) => nombre(st, u));
  return ns.length > 1 ? `${ns.slice(0, -1).join(', ')} y ${ns[ns.length - 1]}` : ns[0] || '';
}

function final(st, e) {
  const lugares = posiciones(st, e), campeon = lugares[0];
  return `<div class="celebra mia"><span class="etiqueta">Fin de la partida</span><h2>¡Ganó ${esc(campeon?.nombre || '—')}!</h2></div>
    <div class="lista-puntos">${lugares.map((x) => filaPuntos(st, e, x)).join('')}</div>
    ${st.soyAnfitrion ? `<button class="btn pri grande" data-accion="reiniciar">Otra partida</button>
      <button class="btn sec grande" data-accion="al-marcador">Llevar los puntos al marcador</button>
      <button class="btn grande" data-accion="a-sala">Volver a la sala</button>` : `<p class="sub centrado">${esc(st.nombreAnfitrion || 'El anfitrión')} decide qué sigue.</p>`}`;
}

function posiciones(st, e) {
  const p = e.puntos || {};
  const ids = new Set([...lista(e.orden), ...Object.keys(p)]);
  return [...ids].filter((u) => st.jugadores[u] || p[u]).map((u) => ({ uid: u, nombre: nombre(st, u), color: colorDe(st, u), puntos: p[u] || 0, conectado: !!st.jugadores[u]?.conectado }))
    .sort((a, b) => b.puntos - a.puntos || a.nombre.localeCompare(b.nombre, 'es'));
}
function filaPuntos(st, e, x, conRonda = false) {
  const n = lista(e.categorias).length;
  let marca = '';
  if (e.fase === 'escribiendo' && (e.avance || {})[x.uid]) marca = `<span class="insignia ${(e.avance[x.uid] >= n) ? 'listo' : ''}">${e.avance[x.uid]}/${n}</span>`;
  if (e.fase === 'revisando' && (e.listos || {})[x.uid]) marca = '<span class="insignia listo">Listo</span>';
  const mas = conRonda && e.deLaRonda?.[x.uid] != null ? `<span class="mas">+${e.deLaRonda[x.uid]}</span>` : '';
  return `<div class="fila-puntos ${x.conectado ? '' : 'fuera'} ${x.uid === st.yo ? 'yo' : ''}"><span class="av" style="background:${esc(x.color)}">${inicial(x.nombre)}</span><b>${esc(x.nombre)}</b>${marca}${mas}<span class="pts">${x.puntos}</span></div>`;
}
function tablaPuntos(st, e) {
  if (e.tipo !== 'basta' || !['escribiendo', 'revisando'].includes(e.fase)) return '';
  return `<details class="panel puntos" ${ui.verPuntos ? 'open' : ''} data-accion="ver-puntos"><summary>Puntos · ronda ${e.ronda} de ${totalRondas(e)}</summary><div class="lista-puntos">${posiciones(st, e).map((x) => filaPuntos(st, e, x)).join('')}</div></details>`;
}

// ------------------------------------------------------------ pantalla (tele, laptop, Chromecast)
function pintarPantalla(st, e) {
  const lugares = posiciones(st, e), cats = lista(e.categorias);
  let centro = '', pie = '', lado = true;
  if (e.tipo !== 'basta' || e.fase === 'preparando' || !e.fase) {
    centro = `<div class="p-letra"><div class="carta letra-carta">B</div><div class="letra-info p-titulo"><h1>Basta</h1><p>${esc(st.nombreAnfitrion || 'El anfitrión')} está preparando la partida.</p></div></div>
      <div class="p-pie">Sale una letra, cada quien llena sus categorías en su celular y quien termine canta ¡Basta!</div>`;
  } else if (e.fase === 'escribiendo') {
    const m = momento(e);
    centro = `<div class="p-letra">
        <div class="carta letra-carta ${m === 'sorteo' ? 'girando' : ''}" ${m === 'sorteo' ? 'data-rueda' : ''}>${m === 'sorteo' ? '?' : esc(e.letra)}</div>
        <div class="letra-info"><span class="etiqueta">${m === 'sorteo' ? 'Sorteando la letra' : 'La letra es'}</span><h1>${m === 'sorteo' ? '…' : `Todo con ${esc(e.letra)}`}</h1>
        ${e.limite && m === 'abierta' ? `<span class="reloj">Quedan <span data-reloj="limite">${reloj(e.limite - ui.sala.db.ahora())}</span></span>` : ''}</div>
      </div>`;
    if (m === 'basta' || m === 'cerrada') {
      centro += `<div class="p-cartel"><b>¡BASTA!</b><span>${e.basta.uid ? `Lo cantó <b>${esc(nombre(st, e.basta.uid))}</b>` : 'Se acabó el tiempo'} · ${m === 'cerrada' ? 'plumas abajo' : `plumas abajo en <b data-reloj="basta">${Math.max(0, Math.ceil((e.basta.hasta - ui.sala.db.ahora()) / 1000))}</b>`}</span></div>`;
    } else {
      centro += `<div class="p-cats">${cats.map((c) => `<span>${esc(c)}</span>`).join('')}</div>`;
      pie = m === 'sorteo' ? 'Prepárense…' : 'El primero que llene todo canta ¡Basta! desde su celular.';
    }
  } else if (e.fase === 'revisando') {
    const cat = e.cat || 0, res = calificar(e, cat);
    centro = `<div class="p-cabeza"><span class="etiqueta">Categoría ${cat + 1} de ${cats.length} · Letra ${esc(e.letra)}</span><h1>${esc(cats[cat])}</h1></div>
      <div class="p-resps">${ordenRevision(st, e, res).map((u) => {
        const r = res[u];
        return `<div class="p-resp ${claseResp(r)}" style="border-top-color:${esc(colorDe(st, u))}"><small>${esc(nombre(st, u))}</small><b>${r.t ? esc(r.t) : 'sin respuesta'}</b><i>${r.pts}${notaResp(r, e) ? ` · ${notaResp(r, e)}` : ''}${r.no.length ? ` · ✕ ${r.no.length}` : ''}</i></div>`;
      }).join('')}</div>`;
    const jug = lista(e.jugaron), listos = e.listos || {}, conectados = st.lista.filter((j) => j.conectado && jug.includes(j.uid));
    pie = `Si una no vale, márquenla en su celular. Listos ${conectados.filter((j) => listos[j.uid]).length} de ${conectados.length}`;
  } else if (e.fase === 'resultados') {
    const jug = lista(e.jugaron), tabla = e.tabla || {}, dl = e.deLaRonda || {};
    const { tope, mejores } = mejorRonda(st, e);
    const filas = lugares.filter((x) => de(tabla, x.uid)).map((x) => `<tr><td><span class="nom"><span class="av" style="background:${esc(x.color)}">${inicial(x.nombre)}</span>${esc(x.nombre)}</span></td>
      ${cats.map((_, i) => { const v = de(de(tabla, x.uid), i) || 0; return `<td class="${v === 100 ? 'cien' : v === 50 ? 'rep' : 'cero'}">${v}</td>`; }).join('')}
      <td class="cien">+${dl[x.uid] || 0}</td><td class="total">${x.puntos}</td></tr>`).join('');
    centro = `<div class="p-cabeza"><span class="etiqueta">Ronda ${e.ronda} de ${totalRondas(e)} · Letra ${esc(e.letra)}</span><h1>${mejores.length ? `${esc(nombres(st, mejores))} ${mejores.length > 1 ? 'hicieron' : 'hizo'} ${tope}` : 'Resultados'}</h1></div>
      <table class="p-tabla"><thead><tr><th>Jugador</th>${cats.map((c) => `<th>${esc(c)}</th>`).join('')}<th>Ronda</th><th>Total</th></tr></thead><tbody>${filas}</tbody></table>`;
    pie = `${esc(st.nombreAnfitrion || 'El anfitrión')} pasa a la ${e.ronda >= totalRondas(e) ? 'tabla final' : 'siguiente ronda'}.`;
    lado = false;
  } else if (e.fase === 'fin') {
    centro = `<div class="p-titulo"><span class="etiqueta">Fin de la partida</span><h1>¡Ganó ${esc(lugares[0]?.nombre || '—')}!</h1></div>`;
  }
  $app.innerHTML = `<div class="pantalla">
    <div class="p-arriba"><span class="marca">La <em>Sobremesa</em> · Basta</span><span>${e.ronda && e.fase !== 'fin' ? `Ronda ${e.ronda} de ${totalRondas(e)}` : ''}</span></div>
    <div class="p-cuerpo">
      <div class="p-centro">${centro}${pie ? `<div class="p-pie">${pie}</div>` : ''}</div>
      ${lado ? `<div class="p-lado"><span class="etiqueta">${e.fase === 'escribiendo' ? 'Cómo van' : 'Puntos'}</span><div class="lista-puntos">${lugares.map((x) => filaPuntos(st, e, x)).join('')}</div></div>` : ''}
    </div>
    ${e.fase === 'resultados' ? '' : `<div class="p-esquina"><canvas id="qr"></canvas><div><span>Para sumarte</span><b>${esc(CODIGO)}</b></div></div>`}
  </div>`;
  dibujarQR(document.getElementById('qr'), direccion('../../sala/', { c: CODIGO }));
}

function dibujarQR(canvas, texto) {
  if (!canvas || typeof qrcode !== 'function') return;
  const q = qrcode(0, 'M'); q.addData(texto); q.make();
  const n = q.getModuleCount(), m = 2;
  canvas.width = canvas.height = n + m * 2;
  const c = canvas.getContext('2d');
  c.fillStyle = token('--carta'); c.fillRect(0, 0, canvas.width, canvas.height);
  c.fillStyle = token('--tinta');
  for (let f = 0; f < n; f++) for (let k = 0; k < n; k++) if (q.isDark(f, k)) c.fillRect(k + m, f + m, 1, 1);
}
let candado = null;
async function mantenerEncendida() {
  try { if (!candado && 'wakeLock' in navigator && document.visibilityState === 'visible') { candado = await navigator.wakeLock.request('screen'); candado.addEventListener('release', () => { candado = null; }); } } catch {}
}
document.addEventListener('visibilitychange', () => {
  if (PANTALLA) mantenerEncendida();
  if (document.visibilityState === 'hidden') guardarHoja(true);
});

// ------------------------------------------------------------ acciones de cada jugador
const R = () => ui.sala.raiz;
async function cantarBasta() {
  const e = ui.st.estado, n = lista(e.categorias).length;
  if (llenas(ui.hoja.r, n) < n) return aviso('Llena todas las categorías primero');
  await guardarHoja(true);
  await ui.sala.db.set(`${R()}/acciones/${ui.sala.uid}/basta`, e.ronda);
  aviso('¡Basta!');
}
async function votar(uid) {
  const e = ui.st.estado, cat = e.cat || 0;
  if (ui.voto.ronda !== e.ronda || ui.voto.cat !== cat) ui.voto = { ronda: e.ronda, cat, no: {} };
  if (ui.voto.no[uid]) delete ui.voto.no[uid]; else ui.voto.no[uid] = true;
  pintar();
  await ui.sala.db.set(`${R()}/acciones/${ui.sala.uid}/voto`, { ronda: e.ronda, cat, no: Object.keys(ui.voto.no).length ? ui.voto.no : null });
}
async function marcarListo() {
  const e = ui.st.estado, cat = e.cat || 0, k = `${e.ronda}-${cat}`;
  const ya = ui.listo === k;
  ui.listo = ya ? null : k;
  pintar();
  await ui.sala.db.set(`${R()}/acciones/${ui.sala.uid}/listo`, ya ? null : { ronda: e.ronda, cat });
}
// El anfitrión junta o separa respuestas que el sistema no reconoció bien
async function ajustar(cambiosPares) {
  const e = ui.st.estado, cat = e.cat || 0, cambios = {};
  for (const [k, v] of Object.entries(cambiosPares)) cambios[`publico/estado/ajustes/${cat}/${k}`] = v;
  await guardar(cambios);
}

// ------------------------------------------------------------ eventos
document.addEventListener('input', (ev) => {
  const t = ev.target;
  if (t.dataset.cat != null) {
    const i = Number(t.dataset.cat), e = ui.st.estado;
    ui.hoja.r[i] = t.value;
    const r = t.closest('.renglon');
    if (r) { r.className = `renglon ${clasesRenglon(t.value, e)}`; r.querySelector('.ojo').textContent = limpio(t.value) && base(t.value)[0] !== base(e.letra) ? `No empieza con ${e.letra}` : ''; }
    refrescarHoja(ui.st, e);
    guardarHoja();
  } else if (t.id === 'nuevaCat') ui.prep.nueva = t.value;
});
document.addEventListener('keydown', (ev) => {
  const t = ev.target;
  if (ev.key === 'Enter' && t.dataset?.cat != null) {
    ev.preventDefault();
    const sig = document.querySelector(`[data-cat="${Number(t.dataset.cat) + 1}"]`);
    if (sig) sig.focus(); else t.blur();
  }
});
document.addEventListener('submit', (ev) => {
  if (ev.target.dataset.accion !== 'form-cat') return;
  ev.preventDefault();
  agregarCategoria(ui.prep.nueva);
});
function agregarCategoria(c) {
  const t = limpio(c).slice(0, 24);
  if (!t) return;
  if (ui.prep.categorias.some((x) => base(x) === base(t))) return aviso('Esa categoría ya está');
  if (ui.prep.categorias.length >= MAX_CAT) return aviso(`Máximo ${MAX_CAT} categorías`);
  ui.prep.categorias.push(t); ui.prep.nueva = ''; guardarPrep(); pintar();
  document.getElementById('nuevaCat')?.focus();
}
document.addEventListener('change', (ev) => {
  if (ev.target.dataset.accion === 'dificiles') { ui.prep.dificiles = ev.target.checked; guardarPrep(); }
});
document.addEventListener('toggle', (ev) => { if (ev.target.dataset?.accion === 'ver-puntos') ui.verPuntos = ev.target.open; }, true);

document.addEventListener('click', async (ev) => {
  if (ev.target.closest('input, label.renglon')) return;
  const b = ev.target.closest('[data-accion]');
  if (!b) { if (ui.menu) { ui.menu = false; pintar(); } return; }
  const st = ui.st, e = st?.estado || {};
  const a = b.dataset.accion;
  if (['ver-puntos', 'dificiles', 'form-cat'].includes(a)) return;
  const falla = (x) => { console.error(x); aviso('No se pudo. Revisa tu conexión.'); };
  switch (a) {
    case 'menu': ui.menu = !ui.menu; pintar(); break;
    case 'a-sala':
      ui.menu = false;
      if (e.fase === 'fin' || e.fase === 'preparando' || confirm('¿Volver a la sala? La partida termina.')) await ui.sala.elegirJuego(null);
      else pintar();
      break;
    case 'reiniciar':
      ui.menu = false;
      if (e.fase === 'fin' || confirm('¿Empezar otra partida? Los puntos de esta se pierden.')) {
        await guardar({ 'publico/estado': { tipo: 'basta', fase: 'preparando', opciones: e.opciones || OPCIONES, categorias: e.categorias || null }, acciones: null });
      } else pintar();
      break;
    case 'al-marcador': {
      // Cada ronda de Basta queda como una ronda del marcador, con su letra
      const { estadoInicial } = await import('../../marcador/sala-marcador.js');
      const est = estadoInicial(), puntos = {};
      const hist = lista(e.historial);
      est.titulo = 'Basta';
      est.rondas = hist.map((h, i) => ({ id: Math.random().toString(36).slice(2, 10), nombre: `Letra ${h.letra || i + 1}` }));
      if (!est.rondas.length) est.rondas = [{ id: 'basta', nombre: 'Basta' }];
      posiciones(st, e).forEach((x, i) => {
        est.jugadores[x.uid] = { nombre: x.nombre, color: x.color, orden: i, ...(st.jugadores[x.uid] ? {} : { extra: true }) };
        const fila = {};
        hist.forEach((h, k) => { const v = h.puntos?.[x.uid]; if (v != null) fila[est.rondas[k].id] = String(v); });
        if (!hist.length) fila[est.rondas[0].id] = String(x.puntos);
        if (Object.keys(fila).length) puntos[x.uid] = fila;
      });
      await ui.sala.db.update(ui.sala.raiz, { 'publico/juego': 'marcador', 'publico/estado': est, 'publico/puntos': puntos, secreto: null, acciones: null, 'publico/actividad': ui.sala.db.marcaTiempo() });
      break;
    }
    // Preparar
    case 'quitar-cat': ui.prep.categorias.splice(Number(b.dataset.i), 1); guardarPrep(); pintar(); break;
    case 'sugerida': agregarCategoria(b.dataset.c); break;
    case 'rondas': ui.prep.rondas = Math.min(15, Math.max(1, ui.prep.rondas + Number(b.dataset.d))); guardarPrep(); pintar(); break;
    case 'tiempo': ui.prep.tiempo = Number(b.dataset.s); guardarPrep(); pintar(); break;
    case 'empezar': b.disabled = true; await empezar().catch(falla); pintar(); break;
    // Jugar
    case 'basta': b.disabled = true; await cantarBasta().catch(falla); break;
    case 'voto': await votar(b.dataset.uid).catch(falla); break;
    case 'listo': await marcarListo().catch(falla); break;
    case 'forzar': forzarCat = `${e.ronda}-${e.cat || 0}`; motor(); break;
    case 'juntar': ui.juntando = b.dataset.uid; pintar(); break;
    case 'cancelar-juntar': ui.juntando = null; pintar(); break;
    case 'juntar-aqui': {
      const otro = ui.juntando; ui.juntando = null;
      await ajustar({ [par(otro, b.dataset.uid)]: true }).catch(falla);
      break;
    }
    case 'separar': {
      // Se separa de todas las de su grupo
      const u = b.dataset.uid, res = calificar(e, e.cat || 0), cambios = {};
      for (const [v, r] of Object.entries(res)) if (v !== u && r.grupo && r.grupo === res[u].grupo) cambios[par(u, v)] = false;
      await ajustar(cambios).catch(falla);
      break;
    }
    case 'siguiente': b.disabled = true; await siguienteRonda().catch(falla); break;
  }
});

iniciar().catch((x) => {
  console.error(x);
  $app.innerHTML = `<div class="centro"><h1 class="titulo">No pudimos abrir el juego</h1><p class="sub">Revisa tu conexión a internet e intenta de nuevo.</p><a class="btn sec grande" href="${esc(direccion('../../'))}">Volver al inicio</a></div>`;
});
