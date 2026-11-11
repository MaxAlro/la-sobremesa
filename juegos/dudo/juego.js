// La Sobremesa · Dudo
// ------------------------------------------------------------
// Cada quien tiene dados ocultos que solo ve en su celular. Por turnos se apuesta cuántos dados
// de un número hay en toda la mesa ("hay 5 cuatros"). Quien no cree la apuesta dice ¡Dudo!: se
// ven todos los dados y quien se equivocó pierde uno. Gana quien se queda con dados al final.
//
// Reglas de esta versión:
//   · Sin comodín: el 1 vale 1, como cualquier otro número.
//   · Para seguir la apuesta: más dados de cualquier número, o la misma cantidad con otro número
//     que nadie haya dicho con esa cantidad en la ronda. Ningún número vale más que otro.
//   · ¡Calzo! (opcional): quien tiene el turno dice que hay exactamente lo apostado. Si atina,
//     recupera un dado (hasta los del inicio); si no, pierde uno.
//   · Quien pierde un dado empieza la siguiente ronda (si queda fuera, empieza quien sigue).
//   · Ronda de un dado (opcional): la primera vez que alguien se queda con un dado, empieza la
//     ronda siguiente y en ella nadie puede cambiar de número: solo se sube la cantidad.
//   · Puntos por lugar: el ganador se lleva tantos como jugadores menos uno; el primero en caer, 0.
//
// Dónde vive cada cosa (dentro de salas/<CODIGO>):
//   publico/estado   lo escribe el anfitrión:
//                    { tipo: 'dudo', fase: preparando | apostando | desenlace | fin,
//                      opciones { dados, calzar, unDado }, partida, ronda, reparto (id de la ronda),
//                      orden [] (como están sentados), dados { uid: cuántos le quedan }, fuera [] (en el
//                      orden en que cayeron), abre (quien empezó la ronda), turno (uid), apuestas [{ u, c, n }],
//                      obligada (ronda de un dado), conUno { uid } (ya tuvieron su ronda de un dado),
//                      desenlace { t: dudo | calzo, u, apuesta { u, c, n }, hay, manos { uid: [] }, pierde, gana },
//                      lugares [], deLaPartida { uid: pts }, puntos { uid }, historial [{ puntos }] }
//   secreto          solo lo lee el anfitrión: { reparto, manos { uid: [] } }
//   privado/<uid>/dados   los dados de cada quien: { reparto, d [] }
//   acciones/<uid>/jugada  { reparto, i (cuántas apuestas había), t: apuesta | dudo | calzo, c, n }
//
// Las reglas las aplica el celular del anfitrión (función motor). Si se desconecta, el control
// pasa a otro jugador y su celular sigue desde donde iba.

import { abrirSala, existeSala, codigoValido } from '../../nucleo/sala.js';

const Q = new URLSearchParams(location.search);
const CODIGO = (Q.get('sala') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
const PANTALLA = Q.get('rol') === 'pantalla';
const DE_PRUEBA = ['local', 'sdk', 'emulador', 'emuauth'];

const MIN_JUG = 2;
const OPCIONES = { dados: 5, calzar: true, unDado: true };
const PREP_GUARDADA = 'sobremesa-dudo-prep';
const UNO = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis'];
const VARIOS = ['', 'unos', 'doses', 'treses', 'cuatros', 'cincos', 'seises'];
const PUNTOS_CARA = { 1: [[50, 50]], 2: [[28, 28], [72, 72]], 3: [[28, 28], [50, 50], [72, 72]], 4: [[28, 28], [72, 28], [28, 72], [72, 72]], 5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]], 6: [[28, 26], [72, 26], [28, 50], [72, 50], [28, 74], [72, 74]] };

