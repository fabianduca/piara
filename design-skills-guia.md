# Skills de diseño para Claude Code — Guía de uso para agentes

Referencia para que los agentes de Ruflo (y cualquier sesión de Claude Code) sepan cuándo invocar cada una de las tres skills de diseño instaladas globalmente en `C:\Users\fabia\.claude\skills\`. Copiar este bloque dentro del `CLAUDE.md` de cada proyecto (Solo Patagonia, Fun Patagonia, 2 Matas, sitio personal) donde se trabaje frontend.

---

## Skills instaladas (alcance global, todos los proyectos)

### 1. Impeccable Design — `pbakaus/impeccable`
**Qué hace:** establece un "sistema de diseño" de referencia para el proyecto y lo hace cumplir. 23 comandos (`/impeccable init`, `/audit`, `/polish`, `/critique`, `/animate`, `/harden`, etc.) más detección de anti-patrones típicos de IA (Inter/system fonts para todo, gradiente morado-azul, cards anidadas en cards, texto gris sobre fondos de color, íconos en tile redondeado arriba de cada título).

**Cuándo invocarla:**
- Al arrancar cualquier proyecto o sección nueva de frontend → `/impeccable init` (genera `PRODUCT.md` y opcionalmente `DESIGN.md` con audiencia, marca, colores, tipografía).
- Auditoría de algo ya construido (ej. una landing de Todo Glaciares, el cotizador, una sección de funpatagonia.com) → `/impeccable audit <sección>`.
- Antes de dar por cerrada una entrega → `/impeccable polish <sección>`.
- Revisión de experiencia de usuario → `/impeccable critique <sección>`.

**Buen ejemplo de uso en tu contexto:** después de tocar el theme Flatsome de WooCommerce o las páginas de EGA Futura, correr `/impeccable audit` antes de dar por terminado el cambio.

### 2. Emil Kowalski — Design Engineering — `emilkowalski/skills`
**Qué hace:** reglas de animación y microinteracciones basadas en su curso animations.dev. Timings concretos (botones/hovers 100–160ms, dropdowns 150–250ms, modales 200–500ms), easing correcto (ease-out para entradas, nunca ease-in), y cuándo NO animar (acciones que el usuario repite más de 100 veces por día).

**Cuándo invocarla:**
- Cualquier tarea que incluya transiciones, estados hover, animaciones de entrada/salida, modales, toasts, o el mode 3D/Three.js del juego "Expedición Glaciares".
- Al revisar código de UI que ya tiene animaciones, para detectar easing mal aplicado o timings excesivos.

**Buen ejemplo de uso en tu contexto:** al retomar el bug de renderizado en Windows/Chrome de "Expedición Glaciares", o al pulir las transiciones del cotizador (`/presupuestos/`).

### 3. Taste Skill — `Leonxlnx/taste-skill`
**Qué hace:** pasada final anti-"look genérico de IA" con tres perillas ajustables — `DESIGN_VARIANCE` (layout más o menos asimétrico), `MOTION_INTENSITY` (hover simple vs. scroll/magnético), `VISUAL_DENSITY` (espacioso vs. denso). Incluye variante `redesign-existing-projects` para auditar antes de tocar algo que ya existe.

**Cuándo invocarla:**
- Última pasada antes de publicar una landing o sección nueva, para confirmar que no se ve "vibe-coded" o genérica.
- Al rediseñar algo existente (ej. la sección B2B de agencias de Fun Patagonia) → usar la variante de redesign primero para auditar, después implementar.

---

## Orden recomendado cuando se combinan las tres

1. **Impeccable** → define el sistema de diseño y corrige estructura/anti-patrones (`init` → `audit`/`polish`).
2. **Emil Kowalski** → agrega motion y microinteracciones sobre esa base ya prolija.
3. **Taste Skill** → pasada final para asegurar que el resultado no se vea genérico.

No son alternativas entre sí — Impeccable pone el vocabulario y las reglas, Emil resuelve el movimiento, Taste hace el ajuste fino de estilo. Usar las tres en secuencia en vez de una sola.

## Notas de instalación
- Las tres están instaladas de forma **global** (`~/.claude/skills/` → `C:\Users\fabia\.claude\skills\`), por lo que aplican automáticamente en cualquier proyecto sin necesidad de instalarlas de nuevo en cada carpeta.
- Para actualizar: `npx impeccable update` (Impeccable) o repetir el comando `npx skills add ...` para las otras dos.
- Son skills de terceros, no oficiales de Anthropic — si algo se comporta raro, revisar el `SKILL.md` correspondiente en `~/.claude/skills/<nombre>/SKILL.md`.
