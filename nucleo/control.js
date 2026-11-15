// La Sobremesa · pasar el control dentro de un juego
// ------------------------------------------------------------
// El anfitrión solo cambia cuando él mismo le pasa el control a otro jugador: si se desconecta,
// la sala lo espera. Estas piezas las usa cada juego en su menú de anfitrión y arriba de la pantalla.
//
//   opcionesControl(st, abierto)  botones para el menú del anfitrión ("Pasar el control" y, abierto, la lista)
//                                 data-accion="pasar-control" abre o cierra la lista;
//                                 data-accion="dar-control" data-uid="..." se lo pasa a esa persona
//   avisoAnfitrion(st)            aviso para los demás cuando el anfitrión se desconectó

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
  return `<p class="aviso-anfitrion"><b>${esc(a.nombre)}</b>, quien tiene el control, se desconectó. Todo sigue en cuanto vuelva.</p>`;
}
