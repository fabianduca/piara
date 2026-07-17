# 🐖 Piara

**Inteligencia climática y productiva para criaderos porcinos.** Previene pérdidas por estrés
térmico, frío, lluvias y mala ventana de alimentación, y ordena la producción, reproducción,
sanidad, agua y stock del criadero. Pensada para la zona porcina de San Andrés de Giles,
plan **USD 200/mes**.

Convierte el pronóstico del clima en **alertas anticipadas y acciones concretas por galpón**,
calculando el **ITH (Índice Temperatura-Humedad)** — la métrica que la industria usa porque el
cerdo no transpira y es muy sensible al calor.

> App full stack autocontenida: **Node + Express + SQLite nativo + SPA vanilla**, sin build ni
> dependencias nativas. Con doble clic en `iniciar.bat` levanta todo (base de datos incluida).

---

## Qué hace

**Clima y ambiente**
- 🌡️ **ITH por galpón** ajustado a la categoría (lechón, recría, engorde, cerda), con umbrales **configurables por criadero**.
- ⚠️ **Alertas anticipadas** de estrés térmico (con horas de aviso), lluvia/anegamiento y frío en maternidad, cada una con **acciones recomendadas**.
- 🌾 **Optimizador de alimentación**: marca las horas frescas para no perder ganancia de peso.
- 🔥 **Horas de estrés térmico pronosticadas** (48 h) y 💰 **impacto económico evitable** en vivo.
- 🛰️ **Clima real + humedad de suelo** vía Open-Meteo (gratis, sin API key).

**Producción y manejo**
- 📊 **Rendimiento por lote**: ganancia diaria (ADG), índice de conversión (IC/FCR), mortandad, proyección de faena y pérdida vs. objetivo.
- 🐷 **Calendario reproductivo**: servicio → parto (gestación 114 d) → destete, con aviso de partos inminentes.
- 💧 **Consumo de agua**: detecta caídas — la señal más temprana de enfermedad o calor. Manual o por caudalímetro.
- 💉 **Plan sanitario / vacunación** con vencimientos y plan sugerido por categoría.
- 🌾 **Stock de alimento (kg)**: inventario por establecimiento, carga **manual o automática** (descuento desde el alimento de cada lote), aviso de stock bajo.
- 💊 **Stock de medicamentos** por producto (dosis/ml/frascos), con aviso de stock bajo.
- 🔀 **Movimientos de animales** entre galpones (traslados, ventas, bajas) que actualizan el conteo de cada galpón.
- 📈 **Comparar galpones y lotes**: benchmarking de ITH, estrés, ADG, conversión, mortandad y pérdida.

**Plataforma**
- 👥 **Multi-tenant** (una cuenta por criadero) con **roles**: dueño, veterinario y operario.
- 📲 **Avisos por WhatsApp** de alertas severas (Twilio enchufable; sin credenciales quedan en la app).
- 📡 **Sensores opcionales** por galpón (ESP32/LoRa) con ingesta por API key. Incluye simulador.
- 🔒 Seguridad: JWT + bcrypt, rate limiting, validación de entradas, CSP y whitelist de estáticos.

---

## Cómo correrlo

**Windows — la forma más fácil:** doble clic en **`iniciar.bat`**. Instala lo necesario, crea el
demo, abre el navegador y deja el server corriendo.

