// La Sobremesa · Llena el hueco · administrar mazos
// ------------------------------------------------------------
// Los mazos viven en Firebase (mazos/<id>), no en este repositorio público.
// Cualquiera puede leerlos para jugar; solo los dispositivos que escribieron la clave
// de administrador pueden guardarlos o borrarlos. La clave se define una vez en la consola
// de Firebase, en Realtime Database → Datos: claveAdmin = "lo-que-tú-quieras".
//
// Formatos que acepta:
//   CSV con columnas tipo,texto   (tipo: frase o respuesta)
//   Texto con secciones:          # Frases  (una por línea)  # Respuestas  (una por línea)
// En las frases, el hueco se marca con tres o más guiones bajos: ____

import { conectar, hayFirebase } from '../../nucleo/datos.js';

const Q = new URLSearchParams(location.search);
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const lista = (v) => (Array.isArray(v) ? v : Object.values(v || {})).filter((x) => x != null);
const ADMIN = 'sobremesa-admin-mazos';

let db = null, pendiente = null;

function nota(el, texto, error = false) { const n = $(el); n.textContent = texto; n.classList.toggle('error', error); n.classList.remove('oculto'); }

// ------------------------------------------------------------ leer archivos
function filasCSV(texto) {
  const filas = [];
  let fila = [], campo = '', comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') comillas = false;
      else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === ',' || c === ';' || c === '\t') { fila.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && texto[i + 1] === '\n') i++; fila.push(campo); filas.push(fila); fila = []; campo = ''; }
    else campo += c;
  }
  if (campo || fila.length) { fila.push(campo); filas.push(fila); }
  return filas.filter((f) => f.some((x) => x.trim()));
}
const huecos = (t) => (t.match(/_{3,}/g) || []).length;
const tipoDe = (t) => {
  t = t.trim().toLowerCase();
  if (/^(f|frase|frases|pregunta|negra|n)$/.test(t)) return 'f';
  if (/^(r|respuesta|respuestas|blanca|b)$/.test(t)) return 'r';
  return null;
};

export function leerMazo(texto) {
  texto = texto.replace(/^﻿/, '');
  const frases = [], respuestas = [], avisos = [];
  const lineas = texto.split(/\r?\n/);
  const pareceCSV = lineas.slice(0, 5).some((l) => /^\s*"?(tipo|frase|respuesta|f|r)"?\s*[,;\t]/i.test(l));
  if (pareceCSV) {
    for (const [tipo, ...resto] of filasCSV(texto)) {
      const t = tipoDe(tipo || ''), txt = resto.join(',').trim();
      if (!t) { if ((tipo || '').trim().toLowerCase() !== 'tipo') avisos.push(`Se ignoró una fila: "${tipo}"`); continue; }
      if (txt) (t === 'f' ? frases : respuestas).push(txt);
    }
  } else {
    let seccion = null;
    for (const l of lineas) {
      const c = l.trim();
      if (!c) continue;
      const m = c.match(/^#*\s*(frases?|preguntas?|respuestas?)\s*:?$/i);
      if (m) { seccion = /^r/i.test(m[1]) ? 'r' : 'f'; continue; }
      if (c.startsWith('#')) continue;
      const txt = c.replace(/^(\d+[.)]|[-•*])\s+/, '').trim();
      if (!seccion) { avisos.push('Falta el encabezado "# Frases" o "# Respuestas" antes de las cartas.'); seccion = 'x'; }
      if (seccion === 'f') frases.push(txt); else if (seccion === 'r') respuestas.push(txt);
    }
  }
  const unicas = (a) => [...new Map(a.map((x) => [x.toLowerCase(), x])).values()];
  const f = unicas(frases).map((t) => ({ t: t.slice(0, 220), h: Math.min(3, Math.max(1, huecos(t))) }));
  const r = unicas(respuestas).map((t) => t.slice(0, 90));
  if (frases.length !== f.length || respuestas.length !== r.length) avisos.push('Se quitaron cartas repetidas.');
  return { frases: f, respuestas: r, avisos };
}

export function aCSV(m) {
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  return ['tipo,texto', ...lista(m.frases).map((f) => `frase,${q(f.t)}`), ...lista(m.respuestas).map((r) => `respuesta,${q(r)}`)].join('\r\n');
}

const idDe = (nombre) => nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'mazo';

