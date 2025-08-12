'use client';

import { VirtualCard } from "@/components/cards/virtual-card";
import { Button } from "@/components/ui/button";
import { Card as PrismaCard } from "@prisma/client";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export default function CardsPage() {
  const [cards, setCards] = useState<PrismaCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);

  const fetchCards = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/cards');
      if (!response.ok) {
        throw new Error('Failed to fetch cards');
      }
      const data = await response.json();
      setCards(data);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCards();
  }, []);

  const handleCreateCard = async () => {
    setIsCreating(true);
    try {
      const response = await fetch('/api/cards', { method: 'POST' });
       if (!response.ok) {
        throw new Error('Failed to create card');
      }
      toast.success('Nueva tarjeta virtual creada!');
      fetchCards(); // Refresh the list
    } catch (error: any) {
       toast.error(error.message);
    } finally {
        setIsCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Mis Tarjetas</h1>
        <Button onClick={handleCreateCard} disabled={isCreating}>
          {isCreating ? 'Creando...' : 'Crear Nueva Tarjeta'}
        </Button>
      </div>

      {isLoading ? (
        <p>Cargando tarjetas...</p>
      ) : cards.length > 0 ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {cards.map(card => (
            <VirtualCard key={card.id} card={card} onCardUpdate={fetchCards} />
          ))}
        </div>
      ) : (
        <div className="text-center py-12 border-2 border-dashed rounded-lg">
          <p className="text-muted-foreground">No tienes tarjetas virtuales.</p>
          <p className="text-sm text-muted-foreground">¡Crea una para empezar a comprar de forma segura!</p>
        </div>
      )}
    </div>
  );
}
