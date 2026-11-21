# ANATA Personal · Documento de construcción v1

Nov 20, 2026 · @Agus

## Cómo usar este documento

Este documento es la única fuente que Claude Code necesita para construir ANATA Personal en 4 sesiones, listo para usar el 27 de noviembre de 2026.

1. Exporta este doc como Markdown y guárdalo en el repo como `docs/ANATA-PERSONAL.md`.
2. Haz tú la Fase 0 (15 minutos): crear tu clave de Garmin. Está en la sección de plan por fases.
3. Abre Claude Code en el repo `aardizzir/sport-agent` y pega el prompt de la Fase 1. Una fase por sesión.
4. Cada sesión termina con `git add . && git commit && git push origin main` y un resumen que pegas al final de este doc.
5. Modelo: Opus para las Fases 1 y 2 (Worker, datos, agente). Sonnet para las Fases 3 y 4 (pantallas y pulido).

## Qué es ANATA Personal

ANATA Personal es ANATA para un solo usuario. Cada mañana lee tus datos de la Garmin CIRQA y te dice en palabras simples cómo está tu cuerpo y qué hacer hoy para entrenar mejor.

**El problema hoy.** Llevas 2 días con la CIRQA y la app Garmin Connect te muestra muchos números que no sabes leer. Es exactamente el problema que encontró la investigación de ANATA: el 76% de los deportistas encuestados admite no saber qué hacer con sus métricas, y el 88% tiene problemas para decidir frente a una molestia (17 encuestados, todos de un solo barrio de Santiago; los datos son una señal, no una muestra representativa).

**Para quién.** Agus. Hoy entrena gimnasio con mentalidad de atleta amateur y su meta es volver a jugar rugby. Usa la CIRQA día y noche.

**Lo que hace, en orden de prioridad.**

1. Te resume todas tus métricas en palabras simples, sin lenguaje de profesional de la salud.
2. Te da la decisión del día: entrena, ajusta o descansa, pensando en el gimnasio y en tu vuelta al rugby.
3. Te deja registrar molestias y responde "¿puedo entrenar con esto hoy?".
4. Te enseña: cada métrica tiene su explicación, para que en unas semanas la entiendas sin ayuda.

**Criterios de éxito (primera semana de uso, del 27 nov al 3 dic).**

- La abres 7 de 7 mañanas sin que nada te lo recuerde.
- Entiendes el resumen del día en menos de 60 segundos.
- Puedes explicar con tus palabras qué son Body Battery, puntuación de sueño y estrés.
- Los datos de Garmin llegan solos en al menos 6 de 7 días (o por captura de pantalla si la API falla).
- Al final de la semana respondes "sí" a: ¿la usarías mañana sin que te lo recuerden?

## Qué se reutiliza de ANATA

Se reutiliza casi todo el stack que ya funciona. Lo nuevo es la conexión con Garmin y el resumen diario en palabras simples.

| Pieza existente | Decisión | Por qué |
| --- | --- | --- |
| PWA en GitHub Pages (`aardizzir.github.io/sport-agent`) | Reutilizar | Ya se instala en el celular. No hay que publicar en tiendas. |
| Supabase (Free, São Paulo) + login con Google | Reutilizar | Ya guarda perfil, conversaciones y molestias. Solo se agregan 2 tablas. |
| Cloudflare Worker `sport-agent-api` + Claude API | Reutilizar y ampliar | Es el lugar seguro para guardar la clave de Garmin y traer los datos cada mañana. |
| Tablas `daily_states`, `aches`, `verdicts`, `patterns`, `conversations`, `messages` | Reutilizar | La memoria longitudinal ya existe. Los datos de Garmin se suman a ella. |
| System prompt v2.0 (8 bloques, escala de dolor 1–10, derivación obligatoria) | Base para v3 | Se agrega el bloque de traducción de métricas y el resumen diario. |
| Marcadores `<<<ACHE>>>` y `<<<VERDICT>>>` | Reutilizar | Ya registran molestias y decisiones de forma automática. |
| 4 pantallas: Hoy, Historial, Cuerpo, Perfil | Simplificar | Hoy y Cuerpo son las importantes. Historial queda básico. Perfil queda mínimo. |
| Logo SVG, paleta de 5 colores, tipografía Outfit | Reutilizar | Ver la sección de branding. |

**Lo que se deja fuera por ahora:** onboarding para usuarios nuevos, flujo de beta, monetización, cambio de nombre del repo y dominio, contenido para Instagram e integraciones con Whoop, Polar o Apple Watch. Nada de esto se borra: solo no se toca en estas 4 sesiones.

## Funcionalidades

Son seis funcionalidades. Si una idea nueva no sirve a alguna de ellas, espera a una versión posterior.

