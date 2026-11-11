// La Sobremesa · el marcador dentro de una sala
// ------------------------------------------------------------
// En la sala el marcador se guarda así:
//   publico/estado   { tipo: 'marcador', titulo, regla, candado, rondas: [{id, nombre}],
//                      jugadores: { id: { nombre, color, orden, extra? } } }   (solo lo escribe el anfitrión)
//   publico/puntos   { idJugador: { idRonda: '12' } }   (cada jugador los suyos; el anfitrión, todos)
// "extra" marca a quien juega sin celular: lo agrega y lo captura el anfitrión.
// Con candado = true solo el anfitrión captura.

import { abrirSala, existeSala, codigoValido } from '../nucleo/sala.js';

const nuevoId = () => Math.random().toString(36).slice(2, 10);
export const estadoInicial = () => ({
  tipo: 'marcador', titulo: 'Marcador', regla: 'high', candado: false,
  rondas: [{ id: nuevoId(), nombre: 'Ronda 1' }], jugadores: {}
});

// Compara sin importar el orden de las llaves (Firebase las devuelve ordenadas)
const ordenar = (v) => (v && typeof v === 'object' && !Array.isArray(v))
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, ordenar(v[k])]))
  : Array.isArray(v) ? v.map(ordenar) : v;
const igual = (a, b) => JSON.stringify(ordenar(a ?? null)) === JSON.stringify(ordenar(b ?? null));
const lista = (v) => (Array.isArray(v) ? v : Object.values(v || {})).filter(Boolean);
const valor = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim().slice(0, 12));

// Convierte la sala al formato del marcador: { title, rule, candado, players, rounds, scores }
function armar(st) {
  const e = st.estado || {}, vivos = st.jugadores || {}, reg = e.jugadores || {};
  const ids = new Set([...Object.keys(reg), ...Object.keys(vivos)]);
  const players = [...ids].map((id) => {
    const v = vivos[id], r = reg[id] || {};
    return {
      id, name: v?.nombre ?? r.nombre ?? '—', color: v?.color ?? r.color ?? '#ff8a6b',
      celular: !r.extra, conectado: v ? !!v.conectado : false,
      _orden: r.orden ?? 1e9 + (v?.unido || 0)
    };
  }).sort((a, b) => a._orden - b._orden).map(({ _orden, ...p }) => p);
  const rounds = lista(e.rondas).map((r) => ({ id: String(r.id), name: r.nombre ?? '' }));
  return {
    title: e.titulo ?? 'Marcador', rule: e.regla === 'low' ? 'low' : 'high', candado: !!e.candado,
    players, rounds: rounds.length ? rounds : [{ id: 'inicial', name: 'Ronda 1' }],
    scores: JSON.parse(JSON.stringify(st.puntos || {}))
  };
}

