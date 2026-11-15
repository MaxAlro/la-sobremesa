// La Sobremesa · salas
// ------------------------------------------------------------
// Estructura en la base de datos:
//   salas/<CODIGO>/publico/creada       hora de creación
//   salas/<CODIGO>/publico/actividad    última actividad (una sala con 24 h sin actividad se puede borrar y reusar su código)
//   salas/<CODIGO>/publico/anfitrion    uid del anfitrión (null hasta que entra el primer jugador)
//   salas/<CODIGO>/publico/juego        juego elegido (null = en la sala de espera)
//   salas/<CODIGO>/publico/jugadores/<uid>  { nombre, color, unido, conectado }
//   salas/<CODIGO>/publico/pantallas/<uid>  { desde }
//   salas/<CODIGO>/publico/estado       estado del juego (lo escribe el anfitrión)
//   salas/<CODIGO>/publico/puntos/<uid>/<ronda>  puntos del marcador (cada jugador los suyos, o el anfitrión)
//   salas/<CODIGO>/privado/<uid>        lo que solo ve ese jugador (por ejemplo, su mano)

import { conectar } from './datos.js';

// Sin I, O ni Q para que no se confundan con 1, 0 o la O.
const LETRAS = 'ABCDEFGHJKLMNPRSTUVWXYZ';
const UN_DIA = 24 * 60 * 60 * 1000;
export const ESPERA_TOMAR_CONTROL = 3 * 60 * 1000; // ms con el anfitrión desconectado antes de que otro pueda tomar el control a mano

