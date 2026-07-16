/* Piara — simulador de sensores. Da de alta un sensor en el primer galpon del criadero demo
 * (o usa una API key pasada por argumento) y postea lecturas realistas cada pocos segundos.
 *
 * Uso:
 *   node tools/sensor-simulator.js                 (auto: crea sensor en galpon Engorde A del demo)
 *   node tools/sensor-simulator.js pk_ABC... 32 70 (usa esa api_key, apunta a ~32C / 70% humedad)
 */
const path = require("path");
const db = require(path.join("..", "src", "backend", "db"));
const auth = require(path.join("..", "src", "backend", "auth"));

const PORT = process.env.PORT || 3000;
const BASE = `http://localhost:${PORT}`;

let apiKey = process.argv[2];
const targetTemp = Number(process.argv[3]) || 33;      // simulamos ola de calor por defecto
const targetHum = Number(process.argv[4]) || 72;

if (!apiKey) {
  // Buscar galpon de engorde del criadero demo; si no hay device, crear uno.
  const shed = db.prepare("SELECT id, name FROM sheds WHERE category='engorde' ORDER BY id LIMIT 1").get();
  if (!shed) { console.error("No hay galpones. Corré primero: npm run seed"); process.exit(1); }
  let dev = db.prepare("SELECT * FROM devices WHERE shed_id = ? LIMIT 1").get(shed.id);
  if (!dev) {
    apiKey = auth.newApiKey();
    db.prepare("INSERT INTO devices (shed_id, name, api_key) VALUES (?, ?, ?)").run(shed.id, "Sensor simulado", apiKey);
    console.log(`Sensor creado en galpón "${shed.name}".`);
  } else {
    apiKey = dev.api_key;
    console.log(`Usando sensor existente en galpón "${shed.name}".`);
  }
}
console.log(`API key: ${apiKey}`);
console.log(`Simulando ~${targetTemp}°C / ${targetHum}% cada 5 s. Ctrl+C para cortar.\n`);

async function post() {
  const temp = round1(targetTemp + (Math.sin(Date.now() / 60000) * 1.5) + (Math.random() - 0.5));
  const humidity = round1(targetHum + (Math.random() - 0.5) * 4);
  try {
    const res = await fetch(`${BASE}/api/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ temp, humidity }),
    });
    const data = await res.json().catch(() => ({}));
    console.log(res.ok ? `→ enviado ${temp}°C / ${humidity}%` : `✗ ${res.status} ${JSON.stringify(data)}`);
  } catch (e) {
    console.error("✗ ¿Está corriendo el server (npm start)?", e.message);
  }
}
function round1(v) { return Math.round(v * 10) / 10; }

post();
setInterval(post, 5000);
