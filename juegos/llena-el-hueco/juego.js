// La Sobremesa · Llena el hueco
// ------------------------------------------------------------
// Cada ronda, un juez lee una frase con un hueco y elige la respuesta más graciosa
// entre las cartas que mandan los demás, sin saber de quién es cada una.
//
// Dónde vive cada cosa (dentro de salas/<CODIGO>):
//   publico/estado      fase, ronda, juez, frase, quién ya mandó, respuestas (sin autor), puntos
//                       Lo escribe el anfitrión; el juez solo escribe revelado, eleccion y siguiente.
//   privado/<uid>/mano  las cartas de cada jugador (números de carta del mazo; -1 es carta en blanco)
//   acciones/<uid>      lo que manda cada jugador: envio { ronda, cartas } y cambio (ronda)
//   secreto             pilas de cartas, manos y quién mandó cada respuesta. Solo lo lee el anfitrión.
//   mazos/<id>          { nombre, frases: [{ t, h }], respuestas: [texto] }   (fuera de la sala)
//
// Las reglas del juego las aplica el celular del anfitrión (función motor). Si se desconecta,
// el control pasa a otro jugador y su celular sigue desde donde iba.

import { abrirSala, existeSala, codigoValido } from '../../nucleo/sala.js';

const Q = new URLSearchParams(location.search);
const CODIGO = (Q.get('sala') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
const PANTALLA = Q.get('rol') === 'pantalla';
const MANO = 7;
const DE_PRUEBA = ['local', 'sdk', 'emulador', 'emuauth'];
const OPCIONES = { meta: 7, blancas: true, cambio: true };

const $app = document.getElementById('app');
const css = getComputedStyle(document.documentElement);
const token = (n) => css.getPropertyValue(n).trim();
const esc = (s) => String(s ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const inicial = (n) => esc(String(n || '?').trim().charAt(0).toUpperCase());
const lista = (v) => (Array.isArray(v) ? v : Object.keys(v || {}).sort((a, b) => a - b).map((k) => v[k])).filter((x) => x !== null && x !== undefined);
const barajar = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const idAzar = () => Math.random().toString(36).slice(2, 8);
const limpiarTexto = (t) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, 90);

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

// La frase con sus huecos llenos. Sin hueco, la respuesta va debajo.
function llenar(frase, textos = [], vacio = '______') {
  const t = String(frase?.t ?? '');
  const partes = t.split(/_{3,}/);
  if (partes.length === 1) return esc(t) + (textos.length ? `<span class="aparte">${textos.map((x) => `<b class="lleno">${esc(x)}</b>`).join(' ')}</span>` : '');
  return partes.map((p, i) => esc(p) + (i < partes.length - 1 ? (textos[i] != null ? `<b class="lleno">${esc(textos[i])}</b>` : `<span class="hueco">${vacio}</span>`) : '')).join('');
}

// ------------------------------------------------------------ estado de esta página
const ui = {
  sala: null, st: null, activo: false,
  mano: [], mazo: null, mazoId: null, mazos: null,
  secreto: null, secretoListo: false, acciones: {},
  sel: [], blancas: {}, reenviar: false, eleccion: null, verPuntos: false, menu: false,
  prep: { ...OPCIONES, mazo: null }
};

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
  window.__juego = { ui, sala }; // para pruebas
  if (!PANTALLA) sala.db.on(`${sala.raiz}/privado/${sala.uid}/mano`, (v) => { ui.mano = lista(v); pintar(); });
  document.body.classList.toggle('modo-pantalla', PANTALLA);
  if (PANTALLA) mantenerEncendida();
  cambio(sala.estado());
}

let apagarHost = null;
function vigilarHost(soy) {
  if (soy && !apagarHost) {
    const R = ui.sala.raiz;
    const a = ui.sala.db.on(`${R}/acciones`, (v) => { ui.acciones = v || {}; motor(); });
    const s = ui.sala.db.on(`${R}/secreto`, (v) => { ui.secreto = v || {}; ui.secretoListo = true; motor(); });
    apagarHost = () => { a(); s(); ui.secretoListo = false; };
  } else if (!soy && apagarHost) { apagarHost(); apagarHost = null; }
}

function cambio(st) {
  if (!st) return;
  if (st.juego !== 'llena-el-hueco') return irSala();
  if (st.rol === 'jugador' && !st.jugadores[st.yo]) return irSala();
  const antes = ui.st?.estado || {};
  ui.st = st;
  const e = st.estado || {};
  // Lo que eligió cada quien solo vale para su ronda
  if (e.ronda !== antes.ronda || e.fase !== antes.fase) { ui.sel = []; ui.blancas = {}; ui.reenviar = false; ui.eleccion = null; }
  if (e.mazo?.id && e.mazo.id !== ui.mazoId) cargarMazo(e.mazo.id);
  if (st.soyAnfitrion && (e.fase === 'preparando' || e.fase === 'fin') && !ui.mazos) cargarMazos();
  vigilarHost(st.soyAnfitrion);
  motor();
  pintar();
}

