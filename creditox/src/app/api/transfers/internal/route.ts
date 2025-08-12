import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { toCentiCrd, crdToUsd } from '@/lib/currency';
import { USD_PER_CRD } from '@/lib/constants';

const prisma = new PrismaClient();

const transferSchema = z.object({
  recipientEmail: z.string().email({ message: 'El email del destinatario no es válido.' }),
  amount: z.number().positive('El importe debe ser positivo.'),
  description: z.string().optional(),
});

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const senderId = session.user.id;

  try {
    const body = await request.json();
    const parsed = transferSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Datos no válidos', details: parsed.error.flatten() }, { status: 400 });
    }

    const { recipientEmail, amount, description } = parsed.data;
    const amount_cCRD = BigInt(toCentiCrd(amount));

    if (recipientEmail.toLowerCase() === session.user.email.toLowerCase()) {
      return NextResponse.json({ error: 'No te puedes enviar dinero a ti mismo.' }, { status: 400 });
    }

    // Use a transaction to ensure atomicity
    const result = await prisma.$transaction(async (tx) => {
      // 1. Get sender and recipient accounts, and lock the rows for update
      const senderAccount = await tx.bankAccount.findFirst({
        where: { userId: senderId },
      });

      if (!senderAccount) {
        throw new Error('No se encontró la cuenta de origen.');
      }

      const recipientUser = await tx.user.findUnique({ where: { email: recipientEmail } });

      if (!recipientUser) {
        throw new Error('Destinatario no encontrado.');
      }
      const recipientAccount = await tx.bankAccount.findFirst({ where: { userId: recipientUser.id } });

      if (!recipientAccount) {
        throw new Error('No se encontró la cuenta del destinatario.');
      }

      // 2. Check for sufficient funds
      if (senderAccount.balance_cCRD < amount_cCRD) {
        throw new Error('Fondos insuficientes.');
      }

      // 3. Perform balance updates
      const updatedSenderAccount = await tx.bankAccount.update({
        where: { id: senderAccount.id },
        data: { balance_cCRD: { decrement: amount_cCRD } },
      });
      const updatedRecipientAccount = await tx.bankAccount.update({
        where: { id: recipientAccount.id },
        data: { balance_cCRD: { increment: amount_cCRD } },
      });

      const amount_usd_cents_derived = BigInt(toCentiCrd(crdToUsd(amount)));
      const now = new Date();

      // 4. Create transaction records
      await tx.transaction.createMany({
        data: [
          {
            accountId: senderAccount.id, type: 'DEBIT', amount_cCRD, amount_usd_cents_derived,
            fxRateAtTime: USD_PER_CRD, category: 'TRANSFER', status: 'COMPLETED', completedAt: now,
            description: `Transferencia a ${recipientUser.name || recipientEmail}`,
          },
          {
            accountId: recipientAccount.id, type: 'CREDIT', amount_cCRD, amount_usd_cents_derived,
            fxRateAtTime: USD_PER_CRD, category: 'TRANSFER', status: 'COMPLETED', completedAt: now,
            description: `Transferencia de ${session.user.name || session.user.email}`,
          },
        ]
      });

      // 5. Create the transfer record
      await tx.transfer.create({
        data: {
          fromAccountId: senderAccount.id,
          toAccountId: recipientAccount.id,
          amount_cCRD,
          fee_cCRD: 0,
          status: 'COMPLETED',
          completedAt: now,
        }
      });

      return { success: true };
    });

    return NextResponse.json({ message: 'Transferencia realizada con éxito' }, { status: 200 });

  } catch (error: any) {
    // Catch specific, known errors from the transaction logic
    if (error instanceof Error && ['Fondos insuficientes', 'Destinatario no encontrado', 'No se encontró la cuenta de origen', 'No se encontró la cuenta del destinatario'].includes(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // Log unexpected errors
    console.error('Fallo en la transferencia:', error);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
