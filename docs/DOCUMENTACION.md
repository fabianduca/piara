# Piara — Documentación completa y reporte de estado

**Producto:** Piara — Inteligencia climática y de gestión para criaderos porcinos.
**Versión:** 0.1.0 (MVP funcional, ampliado)
**Última actualización:** 16 de julio de 2026
**Estado general:** Funcional de punta a punta, con auditoría full stack aplicada y cinco módulos
nuevos (stock de alimento, stock de medicamentos, movimientos entre galpones, roles y umbrales
ITH configurables). Listo para piloto. Antes de exponerlo a Internet como producto pago requiere
los pasos de la sección 12 (`NODE_ENV=production` + `PIARA_SECRET` + `TZ`).

---

## 1. Para qué sirve

Piara previene pérdidas y mejora el rendimiento en criaderos de cerdos. El cerdo **no
transpira**, por lo que es muy sensible al calor; la industria mide el estrés con el **ITH
(Índice Temperatura-Humedad)**, no con la temperatura sola. Piara toma el clima en vivo,
calcula el ITH por galpón según la categoría animal, y convierte el pronóstico en **alertas
anticipadas con acciones concretas**. Además ordena la producción, la reproducción, el agua, la
sanidad y el stock (alimento y medicamentos) en un solo lugar.

**Modelo de negocio:** suscripción de **USD 200/mes** por establecimiento. Se justifica con el
ROI: un solo galpón de engorde puede perder ~USD 147 en un día de calor; evitando 2-3 días de
estrés al mes, la suscripción ya se pagó.

**Mercado inicial:** zona porcina de San Andrés de Giles y criaderos chicos y medianos de la cuenca.

## 2. Qué hace (funcionalidades)

| Módulo | Qué previene / aporta |
|---|---|
| **Panel (clima + ITH)** | Estrés térmico, frío en lechones, lluvia/anegamiento. ITH por galpón, pronóstico 48 h, optimizador de alimentación, impacto económico evitable. Umbrales **configurables por criadero**. |
| **Producción** | Ganancia diaria (ADG), índice de conversión (IC/FCR), mortandad, proyección de faena y pérdida vs. objetivo por lote. |
| **Reproducción** | Calendario de cerdas: servicio → parto (gestación 114 días) → destete. Impide dos ciclos activos para la misma cerda. |
| **Agua** | Detección de caída del consumo — la señal más temprana de enfermedad o calor. |
| **Sanidad** | Plan de vacunación con vencimientos y avisos; plan sugerido por categoría. |
| **Stock de alimento** | Inventario en kg por establecimiento; carga **manual o automática** (descuento desde el alimento de cada lote); aviso de stock bajo. |
| **Stock de medicamentos** | Inventario por producto (dosis/ml/frascos/unidades); ingresos/egresos; aviso de stock bajo. |
| **Movimientos** | Traslados entre galpones, ventas y bajas; actualizan el conteo de animales de cada galpón. |
| **Comparar (benchmark)** | Tabla que ordena galpones/lotes por rendimiento y pérdida. |
| **Sensores** | Alta de dispositivos (ESP32/LoRa) con API key; ingesta validada de temperatura, humedad y agua. Incluye simulador. |
| **Avisos** | Notificaciones WhatsApp de alertas severas y stock bajo (Twilio enchufable; sin credenciales quedan en bandeja). |
| **Equipo (roles)** | Usuarios por criadero con rol dueño / veterinario / operario. |
| **Satélite / suelo** | Humedad de suelo (Open-Meteo) para riesgo de anegamiento. |

## 3. Stack técnico

- **Backend:** Node.js (**≥ 22**) + Express 4.
- **Base de datos:** SQLite mediante el módulo nativo `node:sqlite` (sin dependencias nativas ni
  compilación — importante en Windows). Archivo `piara.db`. Migraciones idempotentes en `db.js`.
- **Frontend:** SPA en HTML + CSS + JavaScript vanilla (sin framework ni build step).
- **Autenticación:** JWT (`jsonwebtoken`) + hash de contraseñas con `bcryptjs`. Multi-tenant
  (un criadero = un tenant) + **roles** (dueño/veterinario/operario).
- **Servicios externos:** Open-Meteo (clima y humedad de suelo, gratis, sin API key);
  Twilio (WhatsApp, opcional).
- **Motores de dominio compartidos** (Node + navegador): ITH, producción, reproducción, agua,
  sanidad — en `src/shared/`.
- **Dependencias:** solo `express`, `bcryptjs`, `jsonwebtoken`.

## 4. Estructura del proyecto

