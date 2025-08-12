'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

// This can be expanded with icons and more navigation items
const navItems = [
  { href: '/dashboard', label: 'Resumen' },
  { href: '/transactions', label: 'Movimientos' },
  { href: '/transfers', label: 'Transferencias' },
  { href: '/cards', label: 'Tarjetas' },
  { href: '/loans', label: 'Préstamos' },
  { href: '/savings', label: 'Ahorro' },
  { href: '/support', label: 'Soporte' },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 flex-shrink-0 p-4 border-r bg-background hidden md:block">
       <div className="flex items-center mb-6 h-14 border-b">
         <Link href="/dashboard" className="flex items-center justify-center" prefetch={false}>
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6"><line x1="12" x2="12" y1="2" y2="22" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
            <span className="ml-2 text-xl font-bold">CréditoX</span>
        </Link>
      </div>
      <nav className="flex flex-col gap-1">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'px-3 py-2 rounded-md text-sm font-medium transition-colors',
              pathname.startsWith(item.href)
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
