/* Piara — servidor Express: sirve el frontend + API + job de clima. */
const path = require("path");
const os = require("os");
const express = require("express");
const db = require("./src/backend/db");
const routes = require("./src/backend/routes");
const weather = require("./src/backend/weather");
const service = require("./src/backend/service");

const app = express();
const PORT = process.env.PORT || 3000;

// Headers de seguridad (sin dependencias). CSP: todo desde el mismo origen;
// 'unsafe-inline' en style porque el frontend setea atributos style= en runtime
// (alturas de barras, etc.); data: en img por el favicon SVG embebido.
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; connect-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'");
  next();
});

app.use(express.json({ limit: "256kb" }));
app.use("/api", routes);

// Frontend estatico — WHITELIST explicita. NO se sirve la raiz del proyecto
// (antes `express.static(__dirname)` exponia piara.db, el codigo del backend con
// el JWT secret, package.json, etc. por HTTP). Solo los assets que usa la SPA.
app.use("/src/shared", express.static(path.join(__dirname, "src", "shared")));
app.get("/src/app.js", (_req, res) => res.sendFile(path.join(__dirname, "src", "app.js")));
app.get("/src/styles.css", (_req, res) => res.sendFile(path.join(__dirname, "src", "styles.css")));
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n  🐖  Piara corriendo`);
  console.log(`  En esta PC:        http://localhost:${PORT}`);
  const lan = lanIP();
  if (lan) console.log(`  Desde el celular:  http://${lan}:${PORT}   (misma red WiFi)`);
  console.log("");
  startWeatherJob();
  startDomainNotifyJob();
});

// Devuelve la primera IPv4 de red local (para entrar desde el celular en la misma WiFi).
function lanIP() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces || []) {
      if (i.family === "IPv4" && !i.internal) return i.address;
    }
  }
  return null;
}

// Job: refresca el clima de todos los sites cada 15 min (y una vez al arrancar).
function startWeatherJob() {
  const run = async () => {
    const sites = db.prepare("SELECT * FROM sites").all();
    for (const site of sites) {
      try { await weather.refreshSite(site); }
      catch (e) { console.warn(`  [clima] ${site.name}: ${e.message}`); }
    }
    if (sites.length) console.log(`  [clima] actualizado ${sites.length} establecimiento(s) ${new Date().toLocaleTimeString()}`);
  };
  run();
  setInterval(run, 15 * 60 * 1000);
}

// Job: escanea avisos de dominio (repro/agua/sanidad) cada 30 min. Antes esto se
// disparaba como efecto secundario de los GET; ahora vive aca (dedup 12 h en notify).
function startDomainNotifyJob() {
  const run = () => {
    try { service.scanDomainNotifications(); }
    catch (e) { console.warn(`  [avisos] ${e.message}`); }
  };
  run();
  setInterval(run, 30 * 60 * 1000);
}