export const normalizarCodigo = (c) => String(c || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
export const codigoValido = (c) => /^[A-Z]{4}$/.test(c);

const PERFIL = 'sobremesa-perfil';
export function perfilGuardado() {
  try { return JSON.parse(localStorage.getItem(PERFIL) || 'null') || {}; } catch { return {}; }
}
export function guardarPerfil(cambios) {
  try { localStorage.setItem(PERFIL, JSON.stringify({ ...perfilGuardado(), ...cambios })); } catch {}
}

export async function crearSala({ comoPantalla = false } = {}) {
  const db = await conectar();
  for (let intento = 0; intento < 12; intento++) {
    const codigo = Array.from({ length: 4 }, () => LETRAS[Math.floor(Math.random() * LETRAS.length)]).join('');
    // Si el código lo tiene una sala abandonada (24 h sin actividad), se borra y se reutiliza
    const actividad = await db.get(`salas/${codigo}/publico/actividad`);
    if (actividad && actividad < db.ahora() - UN_DIA) await db.remove(`salas/${codigo}`).catch(() => {});
    const r = await db.transaccion(`salas/${codigo}/publico`, (actual) => {
      if (actual) return undefined;
      return { creada: db.marcaTiempo(), actividad: db.marcaTiempo(), creador: db.uid };
    });
    if (r.ok) {
      await db.set(`indice/${codigo}`, db.marcaTiempo()).catch(() => {});
      limpiarSalasViejas(db).catch(() => {});
      return codigo;
    }
  }
  throw new Error('No se pudo crear la sala. Intenta de nuevo.');
}

// Cada vez que se crea una sala, se borran las que llevan 24 h sin actividad.
// "indice" guarda solo el código y cuándo se creó cada sala, para poder encontrarlas.
async function limpiarSalasViejas(db) {
  const indice = (await db.get('indice')) || {};
  const limite = db.ahora() - UN_DIA;
  const viejas = Object.keys(indice).filter((c) => indice[c] < limite).slice(0, 25);
  for (const codigo of viejas) {
    const actividad = await db.get(`salas/${codigo}/publico/actividad`).catch(() => undefined);
    if (actividad === undefined || (actividad && actividad >= limite)) continue;
    if (actividad) await db.remove(`salas/${codigo}`).catch(() => {});
    await db.remove(`indice/${codigo}`).catch(() => {});
  }
}

export async function existeSala(codigo) {
  const db = await conectar();
  return !!(await db.get(`salas/${codigo}/publico/creada`));
}

// Une este dispositivo a una sala y la mantiene al día.
// alCambiar(sala) recibe { codigo, anfitrion, juego, jugadores, pantallas, estado, ... } cada vez que algo cambia.
export async function abrirSala(codigo, { alCambiar, alPerder } = {}) {
  const db = await conectar();
  const base = `salas/${codigo}/publico`;
  let sala = null, rol = null, perfil = null, temporizador = null, temporizadorAusente = null, apagar = [];

  const toca = () => db.set(`${base}/actividad`, db.marcaTiempo()).catch(() => {});

  async function presentarme() {
    if (rol === 'jugador' && perfil) {
      await db.update(`${base}/jugadores/${db.uid}`, { nombre: perfil.nombre, color: perfil.color, conectado: true, ...(sala?.jugadores?.[db.uid]?.unido ? {} : { unido: db.marcaTiempo() }) });
      await db.alDesconectar(`${base}/jugadores/${db.uid}/conectado`, false);
    } else if (rol === 'pantalla') {
      await db.set(`${base}/pantallas/${db.uid}`, { desde: db.marcaTiempo() });
      await db.alDesconectar(`${base}/pantallas/${db.uid}`, null);
    }
  }

  // El anfitrión no cambia aunque se desconecte: la sala lo espera hasta que vuelva o le pase el control a otro.
  // Solo si la sala no tiene anfitrión (recién creada desde la tele, o el anfitrión salió sin nadie a quien
  // pasárselo), el primer jugador conectado (por orden de llegada) toma el control.
  function revisarAnfitrion() {
    clearTimeout(temporizador);
    if (!sala || rol !== 'jugador' || !sala.jugadores?.[db.uid]) return;
    const a = sala.anfitrion, j = sala.jugadores || {};
    if (a && j[a]) return;
    const siguiente = Object.entries(j).filter(([, x]) => x.conectado).sort((x, y) => (x[1].unido || 0) - (y[1].unido || 0))[0]?.[0];
    if (siguiente !== db.uid) return;
    temporizador = setTimeout(async () => {
      await db.transaccion(`${base}/anfitrion`, (actual) => {
        if (actual && sala?.jugadores?.[actual]) return undefined;
        return db.uid;
      }).catch(() => {});
    }, 0);
  }

  // Desde cuándo veo desconectado al anfitrión. Se guarda en este dispositivo (sobrevive a recargar la página)
  // y sirve para ofrecer "Tomar el control" si no vuelve en unos minutos. Nunca cambia el anfitrión por sí solo.
  const CLAVE_AUSENTE = `sobremesa-ausente-${codigo}`;
  const leerAusente = () => { try { return JSON.parse(sessionStorage.getItem(CLAVE_AUSENTE) || 'null'); } catch { return null; } };
  const guardarAusente = (v) => { try { v ? sessionStorage.setItem(CLAVE_AUSENTE, JSON.stringify(v)) : sessionStorage.removeItem(CLAVE_AUSENTE); } catch {} };
  function anfitrionAusenteDesde() {
    const a = sala?.anfitrion, x = a && sala.jugadores[a];
    if (!x || x.conectado) return null;
    const g = leerAusente();
    return g && g.uid === a ? g.desde : null;
  }
  function revisarAusencia() {
    clearTimeout(temporizadorAusente);
    const a = sala?.anfitrion, x = a && sala.jugadores[a];
    if (!x || x.conectado) { guardarAusente(null); return; }
    let g = leerAusente();
    if (!g || g.uid !== a) { g = { uid: a, desde: Date.now() }; guardarAusente(g); }
    const falta = g.desde + ESPERA_TOMAR_CONTROL - Date.now();
    // Al cumplirse la espera, se vuelve a pintar para que aparezca el botón
    if (falta > 0) temporizadorAusente = setTimeout(() => alCambiar?.(api.estado()), falta + 50);
  }

  apagar.push(db.on(base, (v) => {
    if (!v || !v.creada) { sala = null; alPerder?.(); return; }
    const anterior = sala;
    sala = { codigo, ...v, jugadores: v.jugadores || {}, pantallas: v.pantallas || {} };
    // Si alguien me sacó de la sala, me quedo como visitante sin perfil
    if (rol === 'jugador' && anterior?.jugadores?.[db.uid] && !sala.jugadores[db.uid]) rol = null;
    // Al cambiar de página, la desconexión de la página anterior puede llegar después: me vuelvo a marcar presente
    else if (rol === 'jugador' && perfil && sala.jugadores[db.uid]?.conectado === false) presentarme().catch(() => {});
    revisarAnfitrion();
    revisarAusencia();
    alCambiar?.(api.estado());
  }));
  apagar.push(db.alConectar(() => { presentarme().catch(() => {}); }));

  const api = {
    uid: db.uid,
    local: db.local,
    db,                        // acceso directo para los juegos (manos, acciones, mazos)
    raiz: `salas/${codigo}`,
    estado() {
      if (!sala) return null;
      const jugadores = Object.entries(sala.jugadores).map(([uid, x]) => ({ uid, ...x }))
        .sort((a, b) => (a.unido || 0) - (b.unido || 0));
      return {
        ...sala,
        lista: jugadores,
        yo: db.uid,
        rol,
        soyAnfitrion: sala.anfitrion === db.uid,
        nombreAnfitrion: sala.jugadores[sala.anfitrion]?.nombre || null,
        // El anfitrión lleva ESPERA_TOMAR_CONTROL desconectado: cualquier jugador conectado puede tomar el control
        puedeTomarControl: rol === 'jugador' && !!sala.jugadores[db.uid]?.conectado && sala.anfitrion !== db.uid
          && (anfitrionAusenteDesde() ?? Infinity) + ESPERA_TOMAR_CONTROL <= Date.now(),
        hayPantalla: Object.keys(sala.pantallas).some((u) => u !== db.uid) || (rol === 'pantalla'),
        pantallasConectadas: Object.keys(sala.pantallas).length
      };
    },
    // rol: 'jugador' (con perfil {nombre, color}) o 'pantalla'
    async entrarComo(nuevoRol, nuevoPerfil) {
      if (rol === 'pantalla' && nuevoRol !== 'pantalla') await db.remove(`${base}/pantallas/${db.uid}`);
      if (rol === 'jugador' && nuevoRol === 'pantalla') {
        // Al pasar a pantalla deja de ser jugador; si era anfitrión, cede el control
        if (sala?.anfitrion === db.uid) {
          const otro = Object.entries(sala.jugadores).find(([u, x]) => u !== db.uid && x.conectado)?.[0] || null;
          await db.set(`${base}/anfitrion`, otro);
        }
        await db.remove(`${base}/jugadores/${db.uid}`);
      }
      rol = nuevoRol;
      perfil = nuevoPerfil || perfil;
      await presentarme();
      // El primer jugador de una sala sin anfitrión se vuelve anfitrión
      if (rol === 'jugador') {
        await db.transaccion(`${base}/anfitrion`, (actual) => (actual ? undefined : db.uid)).catch(() => {});
      }
      toca();
      guardarPerfil({ ultimoRol: rol, ...(perfil ? { nombre: perfil.nombre, color: perfil.color } : {}) });
    },
    async actualizarPerfil(cambios) {
      perfil = { ...perfil, ...cambios };
      guardarPerfil(cambios);
      if (rol === 'jugador') await db.update(`${base}/jugadores/${db.uid}`, cambios);
    },
    async elegirJuego(juego) { await db.set(`${base}/juego`, juego); toca(); },
    // Empieza un juego con su estado inicial y sin puntos anteriores (solo el anfitrión)
    async iniciarJuego(juego, estado) { await db.update(base, { juego, estado, puntos: null }); toca(); },
    // Escribe varias rutas dentro de la parte pública de la sala, por ejemplo { 'puntos/uid/ronda': '5' }
    async actualizar(cambios) { await db.update(base, cambios); toca(); },
    async pasarControl(uid) { await db.set(`${base}/anfitrion`, uid); toca(); },
    // Solo si el anfitrión sigue desconectado (si volvió o alguien más ya lo tomó, no hace nada). Devuelve true si lo tomó.
    async tomarControl() {
      const r = await db.transaccion(`${base}/anfitrion`, (actual) => {
        if (actual === db.uid) return undefined;
        if (actual && sala?.jugadores?.[actual]?.conectado) return undefined;
        return db.uid;
      });
      if (r.ok) toca();
      return r.ok && r.valor === db.uid;
    },
    async sacarJugador(uid) { await db.remove(`${base}/jugadores/${uid}`); await db.remove(`salas/${codigo}/privado/${uid}`); toca(); },
    async salir() {
      if (rol === 'jugador') {
        if (sala?.anfitrion === db.uid) {
          const otro = Object.entries(sala.jugadores).find(([u, x]) => u !== db.uid && x.conectado)?.[0] || null;
          await db.set(`${base}/anfitrion`, otro);
        }
        await db.remove(`${base}/jugadores/${db.uid}`);
      }
      if (rol === 'pantalla') await db.remove(`${base}/pantallas/${db.uid}`);
      rol = null;
      api.cerrar();
    },
    cerrar() { clearTimeout(temporizador); clearTimeout(temporizadorAusente); apagar.forEach((f) => typeof f === 'function' && f()); apagar = []; }
  };
  return api;
}
