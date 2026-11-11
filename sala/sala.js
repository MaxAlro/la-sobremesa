// La Sobremesa · página de sala (jugador o pantalla)
import { hayFirebase } from '../nucleo/datos.js';
import { crearSala, existeSala, abrirSala, normalizarCodigo, codigoValido, perfilGuardado } from '../nucleo/sala.js';

const params = new URLSearchParams(location.search);
const $app = document.getElementById('app');
const css = getComputedStyle(document.documentElement);
const token = (n) => css.getPropertyValue(n).trim();
const COLORES = Array.from({ length: 10 }, (_, i) => token(`--jugador-${i + 1}`)).filter(Boolean);
const esc = (s) => String(s ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const inicial = (n) => esc(String(n || '?').trim().charAt(0).toUpperCase());

const JUEGOS = [
  { id: 'marcador', nombre: 'Marcador', desc: 'Puntos por ronda desde cada celular', ic: '#', pronto: true },
  { id: 'llena-el-hueco', nombre: 'Llena el hueco', desc: 'Cartas · 4 a 9 jugadores · adultos', ic: '¿?', pronto: true }
];

// Parámetros de prueba que se conservan al cambiar de dirección
const DE_PRUEBA = ['local', 'sdk', 'emulador', 'emuauth'];
function direccion(extra = {}, ruta = location.pathname) {
  const u = new URL(ruta, location.href);
  for (const k of DE_PRUEBA) if (params.has(k)) u.searchParams.set(k, params.get(k));
  for (const [k, v] of Object.entries(extra)) if (v != null) u.searchParams.set(k, v);
  return u.toString();
}

let avisoT;
function aviso(texto, ms = 2200) {
  const a = document.getElementById('aviso');
  a.textContent = texto; a.classList.add('ver');
  clearTimeout(avisoT); avisoT = setTimeout(() => a.classList.remove('ver'), ms);
}

function dibujarQR(canvas, texto) {
  if (!canvas || typeof qrcode !== 'function') return;
  const q = qrcode(0, 'M'); q.addData(texto); q.make();
  const n = q.getModuleCount(), m = 2; // margen de 2 módulos
  canvas.width = canvas.height = n + m * 2;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = token('--carta'); ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = token('--tinta');
  for (let f = 0; f < n; f++) for (let c = 0; c < n; c++) if (q.isDark(f, c)) ctx.fillRect(c + m, f + m, 1, 1);
}

function centro(html) { document.body.classList.remove('modo-pantalla'); $app.innerHTML = `<div class="centro">${html}</div>`; }
const volver = `<a class="btn sec grande" href="${esc(direccion({}, '../'))}">Volver al inicio</a>`;

// ------------------------------------------------------------ arranque
async function iniciar() {
  if (!hayFirebase() && !params.has('local')) {
    centro(`<h1 class="titulo">Las salas llegan muy pronto</h1><p class="sub">Todavía no están conectadas a internet. Mientras tanto, el marcador funciona en cada dispositivo.</p>${volver}`);
    return;
  }
  let codigo = normalizarCodigo(params.get('c'));
  const nueva = params.get('nueva');
  let rolPedido = params.get('rol');
  if (nueva) {
    centro('<p class="sub">Creando la sala…</p>');
    codigo = await crearSala({ comoPantalla: nueva === 'pantalla' });
    rolPedido = nueva === 'pantalla' ? 'pantalla' : null;
    history.replaceState(null, '', direccion({ c: codigo, rol: rolPedido }));
  }
  if (!codigoValido(codigo)) { centro(`<h1 class="titulo">Falta el código de la sala</h1><p class="sub">Son 4 letras, por ejemplo TACO.</p>${volver}`); return; }
  if (!(await existeSala(codigo))) { noExiste(codigo); return; }

  let primera = true, resolverPrimera;
  const lista = new Promise((r) => { resolverPrimera = r; });
  const sala = await abrirSala(codigo, {
    alCambiar: (st) => { if (primera) { primera = false; resolverPrimera(st); } else pintar(st); },
    alPerder: () => noExiste(codigo)
  });
  window.__sala = sala; // para pruebas
  const st = await lista;
  ui.sala = sala; ui.codigo = codigo;
  const perfil = perfilGuardado();
  if (rolPedido === 'pantalla') {
    await sala.entrarComo('pantalla');
  } else if (st.jugadores[sala.uid] && perfil.nombre) {
    // Ya estaba en esta sala (recargó la página o se le apagó la pantalla): vuelve a su lugar
    await sala.entrarComo('jugador', { nombre: st.jugadores[sala.uid].nombre, color: st.jugadores[sala.uid].color });
  }
  pintar(sala.estado());
}

function noExiste(codigo) {
  centro(`<h1 class="titulo">No encontramos la sala ${esc(codigo)}</h1><p class="sub">Revisa el código, o pide que creen una sala nueva.</p>${volver}`);
}

// ------------------------------------------------------------ pintar
const ui = { sala: null, codigo: '', vista: '', editando: false, menu: false };
const enlaceSala = () => direccion({ c: ui.codigo }, location.pathname);

function pintar(st) {
  if (!st) return;
  let vista;
  if (st.rol === 'pantalla') vista = 'pantalla';
  else if (st.rol === 'jugador' && st.jugadores[st.yo] && !ui.editando) vista = 'espera';
  else vista = 'unirse';
  if (vista === 'unirse' && ui.vista === 'unirse') { actualizarColores(st); return; } // no borrar lo que está escribiendo
  if (vista === 'unirse' && ui.vista === 'espera') aviso('Te sacaron de la mesa. Puedes volver a sentarte.', 4000);
  ui.vista = vista;
  document.body.classList.toggle('modo-pantalla', vista === 'pantalla');
  if (vista === 'pantalla') pintarPantalla(st);
  else if (vista === 'espera') pintarEspera(st);
  else pintarUnirse(st);
}

function botonRol(st, { arriba = false } = {}) {
  const esPantalla = st.rol === 'pantalla';
  return `<div class="envoltura-rol">
    <button class="rol ${esPantalla ? 'discreto' : ''}" data-accion="menu" aria-haspopup="true" aria-expanded="${ui.menu}">${esPantalla ? 'Pantalla' : st.rol === 'jugador' ? 'Jugador' : 'Visitante'} ▾</button>
    ${ui.menu ? `<div class="menu ${arriba ? 'arriba' : ''}" role="menu">
      ${esPantalla ? '<button data-accion="ser-jugador">Usar como jugador</button>' : '<button data-accion="ser-pantalla">Usar este dispositivo como pantalla</button>'}
      ${st.rol === 'jugador' ? '<button data-accion="editar">Cambiar nombre o color</button>' : ''}
      <button class="peligro" data-accion="salir">Salir de la sala</button>
    </div>` : ''}
  </div>`;
}
function barra(st) {
  return `<div class="barra">
    <a class="marca" href="${esc(direccion({}, '../'))}">La <em>Sobremesa</em></a>
    <div class="barra-der"><span class="codigo-mini">${esc(ui.codigo)}</span>${botonRol(st)}</div>
  </div>`;
}
const avisoLocal = () => (ui.sala?.local ? '<p class="aviso-local">Modo de prueba: esta sala solo existe en este navegador.</p>' : '');

function pintarUnirse(st) {
  const p = perfilGuardado();
  const mio = st.jugadores[st.yo];
  const nombre = mio?.nombre || p.nombre || '';
  const elegido = mio?.color || (p.color && !colorOcupado(st, p.color) ? p.color : COLORES.find((c) => !colorOcupado(st, c)) || COLORES[0]);
  $app.innerHTML = `<main class="jugador">
    ${barra(st)}
    <div><h1 class="titulo">${ui.editando ? 'Tu nombre y color' : 'Siéntate a la mesa'}</h1>
    <p class="sub">${ui.editando ? 'Así te verán los demás.' : `Sala <b class="codigo-mini">${esc(ui.codigo)}</b>${st.lista.length ? ` · ya están ${st.lista.length}` : ''}`}</p></div>
    <form class="form" id="formUnirse" autocomplete="off">
      <label class="etiqueta" for="nombre">Tu nombre</label>
      <input class="campo" id="nombre" maxlength="24" required value="${esc(nombre)}" placeholder="Por ejemplo, Tía Lupe" enterkeyhint="done">
      <span class="etiqueta">Tu color</span>
      <div class="colores" id="colores">${COLORES.map((c) => `<button type="button" class="color" data-color="${c}" style="background:${c}" aria-pressed="${c === elegido}" aria-label="Color"></button>`).join('')}</div>
      <p class="error oculto" id="errorUnirse"></p>
      <button class="btn pri grande" type="submit">${ui.editando ? 'Guardar' : 'Sentarme a la mesa'}</button>
      ${ui.editando ? '<button class="enlace" type="button" data-accion="cancelar">Cancelar</button>' : '<button class="enlace" type="button" data-accion="ser-pantalla">Usar este dispositivo como pantalla</button>'}
    </form>
    ${avisoLocal()}
  </main>`;
  actualizarColores(st);
}

function colorOcupado(st, c) {
  return Object.entries(st.jugadores).some(([u, x]) => u !== st.yo && x.color?.toLowerCase() === c.toLowerCase());
}
function actualizarColores(st) {
  document.querySelectorAll('#colores .color').forEach((b) => {
    const dueño = Object.entries(st.jugadores).find(([u, x]) => u !== st.yo && x.color?.toLowerCase() === b.dataset.color.toLowerCase())?.[1];
    b.disabled = !!dueño;
    b.textContent = dueño ? inicial(dueño.nombre) : '';
    b.title = dueño ? `Lo tiene ${dueño.nombre}` : '';
    if (dueño && b.getAttribute('aria-pressed') === 'true') {
      b.setAttribute('aria-pressed', 'false');
      document.querySelector('#colores .color:not(:disabled)')?.setAttribute('aria-pressed', 'true');
    }
  });
}

function pintarEspera(st) {
  const invitar = st.hayPantalla
    ? `<div class="panel invitar-corto"><span class="codigo-mini">${esc(ui.codigo)}</span><span class="texto">Ya hay una pantalla mostrando el código.</span><button class="btn" data-accion="compartir">Compartir</button></div>`
    : `<div class="panel-acento invitar">
        <div class="qr"><canvas id="qr"></canvas></div>
        <span class="etiqueta">Código de la sala</span>
        <div class="codigo-grande">${esc(ui.codigo)}</div>
        <div class="fila-botones">
          <a class="btn pri" href="https://wa.me/?text=${encodeURIComponent(`¡Vente a jugar a La Sobremesa! Sala ${ui.codigo}: ${enlaceSala()}`)}" target="_blank" rel="noopener">Compartir por WhatsApp</a>
          <button class="btn" data-accion="copiar">Copiar enlace</button>
        </div>
      </div>`;
  const personas = st.lista.map((x) => {
    const yo = x.uid === st.yo, anf = x.uid === st.anfitrion;
    const acc = st.soyAnfitrion && !yo
      ? `<div class="acc">${x.conectado ? `<button class="btn" data-accion="control" data-uid="${esc(x.uid)}">Darle el control</button>` : ''}<button class="btn peligro" data-accion="sacar" data-uid="${esc(x.uid)}" aria-label="Sacar a ${esc(x.nombre)}">Sacar</button></div>` : '';
    return `<div class="persona ${yo ? 'yo' : ''} ${x.conectado ? '' : 'fuera'}">
      <span class="av" style="background:${esc(x.color)}">${inicial(x.nombre)}</span>
      <div class="nom"><b>${esc(x.nombre)}${yo ? ' (tú)' : ''}</b><small>${x.conectado ? (anf ? 'Anfitrión' : 'En la mesa') : 'Desconectado'}</small></div>
      ${anf ? '<span class="insignia">Anfitrión</span>' : ''}${acc}
    </div>`;
  }).join('');
  const juegos = st.soyAnfitrion
    ? `<span class="etiqueta">Elige el juego</span><div class="juegos">${JUEGOS.map((j) => `<button class="juego" data-accion="juego" data-juego="${j.id}" ${j.pronto ? 'disabled' : ''}><span class="ic">${j.ic}</span><div><strong>${j.nombre}</strong><span>${j.desc}</span></div>${j.pronto ? '<span class="insignia">Pronto</span>' : ''}</button>`).join('')}</div>`
    : `<div class="panel espera">Esperando a que <b>${esc(st.nombreAnfitrion || 'el anfitrión')}</b> elija el juego…</div>`;
  $app.innerHTML = `<main class="jugador">
    ${barra(st)}
    ${invitar}
    <span class="etiqueta">En la mesa · ${st.lista.filter((x) => x.conectado).length}</span>
    <div class="lista">${personas}</div>
    ${juegos}
    ${avisoLocal()}
  </main>`;
  dibujarQR(document.getElementById('qr'), enlaceSala());
}

let candado = null;
async function mantenerEncendida() {
  try { if (!candado && 'wakeLock' in navigator && document.visibilityState === 'visible') { candado = await navigator.wakeLock.request('screen'); candado.addEventListener('release', () => { candado = null; }); } } catch {}
}
document.addEventListener('visibilitychange', () => { if (ui.vista === 'pantalla') mantenerEncendida(); });

function pintarPantalla(st) {
  const enMesa = st.lista;
  const asientos = enMesa.map((x) => `<div class="asiento ${x.conectado ? '' : 'fuera'}"><span class="av" style="background:${esc(x.color)}">${inicial(x.nombre)}</span><span>${esc(x.nombre)}</span></div>`).join('')
    + Array.from({ length: Math.max(0, 9 - enMesa.length) }, () => '<div class="asiento libre">Lugar libre</div>').join('');
  const juego = JUEGOS.find((j) => j.id === st.juego);
  const estado = juego
    ? `<div><strong>${esc(juego.nombre)}</strong><span>Empezando…</span></div>`
    : enMesa.length
      ? `<div><strong>Sala de espera</strong><span>${esc(st.nombreAnfitrion || 'El anfitrión')} elige el juego desde su celular</span></div>`
      : `<div><strong>Escanea el código para sentarte</strong><span>El primero que entre será el anfitrión</span></div>`;
  const dir = enlaceSala().replace(/^https?:\/\//, '').replace(/\/sala\/.*$/, '');
  $app.innerHTML = `<div class="pantalla">
    <div class="p-arriba"><span class="marca">La <em>Sobremesa</em></span><span>${enMesa.length} de 9 lugares</span></div>
    <div class="p-cuerpo">
      <div class="p-unirse">
        <div class="qr"><canvas id="qr"></canvas></div>
        <div class="etq">Código de la sala</div>
        <div class="cod">${esc(ui.codigo)}</div>
        <div class="url">Escanea o entra a <b>${esc(dir)}</b></div>
      </div>
      <div class="p-mesa">
        <div class="etq">En la mesa</div>
        <div class="asientos">${asientos}</div>
        <div class="p-estado"><span class="mini"></span>${estado}</div>
      </div>
    </div>
  </div>
  <div class="p-esquina">${botonRol(st, { arriba: true })}</div>`;
  dibujarQR(document.getElementById('qr'), enlaceSala());
  mantenerEncendida();
}

// ------------------------------------------------------------ acciones
document.addEventListener('click', async (e) => {
  const color = e.target.closest('.color');
  if (color && !color.disabled) {
    document.querySelectorAll('#colores .color').forEach((b) => b.setAttribute('aria-pressed', String(b === color)));
    return;
  }
  const b = e.target.closest('[data-accion]');
  if (!b) { if (ui.menu && !e.target.closest('.menu')) { ui.menu = false; pintarDeNuevo(); } return; }
  const s = ui.sala, st = s?.estado();
  switch (b.dataset.accion) {
    case 'menu': ui.menu = !ui.menu; pintarDeNuevo(); break;
    case 'ser-pantalla': ui.menu = false; ui.editando = false; await s.entrarComo('pantalla'); history.replaceState(null, '', direccion({ c: ui.codigo, rol: 'pantalla' })); pintarDeNuevo(); break;
    case 'ser-jugador': ui.menu = false; await s.entrarComo('visitante'); history.replaceState(null, '', direccion({ c: ui.codigo })); pintarDeNuevo(); break;
    case 'editar': ui.menu = false; ui.editando = true; pintarDeNuevo(); break;
    case 'cancelar': ui.editando = false; pintarDeNuevo(); break;
    case 'salir': await s.salir(); location.href = direccion({}, '../'); break;
    case 'copiar':
      try { await navigator.clipboard.writeText(enlaceSala()); aviso('Enlace copiado'); } catch { aviso(enlaceSala(), 5000); }
      break;
    case 'compartir':
      if (navigator.share) { try { await navigator.share({ title: 'La Sobremesa', text: `Sala ${ui.codigo}`, url: enlaceSala() }); } catch {} }
      else { try { await navigator.clipboard.writeText(enlaceSala()); aviso('Enlace copiado'); } catch { aviso(enlaceSala(), 5000); } }
      break;
    case 'control': await s.pasarControl(b.dataset.uid); aviso('Listo, le pasaste el control'); break;
    case 'sacar': {
      const x = st.jugadores[b.dataset.uid];
      if (b.dataset.confirmar !== '1') { b.dataset.confirmar = '1'; b.textContent = '¿Seguro?'; setTimeout(() => { if (b.isConnected) { b.dataset.confirmar = ''; b.textContent = 'Sacar'; } }, 3000); break; }
      await s.sacarJugador(b.dataset.uid); aviso(`${x?.nombre || 'Jugador'} salió de la mesa`); break;
    }
    case 'juego': await s.elegirJuego(b.dataset.juego); break;
  }
});

document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'formUnirse') return;
  e.preventDefault();
  const nombre = document.getElementById('nombre').value.trim().slice(0, 24);
  const color = document.querySelector('#colores .color[aria-pressed="true"]:not(:disabled)')?.dataset.color;
  const err = document.getElementById('errorUnirse');
  if (!nombre) { err.textContent = 'Escribe tu nombre para que te reconozcan.'; err.classList.remove('oculto'); return; }
  if (!color) { err.textContent = 'Elige un color libre.'; err.classList.remove('oculto'); return; }
  const btn = e.target.querySelector('[type="submit"]'); btn.disabled = true;
  try {
    if (ui.editando) { await ui.sala.actualizarPerfil({ nombre, color }); ui.editando = false; }
    else await ui.sala.entrarComo('jugador', { nombre, color });
  } catch (x) {
    err.textContent = 'No se pudo guardar. Revisa tu conexión e intenta de nuevo.'; err.classList.remove('oculto'); btn.disabled = false; console.error(x); return;
  }
  ui.vista = ''; pintarDeNuevo();
});

function pintarDeNuevo() { const st = ui.sala?.estado(); if (st) { ui.vista = ''; pintar(st); } }

iniciar().catch((x) => {
  console.error(x);
  centro(`<h1 class="titulo">No pudimos abrir la sala</h1><p class="sub">Revisa tu conexión a internet e intenta de nuevo.</p>${volver}`);
});
