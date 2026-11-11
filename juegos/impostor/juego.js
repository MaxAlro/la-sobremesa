// La Sobremesa · El impostor
// ------------------------------------------------------------
// Todos reciben la misma palabra secreta, menos el impostor. Por turnos, cada quien dice una pista
// en voz alta; luego discuten y votan desde el celular. Si atrapan al impostor, tiene un intento
// para adivinar la palabra.
//
// Puntos: el impostor se salva +3 · lo atrapan pero adivina +2 · lo atrapan y falla: +1 para cada
// uno de los demás y +1 extra a quien votó por el impostor.
//
// Modos: Clásico (el impostor sabe que lo es y solo ve el mazo con su descripción) y Palabra parecida
// (el impostor recibe otra palabra de la misma familia, elegida al azar, y no sabe que es el impostor).
//
// Dónde vive cada cosa (dentro de salas/<CODIGO>):
//   publico/estado   lo escribe el anfitrión:
//                    { tipo: 'impostor', fase: preparando | viendo | pistas | votando | adivinando | resultado,
//                      ronda, reparto (id de la ronda), opciones { mazos [], modo, impostores, vueltas, tiempo },
//                      n (impostores de esta ronda), mazo { nombre, desc }, jugadores [], orden [],
//                      vistos { uid }, turno, vuelta, votacion { etapa, candidatos [], fijos [], plazas },
//                      limite, votaron { uid }, votos1 { uid: [uids] }, votos2, sinDecidir [],
//                      expulsados [{ u, etapa }], atrapados [], adivinaron { uid },
//                      revelacion { impostores [], palabra { p, d }, otra { p, d }, adivinanzas { uid: { t, acierto } } },
//                      deLaRonda { uid: pts }, razones { uid: { t, a [] } }, puntos, puntosAntes, historial [] }
//   secreto          solo lo lee el anfitrión: { reparto, impostores [], palabra, otra, usadas [] }
//   privado/<uid>/carta   la tarjeta de cada quien: { reparto, rol, p, d, mazo, mazoDesc }
//   acciones/<uid>   lo que manda cada jugador: visto (reparto), pista ('reparto-vuelta-turno'),
//                    voto { reparto, etapa, a [] }, adivina { reparto, t }
//
// Los mazos incluidos están en mazos-base.js; los propios viven en Firebase (palabras/<id>) y se
// arman en mazos.html. Las reglas las aplica el celular del anfitrión (función motor). Si se
// desconecta, el control pasa a otro jugador y su celular sigue desde donde iba.

import { abrirSala, existeSala, codigoValido } from '../../nucleo/sala.js';
import { base, parecidas } from '../../nucleo/texto.js';
import { MAZOS_BASE, ELEGIDOS_DE_INICIO } from './mazos-base.js';
import { normalizar, familias } from './formato.js';

const Q = new URLSearchParams(location.search);
const CODIGO = (Q.get('sala') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
const PANTALLA = Q.get('rol') === 'pantalla';
const DE_PRUEBA = ['local', 'sdk', 'emulador', 'emuauth'];

const MIN_JUG = 3, MIN_DOS = 7;  // jugadores para empezar y para jugar con 2 impostores
const DESEMPATE = 60;            // segundos para votar el desempate cuando hay reloj
const OPCIONES = { mazos: ELEGIDOS_DE_INICIO, modo: 'clasico', impostores: 1, vueltas: 2, tiempo: 120 };
const TIEMPOS = [[0, 'Sin límite'], [120, '2 min'], [180, '3 min']];
const PREP_GUARDADA = 'sobremesa-impostor-prep';
const ADIVINA_LARGO = 40;

const $app = document.getElementById('app');
const css = getComputedStyle(document.documentElement);
const token = (n) => css.getPropertyValue(n).trim();
const esc = (s) => String(s ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const inicial = (n) => esc(String(n || '?').trim().charAt(0).toUpperCase());
// Firebase puede devolver una lista como objeto { 0: …, 2: … }: esto lee igual ambos
const lista = (v) => (Array.isArray(v) ? v : Object.keys(v || {}).sort((a, b) => a - b).map((k) => v[k])).filter((x) => x !== null && x !== undefined);
const limpio = (t, n = ADIVINA_LARGO) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const azar = (xs) => xs[Math.floor(Math.random() * xs.length)];
const barajar = (xs) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const nn = (o) => (o && Object.keys(o).length ? o : null);
const igual = (a, b) => JSON.stringify(ordenar(a ?? null)) === JSON.stringify(ordenar(b ?? null));
function ordenar(v) {
  if (Array.isArray(v)) return v.map(ordenar);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, ordenar(v[k])]));
  return v;
}
const reloj = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const nuevoId = () => Math.random().toString(36).slice(2, 10);

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
// Cuenta los votos. Si el corte cae en un empate, devuelve quiénes empataron y cuántos lugares quedan.
export function contar(votos, candidatos, plazas) {
  const conteo = Object.fromEntries(candidatos.map((u) => [u, 0]));
  for (const a of Object.values(votos || {})) for (const u of new Set(lista(a))) if (u in conteo) conteo[u]++;
  const con = candidatos.filter((u) => conteo[u] > 0).sort((a, b) => conteo[b] - conteo[a]);
  if (con.length <= plazas) return { conteo, elegidos: con, empatados: [], libres: 0 };
  const corte = conteo[con[plazas - 1]];
  const arriba = con.filter((u) => conteo[u] > corte), enCorte = con.filter((u) => conteo[u] === corte);
  if (arriba.length + enCorte.length === plazas) return { conteo, elegidos: arriba.concat(enCorte), empatados: [], libres: 0 };
  return { conteo, elegidos: arriba, empatados: enCorte, libres: plazas - arriba.length };
}

// Sin "el", "la", "un"… al principio: "el pozole" cuenta como "pozole"
const sinArticulo = (t) => String(t ?? '').trim().replace(/^(el|la|los|las|un|una|unos|unas)\s+/i, '');
export const acierta = (intento, palabra) => !!limpio(intento) && (base(sinArticulo(intento)) === base(sinArticulo(palabra)) || parecidas(sinArticulo(intento), sinArticulo(palabra)));

// Puntos de la ronda a partir de lo que pasó: { pts { uid }, razones { uid: { t, a } } }
export function calcular(e) {
  const jug = lista(e.jugadores), rev = e.revelacion || {}, imps = lista(rev.impostores);
  const det = jug.filter((u) => !imps.includes(u)), expul = lista(e.expulsados), adiv = rev.adivinanzas || {};
  const pts = Object.fromEntries(jug.map((u) => [u, 0])), razones = {}, votaronBien = {};
  const votosDe = (etapa) => (etapa === 2 ? e.votos2 : e.votos1) || {};
  for (const i of imps) {
    const x = expul.find((y) => y.u === i);
    if (!x) { pts[i] = (pts[i] || 0) + 3; razones[i] = { t: 'salvo' }; continue; }
    if (adiv[i]?.acierto) { pts[i] = (pts[i] || 0) + 2; razones[i] = { t: 'adivino' }; continue; }
    razones[i] = { t: 'cayo' };
    const vs = votosDe(x.etapa);
    for (const d of det) {
      pts[d] += 1;
      if (lista(vs[d]).includes(i)) { pts[d] += 1; (votaronBien[d] ||= []).push(i); }
    }
  }
  for (const d of det) razones[d] = votaronBien[d] ? { t: 'voto', a: votaronBien[d] } : pts[d] ? { t: 'gano' } : { t: 'nada' };
  return { pts, razones };
}

// ------------------------------------------------------------ estado de esta página
const ui = {
  sala: null, st: null, activo: false,
  acciones: {}, accionesListas: false, secreto: null, secretoListo: false,
  mazos: null, carta: null, vista: null, sel: [], enviado: null, adivina: '', menu: false, prep: null,
  forzar: new Set()
};

