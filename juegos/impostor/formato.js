// La Sobremesa · El impostor · leer y escribir mazos de palabras
// ------------------------------------------------------------
// Un mazo es { nombre, desc, palabras: [{ p: palabra, d: descripción, f: familia }] }.
// La familia agrupa palabras parecidas dentro del mismo mazo (leche, crema, queso…):
// el modo "Palabra parecida" solo usa palabras que tienen al menos otra en su familia.
//
// Formatos que acepta:
//   Texto, una palabra por línea con su descripción después de dos puntos.
//   Un renglón [Familia] abre una familia; todo lo de abajo pertenece a ella hasta la
//   siguiente. Un renglón [] cierra la familia (lo de abajo queda suelto).
//
//     [Lácteos]
//     Leche: Líquido blanco que dan las vacas.
//     Queso: Se hace cuajando la leche.
//     []
//     Pozole: Caldo de maíz cacahuazintle con carne.
//
//   CSV con columnas palabra,descripcion,familia (la familia puede ir vacía).

export const LARGO = { nombre: 40, desc: 160, p: 40, d: 200, f: 40, palabras: 400 };

const corta = (t, n) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const sinAcentos = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const idDe = (nombre) => sinAcentos(nombre).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'mazo';

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

// Devuelve { palabras, avisos }. esCSV fuerza el formato (por ejemplo, si el archivo termina en .csv)
export function leerPalabras(texto, esCSV = null) {
  texto = String(texto || '').replace(/^﻿/, '');
  const crudas = [], avisos = [];
  const primera = texto.split(/\r?\n/).find((l) => l.trim()) || '';
  const conEncabezado = /^\s*"?palabra"?\s*[,;\t]/i.test(primera);
  if (esCSV ?? conEncabezado) {
    filasCSV(texto).forEach((f, i) => {
      if (i === 0 && conEncabezado) return;
      const [p, d, fam] = f;
      if (p && p.trim()) crudas.push({ p, d, f: fam });
    });
  } else {
    let familia = '';
    for (const l of texto.split(/\r?\n/)) {
      const c = l.trim();
      if (!c || c.startsWith('#') || c.startsWith('//')) continue;
      const m = c.match(/^\[(.*)\]$/);
      if (m) { familia = m[1].trim(); continue; }
      const i = c.indexOf(':');
      const p = (i >= 0 ? c.slice(0, i) : c).replace(/^(\d+[.)]|[-•*])\s+/, '');
      crudas.push({ p, d: i >= 0 ? c.slice(i + 1) : '', f: familia });
    }
  }
  const vistas = new Set(), palabras = [];
  let repetidas = 0, sinDesc = 0;
  for (const x of crudas) {
    const p = corta(x.p, LARGO.p);
    if (!p) continue;
    const k = sinAcentos(p).replace(/[^a-z0-9]/g, '');
    if (vistas.has(k)) { repetidas++; continue; }
    vistas.add(k);
    const d = corta(x.d, LARGO.d), f = corta(x.f, LARGO.f);
    if (!d) sinDesc++;
    palabras.push(f ? { p, d, f } : { p, d });
  }
  if (repetidas) avisos.push(repetidas === 1 ? 'Se quitó 1 palabra repetida.' : `Se quitaron ${repetidas} palabras repetidas.`);
  if (sinDesc) avisos.push(sinDesc === 1 ? '1 palabra no tiene descripción.' : `${sinDesc} palabras no tienen descripción.`);
  if (palabras.length > LARGO.palabras) { avisos.push(`Solo caben ${LARGO.palabras} palabras por mazo.`); palabras.length = LARGO.palabras; }
  return { palabras, avisos };
}

// Familias que sirven para el modo "Palabra parecida" (con 2 o más palabras)
export function familias(palabras) {
  const g = {};
  (palabras || []).forEach((w, i) => { if (w && w.f) (g[w.f] ||= []).push(i); });
  return Object.fromEntries(Object.entries(g).filter(([, xs]) => xs.length >= 2));
}

export function aTexto(palabras) {
  const sueltas = [], porFamilia = new Map();
  for (const w of palabras || []) {
    if (!w) continue;
    if (w.f) { if (!porFamilia.has(w.f)) porFamilia.set(w.f, []); porFamilia.get(w.f).push(w); }
    else sueltas.push(w);
  }
  const linea = (w) => (w.d ? `${w.p}: ${w.d}` : w.p);
  const partes = [];
  for (const [f, ws] of porFamilia) partes.push(`[${f}]\n${ws.map(linea).join('\n')}`);
  if (sueltas.length) partes.push(`${porFamilia.size ? '[]\n' : ''}${sueltas.map(linea).join('\n')}`);
  return partes.join('\n\n');
}

export function aCSV(palabras) {
  const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  return ['palabra,descripcion,familia', ...(palabras || []).filter(Boolean).map((w) => `${q(w.p)},${q(w.d)},${q(w.f)}`)].join('\r\n');
}

// Un mazo como lo guarda Firebase: las listas pueden llegar como objetos { 0: …, 1: … }
export function normalizar(id, m) {
  if (!m) return null;
  const palabras = (Array.isArray(m.palabras) ? m.palabras : Object.values(m.palabras || {}))
    .filter((w) => w && w.p).map((w) => ({ p: String(w.p), d: String(w.d || ''), ...(w.f ? { f: String(w.f) } : {}) }));
  return { id, nombre: String(m.nombre || id), desc: String(m.desc || ''), palabras };
}