| # | Funcionalidad | Qué ves | Regla clave |
| --- | --- | --- | --- |
| 1 | Resumen de la mañana "Tu cuerpo hoy" | Un titular, de 3 a 5 frases simples y un color (verde, ámbar o terracota) | Máximo 120 palabras. Cada número se compara con *tu* normal, no con un promedio. |
| 2 | Traductor de métricas | Tocas cualquier métrica y ves qué es, dónde estás hoy y qué significa para ti | Primero la explicación, después el nombre técnico (valor de marca "Claridad antes que jerga"). |
| 3 | Decisión del día | Entrena / Ajusta / Descansa, con intensidad sugerida y 2 cosas que hacer y 2 que evitar | Se piensa para tu gimnasio de hoy y para tu objetivo de volver al rugby. |
| 4 | Molestias | Registras zona e intensidad del 1 al 10, o señalas un punto en el cuerpo | Con dolor de 7/10 o más, ANATA te deriva al kinesiólogo y no entrega un plan para esa zona. |
| 5 | Chat | Preguntas lo que quieras ("¿por qué bajó mi batería?") | El agente ve tus datos de Garmin de los últimos 14 días y tu historial. |
| 6 | Modo calibración | Un aviso honesto de qué métricas todavía no son confiables | Garmin necesita 3 semanas de sueño para el estado de VFC y 2 semanas de entrenamiento para el ratio de carga. |

**El modo calibración responde directo a tu frustración actual.** Parte de lo que hoy no entiendes es porque Garmin todavía no te ha dado esas métricas. Si empezaste a usar la banda alrededor del 18 de noviembre, el ratio de carga debería aparecer cerca del 2 de diciembre y el estado de VFC (variabilidad de la frecuencia cardíaca) cerca del 9 de diciembre, siempre que la uses todas las noches. ANATA lo dice claro en vez de inventar.

**Fuera de alcance:** notificaciones push, gráficos complejos y enviar entrenamientos a la banda (la API personal de Garmin solo permite leer).

## Traductor de métricas

Esta tabla es el diccionario del agente. Los rangos son los oficiales de Garmin. La última columna dice cómo los explica ANATA. Claude Code la carga tal cual en el system prompt.

| Métrica Garmin | Qué es, en simple | Rangos oficiales | Cómo lo dice ANATA |
| --- | --- | --- | --- |
| Body Battery (0–100) | Tu batería de energía. Se carga durmiendo y se gasta con esfuerzo y estrés. | 0–25 baja · 26–50 media · 51–75 alta · 76–100 muy alta | "Despertaste con la batería en 82. Tienes energía para un día exigente." |
| Puntuación de sueño (0–100) | Qué tan bien y cuánto dormiste anoche. | 90–100 excelente · 80–89 buena · 60–79 regular · menos de 60 mala | "Dormiste 64: regular. No es grave, pero hoy no es día de batir récords." |
| Estrés (0–100) | Qué tan acelerado está tu cuerpo cuando no te mueves. | 0–25 reposo · 26–50 bajo · 51–75 medio · 76–100 alto | "Tu cuerpo estuvo tranquilo casi todo el día (promedio 28)." |
| Estado de VFC | Si tu sistema nervioso se está recuperando bien. Compara tu promedio de 7 días con tu propio rango normal. | Equilibrado · Desequilibrado · Bajo · Pobre. Necesita 3 semanas de sueño para aparecer. | "Tu recuperación de fondo está en tu rango normal." Antes de 3 semanas: "Todavía estoy aprendiendo tu normal." |
| Disposición para entrenar (Training Readiness, 1–100) | La nota de Garmin a qué tan listo estás para entrenar fuerte. Mezcla sueño, recuperación, VFC, carga y estrés. | 95–100 óptima · 75–94 alta · 50–74 moderada · 25–49 baja · 1–24 pobre | ANATA no la repite como número suelto. La usa para la decisión y explica qué factor la bajó. |
| Ratio de carga (carga aguda ÷ carga crónica) | Si esta semana entrenaste mucho más o mucho menos de lo que tu cuerpo está acostumbrado. | Menos de 0,8 bajo · 0,8–1,4 óptimo · 1,5–1,9 alto. Aparece tras 2 semanas de entrenamiento. | "Esta semana subiste la carga más rápido de lo que tu cuerpo está acostumbrado. Cuidado con la acumulación." |
| Frecuencia cardíaca en reposo | Cuántas veces late tu corazón descansando. Si sube varios días seguidos, suele indicar cansancio. | Garmin no da rangos. ANATA la compara con tu promedio de 7 días. | "Tu pulso en reposo está 4 latidos más alto que tu normal." |
| VO2 máx | El tamaño de tu motor aeróbico. Cambia en semanas, no en días. | Garmin lo clasifica según edad y sexo. | Se menciona una vez al mes, como tendencia. Nunca en el resumen diario. |
| Sat. O2 (Pulse Ox) y temperatura de la piel | Datos de contexto durante el sueño. | Sin rango de decisión. La CIRQA no es un dispositivo médico. | Solo se mencionan si cambian mucho frente a tu normal, y siempre sin diagnóstico. |

