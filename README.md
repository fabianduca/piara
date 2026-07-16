# 🐖 Piara

**Inteligencia climática para criaderos porcinos.** Previene pérdidas por estrés térmico,
frío, lluvias y mala ventana de alimentación. Pensada para venderse a criadores de la zona
porcina de San Andrés de Giles a **USD 200/mes**.

Convierte el pronóstico del clima en **alertas anticipadas y acciones concretas por galpón**,
calculando el **ITH (Índice Temperatura-Humedad)** — la métrica que la industria usa porque
el cerdo no transpira y es muy sensible al calor.

## Qué hace

- 🌡️ **ITH por galpón** ajustado a la categoría (lechón, recría, engorde, cerda).
- ⚠️ **Alertas anticipadas** de estrés térmico (con horas de aviso), lluvia/anegamiento y frío en maternidad.
- ✅ **Acciones recomendadas** para cada alerta (ventilación, nebulizadores, cama seca, electrolitos…).
- 🌾 **Optimizador de alimentación**: marca las horas frescas para no perder ganancia de peso.
- 📊 **Seguimiento de rendimiento por lote**: ganancia diaria (ADG), índice de conversión (IC/FCR), mortandad, proyección de faena y pérdida vs. objetivo. El KPI que define la rentabilidad.
- 🐷 **Calendario reproductivo de cerdas**: servicio → parto (gestación 114 días) → destete. Anticipa partos y avisa para preparar la maternidad (lámparas, cama) y no perder lechones.
- 💧 **Registro de consumo de agua**: detecta la caída de consumo — la señal más temprana de enfermedad o calor, antes que cualquier síntoma. Manual o por caudalímetro.
- 💉 **Plan sanitario / vacunación**: agenda vacunas y tratamientos con vencimientos a la vista y aviso cuando algo se vence. Incluye plan sugerido por categoría.
- 📈 **Comparar galpones y lotes**: tabla de benchmarking (ITH, horas de estrés, ganancia diaria, conversión, mortandad, pérdida) para ver de un vistazo dónde se pierde plata.
- 🔥 **Horas de estrés térmico pronosticadas** por galpón (48 h): conecta el clima con la caída de rendimiento.
- 💰 **Impacto económico evitable** en pesos/dólares, en vivo, para justificar la suscripción.
- 🛰️ **Clima real + humedad de suelo** vía Open-Meteo (gratis, sin API key). Riesgo de anegamiento por saturación del suelo.
- 📲 **Avisos por WhatsApp** de alertas severas (proveedor Twilio enchufable; sin credenciales quedan en la bandeja de la app).
- 📡 **Sensores opcionales** por galpón (ESP32/LoRa) con ingesta por API key. Incluye simulador.
- 👥 **Cuentas por criadero** (multi-tenant, login con JWT).

## Cómo correrlo (Windows)

**La forma más fácil:** doble clic en **`iniciar.bat`** — instala lo necesario, crea el demo,
abre el navegador y deja el server corriendo. Para acceder desde el celular en la misma WiFi y
opciones de despliegue, ver [`docs/DEPLOY.md`](docs/DEPLOY.md).

**A mano** (requiere [Node.js 18+](https://nodejs.org)):

```bash
npm install            # instala dependencias
npm run seed           # crea un criadero demo con 5 galpones reales
npm start              # levanta el server en http://localhost:3000
```

Entrá a **http://localhost:3000** y logueá con:

```
Email:      demo@piara.com
Contraseña: demo1234
```

El panel muestra el clima real de San Andrés de Giles y calcula el ITH de cada galpón.

### Ver una alerta de estrés térmico en acción (sin hardware)

En otra terminal, con el server corriendo:

```bash
npm run simulate       # simula un sensor a ~33°C dentro de un galpón de engorde
```

En la vista **Sensores** vas a ver el sensor "online" y el galpón pasa a usar la lectura real
del sensor; si supera el umbral, aparece la alerta con recomendaciones.

### Tests del motor

```bash
npm test               # valida la fórmula ITH, umbrales, alertas y economía
```

## Arquitectura

```
server.js                 Express: sirve el frontend + API + job de clima (cada 15 min)
src/
  shared/ith.js           Motor ITH (fuente única de verdad, usado por back y front)
  shared/production.js    Motor de rendimiento (ADG, IC/FCR, mortandad, proyección, pérdida)
  shared/repro.js         Motor reproductivo (gestación 114d, partos, destete, prolificidad)
  shared/water.js         Motor de consumo de agua (caídas = alerta temprana)
  backend/
    db.js                 SQLite (better-sqlite3) — esquema multi-tenant
    auth.js               JWT + bcrypt + API keys de dispositivos
    weather.js            Ingesta Open-Meteo (temp, humedad, lluvia 48h)
    service.js            Arma el dashboard (clima + sensores + ITH + alertas)
    routes.js             Endpoints REST
  styles.css / app.js     Frontend SPA (login, dashboard, sensores)
  config.js               Categorías/umbrales de referencia
tools/
  seed.js                 Criadero demo
  sensor-simulator.js     Simulador de sensores
  test-ith.js             Tests del motor
docs/PROPUESTA.md         Propuesta comercial + ROI + guion de venta
```

### Contrato de ingesta de sensores (para el hardware)

```
POST /api/ingest
Header: x-api-key: pk_xxxxxxxx      (se genera al dar de alta el sensor en la app)
Body:   { "temp": 27.4, "humidity": 68 }
```

Cualquier ESP32/Arduino con un DHT22/SHT31 puede postear cada pocos minutos.

## Modelo de negocio

Ver [`docs/PROPUESTA.md`](docs/PROPUESTA.md): con evitar 2–3 días de estrés térmico al mes,
la suscripción de USD 200 ya se paga. Un solo galpón de engorde puede perder ~USD 147 en un
solo día de calor.

### Activar WhatsApp real (Twilio)

Sin credenciales, los avisos quedan en el historial de la app (bandeja de salida). Para enviar
al WhatsApp del productor, definí estas variables de entorno antes de `npm start`:

```
PIARA_TWILIO_SID=ACxxxx
PIARA_TWILIO_TOKEN=xxxx
PIARA_TWILIO_FROM=whatsapp:+14155238886
```

## Roadmap

- **Fase 2 (en curso):** capa satelital de suelo/anegamiento ✅ y avisos por WhatsApp ✅. Próximo: imágenes multiespectrales (NDVI, estado de pasturas).
- **Fase 3:** control automático de ventilación/nebulización, benchmarking entre galpones, predicción de ganancia de peso.

---

*MVP demostrativo. Datos climáticos en vivo vía Open-Meteo. Umbrales basados en literatura porcina (INTA, produccion-animal.com.ar, porcinews).*
