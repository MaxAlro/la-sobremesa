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
- **Llena el hueco** (`juegos/llena-el-hueco/`): juego de cartas para adultos, de 3 a 9 jugadores. Cada quien tiene
  7 respuestas en su celular; un juez que rota lee la frase con hueco (en la tele, o arriba en cada celular si no hay
  tele), los demás mandan su carta sin nombre, el juez las lee una por una y elige la más chistosa. Gana quien llegue
  a los puntos acordados (7 de inicio). Opciones: cartas en blanco y cambiar la mano por un punto. Al final, los
  puntos se pueden llevar al marcador.
- **Basta** (`juegos/basta/`): juego de palabras para 2 a 9 jugadores. Sale una letra al azar (en la tele o arriba en
  cada celular) y cada quien llena sus categorías en su celular. Quien llena todas puede cantar ¡Basta! y los demás
  tienen 5 segundos. Luego se revisa categoría por categoría: cualquiera puede marcar una respuesta como "no vale" y se
  anula si la marca la mayoría. Puntos automáticos: 100 si nadie más la puso, 50 si se repite, 0 si está vacía o no
  empieza con la letra. Las repetidas se reconocen aunque tengan acentos, espacios o errores de ortografía (b/v, s/z/c,
  y/ll, h muda, letras dobles, y una letra de diferencia en palabras largas); el anfitrión puede juntar o separar a
  mano. Categorías, número de rondas, tiempo límite y letras difíciles se eligen al preparar. Al final, cada ronda pasa
  al marcador con su letra.
- **El impostor** (`juegos/impostor/`): juego de deducción para 3 a 9 jugadores, con poca pantalla. Todos reciben
  en su celular la misma palabra secreta, menos el impostor. La tarjeta se ve solo mientras se mantiene el dedo encima,
  y tapada se ve igual en todos los celulares. Por turnos (al azar, pero el impostor nunca empieza) cada quien dice
  una pista en voz alta; luego discuten y votan desde el celular, con reloj opcional. Si hay empate se vota otra vez
  solo entre los empatados; si sigue, el impostor se salva. Si lo atrapan, tiene un intento para adivinar la palabra
  (se perdonan faltas de ortografía y el anfitrión puede corregir). Puntos: el impostor se salva +3; lo atrapan pero
  adivina +2; lo atrapan y falla, +1 para cada uno de los demás y +1 extra a quien votó por el impostor. Dos modos:
  *Clásico* (el impostor sabe que lo es y solo ve el mazo con su descripción) y *Palabra parecida* (recibe otra
  palabra de la misma familia y no sabe que es el impostor). Con 7 o más se puede jugar con 2 impostores. Al
  terminar, cada ronda pasa al marcador con su palabra.
- **Mazos de El impostor** (`juegos/impostor/mazos.html`, también desde Ajustes): seis mazos vienen incluidos
  (`juegos/impostor/mazos-base.js`). Los propios se guardan en Firebase (`palabras/<id>`): nombre, descripción y
  palabras, cada una con su descripción corta y, si se quiere, su familia de palabras parecidas. Se escriben como
  texto (`Palabra: descripción`, con `[Familia]` para agrupar) o como CSV (`palabra,descripcion,familia`).
- **Mazos** (`juegos/llena-el-hueco/mazos.html`, también desde Ajustes): las cartas viven en Firebase, no en el
  código. Se cargan como CSV (`tipo,texto`) o texto con secciones `# Frases` y `# Respuestas`; el hueco se marca con
  `____`. Para guardar o borrar mazos hace falta la clave de administrador (ver abajo).

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
nucleo/texto.js     comparar palabras escritas a mano (acentos, faltas de ortografía)
sala/               página de la sala (vista de jugador y de pantalla)
juegos/             cada juego en su carpeta; el celular del anfitrión lleva las reglas
database.rules.json reglas de seguridad de Firebase
```

### Firebase

Las salas usan Firebase Realtime Database con acceso anónimo, en el plan gratuito (Spark).
Para conectarlo: crea el proyecto, activa *Authentication → Anónimo* y *Realtime Database*,
pega el bloque `firebaseConfig` en `nucleo/config.js` y copia `database.rules.json` en
*Realtime Database → Reglas*. Si `FIREBASE_CONFIG` es `null`, la página dice que las salas vienen pronto.

**Clave de administrador de mazos:** en la consola, *Realtime Database → Datos*, agrega en la raíz el campo
`claveAdmin` con la clave que quieras (texto). Nadie puede leerla. En la página de mazos, escríbela una vez en cada
dispositivo desde el que quieras cargar o borrar mazos.

Las manos de cada jugador, quién mandó qué carta y las cartas que faltan por salir solo las puede leer su dueño o el
anfitrión, así que nadie puede espiar desde la consola del navegador.

Las salas no se cierran solas al terminar: cada vez que alguien crea una sala nueva, se borran las que llevan 24 horas
sin actividad. Para eso `indice` guarda el código y la hora de creación de cada sala.

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