**Contexto para no frustrarse:** el promedio de sueño de los usuarios de Garmin es 72 (regular) y solo el 7% promedia "excelente". Una noche regular es lo normal, no una alarma.

**Reglas de ANATA (no son de Garmin, se validan con tu uso):**

- Pulso en reposo 5 latidos o más sobre tu promedio de 7 días, por 2 días seguidos, es señal de cansancio acumulado.
- Si la batería al despertar está en 25 o menos y el sueño bajo 60, la decisión por defecto es Ajusta o Descansa.
- Una molestia de 7/10 o más siempre gana sobre cualquier métrica.

## Conexión con Garmin

La conexión principal es la Garmin Connect Personal API oficial (lanzada en octubre de 2026). Hay dos respaldos para que la app funcione aunque falte un dato.

**Plan A — Personal API (automático).**

- Es para que una persona lea sus propios datos en apps personales. No sirve para apps con varios usuarios, y eso calza con esta versión.
- La clave se crea en Garmin Connect web → página Personal API Key → Create Key. Se elige cuánto dura (30 días a 1 año; elige 1 año) y se muestra una sola vez.
- La clave se cambia por un token que dura 24 horas. No hay token de renovación, así que el Worker pide uno nuevo cada vez.
- Solo lectura: el Worker pide los datos, Garmin no los envía solo.
- Cómo funciona en ANATA: un Cron Trigger de Cloudflare corre todos los días a las 06:30 hora de Santiago, trae los datos de la noche y del día anterior y los guarda en Supabase (`garmin_daily`). La clave vive como secreto del Worker (`GARMIN_PERSONAL_API_KEY`), nunca en el frontend.
- **Incógnita:** Garmin no ha publicado la lista de métricas que entrega esta API. Hay reportes de que algunos análisis (VO2 máx, tiempo de recuperación) se quitan de los archivos que entrega la API. La primera tarea de la Fase 1 es probar con tu clave y registrar qué llega.

**Plan B — Captura de pantalla (respaldo inteligente).** Si una métrica no llega por la API (por ejemplo Disposición para entrenar), subes una captura de la pantalla de Garmin Connect. Claude la lee, extrae los números a JSON y los guarda en la misma tabla con `source = 'screenshot'`. Toma 10 segundos y no depende de Garmin.

**Plan C — Manual.** Cuatro campos rápidos: batería al despertar, puntuación de sueño, horas dormidas y cómo te sientes del 1 al 5.

**Lo que no se usa:** las librerías no oficiales (python-garminconnect, garth). Dejaron de funcionar en marzo de 2026 cuando Garmin activó protecciones de Cloudflare, y dependen de tu contraseña.

## Pantallas y flujo diario

La app tiene 3 pantallas en la barra inferior. Hoy es la principal y responde todo en menos de un minuto.

| Pantalla | Qué contiene | Prioridad |
| --- | --- | --- |
| Hoy | Tarjeta "Tu cuerpo hoy" (titular + 3–5 frases + color) → una pregunta de 1 toque ("¿Cómo te sientes? 1–5" y "¿Alguna molestia?") → tarjeta de decisión → chat abajo | Fase 2–3 |
| Cuerpo | Una tarjeta por métrica: valor de hoy, una línea simple, una mini línea de 7 días, insignia "calibrando" si aplica. Al tocarla se abre la explicación del traductor. Abajo, las molestias activas. | Fase 3 |
| Historial | Lista por día: color, decisión y una frase. Al tocar un día se ve su resumen completo. | Fase 3, básica |
| Perfil (ícono arriba, no en la barra) | Datos, objetivo rugby, estado de la conexión Garmin, botón "subir captura". | Fase 3, mínima |

**Un día normal:**

1. 06:30 — El Worker trae los datos de Garmin y genera el resumen.
2. Abres la app y lees "Tu cuerpo hoy" (30 segundos).
3. Respondes la pregunta de 1 toque. Si marcas molestia, eliges la zona y la intensidad.
4. ANATA entrega la decisión con el plan de gimnasio ajustado.
5. Después de entrenar (opcional): "¿Qué tan duro fue? 1–10". Queda en la memoria para mañana.

Si a las 06:30 no llegó un dato, la tarjeta lo dice y ofrece subir una captura. Nunca muestra una pantalla vacía sin explicación.

## Arquitectura y datos