async function cargarMazo(id) {
  ui.mazoId = id; ui.mazo = null;
  const m = await ui.sala.db.get(`mazos/${id}`);
  if (ui.mazoId !== id) return;
  ui.mazo = m ? { nombre: m.nombre, frases: lista(m.frases), respuestas: lista(m.respuestas) } : { nombre: '', frases: [], respuestas: [] };
  pintar(); motor();
  return ui.mazo;
}
async function cargarMazos() {
  ui.mazos = [];
  try {
    const todos = (await ui.sala.db.get('mazos')) || {};
    ui.mazos = Object.entries(todos).map(([id, m]) => ({ id, nombre: m.nombre || id, frases: lista(m.frases).length, respuestas: lista(m.respuestas).length }))
      .filter((m) => m.frases && m.respuestas).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  } catch (x) { console.error(x); }
  if (!ui.prep.mazo && ui.mazos[0]) ui.prep.mazo = ui.mazos[0].id;
  pintar();
}

// ------------------------------------------------------------ motor (solo en el celular del anfitrión)
let ocupado = false, otraVez = false, programado = false;
// Se espera a que lleguen todos los cambios de una misma escritura (estado y secreto) antes de decidir
function motor() {
  if (programado) return;
  programado = true;
  setTimeout(() => { programado = false; correrMotor(); }, 0);
}
async function correrMotor() {
  if (!ui.st?.soyAnfitrion || !ui.secretoListo) return;
  if (ocupado) { otraVez = true; return; }
  ocupado = true;
  try { await paso(); } catch (x) { console.error('motor', x); }
  ocupado = false;
  if (otraVez) { otraVez = false; motor(); }
}

// Pilas y manos de trabajo, copiadas del secreto
function modelo() {
  const s = ui.secreto || {};
  const manos = {};
  for (const [u, m] of Object.entries(s.manos || {})) manos[u] = lista(m);
  return { pilaF: lista(s.pilaF), pilaR: lista(s.pilaR), manos };
}
function todasLasRespuestas(blancas) {
  const n = ui.mazo.respuestas.length;
  const r = Array.from({ length: n }, (_, i) => i);
  if (blancas) for (let i = 0; i < Math.max(2, Math.round(n / 12)); i++) r.push(-1);
  return r;
}
function robar(M, n, opciones) {
  const out = [];
  while (out.length < n) {
    if (!M.pilaR.length) {
      // Se acabó la pila: se vuelve a barajar todo lo que no está en una mano
      const enMano = {};
      Object.values(M.manos).flat().concat(out).forEach((i) => { enMano[i] = (enMano[i] || 0) + 1; });
      M.pilaR = barajar(todasLasRespuestas(opciones.blancas).filter((i) => { if (enMano[i]) { enMano[i]--; return false; } return true; }));
      if (!M.pilaR.length) break;
    }
    out.push(M.pilaR.pop());
  }
  return out;
}
function sacarFrase(M, actual) {
  if (!M.pilaF.length) M.pilaF = barajar(ui.mazo.frases.map((_, i) => i).filter((i) => i !== actual));
  const i = M.pilaF.pop() ?? 0;
  const f = ui.mazo.frases[i] || { t: '______', h: 1 };
  return { i, t: f.t, h: Math.min(3, Math.max(1, f.h || 1)) };
}
function escribirModelo(cambios, M, manosCambiadas) {
  cambios['secreto/pilaF'] = M.pilaF;
  cambios['secreto/pilaR'] = M.pilaR;
  for (const u of manosCambiadas) {
    cambios[`secreto/manos/${u}`] = M.manos[u] || null;
    cambios[`privado/${u}/mano`] = M.manos[u] || null;
  }
}
const guardar = (cambios) => {
  cambios['publico/actividad'] = ui.sala.db.marcaTiempo();
  return ui.sala.db.update(ui.sala.raiz, cambios);
};

function envioValido(e, M, uid) {
  const env = ui.acciones?.[uid]?.envio;
  if (!env || env.ronda !== e.ronda) return null;
  const cartas = lista(env.cartas);
  if (cartas.length !== e.frase.h) return null;
  const mano = [...(M.manos[uid] || [])];
  for (const c of cartas) {
    const k = mano.indexOf(c.i);
    if (k < 0) return null;
    mano.splice(k, 1);
    if (c.i === -1 && !limpiarTexto(c.t)) return null;
  }
  return cartas;
}

