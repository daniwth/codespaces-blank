import { PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { USD_PER_CRD } from '../src/lib/constants';

const prisma = new PrismaClient();

async function main() {
  console.log('Start seeding ...');

  // --- Clean up existing data ---
  // In a real-world scenario, you might want more sophisticated cleanup
  // but for a seed script, this is usually fine.
  console.log('Deleting existing data...');
  await prisma.transfer.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.bankAccount.deleteMany();
  await prisma.kycProfile.deleteMany();
  await prisma.user.deleteMany();
  // TODO: Add other models to cleanup as they are implemented (Loans, Cards, etc.)

  // --- Create Admin User ---
  console.log('Creating admin user...');
  const adminPassword = await bcrypt.hash('Admin1234!', 10);
  const admin = await prisma.user.create({
    data: {
      email: 'admin@creditox.test',
      name: 'Admin User',
      passwordHash: adminPassword,
      role: UserRole.ADMIN,
      emailVerified: new Date(),
    },
  });

  // --- Create Customer 1: Ana ---
  console.log('Creating customer Ana...');
  const anaPassword = await bcrypt.hash('Ana1234!', 10);
  const ana = await prisma.user.create({
    data: {
      email: 'ana@creditox.test',
      name: 'Ana García',
      passwordHash: anaPassword,
      role: UserRole.CUSTOMER,
      emailVerified: new Date(),
      kycProfile: {
        create: {
          firstName: 'Ana',
          lastName: 'García',
          status: 'VERIFIED',
          dateOfBirth: new Date('1990-05-15T00:00:00Z'),
          addressLine1: 'Calle Ficticia 123',
          city: 'Madrid',
          state: 'Madrid',
          postalCode: '28001',
          country: 'ES',
          documentType: 'PASSPORT',
          documentId: 'A12345678',
        }
      }
    },
  });
  const anaAccount = await prisma.bankAccount.create({
    data: {
      userId: ana.id,
      balance_cCRD: 500000, // 5,000.00 CRD
    },
  });
  await prisma.transaction.createMany({
    data: [
      { accountId: anaAccount.id, type: 'CREDIT', amount_cCRD: 1000000, amount_usd_cents_derived: Math.round(10000 * 100 * USD_PER_CRD), fxRateAtTime: USD_PER_CRD, category: 'SALARY', description: 'Nómina Enero', status: 'COMPLETED', completedAt: new Date() },
      { accountId: anaAccount.id, type: 'DEBIT', amount_cCRD: 300000, amount_usd_cents_derived: Math.round(3000 * 100 * USD_PER_CRD), fxRateAtTime: USD_PER_CRD, category: 'RENT', description: 'Alquiler Febrero', status: 'COMPLETED', completedAt: new Date() },
      { accountId: anaAccount.id, type: 'DEBIT', amount_cCRD: 200000, amount_usd_cents_derived: Math.round(2000 * 100 * USD_PER_CRD), fxRateAtTime: USD_PER_CRD, category: 'UTILITIES', description: 'Factura Electricidad', status: 'COMPLETED', completedAt: new Date() },
    ]
  });

  // --- Create Customer 2: Luis ---
  console.log('Creating customer Luis...');
  const luisPassword = await bcrypt.hash('Luis1234!', 10);
  const luis = await prisma.user.create({
    data: {
      email: 'luis@creditox.test',
      name: 'Luis Martínez',
      passwordHash: luisPassword,
      role: UserRole.CUSTOMER,
      emailVerified: new Date(),
      kycProfile: {
        create: {
            firstName: 'Luis',
            lastName: 'Martínez',
            status: 'PENDING',
            dateOfBirth: new Date('1985-11-20T00:00:00Z'),
            addressLine1: 'Avenida Imaginaria 456',
            city: 'Barcelona',
            state: 'Barcelona',
            postalCode: '08001',
            country: 'ES',
            documentType: 'DRIVERS_LICENSE',
            documentId: 'B87654321',
        }
      }
    },
  });
  const luisAccount = await prisma.bankAccount.create({
    data: {
      userId: luis.id,
      balance_cCRD: 1200000, // 12,000.00 CRD
    },
  });
   await prisma.transaction.create({
    data: { accountId: luisAccount.id, type: 'CREDIT', amount_cCRD: 1200000, amount_usd_cents_derived: Math.round(12000 * 100 * USD_PER_CRD), fxRateAtTime: USD_PER_CRD, category: 'INITIAL_DEPOSIT', description: 'Depósito inicial', status: 'COMPLETED', completedAt: new Date() },
  });

  // --- Create a transfer between them ---
  console.log('Creating a transfer from Luis to Ana...');
  const transferAmount = 50000;
  await prisma.$transaction([
    // Debit Luis
    prisma.bankAccount.update({
      where: { id: luisAccount.id },
      data: { balance_cCRD: { decrement: transferAmount } },
    }),
    // Credit Ana
    prisma.bankAccount.update({
      where: { id: anaAccount.id },
      data: { balance_cCRD: { increment: transferAmount } },
    }),
    // Create transfer record
    prisma.transfer.create({
      data: {
        fromAccountId: luisAccount.id,
        toAccountId: anaAccount.id,
        amount_cCRD: transferAmount,
        status: 'COMPLETED',
        completedAt: new Date(),
      }
    }),
    // Create transaction records
    prisma.transaction.create({
      data: { accountId: luisAccount.id, type: 'DEBIT', amount_cCRD: transferAmount, amount_usd_cents_derived: Math.round(500 * 100 * USD_PER_CRD), fxRateAtTime: USD_PER_CRD, category: 'TRANSFER', description: 'Transferencia a Ana García', status: 'COMPLETED', completedAt: new Date() }
    }),
    prisma.transaction.create({
      data: { accountId: anaAccount.id, type: 'CREDIT', amount_cCRD: transferAmount, amount_usd_cents_derived: Math.round(500 * 100 * USD_PER_CRD), fxRateAtTime: USD_PER_CRD, category: 'TRANSFER', description: 'Transferencia de Luis Martínez', status: 'COMPLETED', completedAt: new Date() }
    })
  ]);

  console.log('Seeding finished successfully.');
}

main()
  .catch((e) => {
    console.error('An error occurred during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
