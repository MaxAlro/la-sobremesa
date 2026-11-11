// Configuración de Firebase de La Sobremesa.
// Estos datos NO son secretos: Firebase los diseñó para ir en el código de la página.
// La seguridad la dan las reglas de database.rules.json.
//
// Si se pone en null, las salas solo funcionan en "modo de prueba" (?local en la dirección),
// dentro de un mismo navegador.
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDKDdEtw9XnL3nnk_XrtGnH9-X-4ODtD8U',
  authDomain: 'la-sobremesa-3bd86.firebaseapp.com',
  databaseURL: 'https://la-sobremesa-3bd86-default-rtdb.firebaseio.com',
  projectId: 'la-sobremesa-3bd86',
  storageBucket: 'la-sobremesa-3bd86.firebasestorage.app',
  messagingSenderId: '284617827689',
  appId: '1:284617827689:web:5cf1e64f98dadaabba89f8'
};

// Versión del SDK de Firebase que se carga desde su CDN oficial.
export const FIREBASE_VERSION = '10.12.2';
