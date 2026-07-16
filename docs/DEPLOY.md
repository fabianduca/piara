# Piara — cómo ponerla a andar y mostrarla

## Opción 1 — Doble clic (lo más fácil)

Hacé doble clic en **`iniciar.bat`**. Esa ventana:
1. Verifica que tengas Node.js (si no, te dice de dónde bajarlo).
2. Instala lo necesario la primera vez.
3. Crea el criadero demo.
4. Abre el navegador solo en `http://localhost:3000`.

Login: **demo@piara.com** / **demo1234**. Para apagar, cerrá esa ventana negra.

## Opción 2 — Mostrarla en el celular (misma red WiFi)

Sirve para llevar el celular/tablet a un criadero con la notebook prendida en la misma WiFi
(o un router/hotspot). Al arrancar, Piara imprime algo así:

```
  En esta PC:        http://localhost:3000
  Desde el celular:  http://192.168.0.15:3000   (misma red WiFi)
```

Desde el celular, abrí esa dirección `http://192.168.0.15:3000` (el número puede variar).

> Si no abre: es el **Firewall de Windows**. La primera vez que corras `node`, Windows pregunta
> si permitís el acceso a la red — marcá **"Redes privadas"** y **Permitir acceso**.

## Opción 3 — En Internet (para que entren desde cualquier lado)

Cuando tengas un criador pago, conviene subirla a un servidor para que entre desde el celular
sin depender de tu notebook. Es una app Node estándar (`npm start`), así que anda en:

- **Render / Railway / Fly.io** (planes gratuitos o baratos, deploy directo desde el repo).
- Un **VPS** chico (DigitalOcean, Hetzner) con Node instalado.

Antes de exponerla a Internet, configurá estas variables de entorno:

| Variable | Para qué |
|---|---|
| `PORT` | Puerto (muchos hosts lo fijan solos) |
| `PIARA_SECRET` | **Obligatorio**: clave para firmar los logins (poné algo largo y secreto) |
| `PIARA_DB` | Ruta del archivo de base de datos (para que persista) |
| `PIARA_TWILIO_SID` / `PIARA_TWILIO_TOKEN` / `PIARA_TWILIO_FROM` | Activar WhatsApp real |

### Pendientes recomendados antes de cobrarle a un cliente
- Cambiar `PIARA_SECRET` (hoy tiene un valor de desarrollo).
- Servir por **HTTPS** (Render/Railway lo dan solo).
- Backups del archivo `piara.db`.
- Cobro de la suscripción (Mercado Pago / Stripe) — hoy el estado del plan es informativo.

## Prueba rápida sin criador

Con el server corriendo, en otra terminal:

```
npm run simulate     # simula un sensor a 33°C -> dispara alerta de calor
npm test             # corre los 29 tests de los motores
```
