'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { toast } from 'sonner';
import { useState } from 'react';
import { Slider } from '../ui/slider';

const formSchema = z.object({
  amount: z.coerce.number().min(500, 'El mínimo es 500 CRD').max(50000, 'El máximo es 50,000 CRD'),
  termMonths: z.coerce.number().int().min(3).max(60),
});

interface LoanApplicationFormProps {
  onLoanApplied: () => void; // Callback to refresh loan list
}

export function LoanApplicationForm({ onLoanApplied }: LoanApplicationFormProps) {
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { amount: 1000, termMonths: 12 },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsLoading(true);
    const id = toast.loading('Enviando solicitud...');
    try {
      const response = await fetch('/api/loans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Fallo al enviar la solicitud');

      toast.success('¡Solicitud enviada! Recibirás una notificación con la oferta.', { id });
      form.reset();
      onLoanApplied();

    } catch (error: any) {
      toast.error(error.message, { id });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <FormField
          control={form.control}
          name="amount"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Importe del Préstamo (CRD)</FormLabel>
              <FormControl><Input type="number" {...field} /></FormControl>
              <FormDescription>
                Solicita entre 500 y 50,000 CRD.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="termMonths"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Plazo (en meses)</FormLabel>
              <FormControl>
                <Slider
                  defaultValue={[12]}
                  min={3}
                  max={60}
                  step={1}
                  onValueChange={(value) => field.onChange(value[0])}
                />
              </FormControl>
               <FormDescription>
                Elige un plazo entre 3 y 60 meses. Plazo actual: {field.value} meses.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading ? 'Enviando...' : 'Solicitar Préstamo'}
        </Button>
      </form>
    </Form>
  );
}
