# Piara — Documentación completa y reporte de estado

**Producto:** Piara — Inteligencia climática y de gestión para criaderos porcinos.
**Versión:** 0.1.0 (MVP funcional)
**Fecha del informe:** 8 de julio de 2026
**Estado general:** Funcional de punta a punta. Listo para demostración y piloto controlado. Requiere unos pasos de endurecimiento antes de exponerlo a Internet como producto pago (detallados en la sección 12).

---

## 1. Para qué sirve

Piara previene pérdidas y mejora el rendimiento en criaderos de cerdos. El cerdo **no
transpira**, por lo que es muy sensible al calor; la industria mide el estrés con el **ITH
(Índice Temperatura-Humedad)**, no con la temperatura sola. Piara toma el clima en vivo,
calcula el ITH por galpón según la categoría animal, y convierte el pronóstico en **alertas
anticipadas con acciones concretas**. Además ordena la producción, la reproducción, el agua y
la sanidad en un solo lugar.

**Modelo de negocio:** suscripción de **USD 200/mes** por establecimiento. Se justifica con el
ROI: un solo galpón de engorde puede perder ~USD 147 en un día de calor; evitando 2-3 días de
estrés al mes, la suscripción ya se pagó.

**Mercado inicial:** zona porcina de San Andrés de Giles (Campos y Alimentos, INGACOT, Carnes
Porcinas Seleccionadas, Pacuca) y criaderos chicos y medianos de la cuenca.

## 2. Qué hace (funcionalidades)

| Módulo | Qué previene / aporta |
|---|---|
| **Panel (clima + ITH)** | Estrés térmico, frío en lechones, lluvia/anegamiento. ITH por galpón, pronóstico 48 h, optimizador de alimentación, impacto económico evitable. |
| **Producción** | Ganancia diaria (ADG), índice de conversión (IC/FCR), mortandad, proyección de faena y pérdida vs. objetivo por lote. |
| **Reproducción** | Calendario de cerdas: servicio → parto (gestación 114 días) → destete. Anticipa partos para preparar la maternidad. |
| **Agua** | Detección de caída del consumo — la señal más temprana de enfermedad o calor. |
| **Sanidad** | Plan de vacunación con vencimientos y avisos; plan sugerido por categoría. |
| **Comparar (benchmark)** | Tabla que ordena galpones/lotes por rendimiento y pérdida. |
| **Sensores** | Alta de dispositivos (ESP32/LoRa) con API key; ingesta de temperatura, humedad y agua. Incluye simulador. |
| **Avisos** | Notificaciones WhatsApp de alertas severas (Twilio enchufable; sin credenciales quedan en bandeja). |
| **Satélite / suelo** | Humedad de suelo (Open-Meteo) para riesgo de anegamiento. |

## 3. Stack técnico

- **Backend:** Node.js (≥18) + Express 4.
- **Base de datos:** SQLite mediante el módulo nativo `node:sqlite` (sin dependencias nativas
  ni compilación — importante en Windows). Archivo `piara.db`.
- **Frontend:** SPA en HTML + CSS + JavaScript vanilla (sin framework ni build step).
- **Autenticación:** JWT (`jsonwebtoken`) + hash de contraseñas con `bcryptjs`. Multi-tenant
  (un criadero = un tenant).
- **Servicios externos:** Open-Meteo (clima y humedad de suelo, gratis, sin API key);
  Twilio (WhatsApp, opcional).
- **Motores de dominio compartidos** (Node + navegador): ITH, producción, reproducción, agua,
  sanidad — en `src/shared/`.
- **Dependencias:** solo `express`, `bcryptjs`, `jsonwebtoken`. Sin dependencias pesadas.

## 4. Estructura del proyecto

