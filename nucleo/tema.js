// Aplica el tema guardado en este dispositivo antes de pintar la página.
// Se carga en el <head> de cada página, sin defer, para evitar un parpadeo de colores.
(function () {
  try {
    var t = localStorage.getItem('sobremesa-tema');
    if (t) document.documentElement.setAttribute('data-tema', t);
  } catch (e) {}
})();

// Lista de temas para el selector de Ajustes. "" es el tema por defecto.
window.SOBREMESA_TEMAS = [
  { id: '', nombre: 'Petróleo y coral' },
  { id: 'azul', nombre: 'Azul tinta y oro' },
  { id: 'verde', nombre: 'Verde botella y latón' },
  { id: 'vino', nombre: 'Vino y crema' },
  { id: 'ciruela', nombre: 'Ciruela y ámbar' },
  { id: 'grafito', nombre: 'Grafito y cobre' }
];

window.sobremesaCambiarTema = function (id) {
  if (id) document.documentElement.setAttribute('data-tema', id);
  else document.documentElement.removeAttribute('data-tema');
  try { localStorage.setItem('sobremesa-tema', id || ''); } catch (e) {}
};
