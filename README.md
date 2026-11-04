# Hash Harvest Tycoon

Tycoon incremental de criptominería en pixel art 16-bit (React + TypeScript + Canvas 2D).
Montas rigs físicos en racks, gestionas calor y potencia, haces overclock en una BIOS retro,
operas en un terminal CRT y reinicias con **The Halving** para ganar Smart Contracts.

```bash
npm install
npm run dev        # servidor de desarrollo
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + build de producción en dist/
```

## Arquitectura

| Carpeta | Contenido |
| --- | --- |
| `src/types` | Interfaces de hardware, economía y jugador (`GameData` persistido) |
| `src/config` | Catálogos balanceados: GPUs/PSUs/coolers/racks, salas, árbol de prestigio, constantes |
| `src/engine` | `SpriteManager` (sprites procedurales cacheados + fuente bitmap 3×5) y `PixelCanvas` (viewport con escalado entero, partículas) |
| `src/store` | Zustand con slices (`hardware`, `rooms`, `market`, `economy`), persistencia versionada con migraciones y `gamePhysics.ts` (simulación pura) |
| `src/workers` | `gameTick.worker.ts`: integra física y economía fuera del hilo principal |
| `src/hooks` | Bucle de juego (worker + fallback rAF + progreso offline), audio Web Audio procedural, animación pixel |
| `src/components` | Vista de sala, ensamblaje de racks, BIOS, mercado CRT, tienda, halving, paneles |

**Modelo térmico:** `ΔT = ((Q_gen − Q_dis) / C) · Δt`, con `Q_dis = k · (T − T_amb)`. Se integra de forma
analítica, `T = T_eq + (T − T_eq)·e^(−kΔt/C)`, para que sea estable con pasos grandes (pestaña en segundo plano o progreso offline).
Throttling al 50 % por encima de 85 °C, apagado a 95 °C y desgaste del silicio del 1 %/min por encima de 88 °C.

**Guardado:** autoguardado en localStorage cada 2 s. Las exportaciones son JSON en Base64 firmado con SHA-256;
las partidas manipuladas se rechazan al importarlas.