async function paso() {
  const st = ui.st, e = st.estado || {};
  if (e.tipo !== 'llena') return;
  // El secreto se escribe junto con cada ronda: si no coinciden, todavía no llega todo
  if (['eligiendo', 'revelando', 'ganador'].includes(e.fase) && ui.secreto?.ronda !== e.ronda) return;

  if (e.fase === 'eligiendo') {
    if (!ui.mazo || ui.mazoId !== e.mazo?.id) return;
    const M = modelo(), cambios = {}, tocadas = new Set(), opciones = e.opciones || OPCIONES;
    const puntos = { ...(e.puntos || {}) };
    let orden = lista(e.orden);
    // Quien llegó a media partida entra al orden, con cero puntos y su mano
    for (const j of st.lista) {
      if (!orden.includes(j.uid)) { orden.push(j.uid); cambios['publico/estado/orden'] = orden; }
      if (puntos[j.uid] == null) { puntos[j.uid] = 0; cambios[`publico/estado/puntos/${j.uid}`] = 0; }
      if (!M.manos[j.uid]) { M.manos[j.uid] = robar(M, MANO, opciones); tocadas.add(j.uid); }
    }
    // Cambiar la mano completa a cambio de un punto
    const hechos = ui.secreto?.cambios || {};
    for (const [u, a] of Object.entries(ui.acciones || {})) {
      if (a?.cambio !== e.ronda || hechos[u] === e.ronda || u === e.juez || !opciones.cambio || (puntos[u] || 0) < 1 || !M.manos[u]) continue;
      if (ui.acciones[u]?.envio?.ronda === e.ronda) continue;
      const viejas = M.manos[u];
      M.manos[u] = [];
      M.manos[u] = robar(M, MANO, opciones);
      M.pilaR = barajar(M.pilaR.concat(viejas));
      puntos[u] -= 1;
      cambios[`publico/estado/puntos/${u}`] = puntos[u];
      cambios[`secreto/cambios/${u}`] = e.ronda;
      tocadas.add(u);
    }
    // Quién ya mandó (la pantalla lo muestra sin decir qué)
    const enviados = {};
    for (const j of st.lista) if (j.uid !== e.juez && envioValido(e, M, j.uid)) enviados[j.uid] = true;
    const antes = e.enviados || {};
    if (JSON.stringify(Object.keys(enviados).sort()) !== JSON.stringify(Object.keys(antes).sort())) cambios['publico/estado/enviados'] = Object.keys(enviados).length ? enviados : null;
    // Se espera a los conectados que no son juez
    const esperados = st.lista.filter((j) => j.conectado && j.uid !== e.juez && M.manos[j.uid]);
    const n = Object.keys(enviados).length;
    const todos = esperados.length > 0 && esperados.every((j) => enviados[j.uid]);
    if (n > 0 && (todos || e.forzar === e.ronda)) {
      const autores = {}, jugadas = {}, respuestas = [];
      for (const uid of barajar(Object.keys(enviados))) {
        const cartas = envioValido(e, M, uid), id = idAzar();
        respuestas.push({ id, textos: cartas.map((c) => (c.i >= 0 ? ui.mazo.respuestas[c.i] : limpiarTexto(c.t))) });
        autores[id] = uid;
        jugadas[uid] = cartas.map((c) => c.i);
      }
      Object.assign(cambios, {
        'publico/estado/fase': 'revelando', 'publico/estado/respuestas': respuestas, 'publico/estado/revelado': 0,
        'publico/estado/eleccion': null, 'publico/estado/enviados': enviados,
        'secreto/autores': autores, 'secreto/jugadas': jugadas
      });
    }
    if (tocadas.size) escribirModelo(cambios, M, tocadas);
    if (Object.keys(cambios).length) await guardar(cambios);
    return;
  }

  if (e.fase === 'revelando') {
    if (!e.eleccion) return;
    const uid = ui.secreto?.autores?.[e.eleccion];
    if (!uid) { await guardar({ 'publico/estado/eleccion': null }); return; }
    const puntos = { ...(e.puntos || {}) };
    puntos[uid] = (puntos[uid] || 0) + 1;
    const meta = e.opciones?.meta || OPCIONES.meta;
    await guardar({
      'publico/estado/fase': 'ganador',
      'publico/estado/ganador': { id: e.eleccion, uid, nombre: st.jugadores[uid]?.nombre || '—' },
      [`publico/estado/puntos/${uid}`]: puntos[uid],
      'publico/estado/campeon': puntos[uid] >= meta ? uid : null
    });
    return;
  }

  if (e.fase === 'ganador' && e.siguiente === e.ronda) {
    if (e.campeon) { await guardar({ 'publico/estado/fase': 'fin', 'publico/estado/siguiente': null }); return; }
    await nuevaRonda();
  }
}

async function nuevaRonda() {
  const st = ui.st, e = st.estado, M = modelo(), opciones = e.opciones || OPCIONES, tocadas = new Set();
  // Se quitan las cartas jugadas y cada quien vuelve a tener 7
  for (const [u, cartas] of Object.entries(ui.secreto?.jugadas || {})) {
    if (!M.manos[u]) continue;
    for (const i of lista(cartas)) { const k = M.manos[u].indexOf(i); if (k >= 0) M.manos[u].splice(k, 1); }
    tocadas.add(u);
  }
  for (const j of st.lista) {
    const m = M.manos[j.uid] || [];
    if (m.length < MANO) { M.manos[j.uid] = m.concat(robar(M, MANO - m.length, opciones)); tocadas.add(j.uid); }
  }
  // El juez pasa al siguiente conectado
  const orden = lista(e.orden).filter((u) => st.jugadores[u]);
  st.lista.forEach((j) => { if (!orden.includes(j.uid)) orden.push(j.uid); });
  const k = orden.indexOf(e.juez);
  let juez = e.juez;
  for (let d = 1; d <= orden.length; d++) { const u = orden[(k + d + orden.length) % orden.length]; if (st.jugadores[u]?.conectado) { juez = u; break; } }
  const cambios = {
    'publico/estado/ronda': e.ronda + 1, 'publico/estado/fase': 'eligiendo', 'publico/estado/juez': juez,
    'publico/estado/frase': sacarFrase(M, e.frase?.i), 'publico/estado/orden': orden,
    'publico/estado/respuestas': null, 'publico/estado/enviados': null, 'publico/estado/revelado': null,
    'publico/estado/eleccion': null, 'publico/estado/siguiente': null, 'publico/estado/ganador': null,
    'publico/estado/forzar': null, 'publico/estado/campeon': null,
    'secreto/autores': null, 'secreto/jugadas': null, 'secreto/ronda': e.ronda + 1, acciones: null
  };
  escribirModelo(cambios, M, tocadas);
  await guardar(cambios);
}

