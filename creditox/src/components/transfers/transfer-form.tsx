'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { toast } from 'sonner';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Textarea } from '../ui/textarea';

const formSchema = z.object({
  recipientEmail: z.string().email('Por favor, introduce un email válido.'),
  amount: z.coerce.number({ invalid_type_error: 'El importe debe ser un número.' }).positive('El importe debe ser mayor que 0.'),
  description: z.string().max(100, 'La descripción no puede tener más de 100 caracteres.').optional(),
});

export function TransferForm() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      recipientEmail: '',
      amount: undefined,
      description: '',
    },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsLoading(true);
    const id = toast.loading('Procesando transferencia...');

    try {
      const response = await fetch('/api/transfers/internal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Fallo en la transferencia');
      }

      toast.success('Transferencia realizada con éxito', { id });
      form.reset();
      // Refresh server components on the current route
      router.refresh();

    } catch (error: any) {
      toast.error(error.message, { id });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="recipientEmail"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email del Destinatario</FormLabel>
              <FormControl>
                <Input placeholder="destinatario@email.com" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="amount"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Importe (CRD)</FormLabel>
              <FormControl>
                <Input type="number" step="0.01" placeholder="0.00" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
         <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Concepto (Opcional)</FormLabel>
              <FormControl>
                <Textarea placeholder="Ej: Regalo de cumpleaños" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading ? 'Enviando...' : 'Enviar Transferencia'}
        </Button>
      </form>
    </Form>
  );
}
