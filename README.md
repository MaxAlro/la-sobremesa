# La Sobremesa

Juegos para la familia, desde los celulares, con una tele o laptop opcional como pantalla común.
Es una página estática publicada con GitHub Pages: no hay que instalar nada.

## Qué hay

- **Inicio** (`index.html`): punto de entrada; desde Ajustes se elige el tema de colores.
- **Marcador** (`marcador/`): marcador por rondas para cualquier juego de mesa. Es la evolución de
  [marcador-rondas](https://github.com/MaxAlro/marcador-rondas), con todas sus funciones. Si se abre en el mismo
  navegador donde se usó el marcador anterior, recupera la partida guardada automáticamente.
- **Salas** (`sala/`): cada sala tiene un código de 4 letras y un QR. Cada dispositivo elige su papel:
  *jugador* (celular, tablet o laptop) o *pantalla* (tele, Chromecast o laptop conectada a la tele). La pantalla es
  opcional: sin ella, el código y lo común se ven en todos los celulares. El primer jugador es el anfitrión; puede pasar
  el control o sacar a alguien, y si se desconecta, otro toma el control a los 8 segundos.
- **Marcador en sala:** el anfitrión elige "Marcador" en la sala y todos pasan a él. Cada quien anota sus puntos
  desde su celular y ve cómo van; el anfitrión tiene todas las funciones del marcador (rondas, jugadores sin celular,
  corregir cualquier puntaje, deshacer) y puede activar "Solo yo capturo". La tele muestra el marcador grande con el
  código para sumarse. Al volver a la sala los puntos se guardan para seguir después.
- **Próximamente:** el juego de cartas "Llena el hueco".

## Cómo está hecho

HTML, CSS y JavaScript simples, sin paso de compilación.

```
index.html          inicio
marcador/           marcador por rondas (solo o dentro de una sala con ?sala=CODIGO)
nucleo/tema.css     TODOS los colores y fuentes, y los temas alternos
nucleo/tema.js      aplica el tema elegido en cada dispositivo
nucleo/base.css     botones, campos, paneles, cartas
nucleo/config.js    datos del proyecto de Firebase (no son secretos)
nucleo/datos.js     capa de datos: Firebase o modo de prueba local
nucleo/sala.js      crear, entrar, roles, anfitrión, reconexión
sala/               página de la sala (vista de jugador y de pantalla)
database.rules.json reglas de seguridad de Firebase
```

### Firebase

Las salas usan Firebase Realtime Database con acceso anónimo, en el plan gratuito (Spark).
Para conectarlo: crea el proyecto, activa *Authentication → Anónimo* y *Realtime Database*,
pega el bloque `firebaseConfig` en `nucleo/config.js` y copia `database.rules.json` en
*Realtime Database → Reglas*. Si `FIREBASE_CONFIG` es `null`, la página dice que las salas vienen pronto.

Una sala con 24 horas sin actividad se borra cuando una sala nueva saca el mismo código al azar.

### Cambiar colores

Todos los colores viven en `nucleo/tema.css`. Ningún otro archivo escribe colores a mano.
Para cambiar el acento en todo el sistema basta con editar `--acento` y `--acento-rgb`.
Los temas alternos (`azul`, `verde`, `vino`, `ciruela`, `grafito`) se eligen en Ajustes, desde el inicio.

## Probar en tu computadora

```
python3 -m http.server 8000
```

y abre http://localhost:8000

Para probar salas sin Firebase, agrega `?local` a la dirección (http://localhost:8000/?local) y abre varias
pestañas: cada pestaña cuenta como un dispositivo distinto.