// ------------------------------------------------------------ pantalla
async function pintarMazos() {
  let todos = {};
  try { todos = (await db.get('mazos')) || {}; } catch (x) { console.error(x); }
  const filas = Object.entries(todos).sort((a, b) => String(a[1].nombre).localeCompare(String(b[1].nombre), 'es'));
  $('#lista').innerHTML = filas.length ? filas.map(([id, m]) => `<div class="mazo"><div><b>${esc(m.nombre || id)}</b><span>${lista(m.frases).length} frases · ${lista(m.respuestas).length} respuestas</span></div>
      <button class="btn" data-bajar="${esc(id)}">Descargar CSV</button><button class="btn peligro" data-borrar="${esc(id)}">Borrar</button></div>`).join('')
    : '<p class="sub">Todavía no hay mazos.</p>';
  window.__mazos = todos;
}

function vistaPrevia(m) {
  const ej = (a, n) => a.slice(0, n).map((x) => `<li>${esc(typeof x === 'string' ? x : x.t)}</li>`).join('');
  $('#previa').innerHTML = `<p><b>${m.frases.length}</b> frases (${m.frases.filter((f) => f.h > 1).length} de dos o más huecos) y <b>${m.respuestas.length}</b> respuestas.</p>
    ${m.avisos.length ? `<p class="error">${m.avisos.map(esc).join('<br>')}</p>` : ''}
    ${m.frases.filter((f) => huecos(f.t) === 0).length ? `<p class="sub">${m.frases.filter((f) => huecos(f.t) === 0).length} frases no tienen hueco: la respuesta se mostrará debajo, como en una pregunta.</p>` : ''}
    <div class="ejemplos"><div><span class="etiqueta">Frases</span><ul>${ej(m.frases, 4)}</ul></div><div><span class="etiqueta">Respuestas</span><ul>${ej(m.respuestas, 4)}</ul></div></div>`;
  $('#previa').classList.remove('oculto');
  $('#guardar').disabled = !(m.frases.length && m.respuestas.length >= 20);
  if (m.respuestas.length < 20) nota('#notaImportar', 'Un mazo necesita al menos 20 respuestas.', true);
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
  $('#archivo').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; $('#texto').value = await f.text(); if (!$('#nombre').value) $('#nombre').value = f.name.replace(/\.[^.]+$/, ''); };
  $('#revisar').onclick = () => {
    $('#notaImportar').classList.add('oculto');
    if (!$('#texto').value.trim()) return nota('#notaImportar', 'Elige un archivo o pega las cartas.', true);
    pendiente = leerMazo($('#texto').value);
    vistaPrevia(pendiente);
  };
  $('#guardar').onclick = async () => {
    const nombre = $('#nombre').value.trim();
    if (!nombre) return nota('#notaImportar', 'Ponle nombre al mazo.', true);
    if (!pendiente) return;
    const id = idDe(nombre);
    if (window.__mazos?.[id] && !confirm(`Ya hay un mazo llamado "${window.__mazos[id].nombre}". ¿Reemplazarlo?`)) return;
    try {
      await db.set(`mazos/${id}`, { nombre, frases: pendiente.frases, respuestas: pendiente.respuestas, actualizado: db.marcaTiempo() });
      nota('#notaImportar', `Se guardó "${nombre}". Ya se puede elegir al preparar una partida.`);
      pendiente = null; $('#previa').classList.add('oculto'); $('#guardar').disabled = true; $('#texto').value = ''; $('#archivo').value = '';
      await pintarMazos();
    } catch { nota('#notaImportar', 'No se pudo guardar. Primero escribe la clave de administrador en este dispositivo.', true); }
  };
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-borrar],[data-bajar]');
    if (!b) return;
    if (b.dataset.bajar) {
      const m = window.__mazos[b.dataset.bajar];
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['﻿' + aCSV(m)], { type: 'text/csv' }));
      a.download = `${b.dataset.bajar}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      return;
    }
    const m = window.__mazos[b.dataset.borrar];
    if (!confirm(`¿Borrar el mazo "${m?.nombre}"? No se puede deshacer.`)) return;
    try { await db.remove(`mazos/${b.dataset.borrar}`); await pintarMazos(); }
    catch { alert('No se pudo borrar. Primero escribe la clave de administrador en este dispositivo.'); }
  });
}

iniciar().catch((x) => { console.error(x); $('#app').innerHTML = '<p class="sub">No pudimos conectar. Revisa tu conexión.</p>'; });
