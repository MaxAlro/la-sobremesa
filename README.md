# La Sobremesa

Juegos para la familia, desde los celulares, con una tele o laptop opcional como pantalla común.
Es una página estática publicada con GitHub Pages: no hay que instalar nada.

## Qué hay

- **Inicio** (`index.html`): punto de entrada; desde Ajustes se elige el tema de colores.
- **Marcador** (`marcador/`): marcador por rondas para cualquier juego de mesa. Es la evolución de
  [marcador-rondas](https://github.com/MaxAlro/marcador-rondas), con todas sus funciones. Si se abre en el mismo
  navegador donde se usó el marcador anterior, recupera la partida guardada automáticamente.
- **Próximamente:** salas con código para jugar desde varios celulares y el juego de cartas "Llena el hueco".

## Cómo está hecho

HTML, CSS y JavaScript simples, sin paso de compilación.

```
index.html          inicio
marcador/           marcador por rondas
nucleo/tema.css     TODOS los colores y fuentes, y los temas alternos
nucleo/tema.js      aplica el tema elegido en cada dispositivo
nucleo/base.css     botones, campos, paneles, cartas
```

### Cambiar colores

Todos los colores viven en `nucleo/tema.css`. Ningún otro archivo escribe colores a mano.
Para cambiar el acento en todo el sistema basta con editar `--acento` y `--acento-rgb`.
Los temas alternos (`azul`, `verde`, `vino`, `ciruela`, `grafito`) se eligen en Ajustes, desde el inicio.

## Probar en tu computadora

```
python3 -m http.server 8000
```

y abre http://localhost:8000
