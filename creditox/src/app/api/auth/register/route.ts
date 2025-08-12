import { NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { USD_PER_CRD } from '@/lib/constants';

const prisma = new PrismaClient();

const registerUserSchema = z.object({
  email: z.string().email({ message: "El email no es válido." }),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres.'),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsedBody = registerUserSchema.safeParse(body);

    if (!parsedBody.success) {
      return NextResponse.json({ error: 'Datos no válidos', details: parsedBody.error.flatten() }, { status: 400 });
    }

    const { email, password } = parsedBody.data;

    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return NextResponse.json({ error: 'Ya existe un usuario con este email' }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // Create user and a bank account for them in a transaction
    const newUser = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          name: email.split('@')[0], // Default name from email
        },
      });

      // Create a default bank account for the new user
      await tx.bankAccount.create({
        data: {
          userId: user.id,
          balance_cCRD: 100000, // Give 1,000.00 CRD as a welcome bonus
        }
      });

      // Add a welcome transaction
      await tx.transaction.create({
        data: {
          accountId: (await tx.bankAccount.findFirst({ where: { userId: user.id } }))!.id,
          type: 'CREDIT',
          amount_cCRD: 100000,
          amount_usd_cents_derived: Math.round(1000 * 100 * USD_PER_CRD),
          fxRateAtTime: USD_PER_CRD,
          category: 'BONUS',
          description: 'Bono de bienvenida',
          status: 'COMPLETED',
        }
      });

      return user;
    });

    const { passwordHash: _, ...userWithoutPassword } = newUser;

    return NextResponse.json(userWithoutPassword, { status: 201 });

  } catch (error) {
    console.error('Error de registro:', error);
    return NextResponse.json({ error: 'Ha ocurrido un error inesperado' }, { status: 500 });
  }
}