```
agricola/
  server.js                 Express: headers de seguridad + API + estáticos (whitelist) + 2 jobs
  package.json              Scripts: start, seed, simulate, test
  iniciar.bat               Arranque por doble clic (Windows); carga twilio.bat si existe
  index.html                SPA (login + 11 vistas)
  src/
    styles.css              Estilos (responsive, tema oscuro estilo macOS)
    app.js                  Lógica del frontend (auth, render, formularios, gateo por rol)
    shared/
      ith.js                Motor ITH + riesgo de suelo (umbrales configurables)
      production.js         ADG, IC/FCR, mortandad, proyección, pérdida
      repro.js              Gestación 114d, partos, destete
      water.js              Consumo de agua (caída = alerta temprana)
      health.js             Plan sanitario / vacunación
    backend/
      db.js                 SQLite nativo + esquema + migraciones
      auth.js               JWT, bcrypt, roles, API keys de dispositivos
      weather.js            Ingesta Open-Meteo (con offset horario correcto)
      service.js            Arma el dashboard + escaneo de avisos de fondo
      routes.js             Endpoints REST
      notify.js             Notificaciones (Twilio + bandeja)
  tools/
    seed.js                 Criadero demo
    sensor-simulator.js     Simulador de sensores
    test-ith.js             29 tests de los motores
  docs/
    DOCUMENTACION.md        Este documento
    ESTADO.md               Bitácora de estado / cambios
    PROPUESTA.md            Propuesta comercial + ROI + guion de venta
    DEPLOY.md               Cómo correr y desplegar
```

> Nota: `src/config.js` (umbrales duplicados de referencia) fue **eliminado** — la fuente única
> de verdad de los umbrales es `src/shared/ith.js`.

## 5. Modelo de datos (SQLite)

`tenants`, `users` (con `role`), `sites` (con `feed_low_kg`, `feed_auto`), `sheds`, `devices`,
`sensor_readings`, `weather_snapshots`, `alerts` (con `resolved`, `resolved_at`, `resolved_by`),
`tenant_settings` (con `ith_comfort/alert/emergency`), `notifications`, `batches`, `matings`,
`water_readings`, `health_events` (estas cuatro con `created_by`), y las nuevas:
**`feed_moves`**, **`med_items`**, **`med_moves`**, **`animal_moves`**.
Relaciones con claves foráneas y `ON DELETE CASCADE`.

## 6. API (endpoints principales)

- **Auth:** `POST /api/auth/register`, `POST /api/auth/login` (con rate limiting).
- **Panel:** `GET /api/sites`, `GET /api/sites/:id/dashboard`.
- **Galpones:** `GET/POST /api/sites/:id/sheds`.
- **Producción:** `GET /api/sites/:id/production`, `POST /api/sheds/:id/batches`,
  `POST /api/batches/:id/update`, `POST /api/batches/:id/close`.
- **Reproducción:** `GET /api/sites/:id/repro`, `POST /api/sheds/:id/matings`,
  `POST /api/matings/:id/farrow`, `POST /api/matings/:id/wean`.
- **Agua:** `GET /api/sites/:id/water`, `POST /api/sheds/:id/water`.
- **Sanidad:** `GET /api/sites/:id/health`, `POST /api/sheds/:id/health`, `POST /api/health/:id/done`.
- **Alimento:** `GET /api/sites/:id/feed`, `POST /api/sites/:id/feed/move`, `POST /api/sites/:id/feed/config` (owner).
- **Medicamentos:** `GET /api/sites/:id/meds`, `POST /api/sites/:id/meds/item`, `POST /api/meds/:itemId/move`.
- **Movimientos:** `GET /api/sites/:id/movements`, `POST /api/sites/:id/movements`.
- **Alertas:** `GET /api/sites/:id/alerts`, `POST /api/alerts/:id/resolve`.
- **Sensores:** `GET /api/sites/:id/devices`, `POST /api/sheds/:id/devices`, `POST /api/ingest` (auth por API key, con validación de rango).
- **Cuenta / config:** `GET /api/account`, `POST /api/account/whatsapp` (owner), `POST /api/account/thresholds` (owner).
- **Equipo (owner):** `GET/POST /api/users`, `POST /api/users/:id/role`, `DELETE /api/users/:id`.
- **Avisos:** `GET /api/notifications`, `POST /api/notifications/test`.

Todas las rutas (salvo `register`/`login` e `ingest`) exigen JWT y filtran por tenant. La
configuración sensible y la gestión de equipo exigen rol `owner`.

## 7. Cómo se usa

### Arranque rápido (Windows)
Doble clic en **`iniciar.bat`**: instala dependencias la primera vez, crea el criadero demo,
abre el navegador y deja el servidor corriendo. Login demo: `demo@piara.com` / `demo1234`.

### A mano
```bash
npm install
npm run seed        # criadero demo
npm start           # http://localhost:3000
```

### Demostrar sin hardware
```bash
npm run simulate    # simula un sensor a ~33°C -> dispara alerta de calor
```

### Contrato de sensores (hardware)
```
POST /api/ingest
Header: x-api-key: pk_xxxx      (se genera al dar de alta el sensor)
Body:   { "temp": 27.4, "humidity": 68 }         # clima interior
        { "water_l": 4200 }                       # caudalímetro
```
Las lecturas fuera de rango físico (temp −30..55, humedad 0..100) se rechazan.

## 8. Variables de entorno

