# Hash Harvest Tycoon

Tycoon incremental de criptominería en pixel art 16-bit (React + TypeScript + Canvas 2D).
Montas rigs físicos en racks, gestionas calor y potencia, haces overclock en una BIOS retro,
operas en un terminal CRT y reinicias con **The Halving** para ganar Smart Contracts.

```bash
npm install
npm run dev:server # servidor de cuentas en :8787 (terminal 1)
npm run dev        # frontend con proxy /api → :8787 (terminal 2)
npm run typecheck  # tsc del frontend y del servidor
npm run build      # typecheck + build de producción en dist/
npm start          # build + un solo proceso que sirve dist/ y la API
```

Requiere Node ≥ 22.18 (usa `node:sqlite` y ejecuta TypeScript sin compilar).

## Cuentas y suscripción (Miner Pass)

- **Cuentas:** email y contraseña (hash scrypt), sesiones con token aleatorio guardado como SHA-256 y caducidad de 30 días, y límite de intentos de login.
- **Miner Pass:** $2.99/mes o $24.99/año. Desbloquea el guardado en la nube, con sincronización cada 3 min y al salir de la pestaña. Descargar una partida ya guardada es gratis aunque la suscripción caduque.
- **Conflictos:** cada guardado tiene un número de revisión. Si otro dispositivo guardó antes, el juego pregunta qué progreso conservar.
- **Pagos:** se cobra con Stripe Checkout y se gestiona en el Billing Portal. El webhook se verifica con su firma y es idempotente. Copia `.env.example` a `.env` y rellena las variables `STRIPE_*`. Configura el webhook en `https://TU_DOMINIO/api/billing/webhook` con los eventos `checkout.session.completed` y `customer.subscription.*`.
- **Modo demo:** sin `STRIPE_SECRET_KEY`, suscribirse activa el pase al instante y sin cobrar, para desarrollo.
- **Datos:** SQLite en `DATA_DIR` (por defecto `./data`, excluido de git).

## Arquitectura

| Carpeta | Contenido |
| --- | --- |
| `src/types` | Interfaces de hardware, economía y jugador (`GameData` persistido) |
| `src/config` | Catálogos balanceados: GPUs/PSUs/coolers/racks, salas, árbol de prestigio, constantes |
| `src/engine` | `SpriteManager` (sprites procedurales cacheados + fuente bitmap 3×5) y `PixelCanvas` (viewport con escalado entero, partículas) |
| `src/store` | Zustand con slices (`hardware`, `rooms`, `market`, `economy`), persistencia versionada con migraciones y `gamePhysics.ts` (simulación pura) |
| `src/workers` | `gameTick.worker.ts`: integra física y economía fuera del hilo principal |
| `src/hooks` | Bucle de juego (worker + fallback rAF + progreso offline), audio Web Audio procedural, animación pixel |
| `server` | API de cuentas: auth, facturación Stripe/demo y guardados en la nube (SQLite) |
| `src/services`, `src/store/useAccountStore.ts` | Cliente de la API, sesión y sincronización con la nube |
| `src/components` | Vista de sala, ensamblaje de racks, BIOS, mercado CRT, tienda, halving, paneles |

**Modelo térmico:** `ΔT = ((Q_gen − Q_dis) / C) · Δt`, con `Q_dis = k · (T − T_amb)`. Se integra de forma
analítica, `T = T_eq + (T − T_eq)·e^(−kΔt/C)`, para que sea estable con pasos grandes (pestaña en segundo plano o progreso offline).
Throttling al 50 % por encima de 85 °C, apagado a 95 °C y desgaste del silicio del 1 %/min por encima de 88 °C.

**Guardado:** autoguardado en localStorage cada 2 s. Las exportaciones son JSON en Base64 firmado con SHA-256;
las partidas manipuladas se rechazan al importarlas.
