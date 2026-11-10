# Hash Harvest Tycoon

Tycoon incremental de criptominería en pixel art 16-bit (React + TypeScript + Canvas 2D).
Montas rigs físicos en racks, gestionas calor y potencia, haces overclock en una BIOS retro,
operas en un terminal CRT y reinicias con **The Halving** para ganar Smart Contracts.

```bash
npm install
npm run dev        # servidor de cuentas (:8787) + frontend con proxy /api → :8787
# por separado: npm run dev:server y npm run dev:web
npm run typecheck  # tsc del frontend y del servidor
npm run build      # typecheck + build de producción en dist/
npm start          # build + un solo proceso que sirve dist/ y la API
npm test           # tests unitarios (Vitest)
npm run test:e2e   # test E2E con Playwright (requiere build)
npm run test:all   # build + unitarios + E2E
```

En `.claude/agents/` hay agentes de Claude Code para este proyecto (features, pixel art, balance, QA y seguridad). Ver `CLAUDE.md`.

Requiere Node ≥ 22.18 (usa `node:sqlite` y ejecuta TypeScript sin compilar).

## Cuentas y suscripción (Miner Pass)

- **Cuentas:** email y contraseña (hash scrypt), sesiones con token aleatorio guardado como SHA-256 y caducidad de 30 días, y límite de intentos de login.
- **Miner Pass:** $2.99/mes o $24.99/año. Desbloquea el guardado en la nube, con sincronización cada 3 min y al salir de la pestaña. Descargar una partida ya guardada es gratis aunque la suscripción caduque.
- **Conflictos:** cada guardado tiene un número de revisión. Si otro dispositivo guardó antes, el juego pregunta qué progreso conservar.
- **Pagos:** se cobra con Stripe Checkout y se gestiona en el Billing Portal. El webhook se verifica con su firma y es idempotente. Copia `.env.example` a `.env` y rellena las variables `STRIPE_*`. Configura el webhook en `https://TU_DOMINIO/api/billing/webhook` con los eventos `checkout.session.completed` y `customer.subscription.*`.
- **Verificación de email y recuperación de contraseña:** registrarse crea la cuenta sin verificar y envía un enlace de un solo uso (24 h, guardado como SHA-256). Hasta abrirlo no se puede iniciar sesión (`403 email_not_verified`, solo tras acertar la contraseña); `POST /api/auth/resend` reenvía el enlace. `POST /api/auth/forgot` envía un enlace de restablecimiento (1 h, un solo uso, el nuevo invalida los anteriores) y `POST /api/auth/reset` fija la contraseña y cierra todas las sesiones. Registro, reenvío y «olvidé mi contraseña» responden siempre igual exista o no la cuenta (202), así que no se puede averiguar qué emails están registrados; el resultado solo llega por correo. Las cuentas anteriores a esta función cuentan como verificadas, y las no verificadas se borran a los 7 días.
- **Correo saliente (`MAIL_MODE`):** `log` (por defecto fuera de producción) imprime cada email, enlaces incluidos, en la consola del servidor y añade un `devLink` a las respuestas para poder probar sin buzón. `http` hace `POST` JSON (`from`, `to`, `subject`, `text`) a `MAIL_API_URL` con `Authorization: Bearer MAIL_API_KEY`, compatible con APIs tipo Resend; requiere `MAIL_API_URL`, `MAIL_API_KEY` y `MAIL_FROM`. Con `NODE_ENV=production` el servidor se niega a arrancar sin `MAIL_MODE=http`, y `devLink` nunca se devuelve.
- **Límites por IP y `TRUST_PROXY`:** el login, el registro, el reenvío y el «olvidé mi contraseña» se limitan por IP del cliente, y además cada dirección recibe como máximo 3 correos por hora y tipo (el resto se omiten en silencio). Como el registro ya no revela si un email existe, no hace falta ningún tope especial para los emails ocupados y los registros nuevos no se bloquean entre sí salvo por el límite normal de 10 por minuto y IP. Detrás de un proxy inverso, `TRUST_PROXY` debe ser el número **exacto** de proxies: si es menor, todos los usuarios comparten la IP del proxy y comparten también esos límites; si es mayor, un cliente puede falsear su IP para saltárselos.
- **Modo demo:** sin `STRIPE_SECRET_KEY`, suscribirse activa el pase al instante y sin cobrar, para desarrollo.
- **Datos:** SQLite en `DATA_DIR` (por defecto `./data`, excluido de git).

## Arquitectura

| Carpeta | Contenido |
| --- | --- |
| `src/types` | Interfaces de hardware, economía y jugador (`GameData` persistido) |
| `src/config` | Catálogos balanceados: GPUs/PSUs/coolers/racks, salas, árbol de prestigio, constantes |
| `src/engine` | `SpriteManager` (sprites procedurales cacheados + fuente bitmap 3×5) y `PixelCanvas` (viewport con escalado entero, partículas) |
| `src/store` | Zustand con slices (`hardware`, `rooms`, `market`, `economy`, `contracts`), persistencia versionada con migraciones, `gamePhysics.ts` (simulación pura) y `contracts.ts` (tablón de contratos, puro) |
| `src/workers` | `gameTick.worker.ts`: integra física y economía fuera del hilo principal |
| `src/hooks` | Bucle de juego (worker + fallback rAF + progreso offline), audio Web Audio procedural, animación pixel |
| `server` | API de cuentas: auth, facturación Stripe/demo y guardados en la nube (SQLite) |
| `src/services`, `src/store/useAccountStore.ts` | Cliente de la API, sesión y sincronización con la nube |
| `src/components` | Vista de sala, ensamblaje de racks, BIOS, mercado CRT, tienda, halving, paneles |

**Modelo térmico:** `ΔT = ((Q_gen − Q_dis) / C) · Δt`, con `Q_dis = k · (T − T_amb)`. Se integra de forma
analítica, `T = T_eq + (T − T_eq)·e^(−kΔt/C)`, para que sea estable con pasos grandes (pestaña en segundo plano o progreso offline).
Throttling al 50 % por encima de 85 °C, apagado a 95 °C y desgaste del silicio del 1 %/min por encima de 88 °C.

**Contratos:** un tablón de 3 encargos con plazo, generados según tu hashrate, ingresos y GPUs
(minar N $CC, llegar a X H/s, mantener todos los chips bajo Y °C durante Z min, tener N GPUs de tier ≥ T funcionando,
encontrar bloques en solitario, aguantar un evento de red sin apagados térmicos, beneficio realizado y beneficio de bots).
El progreso se calcula en el hilo principal a partir de lo que devuelve cada tick de la simulación, así que reclamar o
cambiar un contrato nunca choca con un tick en curso. Los objetivos de dinero solo cuentan beneficio realizado sobre el
coste de las monedas (comprar y vender no suma) y los $CC solo cuentan si se minan. El tiempo offline suma de forma
proporcional hasta el plazo, pero reinicia la racha de "bajo X °C" y anula el evento que se estaba vigilando.
Los contratos completados no caducan. Se puede cambiar uno cada 3 min por unos 2 min de ingresos. The Halving reparte un tablón nuevo.

**Guardado:** autoguardado en localStorage cada 2 s. Las exportaciones son JSON en Base64 firmado con SHA-256;
las partidas manipuladas se rechazan al importarlas.