function prepGuardada() { try { return JSON.parse(localStorage.getItem(PREP_GUARDADA) || 'null'); } catch { return null; } }
function guardarPrep() { try { localStorage.setItem(PREP_GUARDADA, JSON.stringify(ui.prep)); } catch {} }
function iniciarPrep(e) {
  if (ui.prep) return;
  const g = prepGuardada() || {};
  ui.prep = { ...OPCIONES, ...g, ...(e.opciones || {}) };
  ui.prep.mazos = lista(ui.prep.mazos);
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
  window.__juego = { ui, sala, contar, calcular, acierta }; // para pruebas
  if (!PANTALLA) sala.db.on(`${sala.raiz}/privado/${sala.uid}/carta`, (v) => { ui.carta = v; pintar(); });
  document.body.classList.toggle('modo-pantalla', PANTALLA);
  if (PANTALLA) mantenerEncendida();
  cambio(sala.estado());
  setInterval(tic, 250);
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
  if (st.juego !== 'impostor') return irSala();
  if (st.rol === 'jugador' && !st.jugadores[st.yo]) return irSala();
  const antes = ui.st?.estado || {};
  ui.st = st;
  const e = st.estado || {};
  if (e.reparto !== antes.reparto) { ui.sel = []; ui.enviado = null; ui.adivina = ''; ui.forzar.clear(); }
  if ((e.votacion?.etapa || 0) !== (antes.votacion?.etapa || 0)) { ui.sel = []; ui.enviado = null; }
  if (st.soyAnfitrion && (e.fase === 'preparando' || !e.fase)) { iniciarPrep(e); if (!ui.mazos) cargarMazos(); }
  vigilarHost(st.soyAnfitrion);
  motor();
  pintar();
}

