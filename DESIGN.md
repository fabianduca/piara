# Design

Sistema visual de Piara — estética Apple/HIG sobre tema oscuro. La única fuente de verdad de tokens es `src/styles.css` (`:root`); este documento la describe.

## Theme

Oscuro refinado, estilo macOS dark. Pensado para pantalla de galpón y celular de noche: fondos casi-negros neutros con un tinte mínimo hacia el verde de marca, superficies elevadas por sombra difusa (no por borde duro), hairlines a baja opacidad.

## Color

Estrategia: **Restrained** — neutros tintados + un solo acento (≤10% de la superficie).

| Token | Valor | Rol |
|---|---|---|
| `--bg` | `oklch(0.16 0.008 160)` | Fondo de página |
| `--surface` | `oklch(0.21 0.009 160)` | Paneles |
| `--surface-2` | `oklch(0.25 0.010 160)` | Superficie anidada (inputs, celdas) |
| `--ink` | `oklch(0.95 0.005 160)` | Texto principal |
| `--muted` | `oklch(0.72 0.012 160)` | Texto secundario (AA sobre surface) |
| `--accent` | `oklch(0.78 0.17 155)` | Acento único (verde sistema): acciones primarias, selección |
| `--hairline` | `oklch(1 0 0 / 0.09)` | Bordes 1px |

Semáforo semántico (información, no decoración) — tonos calibrados tipo iOS system colors, con variantes `-tint` (fondo al ~14% de alfa) y `-text` (legible sobre tint oscuro):

- `--ok` verde, `--warn` amarillo, `--danger` naranja, `--emergency` rojo.
- Las pills de severidad usan tint + texto del mismo matiz, nunca gris sobre color.

## Typography

Una sola familia: `-apple-system, "SF Pro Text", system-ui, "Segoe UI", Roboto, sans-serif`.

- Escala fija rem, ratio ~1.2: 11 / 13 / 15 (body) / 17 / 20 / 28 / 40px.
- Títulos de sección: 17px / 600 / tracking -0.01em.
- Valores numéricos (ITH, KPIs): 600–700 con `font-variant-numeric: tabular-nums`.
- Labels: 13px, color `--muted`. Nunca gris lavado sobre fondo de color.
- Display (valor del gauge): 40px / 700 / -0.02em.

## Spacing & Shape

- Escala de espaciado: 4 / 8 / 12 / 16 / 24 / 32. Gap entre secciones: 24px.
- Radios: `--r-sm: 12px` (celdas, inputs), `--r-md: 16px` (paneles, cards), `--r-lg: 20px` (hero, modales), pills a 999px.
- Sombras difusas multicapa en vez de bordes: `--shadow-1: 0 1px 2px rgb(0 0 0/.25), 0 8px 24px rgb(0 0 0/.25)`; elevación de alerta activa: `--shadow-2` más profunda con tinte semántico.

## Materials

Vidrio esmerilado (`backdrop-filter: blur(20px) saturate(1.4)` + fondo translúcido) **solo** en superficies persistentes/superpuestas: topbar sticky. No es material por defecto de paneles.

## Motion

- Ease-out siempre (`cubic-bezier(0.22, 1, 0.36, 1)` ~ ease-out-quint). Nunca ease-in, nunca bounce.
- Hover/estado: 120–160ms. Transición de vista/tab: 200ms crossfade. Entrada de alerta: 300ms fade + lift 8px.
- Motion comunica estado, no decoración. Sin secuencias de carga orquestadas.
- Todo con alternativa `prefers-reduced-motion: reduce`.

## Components

- **Gauge ITH**: anillo conic con track tenue + arco de color de severidad, valor tabular 40px al centro. JS solo setea `--gauge-color` y `--gauge-pct`.
- **Pills de severidad** (`.sev-0..3`): tint + texto del matiz, radio 999px, siempre con etiqueta de texto.
- **Alertas**: fondo tintado del color semántico + título en color; sin side-stripe. La más severa se eleva con `--shadow-2`.
- **Tira horaria** (`.feed-h`): celdas radio 12px, hover con lift sutil.
- **Botones**: primary = acento relleno; ghost = hairline. Estados default/hover/focus-visible/active/disabled completos.
- **Íconos**: SVG inline estilo SF Symbols, stroke 1.5px, 18px, color `--muted`. Nada de emojis como sistema de íconos.