El Worker de Cloudflare pasa a ser el centro: trae Garmin, lee Supabase y llama a Claude. Así se cierra también la brecha de memoria que marcaba el estado técnico de mayo (el Worker no leía Supabase).

| Componente | Rol | Cambio en este proyecto |
| --- | --- | --- |
| PWA (GitHub Pages) | Muestra las pantallas y llama solo al Worker | Pantallas Hoy, Cuerpo, Historial. Subida de captura. |
| Worker `sport-agent-api` | `GET /today` (resumen + métricas), `POST /chat`, `POST /garmin/screenshot`, cron 06:30 | Nuevo: cliente Garmin, cron, lectura de Supabase, endpoint de captura |
| Garmin Personal API | Fuente de datos (solo lectura) | Nueva |
| Supabase | Memoria: perfil, métricas, molestias, decisiones | 2 tablas nuevas |
| Claude API | Genera el resumen, la decisión y el chat. Lee las capturas. | Usar el modelo Sonnet vigente; Claude Code confirma el nombre exacto |

**Tabla nueva `garmin_daily`** (una fila por día):

```
date                 date  PK (junto con user_id)
user_id              uuid
body_battery_wake    int        -- batería al despertar
body_battery_min     int
sleep_score          int
sleep_minutes        int
stress_avg           int
resting_hr           int
hrv_last_night_ms    int
hrv_status           text       -- balanced | unbalanced | low | poor | none
training_readiness   int        -- puede venir null si la API no lo entrega
acute_load           int
load_ratio           numeric
vo2max               numeric
source               text       -- api | screenshot | manual
raw_json             jsonb      -- respuesta completa, para descubrir campos
fetched_at           timestamptz
```

**Tabla nueva `daily_summaries`:** `date`, `user_id`, `headline`, `summary_text`, `color` (go | caution | stop), `calibrating_metrics` (text\[\]), `verdict_id` (FK a `verdicts`), `created_at`.

**Contexto que el Worker envía a Claude en cada llamada:** perfil y objetivo, `garmin_daily` de los últimos 14 días, promedios de 7 días, molestias activas (`aches`), las últimas 5 decisiones (`verdicts`) y patrones (`patterns`). Se estiman entre 3.000 y 5.000 tokens de entrada por llamada (estimación propia, para revisar en la Fase 2).

**Seguridad:** todas las tablas con Row Level Security por `user_id`. Las claves de Garmin, Anthropic y Supabase service solo viven en el Worker. Se mantiene la regla de nunca escribir claves en el código.

## El agente: system prompt v3

El prompt v3 parte del v2.0 y le agrega dos bloques: el traductor de métricas y el formato del resumen diario. Claude Code lo escribe a partir de estas reglas.

**Bloques que se mantienen del v2.0:** identidad (ahora siempre "ANATA", nunca "Sport Agent"), español latinoamericano neutro con "tú", contexto temporal (hoy, ayer, anteayer), regla anti-anuncio, formato `<<<VERDICT>>>`, marcador `<<<ACHE>>>`, escala de dolor 1–10 con derivación obligatoria desde 7, nunca recomendar antiinflamatorios y nunca hacer sentir débil a nadie por descansar.

**Bloque nuevo A — Hablar simple:**

- Cada número va acompañado de su traducción y de una comparación con *tu* normal de 7 días.
- Prohibido usar siglas sin explicarlas (VFC, RMSSD, EPOC, VO2). Primero la explicación, después el nombre.
- Frases de menos de 20 palabras. Ejemplos del cuerpo antes que números.
- Si una métrica está calibrando o es null, se dice en una frase y no se adivina.

**Bloque nuevo B — Contexto del atleta:** gimnasio hoy, objetivo volver al rugby. El rugby exige fuerza, potencia, cambios de dirección y aguante a esfuerzos repetidos, y tiene contacto. Las recomendaciones cuidan tobillos, rodillas, hombros y cuello, y priorizan construir base antes de subir intensidad.

**Bloque nuevo C — Formato del resumen diario** (lo pide el cron con `mode: "daily_summary"`):

```
<<<SUMMARY
{
  "headline": "Batería llena, sueño justo",
  "color": "go | caution | stop",
  "lines": [
    "Despertaste con la batería en 78: buena energía.",
    "Dormiste 6 h 10 min (puntuación 66, regular). Menos de lo que te sirve.",
    "Tu cuerpo estuvo tranquilo ayer: estrés promedio 27.",
    "Tu recuperación de fondo todavía se está calibrando (día 3 de 21)."
  ],
  "calibrating": ["hrv_status", "load_ratio"]
}
SUMMARY>>>
```

Máximo 5 líneas y 120 palabras. Después del check-in de 1 toque, el agente entrega el `<<<VERDICT>>>` habitual.

