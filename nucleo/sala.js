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
const ESPERA_ANFITRION = 8000; // ms sin anfitrión conectado antes de que otro tome el control

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
    if (r.ok) return codigo;
  }
  throw new Error('No se pudo crear la sala. Intenta de nuevo.');
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
  let sala = null, rol = null, perfil = null, temporizador = null, apagar = [];

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

  // Si el anfitrión lleva un rato desconectado, el primer jugador conectado (por orden de llegada) toma el control.
  function revisarAnfitrion() {
    clearTimeout(temporizador);
    if (!sala || rol !== 'jugador' || !sala.jugadores?.[db.uid]) return;
    const a = sala.anfitrion, j = sala.jugadores || {};
    const anfitrionPresente = a && j[a] && j[a].conectado;
    if (anfitrionPresente) return;
    const siguiente = Object.entries(j).filter(([, x]) => x.conectado).sort((x, y) => (x[1].unido || 0) - (y[1].unido || 0))[0]?.[0];
    if (siguiente !== db.uid) return;
    const espera = a && j[a] ? ESPERA_ANFITRION : 0; // sin anfitrión (sala recién creada desde la tele): de inmediato
    temporizador = setTimeout(async () => {
      await db.transaccion(`${base}/anfitrion`, (actual) => {
        const jj = sala?.jugadores || {};
        if (actual && jj[actual]?.conectado) return undefined;
        return db.uid;
      }).catch(() => {});
    }, espera);
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
    cerrar() { clearTimeout(temporizador); apagar.forEach((f) => typeof f === 'function' && f()); apagar = []; }
  };
  return api;
}