const $app = document.getElementById('app');
const css = getComputedStyle(document.documentElement);
const token = (n) => css.getPropertyValue(n).trim();
const esc = (s) => String(s ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const inicial = (n) => esc(String(n || '?').trim().charAt(0).toUpperCase());
// Firebase puede devolver una lista como objeto { 0: …, 2: … }: esto lee igual ambos
const lista = (v) => (Array.isArray(v) ? v : Object.keys(v || {}).sort((a, b) => a - b).map((k) => v[k])).filter((x) => x !== null && x !== undefined);
const nn = (o) => (o && Object.keys(o).length ? o : null);
const nuevoId = () => Math.random().toString(36).slice(2, 10);
const tirar = (k) => { const r = new Uint32Array(k); crypto.getRandomValues(r); return [...r].map((x) => (x % 6) + 1); };
const azar = (xs) => xs[Math.floor(Math.random() * xs.length)];

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

// ------------------------------------------------------------ reglas puras (se pueden probar solas)
export const dicho = (c, n) => `${c} ${c === 1 ? UNO[n] : VARIOS[n]}`;

// ¿Se puede apostar c dados de n después de estas apuestas? Devuelve null si sí, o el motivo.
export function revisar(apuestas, c, n, { total = 99, obligada = false } = {}) {
  const ap = lista(apuestas), prev = ap[ap.length - 1];
  if (!Number.isInteger(c) || !Number.isInteger(n) || n < 1 || n > 6 || c < 1) return 'Apuesta incompleta';
  if (c > total) return `En la mesa solo hay ${total} dados`;
  if (!prev) return null;
  if (obligada) {
    if (n !== ap[0].n) return `En la ronda de un dado no se cambia de número: ${VARIOS[ap[0].n]}`;
    return c > prev.c ? null : `Tienes que subir a ${prev.c + 1} o más`;
  }
  if (c > prev.c) return null;
  if (c < prev.c) return `No se puede bajar de ${prev.c}`;
  if (ap.some((a) => a.c === c && a.n === n)) return `Ya se dijo ${dicho(c, n)}`;
  return null;
}

// Números que todavía se pueden decir con la cantidad c
export function libres(apuestas, c, opts = {}) {
  return [1, 2, 3, 4, 5, 6].filter((n) => !revisar(apuestas, c, n, opts));
}

// La cantidad más chica que se puede apostar ahora
export function minimo(apuestas, opts = {}) {
  const ap = lista(apuestas), prev = ap[ap.length - 1];
  if (!prev) return 1;
  return libres(ap, prev.c, opts).length ? prev.c : prev.c + 1;
}

export const contarCara = (manos, n) => Object.values(manos || {}).reduce((s, d) => s + lista(d).filter((x) => x === n).length, 0);

// Qué pasa al dudar o calzar. Devuelve { hay, pierde, gana }
export function resolver(t, quien, apuesta, manos) {
  const hay = contarCara(manos, apuesta.n);
  if (t === 'calzo') return hay === apuesta.c ? { hay, pierde: null, gana: quien } : { hay, pierde: quien, gana: null };
  return hay < apuesta.c ? { hay, pierde: apuesta.u, gana: null } : { hay, pierde: quien, gana: null };
}

// El siguiente en la mesa (en el orden en que están sentados) que todavía tiene dados
export function siguiente(orden, dados, desde) {
  const o = lista(orden), i = o.indexOf(desde);
  for (let k = 1; k <= o.length; k++) { const u = o[(i + k) % o.length]; if ((dados[u] || 0) > 0) return u; }
  return null;
}

// Puntos por lugar: lugares va del ganador al primero en caer
export function puntosPorLugar(lugares) {
  const ls = lista(lugares), n = ls.length;
  return Object.fromEntries(ls.map((u, i) => [u, n - 1 - i]));
}

// ------------------------------------------------------------ estado de esta página
const ui = {
  sala: null, st: null, activo: false,
  acciones: {}, accionesListas: false, secreto: null, secretoListo: false,
  mis: null, c: null, n: null, armado: null, menu: false, prep: null, avisado: null
};

function prepGuardada() { try { return JSON.parse(localStorage.getItem(PREP_GUARDADA) || 'null'); } catch { return null; } }
function guardarPrep() { try { localStorage.setItem(PREP_GUARDADA, JSON.stringify({ dados: ui.prep.dados, calzar: ui.prep.calzar, unDado: ui.prep.unDado })); } catch {} }
function iniciarPrep(e) {
  if (!ui.prep) ui.prep = { ...OPCIONES, ...(prepGuardada() || {}), ...(e.opciones || {}), orden: lista(e.orden) };
  // El orden de la mesa: los que ya estaban, en su lugar; los nuevos, al final
  const con = ui.st.lista.filter((j) => j.conectado).map((j) => j.uid);
  ui.prep.orden = ui.prep.orden.filter((u) => con.includes(u)).concat(con.filter((u) => !ui.prep.orden.includes(u)));
}

async function iniciar() {
  if (!codigoValido(CODIGO) || !(await existeSala(CODIGO))) return irSala();
  let primera = true, resolverListo;
  const listo0 = new Promise((r) => { resolverListo = r; });
  const sala = await abrirSala(CODIGO, {
    alCambiar: (st) => { if (primera) { primera = false; resolverListo(st); } else if (ui.activo) cambio(st); },
    alPerder: irSala
  });
  const st0 = await listo0;
  if (PANTALLA) await sala.entrarComo('pantalla');
  else if (st0.jugadores[sala.uid]) await sala.entrarComo('jugador', { nombre: st0.jugadores[sala.uid].nombre, color: st0.jugadores[sala.uid].color });
  else { sala.cerrar(); return irSala(); }
  ui.sala = sala; ui.activo = true;
  window.__juego = { ui, sala, revisar, libres, minimo, resolver, siguiente, puntosPorLugar }; // para pruebas
  if (!PANTALLA) sala.db.on(`${sala.raiz}/privado/${sala.uid}/dados`, (v) => { ui.mis = v; pintar(); });
  document.body.classList.toggle('modo-pantalla', PANTALLA);
  if (PANTALLA) mantenerEncendida();
  cambio(sala.estado());
}

let apagarHost = null;
function vigilarHost(soy) {
  if (soy && !apagarHost) {
    const R = ui.sala.raiz;
    const a = ui.sala.db.on(`${R}/acciones`, (v) => { ui.acciones = v || {}; ui.accionesListas = true; motor(); });
    const s = ui.sala.db.on(`${R}/secreto`, (v) => { ui.secreto = v || {}; ui.secretoListo = true; motor(); });
    apagarHost = () => { a(); s(); ui.accionesListas = false; ui.secretoListo = false; };
  } else if (!soy && apagarHost) { apagarHost(); apagarHost = null; }
}

function cambio(st) {
  if (!st) return;
  if (st.juego !== 'dudo') return irSala();
  if (st.rol === 'jugador' && !st.jugadores[st.yo]) return irSala();
  const antes = ui.st?.estado || {};
  ui.st = st;
  const e = st.estado || {};
  const nAp = lista(e.apuestas).length;
  if (e.reparto !== antes.reparto || nAp !== lista(antes.apuestas).length || e.turno !== antes.turno) { ui.c = null; ui.n = null; ui.armado = null; }
  if (st.soyAnfitrion && (e.fase === 'preparando' || !e.fase)) iniciarPrep(e);
  // Sin tele, el celular vibra cuando te toca
  if (!PANTALLA && e.fase === 'apostando' && e.turno === st.yo) {
    const k = `${e.reparto}-${nAp}`;
    if (ui.avisado !== k) { ui.avisado = k; try { navigator.vibrate?.(200); } catch {} }
  }
  vigilarHost(st.soyAnfitrion);
  motor();
  pintar();
}

// ------------------------------------------------------------ motor (solo en el celular del anfitrión)
let ocupado = false, otraVez = false, programado = false;
function motor() {
  if (programado) return;
  programado = true;
  setTimeout(() => { programado = false; correrMotor(); }, 0);
}
async function correrMotor() {
  if (!ui.st?.soyAnfitrion || !ui.accionesListas || !ui.secretoListo) return;
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
const enEstado = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [`publico/estado/${k}`, v]));
const enMesa = (e) => Object.values(e.dados || {}).reduce((s, k) => s + (k || 0), 0);

async function paso() {
  const e = ui.st.estado || {}, s = ui.secreto || {};
  if (e.tipo !== 'dudo' || e.fase !== 'apostando' || s.reparto !== e.reparto) return;
  const j = (ui.acciones || {})[e.turno]?.jugada;
  const ap = lista(e.apuestas);
  if (!j || j.reparto !== e.reparto || j.i !== ap.length) return;
  if (j.t === 'apuesta') {
    if (revisar(ap, j.c, j.n, { total: enMesa(e), obligada: !!e.obligada })) return;
    const apuestas = ap.concat([{ u: e.turno, c: j.c, n: j.n }]);
    await guardar(enEstado({ apuestas, turno: siguiente(e.orden, e.dados, e.turno) }));
    return;
  }
  if (!ap.length || (j.t !== 'dudo' && j.t !== 'calzo') || (j.t === 'calzo' && !e.opciones?.calzar)) return;
  const apuesta = ap[ap.length - 1], manos = s.manos || {};
  const r = resolver(j.t, e.turno, apuesta, manos);
  const dados = { ...e.dados }, fuera = lista(e.fuera);
  if (r.pierde) dados[r.pierde] = Math.max(0, (dados[r.pierde] || 0) - 1);
  const tope = !!r.gana && (dados[r.gana] || 0) >= (e.opciones?.dados || 5);
  if (r.gana && !tope) dados[r.gana] = (dados[r.gana] || 0) + 1;
  if (r.pierde && !dados[r.pierde] && !fuera.includes(r.pierde)) fuera.push(r.pierde);
  const desenlace = { t: j.t, u: e.turno, apuesta, hay: r.hay, manos, pierde: r.pierde, gana: r.gana, tope: tope || null };
  await guardar(enEstado({ fase: 'desenlace', turno: null, dados, fuera: fuera.length ? fuera : null, desenlace }));
}

