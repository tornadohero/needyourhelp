import { signIn } from '../../src/lib/actions';

import { LoginForm } from './login-form';

/**
 * Console login (T033) — FE-10.
 *
 * The console credential only unlocks the console for an account that already
 * holds `ADMIN`/`OPS`; login never grants a role (`specs/12-admin-spec.md`).
 * Wrong passwords are rate-limited and locked out server-side, and the console
 * says so without saying whether the username exists.
 */
export default function LoginPage() {
  return (
    <main className="auth">
      <div className="auth-card">
        <h1>运营后台登录</h1>
        <p className="muted">
          使用控制台用户名与密码登录。登录不会授予角色：只有已持有 ADMIN/OPS 的账号可用。
        </p>
        <LoginForm action={signIn} />
      </div>
    </main>
  );
}
