import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { PrismaClient } from "@prisma/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, fromCentiCrd, crdToUsd } from "@/lib/currency";
import { redirect } from "next/navigation";

const prisma = new PrismaClient();

async function getAccountData(userId: string) {
  try {
    const bankAccount = await prisma.bankAccount.findFirst({
      where: { userId },
      include: {
        transactions: {
          orderBy: {
            createdAt: 'desc',
          },
          take: 5,
        },
      },
    });
    return bankAccount;
  } catch (error) {
    console.error("Database Error:", error);
    return null;
  }
}

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    // This should theoretically be handled by the layout, but as a safeguard:
    redirect('/login');
  }

  const account = await getAccountData(session.user.id);

  if (!account) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Error de Cuenta</CardTitle>
        </CardHeader>
        <CardContent>
          <p>No se pudo encontrar una cuenta bancaria asociada a tu perfil. Por favor, contacta a soporte.</p>
        </CardContent>
      </Card>
    );
  }

  const balanceCRD = fromCentiCrd(account.balance_cCRD);
  const balanceUSD = crdToUsd(balanceCRD);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Bienvenido de nuevo, {session.user.name || 'Usuario'}!</h1>
        <p className="text-muted-foreground">Aquí tienes un resumen de tu actividad reciente.</p>
      </div>
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Card className="col-span-1 lg:col-span-2">
          <CardHeader>
            <CardTitle>Saldo Principal</CardTitle>
            <CardDescription>Tu balance disponible en CréditoX.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-bold tracking-tight">
              {formatCurrency(balanceCRD, 'CRD')}
            </p>
            <p className="text-lg text-muted-foreground">
              ≈ {formatCurrency(balanceUSD, 'USD')}
            </p>
          </CardContent>
        </Card>
        {/* Placeholder for a chart or another summary card */}
        <Card>
           <CardHeader>
            <CardTitle>Atajos</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col space-y-2">
            {/* Quick action buttons would go here */}
            <p className="text-sm text-muted-foreground">Realiza acciones rápidas.</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Movimientos Recientes</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-4">
            {account.transactions.length > 0 ? account.transactions.map(tx => (
              <li key={tx.id} className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{tx.description}</p>
                  <p className="text-sm text-muted-foreground">{new Date(tx.createdAt).toLocaleDateString()}</p>
                </div>
                <p className={`font-bold ${tx.type === 'CREDIT' ? 'text-green-500' : 'text-red-500'}`}>
                  {tx.type === 'CREDIT' ? '+' : '-'} {formatCurrency(fromCentiCrd(tx.amount_cCRD), 'CRD')}
                </p>
              </li>
            )) : (
              <p className="text-muted-foreground">No hay transacciones recientes.</p>
            )}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