async function empezar() {
  const st = ui.st, id = ui.prep.mazo;
  if (!id) return aviso('Elige un mazo');
  const mazo = ui.mazoId === id && ui.mazo ? ui.mazo : await cargarMazo(id);
  if (!mazo?.frases.length || !mazo.respuestas.length) return aviso('Ese mazo está vacío');
  const opciones = { meta: ui.prep.meta, blancas: ui.prep.blancas, cambio: ui.prep.cambio };
  const jugadores = st.lista.filter((j) => j.conectado);
  if (jugadores.length < 3) return aviso('Se necesitan al menos 3 jugadores');
  const M = { pilaF: barajar(mazo.frases.map((_, i) => i)), pilaR: barajar(todasLasRespuestas(opciones.blancas)), manos: {} };
  const orden = jugadores.map((j) => j.uid);
  for (const u of orden) M.manos[u] = robar(M, MANO, opciones);
  const estado = {
    tipo: 'llena', fase: 'eligiendo', ronda: 1, mazo: { id, nombre: mazo.nombre || id }, opciones, orden,
    juez: orden[Math.floor(Math.random() * orden.length)], frase: sacarFrase(M, -1),
    puntos: Object.fromEntries(orden.map((u) => [u, 0]))
  };
  const cambios = { 'publico/estado': estado, secreto: { ronda: 1, pilaF: M.pilaF, pilaR: M.pilaR, manos: M.manos }, acciones: null };
  for (const u of orden) cambios[`privado/${u}/mano`] = M.manos[u];
  await guardar(cambios);
}

// ------------------------------------------------------------ acciones de cada jugador
const R = () => ui.sala.raiz;
async function mandar() {
  const e = ui.st.estado;
  const cartas = ui.sel.map((pos) => {
    const i = ui.mano[pos];
    return i === -1 ? { i: -1, t: limpiarTexto(ui.blancas[pos]) } : { i };
  });
  if (cartas.length !== e.frase.h) return aviso(e.frase.h === 1 ? 'Elige una carta' : `Elige ${e.frase.h} cartas, en orden`);
  if (cartas.some((c) => c.i === -1 && !c.t)) return aviso('Escribe tu respuesta en la carta en blanco');
  await ui.sala.db.set(`${R()}/acciones/${ui.sala.uid}/envio`, { ronda: e.ronda, cartas });
  ui.mandada = e.ronda; ui.reenviar = false; pintar();
}
const juez = (cambios) => ui.sala.actualizar(cambios).catch((x) => { console.error(x); aviso('No se pudo. Revisa tu conexión.'); });

// ------------------------------------------------------------ pintar
function pintar() {
  const st = ui.st;
  if (!st) return;
  const e = st.estado || {};
  if (PANTALLA) return pintarPantalla(st, e);
  // Si alguien escribe en una carta en blanco, no se le cierra el teclado cuando llegan cambios
  const a = document.activeElement, foco = a?.dataset?.blanca != null ? { pos: a.dataset.blanca, ini: a.selectionStart, fin: a.selectionEnd } : null;
  $app.innerHTML = `<main class="jugador">${barra(st, e)}${cuerpo(st, e)}${tablaPuntos(st, e)}</main>`;
  if (foco) { const t = document.querySelector(`[data-blanca="${foco.pos}"]`); if (t) { t.focus(); try { t.setSelectionRange(foco.ini, foco.fin); } catch {} } }
}

function nombre(st, uid) { return st.jugadores[uid]?.nombre || '—'; }
const soyJuez = (st, e) => e.juez === st.yo;
// El anfitrión hace de juez si el juez se desconectó
const actuoComoJuez = (st, e) => soyJuez(st, e) || (st.soyAnfitrion && !st.jugadores[e.juez]?.conectado);

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

function fraseCarta(e, textos, extra = '') {
  return `<div class="frase-carta ${extra}"><span class="frase-meta">Ronda ${e.ronda || 1} · Juez: ${esc(nombre(ui.st, e.juez))}${e.frase?.h > 1 ? ` · ${e.frase.h} cartas` : ''}</span><p>${llenar(e.frase, textos)}</p></div>`;
}

function cuerpo(st, e) {
  if (e.tipo !== 'llena' || e.fase === 'preparando') return preparar(st, e);
  if (e.fase === 'fin') return final(st, e);
  if (!ui.mazo && e.fase === 'eligiendo') return '<div class="centro"><p class="sub">Barajando cartas…</p></div>';
  if (e.fase === 'eligiendo') return eligiendo(st, e);
  if (e.fase === 'revelando') return revelando(st, e);
  if (e.fase === 'ganador') return ganador(st, e);
  return '';
}