**Ejemplo de tono para la decisión:** "Hoy entrena, pero ajusta. Tienes energía, pero dormiste poco. Haz tu rutina de pierna al 80% del peso y deja los saltos para el jueves. Mañana te digo si subimos."

## Branding

ANATA Personal usa la marca ANATA tal como está. Lo nuevo es cómo la marca le habla a una sola persona sobre sus métricas, y tres colores de estado para la decisión.

**Esencia.** Tu cuerpo te habla. Yo traduzco.

**Promesa en la app.** Cada mañana entiendes tu cuerpo en menos de un minuto y sabes qué hacer.

**Personalidad.** Un coach que sabe de ciencia y te explica como un amigo entendido. Tiene autoridad porque sabe, no porque manda. Es tranquilo, directo y honesto cuando no sabe algo.

**Voz.** Dentro de la app, ANATA habla en primera persona y te trata de "tú" (es tu agente). En redes sociales se mantiene la tercera persona editorial. Se aplican los 4 principios de tono: decir, no sugerir; explicar el por qué; traducir, no solo nombrar; y honesto antes que diplomático.

| ANATA dice así | No así |
| --- | --- |
| "Tu batería está en 34. Hoy rinde menos: baja el peso un 20%." | "Body Battery 34, nivel medio de reserva energética." |
| "Todavía estoy aprendiendo tu normal. En 12 días te doy esto completo." | "Datos insuficientes." |
| "Dormiste regular. Pasa, no es alarma." | "Tu calidad de sueño es deficiente." |
| "Esa molestia no es normal. Ve al kinesiólogo antes de seguir." | "Quizás sería bueno consultar a alguien." |

**Paleta.** Se mantienen los 5 colores de marca y se agregan 3 de estado, sacados de la misma familia de verdes apagados para que no parezca un semáforo genérico.

| Rol | Color | Uso |
| --- | --- | --- |
| Blanco | `#FFFFFF` | Fondo base, texto sobre colores oscuros |
| Gris claro | `#B0B0B0` | Bordes, texto secundario grande |
| Negro | `#000000` | Texto principal, logo |
| Oliva oscuro | `#474C49` | Texto de apoyo, íconos, barra inferior |
| Salvia | `#90978F` | Acentos, insignia "calibrando" |
| Degradado de fondo | blanco → `rgba(144,151,143,0.18)` | Todas las pantallas |
| Estado: Entrena | `#4F6B4A` | Píldora y borde de la tarjeta de decisión (texto blanco) |
| Estado: Ajusta | `#B08A3E` | Píldora (texto `#000000`; no usar texto blanco encima) |
| Estado: Descansa | `#8C4A3C` | Píldora (texto blanco) |

**Tipografía.** Outfit para todo, la que ya usa la app. Los titulares de las tarjetas en 22 px semibold, el cuerpo en 16 px regular (nunca menos en el celular) y los números grandes de las métricas en 40 px light.

**Logo.** El wordmark ANATA va siempre centrado arriba en cada pantalla. El isologo (`ANATA-09.svg` / `ANATA-10.svg`) es el ícono de la PWA.

**Componentes clave:**

- **Tarjeta "Tu cuerpo hoy":** fondo blanco con 85% de opacidad, radio de 20 px, titular, líneas con un punto de color a la izquierda y la píldora de estado arriba a la derecha.
- **Tarjeta de métrica:** nombre simple arriba ("Tu batería"), nombre Garmin pequeño abajo ("Body Battery"), número grande, una línea de traducción y una mini línea de 7 días en salvia.
- **Insignia "calibrando":** contorno salvia con el texto "Aprendiendo tu normal · día 3/21".
- **Íconos:** de línea, trazo de 1,5 px, en oliva oscuro, sin emojis.

**Textos fijos de la app:**

- Sin datos de Garmin todavía: "Tu banda aún no sincroniza lo de anoche. Abre Garmin Connect un momento o sube una captura."
- Primer día: "Hola, Agus. Voy a leer tu cuerpo cada mañana y te lo voy a contar simple. Los primeros días estoy aprendiendo cómo eres tú."
- Descanso: "Descansar también es entrenar. Hoy tu cuerpo construye lo de ayer."

## Plan por fases

Son 5 fases: la 0 la haces tú y las otras 4 son sesiones de Claude Code de 90 a 120 minutos. Fecha meta para empezar a usarla: 27 de noviembre de 2026.

| Fase | Quién | Fecha sugerida | Resultado |
| --- | --- | --- | --- |
| 0 · Preparación | Tú | 21 nov | Clave de Garmin creada y guardada |
| 1 · Datos de Garmin | Claude Code (Opus) | 21–22 nov | Tus datos llegan solos a Supabase |
| 2 · Agente que traduce | Claude Code (Opus) | 23–24 nov | Resumen diario y decisión con tus datos |
| 3 · Pantallas y marca | Claude Code (Sonnet) | 25–26 nov | Hoy, Cuerpo e Historial con el branding |
| 4 · Pulido y prueba | Claude Code (Sonnet) | 26–27 nov | Capturas, molestias, revisión final |

