import { TransferForm } from "@/components/transfers/transfer-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function TransfersPage() {
  return (
    <div className="grid gap-6">
       <h1 className="text-3xl font-bold">Realizar una Transferencia</h1>
      <div className="grid md:grid-cols-3 gap-6">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Nueva Transferencia Interna</CardTitle>
            <CardDescription>
              Envía dinero de forma instantánea a otros usuarios de CréditoX.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TransferForm />
          </CardContent>
        </Card>
        <div className="md:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle>Límites y Comisiones</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Límite diario:</span>
                <span className="font-medium">10,000.00 CRD</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Comisión interna:</span>
                <span className="font-medium">Gratis</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
