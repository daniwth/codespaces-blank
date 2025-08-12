import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

const prisma = new PrismaClient();

// We use z.coerce to ensure query params that are strings are converted to numbers
const searchParamsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  type: z.enum(['CREDIT', 'DEBIT']).optional(),
  // You can extend this with more filters
  // e.g., startDate: z.string().optional(),
  // e.g., endDate: z.string().optional(),
});

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const queryParams = Object.fromEntries(searchParams.entries());

  const parsedParams = searchParamsSchema.safeParse(queryParams);

  if (!parsedParams.success) {
    return NextResponse.json({ error: 'Invalid query parameters', details: parsedParams.error.flatten() }, { status: 400 });
  }

  const { page, limit, type } = parsedParams.data;
  const skip = (page - 1) * limit;

  try {
    const userAccount = await prisma.bankAccount.findFirst({
      where: { userId: session.user.id },
    });

    if (!userAccount) {
      return NextResponse.json({ error: 'Bank account not found' }, { status: 404 });
    }

    const whereClause: any = {
      accountId: userAccount.id,
    };
    if (type) {
      whereClause.type = type;
    }
    // Add date filtering logic here if startDate/endDate are present

    const [transactions, total] = await prisma.$transaction([
      prisma.transaction.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.transaction.count({ where: whereClause }),
    ]);

    const pageCount = Math.ceil(total / limit);

    return NextResponse.json({
      data: transactions,
      pagination: {
        total,
        page,
        limit,
        pageCount,
      },
    });

  } catch (error) {
    console.error('Failed to fetch transactions:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