function preparar(st, e) {
  if (!st.soyAnfitrion) {
    return `<div class="panel espera"><h1 class="titulo">Llena el hueco</h1><p>Esperando a que <b>${esc(st.nombreAnfitrion || 'el anfitrión')}</b> prepare la partida…</p></div>${reglasCortas()}`;
  }
  const conectados = st.lista.filter((j) => j.conectado).length;
  const mazos = ui.mazos === null ? '<p class="sub">Buscando mazos…</p>'
    : ui.mazos.length ? `<div class="opciones-mazo">${ui.mazos.map((m) => `<button class="opcion-mazo" data-accion="mazo" data-id="${esc(m.id)}" aria-pressed="${ui.prep.mazo === m.id}"><b>${esc(m.nombre)}</b><span>${m.frases} frases · ${m.respuestas} respuestas</span></button>`).join('')}</div>`
      : `<p class="aviso-local">Todavía no hay mazos cargados. Carga uno en <a href="${esc(direccion('mazos.html'))}">Mazos</a>.</p>`;
  return `<div class="panel prep">
    <h1 class="titulo">Llena el hueco</h1>
    <span class="etiqueta">Mazo</span>${mazos}
    <span class="etiqueta">Puntos para ganar</span>
    <div class="contador"><button class="btn" data-accion="meta" data-d="-1" aria-label="Menos">−</button><b>${ui.prep.meta}</b><button class="btn" data-accion="meta" data-d="1" aria-label="Más">+</button></div>
    <label class="interruptor"><input type="checkbox" data-accion="op" data-op="blancas" ${ui.prep.blancas ? 'checked' : ''}><span><b>Cartas en blanco</b><small>De vez en cuando te toca una carta para escribir tu propia respuesta.</small></span></label>
    <label class="interruptor"><input type="checkbox" data-accion="op" data-op="cambio" ${ui.prep.cambio ? 'checked' : ''}><span><b>Cambiar cartas por un punto</b><small>Quien tenga puntos puede cambiar toda su mano a cambio de uno.</small></span></label>
    <button class="btn pri grande" data-accion="empezar" ${conectados < 3 || !ui.prep.mazo ? 'disabled' : ''}>${conectados < 3 ? `Faltan ${3 - conectados} para empezar` : `Empezar con ${conectados}`}</button>
    <a class="enlace" href="${esc(direccion('mazos.html'))}">Administrar mazos</a>
  </div>${reglasCortas()}`;
}
const reglasCortas = () => `<details class="panel reglas"><summary>Cómo se juega</summary><ol>
  <li>Cada ronda hay un juez que lee una frase con un hueco.</li>
  <li>Los demás eligen la carta de su mano que mejor la complete (o la más absurda).</li>
  <li>El juez lee las respuestas sin saber de quién son y elige su favorita.</li>
  <li>Quien la mandó gana un punto. El juez cambia cada ronda.</li></ol></details>`;

function eligiendo(st, e) {
  const env = ui.acciones?.[st.yo]?.envio; // solo el anfitrión lo tiene; los demás usan "enviados"
  const mandado = !!(e.enviados || {})[st.yo] || (env && env.ronda === e.ronda) || ui.mandada === e.ronda;
  if (soyJuez(st, e)) {
    return `${fraseCarta(e, [])}<div class="panel espera"><b>Eres el juez de esta ronda.</b><p>Cuando todos manden su carta, vas a leer las respuestas en voz alta.</p>${quienFalta(st, e)}</div>`;
  }
  if (!ui.mano.length) return `${fraseCarta(e, [])}<div class="panel espera">Repartiendo tus cartas…</div>`;
  if (mandado && !ui.reenviar) {
    return `${fraseCarta(e, [], 'tenue')}<div class="panel espera"><b>¡Listo! Ya mandaste tu carta.</b>${quienFalta(st, e)}<button class="btn" data-accion="reenviar">Cambiar mi respuesta</button></div>`;
  }
  const textos = ui.sel.map((pos) => (ui.mano[pos] === -1 ? (ui.blancas[pos] || '…') : ui.mazo.respuestas[ui.mano[pos]]));
  const h = e.frase.h;
  const cartas = ui.mano.map((i, pos) => {
    const n = ui.sel.indexOf(pos);
    if (i === -1) {
      return `<div class="carta mano blanca ${n >= 0 ? 'sel' : ''}" data-accion="carta" data-pos="${pos}">${n >= 0 && h > 1 ? `<i class="num">${n + 1}</i>` : ''}<small>Carta en blanco</small><textarea data-blanca="${pos}" maxlength="90" rows="3" placeholder="Escribe tu respuesta">${esc(ui.blancas[pos] || '')}</textarea></div>`;
    }
    return `<button class="carta mano ${n >= 0 ? 'sel' : ''}" data-accion="carta" data-pos="${pos}">${n >= 0 && h > 1 ? `<i class="num">${n + 1}</i>` : ''}${esc(ui.mazo.respuestas[i] ?? '')}</button>`;
  }).join('');
  const puedeCambiar = e.opciones?.cambio && (e.puntos?.[st.yo] || 0) >= 1;
  return `${fraseCarta(e, textos)}
    <span class="etiqueta">${h === 1 ? 'Elige una carta' : `Elige ${h} cartas, en orden`}</span>
    <div class="mano-grid">${cartas}</div>
    <div class="pie-fijo"><button class="btn pri grande" data-accion="mandar" ${ui.sel.length === h ? '' : 'disabled'}>Mandar${h > 1 ? ` (${ui.sel.length}/${h})` : ''}</button></div>
    ${puedeCambiar ? '<button class="enlace" data-accion="cambio">Cambiar toda mi mano por 1 punto</button>' : ''}`;
}