### Fase 0 — Preparación (tú, 15 minutos)

- [ ] Usar la CIRQA todas las noches desde hoy. Cada noche suma a la calibración.
- [ ] Entrar a Garmin Connect **web** → Personal API Key → Create Key → duración 1 año → copiar la clave a un gestor de contraseñas. Se muestra una sola vez.
- [ ] Tener a mano: token de GitHub, acceso a Cloudflare y a Supabase (reactivar el proyecto si está pausado).
- [ ] Exportar este doc como Markdown y dejarlo en `docs/ANATA-PERSONAL.md` del repo.

### Fase 1 — Datos de Garmin

```
Lee docs/ANATA-PERSONAL.md completo antes de planificar. Revisa el código actual del repo y del Worker sport-agent-api.

Objetivo de esta sesión: que mis datos de la Garmin CIRQA lleguen solos a Supabase cada mañana.

1. Ayúdame a guardar mi Garmin Personal API Key como secreto del Worker (GARMIN_PERSONAL_API_KEY). Nunca en el código.
2. Busca la documentación oficial de la Garmin Connect Personal API (developer.garmin.com) y escribe en el Worker un cliente que cambie la clave por un token (dura 24 h, sin refresh).
3. Haz una prueba de descubrimiento: pide los datos de los últimos 3 días, guarda las respuestas crudas y escríbeme una tabla de qué métricas de la sección "Traductor de métricas" llegan y cuáles no.
4. Crea la tabla garmin_daily según la sección "Arquitectura y datos", con RLS por user_id. Ajusta columnas según lo que encontraste.
5. Agrega un Cron Trigger diario a las 06:30 America/Santiago que traiga ayer y hoy y haga upsert.
6. Agrega GET /today que devuelva la fila de hoy y los promedios de 7 días.

No uses librerías no oficiales (garth, python-garminconnect).
Criterio de éxito: puedo ver en Supabase al menos 3 días de mis datos reales.
Antes de cerrar: git add . && git commit && git push origin main, y despliega el Worker. Termina con un resumen de lo hecho, lo que llegó de Garmin y lo que faltó, para pegarlo en el doc.
```

### Fase 2 — Agente que traduce

```
Lee docs/ANATA-PERSONAL.md completo y el resumen de la Fase 1 al final del documento.

Objetivo: ANATA genera cada mañana "Tu cuerpo hoy" en palabras simples y entrega la decisión del día usando mis datos de Garmin.

1. Modifica el Worker para que, antes de llamar a Claude, lea de Supabase: perfil, garmin_daily de 14 días, promedios de 7 días, aches activas, últimas 5 verdicts y patterns. Arma un bloque de contexto compacto.
2. Escribe el system prompt v3 según la sección "El agente", con la tabla del traductor completa. Mantén todas las reglas del v2.0.
3. Agrega mode "daily_summary": el cron de las 06:30 lo llama después de traer Garmin, parsea el bloque <<<SUMMARY>>> y lo guarda en daily_summaries.
4. Calcula en el Worker qué métricas están calibrando (días con datos de sueño menos de 21 para la VFC; menos de 14 días para el ratio de carga) y pásaselo al agente.
5. Actualiza el modelo al Sonnet vigente y confírmame el nombre exacto.
6. Pruébalo con mis datos reales y muéstrame 3 resúmenes de ejemplo. Revísalos contra las reglas "Hablar simple": nada de siglas sin explicar y cada número comparado con mi normal.

Criterio de éxito: el resumen se entiende en menos de 60 segundos y no inventa métricas que faltan.
Antes de cerrar: commit + push + deploy y un resumen para el doc.
```

### Fase 3 — Pantallas y marca

```
Lee docs/ANATA-PERSONAL.md completo (sobre todo "Pantallas y flujo diario" y "Branding") y los resúmenes de las Fases 1 y 2.

Objetivo: las pantallas Hoy, Cuerpo e Historial, con el branding ANATA aplicado.

1. Barra inferior con Hoy, Cuerpo e Historial; Perfil como ícono arriba. Wordmark centrado arriba en todas.
2. Hoy: tarjeta "Tu cuerpo hoy" desde GET /today → check-in de 1 toque (sensación 1–5 y molestia sí/no) → tarjeta de decisión → chat existente.
3. Cuerpo: una tarjeta por métrica con nombre simple, número grande, línea de traducción, mini línea de 7 días e insignia "calibrando". Al tocar se abre la explicación. Abajo, las molestias activas.
4. Historial: lista por día con color, decisión y frase.
5. Usa exactamente la paleta, la tipografía Outfit, los colores de estado y los textos fijos del doc.

Criterio de éxito: en un celular de 390 px de ancho ningún texto se sale de su tarjeta, nada se corta y el cuerpo nunca baja de 16 px. Revisa cada pantalla con capturas antes de cerrar.
Antes de cerrar: commit + push y un resumen para el doc.
```