// ------------------------------------------------------------ rondas y partidas (las arranca el anfitrión)
// Reparte una ronda. abre: quien empieza; obligada: ronda de un dado
async function repartir(e, abre, obligada, conUno) {
  const vivos = lista(e.orden).filter((u) => (e.dados[u] || 0) > 0);
  const reparto = nuevoId(), manos = {}, cambios = {};
  for (const u of vivos) manos[u] = tirar(e.dados[u]).sort((a, b) => a - b);
  for (const j of ui.st.lista) cambios[`privado/${j.uid}/dados`] = manos[j.uid] ? { reparto, d: manos[j.uid] } : null;
  cambios.secreto = { reparto, manos };
  cambios.acciones = null;
  cambios['publico/estado'] = {
    ...e, fase: 'apostando', ronda: (e.ronda || 0) + 1, reparto, abre, turno: abre, apuestas: null, desenlace: null,
    obligada: obligada || null, conUno: nn(conUno)
  };
  await guardar(cambios);
}

// Después de un desenlace: quién empieza y si toca ronda de un dado
async function siguienteRonda() {
  const e = ui.st.estado, d = e.desenlace || {};
  const vivos = lista(e.orden).filter((u) => (e.dados[u] || 0) > 0);
  if (vivos.length <= 1) return terminar(e);
  const quien = d.pierde || d.gana;
  const abre = (e.dados[quien] || 0) > 0 ? quien : siguiente(e.orden, e.dados, quien);
  const conUno = { ...(e.conUno || {}) };
  let obligada = false;
  if (e.opciones?.unDado && d.pierde && e.dados[d.pierde] === 1 && !conUno[d.pierde]) { obligada = true; conUno[d.pierde] = true; }
  await repartir(e, abre, obligada, conUno);
}

async function terminar(e) {
  const vivos = lista(e.orden).filter((u) => (e.dados[u] || 0) > 0);
  const lugares = vivos.concat(lista(e.fuera).slice().reverse());
  const pts = puntosPorLugar(lugares);
  const puntos = { ...(e.puntos || {}) };
  for (const [u, v] of Object.entries(pts)) puntos[u] = (puntos[u] || 0) + v;
  const historial = lista(e.historial).concat([{ puntos: pts }]);
  await guardar({ ...enEstado({ fase: 'fin', turno: null, lugares, deLaPartida: pts, puntos, historial }), secreto: null, acciones: null });
}

async function nuevaPartida(opciones, orden, e) {
  const con = ui.st.lista.filter((j) => j.conectado).map((j) => j.uid);
  orden = lista(orden).filter((u) => con.includes(u)).concat(con.filter((u) => !lista(orden).includes(u)));
  if (orden.length < MIN_JUG) return aviso(`Se necesitan al menos ${MIN_JUG} jugadores`);
  const dados = Object.fromEntries(orden.map((u) => [u, opciones.dados]));
  const base = { tipo: 'dudo', opciones, partida: (e.partida || 0) + 1, ronda: 0, orden, dados, fuera: null, puntos: e.puntos || null, historial: e.historial || null };
  await repartir(base, azar(orden), false, {});
}

async function empezar() {
  const p = ui.prep;
  guardarPrep();
  await nuevaPartida({ dados: p.dados, calzar: !!p.calzar, unDado: !!p.unDado }, p.orden, ui.st.estado || {});
}

// El anfitrión saca a alguien que se fue: queda fuera y la ronda se reparte de nuevo
async function sacar(uid) {
  const e = ui.st.estado;
  const dados = { ...e.dados, [uid]: 0 }, fuera = lista(e.fuera).filter((u) => u !== uid).concat([uid]);
  const e2 = { ...e, dados, fuera, ronda: Math.max(0, (e.ronda || 1) - 1) };
  const vivos = lista(e.orden).filter((u) => dados[u] > 0);
  if (vivos.length <= 1) return terminar(e2);
  const abre = dados[e.abre] > 0 ? e.abre : siguiente(e.orden, dados, e.abre);
  await repartir(e2, abre, !!e.obligada && dados[e.abre] > 0, e.conUno);
}

// ------------------------------------------------------------ dibujos
function dado(n, clase = '') {
  const pts = (PUNTOS_CARA[n] || []).map(([x, y]) => `<circle cx="${x}" cy="${y}" r="9.5"/>`).join('');
  return `<svg class="dado ${clase}" viewBox="0 0 100 100" role="img" aria-label="${UNO[n] || ''}"><rect x="5" y="5" width="90" height="90" rx="20"/>${pts}</svg>`;
}
const vasitos = (k, total) => `<span class="vasitos" aria-label="${k} dados">${'<i></i>'.repeat(Math.max(0, k))}${'<i class="vacio"></i>'.repeat(Math.max(0, total - k))}</span>`;
const apuestaHtml = (a, clase = '') => (a ? `<span class="apuesta ${clase}"><b>${a.c}</b><span class="por">×</span>${dado(a.n)}</span>` : '');

// ------------------------------------------------------------ pintar
const nombre = (st, uid) => st.jugadores[uid]?.nombre || '—';
const colorDe = (st, uid) => st.jugadores[uid]?.color || token('--jugador-1');
const avatar = (st, uid) => `<span class="av" style="background:${esc(colorDe(st, uid))}">${inicial(nombre(st, uid))}</span>`;
const enPartida = (st, e) => lista(e.orden).includes(st.yo);
const misDados = (e) => (ui.mis && ui.mis.reparto === e.reparto ? lista(ui.mis.d) : null);
const tu = (st, u, Tu = 'Tú') => (u === st.yo ? Tu : esc(nombre(st, u)));

function pintar() {
  const st = ui.st;
  if (!st) return;
  const e = st.estado || {};
  if (PANTALLA) return pintarPantalla(st, e);
  $app.innerHTML = `<main class="jugador">${barra(st, e)}${cuerpo(st, e)}</main>`;
}