function quienFalta(st, e) {
  const env = e.enviados || {};
  const otros = st.lista.filter((j) => j.uid !== e.juez && (j.conectado || env[j.uid]));
  const faltan = otros.filter((j) => !env[j.uid]);
  const forzar = st.soyAnfitrion && Object.keys(env).length > 0 && faltan.length > 0
    ? '<button class="btn" data-accion="forzar">No esperar a los demás</button>' : '';
  return `<div class="estado-envios">${otros.map((j) => `<span class="chip ${env[j.uid] ? 'listo' : ''}">${env[j.uid] ? '✓ ' : ''}${esc(j.nombre)}</span>`).join('')}</div>
    <p class="sub">${faltan.length ? `Faltan ${faltan.length}.` : 'Ya mandaron todos.'}</p>${forzar}`;
}

function revelando(st, e) {
  const rs = lista(e.respuestas), n = rs.length, k = e.revelado || 0;
  if (actuoComoJuez(st, e)) {
    const nota = soyJuez(st, e) ? '' : `<p class="aviso-local">${esc(nombre(st, e.juez))} se desconectó: tú eliges por esta ronda.</p>`;
    if (k <= n) {
      const actual = k > 0 ? rs[k - 1] : null;
      const texto = k === 0 ? `Hay ${n} respuesta${n === 1 ? '' : 's'}. Léelas en voz alta una por una.` : k === n ? `Respuesta ${k} de ${n}: era la última.` : `Respuesta ${k} de ${n}`;
      const boton = k === 0 ? 'Leer la primera' : k === n ? 'Elegir la ganadora' : 'Siguiente respuesta';
      return `${nota}${actual ? fraseCarta(e, lista(actual.textos), 'grande') : fraseCarta(e, [])}
        <p class="sub centrado">${texto}</p>
        <button class="btn pri grande" data-accion="revelar">${boton}</button>`;
    }
    return `${nota}<span class="etiqueta">Elige la ganadora</span><div class="opciones-ganadora">${rs.map((r) => `<button class="frase-carta opcion ${ui.eleccion === r.id ? 'sel' : ''}" data-accion="elegir" data-id="${esc(r.id)}"><p>${llenar(e.frase, lista(r.textos))}</p></button>`).join('')}</div>
      <div class="pie-fijo"><button class="btn pri grande" data-accion="confirmar" ${ui.eleccion ? '' : 'disabled'}>Elegir esta</button></div>`;
  }
  // Los demás ven lo mismo que el juez: la respuesta que se está leyendo en grande y, al final, todas
  const quien = esc(nombre(st, e.juez));
  if (k <= n) {
    const actual = k > 0 ? rs[k - 1] : null;
    const texto = k === 0 ? `${quien} va a leer ${n === 1 ? 'la respuesta' : `las ${n} respuestas`}.` : `${quien} está leyendo · respuesta ${k} de ${n}${k === n ? ', la última' : ''}`;
    return `${actual ? fraseCarta(e, lista(actual.textos), 'grande') : fraseCarta(e, [])}
      <p class="sub centrado">${texto}</p>`;
  }
  return `<span class="etiqueta">Todas las respuestas</span><div class="opciones-ganadora">${rs.map((r) => `<div class="frase-carta"><p>${llenar(e.frase, lista(r.textos))}</p></div>`).join('')}</div>
    <div class="panel espera"><b>${quien} está eligiendo la ganadora…</b></div>`;
}

function ganador(st, e) {
  const g = e.ganador || {}, r = lista(e.respuestas).find((x) => x.id === g.id);
  const yoGane = g.uid === st.yo;
  const puede = actuoComoJuez(st, e) || st.soyAnfitrion;
  return `<div class="celebra ${yoGane ? 'mia' : ''}"><span class="etiqueta">${yoGane ? '¡Ganaste esta ronda!' : 'Ganó esta ronda'}</span><h2>${esc(g.nombre || nombre(st, g.uid))}</h2></div>
    ${r ? fraseCarta(e, lista(r.textos), 'grande ganadora') : ''}
    ${puede ? `<button class="btn pri grande" data-accion="siguiente">${e.campeon ? 'Ver resultados' : 'Siguiente ronda'}</button>` : `<p class="sub centrado">${esc(nombre(st, e.juez))} pasa a la siguiente ronda.</p>`}`;
}

function final(st, e) {
  const lugares = posiciones(st, e);
  const campeon = lugares[0];
  return `<div class="celebra mia"><span class="etiqueta">Fin de la partida</span><h2>¡Ganó ${esc(campeon?.nombre || '—')}!</h2></div>
    <div class="lista-puntos grande">${lugares.map((x) => filaPuntos(x, e)).join('')}</div>
    ${st.soyAnfitrion ? `<button class="btn pri grande" data-accion="reiniciar">Otra partida</button>
      <button class="btn sec grande" data-accion="al-marcador">Llevar los puntos al marcador</button>
      <button class="btn grande" data-accion="a-sala">Volver a la sala</button>` : `<p class="sub centrado">${esc(st.nombreAnfitrion || 'El anfitrión')} decide qué sigue.</p>`}`;
}

