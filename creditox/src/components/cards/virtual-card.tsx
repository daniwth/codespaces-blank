'use client';

import { useState } from 'react';
import { Card as UICard, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card as PrismaCard } from '@prisma/client';
import { toast } from 'sonner';

interface VirtualCardProps {
  card: PrismaCard;
  onCardUpdate: () => void; // Callback to refresh the card list
}

export function VirtualCard({ card, onCardUpdate }: VirtualCardProps) {
  const [cvv, setCvv] = useState('***');
  const [isFreezing, setIsFreezing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const showCvv = () => {
    // In a real app, this would make an API call to get a one-time CVV
    // based on the cvvDynamicSeed. Here, we just simulate a random one.
    toast.info('Mostrando CVV por 5 segundos...');
    const newCvv = Math.floor(100 + Math.random() * 900).toString();
    setCvv(newCvv);
    setTimeout(() => setCvv('***'), 5000); // Hide after 5 seconds
  };

  const handleFreezeToggle = async () => {
    setIsFreezing(true);
    // This API endpoint doesn't exist yet, but we're preparing the UI for it.
    // const response = await fetch(`/api/cards/${card.id}/freeze`, { method: 'POST' });
    // if (response.ok) {
    //   toast.success(`Card ${card.status === 'ACTIVE' ? 'frozen' : 'unfrozen'}`);
    //   onCardUpdate();
    // } else {
    //   toast.error('Failed to update card status');
    // }
    toast.info('Funcionalidad de Congelar/Descongelar no implementada en la API.');
    setIsFreezing(false);
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    // This API endpoint also needs to be created.
    // const response = await fetch(`/api/cards/${card.id}`, { method: 'DELETE' });
    // if (response.ok) {
    //   toast.success('Card deleted successfully');
    //   onCardUpdate();
    // } else {
    //   toast.error('Failed to delete card');
    // }
    toast.info('Funcionalidad de Eliminar no implementada en la API.');
    setIsDeleting(false);
  };


  return (
    <UICard className="w-full max-w-sm bg-gradient-to-br from-slate-900 to-slate-800 text-primary-foreground shadow-lg">
      <CardHeader>
        <div className="flex justify-between items-center">
          <span className="text-lg font-bold">CréditoX</span>
          <Badge variant={card.status === 'ACTIVE' ? 'default' : 'destructive'}>{card.status}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-center font-mono text-xl tracking-widest my-4 bg-slate-700/50 p-2 rounded-md">
          {card.maskedPan.replace(/(.{4})/g, '$1 ').trim()}
        </div>
        <div className="flex justify-between text-sm">
          <div>
            <span className="text-slate-400">Expira</span>
            <p>{`${card.expiryMonth.toString().padStart(2, '0')}/${card.expiryYear.toString().slice(-2)}`}</p>
          </div>
          <div>
            <span className="text-slate-400">CVV</span>
            <p className="w-12 text-center cursor-pointer font-mono tracking-widest" onClick={showCvv}>{cvv}</p>
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex justify-between gap-2">
        <Button variant="secondary" onClick={handleFreezeToggle} disabled={isFreezing} className="w-full">
          {card.status === 'ACTIVE' ? 'Congelar' : 'Descongelar'}
        </Button>
        <Button variant="destructive" onClick={handleDelete} disabled={isDeleting} className="w-full">Eliminar</Button>
      </CardFooter>
    </UICard>
  );
}
