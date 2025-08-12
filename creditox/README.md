# CréditoX - Banco Digital Ficticio

Este repositorio contiene el código fuente completo para CréditoX, un proyecto full-stack de un banco digital ficticio. Ha sido construido para demostrar una arquitectura moderna de aplicaciones web utilizando Next.js, Prisma, y PostgreSQL.

## ✨ Características Principales

- **Banca Central:** Gestión de cuentas en CRD (créditos) y su equivalente en USD.
- **Autenticación Segura:** Registro, inicio de sesión, y preparación para 2FA con NextAuth.js.
- **Dashboard de Cliente:** Visualización de saldos y movimientos recientes.
- **Internacionalización (i18n):** Soporte para `es` (default) y `en`.
- **Modo Oscuro:** Tema claro y oscuro con cambio automático según el sistema.
- **Diseño Moderno:** Interfaz limpia y responsiva construida con TailwindCSS y shadcn/ui.

## 🛠️ Stack Tecnológico

- **Framework:** Next.js 14 (App Router)
- **Lenguaje:** TypeScript
- **Base de Datos:** PostgreSQL
- **ORM:** Prisma
- **Autenticación:** NextAuth.js
- **UI:** TailwindCSS + shadcn/ui
- **Validación:** Zod
- **Contenerización:** Docker

## 🚀 Cómo Empezar

Sigue estas instrucciones para levantar el proyecto en tu máquina local.

### Prerrequisitos

Asegúrate de tener instaladas las siguientes herramientas:

- [Node.js](https://nodejs.org/en/) (v18 o superior)
- [pnpm](https://pnpm.io/installation) (gestor de paquetes)
- [Docker](https://www.docker.com/products/docker-desktop/) y Docker Compose

---

### 1. Clonar el Repositorio

```bash
git clone <URL_DEL_REPOSITORIO>
cd creditox
```

### 2. Configurar Variables de Entorno

Copia el archivo de ejemplo `.env.example` para crear tu propio archivo `.env` local.

```bash
cp .env.example .env
```

Abre el archivo `.env` y genera una clave secreta para `NEXTAUTH_SECRET`. Puedes usar el siguiente comando y pegar el resultado en el archivo:

```bash
openssl rand -base64 32
```

### 3. Iniciar los Servicios de Backend

Usa Docker Compose para iniciar la base de datos PostgreSQL y el servidor de Redis en segundo plano.

```bash
docker compose up -d
```
El `-d` ejecuta los contenedores en modo "detached" (en segundo plano).

### 4. Instalar Dependencias y Preparar la Base de Datos

Este comando instalará todas las dependencias del proyecto, aplicará las migraciones de la base de datos para crear las tablas, y poblará la base de datos con datos de demostración.

```bash
pnpm install
pnpm prisma migrate dev
pnpm prisma db seed
```
> **Nota:** El comando `prisma migrate dev` creará la base de datos si no existe y aplicará todas las migraciones. El comando `prisma db seed` ejecutará el script en `prisma/seed.ts` para crear usuarios y datos de ejemplo.

### 5. Iniciar la Aplicación

Una vez que todo esté configurado, inicia el servidor de desarrollo de Next.js.

```bash
pnpm dev
```

### 6. ¡Listo!

La aplicación debería estar corriendo en [http://localhost:3000](http://localhost:3000).

Puedes iniciar sesión con las siguientes cuentas de demostración:

- **Usuario Administrador:**
  - **Email:** `admin@creditox.test`
  - **Contraseña:** `Admin1234!`
- **Cliente 1 (Verificado):**
  - **Email:** `ana@creditox.test`
  - **Contraseña:** `Ana1234!`
- **Cliente 2 (Pendiente de KYC):**
  - **Email:** `luis@creditox.test`
  - **Contraseña:** `Luis1234!`

---

## 🧪 Pruebas

(Las instrucciones para ejecutar las pruebas se añadirán aquí)

```bash
# Ejecutar pruebas unitarias
pnpm test

# Ejecutar pruebas end-to-end
pnpm test:e2e
```
