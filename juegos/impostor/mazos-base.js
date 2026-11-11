// La Sobremesa · El impostor · mazos que vienen incluidos
// ------------------------------------------------------------
// Están en el código para que el juego funcione desde el primer día. Los mazos propios se
// arman en mazos.html y viven en Firebase; si uno se guarda con el mismo nombre que un mazo
// de aquí, lo reemplaza.
// Formato: el mismo que acepta mazos.html (ver formato.js). Todas las palabras de estos
// mazos tienen familia, así que todas sirven también para el modo "Palabra parecida".

import { leerPalabras } from './formato.js';

const MAZOS = [
  {
    id: 'comida',
    nombre: 'Comida',
    desc: 'Platillos, antojitos, postres y bebidas de la cocina mexicana.',
    texto: `
[Caldos]
Pozole: Caldo de maíz cacahuazintle con carne de cerdo o pollo; se sirve con rábano, lechuga y orégano.
Menudo: Caldo picante de panza de res con chile rojo; se acompaña con cebolla, orégano y limón.
Birria: Carne de chivo o de res adobada con chiles y especias, cocida lento en su propio caldo.
Caldo de res: Sopa de carne y hueso de res con elote, calabaza, zanahoria y col.
Sopa de tortilla: Caldo de jitomate con tiras de tortilla frita, aguacate, queso y chile pasilla.

[Antojitos de masa]
Taco: Tortilla doblada con un guiso o carne adentro; se come con la mano.
Flauta: Tortilla enrollada con relleno y frita hasta quedar dorada; se sirve con crema y lechuga.
Sope: Base gruesa de masa con la orilla pellizcada, cubierta de frijoles, salsa, crema y queso.
Gordita: Tortilla gruesa de masa que se abre como bolsita y se rellena de guisado.
Quesadilla: Tortilla doblada con queso derretido u otro relleno, cocida en el comal.
Tamal: Masa de maíz con relleno, envuelta en hoja de maíz o de plátano y cocida al vapor.

[Platos de fiesta]
Mole: Salsa espesa de chiles, especias, semillas y a veces chocolate; se sirve sobre pollo o guajolote.
Chiles en nogada: Chile poblano relleno de picadillo con fruta, bañado en salsa de nuez y con granada encima.
Cochinita pibil: Cerdo marinado en achiote y naranja agria, cocido en hoja de plátano; es de Yucatán.
Enchiladas: Tortillas rellenas bañadas en salsa de chile, con crema, queso y cebolla.
Chilaquiles: Totopos bañados en salsa verde o roja, con crema, queso y a veces huevo o pollo.

[Postres y pan dulce]
Churro: Tira de masa frita espolvoreada con azúcar y canela.
Flan: Postre de huevo, leche y azúcar cocido a baño maría, con caramelo encima.
Arroz con leche: Arroz cocido en leche con azúcar y canela.
Pan de muerto: Pan dulce redondo con "huesitos" de masa encima; se hace para Día de Muertos.
Concha: Pan dulce redondo con una costra de azúcar dibujada como concha de mar.

[Bebidas]
Horchata: Agua fresca de arroz con canela y azúcar.
Agua de jamaica: Agua fresca de flor de jamaica; es roja y un poco ácida.
Atole: Bebida caliente y espesa de masa de maíz con agua o leche; la hay de muchos sabores.
Champurrado: Atole de masa de maíz con chocolate.
Chocolate caliente: Chocolate de mesa batido en leche o agua caliente.

[Lácteos]
Leche: Líquido blanco que dan las vacas; se toma sola, con café o con cereal.
Crema: La parte grasa de la leche; es espesa y se le pone a los tacos y las enchiladas.
Queso: Se hace cuajando la leche; hay fresco, añejo, Oaxaca y muchos más.
Crema batida: Crema de leche batida con azúcar hasta quedar esponjosa; se pone en los postres.
Yogur: Leche fermentada, espesa y un poco ácida; se come con fruta o granola.
`
  },
  {
    id: 'lugares',
    nombre: 'Lugares',
    desc: 'Lugares a donde va uno: en la ciudad, de vacaciones y en la vida diaria.',
    texto: `
[Para comprar]
Mercado: Lugar con puestos de fruta, carne, comida y de todo un poco.
Tianguis: Mercado de puestos que se pone en la calle ciertos días de la semana.
Supermercado: Tienda grande con pasillos y carritos donde se compra la despensa.
Tiendita de la esquina: Tienda chica del barrio con refrescos, botanas y lo básico.
Farmacia: Tienda donde se venden medicinas.

[Para aprender]
Escuela: Lugar donde los niños y jóvenes toman clases.
Biblioteca: Lugar con muchos libros para leer ahí o pedir prestados.
Museo: Edificio donde se exhiben obras de arte u objetos de historia o de ciencia.
Universidad: Escuela donde se estudia una carrera después de la prepa.

[De vacaciones]
Playa: Orilla del mar con arena donde la gente se mete al agua y toma el sol.
Hotel: Edificio donde se renta un cuarto para dormir cuando uno viaja.
Alberca: Estanque hecho para nadar.
Isla: Pedazo de tierra rodeado de agua por todos lados.
Pirámide: Construcción antigua que sube por escalones hasta la punta, como las de Teotihuacán.

[Para divertirse]
Cine: Sala oscura con una pantalla gigante donde se ven películas.
Teatro: Lugar con escenario donde actores presentan obras en vivo.
Feria: Lugar con juegos mecánicos, puestos de comida y juegos de puntería.
Estadio: Construcción enorme con gradas donde se ven partidos o conciertos.
Zoológico: Parque donde se pueden ver animales de todo el mundo.

[Para curarse]
Hospital: Lugar donde atienden a enfermos y heridos día y noche.
Consultorio: Cuarto donde un médico recibe a sus pacientes con cita.
Laboratorio: Lugar donde se hacen análisis de sangre y otros estudios.

[Para viajar]
Aeropuerto: Lugar de donde salen y a donde llegan los aviones.
Central de autobuses: Lugar de donde salen los camiones que van a otras ciudades.
Estación de tren: Lugar donde el tren se detiene para que suban y bajen pasajeros.
Gasolinera: Lugar donde se le pone gasolina al coche.

[En el centro del pueblo]
Plaza: Espacio abierto en el centro, con kiosco, bancas y árboles.
Iglesia: Edificio donde se celebran misas y otras ceremonias religiosas.
Panteón: Lugar donde se entierra a los difuntos; también se le dice cementerio.
Palacio municipal: Edificio donde trabaja el gobierno del municipio.
`
  },
  {
    id: 'animales',
    nombre: 'Animales',
    desc: 'Animales de la granja, de la selva, del mar y de la casa.',
    texto: `
[De la granja]
Vaca: Animal grande de granja que da leche y hace "muu".
Borrego: Animal de granja cubierto de lana que hace "bee".
Chivo: Animal de granja con cuernos y barbita; también se le dice cabra.
Cerdo: Animal de granja de nariz chata; también se le dice puerco o cochino.
Gallina: Ave de granja que pone huevos.

[Felinos]
León: Gran felino de África; el macho tiene melena.
Tigre: Gran felino anaranjado con rayas negras; vive en Asia.
Jaguar: Felino de la selva de América con manchas en forma de rosetas.
Gato: Felino pequeño que vive con la gente como mascota.

[Del mar]
Tiburón: Pez grande de dientes afilados con una aleta en el lomo.
Delfín: Mamífero del mar muy listo que salta fuera del agua.
Ballena: El animal más grande del mar; respira por un orificio en la cabeza.
Pulpo: Animal del mar con ocho brazos llenos de ventosas; suelta tinta para escapar.
Tortuga marina: Reptil con caparazón que nada en el mar y pone sus huevos en la playa.

[Insectos]
Mosca: Insecto volador que zumba y se para en la comida.
Mosquito: Insecto pequeño que pica y deja ronchas.
Abeja: Insecto que hace miel y puede picar.
Hormiga: Insecto pequeño que vive en colonias y carga cosas más grandes que ella.
Mariposa: Insecto con alas grandes de colores; antes fue oruga.

[Aves]
Águila: Ave de presa grande y fuerte; aparece en la bandera de México.
Loro: Ave de colores que puede imitar palabras.
Búho: Ave nocturna de ojos grandes que gira mucho la cabeza.
Colibrí: Ave pequeñita que aletea muy rápido y toma el néctar de las flores.

[Reptiles y anfibios]
Cocodrilo: Reptil grande de río con hocico largo y muchos dientes.
Iguana: Reptil verde con cresta en el lomo que toma el sol en las piedras.
Serpiente: Reptil sin patas que se arrastra; algunas son venenosas.
Ajolote: Anfibio mexicano que parece sonreír y puede regenerar partes de su cuerpo.
Rana: Anfibio que salta, croa y vive cerca del agua.

[Mascotas]
Perro: El mejor amigo del hombre; ladra y mueve la cola.
Hámster: Roedor chiquito y gordito que corre en una rueda.
Conejo: Animal de orejas largas que salta y come zanahoria.
Pez dorado: Pececito anaranjado que se tiene en una pecera.
`
  },
  {
    id: 'cosas-de-la-casa',
    nombre: 'Cosas de la casa',
    desc: 'Objetos, muebles y aparatos que hay en cualquier casa.',
    texto: `
[En la cocina]
Licuadora: Aparato con vaso y aspas para moler y mezclar, como salsas y licuados.
Refrigerador: Aparato que mantiene fríos la comida y las bebidas.
Estufa: Aparato con quemadores para cocinar.
Microondas: Aparato que calienta la comida en poco tiempo.
Sartén: Recipiente plano con mango para freír.
Olla: Recipiente hondo para cocinar caldos, frijoles o pasta.

[Para sentarse]
Sillón: Asiento acolchonado y cómodo, con brazos y respaldo.
Silla: Asiento con respaldo y cuatro patas, para una persona.
Banco: Asiento sin respaldo.
Hamaca: Red o tela colgada de dos puntos para acostarse y mecerse.

[En la recámara]
Cama: Mueble para dormir, con colchón, sábanas y almohadas.
Almohada: Cojín donde se recarga la cabeza para dormir.
Cobija: Manta gruesa para taparse del frío.
Ropero: Mueble alto con puertas donde se guarda la ropa.

[En el baño]
Regadera: De donde sale el agua para bañarse.
Toalla: Tela que absorbe el agua para secarse.
Cepillo de dientes: Cepillo pequeño para lavarse los dientes.
Jabón: Barra o líquido que hace espuma para lavarse.

[Para limpiar]
Escoba: Cepillo con palo largo para barrer.
Trapeador: Palo con tiras de tela para limpiar el piso con agua.
Recogedor: Pala plana donde se junta la basura que se barre.
Cubeta: Recipiente con asa para cargar agua.

[Aparatos]
Televisión: Aparato con pantalla para ver programas, películas y partidos.
Radio: Aparato para escuchar estaciones de música y noticias.
Ventilador: Aparato con aspas que giran para echar aire.
Lámpara: Aparato que da luz.
Control remoto: Aparatito con botones para manejar la tele desde lejos.
`
  },
  {
    id: 'oficios',
    nombre: 'Oficios',
    desc: 'Trabajos y profesiones: lo que hace la gente para ganarse la vida.',
    texto: `
[Salud]
Doctor: Persona que revisa a los enfermos y receta medicinas.
Enfermero: Persona que cuida a los pacientes en el hospital y ayuda al doctor.
Dentista: Doctor que cura los dientes.
Veterinario: Doctor de los animales.

[Construcción]
Albañil: Persona que levanta paredes y casas con ladrillos y cemento.
Plomero: Persona que arregla tuberías, llaves y fugas de agua.
Electricista: Persona que instala y arregla cables y conexiones de luz.
Carpintero: Persona que hace muebles y cosas de madera.

[Comida]
Cocinero: Persona que prepara la comida en un restaurante.
Panadero: Persona que hace pan.
Mesero: Persona que atiende las mesas de un restaurante y lleva los platos.
Taquero: Persona que prepara y sirve tacos en un puesto o taquería.

[Para cuidarnos]
Policía: Persona que cuida el orden y la seguridad en la calle.
Bombero: Persona que apaga incendios y rescata gente.
Salvavidas: Persona que vigila a los bañistas en la playa o la alberca.
Guardia de seguridad: Persona que vigila la entrada de un edificio o una tienda.

[Al volante]
Piloto: Persona que maneja un avión.
Chofer: Persona que maneja un coche, camión o taxi como trabajo.
Capitán de barco: Persona que manda en un barco.
Astronauta: Persona que viaja al espacio.

[De oficina]
Maestro: Persona que da clases en una escuela.
Abogado: Persona que defiende a la gente y aconseja sobre las leyes.
Contador: Persona que lleva las cuentas y los impuestos.
Secretario: Persona que organiza la agenda, las llamadas y los papeles de una oficina.

[Espectáculo]
Cantante: Persona que canta como trabajo.
Actor: Persona que actúa en películas, series u obras de teatro.
Payaso: Artista de cara pintada y nariz roja que hace reír.
Mago: Artista que hace trucos que parecen imposibles.
Fotógrafo: Persona que toma fotos como trabajo.
`
  },
  {
    id: 'deportes-y-juegos',
    nombre: 'Deportes y juegos',
    desc: 'Deportes, juegos de mesa y juegos de cuando éramos niños.',
    texto: `
[Con balón]
Futbol: Deporte de once contra once en el que se mete gol pateando el balón.
Básquetbol: Deporte en el que se mete el balón en un aro alto.
Voleibol: Deporte en el que se pasa el balón por encima de una red sin dejarlo caer.
Futbol americano: Deporte de contacto con balón ovalado en el que se avanza por yardas.

[Con raqueta]
Tenis: Deporte en el que se le pega a una pelota con raqueta por encima de una red.
Ping-pong: Tenis sobre una mesa, con raquetas chicas y una pelotita ligera.
Bádminton: Deporte de raqueta que se juega con un gallito de plumas en lugar de pelota.
Frontón: Juego en el que se le pega a la pelota contra una pared.

[En el agua]
Natación: Deporte de nadar lo más rápido posible.
Clavados: Deporte de lanzarse al agua desde una plataforma haciendo piruetas.
Surf: Deporte de pararse en una tabla y deslizarse sobre las olas.
Remo: Deporte de mover una lancha con remos.

[De pelea]
Box: Deporte de pelea con guantes en el que solo se pega con los puños.
Lucha libre: Espectáculo de luchadores, muchos con máscara, que hacen llaves y vuelan desde las cuerdas.
Karate: Arte marcial japonés de golpes y patadas.
Judo: Arte marcial japonés de agarres y derribos.

[De mesa]
Ajedrez: Juego de tablero con rey, reina, caballos y peones; gana quien da jaque mate.
Dominó: Juego de fichas con puntitos que se van uniendo por números iguales.
Lotería: Juego de cartas con dibujos como El Gallo y La Sirena; gana quien llena su tabla y grita "¡Lotería!".
Damas: Juego de tablero en el que se comen las fichas del otro saltando sobre ellas.

[De la infancia]
Escondidillas: Uno cuenta con los ojos tapados y los demás se esconden para que no los encuentre.
Avioncito: Juego de saltar en un pie sobre casillas dibujadas en el piso.
Trompo: Juguete de madera con punta que se lanza enrollado en un cordón para que gire.
Yoyo: Juguete de dos discos unidos que sube y baja por un hilo.
Canicas: Bolitas de vidrio que se lanzan con el dedo para pegarle a otras.
Matatena: Juego de lanzar una pelotita y recoger piezas antes de que rebote.
`
  }
];

export const MAZOS_BASE = MAZOS.map(({ id, nombre, desc, texto }) => ({ id, nombre, desc, palabras: leerPalabras(texto).palabras, base: true }));
export const ELEGIDOS_DE_INICIO = ['comida', 'lugares', 'animales', 'cosas-de-la-casa'];