| Variable | Obligatoria | Para qué |
|---|---|---|
| `NODE_ENV=production` | **Sí en prod** | Junto con `PIARA_SECRET`, el server aborta si el secreto no está configurado. |
| `PIARA_SECRET` | **Sí en prod** | Clave para firmar los JWT. Con el valor de desarrollo, se pueden forjar tokens. |
| `TZ=America/Argentina/Buenos_Aires` | Recomendada | Sin esto, en un server UTC los horarios de alimentación salen desfasados 3 h. |
| `PORT` | No (default 3000) | Puerto del servidor. |
| `PIARA_DB` | No | Ruta del archivo SQLite. |
| `PIARA_TWILIO_SID` / `PIARA_TWILIO_TOKEN` / `PIARA_TWILIO_FROM` | No | Activar WhatsApp real. |

## 9. Testing

- **Suite de motores:** `npm test` → **29/29 OK** (ITH, suelo, producción, reproducción, agua, sanidad).
- **Chequeo de sintaxis:** `node --check` sobre los 17 archivos JS → todos OK.
- **Verificación funcional:** todos los módulos nuevos (stock, meds, movimientos, roles,
  umbrales) probados por HTTP contra el server real.
- No hay linter/typecheck ni build step (proyecto JS vanilla).
- **Pendiente:** chequeo visual en navegador (Playwright / extensión de Chrome no disponibles en
  las sesiones de desarrollo; todo lo demás verificado a nivel API y código).

## 10. Historial de QA y auditoría

### Primera QA (8/7/2026) — corregido
XSS almacenado en el nombre del criadero (escapado con `esc()`), listeners duplicados por login,
fugas de intervalos del reloj, desborde responsive del menú, validación server-side de registro,
favicon/SEO. Archivos basura de shell eliminados.

### Auditoría full stack (16/7/2026) — corregido y verificado
- **CRÍTICO — exposición de archivos:** `express.static(__dirname)` servía `piara.db` y el código
  del backend (con el JWT secret). Reemplazado por whitelist de assets del frontend.
- **CRÍTICO — JWT secret:** el server aborta en `NODE_ENV=production` sin `PIARA_SECRET`.
- **CRÍTICO — ingesta de sensores:** validación de rango físico (rechaza `temp:9999`, etc.).
- **ALTO — rate limiting** en login/registro (fuerza bruta).
- **ALTO — integridad de datos:** validación numérica y de fecha en lotes, agua, etc.; una cerda
  no puede tener dos ciclos activos.
- **ALTO — ciclo de vida de alertas:** auto-resolución al desaparecer la condición + endpoint de
  resolución manual (con autor y fecha).
- **ALTO — zona horaria:** los timestamps de Open-Meteo llevan el offset real; los horarios de
  alimentación no dependen de la TZ del server.
- **ALTO — trazabilidad de autoría:** `created_by` en lotes, servicios, agua y sanidad.
- **MEDIO — GET idempotentes:** los avisos de repro/agua/sanidad se movieron a un job de fondo.
- **MEDIO — headers de seguridad:** CSP, X-Frame-Options, nosniff, Referrer-Policy.
- **BAJO — código muerto:** eliminado `src/config.js`.

### Verificado y correcto
Aislamiento multi-tenant (cada criadero solo ve lo suyo), escapado de salida en el DOM,
permisos por rol (operario recibe 403 en config y 200 al cargar datos), responsive sin desbordes.

## 11. Riesgos y limitaciones conocidas

- **`PIARA_SECRET` de desarrollo:** debe definirse en producción (el código lo fuerza).
- **Zona horaria:** fijar `TZ` en el server de producción.
- **SQLite:** excelente para uno o pocos establecimientos; para escala grande, migrar a Postgres
  (el código de datos está aislado en `db.js`).
- **Cobro de la suscripción:** el estado del plan es informativo; falta integrar pasarela.
- **WhatsApp:** requiere cuenta de Twilio para envío real (sin ella, los avisos quedan en la app).
- **Dosificación / criterios sanitarios:** los define el veterinario; Piara solo lleva inventario
  y calendario (no inventa umbrales veterinarios).
- **Chequeo visual en navegador:** pendiente (ver sección 9).

## 12. Recomendaciones antes de publicar

1. `NODE_ENV=production` + `PIARA_SECRET` largo y secreto (el server lo exige).
2. `TZ=America/Argentina/Buenos_Aires`.
3. Desplegar en un host con HTTPS (Render/Railway/Fly) y configurar backups de `piara.db`.
4. Dar de alta el equipo con sus roles.
5. Integrar la pasarela de pago para la suscripción.
6. Conectar Twilio para WhatsApp real.
7. Correr el chequeo visual en navegador cuando esté disponible.

## 13. Qué falta / roadmap

- **Producto:** cobro de suscripción (Mercado Pago / Stripe); stock de medicamentos ligado a la
  aplicación de eventos sanitarios (hoy es manual); exportación de reportes (PDF/Excel).
- **Fase 2:** imágenes satelitales multiespectrales (NDVI, estado de pasturas).
- **Fase 3:** control automático de ventilación/nebulización; predicción de ganancia de peso con
  histórico; app móvil nativa.

---

*Documento de estado. Acompaña a `README.md` (uso), `ESTADO.md` (bitácora), `PROPUESTA.md`
(comercial) y `DEPLOY.md` (despliegue).*
