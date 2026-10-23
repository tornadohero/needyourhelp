import { redirect } from 'next/navigation';

import { readSession } from '../src/lib/server';

/** Entry point: an operator with a session lands on the dashboard. */
export default async function RootPage() {
  const session = await readSession();
  redirect(session === null ? '/login' : '/dashboard');
}
