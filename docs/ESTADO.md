# Piara — Estado actual

_Última actualización: 2026-07-16_

## Qué es

SaaS de inteligencia climática para criaderos porcinos (zona San Andrés de Giles). Calcula ITH por galpón, dispara alertas de estrés térmico/frío/lluvia con acciones concretas, pronostica 48 h, optimiza horarios de alimentación y ordena producción, reproducción, agua y sanidad. Plan Pro USD 200/mes.

## Stack

- **Backend**: Node ≥22, Express, SQLite propio (`src/backend/db.js`), JWT + bcryptjs. Clima en vivo vía Open-Meteo.
- **Frontend**: SPA vanilla sin build — `index.html` + `src/app.js` + `src/styles.css`. La lógica de dominio compartida (browser + Node) vive en `src/shared/` (ith, production, repro, water, health).
- **Correr**: `npm start` (server.js, puerto 3000) · `npm run seed` (datos demo) · `npm run simulate` (sensor fake) · `npm test` (29 tests, todos pasan).
- **Login demo**: `demo@piara.com` / `demo1234`.

## Rediseño visual (2026-07-10) — COMPLETO

Rediseño completo de la capa visual con estética Apple/HIG, hecho en 5 pasadas (impeccable init → audit → Emil Kowalski motion → Taste Skill 3/4/3 → polish). **La lógica, los datos y la API no se tocaron**; solo CSS, markup decorativo y clases en templates.

- **Sistema de diseño** documentado en `PRODUCT.md` (estrategia) y `DESIGN.md` (tokens). Fuente de verdad de tokens: `:root` de `src/styles.css`.
- Tema oscuro refinado estilo macOS dark (decisión del usuario), tokens OKLCH, un solo acento verde, semáforo semántico tipo iOS system colors con variantes `-tint`/`-text`.
- Tipografía `-apple-system / SF Pro Text / system-ui`, números tabulares, radios 12/16/20px, sombras difusas en vez de bordes duros, hairlines al 9%.
- Vidrio esmerilado solo en el topbar sticky (dos filas: marca+Salir / selector+tabs con scroll horizontal).
- Gauge ITH como anillo (JS solo setea `--gauge-pct` y `data-level`; colores en CSS).
- Alertas sin side-stripe: fondo tintado + título en color; la prioritaria se eleva con sombra. Entrada con `@starting-style` (fade+lift, stagger), sin replay en el refresh de 90 s.
- Microinteracciones: crossfade con blur al cambiar establecimiento, transición de tabs 200ms ease-out, hover en tira horaria, `scale(0.97)` en botones, `prefers-reduced-motion` global.
- Emojis reemplazados: headers con SVG inline estilo SF Symbols (stroke 1.5, 18px); emojis de estado eliminados del copy; el 🐖 se conservó como logo/favicon (marca).
- Tildes corregidas en los strings visibles de `src/shared/ith.js` (labels de categoría, títulos de alertas, acciones), con voseo consistente y "°C".

Verificado en navegador (Playwright): desktop 1040px, mobile 375px, las 8 pestañas, cambio de sitio, sin errores de consola.

## Estructura

```
index.html          SPA shell (login + 8 vistas)
server.js           entrada del servidor
src/app.js          frontend (render por template strings)
src/styles.css      tokens + estilos (única fuente de verdad visual)
src/config.js       galpones/categorías demo
src/backend/        routes, service, db, auth, weather, notify
src/shared/         ith, production, repro, water, health (browser + Node)
tools/              seed, sensor-simulator, test-ith
PRODUCT.md          registro, usuarios, principios de diseño
DESIGN.md           sistema visual (colores, tipo, motion, componentes)
docs/PROPUESTA.md   propuesta comercial
```

## Cierre de pendientes (2026-07-16)

- **Tildes**: se revisaron todos los strings visibles de `src/backend/` y `src/shared/` (production, repro, health, water ya estaban bien). Se corrigieron 4 mensajes de error en `routes.js` (registrado/contraseña/categoría/Galpón). Verificado con smoke test: el login fallido ya devuelve "Email o contraseña incorrectos".
- **Celdas "prime" del optimizador**: atenuadas — fondo `--ok-tint` con anillo interior de acento en vez de relleno acento sólido, así en días frescos la tira no queda toda verde.
- **WhatsApp/Twilio**: el código ya envía de verdad si están las credenciales. `iniciar.bat` ahora carga automáticamente un `twilio.bat` si existe. Para activarlo, crear `twilio.bat` en la raíz con:
  ```bat
  set PIARA_TWILIO_SID=ACxxxx
  set PIARA_TWILIO_TOKEN=xxxx
  set PIARA_TWILIO_FROM=whatsapp:+14155238886
  ```
  (Único paso que requiere una cuenta de Twilio — bloqueado hasta tener credenciales.)

## Auditoría full stack (2026-07-16)

Revisión completa de seguridad, integridad de datos y confiabilidad. **Correcciones aplicadas y verificadas:**

- **CRÍTICO — exposición de archivos**: `express.static(__dirname)` servía `piara.db` y el código del backend (con el JWT secret) por HTTP. Reemplazado por whitelist de assets del frontend en `server.js`. Verificado: `/piara.db` y `/src/backend/*` → 404.
- **CRÍTICO — JWT secret**: `auth.js` ahora aborta el arranque en `NODE_ENV=production` sin `PIARA_SECRET`.
- **CRÍTICO — ingesta de sensores**: `/api/ingest` valida rangos físicos (temp −30..55, humedad 0..100, agua 0..1e6); fuera de rango → 422.
- **ALTO — fuerza bruta**: rate limiter en memoria (10/min por IP) en login/registro.
- **ALTO — integridad**: validación numérica y de fecha en lotes y agua; guard que impide dos ciclos activos para la misma cerda (409).
- **ALTO — ciclo de vida de alertas**: columnas `resolved_at`/`resolved_by` (migración idempotente), auto-resolución cuando la condición desaparece, y endpoint `POST /api/alerts/:id/resolve`. El historial expone estado `activa`/`resuelta`.
- **ALTO — zona horaria**: los timestamps de Open-Meteo ahora llevan offset real; `feedingPlan` lee la hora local del string. Los horarios de alimentación ya no dependen de la TZ del server.

