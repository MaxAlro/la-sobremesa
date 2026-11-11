// La Sobremesa · comparar palabras escritas a mano
// ------------------------------------------------------------
// Lo usan los juegos que tienen que decidir si dos palabras son "la misma"
// aunque estén escritas distinto (acentos, mayúsculas, faltas de ortografía).

// Sin acentos, sin mayúsculas, solo letras y números: "Camión" = "camion", "Sobre mesa" = "sobremesa"
export const base = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Además, los sonidos que se confunden al escribir cuentan igual y las letras dobles cuentan como una:
// b/v, s/z/c suave, y/ll, g/j suave, h muda, k/qu/c fuerte. "Monnarca" = "Monarca", "Baca" = "Vaca".
export function clave(t) {
  return base(t)
    .replace(/ch/g, '1')
    .replace(/qu([ei])/g, 'k$1')
    .replace(/c([ei])/g, 's$1')
    .replace(/c/g, 'k')
    .replace(/z/g, 's')
    .replace(/v/g, 'b')
    .replace(/ll/g, 'y')
    .replace(/g([ei])/g, 'j$1')
    .replace(/h/g, '')
    .replace(/(.)\1+/g, '$1');
}

// Letras de diferencia (de más, de menos, cambiada o volteada)
export function distancia(a, b) {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 2) return 3;
  const d = Array.from({ length: m + 1 }, (_, i) => { const r = new Array(n + 1).fill(0); r[0] = i; return r; });
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[m][n];
}

// Se perdona una letra en palabras de 6 o más y dos desde las 10; las cortas tienen que coincidir (Mango ≠ Manga)
export function parecidas(a, b) {
  const x = clave(a), y = clave(b);
  if (x === y) return true;
  const n = Math.min(x.length, y.length);
  const tolera = n >= 10 ? 2 : n >= 6 ? 1 : 0;
  return tolera > 0 && distancia(x, y) <= tolera;
}