// Los mazos incluidos, más los propios de Firebase (uno propio con el mismo nombre reemplaza al incluido)
async function cargarMazos() {
  ui.mazos = MAZOS_BASE.map((m) => ({ ...m }));
  try {
    const propios = (await ui.sala.db.get('palabras')) || {};
    for (const [id, m] of Object.entries(propios)) {
      const n = normalizar(id, m);
      if (!n || !n.palabras.length) continue;
      const i = ui.mazos.findIndex((x) => x.id === id);
      if (i >= 0) ui.mazos[i] = n; else ui.mazos.push(n);
    }
  } catch (x) { console.warn('No se pudieron leer los mazos propios', x); }
  if (ui.prep) {
    ui.prep.mazos = ui.prep.mazos.filter((id) => ui.mazos.some((m) => m.id === id));
    if (!ui.prep.mazos.length) ui.prep.mazos = ui.mazos.slice(0, 1).map((m) => m.id);
  }
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

async function paso() {
  const st = ui.st, e = st.estado || {}, A = ui.acciones || {}, s = ui.secreto || {}, ahora = ui.sala.db.ahora();
  if (e.tipo !== 'impostor' || !['viendo', 'pistas', 'votando', 'adivinando'].includes(e.fase)) return;
  // El secreto se escribe junto con cada reparto: si no coincide, todavía no llega todo
  if (s.reparto !== e.reparto) return;
  const jug = lista(e.jugadores);
  const presentes = jug.filter((u) => st.jugadores[u]?.conectado);
  const k = (x) => `${e.reparto}:${x}`;
  let c = {};

  if (e.fase === 'viendo') {
    const vistos = {};
    for (const u of jug) if (A[u]?.visto === e.reparto) vistos[u] = true;
    if (!igual(vistos, e.vistos || {})) c.vistos = nn(vistos);
    if ((presentes.length && presentes.every((u) => vistos[u])) || ui.forzar.has(k('viendo'))) {
      Object.assign(c, { fase: 'pistas', turno: 0, vuelta: 1 });
    }
  } else if (e.fase === 'pistas') {
    const orden = lista(e.orden), turno = e.turno || 0, vuelta = e.vuelta || 1;
    const quien = orden[turno];
    const listo = !quien || !st.jugadores[quien] || A[quien]?.pista === `${e.reparto}-${vuelta}-${turno}` || ui.forzar.has(k(`pista-${vuelta}-${turno}`));
    if (listo) {
      if (turno + 1 < orden.length) c.turno = turno + 1;
      else if (vuelta < (e.opciones?.vueltas || 1)) Object.assign(c, { turno: 0, vuelta: vuelta + 1 });
      else {
        const t = e.opciones?.tiempo || 0;
        Object.assign(c, { fase: 'votando', turno: null, votacion: { etapa: 1, plazas: e.n || 1 }, votaron: null, limite: t ? ahora + t * 1000 : null });
      }
    }
  } else if (e.fase === 'votando') {
    const vot = e.votacion || { etapa: 1, plazas: e.n || 1 };
    const cands = vot.etapa === 2 ? lista(vot.candidatos) : jug;
    const votos = votosValidos(e, A, cands, vot);
    const votaron = Object.fromEntries(Object.keys(votos).map((u) => [u, true]));
    if (!igual(votaron, e.votaron || {})) c.votaron = nn(votaron);
    const todos = presentes.length > 0 && presentes.every((u) => votos[u]);
    const tiempo = e.limite && ahora >= e.limite;
    if (todos || tiempo || ui.forzar.has(k(`voto-${vot.etapa}`))) c = { ...c, ...cerrarVotacion(e, s, vot, cands, votos, ahora) };
  } else if (e.fase === 'adivinando') {
    const atr = lista(e.atrapados), adiv = {};
    for (const u of atr) {
      const a = A[u]?.adivina;
      if (a?.reparto === e.reparto && limpio(a.t)) adiv[u] = { t: limpio(a.t), acierto: acierta(a.t, s.palabra?.p) };
      else if (ui.forzar.has(k(`adivina-${u}`)) || !st.jugadores[u]) adiv[u] = { t: '', acierto: false };
    }
    const adivinaron = Object.fromEntries(Object.keys(adiv).map((u) => [u, true]));
    if (!igual(adivinaron, e.adivinaron || {})) c.adivinaron = nn(adivinaron);
    if (atr.every((u) => adiv[u])) c = { ...c, ...cierre(e, s, { adivinaron: nn(adivinaron) }, adiv) };
  }
  if (Object.keys(c).length) await guardar(enEstado(c));
}

// Votos que valen: de quien juega la ronda, sin votarse a sí mismo, por los candidatos de esta etapa
function votosValidos(e, A, cands, vot) {
  const votos = {};
  for (const u of lista(e.jugadores)) {
    const v = A[u]?.voto;
    if (v?.reparto !== e.reparto || v.etapa !== vot.etapa) continue;
    const opciones = cands.filter((x) => x !== u);
    const a = [...new Set(lista(v.a))].filter((x) => opciones.includes(x));
    if (a.length && a.length === Math.min(vot.plazas, opciones.length)) votos[u] = a;
  }
  return votos;
}

function cerrarVotacion(e, s, vot, cands, votos, ahora) {
  const r = contar(votos, cands, vot.plazas);
  const t = e.opciones?.tiempo || 0;
  if (r.empatados.length && vot.etapa === 1) {
    // Empate en el corte: se vota otra vez, solo entre los empatados
    return {
      votos1: nn(votos), votaron: null,
      votacion: { etapa: 2, candidatos: r.empatados, fijos: nn(r.elegidos) ? r.elegidos : null, plazas: r.libres },
      limite: t ? ahora + DESEMPATE * 1000 : null
    };
  }
  const expulsados = vot.etapa === 1
    ? r.elegidos.map((u) => ({ u, etapa: 1 }))
    : lista(vot.fijos).map((u) => ({ u, etapa: 1 })).concat(r.elegidos.map((u) => ({ u, etapa: 2 })));
  const imps = lista(s.impostores);
  const atrapados = expulsados.map((x) => x.u).filter((u) => imps.includes(u));
  const extra = { [vot.etapa === 1 ? 'votos1' : 'votos2']: nn(votos), votaron: null, limite: null, expulsados: expulsados.length ? expulsados : null, sinDecidir: r.empatados.length ? r.empatados : null };
  if (atrapados.length) return { ...extra, fase: 'adivinando', atrapados, adivinaron: null };
  return cierre({ ...e, ...extra }, s, extra, {});
}

// Fin de la ronda: se revela todo y se suman los puntos
function cierre(e, s, extra, adivinanzas) {
  const revelacion = { impostores: lista(s.impostores), palabra: s.palabra || null, otra: s.otra || null, adivinanzas: nn(adivinanzas) };
  const e2 = { ...e, ...extra, revelacion };
  const { pts, razones } = calcular(e2);
  const puntos = { ...(e.puntosAntes || {}) };
  for (const [u, v] of Object.entries(pts)) puntos[u] = (puntos[u] || 0) + v;
  const historial = lista(e.historial).concat([{ palabra: s.palabra?.p || '', puntos: pts }]);
  return { ...extra, fase: 'resultado', revelacion, deLaRonda: pts, razones, puntos, historial, limite: null };
}

// El anfitrión corrige si una adivinanza cuenta o no (por si la palabra se escribió muy distinto)
async function corregir(uid) {
  const e = ui.st.estado, rev = e.revelacion || {};
  const adiv = { ...(rev.adivinanzas || {}) };
  if (!adiv[uid]) return;
  adiv[uid] = { ...adiv[uid], acierto: !adiv[uid].acierto };
  const revelacion = { ...rev, adivinanzas: adiv };
  const { pts, razones } = calcular({ ...e, revelacion });
  const puntos = { ...(e.puntosAntes || {}) };
  for (const [u, v] of Object.entries(pts)) puntos[u] = (puntos[u] || 0) + v;
  const historial = lista(e.historial).slice(0, -1).concat([{ palabra: rev.palabra?.p || '', puntos: pts }]);
  await guardar(enEstado({ revelacion, deLaRonda: pts, razones, puntos, historial }));
}

// ------------------------------------------------------------ repartir
function mazosElegidos(opciones) {
  const ids = lista(opciones.mazos);
  return (ui.mazos || []).filter((m) => ids.includes(m.id));
}
function hayFamilias(opciones) { return mazosElegidos(opciones).some((m) => Object.keys(familias(m.palabras)).length); }

function sortear(opciones, usadas0) {
  const pool = [];
  for (const m of mazosElegidos(opciones)) {
    if (opciones.modo === 'parecida') {
      for (const idxs of Object.values(familias(m.palabras))) idxs.forEach((i) => pool.push({ m, i, fam: idxs }));
    } else m.palabras.forEach((_, i) => pool.push({ m, i }));
  }
  if (!pool.length) return null;
  const clave = (x) => `${x.m.id}/${base(x.m.palabras[x.i].p)}`;
  let usadas = lista(usadas0);
  let libres = pool.filter((x) => !usadas.includes(clave(x)));
  if (!libres.length) { usadas = []; libres = pool; }
  const x = azar(libres), w = x.m.palabras[x.i];
  const o = x.fam ? x.m.palabras[azar(x.fam.filter((j) => j !== x.i))] : null;
  return {
    mazo: { nombre: x.m.nombre, desc: x.m.desc || '' },
    palabra: { p: w.p, d: w.d || '' },
    otra: o ? { p: o.p, d: o.d || '' } : null,
    usadas: usadas.concat(clave(x)).slice(-300)
  };
}

// Reparte una ronda nueva. puntos/historial: lo que se lleva hasta antes de esta ronda
async function repartir(opciones, ronda, puntos, historial) {
  const st = ui.st;
  if (!ui.mazos) await cargarMazos();
  const jug = st.lista.filter((j) => j.conectado).map((j) => j.uid);
  if (jug.length < MIN_JUG) return aviso(`Se necesitan al menos ${MIN_JUG} jugadores`);
  const sorteo = sortear(opciones, ui.secreto?.usadas);
  if (!sorteo) return aviso(opciones.modo === 'parecida' ? 'Los mazos elegidos no tienen familias de palabras' : 'Elige al menos un mazo con palabras');
  const n = opciones.impostores === 2 && jug.length >= MIN_DOS ? 2 : 1;
  const imps = barajar(jug).slice(0, n);
  // Orden de pistas al azar, pero el impostor nunca empieza
  const orden = barajar(jug);
  const k = orden.findIndex((u) => !imps.includes(u));
  [orden[0], orden[k]] = [orden[k], orden[0]];
  const reparto = nuevoId();
  const p0 = { ...(puntos || {}) };
  jug.forEach((u) => { p0[u] = p0[u] || 0; });
  const estado = {
    tipo: 'impostor', fase: 'viendo', ronda, reparto, opciones, n, mazo: sorteo.mazo, jugadores: jug, orden,
    turno: 0, vuelta: 1, puntos: p0, puntosAntes: p0, historial: lista(historial).length ? lista(historial) : null
  };
  const cambios = {
    'publico/estado': estado, acciones: null,
    secreto: { reparto, impostores: imps, palabra: sorteo.palabra, otra: sorteo.otra, usadas: sorteo.usadas }
  };
  for (const j of st.lista) {
    let carta = null;
    if (jug.includes(j.uid)) {
      const imp = imps.includes(j.uid);
      if (opciones.modo === 'parecida') {
        const w = imp ? sorteo.otra : sorteo.palabra;
        carta = { reparto, p: w.p, d: w.d, mazo: sorteo.mazo.nombre };
      } else if (imp) carta = { reparto, rol: 'impostor', mazo: sorteo.mazo.nombre, mazoDesc: sorteo.mazo.desc };
      else carta = { reparto, rol: 'detective', p: sorteo.palabra.p, d: sorteo.palabra.d, mazo: sorteo.mazo.nombre };
    }
    cambios[`privado/${j.uid}/carta`] = carta;
  }
  await guardar(cambios);
}

async function empezar() {
  const e = ui.st.estado || {}, p = ui.prep;
  if (!p.mazos.length) return aviso('Elige al menos un mazo');
  guardarPrep();
  const opciones = { mazos: [...p.mazos], modo: p.modo === 'parecida' && hayFamilias(p) ? 'parecida' : 'clasico', impostores: p.impostores, vueltas: p.vueltas, tiempo: p.tiempo };
  await repartir(opciones, (e.ronda || 0) + 1, e.puntos, e.historial);
}
const otraRonda = () => { const e = ui.st.estado; return repartir(e.opciones || OPCIONES, (e.ronda || 0) + 1, e.puntos, e.historial); };
// Repartir otra palabra a media ronda: los puntos quedan como estaban antes de esta ronda
const repetirRonda = () => { const e = ui.st.estado; return repartir(e.opciones || OPCIONES, e.ronda || 1, e.puntosAntes, e.historial); };

// ------------------------------------------------------------ reloj de la página
function tic() {
  const st = ui.st, e = st?.estado;
  if (!e || e.tipo !== 'impostor' || e.fase !== 'votando' || !e.limite) return;
  const falta = e.limite - ui.sala.db.ahora();
  if (st.soyAnfitrion && falta <= 0) motor();
  document.querySelectorAll('[data-reloj]').forEach((x) => { x.textContent = reloj(falta); });
}

// ------------------------------------------------------------ pintar
const nombre = (st, uid) => st.jugadores[uid]?.nombre || '—';
const colorDe = (st, uid) => st.jugadores[uid]?.color || token('--jugador-1');
const avatar = (st, uid) => `<span class="av" style="background:${esc(colorDe(st, uid))}">${inicial(nombre(st, uid))}</span>`;
function nombres(st, uids) {
  const ns = lista(uids).map((u) => nombre(st, u));
  return ns.length > 1 ? `${ns.slice(0, -1).join(', ')} y ${ns[ns.length - 1]}` : ns[0] || '';
}
const enRonda = (st, e) => lista(e.jugadores).includes(st.yo);
const miCarta = (e) => (ui.carta && ui.carta.reparto === e.reparto ? ui.carta : null);
const categoria = (e) => (e.mazo?.nombre ? `Categoría: ${esc(e.mazo.nombre)}` : '');

function pintar() {
  const st = ui.st;
  if (!st) return;
  const e = st.estado || {};
  if (PANTALLA) return pintarPantalla(st, e);
  const a = document.activeElement;
  const foco = a?.dataset?.foco ? { k: a.dataset.foco, ini: a.selectionStart, fin: a.selectionEnd } : null;
  $app.innerHTML = `<main class="jugador">${barra(st, e)}${cuerpo(st, e)}</main>`;
  if (foco) { const t = document.querySelector(`[data-foco="${foco.k}"]`); if (t && !t.disabled) { t.focus(); try { t.setSelectionRange(foco.ini, foco.fin); } catch {} } }
}

function barra(st, e) {
  const enJuego = e.fase && e.fase !== 'preparando';
  return `<div class="barra">
    <a class="marca" href="${esc(direccion('../../'))}">La <em>Sobremesa</em></a>
    <div class="barra-der">
      <span class="codigo-mini">${esc(CODIGO)}</span>
      ${st.soyAnfitrion ? `<div class="envoltura-menu"><button class="rol" data-accion="menu" aria-expanded="${ui.menu}">Anfitrión ▾</button>${ui.menu ? `<div class="menu" role="menu">
        ${enJuego && e.fase !== 'resultado' ? '<button data-accion="repetir">Repartir otra palabra</button>' : ''}
        ${enJuego ? '<button data-accion="ajustes">Cambiar ajustes</button>' : ''}
        ${enJuego || e.puntos ? '<button data-accion="reiniciar">Empezar otra partida</button>' : ''}
        <button data-accion="a-sala">Volver a la sala</button>
      </div>` : ''}</div>` : ''}
    </div>
  </div>`;
}

function cuerpo(st, e) {
  if (e.tipo !== 'impostor' || e.fase === 'preparando' || !e.fase) return preparar(st, e);
  if (!enRonda(st, e) && e.fase !== 'resultado') return mirando(st, e);
  if (e.fase === 'viendo') return viendo(st, e);
  if (e.fase === 'pistas') return pistas(st, e);
  if (e.fase === 'votando') return votando(st, e);
  if (e.fase === 'adivinando') return adivinando(st, e);
  if (e.fase === 'resultado') return resultado(st, e);
  return '';
}

const reglasCortas = () => `<details class="panel reglas"><summary>Cómo se juega</summary><ol>
  <li>Todos reciben la misma palabra secreta menos el impostor, que solo sabe de qué mazo es.</li>
  <li>Por turnos, cada quien dice una pista en voz alta: una sola palabra, sin decir la secreta y sin repetir pistas.</li>
  <li>Discuten y votan quién creen que es el impostor. Pueden cambiar su voto hasta que voten todos. Si hay empate, se vota otra vez solo entre los empatados; si sigue, el impostor se salva.</li>
  <li>Si atrapan al impostor, tiene un intento para adivinar la palabra.</li>
  <li>En el modo Palabra parecida, el impostor recibe otra palabra de la misma familia y no sabe que es el impostor.</li></ol>
  <p>Puntos</p><ul>
  <li>El impostor se salva: +3 para el impostor.</li>
  <li>Lo atrapan pero adivina la palabra: +2 para el impostor.</li>
  <li>Lo atrapan y falla: +1 para cada uno de los demás y +1 extra a quien votó por el impostor.</li></ul></details>`;

function preparar(st, e) {
  const conservados = e.puntos && Object.values(e.puntos).some((v) => v);
  if (!st.soyAnfitrion) {
    return `<div class="panel espera"><h1 class="titulo">El impostor</h1><p>Esperando a que <b>${esc(st.nombreAnfitrion || 'el anfitrión')}</b> prepare la partida…</p></div>${reglasCortas()}`;
  }
  iniciarPrep(e);
  const p = ui.prep, conectados = st.lista.filter((j) => j.conectado).length;
  if (!ui.mazos) return '<div class="panel espera"><p>Cargando mazos…</p></div>';
  const elegidos = mazosElegidos(p), palabras = elegidos.reduce((a, m) => a + m.palabras.length, 0);
  const conFam = hayFamilias(p), dosOk = conectados >= MIN_DOS;
  const modo = p.modo === 'parecida' && !conFam ? 'clasico' : p.modo;
  const puede = conectados >= MIN_JUG && elegidos.length > 0;
  return `<div class="panel prep">
    <h1 class="titulo">El impostor</h1>
    <span class="etiqueta">Mazos · ${elegidos.length} de ${ui.mazos.length} · ${palabras} palabras</span>
    <div class="mazos">${ui.mazos.map((m) => `<button class="mazo-chip" data-accion="mazo" data-id="${esc(m.id)}" aria-pressed="${p.mazos.includes(m.id)}" title="${esc(m.desc)}">${esc(m.nombre)}</button>`).join('')}</div>
    <span class="etiqueta">Impostores</span>
    <div class="segmentos"><button class="btn" data-accion="impostores" data-n="1" aria-pressed="${p.impostores !== 2 || !dosOk}">1</button><button class="btn" style="flex:2" data-accion="impostores" data-n="2" aria-pressed="${p.impostores === 2 && dosOk}" ${dosOk ? '' : 'disabled'}>2 · con ${MIN_DOS} o más</button></div>
    <span class="etiqueta">Modo</span>
    <label class="modo ${modo === 'clasico' ? 'on' : ''}"><input type="radio" name="modo" data-accion="modo" value="clasico" ${modo === 'clasico' ? 'checked' : ''}><span><b>Clásico</b><small>El impostor sabe que lo es y solo ve el mazo con su descripción.</small></span></label>
    <label class="modo ${modo === 'parecida' ? 'on' : ''} ${conFam ? '' : 'no'}"><input type="radio" name="modo" data-accion="modo" value="parecida" ${modo === 'parecida' ? 'checked' : ''} ${conFam ? '' : 'disabled'}><span><b>Palabra parecida</b><small>${conFam ? 'Recibe otra palabra de la misma familia, elegida al azar, y no sabe que es el impostor. Solo salen palabras que tienen familia.' : 'Los mazos elegidos no tienen familias de palabras.'}</small></span></label>
    <span class="etiqueta">Vueltas de pistas</span>
    <div class="segmentos">${[1, 2].map((v) => `<button class="btn" data-accion="vueltas" data-v="${v}" aria-pressed="${p.vueltas === v}">${v}</button>`).join('')}</div>
    <span class="etiqueta">Tiempo para discutir y votar</span>
    <div class="segmentos">${TIEMPOS.map(([s, t]) => `<button class="btn" data-accion="tiempo" data-s="${s}" aria-pressed="${p.tiempo === s}">${t}</button>`).join('')}</div>
    ${conservados ? `<p class="sub">Los puntos de las ${e.ronda || ''} rondas anteriores se conservan.</p>` : ''}
  </div>
  <div class="pie"><button class="btn pri grande" data-accion="empezar" ${puede ? '' : 'disabled'}>${conectados < MIN_JUG ? `Faltan ${MIN_JUG - conectados} para empezar (mínimo ${MIN_JUG})` : !elegidos.length ? 'Elige al menos un mazo' : `Repartir a ${conectados}`}</button></div>
  ${reglasCortas()}`;
}

function mirando(st, e) {
  return `<div class="panel espera"><h1 class="titulo">El impostor</h1><p>Te sumaste a media ronda. Juegas desde la siguiente.</p></div>${reglasCortas()}`;
}

// La tarjeta secreta. Tapada se ve igual en todos los celulares.
function carta(e, c) {
  let cara;
  if (!c) cara = '<span class="lbl">Repartiendo…</span>';
  else if (c.rol === 'impostor') {
    cara = `<span class="rol-carta">Impostor</span><span class="lbl">Solo sabes el mazo</span><b class="pal ${tam(c.mazo)}">${esc(c.mazo)}</b>
      <span class="desc">${esc(c.mazoDesc)}${c.mazoDesc ? ' ' : ''}Escucha las pistas y disimula.</span>`;
  } else {
    cara = `${c.rol === 'detective' ? '<span class="rol-carta">Detective</span>' : ''}<span class="lbl">Tu palabra secreta</span><b class="pal ${tam(c.p)}">${esc(c.p)}</b>
      ${c.d ? `<span class="desc">${esc(c.d)}</span>` : ''}`;
  }
  return `<div class="carta-secreta" data-ver-carta role="button" tabindex="0" aria-label="Mantén presionado para ver tu palabra">
    <div class="tapa"><span class="signo">?</span><b>Mantén el dedo aquí</b><small>para ver tu palabra</small></div>
    <div class="cara">${cara}</div>
  </div>`;
}
// Las palabras largas se achican para que no se partan a la mitad
const tam = (t) => { const n = Math.max(...String(t || '').split(/\s+/).map((x) => x.length)); return n > 12 ? 't3' : n > 10 ? 't2' : n > 8 ? 't1' : ''; };
const vistazo = (e) => `<button class="btn grande ver-palabra" data-ver-carta>Mantén aquí para ver tu palabra</button><div class="vistazo">${carta(e, miCarta(e))}</div>`;

function viendo(st, e) {
  const c = miCarta(e), vistos = e.vistos || {}, jug = lista(e.jugadores), yaVi = !!vistos[st.yo];
  const presentes = jug.filter((u) => st.jugadores[u]?.conectado), faltan = presentes.filter((u) => !vistos[u]);
  const vio = ui.vista === e.reparto;
  return `<div class="cabeza"><span class="etiqueta">Ronda ${e.ronda} · ${categoria(e)}</span><h2 class="titulo">Tu palabra</h2></div>
    ${carta(e, c)}
    <p class="nota">Se ve solo mientras mantienes el dedo. Al soltarlo se tapa, y la tarjeta tapada se ve igual en todos los celulares.</p>
    <div class="pie">
      ${yaVi ? `<button class="btn grande" disabled>Esperando a ${faltan.length ? esc(nombres(st, faltan)) : 'los demás'}</button>`
        : `<button class="btn pri grande" data-accion="visto" ${c && vio ? '' : 'disabled'}>${c && !vio ? 'Primero mira tu palabra' : 'Ya la vi'}</button>`}
      ${st.soyAnfitrion && faltan.length ? `<button class="enlace" data-accion="forzar" data-k="viendo">Seguir sin esperar a ${esc(nombres(st, faltan))}</button>` : ''}
    </div>`;
}

function pistas(st, e) {
  const orden = lista(e.orden), turno = e.turno || 0, quien = orden[turno], mio = quien === st.yo;
  const filas = orden.map((u, i) => {
    const paso = i < turno ? 'hecha' : i === turno ? 'ahora' : '';
    return `<div class="turno ${paso}"><span class="num">${i + 1}</span>${avatar(st, u)}<b>${u === st.yo ? 'Tú' : esc(nombre(st, u))}</b><small>${paso === 'hecha' ? 'Ya dio pista' : paso === 'ahora' ? 'Ahora' : 'Espera'}</small></div>`;
  }).join('');
  return `<div class="cabeza"><span class="etiqueta">Vuelta ${e.vuelta || 1} de ${e.opciones?.vueltas || 1} · ${categoria(e)}</span>
      <h2 class="titulo">${mio ? 'Te toca' : `Le toca a ${esc(nombre(st, quien))}`}</h2>
      <span class="sub">${mio ? 'Di tu pista en voz alta: una sola palabra, sin decir la secreta.' : 'Escucha su pista. Una sola palabra, sin decir la secreta y sin repetir pistas.'}</span></div>
    <div class="orden">${filas}</div>
    <div class="pie">
      ${vistazo(e)}
      ${mio ? `<button class="btn pri grande" data-accion="pista">Ya dije mi pista</button>` : ''}
      ${st.soyAnfitrion && !mio ? `<button class="enlace" data-accion="forzar" data-k="pista-${e.vuelta || 1}-${turno}">Pasar al siguiente sin esperar a ${esc(nombre(st, quien))}</button>` : ''}
    </div>`;
}

function votando(st, e) {
  const vot = e.votacion || { etapa: 1, plazas: e.n || 1 };
  const jug = lista(e.jugadores), cands = vot.etapa === 2 ? lista(vot.candidatos) : jug;
  const opciones = cands.filter((u) => u !== st.yo), req = Math.min(vot.plazas, opciones.length);
  const votaron = e.votaron || {}, presentes = jug.filter((u) => st.jugadores[u]?.conectado);
  const yaVote = !!votaron[st.yo];
  const sel = ui.sel.filter((u) => opciones.includes(u));
  const botones = opciones.map((u) => {
    const on = sel.includes(u);
    return `<button class="opcion-voto" data-accion="elegir" data-uid="${esc(u)}" aria-pressed="${on}">${avatar(st, u)}<b>${esc(nombre(st, u))}</b><small>${on ? 'Tu voto' : ''}</small></button>`;
  }).join('');
  const fijos = lista(vot.fijos);
  const titulo = vot.etapa === 2 ? 'Desempate' : req > 1 ? '¿Quiénes son?' : '¿Quién es?';
  const sub = vot.etapa === 2
    ? `${fijos.length ? `${esc(nombres(st, fijos))} ya ${fijos.length > 1 ? 'salieron' : 'salió'}. ` : ''}Hubo empate: voten otra vez, solo entre ${esc(nombres(st, cands))}.`
    : req > 1 ? `Hay ${e.n} impostores: elige a ${req} personas.` : 'Discutan y voten quién creen que es el impostor.';
  const listo = sel.length === req, mismo = yaVote && listo && igual([...sel].sort(), [...(ui.enviado || [])].sort());
  const etiquetaVoto = mismo ? `Votaste por ${esc(nombres(st, sel))}` : !listo ? (req > 1 ? `Elige a ${req}` : 'Elige a alguien') : `${yaVote ? 'Cambiar mi voto a' : 'Votar por'} ${esc(nombres(st, sel))}`;
  return `<div class="cabeza-fila"><div class="cabeza"><span class="etiqueta">${e.limite ? `Quedan <span data-reloj>${reloj(e.limite - ui.sala.db.ahora())}</span>` : categoria(e)}</span><h2 class="titulo">${titulo}</h2></div>
      <span class="pildora">Votaron ${Object.keys(votaron).length} de ${presentes.length}</span></div>
    <p class="sub">${sub}</p>
    <div class="opciones">${botones}</div>
    <p class="nota">${yaVote ? 'Ya votaste. Puedes cambiar tu voto hasta que voten todos.' : 'Tu voto es secreto hasta que voten todos.'}</p>
    <div class="pie">
      ${vistazo(e)}
      <button class="btn pri grande" data-accion="votar" ${listo && !mismo ? '' : 'disabled'}>${etiquetaVoto}</button>
      ${st.soyAnfitrion ? `<button class="enlace" data-accion="forzar" data-k="voto-${vot.etapa}">Cerrar la votación ya</button>` : ''}
    </div>`;
}

// Cómo quedaron los votos de una etapa (el voto se revela cuando ya votaron todos)
function listaVotos(st, e, etapa, cands) {
  const votos = (etapa === 2 ? e.votos2 : e.votos1) || {};
  const r = contar(votos, cands, 99), fuera = lista(e.expulsados).filter((x) => x.etapa === etapa).map((x) => x.u);
  const total = Math.max(1, Object.keys(votos).length);
  return cands.filter((u) => r.conteo[u] > 0).sort((a, b) => r.conteo[b] - r.conteo[a]).map((u) => {
    const quienes = Object.entries(votos).filter(([, a]) => lista(a).includes(u)).map(([v]) => v);
    return `<div class="voto-fila ${fuera.includes(u) ? 'fuera' : ''}"><div class="arriba">${avatar(st, u)}<b>${esc(nombre(st, u))}</b><span class="n">${r.conteo[u]}</span></div>
      <div class="barra-voto"><i style="width:${Math.round((r.conteo[u] / total) * 100)}%"></i></div><small>${esc(nombres(st, quienes))}</small></div>`;
  }).join('') || '<p class="sub">Nadie votó.</p>';
}
const etapaFinal = (e) => (e.votos2 || e.votacion?.etapa === 2 ? 2 : 1);
const candidatosDe = (e, etapa) => (etapa === 2 ? lista(e.votacion?.candidatos) : lista(e.jugadores));

function adivinando(st, e) {
  const atr = lista(e.atrapados), yo = atr.includes(st.yo), ya = (e.adivinaron || {})[st.yo];
  const et = etapaFinal(e);
  if (yo && !ya) {
    return `<div class="cabeza"><span class="etiqueta">Te atraparon</span><h2 class="titulo">Último intento</h2>
        <span class="sub">Si adivinas la palabra, te llevas 2 puntos aunque te hayan descubierto.</span></div>
      <form class="panel prep" data-accion="form-adivina">
        <label class="etiqueta" for="adivina">¿Cuál es la palabra? · ${esc(e.mazo?.nombre || '')}</label>
        <input class="campo campo-adivina" id="adivina" data-foco="adivina" maxlength="${ADIVINA_LARGO}" value="${esc(ui.adivina)}" autocomplete="off" autocapitalize="sentences" spellcheck="false" enterkeyhint="send">
        <p class="nota">Se perdonan faltas de ortografía. Si hay duda, el anfitrión decide.</p>
      </form>
      <div class="pie">${vistazo(e)}<button class="btn pri grande" data-accion="adivinar" ${limpio(ui.adivina) ? '' : 'disabled'}>Adivinar</button></div>`;
  }
  const faltan = atr.filter((u) => !(e.adivinaron || {})[u]);
  return `<div class="cabeza"><span class="etiqueta">Se acabó la votación</span><h2 class="titulo">¡Atraparon a ${esc(nombres(st, atr))}!</h2>
      <span class="sub">${yo ? 'Ya mandaste tu respuesta.' : `${atr.length > 1 ? 'Tenían' : 'Tenía'} la carta de impostor. Ahora ${atr.length > 1 ? 'cada quien tiene' : 'tiene'} un intento para adivinar la palabra.`}</span></div>
    <div class="panel resumen"><span class="etiqueta">Votos</span><div class="votos">${listaVotos(st, e, et, candidatosDe(e, et))}</div></div>
    <p class="nota">${faltan.length ? `${esc(nombres(st, faltan))} está escribiendo…` : 'Revisando…'}</p>
    ${st.soyAnfitrion ? faltan.map((u) => `<button class="enlace" data-accion="forzar" data-k="adivina-${esc(u)}">${esc(nombre(st, u))} no puede contestar: seguir sin su respuesta</button>`).join('') : ''}`;
}

// Lo que pasó en la ronda, en frases cortas
function lineasFinal(st, e) {
  const rev = e.revelacion || {}, imps = lista(rev.impostores), adiv = rev.adivinanzas || {};
  const expul = lista(e.expulsados).map((x) => x.u), inocentes = expul.filter((u) => !imps.includes(u));
  const out = [];
  if (!expul.length) out.push(lista(e.sinDecidir).length ? 'Siguió el empate: nadie salió.' : 'Nadie recibió votos: nadie salió.');
  if (inocentes.length) out.push(`Sacaron a <b>${esc(nombres(st, inocentes))}</b>, que no ${inocentes.length > 1 ? 'eran impostores' : 'era impostor'}.`);
  for (const i of imps) {
    const n = `<b>${esc(nombre(st, i))}</b>`;
    if (!expul.includes(i)) out.push(`${n} ${imps.length > 1 ? 'tenía una carta de impostor' : 'era el impostor'} y se salvó.`);
    else if (!adiv[i]?.t) out.push(`${n} no alcanzó a adivinar.`);
    else out.push(`${n} dijo <b>${esc(adiv[i].t)}</b>. ${adiv[i].acierto ? '¡Era!' : 'No era.'}`);
  }
  return out;
}
function titular(st, e) {
  const rev = e.revelacion || {}, imps = lista(rev.impostores), adiv = rev.adivinanzas || {};
  const expul = lista(e.expulsados).map((x) => x.u);
  const ganan = imps.filter((i) => !expul.includes(i) || adiv[i]?.acierto);
  if (!ganan.length) return 'Ganan los demás';
  if (ganan.length === imps.length) return imps.length > 1 ? 'Ganan los impostores' : `Gana ${nombre(st, imps[0])}`;
  return 'Ronda dividida';
}
function razonTexto(st, r, yo) {
  switch (r?.t) {
    case 'salvo': return yo ? 'Te salvaste' : 'Se salvó';
    case 'adivino': return yo ? 'Adivinaste la palabra' : 'Adivinó la palabra';
    case 'cayo': return yo ? 'Te atraparon y no adivinaste' : 'Cayó en la votación';
    case 'voto': return `${yo ? 'Votaste' : 'Votó'} por ${nombres(st, r.a)}`;
    case 'gano': return 'Ganaron los demás';
    case 'nada': return yo ? 'Esta vez no sumaste' : 'Sin puntos';
    default: return '';
  }
}
function palabraFinal(e, clase = 'palabra-final carta') {
  const rev = e.revelacion || {};
  return `<div class="${clase}"><span class="lbl">La palabra era</span><b>${esc(rev.palabra?.p || '')}</b>${rev.palabra?.d ? `<span>${esc(rev.palabra.d)}</span>` : ''}
    ${rev.otra ? `<hr><span class="lbl">${lista(rev.impostores).length > 1 ? 'Los impostores tenían' : 'El impostor tenía'}</span><b class="chica">${esc(rev.otra.p)}</b>${rev.otra.d ? `<span>${esc(rev.otra.d)}</span>` : ''}` : ''}</div>`;
}

function posiciones(st, e) {
  const p = e.puntos || {};
  const ids = new Set([...lista(e.jugadores), ...Object.keys(p)]);
  return [...ids].filter((u) => st.jugadores[u] || p[u]).map((u) => ({ uid: u, nombre: nombre(st, u), color: colorDe(st, u), puntos: p[u] || 0, conectado: !!st.jugadores[u]?.conectado }))
    .sort((a, b) => b.puntos - a.puntos || a.nombre.localeCompare(b.nombre, 'es'));
}

function resultado(st, e) {
  const dl = e.deLaRonda || {}, razones = e.razones || {}, total = (e.puntos || {})[st.yo] || 0;
  const mio = dl[st.yo] != null ? `<span class="sub">${esc(razonTexto(st, razones[st.yo], true))}${dl[st.yo] ? `: <b class="mas">+${dl[st.yo]}</b>` : ''}. Llevas ${total}.</span>` : '';
  const filas = posiciones(st, e).map((x) => `<div class="fila-puntos ${x.conectado ? '' : 'fuera'} ${x.uid === st.yo ? 'yo' : ''}">${avatar(st, x.uid)}
      <span class="nom"><b>${esc(x.nombre)}</b>${razones[x.uid] ? `<small>${esc(razonTexto(st, razones[x.uid]))}</small>` : ''}</span>
      <span class="ronda ${dl[x.uid] ? 'suma' : ''}">${dl[x.uid] != null ? (dl[x.uid] ? `+${dl[x.uid]}` : '0') : ''}</span><span class="pts">${x.puntos}</span></div>`).join('');
  const adiv = e.revelacion?.adivinanzas || {};
  const correcciones = st.soyAnfitrion ? Object.entries(adiv).filter(([, a]) => a.t).map(([u, a]) => `<div class="panel corregir">
      <p>${esc(nombre(st, u))} escribió <b>${esc(a.t)}</b> y se contó como ${a.acierto ? 'acierto' : 'error'}.</p>
      <button class="btn" data-accion="corregir" data-uid="${esc(u)}">${a.acierto ? 'Corregir: no la adivinó' : 'Corregir: sí la adivinó'}</button></div>`).join('') : '';
  const et = etapaFinal(e);
  return `<div class="panel resumen"><span class="etiqueta">Ronda ${e.ronda} · Era ${esc(e.revelacion?.palabra?.p || '')}</span><h2 class="titulo">${esc(titular(st, e))}</h2>${mio}</div>
    ${palabraFinal(e)}
    <ul class="lineas">${lineasFinal(st, e).map((l) => `<li>${l}</li>`).join('')}</ul>
    ${correcciones}
    <div class="lista-puntos">${filas}</div>
    <details class="panel reglas"><summary>Cómo votaron</summary><div class="votos" style="padding:0 14px 14px">${listaVotos(st, e, et, candidatosDe(e, et))}</div></details>
    <p class="nota">Los puntos se suman ronda tras ronda. Al terminar se pueden llevar al marcador de la sala.</p>
    ${st.soyAnfitrion ? `<div class="pie suelto"><button class="btn pri grande" data-accion="otra">Otra ronda · nuevo impostor</button>
      <button class="btn grande" data-accion="ajustes">Cambiar ajustes</button>
      <button class="btn grande" data-accion="al-marcador">Terminar y ver el marcador</button></div>`
      : `<p class="sub centrado">${esc(st.nombreAnfitrion || 'El anfitrión')} decide qué sigue.</p>`}`;
}

// ------------------------------------------------------------ pantalla (tele, laptop, Chromecast)
function pintarPantalla(st, e) {
  const jug = lista(e.jugadores), presentes = jug.filter((u) => st.jugadores[u]?.conectado);
  let cuerpo = '', esquina = true;
  const fila = (estado) => `<div class="p-fila">${jug.map((u) => { const si = estado(u); return `<div class="p-jug ${si.ok ? 'si' : 'no'}">${avatar(st, u)}<span>${esc(nombre(st, u))}</span><small>${si.t}</small></div>`; }).join('')}</div>`;
  if (e.tipo !== 'impostor' || e.fase === 'preparando' || !e.fase) {
    cuerpo = `<div class="p-portada"><div class="p-mini"><div class="uno">tu palabra</div><div class="dos">?</div></div>
      <div><h1 class="p-titulo" style="font-size:12vh">El impostor</h1><p class="p-sub">${esc(st.nombreAnfitrion || 'El anfitrión')} está preparando la partida desde su celular.</p>
      <div class="p-pasos"><span>1. Todos reciben la misma palabra secreta… menos el impostor.</span><span>2. Por turnos, cada quien dice una pista en voz alta.</span>
      <span>3. Discuten y votan quién creen que es el impostor.</span><span>4. Si lo atrapan, tiene <b>una oportunidad</b> de adivinar la palabra.</span></div></div></div>`;
  } else if (e.fase === 'viendo') {
    const vistos = e.vistos || {}, parecida = e.opciones?.modo === 'parecida';
    cuerpo = `<span class="etiqueta">Categoría</span><h1 class="p-titulo" style="font-size:16vh">${esc(e.mazo?.nombre || '')}</h1>
      <p class="p-sub">${parecida ? `Vean su palabra a escondidas. ${e.n > 1 ? 'Dos de ustedes tienen' : 'Uno de ustedes tiene'} otra parecida y no lo sabe.` : `Vean su palabra a escondidas. ${e.n > 1 ? 'Dos de ustedes no la tienen' : 'Uno de ustedes no la tiene'}.`}</p>`;
    cuerpo += `<div class="p-pie">${fila((u) => (vistos[u] ? { ok: true, t: 'Ya la vio' } : { ok: false, t: 'Viendo…' }))}<span class="p-pildora">Ya la vieron ${presentes.filter((u) => vistos[u]).length} de ${presentes.length}</span></div>`;
    esquina = false;
  } else if (e.fase === 'pistas') {
    const orden = lista(e.orden), turno = e.turno || 0;
    cuerpo = `<span class="etiqueta">Pista en voz alta · vuelta ${e.vuelta || 1} de ${e.opciones?.vueltas || 1}</span>
      <h1 class="p-titulo" style="font-size:13vh">Le toca a <span style="color:var(--acento)">${esc(nombre(st, orden[turno]))}</span></h1>
      <p class="p-sub">Una sola palabra. Sin decir la secreta y sin repetir pistas.</p>
      <div class="p-orden">${orden.map((u, i) => { const paso = i < turno ? 'hecha' : i === turno ? 'ahora' : ''; return `<div class="p-turno ${paso}"><span class="num">${i + 1}</span>${avatar(st, u)}<div><b>${esc(nombre(st, u))}</b><small>${paso === 'hecha' ? 'Ya dio pista' : paso === 'ahora' ? 'Ahora' : 'Espera'}</small></div></div>`; }).join('')}</div>`;
    esquina = false;
  } else if (e.fase === 'votando') {
    const vot = e.votacion || { etapa: 1 }, votaron = e.votaron || {};
    const cands = vot.etapa === 2 ? lista(vot.candidatos) : [];
    cuerpo = `<div class="p-pie" style="margin:0 0 4vh"><div><span class="etiqueta">${vot.etapa === 2 ? 'Desempate' : 'Discutan y voten'}</span>
        <h1 class="p-titulo" style="font-size:11vh">${vot.etapa === 2 ? `Otra vez: ${esc(nombres(st, cands))}` : e.n > 1 ? '¿Quiénes son los impostores?' : '¿Quién es el impostor?'}</h1>
        <p class="p-sub">${vot.etapa === 2 ? 'Hubo empate. Se vota solo entre los empatados.' : 'Pueden cambiar su voto hasta que hayan votado todos.'}</p></div>
      ${e.limite ? `<div class="p-reloj"><b data-reloj>${reloj(e.limite - ui.sala.db.ahora())}</b><small>para discutir</small></div>` : ''}</div>
      <div class="p-pie">${fila((u) => (votaron[u] ? { ok: true, t: 'Ya votó' } : { ok: false, t: 'Pensando…' }))}<span class="p-pildora">Votaron ${Object.keys(votaron).length} de ${presentes.length}</span></div>`;
    esquina = false;
  } else if (e.fase === 'adivinando') {
    const atr = lista(e.atrapados), et = etapaFinal(e), faltan = atr.filter((u) => !(e.adivinaron || {})[u]);
    cuerpo = `<div class="p-dos"><div class="p-votos"><span class="etiqueta">Votos</span><div class="votos" style="margin-top:2vh">${listaVotos(st, e, et, candidatosDe(e, et))}</div></div>
      <div><h1 class="p-titulo" style="font-size:11vh">¡Atraparon a ${esc(nombres(st, atr))}!</h1>
      <p class="p-sub">${atr.length > 1 ? 'Tenían' : 'Tenía'} la carta de impostor. Ahora ${atr.length > 1 ? 'cada quien tiene' : 'tiene'} <b>un intento</b> para adivinar la palabra y robarse la ronda.</p>
      <p class="p-sub" style="margin-top:3vh">${faltan.length ? `${esc(nombres(st, faltan))} está escribiendo…` : 'Revisando…'}</p></div></div>`;
    esquina = false;
  } else if (e.fase === 'resultado') {
    const dl = e.deLaRonda || {}, razones = e.razones || {};
    const filas = posiciones(st, e).map((x) => `<tr><td><span class="nom">${avatar(st, x.uid)}${esc(x.nombre)}</span></td><td>${esc(razonTexto(st, razones[x.uid]))}</td>
      <td class="${dl[x.uid] ? 'suma' : 'cero'}">${dl[x.uid] != null ? (dl[x.uid] ? `+${dl[x.uid]}` : '0') : ''}</td><td class="total">${x.puntos}</td></tr>`).join('');
    cuerpo = `<div class="p-dos"><div>${palabraFinal(e, 'p-palabra')}<ul class="p-lineas">${lineasFinal(st, e).map((l) => `<li>${l}</li>`).join('')}</ul>
        <h1 class="p-titulo" style="font-size:8vh;margin-top:2vh">${esc(titular(st, e))}</h1></div>
      <div><table class="p-tabla"><thead><tr><th>Jugador</th><th>Por qué</th><th>Ronda</th><th>Total</th></tr></thead><tbody>${filas}</tbody></table></div></div>`;
    esquina = false;
  }
  const arriba = e.fase === 'pistas' || e.fase === 'votando' || e.fase === 'adivinando' ? `Categoría: ${esc(e.mazo?.nombre || '')}` : e.ronda && e.fase !== 'preparando' ? `Ronda ${e.ronda}` : `${st.lista.length} en la mesa`;
  $app.innerHTML = `<div class="pantalla">
    <div class="p-arriba"><span class="marca">La <em>Sobremesa</em> · El impostor</span><span>${arriba}</span></div>
    <div class="p-cuerpo">${cuerpo}</div>
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
document.addEventListener('visibilitychange', () => { if (PANTALLA) mantenerEncendida(); verCarta(false); });

// ------------------------------------------------------------ la tarjeta: se ve solo mientras se mantiene el dedo
function verCarta(si) {
  document.body.classList.toggle('viendo-carta', si);
  const e = ui.st?.estado;
  if (si && e && miCarta(e) && ui.vista !== e.reparto) {
    ui.vista = e.reparto;
    // Sin volver a dibujar (la tarjeta está bajo el dedo): solo se activa el botón
    const b = document.querySelector('[data-accion="visto"]');
    if (b) { b.disabled = false; b.textContent = 'Ya la vi'; }
  }
}
document.addEventListener('pointerdown', (ev) => {
  if (!ev.target.closest('[data-ver-carta]')) return;
  ev.preventDefault();
  verCarta(true);
});
for (const t of ['pointerup', 'pointercancel']) document.addEventListener(t, () => verCarta(false));
window.addEventListener('blur', () => verCarta(false));
document.addEventListener('contextmenu', (ev) => { if (ev.target.closest('[data-ver-carta]')) ev.preventDefault(); });
document.addEventListener('keydown', (ev) => {
  if ((ev.key === ' ' || ev.key === 'Enter') && ev.target.closest?.('[data-ver-carta]')) { ev.preventDefault(); verCarta(true); }
});
document.addEventListener('keyup', (ev) => { if (ev.key === ' ' || ev.key === 'Enter') verCarta(false); });

// ------------------------------------------------------------ acciones de cada jugador
const R = () => ui.sala.raiz;
const yoAccion = (k, v) => ui.sala.db.set(`${R()}/acciones/${ui.sala.uid}/${k}`, v);

async function mandarVoto() {
  const e = ui.st.estado, vot = e.votacion || { etapa: 1 };
  ui.enviado = [...ui.sel];
  pintar();
  await yoAccion('voto', { reparto: e.reparto, etapa: vot.etapa, a: [...ui.sel] });
}
function elegir(uid) {
  const e = ui.st.estado, vot = e.votacion || { etapa: 1, plazas: e.n || 1 };
  const cands = vot.etapa === 2 ? lista(vot.candidatos) : lista(e.jugadores);
  const req = Math.min(vot.plazas, cands.filter((u) => u !== ui.st.yo).length);
  if (ui.sel.includes(uid)) ui.sel = ui.sel.filter((u) => u !== uid);
  else if (req === 1) ui.sel = [uid];
  else if (ui.sel.length < req) ui.sel = [...ui.sel, uid];
  else ui.sel = [...ui.sel.slice(1), uid];
  pintar();
}
async function adivinar() {
  const e = ui.st.estado, t = limpio(ui.adivina);
  if (!t) return aviso('Escribe tu respuesta');
  await yoAccion('adivina', { reparto: e.reparto, t });
}

// ------------------------------------------------------------ eventos
document.addEventListener('input', (ev) => {
  if (ev.target.id !== 'adivina') return;
  ui.adivina = ev.target.value;
  const b = document.querySelector('[data-accion="adivinar"]');
  if (b) b.disabled = !limpio(ui.adivina);
});
document.addEventListener('submit', (ev) => {
  if (ev.target.dataset.accion !== 'form-adivina') return;
  ev.preventDefault();
  if (limpio(ui.adivina)) adivinar().catch(() => aviso('No se pudo. Revisa tu conexión.'));
});
document.addEventListener('change', (ev) => {
  if (ev.target.dataset.accion === 'modo') { ui.prep.modo = ev.target.value; guardarPrep(); pintar(); }
});

document.addEventListener('click', async (ev) => {
  if (ev.target.closest('input, label.modo')) return;
  const b = ev.target.closest('[data-accion]');
  if (!b) { if (ui.menu) { ui.menu = false; pintar(); } return; }
  const st = ui.st, e = st?.estado || {};
  const a = b.dataset.accion;
  if (['form-adivina', 'modo'].includes(a)) return;
  const falla = (x) => { console.error(x); aviso('No se pudo. Revisa tu conexión.'); };
  switch (a) {
    case 'menu': ui.menu = !ui.menu; pintar(); break;
    case 'a-sala':
      ui.menu = false;
      if (['preparando', 'resultado'].includes(e.fase) || !e.fase || confirm('¿Volver a la sala? La ronda termina.')) await ui.sala.elegirJuego(null);
      else pintar();
      break;
    case 'reiniciar':
      ui.menu = false;
      if (confirm('¿Empezar otra partida? Los puntos se pierden.')) {
        await guardar({ 'publico/estado': { tipo: 'impostor', fase: 'preparando', opciones: e.opciones || OPCIONES }, acciones: null }).catch(falla);
      } else pintar();
      break;
    case 'ajustes':
      ui.menu = false;
      if (e.fase === 'resultado' || confirm('¿Cambiar ajustes? Esta ronda no cuenta.')) {
        const puntos = e.fase === 'resultado' ? e.puntos : e.puntosAntes;
        const ronda = e.fase === 'resultado' ? e.ronda : (e.ronda || 1) - 1;
        ui.prep = null;
        await guardar({ 'publico/estado': { tipo: 'impostor', fase: 'preparando', opciones: e.opciones || OPCIONES, puntos: puntos || null, historial: e.historial || null, ronda }, acciones: null }).catch(falla);
      } else pintar();
      break;
    case 'repetir':
      ui.menu = false;
      if (confirm('¿Repartir otra palabra? Esta ronda empieza de nuevo.')) await repetirRonda().catch(falla); else pintar();
      break;
    case 'al-marcador': {
      // Cada ronda queda como una ronda del marcador, con su palabra
      const { estadoInicial } = await import('../../marcador/sala-marcador.js');
      const est = estadoInicial(), puntos = {};
      const hist = lista(e.historial);
      est.titulo = 'El impostor';
      est.rondas = hist.map((h, i) => ({ id: nuevoId(), nombre: h.palabra || `Ronda ${i + 1}` }));
      if (!est.rondas.length) est.rondas = [{ id: 'impostor', nombre: 'El impostor' }];
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
    case 'mazo': {
      const id = b.dataset.id, p = ui.prep;
      p.mazos = p.mazos.includes(id) ? p.mazos.filter((x) => x !== id) : [...p.mazos, id];
      if (p.modo === 'parecida' && !hayFamilias(p)) p.modo = 'clasico';
      guardarPrep(); pintar(); break;
    }
    case 'impostores': ui.prep.impostores = Number(b.dataset.n); guardarPrep(); pintar(); break;
    case 'vueltas': ui.prep.vueltas = Number(b.dataset.v); guardarPrep(); pintar(); break;
    case 'tiempo': ui.prep.tiempo = Number(b.dataset.s); guardarPrep(); pintar(); break;
    case 'empezar': b.disabled = true; await empezar().catch(falla); pintar(); break;
    // Jugar
    case 'visto': b.disabled = true; await yoAccion('visto', e.reparto).catch(falla); break;
    case 'pista': b.disabled = true; await yoAccion('pista', `${e.reparto}-${e.vuelta || 1}-${e.turno || 0}`).catch(falla); break;
    case 'elegir': elegir(b.dataset.uid); break;
    case 'votar': b.disabled = true; await mandarVoto().catch(falla); break;
    case 'adivinar': b.disabled = true; await adivinar().catch(falla); break;
    case 'forzar': ui.forzar.add(`${e.reparto}:${b.dataset.k}`); motor(); break;
    case 'corregir': b.disabled = true; await corregir(b.dataset.uid).catch(falla); break;
    case 'otra': b.disabled = true; await otraRonda().catch(falla); break;
  }
});

iniciar().catch((x) => {
  console.error(x);
  $app.innerHTML = `<div class="centro"><h1 class="titulo">No pudimos abrir el juego</h1><p class="sub">Revisa tu conexión a internet e intenta de nuevo.</p><a class="btn sec grande" href="${esc(direccion('../../'))}">Volver al inicio</a></div>`;
});
