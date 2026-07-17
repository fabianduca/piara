# Piara — cómo ponerla a andar y publicarla

## Opción 1 — Doble clic (lo más fácil, para demos)

Hacé doble clic en **`iniciar.bat`**. Esa ventana:
1. Verifica que tengas Node.js **≥ 22** (si no, te dice de dónde bajarlo).
2. Instala lo necesario la primera vez.
3. Carga (si existe) un `twilio.bat` con las credenciales de WhatsApp.
4. Crea el criadero demo.
5. Abre el navegador en `http://localhost:3000`.

Login: **demo@piara.com** / **demo1234**. Para apagar, cerrá esa ventana negra.

> Requiere Node.js **22 o superior** porque Piara usa el SQLite nativo del runtime
> (`node:sqlite`) — cero dependencias nativas, no compila nada en Windows.

## Opción 2 — Mostrarla en el celular (misma red WiFi)

Sirve para llevar el celular/tablet a un criadero con la notebook prendida en la misma WiFi
(o un router/hotspot). Al arrancar, Piara imprime algo así:

```
  En esta PC:        http://localhost:3000
  Desde el celular:  http://192.168.0.15:3000   (misma red WiFi)
```

Desde el celular, abrí esa dirección (el número puede variar).

> Si no abre: es el **Firewall de Windows**. La primera vez que corras `node`, Windows pregunta
> si permitís el acceso a la red — marcá **"Redes privadas"** y **Permitir acceso**.

## Opción 3 — En Internet (producción)

Es una app Node estándar (`npm start`), así que corre en **Render / Railway / Fly.io** (deploy
directo desde el repo de GitHub) o un **VPS** chico (DigitalOcean, Hetzner) con Node ≥ 22.

### Variables de entorno

| Variable | Obligatoria | Para qué |
|---|---|---|
| `NODE_ENV=production` | **Sí (prod)** | Activa el modo producción. Junto con `PIARA_SECRET`, el server aborta si el secreto no está configurado. |
| `PIARA_SECRET` | **Sí (prod)** | Clave para firmar los logins (JWT). Poné algo largo y aleatorio. **Con el valor de desarrollo cualquiera puede forjar un token y entrar a cualquier criadero.** |
| `TZ=America/Argentina/Buenos_Aires` | **Recomendada** | Sin esto, en un servidor en UTC los horarios del optimizador de alimentación y el "en ~X h" de las alertas salen desfasados 3 h. |
| `PORT` | No | Puerto (muchos hosts lo fijan solos; por defecto 3000). |
| `PIARA_DB` | Recomendada | Ruta del archivo de base de datos, para que persista fuera del directorio de la app. |
| `PIARA_TWILIO_SID` / `PIARA_TWILIO_TOKEN` / `PIARA_TWILIO_FROM` | No | Activar WhatsApp real (si no, los avisos quedan en la app). |

> **Importante:** en `NODE_ENV=production` sin `PIARA_SECRET`, el proceso **no arranca** a
> propósito. Es una salvaguarda: define siempre el secreto antes de publicar.

### Ejemplo (Linux/VPS)

```bash
export NODE_ENV=production
export PIARA_SECRET="una-clave-larga-y-aleatoria-que-nadie-conozca"
export TZ="America/Argentina/Buenos_Aires"
export PIARA_DB="/var/lib/piara/piara.db"
npm install --omit=dev
node tools/seed.js      # solo la primera vez, si querés datos demo
npm start
```

En Render/Railway/Fly.io: cargá esas variables en el panel del servicio y apuntá el comando de
inicio a `npm start`. El HTTPS lo dan ellos.

### Checklist antes de cobrarle a un cliente

- [ ] `NODE_ENV=production` + `PIARA_SECRET` fuerte definidos.
- [ ] `TZ` de Argentina fijada.
- [ ] Servir por **HTTPS** (Render/Railway lo dan solo).
- [ ] **Backups** del archivo `piara.db` (guarda todos los datos del criadero).
- [ ] Dar de alta los usuarios del equipo con su **rol** (dueño / veterinario / operario) desde la pestaña *Avisos → Equipo*.
- [ ] Cobro de la suscripción (Mercado Pago / Stripe) — hoy el estado del plan es informativo.

## Seguridad — qué ya trae

- Login con JWT + contraseñas hasheadas (bcrypt) y **roles** por usuario.
- **Rate limiting** en login/registro (frena fuerza bruta).
- **Validación de entradas**: rangos físicos en sensores, números y fechas en cargas manuales.
- **Headers de seguridad** (CSP, X-Frame-Options, nosniff) y **whitelist de estáticos** (no se
  sirve la base de datos ni el código del backend por HTTP).
- Aislamiento **multi-tenant**: cada criadero solo ve sus propios datos.

## Prueba rápida sin criador

Con el server corriendo, en otra terminal:

```bash
npm run simulate     # simula un sensor a 33 °C -> dispara alerta de calor
npm test             # corre los 29 tests de los motores
```
