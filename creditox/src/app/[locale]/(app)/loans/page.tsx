'use client';

import { LoanApplicationForm } from "@/components/loans/loan-application-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fromCentiCrd, formatCurrency } from "@/lib/currency";
import { Loan as PrismaLoan } from "@prisma/client";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export default function LoansPage() {
  const [loans, setLoans] = useState<PrismaLoan[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchLoans = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/loans');
      if (!response.ok) throw new Error('Failed to fetch loans');
      const data = await response.json();
      setLoans(data);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLoans();
  }, []);

  return (
    <div className="grid gap-6">
      <h1 className="text-3xl font-bold">Préstamos</h1>
      <div className="grid md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Mis Préstamos</CardTitle>
              <CardDescription>Aquí puedes ver el estado de tus préstamos actuales.</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <p>Cargando préstamos...</p>
              ) : loans.length > 0 ? (
                <ul className="space-y-4">
                  {loans.map(loan => (
                    <li key={loan.id} className="flex justify-between items-center p-3 border rounded-lg">
                      <div>
                        <p className="font-semibold">Préstamo de {formatCurrency(fromCentiCrd(loan.principal_cCRD), 'CRD')}</p>
                        <p className="text-sm text-muted-foreground">{loan.termMonths} meses al {(Number(loan.rateAPR) * 100).toFixed(2)}% APR</p>
                      </div>
                      <div className="text-right">
                        <p className={`font-bold text-sm`}>{loan.status}</p>
                        {loan.status === 'PENDING' && <Button size="sm" className="mt-1">Revisar Oferta</Button>}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                 <p className="text-muted-foreground">No tienes ningún préstamo activo.</p>
              )}
            </CardContent>
          </Card>
        </div>
        <div className="md:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle>Solicitar Nuevo Préstamo</CardTitle>
              <CardDescription>Consigue financiación al instante.</CardDescription>
            </CardHeader>
            <CardContent>
              <LoanApplicationForm onLoanApplied={fetchLoans} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