// alCambiar(estadoMarcador, { soyAnfitrion, yo, nombreAnfitrion, codigo })
// alIrse(motivo): 'sala' (el anfitrión regresó a la sala), 'unirse' (no está sentado) o 'no-existe'
export async function enlazar(codigo, { pantalla = false, alCambiar, alIrse }) {
  if (!codigoValido(codigo) || !(await existeSala(codigo))) { alIrse('no-existe'); return null; }
  let resolver, primera = true, activo = false, base = null;
  const lista0 = new Promise((r) => { resolver = r; });
  const sala = await abrirSala(codigo, {
    alCambiar: (st) => { if (primera) { primera = false; resolver(st); } else if (activo) procesar(st); },
    alPerder: () => alIrse('no-existe')
  });
  const st0 = await lista0;
  if (pantalla) await sala.entrarComo('pantalla');
  else if (st0.jugadores[sala.uid]) await sala.entrarComo('jugador', { nombre: st0.jugadores[sala.uid].nombre, color: st0.jugadores[sala.uid].color });
  else { sala.cerrar(); alIrse('unirse'); return null; }
  activo = true;

  let ido = false;
  function irse(motivo) { if (ido) return; ido = true; sala.cerrar(); alIrse(motivo); }

  function procesar(st) {
    if (!st || ido) return;
    if (st.juego !== 'marcador') return irse('sala');
    if (st.rol === 'jugador' && !st.jugadores[st.yo]) return irse('unirse'); // lo sacaron de la sala
    if (st.soyAnfitrion) mantenerRegistro(st);
    base = armar(st);
    // Copia: el marcador modifica su estado y aquí se compara contra lo último que llegó
    alCambiar(JSON.parse(JSON.stringify(base)), { soyAnfitrion: st.soyAnfitrion, yo: st.yo, nombreAnfitrion: st.nombreAnfitrion, codigo });
  }

  // El anfitrión anota en el estado a cada jugador que llega, para que su nombre y sus puntos
  // se queden en el marcador aunque después salga de la sala.
  let pendiente = false;
  function mantenerRegistro(st) {
    if (pendiente) return;
    if (!st.estado || st.estado.tipo !== 'marcador') {
      pendiente = true;
      sala.actualizar({ estado: estadoInicial() }).finally(() => { pendiente = false; });
      return;
    }
    const reg = st.estado.jugadores || {}, cambios = {};
    let orden = Math.max(-1, ...Object.values(reg).map((r) => r.orden ?? -1));
    st.lista.forEach((j) => {
      const r = reg[j.uid];
      if (!r) cambios[`estado/jugadores/${j.uid}`] = { nombre: j.nombre, color: j.color, orden: ++orden };
      else if (!r.extra && (r.nombre !== j.nombre || r.color !== j.color)) {
        cambios[`estado/jugadores/${j.uid}/nombre`] = j.nombre;
        cambios[`estado/jugadores/${j.uid}/color`] = j.color;
      }
    });
    if (Object.keys(cambios).length) {
      pendiente = true;
      sala.actualizar(cambios).catch(() => {}).finally(() => { pendiente = false; });
    }
  }

  // Manda solo lo que cambió respecto a lo último que llegó de la sala
  function guardar(n) {
    const st = sala.estado();
    if (!st || !base || ido) return Promise.resolve();
    const cambios = {}, anf = st.soyAnfitrion;
    if (anf) {
      const e = st.estado || {};
      if (n.title !== base.title) cambios['estado/titulo'] = String(n.title ?? '').slice(0, 60);
      if (n.rule !== base.rule) cambios['estado/regla'] = n.rule === 'low' ? 'low' : 'high';
      if (!!n.candado !== base.candado) cambios['estado/candado'] = !!n.candado;
      const rondas = n.rounds.map((r) => ({ id: r.id, nombre: String(r.name ?? '').slice(0, 30) }));
      if (!igual(rondas, lista(e.rondas))) cambios['estado/rondas'] = rondas;
      const reg = e.jugadores || {}, ids = new Set(n.players.map((p) => p.id));
      n.players.forEach((p, i) => {
        const nuevo = { nombre: String(p.name ?? '').slice(0, 24) || '—', color: p.color, orden: i, ...(p.celular ? {} : { extra: true }) };
        if (!igual(reg[p.id], nuevo)) cambios[`estado/jugadores/${p.id}`] = nuevo;
      });
      Object.keys(reg).forEach((id) => { if (!ids.has(id)) cambios[`estado/jugadores/${id}`] = null; });
      // Si el anfitrión quita a alguien que tiene celular, también lo saca de la sala
      base.players.forEach((p) => { if (!ids.has(p.id) && st.jugadores[p.id]) sala.sacarJugador(p.id).catch(() => {}); });
    }
    const rondas = new Set(n.rounds.map((r) => r.id)), jugadores = new Set(n.players.map((p) => p.id));
    const puede = (pid) => anf || (pid === st.yo && !base.candado);
    const pids = new Set([...Object.keys(base.scores), ...Object.keys(n.scores || {})]);
    pids.forEach((pid) => {
      if (!puede(pid)) return;
      if (anf && !jugadores.has(pid)) { if (base.scores[pid]) cambios[`puntos/${pid}`] = null; return; }
      const a = base.scores[pid] || {}, b = (n.scores || {})[pid] || {};
      new Set([...Object.keys(a), ...Object.keys(b)]).forEach((rid) => {
        const va = valor(a[rid]), vb = anf && !rondas.has(rid) ? null : valor(b[rid]);
        if (va !== vb) cambios[`puntos/${pid}/${rid}`] = vb;
      });
    });
    if (!Object.keys(cambios).length) return Promise.resolve();
    return sala.actualizar(cambios);
  }

  procesar(sala.estado());
  return {
    uid: sala.uid,
    guardar,
    terminar: () => sala.actualizar({ juego: null })
  };
}