function barra(st, e) {
  const enJuego = e.fase && e.fase !== 'preparando';
  return `<div class="barra">
    <a class="marca" href="${esc(direccion('../../'))}">La <em>Sobremesa</em></a>
    <div class="barra-der">
      <span class="codigo-mini">${esc(CODIGO)}</span>
      ${st.soyAnfitrion ? `<div class="envoltura-menu"><button class="rol" data-accion="menu" aria-expanded="${ui.menu}">Anfitrión ▾</button>${ui.menu ? `<div class="menu" role="menu">
        ${e.fase === 'apostando' ? '<button data-accion="repetir">Repartir de nuevo esta ronda</button>' : ''}
        ${enJuego ? '<button data-accion="ajustes">Cambiar ajustes</button>' : ''}
        ${enJuego || e.puntos ? '<button data-accion="reiniciar">Empezar de cero</button>' : ''}
        <button data-accion="a-sala">Volver a la sala</button>
      </div>` : ''}</div>` : ''}
    </div>
  </div>`;
}

function cuerpo(st, e) {
  if (e.tipo !== 'dudo' || e.fase === 'preparando' || !e.fase) return preparar(st, e);
  if (e.fase === 'fin') return fin(st, e);
  if (!enPartida(st, e)) return mirando(st, e);
  if (e.fase === 'apostando') return apostando(st, e);
  if (e.fase === 'desenlace') return desenlace(st, e);
  return '';
}

const reglasCortas = () => `<details class="panel reglas"><summary>Cómo se juega</summary><ol>
  <li>Cada quien tiene sus dados ocultos y los ve solo en su celular, manteniendo el dedo encima.</li>
  <li>Por turnos se apuesta cuántos dados de un número hay en toda la mesa, contando los de todos: "hay 5 cuatros". No hay comodín: el 1 vale 1.</li>
  <li>Para seguir, di más dados de cualquier número, o la misma cantidad con otro número que nadie haya dicho con esa cantidad en la ronda. Después de 5 cuatros vale 6 doses o 5 unos, pero no 4 seises.</li>
  <li>Si no crees la apuesta, di ¡Dudo! Se ven todos los dados: si hay menos de lo apostado, pierde un dado quien apostó; si hay lo apostado o más, pierde un dado quien dudó.</li>
  <li>¡Calzo! (si está activado): dices que hay exactamente lo apostado. Si atinas, recuperas un dado; si no, pierdes uno.</li>
  <li>Quien pierde un dado empieza la siguiente ronda. Sin dados, quedas fuera.</li>
  <li>Ronda de un dado (si está activada): la primera vez que alguien se queda con un dado, esa persona empieza y en esa ronda nadie puede cambiar de número; solo se sube la cantidad.</li></ol>
  <p>Puntos</p><ul>
  <li>Gana quien se queda con dados al final.</li>
  <li>Por lugar: el ganador se lleva tantos puntos como jugadores menos uno; el primero en caer, 0.</li></ul></details>`;

function preparar(st, e) {
  const conservados = e.puntos && Object.values(e.puntos).some((v) => v);
  if (!st.soyAnfitrion) {
    return `<div class="panel espera"><h1 class="titulo">Dudo</h1><p>Esperando a que <b>${esc(st.nombreAnfitrion || 'el anfitrión')}</b> prepare la partida…</p></div>${reglasCortas()}`;
  }
  iniciarPrep(e);
  const p = ui.prep, n = p.orden.length;
  const filas = p.orden.map((u, i) => `<div class="turno"><span class="num">${i + 1}</span>${avatar(st, u)}<b>${tu(st, u)}</b>
      <button class="mover" data-accion="subir" data-i="${i}" aria-label="Subir a ${esc(nombre(st, u))}" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button class="mover" data-accion="bajar" data-i="${i}" aria-label="Bajar a ${esc(nombre(st, u))}" ${i === n - 1 ? 'disabled' : ''}>↓</button></div>`).join('');
  return `<div class="panel prep">
    <h1 class="titulo">Dudo</h1>
    <span class="etiqueta">Orden de la mesa · como están sentados</span>
    <div class="orden">${filas}</div>
    <span class="etiqueta">Dados por jugador</span>
    <div class="segmentos">${[5, 4, 3].map((k) => `<button class="btn" data-accion="dados" data-k="${k}" aria-pressed="${p.dados === k}">${k}</button>`).join('')}</div>
    <label class="modo ${p.calzar ? 'on' : ''}"><input type="checkbox" data-accion="calzar" ${p.calzar ? 'checked' : ''}><span><b>Se vale calzar</b><small>En tu turno dices que hay exactamente lo apostado. Si atinas, recuperas un dado; si no, pierdes uno.</small></span></label>
    <label class="modo ${p.unDado ? 'on' : ''}"><input type="checkbox" data-accion="unDado" ${p.unDado ? 'checked' : ''}><span><b>Ronda de un dado</b><small>Cuando alguien se queda con un dado, empieza esa ronda y nadie puede cambiar de número: solo se sube la cantidad.</small></span></label>
    ${conservados ? '<p class="sub">Los puntos de las partidas anteriores se conservan.</p>' : ''}
  </div>
  <div class="pie"><button class="btn pri grande" data-accion="empezar" ${n >= MIN_JUG ? '' : 'disabled'}>${n < MIN_JUG ? `Falta ${MIN_JUG - n} para empezar` : `Empezar con ${n}`}</button></div>
  ${reglasCortas()}`;
}

function mirando(st, e) {
  return `<div class="panel espera"><h1 class="titulo">Dudo</h1><p>Te sumaste a media partida. Juegas desde la siguiente.</p></div>${mesa(st, e)}${reglasCortas()}`;
}

// Los dados de cada quien y cuántos le quedan
function mesa(st, e, conTurno = true) {
  const total = e.opciones?.dados || 5;
  return `<div class="orden">${lista(e.orden).map((u) => {
    const k = (e.dados || {})[u] || 0, ahora = conTurno && e.turno === u;
    return `<div class="turno ${ahora ? 'ahora' : ''} ${k ? '' : 'cayo'}">${avatar(st, u)}<b>${tu(st, u)}</b>${vasitos(k, total)}<small>${ahora ? 'Le toca' : k ? '' : 'Fuera'}</small></div>`;
  }).join('')}</div>`;
}

