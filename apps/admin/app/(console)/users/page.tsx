import { ActionForm } from '../../../src/components/action-form';
import { runCommand } from '../../../src/lib/actions';
import { AdminApiError } from '../../../src/lib/http';
import { clientForSession } from '../../../src/lib/server';
import { userRow } from '../../../src/lib/views';

/** Roles the console may grant or revoke (`specs/07-permission-spec.md`). */
const ROLES = ['PARENT', 'STUDENT', 'PROVIDER', 'ADMIN', 'OPS', 'FINANCE', 'MODERATOR'];

/**
 * Users and roles (T033) — FE-21.
 *
 * Granting and revoking are two separate commands, each audited, and the answer
 * is always the full role list — so what the console shows after an action is
 * what the server has, not what the button hoped for.
 */
export default async function UsersPage() {
  const client = await clientForSession();
  if (client === null) {
    return null;
  }

  let rows: ReturnType<typeof userRow>[] = [];
  let error = '';
  try {
    const list = await client.users({ page: 1, pageSize: 50 });
    rows = list.items.map(userRow);
  } catch (caught) {
    error = caught instanceof AdminApiError ? caught.message : '无法读取用户。';
  }

  return (
    <section>
      <h1>用户与角色</h1>
      {error.length > 0 ? (
        <p className="state">{error}</p>
      ) : rows.length === 0 ? (
        <p className="state">暂无用户。</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>名称</th>
              <th>状态</th>
              <th>角色</th>
              <th>创建</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.name}</td>
                <td>{row.statusText}</td>
                <td>{row.roleText}</td>
                <td>{row.createdText}</td>
                <td>
                  <ActionForm
                    action={runCommand}
                    kind="role.grant"
                    id={row.id}
                    fields={[{ name: 'extra', label: '角色', options: ROLES }]}
                    submitLabel="授权"
                  />
                  <ActionForm
                    action={runCommand}
                    kind="role.revoke"
                    id={row.id}
                    fields={[
                      {
                        name: 'extra',
                        label: '角色',
                        options: row.roles.length > 0 ? row.roles : ['NONE'],
                      },
                    ]}
                    submitLabel="撤权"
                    confirm="撤权会立即收回该账号的权限，确定继续？"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