function posiciones(st, e) {
  const p = e.puntos || {};
  const ids = new Set([...lista(e.orden), ...Object.keys(p)]);
  return [...ids].filter((u) => st.jugadores[u] || p[u]).map((u) => ({ uid: u, nombre: nombre(st, u), color: st.jugadores[u]?.color || token('--jugador-1'), puntos: p[u] || 0, conectado: !!st.jugadores[u]?.conectado }))
    .sort((a, b) => b.puntos - a.puntos || a.nombre.localeCompare(b.nombre, 'es'));
}
function filaPuntos(x, e) {
  const env = e.enviados || {};
  const marca = e.fase === 'eligiendo' ? (x.uid === e.juez ? '<span class="insignia">Juez</span>' : env[x.uid] ? '<span class="insignia listo">Listo</span>' : '') : (x.uid === e.juez && e.fase !== 'fin' ? '<span class="insignia">Juez</span>' : '');
  return `<div class="fila-puntos ${x.conectado ? '' : 'fuera'} ${x.uid === ui.st.yo ? 'yo' : ''}"><span class="av" style="background:${esc(x.color)}">${inicial(x.nombre)}</span><b>${esc(x.nombre)}</b>${marca}<span class="pts">${x.puntos}</span></div>`;
}
function tablaPuntos(st, e) {
  if (e.tipo !== 'llena' || e.fase === 'preparando' || e.fase === 'fin') return '';
  const meta = e.opciones?.meta || OPCIONES.meta;
  return `<details class="panel puntos" ${ui.verPuntos ? 'open' : ''} data-accion="ver-puntos"><summary>Puntos · gana quien llegue a ${meta}</summary><div class="lista-puntos">${posiciones(st, e).map((x) => filaPuntos(x, e)).join('')}</div></details>`;
}

