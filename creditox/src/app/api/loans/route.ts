import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { toCentiCrd } from '@/lib/currency';

const prisma = new PrismaClient();

/**
 * GET /api/loans
 * Fetches all loans for the logged-in user.
 */
export async function GET(request: Request) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const loans = await prisma.loan.findMany({
            where: { userId: session.user.id },
            orderBy: { createdAt: 'desc' },
        });
        return NextResponse.json(loans);
    } catch (error) {
        console.error('Failed to fetch loans:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

const applyLoanSchema = z.object({
  amount: z.number().positive('El importe debe ser positivo.').max(50000, 'El importe máximo del préstamo es 50,000 CRD.'),
  termMonths: z.number().int().min(3, 'El plazo mínimo es de 3 meses.').max(60, 'El plazo máximo es de 60 meses.'),
});

/**
 * POST /api/loans
 * Allows a user to apply for a new loan.
 */
export async function POST(request: Request) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await request.json();
        const parsed = applyLoanSchema.safeParse(body);

        if (!parsed.success) {
            return NextResponse.json({ error: 'Datos de solicitud no válidos', details: parsed.error.flatten() }, { status: 400 });
        }

        const { amount, termMonths } = parsed.data;

        // --- Mock Pre-scoring Logic ---
        // In a real system, this would involve a complex credit check.
        // Here, we'll just approve if the amount is less than 20,000 CRD.
        const isApproved = amount < 20000;

        if (!isApproved) {
            // We could create the loan with a REJECTED status, but for this mock, we'll just deny.
            return NextResponse.json({ error: 'Solicitud de préstamo denegada tras la pre-evaluación.' }, { status: 400 });
        }

        const newLoan = await prisma.loan.create({
            data: {
                userId: session.user.id,
                principal_cCRD: BigInt(toCentiCrd(amount)),
                termMonths: termMonths,
                rateAPR: 0.05, // Fixed 5% APR for simplicity
                status: 'PENDING', // PENDING user acceptance of the offer
                scheduleType: 'FRENCH', // Default amortization schedule
            }
        });

        return NextResponse.json(newLoan, { status: 201 });

    } catch (error) {
        console.error('Failed to apply for loan:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
