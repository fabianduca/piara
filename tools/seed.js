/* Piara — carga un criadero demo con galpones reales de la zona, para probar sin cargar nada a mano.
 * Uso: npm run seed   (crea usuario demo@piara.com / demo1234) */
const path = require("path");
const db = require(path.join("..", "src", "backend", "db"));
const auth = require(path.join("..", "src", "backend", "auth"));

const SHEDS = [
  { name: "Maternidad 1", category: "lechon", animals: 240, note: "Lechones lactantes" },
  { name: "Gestación", category: "cerda", animals: 180, note: "Cerdas gestantes" },
  { name: "Engorde A", category: "engorde", animals: 900, note: "Capones 50-110 kg" },
  { name: "Engorde B", category: "engorde", animals: 850, note: "Capones 30-60 kg" },
  { name: "Recría", category: "recria", animals: 600, note: "Post-destete" },
];

const email = "demo@piara.com";
const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
if (existing) {
  console.log("El usuario demo ya existe. Login: demo@piara.com / demo1234");
  process.exit(0);
}

const tx = db.transaction(() => {
  const t = db.prepare("INSERT INTO tenants (name, sub_status) VALUES (?, 'active')").run("Criadero San Andrés de Giles");
  const tid = t.lastInsertRowid;
  db.prepare("INSERT INTO users (tenant_id, email, pass_hash) VALUES (?, ?, ?)")
    .run(tid, email, auth.hashPassword("demo1234"));
  const s = db.prepare("INSERT INTO sites (tenant_id, name, lat, lon) VALUES (?, ?, ?, ?)")
    .run(tid, "Establecimiento Giles Centro", -34.4458, -59.4460);
  const sid = s.lastInsertRowid;
  const ins = db.prepare("INSERT INTO sheds (site_id, name, category, animals, note) VALUES (?, ?, ?, ?, ?)");
  for (const sh of SHEDS) ins.run(sid, sh.name, sh.category, sh.animals, sh.note);
  return { sid };
});
const { sid } = tx();

console.log("✅ Criadero demo creado.");
console.log("   Login:  demo@piara.com  /  demo1234");
console.log("   Site ID:", sid, "· 5 galpones cargados.");
console.log("   Arrancá el server (npm start) y entrá a http://localhost:3000");