// ------------------------------------------------------------ pantalla (tele, laptop, Chromecast)
function pintarPantalla(st, e) {
  const lugares = posiciones(st, e);
  const rs = lista(e.respuestas), k = e.revelado || 0;
  let centro = '', pie = '';
  if (e.tipo !== 'llena' || e.fase === 'preparando') {
    centro = `<div class="p-titulo"><h1>Llena el hueco</h1><p>${esc(st.nombreAnfitrion || 'El anfitrión')} está preparando la partida.</p></div>`;
  } else if (e.fase === 'eligiendo') {
    const env = e.enviados || {}, otros = st.lista.filter((j) => j.uid !== e.juez && (j.conectado || env[j.uid]));
    const faltan = otros.filter((j) => !env[j.uid]).length;
    centro = fraseCarta(e, [], 'tele');
    pie = faltan ? `Esperando ${faltan === 1 ? 'una carta' : `${faltan} cartas`}… · Juez: ${esc(nombre(st, e.juez))}` : '¡Ya están todas!';
  } else if (e.fase === 'revelando') {
    const kk = Math.min(k, rs.length), actual = kk > 0 ? rs[kk - 1] : null;
    centro = (actual ? fraseCarta(e, lista(actual.textos), 'tele') : fraseCarta(e, [], 'tele'))
      + (kk > 1 ? `<div class="p-previas">${rs.slice(0, kk - 1).map((r) => `<div class="carta">${esc(lista(r.textos).join(' / '))}</div>`).join('')}</div>` : '');
    pie = k <= rs.length ? `${esc(nombre(st, e.juez))} lee las respuestas · ${k} de ${rs.length}` : `${esc(nombre(st, e.juez))} está eligiendo la ganadora…`;
  } else if (e.fase === 'ganador') {
    const g = e.ganador || {}, r = rs.find((x) => x.id === g.id);
    centro = `<div class="p-ganador">¡Punto para <b>${esc(g.nombre || '—')}</b>!</div>${r ? fraseCarta(e, lista(r.textos), 'tele ganadora') : ''}`;
    pie = e.campeon ? '¡Tenemos campeón!' : 'Siguiente ronda en un momento…';
  } else if (e.fase === 'fin') {
    centro = `<div class="p-titulo"><span class="etiqueta">Fin de la partida</span><h1>¡Ganó ${esc(lugares[0]?.nombre || '—')}!</h1></div>`;
  }
  $app.innerHTML = `<div class="pantalla">
    <div class="p-arriba"><span class="marca">La <em>Sobremesa</em> · Llena el hueco</span><span>${e.ronda ? `Ronda ${e.ronda}` : ''}</span></div>
    <div class="p-cuerpo">
      <div class="p-centro">${centro}${pie ? `<div class="p-pie">${pie}</div>` : ''}</div>
      <div class="p-lado"><span class="etiqueta">Puntos${e.opciones?.meta ? ` · a ${e.opciones.meta}` : ''}</span><div class="lista-puntos">${lugares.map((x) => filaPuntos(x, e)).join('')}</div></div>
    </div>
    <div class="p-esquina"><canvas id="qr"></canvas><div><span>Para sumarte</span><b>${esc(CODIGO)}</b></div></div>
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
document.addEventListener('visibilitychange', () => { if (PANTALLA) mantenerEncendida(); });

// ------------------------------------------------------------ eventos
document.addEventListener('input', (ev) => {
  const t = ev.target;
  if (t.dataset.blanca != null) {
    const pos = Number(t.dataset.blanca);
    ui.blancas[pos] = t.value;
    if (!ui.sel.includes(pos) && t.value.trim()) {
      if (ui.sel.length >= (ui.st.estado.frase?.h || 1)) ui.sel.shift();
      ui.sel.push(pos);
      // Se actualiza sin volver a pintar la carta en la que escribe
      document.querySelectorAll('.carta.mano').forEach((c) => c.classList.toggle('sel', ui.sel.includes(Number(c.dataset.pos))));
    }
    const b = document.querySelector('[data-accion="mandar"]');
    if (b) b.disabled = ui.sel.length !== (ui.st.estado.frase?.h || 1);
    const p = document.querySelector('.frase-carta p');
    if (p) p.innerHTML = llenar(ui.st.estado.frase, ui.sel.map((pos) => (ui.mano[pos] === -1 ? (ui.blancas[pos] || '…') : ui.mazo.respuestas[ui.mano[pos]])));
  }
});

document.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.dataset.accion === 'op') { ui.prep[t.dataset.op] = t.checked; }
});

document.addEventListener('toggle', (ev) => { if (ev.target.dataset?.accion === 'ver-puntos') ui.verPuntos = ev.target.open; }, true);

document.addEventListener('click', async (ev) => {
  if (ev.target.closest('textarea')) return;
  const b = ev.target.closest('[data-accion]');
  if (!b) { if (ui.menu) { ui.menu = false; pintar(); } return; }
  const st = ui.st, e = st?.estado || {};
  const a = b.dataset.accion;
  if (a === 'op' || a === 'ver-puntos') return;
  switch (a) {
    case 'menu': ui.menu = !ui.menu; pintar(); break;
    case 'a-sala':
      ui.menu = false;
      if (confirm('¿Volver a la sala? La partida termina.')) await ui.sala.elegirJuego(null);
      else pintar();
      break;
    case 'reiniciar':
      ui.menu = false;
      if (e.fase === 'fin' || confirm('¿Empezar otra partida? Los puntos de esta se pierden.')) {
        await guardar({ 'publico/estado': { tipo: 'llena', fase: 'preparando', opciones: e.opciones || OPCIONES }, secreto: null, acciones: null });
      } else pintar();
      break;
    case 'al-marcador': {
      const { estadoInicial } = await import('../../marcador/sala-marcador.js');
      const est = estadoInicial(), ronda = est.rondas[0];
      ronda.nombre = 'Llena el hueco';
      est.titulo = 'Llena el hueco';
      const puntos = {};
      posiciones(st, e).forEach((x, i) => { est.jugadores[x.uid] = { nombre: x.nombre, color: x.color, orden: i, ...(st.jugadores[x.uid] ? {} : { extra: true }) }; puntos[x.uid] = { [ronda.id]: String(x.puntos) }; });
      await ui.sala.db.update(ui.sala.raiz, { 'publico/juego': 'marcador', 'publico/estado': est, 'publico/puntos': puntos, secreto: null, acciones: null, 'publico/actividad': ui.sala.db.marcaTiempo() });
      break;
    }
    case 'mazo': ui.prep.mazo = b.dataset.id; pintar(); break;
    case 'meta': ui.prep.meta = Math.min(20, Math.max(1, ui.prep.meta + Number(b.dataset.d))); pintar(); break;
    case 'empezar': b.disabled = true; await empezar().catch((x) => { console.error(x); aviso('No se pudo empezar. Revisa tu conexión.'); }); break;
    case 'carta': {
      const pos = Number(b.dataset.pos), h = e.frase?.h || 1, k = ui.sel.indexOf(pos);
      if (k >= 0) ui.sel.splice(k, 1);
      else { if (ui.sel.length >= h) ui.sel.shift(); ui.sel.push(pos); }
      pintar();
      if (ui.mano[pos] === -1 && ui.sel.includes(pos)) document.querySelector(`[data-blanca="${pos}"]`)?.focus();
      break;
    }
    case 'mandar': b.disabled = true; await mandar().catch((x) => { console.error(x); aviso('No se pudo mandar. Revisa tu conexión.'); pintar(); }); break;
    case 'reenviar': ui.reenviar = true; pintar(); break;
    case 'cambio':
      if (confirm('¿Cambiar tus 7 cartas por otras nuevas? Te cuesta 1 punto.')) { await ui.sala.db.set(`${R()}/acciones/${ui.sala.uid}/cambio`, e.ronda); ui.sel = []; ui.blancas = {}; aviso('Cambiando tus cartas…'); }
      break;
    case 'forzar': await juez({ 'estado/forzar': e.ronda }); break;
    case 'revelar': await juez({ 'estado/revelado': (e.revelado || 0) + 1 }); break;
    case 'elegir': ui.eleccion = b.dataset.id; pintar(); break;
    case 'confirmar': if (ui.eleccion) { b.disabled = true; await juez({ 'estado/eleccion': ui.eleccion }); } break;
    case 'siguiente': b.disabled = true; await juez({ 'estado/siguiente': e.ronda }); break;
  }
});

iniciar().catch((x) => {
  console.error(x);
  $app.innerHTML = `<div class="centro"><h1 class="titulo">No pudimos abrir el juego</h1><p class="sub">Revisa tu conexión a internet e intenta de nuevo.</p><a class="btn sec grande" href="${esc(direccion('../../'))}">Volver al inicio</a></div>`;
});