### Fase 4 — Pulido y prueba

```
Lee docs/ANATA-PERSONAL.md y todos los resúmenes de fases anteriores.

Objetivo: dejar la app lista para usarla 7 días seguidos.

1. Plan B: POST /garmin/screenshot. Subo una captura de Garmin Connect, Claude extrae las métricas a JSON, me muestra lo que leyó para que lo confirme y lo guarda con source='screenshot'.
2. Plan C: formulario manual de 4 campos.
3. Molestias: registro rápido por zona e intensidad conectado a aches; regla de derivación desde 7/10.
4. Después de entrenar: pregunta opcional "¿Qué tan duro fue? 1–10", guardada en daily_states.
5. Revisión final: prueba el flujo de un día completo, revisa errores en consola, confirma que la PWA se instala y que el cron corrió.

Antes de cerrar: commit + push + deploy y una lista de lo que debo observar durante mi semana de prueba.
```

## Riesgos y fuentes

El riesgo más grande es que la Personal API no entregue Disposición para entrenar ni el estado de VFC. El plan B por captura lo cubre desde el primer día.

| Riesgo | Probabilidad | Qué hacemos |
| --- | --- | --- |
| La API no entrega algunas métricas de análisis de Garmin | Media-alta | Descubrimiento en la Fase 1 + captura de pantalla (Plan B) |
| La clave de Garmin vence | Segura (en 1 año) | Garmin avisa por email una semana antes. Perfil muestra la fecha de vencimiento. |
| Supabase Free se pausa por inactividad | Media | El cron diario lo mantiene activo |
| Recomendación equivocada sobre una molestia | Baja, impacto alto | Derivación obligatoria desde 7/10. ANATA no diagnostica. La CIRQA no es un dispositivo médico. |
| Costo de la API de Claude | Bajo | 1 usuario y unas 3 llamadas al día. Se revisa el gasto en la consola de Anthropic después de la semana 1. |
| Frustración por métricas incompletas en las primeras 3 semanas | Alta | Modo calibración con fechas concretas |

**Fuentes** (consultadas el 20 de noviembre de 2026):

