'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * A console nav item (T033).
 *
 * Client-side for one reason only: the current path is a browser fact. The
 * links themselves stay plain `<Link>`s, and the rest of the shell is server
 * rendered.
 */
export function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname() ?? '';
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link href={href} className={active ? 'active' : undefined}>
      {label}
    </Link>
  );
}