// Los dados propios: se ven solo mientras se mantiene el dedo encima
function tapadera(e) {
  const d = misDados(e);
  const cara = d ? `<span class="lbl">Tus dados</span><div class="mis-dados">${d.map((x) => dado(x)).join('')}</div><span class="desc">Nadie más los ve.</span>` : '<span class="lbl">Repartiendo…</span>';
  return `<div class="carta-secreta" data-ver-carta role="button" tabindex="0" aria-label="Mantén presionado para ver tus dados">
    <div class="tapa"><span class="vaso">?</span><b>Mantén el dedo aquí</b><small>para ver tus dados</small></div>
    <div class="cara">${cara}</div>
  </div>`;
}
const vistazo = (e) => `<button class="btn grande ver-palabra" data-ver-carta>Mantén aquí para ver tus dados</button><div class="vistazo">${tapadera(e)}</div>`;

function ultimas(st, e) {
  const ap = lista(e.apuestas).slice(-4).reverse();
  if (!ap.length) return '';
  return `<div class="historial">${ap.map((a, i) => `<div class="hist ${i ? 'vieja' : ''}">${avatar(st, a.u)}<span>${tu(st, a.u)}</span>${apuestaHtml(a)}</div>`).join('')}</div>`;
}

function apostando(st, e) {
  const ap = lista(e.apuestas), prev = ap[ap.length - 1], mio = e.turno === st.yo;
  const total = enMesa(e), mios = (e.dados || {})[st.yo] || 0;
  const banda = e.obligada ? `<div class="banda">Ronda de un dado: nadie puede cambiar de número${ap.length ? `, solo subir la cantidad de ${VARIOS[ap[0].n]}` : ''}.</div>` : '';
  const cabeza = `<div class="cabeza"><span class="etiqueta">Ronda ${e.ronda} · ${total} dados en la mesa</span></div>${banda}`;
  if (!mio) {
    const quien = esc(nombre(st, e.turno));
    return `${cabeza}
      <div class="panel en-juego">${prev ? `<span class="etiqueta">${tu(st, prev.u)} ${prev.u === st.yo ? 'apostaste' : 'apostó'} que hay al menos</span>${apuestaHtml(prev, 'grande')}` : `<span class="etiqueta">Nadie ha apostado</span>`}
        <span class="sub">${prev ? `Le toca a <b>${quien}</b>: subir, dudar${e.opciones?.calzar ? ' o calzar' : ''}.` : `Empieza <b>${quien}</b>.`}</span></div>
      ${mios ? `${tapadera(e)}
      <p class="nota">Tienes ${mios} ${mios === 1 ? 'dado' : 'dados'}. Se ven solo mientras mantienes el dedo.</p>` : '<div class="panel espera"><p>Te quedaste sin dados. Sigues viendo hasta que termine la partida.</p></div>'}
      ${ultimas(st, e)}
      ${mesa(st, e)}
      ${quitarAusente(st, e)}`;
  }
  // Te toca: elegir la apuesta
  const opts = { total, obligada: !!e.obligada };
  const cMin = Math.min(minimo(ap, opts), total);
  let c = ui.c ?? (prev ? (e.obligada ? prev.c + 1 : prev.c + 1) : Math.max(1, Math.round(total / 6)));
  c = Math.max(cMin, Math.min(total, c));
  const validos = libres(ap, c, opts);
  let n = ui.n;
  if (!validos.includes(n)) n = prev && validos.includes(prev.n) ? prev.n : validos[0] ?? null;
  ui.c = c; ui.n = n;
  const caras = [1, 2, 3, 4, 5, 6].map((k) => `<button class="cara-btn" data-accion="cara" data-n="${k}" aria-pressed="${k === n}" aria-label="${VARIOS[k]}" ${validos.includes(k) ? '' : 'disabled'}>${dado(k)}</button>`).join('');
  let ayuda;
  if (!prev) ayuda = 'Di cuántos dados de un número crees que hay en toda la mesa, contando los de todos.';
  else if (e.obligada) ayuda = `Ronda de un dado: solo puedes subir la cantidad de ${VARIOS[ap[0].n]}, a ${prev.c + 1} o más.`;
  else {
    const mismos = libres(ap, prev.c, opts);
    ayuda = mismos.length
      ? `Puedes decir ${prev.c + 1} o más de cualquier número, o quedarte en ${prev.c} con otro número: ${mismos.map((k) => VARIOS[k]).join(', ').replace(/, ([^,]*)$/, ' o $1')}.`
      : `Con ${prev.c} ya se dijeron todos los números: sube a ${prev.c + 1} o más.`;
  }
  const calzar = e.opciones?.calzar;
  const armado = (t) => ui.armado === t;
  return `${cabeza}
    <div class="panel te-toca"><h2 class="titulo">Te toca</h2>${prev ? `<span class="dijo">${tu(st, prev.u)} dijo ${apuestaHtml(prev)}</span>` : '<span class="dijo">Abres la ronda</span>'}</div>
    <span class="etiqueta">Tu apuesta</span>
    <div class="cantidad"><button class="btn grande" data-accion="menos" aria-label="Menos dados" ${c <= cMin ? 'disabled' : ''}>−</button><b aria-live="polite">${c}</b><button class="btn grande" data-accion="mas" aria-label="Más dados" ${c >= total ? 'disabled' : ''}>+</button></div>
    <div class="caras">${caras}</div>
    <p class="nota">${ayuda}</p>
    <button class="btn pri grande" data-accion="apostar" ${n ? '' : 'disabled'}>${n ? `Apostar ${dicho(c, n)}` : 'Elige un número'}</button>
    ${prev ? `<div class="dudar">
      <button class="btn grande dudo ${armado('dudo') ? 'armado' : ''}" data-accion="dudo">${armado('dudo') ? 'Toca otra vez para dudar' : '¡Dudo!'}</button>
      ${calzar ? `<button class="btn grande calzo ${armado('calzo') ? 'armado' : ''}" data-accion="calzo">${armado('calzo') ? 'Toca otra vez para calzar' : '¡Calzo!'}</button>` : ''}
    </div>` : ''}
    ${ultimas(st, e)}
    <div class="pie">${vistazo(e)}</div>`;
}

// Si quien tiene el turno se desconectó, el anfitrión puede sacarlo para no quedarse atorados
function quitarAusente(st, e) {
  if (!st.soyAnfitrion) return '';
  return lista(e.orden).filter((u) => (e.dados || {})[u] > 0 && !st.jugadores[u]?.conectado)
    .map((u) => `<button class="enlace" data-accion="sacar" data-uid="${esc(u)}">${esc(nombre(st, u))} se desconectó: sacarlo de la partida y repartir de nuevo</button>`).join('');
}

