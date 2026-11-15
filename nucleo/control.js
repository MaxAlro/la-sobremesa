// La Sobremesa · pasar el control dentro de un juego
// ------------------------------------------------------------
// El anfitrión solo cambia cuando él mismo le pasa el control a otro jugador: si se desconecta,
// la sala lo espera. Estas piezas las usa cada juego en su menú de anfitrión y arriba de la pantalla.
//
//   opcionesControl(st, abierto)  botones para el menú del anfitrión ("Pasar el control" y, abierto, la lista)
//                                 data-accion="pasar-control" abre o cierra la lista;
//                                 data-accion="dar-control" data-uid="..." se lo pasa a esa persona
//   avisoAnfitrion(st)            aviso para los demás cuando el anfitrión se desconectó; si lleva 3 minutos fuera,
//                                 trae el botón data-accion="tomar-control"
//   await tomarControl(sala, aviso)  pregunta y, si confirman, toma el control (para ese botón)

import { ESPERA_TOMAR_CONTROL } from './sala.js';

const esc = (s) => String(s ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));

const otrosConectados = (st) => (st.lista || []).filter((x) => x.uid !== st.yo && x.conectado);

export function opcionesControl(st, abierto) {
  const otros = otrosConectados(st);
  if (!st.soyAnfitrion || !otros.length) return '';
  const lista = abierto
    ? otros.map((x) => `<button class="menu-sub" data-accion="dar-control" data-uid="${esc(x.uid)}"><span class="punto" style="background:${esc(x.color)}"></span>${esc(x.nombre)}</button>`).join('')
    : '';
  return `<button data-accion="pasar-control" aria-expanded="${!!abierto}">Pasar el control ${abierto ? '▴' : '▾'}</button>${lista}`;
}

export function avisoAnfitrion(st) {
  const a = st.anfitrion && st.jugadores?.[st.anfitrion];
  if (!a || a.conectado || st.soyAnfitrion) return '';
  const min = Math.round(ESPERA_TOMAR_CONTROL / 60000);
  if (st.puedeTomarControl) {
    return `<div class="aviso-anfitrion"><p><b>${esc(a.nombre)}</b>, quien tiene el control, se desconectó hace más de ${min} minutos. Si no va a volver, puedes tomar el control.</p>
      <button class="btn pri" data-accion="tomar-control">Tomar el control</button></div>`;
  }
  return `<div class="aviso-anfitrion"><p><b>${esc(a.nombre)}</b>, quien tiene el control, se desconectó. Todo sigue en cuanto vuelva; si en ${min} minutos no ha vuelto, podrán tomar el control.</p></div>`;
}

export async function tomarControl(sala, aviso) {
  const st = sala.estado();
  const nombre = st?.nombreAnfitrion || 'Quien tenía el control';
  if (!confirm(`¿Tomar el control? ${nombre} ya no lo tendrá, aunque vuelva.`)) return false;
  try {
    const ok = await sala.tomarControl();
    aviso(ok ? 'Listo, ahora tienes el control' : `${nombre} ya volvió o alguien más tomó el control`);
    return ok;
  } catch (x) {
    console.error(x); aviso('No se pudo. Revisa tu conexión.');
    return false;
  }
}