**Segunda tanda (deuda técnica cerrada):**
- **Trazabilidad de autoría**: columna `created_by` (migración) en lotes, servicios, agua y sanidad; se registra el usuario en cada carga.
- **GET idempotentes**: los avisos de repro/agua/sanidad se movieron de los GET a un job de fondo (`service.scanDomainNotifications`, cada 30 min). Abrir una vista ya no dispara WhatsApp.
- **Headers de seguridad**: CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy` en todas las respuestas.
- **Código muerto**: eliminado `src/config.js` (duplicaba los umbrales ITH de `ith.js` → riesgo de drift; no se importaba en ningún lado).

**Features nuevas implementadas (2026-07-16):**

- **Stock de alimento (kg)** — nueva pestaña "Alimento". Inventario por establecimiento con balance en vivo, movimientos de ingreso/egreso, historial y aviso de stock bajo (umbral configurable, integrado al job de WhatsApp). Doble modo, elegible por el usuario:
  - **Manual**: se cargan ingresos (compras) y egresos (consumo/merma) a mano.
  - **Automático**: al subir el alimento acumulado (`feed_kg`) de un lote, el delta se descuenta solo del stock (movimiento tipo `auto` ligado al lote).
  - Tablas/campos: `feed_moves` (con signo), `sites.feed_low_kg`, `sites.feed_auto`. Endpoints `GET/POST /sites/:id/feed`, `/feed/move`, `/feed/config`. Verificado: ingreso/egreso, bloqueo de negativo (con `force`), auto-descuento (3000→1800 por lote de 1200 kg), toggle a manual no descuenta, aviso de stock bajo.
- **Umbrales ITH configurables por criadero** — en la pestaña "Avisos". El productor ajusta desde qué ITH se marca confort / peligro / emergencia; por defecto usa los estándar porcinos (74/78/84). Validación: 50–100 y confort < peligro < emergencia. Se aplican en todo el motor (dashboard, alertas, alimentación, economía) y colorean igual en el frontend. Campos `tenant_settings.ith_comfort/alert/emergency` (NULL = default). Verificado: con ITH real ~66, bajar confort a 55 llevó la severidad de 0 a 2; reset vuelve a 74.

**Tercera tanda — paquete cerrado (2026-07-16):**

- **Roles y permisos** — tres roles: `owner` (dueño/admin), `veterinario`, `operario`. El dueño gestiona equipo y configuración; veterinario y operario cargan datos pero no tocan config. Middleware `requireRole` en `auth.js`; el rol viaja en el JWT (con fallback a la base para tokens viejos). Gestión de equipo (alta/cambio de rol/baja) en la pestaña "Avisos", solo visible para el dueño. Endpoints `GET/POST /users`, `POST /users/:id/role`, `DELETE /users/:id`. Config sensible (WhatsApp, umbrales ITH, config de stock) gateada a `owner`. Verificado: operario recibe 403 en config y en listar usuarios, pero 200 al cargar datos; no se puede dejar el criadero sin ningún dueño ni auto-eliminarse.
- **Stock de medicamentos** — nueva pestaña "Medicamentos". Inventario por producto (cada uno con su unidad: dosis/ml/frascos/unidades), con ingresos/egresos, balance por producto y aviso de stock bajo por umbral (integrado al job de WhatsApp). Tablas `med_items` y `med_moves`. La dosificación la define el veterinario; Piara solo lleva inventario (no inventa criterios). Verificado: alta de producto, balance 380 ml (500−120), bloqueo de egreso negativo.
- **Movimientos entre galpones** — nueva pestaña "Movimientos". Traslados entre galpones, ventas y bajas; actualiza en transacción el conteo `animals` de cada galpón y deja historial trazable con autor. Tabla `animal_moves`. Verificado: traslado 50 Recría→Engorde (600→550 / 900→950), y bloqueo si se intenta mover más animales de los que hay (409).

**Estado general:** auditoría completa cerrada + las 5 features nuevas (stock alimento, umbrales ITH, roles, stock medicamentos, movimientos) implementadas y verificadas por HTTP **y por chequeo visual en navegador (Chrome)**: se recorrieron todas las vistas nuevas, se probó un ingreso de alimento en vivo (0→3000 kg) y la consola quedó sin errores. 29/29 tests pasan. Único pendiente conocido: `iniciar.bat` corre `seed` en cada arranque (idempotente, inofensivo).

**Recordatorio de producción:** `NODE_ENV=production` + `PIARA_SECRET` + `TZ=America/Argentina/Buenos_Aires`.

**Antes de producción es imprescindible:** deployar con `NODE_ENV=production` + `PIARA_SECRET`, y fijar `TZ=America/Argentina/Buenos_Aires` en el server.

## Ideas futuras (no bloquean)

- Opción de monograma SVG para reemplazar el 🐖 si se quiere un branding más sobrio.
- Fase 2 mencionada en el panel: imágenes multiespectrales (Satellogic) para pasturas y NDVI.
- Revisión full stack (backend, seguridad, API) — pedida, aún no realizada.
