"use client"

import { ColumnDef } from "@tanstack/react-table"
import { Transaction } from "@prisma/client"
import { formatCurrency, fromCentiCrd } from "@/lib/currency"
import { Badge } from "@/components/ui/badge"
import { ArrowUpDown } from "lucide-react"
import { Button } from "../ui/button"

// We can re-use the Prisma type here, but for larger applications,
// it's often better to define a separate type for the client-side model.
export type TransactionRow = Transaction

export const columns: ColumnDef<TransactionRow>[] = [
  {
    accessorKey: "createdAt",
    header: ({ column }) => {
      return (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Fecha
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      )
    },
    cell: ({ row }) => new Date(row.getValue("createdAt")).toLocaleDateString('es-ES'),
  },
  {
    accessorKey: "description",
    header: "Descripción",
  },
  {
    accessorKey: "type",
    header: "Tipo",
    cell: ({ row }) => {
      const type = row.getValue("type") as string
      const variant = type === "CREDIT" ? "default" : "secondary"
      return <Badge variant={variant} className={variant === 'default' ? 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300' : 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300'}>{type}</Badge>
    }
  },
  {
    accessorKey: "amount_cCRD",
    header: ({ column }) => {
       return (
        <div className="text-right">
            <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            >
            Importe
            <ArrowUpDown className="ml-2 h-4 w-4" />
            </Button>
        </div>
       )
    },
    cell: ({ row }) => {
      const amount = fromCentiCrd(row.getValue("amount_cCRD"))
      const type = row.original.type
      const formatted = formatCurrency(amount, "CRD")
      const color = type === "CREDIT" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"

      return <div className={`text-right font-medium ${color}`}>{type === 'CREDIT' ? '+' : '-'}{formatted}</div>
    },
  },
  {
    accessorKey: "status",
    header: "Estado",
     cell: ({ row }) => {
      const status = row.getValue("status") as string
      let variant: "default" | "secondary" | "destructive" | "outline" = "secondary";
      if (status === 'COMPLETED') variant = 'default';
      if (status === 'PENDING') variant = 'outline';
      if (status === 'FAILED') variant = 'destructive';

      return <Badge variant={variant}>{status}</Badge>
    }
  },
]
