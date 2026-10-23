import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { readSession } from '../../src/lib/server';

const LINKS = [
  { href: '/dashboard', label: '概览' },
  { href: '/providers', label: '商家审核' },
  { href: '/verifications', label: '验证队列' },
  { href: '/orders', label: '订单' },
  { href: '/users', label: '用户与角色' },
  { href: '/audit', label: '审计日志' },
  { href: '/flags', label: '特性开关' },
  { href: '/taxonomy', label: '类目' },
  { href: '/rules', label: '平台规则' },
];

/**
 * The console shell (T033).
 *
 * A missing session is a redirect, not a rendered "please log in": an operator
 * should never see a page whose data would 401. A `FORBIDDEN` from the API is
 * shown, not hidden — the console does not pretend a resource does not exist
 * (`specs/12-admin-spec.md`).
 */
export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const session = await readSession();
  if (session === null) {
    redirect('/login');
  }

  return (
    <div className="shell">
      <nav className="nav">
        <div className="brand">导师平台 · 运营后台</div>
        {LINKS.map((link) => (
          <Link key={link.href} href={link.href}>
            {link.label}
          </Link>
        ))}
        <div style={{ marginTop: 24 }}>
          {/* Signing out is a server action: the session is dropped server-side. */}
          <Link href="/login">退出登录</Link>
        </div>
      </nav>
      <main className="content">{children}</main>
    </div>
  );
}