```
agricola/
  server.js                 Express: sirve frontend + API + job de clima (cada 15 min)
  package.json              Scripts: start, seed, simulate, test
  iniciar.bat               Arranque por doble clic (Windows)
  index.html                SPA (login + 8 vistas)
  src/
    styles.css              Estilos (responsive, tema oscuro)
    app.js                  Lógica del frontend (auth, render, formularios)
    config.js               Categorías/umbrales de referencia
    shared/
      ith.js                Motor ITH + riesgo de suelo
      production.js         ADG, IC/FCR, mortandad, proyección, pérdida
      repro.js              Gestación 114d, partos, destete
      water.js              Consumo de agua (caída = alerta temprana)
      health.js             Plan sanitario / vacunación
    backend/
      db.js                 SQLite nativo + esquema
      auth.js               JWT, bcrypt, API keys de dispositivos
      weather.js            Ingesta Open-Meteo
      service.js            Arma el dashboard (clima + sensores + ITH)
      routes.js             Endpoints REST
      notify.js             Notificaciones (Twilio + bandeja)
  tools/
    seed.js                 Criadero demo
    sensor-simulator.js     Simulador de sensores
    test-ith.js             29 tests de los motores
  docs/
    DOCUMENTACION.md        Este documento
    PROPUESTA.md            Propuesta comercial + ROI + guion de venta
    DEPLOY.md               Cómo correr y desplegar
```

## 5. Modelo de datos (SQLite)

`tenants`, `users`, `sites`, `sheds`, `devices`, `sensor_readings`, `weather_snapshots`,
`alerts`, `tenant_settings`, `notifications`, `batches`, `matings`, `water_readings`,
`health_events`. Relaciones con claves foráneas y `ON DELETE CASCADE`.

## 6. API (endpoints principales)

- **Auth:** `POST /api/auth/register`, `POST /api/auth/login`.
- **Panel:** `GET /api/sites`, `GET /api/sites/:id/dashboard`.
- **Galpones:** `GET/POST /api/sites/:id/sheds`.
- **Producción:** `GET /api/sites/:id/production`, `POST /api/sheds/:id/batches`,
  `POST /api/batches/:id/update`, `POST /api/batches/:id/close`.
- **Reproducción:** `GET /api/sites/:id/repro`, `POST /api/sheds/:id/matings`,
  `POST /api/matings/:id/farrow`, `POST /api/matings/:id/wean`.
- **Agua:** `GET /api/sites/:id/water`, `POST /api/sheds/:id/water`.
- **Sanidad:** `GET /api/sites/:id/health`, `POST /api/sheds/:id/health`, `POST /api/health/:id/done`.
- **Sensores:** `GET /api/sites/:id/devices`, `POST /api/sheds/:id/devices`, `POST /api/ingest` (auth por API key).
- **Avisos:** `GET /api/account`, `POST /api/account/whatsapp`, `GET /api/notifications`, `POST /api/notifications/test`.

Todas las rutas (salvo `register`/`login` e `ingest`) exigen JWT y filtran por tenant.

## 7. Cómo se usa

### Arranque rápido (Windows)
Doble clic en **`iniciar.bat`**: instala dependencias la primera vez, crea el criadero demo,
abre el navegador y deja el servidor corriendo.

### A mano
```bash
npm install
npm run seed        # criadero demo: demo@piara.com / demo1234
npm start           # http://localhost:3000
```

### Desde el celular (misma WiFi)
Al arrancar, el servidor imprime una dirección tipo `http://192.168.x.x:3000`. Abrila desde el
celular en la misma red. Si no abre, permitir `node` en el Firewall de Windows (redes privadas).

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

## 8. Variables de entorno

| Variable | Obligatoria | Para qué |
|---|---|---|
| `PORT` | No (default 3000) | Puerto del servidor |
| `PIARA_SECRET` | **Sí en producción** | Clave para firmar los JWT. Hoy tiene un valor de desarrollo. |
| `PIARA_DB` | No | Ruta del archivo SQLite |
| `PIARA_TWILIO_SID` / `PIARA_TWILIO_TOKEN` / `PIARA_TWILIO_FROM` | No | Activar WhatsApp real |

## 9. Testing

- **Suite de motores:** `npm test` → **29/29 OK** (ITH, suelo, producción, reproducción, agua, sanidad).
- **Chequeo de sintaxis:** `node --check` sobre los 17 archivos JS → todos OK.
- **No hay linter ni typecheck configurados** (proyecto JS vanilla). No hay build step: el
  "build" es servir archivos estáticos, no hay nada que compilar.

## 10. Resultado del chequeo QA (8/7/2026)

### Errores encontrados y corregidos
1. **Archivos basura en la raíz** (17 archivos vacíos con nombres como `({`, `a.kpi`,
   `logout())` creados por una redirección accidental de shell). **Eliminados** con lista blanca.
