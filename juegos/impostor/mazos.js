// La Sobremesa · El impostor · administrar mazos de palabras
// ------------------------------------------------------------
// Los mazos propios viven en Firebase (palabras/<id>): { nombre, desc, palabras [{ p, d, f }], actualizado }.
// Cualquiera puede leerlos para jugar; solo los dispositivos que escribieron la clave de
// administrador pueden guardarlos o borrarlos (la misma clave de los demás mazos).
// Los mazos incluidos están en mazos-base.js; uno propio con el mismo id los reemplaza.

import { conectar, hayFirebase } from '../../nucleo/datos.js';
import { MAZOS_BASE } from './mazos-base.js';
import { leerPalabras, familias, aTexto, aCSV, idDe, normalizar, LARGO } from './formato.js';

const Q = new URLSearchParams(location.search);
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const ADMIN = 'sobremesa-admin-mazos';
const cuantas = (n, una, varias) => `${n} ${n === 1 ? una : varias}`;

let db = null, pendiente = null, todos = [], propios = {};

function nota(el, texto, error = false) { const n = $(el); n.textContent = texto; n.classList.toggle('error', error); n.classList.remove('oculto'); }

async function pintarMazos() {
  propios = {};
  try { propios = (await db.get('palabras')) || {}; } catch (x) { console.warn(x); }
  const mapa = new Map(MAZOS_BASE.map((m) => [m.id, { ...m, reemplaza: false }]));
  for (const [id, m] of Object.entries(propios)) {
    const n = normalizar(id, m);
    if (n) mapa.set(id, { ...n, base: false, reemplaza: MAZOS_BASE.some((b) => b.id === id) });
  }
  todos = [...mapa.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  $('#lista').innerHTML = todos.map((m) => {
    const fam = Object.keys(familias(m.palabras)).length;
    const etiqueta = m.base ? 'Incluido' : m.reemplaza ? 'Tuyo · reemplaza al incluido' : 'Tuyo';
    return `<div class="mazo"><div><b>${esc(m.nombre)}<span class="insignia">${esc(etiqueta)}</span></b><span>${esc(m.desc)}</span><span>${cuantas(m.palabras.length, 'palabra', 'palabras')} · ${cuantas(fam, 'familia', 'familias')}</span></div>
      <button class="btn" data-editar="${esc(m.id)}">Editar</button><button class="btn" data-bajar="${esc(m.id)}">CSV</button>
      ${m.base ? '' : `<button class="btn peligro" data-borrar="${esc(m.id)}">Borrar</button>`}</div>`;
  }).join('');
}

function vistaPrevia(r) {
  const fam = familias(r.palabras), sueltas = r.palabras.filter((w) => !w.f || !Object.keys(fam).includes(w.f));
  const bloques = Object.entries(fam).map(([f, idx]) => `<div class="familia"><b>${esc(f)}</b><ul>${idx.map((i) => `<li>${esc(r.palabras[i].p)}</li>`).join('')}</ul></div>`);
  if (sueltas.length) bloques.push(`<div class="familia sola"><b>Sin familia (solo modo Clásico)</b><ul>${sueltas.slice(0, 12).map((w) => `<li>${esc(w.p)}</li>`).join('')}${sueltas.length > 12 ? `<li>y ${sueltas.length - 12} más</li>` : ''}</ul></div>`);
  const nf = Object.keys(fam).length;
  $('#previa').innerHTML = `<p><b>${cuantas(r.palabras.length, 'palabra', 'palabras')}</b>${nf ? ` en <b>${cuantas(nf, 'familia', 'familias')}</b>` : ''}${sueltas.length ? `${nf ? ' y' : ','} ${sueltas.length} sin familia` : ''}.</p>
    ${r.avisos.length ? `<p class="error">${r.avisos.map(esc).join('<br>')}</p>` : ''}
    <div class="familias">${bloques.join('')}</div>`;
  $('#previa').classList.remove('oculto');
  const ok = r.palabras.length >= 3;
  $('#guardar').disabled = !ok;
  if (!ok) nota('#notaImportar', 'Un mazo necesita al menos 3 palabras.', true);
}

async function iniciar() {
  if (!hayFirebase() && !Q.has('local')) { $('#app').innerHTML = '<p class="sub">Las salas todavía no están conectadas a internet.</p>'; return; }
  db = await conectar();
  if (db.local) nota('#notaLocal', 'Modo de prueba: los mazos se guardan solo en este navegador.');
  try { if (localStorage.getItem(ADMIN) === db.uid) $('#clave').placeholder = 'Ya eres administrador en este dispositivo'; } catch {}
  await pintarMazos();

  $('#entrar').onclick = async () => {
    const clave = $('#clave').value.trim();
    if (!clave) return nota('#notaClave', 'Escribe la clave.', true);
    try {
      await db.set(`admins/${db.uid}`, clave);
      try { localStorage.setItem(ADMIN, db.uid); } catch {}
      $('#clave').value = '';
      nota('#notaClave', 'Listo: este dispositivo ya puede guardar y borrar mazos.');
    } catch { nota('#notaClave', 'Esa no es la clave, o todavía no se configura "claveAdmin" en Firebase.', true); }
  };
  $('#archivo').onchange = async (ev) => {
    const f = ev.target.files[0];
    if (!f) return;
    const texto = await f.text();
    // Un CSV se pasa a texto para poder revisarlo y corregirlo aquí mismo
    $('#texto').value = /\.csv$/i.test(f.name) ? aTexto(leerPalabras(texto, true).palabras) : texto;
    if (!$('#nombre').value) $('#nombre').value = f.name.replace(/\.[^.]+$/, '');
  };
  $('#revisar').onclick = () => {
    $('#notaImportar').classList.add('oculto');
    if (!$('#texto').value.trim()) return nota('#notaImportar', 'Elige un archivo o escribe las palabras.', true);
    pendiente = leerPalabras($('#texto').value);
    vistaPrevia(pendiente);
  };
  $('#texto').oninput = () => { $('#guardar').disabled = true; };
  $('#guardar').onclick = async () => {
    const nombre = $('#nombre').value.trim().slice(0, LARGO.nombre), desc = $('#desc').value.trim().slice(0, LARGO.desc);
    if (!nombre) return nota('#notaImportar', 'Ponle nombre al mazo.', true);
    if (!desc) return nota('#notaImportar', 'Escribe una descripción del mazo: es lo único que ve el impostor en el modo Clásico.', true);
    if (!pendiente) return;
    const id = idDe(nombre), antes = todos.find((m) => m.id === id);
    if (antes && !confirm(antes.base ? `Ya hay un mazo incluido llamado "${antes.nombre}". ¿Reemplazarlo por el tuyo?` : `Ya hay un mazo llamado "${antes.nombre}". ¿Reemplazarlo?`)) return;
    try {
      await db.set(`palabras/${id}`, { nombre, desc, palabras: pendiente.palabras, actualizado: db.marcaTiempo() });
      nota('#notaImportar', `Se guardó "${nombre}". Ya se puede elegir al preparar una partida.`);
      pendiente = null; $('#previa').classList.add('oculto'); $('#guardar').disabled = true;
      $('#texto').value = ''; $('#archivo').value = ''; $('#nombre').value = ''; $('#desc').value = '';
      await pintarMazos();
    } catch { nota('#notaImportar', 'No se pudo guardar. Primero escribe la clave de administrador en este dispositivo.', true); }
  };
  document.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-borrar],[data-bajar],[data-editar]');
    if (!b) return;
    const id = b.dataset.borrar || b.dataset.bajar || b.dataset.editar;
    const m = todos.find((x) => x.id === id);
    if (!m) return;
    if (b.dataset.editar) {
      $('#nombre').value = m.nombre; $('#desc').value = m.desc; $('#texto').value = aTexto(m.palabras);
      pendiente = leerPalabras($('#texto').value); vistaPrevia(pendiente);
      $('#editor').scrollIntoView({ behavior: 'smooth' });
      return;
    }
    if (b.dataset.bajar) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['﻿' + aCSV(m.palabras)], { type: 'text/csv' }));
      a.download = `${id}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      return;
    }
    if (!confirm(m.reemplaza ? `¿Borrar tu versión de "${m.nombre}"? Vuelve el mazo incluido.` : `¿Borrar el mazo "${m.nombre}"? No se puede deshacer.`)) return;
    try { await db.remove(`palabras/${id}`); await pintarMazos(); }
    catch { alert('No se pudo borrar. Primero escribe la clave de administrador en este dispositivo.'); }
  });
}

iniciar().catch((x) => { console.error(x); $('#app').innerHTML = '<p class="sub">No pudimos conectar. Revisa tu conexión.</p>'; });