function frase(st, e, d) {
  const a = d.apuesta || {}, quien = tu(st, d.u), de = tu(st, a.u, 'ti');
  return d.t === 'calzo' ? `${quien} ${d.u === st.yo ? 'calzaste' : 'calzó'} ${dicho(a.c, a.n)}` : `${quien} ${d.u === st.yo ? 'dudaste' : 'dudó'} de ${de}: ${dicho(a.c, a.n)}`;
}
function resultadoTexto(st, e, d) {
  if (d.gana && d.tope) return `${tu(st, d.gana)} ${d.gana === st.yo ? 'atinaste' : 'atinó'}`;
  if (d.gana) return `${tu(st, d.gana)} ${d.gana === st.yo ? 'recuperas' : 'recupera'} un dado`;
  const k = (e.dados || {})[d.pierde] || 0;
  if (!k) return `${tu(st, d.pierde)} ${d.pierde === st.yo ? 'quedas' : 'queda'} fuera`;
  return `${tu(st, d.pierde)} ${d.pierde === st.yo ? 'pierdes' : 'pierde'} un dado`;
}
function porQue(st, e, d) {
  const a = d.apuesta || {};
  if (d.t === 'calzo') return d.gana ? `Había exactamente ${d.hay}.` : `Había ${d.hay}, no ${a.c}.`;
  return d.hay < a.c ? `Había ${d.hay}: menos de lo apostado.` : `Había ${d.hay}: la apuesta ${d.hay === a.c ? 'era justa' : 'se quedó corta'}.`;
}

function manosHtml(st, e, d) {
  const n = d.apuesta?.n;
  return `<div class="manos">${lista(e.orden).filter((u) => d.manos?.[u]).map((u) => {
    const ds = lista(d.manos[u]), k = ds.filter((x) => x === n).length;
    return `<div class="mano">${avatar(st, u)}<b>${tu(st, u)}</b><span class="fila-dados">${ds.map((x) => dado(x, x === n ? 'marca' : 'apagado')).join('')}</span><span class="cuenta ${k ? 'si' : ''}">${k}</span></div>`;
  }).join('')}</div>`;
}

function desenlace(st, e) {
  const d = e.desenlace || {}, vivos = lista(e.orden).filter((u) => (e.dados[u] || 0) > 0);
  const termina = vivos.length <= 1;
  const quien = d.pierde || d.gana, sigue = (e.dados[quien] || 0) > 0 ? quien : siguiente(e.orden, e.dados, quien);
  return `<div class="panel resumen"><span class="etiqueta">${d.t === 'calzo' ? '¡Calzo!' : '¡Dudo!'} · Ronda ${e.ronda}</span>
      <h2 class="titulo">${resultadoTexto(st, e, d)}</h2>
      <span class="sub">${frase(st, e, d)}. ${porQue(st, e, d)}</span></div>
    ${manosHtml(st, e, d)}
    <span class="etiqueta">Así va la mesa</span>
    ${mesa(st, e, false)}
    ${st.soyAnfitrion ? `<div class="pie"><button class="btn pri grande" data-accion="siguiente-ronda">${termina ? 'Ver quién ganó' : `Siguiente ronda · empieza ${esc(nombre(st, sigue))}`}</button></div>`
      : `<p class="sub centrado">${esc(st.nombreAnfitrion || 'El anfitrión')} reparte la siguiente ronda.</p>`}`;
}

function filasLugares(st, e) {
  const pts = e.deLaPartida || {}, ls = lista(e.lugares), n = ls.length;
  return ls.map((u, i) => {
    const nota = i === 0 ? `Ganó con ${(e.dados || {})[u] || 0} ${(e.dados || {})[u] === 1 ? 'dado' : 'dados'}` : i === n - 1 ? 'Cayó primero' : '';
    return { u, i, nota, pts: pts[u] || 0, total: (e.puntos || {})[u] || 0 };
  });
}

function fin(st, e) {
  const ls = lista(e.lugares), gana = ls[0], filas = filasLugares(st, e);
  const yo = filas.find((x) => x.u === st.yo);
  const partidas = lista(e.historial).length;
  return `<div class="panel resumen"><span class="etiqueta">Fin de la partida ${e.partida || ''}</span><h2 class="titulo">${gana === st.yo ? '¡Ganaste!' : `¡Ganó ${esc(nombre(st, gana))}!`}</h2>
      ${yo ? `<span class="sub">Quedaste en ${yo.i + 1}° lugar${yo.pts ? `: <b class="mas">+${yo.pts}</b>` : ''}.${partidas > 1 ? ` Llevas ${yo.total}.` : ''}</span>` : ''}</div>
    <div class="lista-puntos">${filas.map((x) => `<div class="fila-puntos ${x.u === st.yo ? 'yo' : ''}"><span class="lugar">${x.i + 1}°</span>${avatar(st, x.u)}
      <span class="nom"><b>${esc(nombre(st, x.u))}</b>${x.nota ? `<small>${x.nota}</small>` : ''}</span><span class="ronda ${x.pts ? 'suma' : ''}">+${x.pts}</span>${partidas > 1 ? `<span class="pts">${x.total}</span>` : ''}</div>`).join('')}</div>
    <p class="nota">Cada partida se suma al marcador de la sala al terminar.</p>
    ${st.soyAnfitrion ? `<div class="pie suelto"><button class="btn pri grande" data-accion="otra">Otra partida</button>
      <button class="btn grande" data-accion="ajustes">Cambiar ajustes</button>
      <button class="btn grande" data-accion="al-marcador">Terminar y ver el marcador</button></div>`
      : `<p class="sub centrado">${esc(st.nombreAnfitrion || 'El anfitrión')} decide qué sigue.</p>`}`;
}