- [Garmin Connect Personal API — FAQ oficial](https://developer.garmin.com/gc-developer-program/personal/personal-faq/)
- [the5krunner — Garmin personal API gives athletes their own data back (oct 2026)](https://the5krunner.com/2026/10/22/garmin-personal-api/)
- [Garmin — Cómo usar la CIRQA Smart Band (métricas incluidas)](https://www.garmin.com/en-ZA/blog/fitness/how-you-can-use-cirqa-smart-band-to-track-your-fitness/)
- [Manual Garmin — Estado de VFC (3 semanas, estados)](https://www8.garmin.com/manuals/webhelp/GUID-607F08F6-33FC-40BF-9727-84E54043D82D/EN-US/GUID-9282196F-D969-404D-B678-F48A13D8D0CB.html)
- [Manual Garmin — Disposición para entrenar (rangos y factores)](https://www8.garmin.com/manuals-apac/webhelp/venu4/EN-SG/GUID-AF7FBFCA-484D-4D48-9559-11F919B1CA0E-7969.html)
- [Manual Garmin — Body Battery (rangos)](https://www8.garmin.com/manuals-apac/webhelp/descentmk22s/EN-SG/GUID-C645C59E-D4EA-4203-ADD9-3949B0FB352C-8184.html)
- [Manual Garmin — Nivel de estrés (rangos)](https://www8.garmin.com/manuals/webhelp/vivosmart3/EN-AU/GUID-9282196F-D969-404D-B678-F48A13D8D0CB.html)
- [Garmin — Datos de sueño de usuarios (rangos y promedio 72)](https://www.garmin.com/en-CA/blog/?p=31689)
- [Manual Garmin — Carga aguda y ratio de carga](https://www8.garmin.com/manuals-apac/webhelp/fenix9/EN-SG/GUID-BA035255-E5AF-484F-B1D5-2C1A8DCB7917-8766.html)
- [garmin-givemydata — caída de librerías no oficiales en marzo de 2026](https://pypi.org/project/garmin-givemydata/)
- Documentos del proyecto ANATA: Documento de Marca v1.0, Documento de Producto v1.0, Estado Técnico del MVP v1.0 y la encuesta de 17 deportistas.

## Registro de sesiones

Pega aquí el resumen que entrega Claude Code al cerrar cada fase.

### Fase 1 · Datos de Garmin — 20-21 nov 2026 (cerrada)

**Lo hecho**

- Worker `sport-agent-api` v0.7.0 desplegado, reorganizado en `worker/index.js` (rutas y cron), `worker/garmin.js` (cliente Garmin) y `worker/chat.js` (el chat de siempre, sin cambios de comportamiento).
- Cliente oficial de la Garmin Connect Personal API: `POST https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token` con `Authorization: ApiKey <clave>` → token de 24 h, se pide uno nuevo en cada ejecución. Ojo: ese endpoint responde 406 si se manda `Accept: application/json`.
- Endpoints usados: `/usersummary-service/usersummary/daily`, `/sleep-service/sleep/dailySleep`, `/hrv-service/hrv/{fecha}`, `/metrics-service/metrics/maxmet/daily/{inicio}/{fin}` y `/activitylist-service/activities/search/activities`. El spec oficial quedó en `docs/garmin-personal-api-openapi.json`.
- Tablas nuevas en Supabase con RLS por `user_id`: `garmin_daily` (una fila por día, con `raw_json` completo) y `garmin_sync_runs` (registro de cada sincronización, para saber si el cron corrió). Migración: `supabase/migrations/add_garmin_daily_table.sql`.
- Cron: 06:30 hora de Santiago (lectura principal) + 09:30 (repesca si la banda sincronizó tarde). Trae ayer y hoy y hace upsert. Maneja solo el cambio de horario de verano/invierno de Chile.
- `GET /today` (con el JWT de Supabase de la app): fila de hoy, promedios de los 7 días anteriores ("tu normal"), días con datos y última sincronización.
- Rutas admin protegidas con `X-Admin-Token`: `POST /admin/garmin/sync?days=N`, `GET /admin/garmin/raw?date=`, `GET /admin/profiles`.
- Los días sin ningún dato (antes de tener la banda o sin sincronizar) no se guardan.
- Secretos del Worker (en Cloudflare, nunca en el código): `ANTHROPIC_API_KEY`, `GARMIN_PERSONAL_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANATA_ADMIN_TOKEN`. `ANATA_USER_ID` = Agus, en `wrangler.toml`.

**Qué llega de Garmin (prueba real del 17 al 21 nov; la banda tiene datos desde el 19)**

| Métrica del traductor | ¿Llega por la API? | Datos reales | Nota |
| --- | --- | --- | --- |
| Body Battery al despertar | Sí | 20 nov: 57 | El 19 no hay: fue antes de la primera noche con la banda. También llegan mínimo, máximo y carga durante el sueño. |
| Puntuación de sueño | Sí | 20 nov: 82 (buena), 8 h 28 min | Llegan también fases (profundo, REM) y sub-puntuaciones. |
| Estrés promedio | Sí | 19: 43 · 20: 30 | |
| Estado de VFC | Sí, pero calibrando | 20 nov: "none" (ONBOARDING_1), VFC noche 28 ms | Garmin necesita ~3 semanas. Estimado: cerca del 10 de diciembre. |
| Disposición para entrenar | **No** | — | No existe en la Personal API → Plan B (captura) o Plan C (manual). |
| Ratio de carga de Garmin | **No** | — | ANATA calcula uno propio con `activityTrainingLoad` de cada actividad: carga aguda (7 días) ÷ crónica (28 días ÷ 4). Se activa con 14 días de historia (cerca del 3 de diciembre). |
| Carga aguda (calculada) | Sí | 19: 300 · 20: 710 | Fuerza 19 nov (106 min, carga 300) y 20 nov (87 min, carga 410). |
| Pulso en reposo | Sí | 19: 69 · 20: 65 | El promedio de 7 días de Garmin todavía no llega (banda nueva); ANATA lo calcula. |
| VO2 máx | Endpoint sí, dato no | — | Garmin aún no lo calcula (suele requerir caminata o carrera al aire libre con GPS). |
| Sat. O2 (Pulse Ox) | Sí | 19: 95 · 20: 96 | |
| Temperatura de la piel | **No** | — | No existe en la Personal API. Se descartó la columna. |

**Lo que faltó o queda pendiente**

- Criterio de éxito (3 días reales en Supabase): hoy hay 2 (19 y 20 nov) porque la banda empezó el 19. El tercero llega solo con el cron del sábado 21 a las 06:30.
- `GET /today` se probó con datos simulados y responde 401 sin sesión. Con tu sesión real se prueba en la Fase 3, cuando la pantalla Hoy lo use.
- El token de Cloudflare (30 días) quedó guardado en el entorno de Claude Code para desplegar en las próximas fases.
