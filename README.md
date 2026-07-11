# La Raspa 🃏

Juego de cartas españolas multijugador online (hasta 10 jugadores). Cada uno entra desde su compu o celular con un código de sala, ve solo sus cartas, elige avatar y puede lanzar frases graciosas.

## Cómo correrlo en tu computadora

Necesitás [Node.js](https://nodejs.org) (versión 18 o superior).

```bash
npm install      # instala las dependencias (solo la primera vez)
npm start        # arranca el servidor
```

Después abrí **http://localhost:3000** en el navegador. Para jugar todos juntos en la misma red (misma casa/wifi), los demás entran a `http://TU-IP-LOCAL:3000` (por ejemplo `http://192.168.1.20:3000`).

Para correr los tests del motor de reglas:

```bash
npm test
```

## Cómo jugar por internet con tus primos

El juego necesita estar publicado en un servidor. La forma más fácil y gratis:

### Opción A — Render.com (recomendada, gratis)

El proyecto ya incluye un archivo `render.yaml`, así que Render configura todo solo.

1. Creá una cuenta gratis en [github.com](https://github.com) y otra en [render.com](https://render.com) (podés entrar a Render con tu cuenta de GitHub).
2. Subí esta carpeta a un repositorio nuevo de GitHub (sin la carpeta `node_modules`, que ya está excluida por `.gitignore`). La forma más simple sin instalar nada: en GitHub, **New repository** → en el repo vacío, **Add file → Upload files** → arrastrá todos los archivos y carpetas del proyecto → **Commit**.
3. En Render: **New → Blueprint** → conectá tu cuenta de GitHub → elegí el repositorio. Render lee `render.yaml` y crea el servicio solo (build `npm install`, start `npm start`). Dale **Apply**.
4. En 1-2 minutos te da una URL pública (ej. `https://la-raspa.onrender.com`). Esa es la que compartís con tus primos.

> El plan gratis de Render "duerme" el servicio tras un rato de inactividad; la primera carga después de un rato puede tardar ~30-50 segundos. Es normal.

### Seguridad

El servidor incluye protecciones básicas: códigos de sala de 6 caracteres, límite de mensajes y de acciones por segundo (anti-spam), borrado automático de salas vacías y saneo de nombres. No se piden datos personales ni contraseñas. Render sirve todo por HTTPS.

### Opción B — Railway / Fly.io / Glitch
Funciona igual: cualquier hosting que corra Node.js. El servidor usa la variable de entorno `PORT` automáticamente, así que no hay que tocar nada.

## Cómo se juega

- **Reparto:** 40 cartas españolas (sin 8 ni 9). Ronda 1 = 1 carta, ronda 2 = 2, etc. El repartidor rota cada ronda. Al repartir se da vuelta la **muestra**, cuyo palo es el triunfo.
- **Apuestas:** cada uno dice cuántas manos hará. El repartidor apuesta último y no puede hacer que la suma total iguale la cantidad de cartas (alguien tiene que fallar).
- **Orden de cartas:** 1 (la más fuerte) > 3 > Rey > Caballo > Sota > 7 > 6 > 5 > 4 > 2.
- **Triunfo:** el palo de la muestra le gana a cualquier otro.
- **Jugar:** hay que seguir el palo de salida; si no tenés, tirás muestra. Si tenés una carta del palo (o muestra) que **gana** la mano, estás obligado a tirarla (no podés tirar una más baja). Si no podés ganar, tirás cualquiera.
- **Renunció:** se puede tirar cualquier carta aunque viole las reglas. Renuncia quien: no sigue el palo de salida teniendo; tira una carta menor a la más alta del palo pudiendo superarla (salvo que la mano ya venga cortada con muestra); corta con muestra teniendo el palo de salida; o, sin tener el palo, no corta con muestra pudiendo (o corta con una menor a la ya jugada). Si notás que alguien erró, tocá **Renunció** y elegí al jugador (una vez por ronda). La acusación revisa **todas las jugadas de la ronda** hasta ese momento: si acertás, el infractor pierde 5 puntos y la ronda se repite desde la mano de la infracción (las manos posteriores se anulan); si te equivocás, igual gastaste tu acusación.
- **Ida y vuelta (opcional):** el anfitrión puede activar en la sala de espera que, al llegar a la ronda más grande (7 cartas), se siga bajando: 7, 6, 5... hasta 1. Al terminar la ronda de 7 se muestra el resultado parcial.
- **Puntos:** cada mano ganada vale 1 punto siempre. Si además cumplís tu apuesta exacta, sumás 5 puntos de bonus (ej: apostaste 0 e hiciste 1 = 1 punto; apostaste 2 e hiciste 2 = 7). Gana quien más suma.

## Personalización

- **Frases graciosas:** editá `public/phrases.json` (la lista `"frases"`). Agregá las que quieras; aparecen en el menú 💬 durante la partida.
- **Imágenes de las cartas:** están en `public/cards/` como `RANGO-PALO.png` (ej. `1-oros.png`, `12-espadas.png`) más `back.png`. Son la baraja española libre de [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Baraja_espa%C3%B1ola_completa.png) (obra de Basquetteur y otros, licencia [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)). Podés reemplazarlas por tus propias imágenes manteniendo los nombres (ajustando `cardSrc()` en `public/client.js` si cambiás la extensión).
- **Avatares:** en `public/avatars/` (`a01.svg` … `a12.svg`). Reemplazables igual que las cartas. Cada jugador elige además su color de piel en la pantalla de inicio.

## Estructura del proyecto

```
server.js            Servidor Express + Socket.io (estado autoritativo)
game/engine.js       Reglas puras: mazo, fuerza, manos legales, ganador, puntaje
game/room.js         Máquina de estados de la partida (salas, turnos, rondas)
public/              Frontend (index.html, style.css, client.js)
public/cards/        40 cartas + dorso (imágenes)
public/avatars/      Avatares
public/phrases.json  Frases editables
test/engine.test.js  Tests del motor
```

¡A jugar! 🎉