// ------------------------------------------------------------ pantalla (tele, laptop, Chromecast)
function pintarPantalla(st, e) {
  let cuerpo = '', esquina = false;
  const total = e.opciones?.dados || 5;
  const filaMesa = (conTurno = true) => `<div class="p-mesa">${lista(e.orden).map((u) => {
    const k = (e.dados || {})[u] || 0, ahora = conTurno && e.turno === u;
    return `<div class="p-lugar ${ahora ? 'ahora' : ''} ${k ? '' : 'cayo'}">${avatar(st, u)}<b>${esc(nombre(st, u))}</b>${vasitos(k, total)}<small>${ahora ? 'Le toca' : k ? `${k} ${k === 1 ? 'dado' : 'dados'}` : 'Fuera'}</small></div>`;
  }).join('')}</div>`;
  if (e.tipo !== 'dudo' || e.fase === 'preparando' || !e.fase) {
    esquina = true;
    cuerpo = `<div class="p-portada"><div class="p-mini">${dado(5, 'uno')}${dado(1, 'dos')}${dado(3, 'tres')}<div class="cubilete">?</div></div>
      <div><h1 class="p-titulo" style="font-size:13vh">Dudo</h1><p class="p-sub">${esc(st.nombreAnfitrion || 'El anfitrión')} está preparando la partida desde su celular.</p>
      <div class="p-pasos"><span>1. Cada quien ve sus dados en secreto, en su celular.</span>
      <span>2. Por turnos se apuesta cuántos dados de un número hay <b>en toda la mesa</b>: "hay 5 cuatros".</span>
      <span>3. Para seguir: di <b>más dados</b> de cualquier número, o <b>los mismos dados</b> de otro número que nadie haya dicho con esa cantidad.</span>
      <span class="p-ejemplo">Si van <b>5 ×</b>${dado(4)} puedes decir <b>6 ×</b>${dado(2)} o <b>5 ×</b>${dado(5)} o <b>5 ×</b>${dado(1)}, pero no <b>4 ×</b>${dado(6)}</span>
      <span>4. Si no crees la apuesta, di <b>¡Dudo!</b> Se cuentan todos los dados: quien se equivocó pierde uno.</span></div></div></div>`;
  } else if (e.fase === 'apostando') {
    const ap = lista(e.apuestas), prev = ap[ap.length - 1];
    const banda = e.obligada ? `<div class="p-banda">Ronda de un dado: nadie puede cambiar de número, solo subir la cantidad.</div>` : '';
    if (!prev) {
      cuerpo = `<span class="etiqueta">Ronda ${e.ronda} · ya se repartieron los dados</span>
        <h1 class="p-titulo" style="font-size:15vh">${enMesa(e)} dados en la mesa</h1>
        <p class="p-sub">Vean sus dados a escondidas. Empieza <b>${esc(nombre(st, e.turno))}</b>.</p>${banda}`;
    } else {
      cuerpo = `<div class="p-dos"><div><span class="etiqueta">${esc(nombre(st, prev.u))} apostó que en la mesa hay al menos</span>
          ${apuestaHtml(prev, 'p-grande')}
          <p class="p-sub" style="color:var(--texto)">Le toca a <b style="color:var(--acento)">${esc(nombre(st, e.turno))}</b>: subir la apuesta, dudar${e.opciones?.calzar ? ' o calzar' : ''}.</p>${banda}</div>
        <div class="p-hist"><span class="etiqueta">Últimas apuestas de la ronda</span>${ap.slice(-6).map((a, i, xs) => `<div class="hist ${i < xs.length - 1 ? 'vieja' : ''}">${avatar(st, a.u)}<span>${esc(nombre(st, a.u))}</span>${apuestaHtml(a)}</div>`).join('')}</div></div>`;
    }
    cuerpo = `<div class="p-cuerpo">${cuerpo}</div>${filaMesa()}`;
  } else if (e.fase === 'desenlace') {
    const d = e.desenlace || {}, a = d.apuesta || {};
    cuerpo = `<div class="p-dos"><div>${manosHtml(st, e, d)}</div>
      <div class="p-veredicto"><span class="etiqueta">${d.t === 'calzo' ? `¡${esc(nombre(st, d.u))} calzó!` : `${esc(nombre(st, d.u))} dudó de ${esc(nombre(st, a.u))}`}</span>
        <div class="p-linea">${d.t === 'calzo' ? 'Calzó' : 'Apostó'} ${apuestaHtml(a)}</div>
        <div class="p-linea">Había <b class="hay">${d.hay}</b></div>
        <h1 class="p-titulo" style="font-size:9vh">${resultadoTexto({ ...st, yo: null }, e, d)}</h1>
        <p class="p-sub">${porQue(st, e, d)}</p></div></div>`;
  } else if (e.fase === 'fin') {
    const ls = lista(e.lugares), filas = filasLugares(st, e), partidas = lista(e.historial).length;
    cuerpo = `<div class="p-dos"><div><div class="p-dados-fin">${dado(6)}${dado(1)}</div><span class="etiqueta">Fin de la partida</span>
        <h1 class="p-titulo" style="font-size:12vh">¡Ganó <span style="color:var(--acento)">${esc(nombre(st, ls[0]))}</span>!</h1>
        <p class="p-sub">Después de ${e.ronda} rondas.</p></div>
      <div><span class="etiqueta">Puntos por lugar · se suman al marcador</span><table class="p-tabla"><tbody>${filas.map((x) => `<tr><td><span class="nom"><span class="lugar">${x.i + 1}°</span>${avatar(st, x.u)}${esc(nombre(st, x.u))}</span></td><td>${esc(x.nota)}</td>
        <td class="${x.pts ? 'suma' : 'cero'}">+${x.pts}</td>${partidas > 1 ? `<td class="total">${x.total}</td>` : ''}</tr>`).join('')}</tbody></table></div></div>`;
  }
  const arriba = e.fase === 'apostando' ? `Ronda ${e.ronda} · ${enMesa(e)} dados en la mesa` : e.fase === 'desenlace' ? `Ronda ${e.ronda}` : e.fase === 'fin' ? `Partida ${e.partida || 1}` : `${st.lista.length} en la mesa`;
  $app.innerHTML = `<div class="pantalla">
    <div class="p-arriba"><span class="marca">La <em>Sobremesa</em> · Dudo</span><span>${arriba}</span></div>
    ${e.fase === 'apostando' ? cuerpo : `<div class="p-cuerpo">${cuerpo}</div>`}
    ${esquina ? `<div class="p-esquina"><canvas id="qr"></canvas><div><span>Para sumarte</span><b>${esc(CODIGO)}</b></div></div>` : ''}
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
document.addEventListener('visibilitychange', () => { if (PANTALLA) mantenerEncendida(); verDados(false); });

// ------------------------------------------------------------ los dados: se ven solo mientras se mantiene el dedo
function verDados(si) { document.body.classList.toggle('viendo-carta', si); }
document.addEventListener('pointerdown', (ev) => {
  if (!ev.target.closest('[data-ver-carta]')) return;
  ev.preventDefault();
  verDados(true);
});
for (const t of ['pointerup', 'pointercancel']) document.addEventListener(t, () => verDados(false));
window.addEventListener('blur', () => verDados(false));
document.addEventListener('contextmenu', (ev) => { if (ev.target.closest('[data-ver-carta]')) ev.preventDefault(); });
document.addEventListener('keydown', (ev) => {
  if ((ev.key === ' ' || ev.key === 'Enter') && ev.target.closest?.('[data-ver-carta]')) { ev.preventDefault(); verDados(true); }
});
document.addEventListener('keyup', (ev) => { if (ev.key === ' ' || ev.key === 'Enter') verDados(false); });

// ------------------------------------------------------------ acciones de cada jugador
const jugar = (t, extra = {}) => {
  const e = ui.st.estado;
  return ui.sala.db.set(`${ui.sala.raiz}/acciones/${ui.sala.uid}/jugada`, { reparto: e.reparto, i: lista(e.apuestas).length, t, ...extra });
};
let desarmar;
function armar(t) {
  ui.armado = t; pintar();
  clearTimeout(desarmar); desarmar = setTimeout(() => { if (ui.armado === t) { ui.armado = null; pintar(); } }, 3500);
}

// ------------------------------------------------------------ eventos
document.addEventListener('change', (ev) => {
  const a = ev.target.dataset.accion;
  if (a === 'calzar' || a === 'unDado') { ui.prep[a] = ev.target.checked; guardarPrep(); pintar(); }
});

document.addEventListener('click', async (ev) => {
  if (ev.target.closest('input, label.modo')) return;
  const b = ev.target.closest('[data-accion]');
  if (!b) { if (ui.menu) { ui.menu = false; pintar(); } return; }
  const st = ui.st, e = st?.estado || {};
  const a = b.dataset.accion;
  if (['calzar', 'unDado'].includes(a)) return;
  const falla = (x) => { console.error(x); aviso('No se pudo. Revisa tu conexión.'); };
  switch (a) {
    case 'menu': ui.menu = !ui.menu; pintar(); break;
    case 'a-sala':
      ui.menu = false;
      if (['preparando', 'fin'].includes(e.fase) || !e.fase || confirm('¿Volver a la sala? La partida termina.')) await ui.sala.elegirJuego(null);
      else pintar();
      break;
    case 'reiniciar':
      ui.menu = false;
      if (confirm('¿Empezar de cero? Los puntos se pierden.')) {
        ui.prep = null;
        await guardar({ 'publico/estado': { tipo: 'dudo', fase: 'preparando', opciones: e.opciones || OPCIONES, orden: e.orden || null }, secreto: null, acciones: null }).catch(falla);
      } else pintar();
      break;
    case 'ajustes':
      ui.menu = false;
      if (e.fase === 'fin' || confirm('¿Cambiar ajustes? Esta partida no cuenta.')) {
        ui.prep = null;
        await guardar({ 'publico/estado': { tipo: 'dudo', fase: 'preparando', opciones: e.opciones || OPCIONES, orden: e.orden || null, puntos: e.puntos || null, historial: e.historial || null, partida: e.fase === 'fin' ? e.partida : (e.partida || 1) - 1 }, secreto: null, acciones: null }).catch(falla);
      } else pintar();
      break;
    case 'repetir':
      ui.menu = false;
      if (confirm('¿Repartir de nuevo? Las apuestas de esta ronda se borran.')) await repartir({ ...e, ronda: (e.ronda || 1) - 1 }, e.abre, !!e.obligada, e.conUno).catch(falla); else pintar();
      break;
    case 'al-marcador': {
      // Cada partida queda como una ronda del marcador
      const { estadoInicial } = await import('../../marcador/sala-marcador.js');
      const est = estadoInicial(), puntos = {};
      const hist = lista(e.historial);
      est.titulo = 'Dudo';
      est.rondas = hist.map((h, i) => ({ id: nuevoId(), nombre: `Partida ${i + 1}` }));
      if (!est.rondas.length) est.rondas = [{ id: 'dudo', nombre: 'Dudo' }];
      const ids = [...new Set([...lista(e.orden), ...Object.keys(e.puntos || {})])].filter((u) => st.jugadores[u] || (e.puntos || {})[u] != null);
      ids.sort((x, y) => ((e.puntos || {})[y] || 0) - ((e.puntos || {})[x] || 0));
      ids.forEach((u, i) => {
        est.jugadores[u] = { nombre: nombre(st, u), color: colorDe(st, u), orden: i, ...(st.jugadores[u] ? {} : { extra: true }) };
        const fila = {};
        hist.forEach((h, k) => { const v = h.puntos?.[u]; if (v != null) fila[est.rondas[k].id] = String(v); });
        if (Object.keys(fila).length) puntos[u] = fila;
      });
      await ui.sala.db.update(ui.sala.raiz, { 'publico/juego': 'marcador', 'publico/estado': est, 'publico/puntos': puntos, secreto: null, acciones: null, 'publico/actividad': ui.sala.db.marcaTiempo() });
      break;
    }
    // Preparar
    case 'subir': case 'bajar': {
      const o = ui.prep.orden, i = Number(b.dataset.i), j = a === 'subir' ? i - 1 : i + 1;
      if (j >= 0 && j < o.length) [o[i], o[j]] = [o[j], o[i]];
      pintar(); break;
    }
    case 'dados': ui.prep.dados = Number(b.dataset.k); guardarPrep(); pintar(); break;
    case 'empezar': b.disabled = true; await empezar().catch(falla); pintar(); break;
    // Jugar
    case 'menos': ui.c = (ui.c || 1) - 1; ui.armado = null; pintar(); break;
    case 'mas': ui.c = (ui.c || 0) + 1; ui.armado = null; pintar(); break;
    case 'cara': ui.n = Number(b.dataset.n); ui.armado = null; pintar(); break;
    case 'apostar': b.disabled = true; await jugar('apuesta', { c: ui.c, n: ui.n }).catch(falla); break;
    case 'dudo': case 'calzo':
      if (ui.armado !== a) { armar(a); break; }
      ui.armado = null; b.disabled = true; await jugar(a).catch(falla); break;
    case 'siguiente-ronda': b.disabled = true; await siguienteRonda().catch(falla); break;
    case 'sacar': if (confirm(`¿Sacar a ${nombre(st, b.dataset.uid)} de la partida? La ronda se reparte de nuevo.`)) await sacar(b.dataset.uid).catch(falla); break;
    case 'otra': b.disabled = true; await nuevaPartida(e.opciones || OPCIONES, e.orden, e).catch(falla); break;
  }
});

iniciar().catch((x) => {
  console.error(x);
  $app.innerHTML = `<div class="centro"><h1 class="titulo">No pudimos abrir el juego</h1><p class="sub">Revisa tu conexión a internet e intenta de nuevo.</p><a class="btn sec grande" href="${esc(direccion('../../'))}">Volver al inicio</a></div>`;
});
