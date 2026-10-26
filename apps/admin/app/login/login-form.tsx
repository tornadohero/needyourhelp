'use client';

import { useState } from 'react';

import type { ActionResult } from '../../src/lib/actions';

/**
 * The login form (T033).
 *
 * Client-side only because it holds what the operator types; the call itself
 * runs in a server action, so the password never touches a client-side fetch.
 */
export function LoginForm({ action }: { action: (formData: FormData) => Promise<ActionResult> }) {
  const [message, setMessage] = useState('');

  return (
    <form
      action={async (formData: FormData) => {
        const result = await action(formData);
        if (!result.ok) {
          setMessage(result.message);
        }
      }}
      className="auth-form"
    >
      <input name="username" placeholder="用户名" autoComplete="username" />
      <input name="password" type="password" placeholder="密码" autoComplete="current-password" />
      <button type="submit">登录</button>
      {message.length > 0 ? <p className="error">{message}</p> : null}
    </form>
  );
}