**A mano** (requiere [Node.js **≥ 22**](https://nodejs.org) — se usa el SQLite nativo del runtime, sin compilar nada):

```bash
npm install            # instala dependencias (express, bcryptjs, jsonwebtoken)
npm run seed           # crea un criadero demo con 5 galpones reales
npm start              # levanta el server en http://localhost:3000
```

Entrá a **http://localhost:3000** y logueá con:

```
Email:      demo@piara.com
Contraseña: demo1234
```

### Ver una alerta de estrés térmico sin hardware

Con el server corriendo, en otra terminal:

```bash
npm run simulate       # simula un sensor a ~33 °C en un galpón de engorde
```

### Tests del motor

```bash
npm test               # 29 tests: fórmula ITH, umbrales, alertas, producción, repro, agua, sanidad
```

---

## Arquitectura

```
server.js                 Express: headers de seguridad + API + estáticos (whitelist) + jobs
src/
  shared/                 Motores de dominio (corren en Node y en el browser):
    ith.js                  ITH, severidad, alertas, alimentación, economía (umbrales configurables)
    production.js           Rendimiento: ADG, IC/FCR, mortandad, proyección, pérdida
    repro.js                Reproducción: gestación 114 d, partos, destete
    water.js                Consumo de agua (caídas = alerta temprana)
    health.js               Plan sanitario / vacunación
  backend/
    db.js                   SQLite nativo (node:sqlite) — esquema multi-tenant + migraciones
    auth.js                 JWT + bcrypt + roles + API keys de dispositivos
    weather.js              Ingesta Open-Meteo (temp, humedad, lluvia, suelo — 48 h)
    service.js              Arma el dashboard y corre el escaneo de avisos de fondo
    routes.js               Endpoints REST (auth, dominio, stock, roles, config)
  app.js / styles.css     Frontend SPA (login + 11 vistas)
tools/
  seed.js                 Criadero demo
  sensor-simulator.js     Simulador de sensores
  test-ith.js             Tests de los motores
docs/
  DEPLOY.md               Cómo ponerla a andar y publicarla
  ESTADO.md               Estado técnico detallado (features, auditoría, pendientes)
  PROPUESTA.md            Propuesta comercial + ROI
```

### Contrato de ingesta de sensores (para el hardware)

```
POST /api/ingest
Header: x-api-key: pk_xxxxxxxx      (se genera al dar de alta el sensor en la app)
Body:   { "temp": 27.4, "humidity": 68 }        # también acepta { "water_l": 4200 }
```

Cualquier ESP32/Arduino con un DHT22/SHT31 puede postear cada pocos minutos. Las lecturas fuera
de rango físico (temp −30..55, humedad 0..100) se rechazan para no ensuciar los datos.

---

## Puesta en producción

La app está pensada para publicarse en Render / Railway / Fly.io o un VPS chico. **Antes de
exponerla a Internet con datos reales es imprescindible** (ver [`docs/DEPLOY.md`](docs/DEPLOY.md)):

- `NODE_ENV=production` **y** `PIARA_SECRET` con una clave fuerte — el proceso **no arranca** sin
  esto en producción (evita que se puedan forjar tokens).
- `TZ=America/Argentina/Buenos_Aires` — si no, los horarios de alimentación salen desfasados.
- HTTPS (lo dan Render/Railway) y backups de `piara.db`.

### Activar WhatsApp real (Twilio)

Sin credenciales, los avisos quedan en el historial de la app. Para enviar al WhatsApp del
productor, definí antes de arrancar:

```
PIARA_TWILIO_SID=ACxxxx
PIARA_TWILIO_TOKEN=xxxx
PIARA_TWILIO_FROM=whatsapp:+14155238886
```

---

## Roles

| Rol | Puede |
|---|---|
| **Dueño** (owner) | Todo: configuración (WhatsApp, umbrales ITH, stock), gestión de equipo, y carga de datos. |
| **Veterinario** | Cargar datos (sanidad, reproducción, etc.). No cambia configuración ni equipo. |
| **Operario** | Cargar datos operativos del día. No cambia configuración ni equipo. |

---

## Modelo de negocio

Ver [`docs/PROPUESTA.md`](docs/PROPUESTA.md): evitando 2–3 días de estrés térmico al mes, la
suscripción de USD 200 ya se paga. Un solo galpón de engorde puede perder ~USD 147 en un día de calor.

---

*Datos climáticos en vivo vía Open-Meteo. Umbrales ITH basados en literatura porcina (INTA,
produccion-animal.com.ar, porcinews) y ajustables por criadero. Los criterios sanitarios y de
dosificación los define el veterinario; Piara lleva el inventario y el calendario.*