2. **XSS almacenado:** el nombre del criadero se insertaba sin escapar en el `<select>` de
   sitios. **Corregido** (se escapa con `esc()`). Verificado en navegador: el payload
   `<img src=x onerror=alert(1)>` queda inerte (`&lt;img...&gt;`), no dispara `alert`.
3. **Listeners duplicados:** `enterApp()` reconectaba los eventos en cada login, provocando
   doble envío de formularios tras cerrar y volver a entrar. **Corregido** con un flag `wired`.
4. **Reloj con fugas de intervalos:** `startClock()` creaba un `setInterval` nuevo por login.
   **Corregido** (idempotente).
5. **Desborde responsive:** la barra de 8 botones podía generar scroll horizontal en mobile.
   **Corregido** (`flex-wrap` en el menú + `overflow-x: hidden` en el body). Verificado a 375 px:
   sin scroll horizontal ni elementos desbordados.
6. **Validación server-side de registro:** no se validaba el formato del email ni el largo de
   contraseña del lado servidor. **Agregado** (regex de email, mínimo de contraseña, tope de
   longitud del nombre).
7. **SEO/UX menor:** faltaban meta description, Open Graph y favicon (404 a `/favicon.ico`).
   **Agregados** (favicon SVG inline, sin peso extra).

### Verificado y correcto (sin cambios necesarios)
- **Consola del navegador:** 0 errores y 0 warnings en las 8 vistas.
- **Logs del servidor:** limpios; Open-Meteo responde y el ITH se calcula.
- **Rutas y navegación:** las 8 vistas cargan y renderizan; sin links rotos.
- **Estados vacíos:** cada vista muestra mensaje cuando no hay datos.
- **Estados de error:** login inválido y acceso sin token devuelven mensajes claros y 401.
- **Seguridad multi-tenant:** todas las rutas verifican pertenencia al tenant; la ingesta de
  sensores se autentica por API key.
- **Escapado de salida:** todas las inserciones de datos de usuario en el DOM usan `esc()` o
  `textContent`.
- **Responsive:** desktop, tablet y mobile (375 px) sin desbordes; el menú envuelve; las tablas
  anchas scrollean dentro de su contenedor.

## 11. Riesgos y limitaciones conocidas

- **Corre localmente:** hoy funciona en la PC del usuario; para acceso remoto real hay que
  desplegarlo (ver `docs/DEPLOY.md`).
- **`PIARA_SECRET` de desarrollo:** debe cambiarse antes de producción.
- **Sin HTTPS propio:** conviene delegarlo en el host (Render/Railway lo dan).
- **Sin rate-limiting** en login (riesgo de fuerza bruta) — aceptable para MVP, recomendado
  para producción.
- **SQLite:** excelente para uno o pocos establecimientos; para escala grande, migrar a
  Postgres (el código de datos está aislado en `db.js`).
- **Cobro de la suscripción:** el estado del plan es informativo; falta integrar pasarela
  (Mercado Pago / Stripe).
- **Imágenes satelitales multiespectrales (NDVI/pasturas):** están como fase futura; hoy la
  capa satelital cubre humedad de suelo.
- **WhatsApp:** requiere cuenta de Twilio para envío real; sin ella, los avisos quedan en la
  bandeja dentro de la app (comportamiento intencional).

## 12. Recomendaciones antes de publicar

1. Definir `PIARA_SECRET` con un valor largo y secreto.
2. Desplegar en un host con HTTPS (Render/Railway/Fly) y configurar backups de `piara.db`.
3. Sumar rate-limiting al login.
4. Integrar la pasarela de pago para la suscripción.
5. Conectar Twilio para WhatsApp real.
6. Opcional: agregar un linter (ESLint) para mantener calidad a medida que crezca el equipo.

## 13. Qué falta / roadmap

- **Fase 2:** imágenes satelitales multiespectrales (NDVI, estado de pasturas); avisos también
  por WhatsApp para producción y reproducción (hoy ya andan para clima, agua y sanidad).
- **Fase 3:** control automático de ventilación/nebulización (actuadores); predicción de
  ganancia de peso con histórico; app móvil nativa.
- **Operativo:** panel de administración, exportación de reportes (PDF/Excel), histórico de
  clima observado (no solo pronóstico).

---

*Documento generado como parte del chequeo QA final. Acompaña a `README.md` (uso),
`PROPUESTA.md` (comercial) y `DEPLOY.md` (despliegue).*
