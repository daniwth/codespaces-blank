import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * GET /api/cards
 * Fetches all cards associated with the logged-in user's bank account.
 */
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const userAccount = await prisma.bankAccount.findFirst({
      where: { userId: session.user.id },
    });

    if (!userAccount) {
      return NextResponse.json({ error: 'Bank account not found' }, { status: 404 });
    }

    const cards = await prisma.card.findMany({
      where: { accountId: userAccount.id },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(cards);

  } catch (error) {
    console.error('Failed to fetch cards:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * POST /api/cards
 * Creates a new virtual card for the logged-in user.
 */
export async function POST(request: Request) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const userAccount = await prisma.bankAccount.findFirst({
            where: { userId: session.user.id },
        });

        if (!userAccount) {
            return NextResponse.json({ error: 'Bank account not found' }, { status: 404 });
        }

        // Simulate generating a unique, realistic-looking PAN.
        // Using a simple random approach for this mock.
        const pan_part_1 = Math.floor(1000 + Math.random() * 9000);
        const pan_part_2 = Math.floor(1000 + Math.random() * 9000);
        const pan_part_3 = Math.floor(1000 + Math.random() * 9000);
        const fullPan = `4242${pan_part_1}${pan_part_2}${pan_part_3}`;

        const newCard = await prisma.card.create({
            data: {
                accountId: userAccount.id,
                // In a real system, this would be a token from a processor like Stripe/Marqeta.
                // We simulate a unique token.
                token: `tok_${crypto.randomUUID()}`,
                maskedPan: `**** **** **** ${fullPan.slice(-4)}`,
                // This would be a securely stored seed for a CVV generation algorithm.
                cvvDynamicSeed: crypto.randomUUID(),
                expiryMonth: (new Date().getMonth() + 1), // JS months are 0-indexed
                expiryYear: (new Date().getFullYear() + 3),
                status: 'ACTIVE',
                isDisposable: false,
            }
        });

        return NextResponse.json(newCard, { status: 201 });

    } catch (error) {
        console.error('Failed to create card:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
