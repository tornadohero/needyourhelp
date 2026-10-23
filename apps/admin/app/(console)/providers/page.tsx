import { ActionForm } from '../../../src/components/action-form';
import { runCommand } from '../../../src/lib/actions';
import { AdminApiError } from '../../../src/lib/http';
import { clientForSession } from '../../../src/lib/server';
import { providerRow } from '../../../src/lib/views';

/**
 * Provider review (T033) — FE-12.
 *
 * Every decision needs a reason: the server refuses one without it, and the
 * audit log is the record of why a merchant was accepted or refused
 * (`specs/12-admin-spec.md`). Which buttons appear follows the state, but the
 * server still decides — a refusal is reported, not retried.
 */
export default async function ProvidersPage() {
  const client = await clientForSession();
  if (client === null) {
    return null;
  }

  let rows: ReturnType<typeof providerRow>[] = [];
  let error = '';
  try {
    const list = await client.providers({ page: 1, pageSize: 50 });
    rows = list.items.map(providerRow);
  } catch (caught) {
    error = caught instanceof AdminApiError ? caught.message : '无法读取商家列表。';
  }

  return (
    <section>
      <h1>商家审核</h1>
      {error.length > 0 ? (
        <p className="state">{error}</p>
      ) : rows.length === 0 ? (
        <p className="state">暂无商家。</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>名称</th>
              <th>类型</th>
              <th>状态</th>
              <th>曝光</th>
              <th>创建</th>
              <th>处置</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.name}</td>
                <td>{row.typeText}</td>
                <td>{row.approvalText}</td>
                <td>{row.searchableText}</td>
                <td>{row.createdText}</td>
                <td>
                  {row.canApprove ? (
                    <ActionForm
                      action={runCommand}
                      kind="provider.approve"
                      id={row.id}
                      fields={[{ name: 'text', label: '通过理由' }]}
                      submitLabel="通过"
                    />
                  ) : null}
                  {row.canReject ? (
                    <ActionForm
                      action={runCommand}
                      kind="provider.reject"
                      id={row.id}
                      fields={[{ name: 'text', label: '驳回理由' }]}
                      submitLabel="驳回"
                    />
                  ) : null}
                  {row.canSuspend ? (
                    <ActionForm
                      action={runCommand}
                      kind="provider.suspend"
                      id={row.id}
                      fields={[{ name: 'text', label: '暂停理由' }]}
                      submitLabel="暂停"
                      confirm="暂停后该商家将不可被搜索与预约，确定继续？"
                    />
                  ) : null}
                  {row.canRestore ? (
                    <ActionForm
                      action={runCommand}
                      kind="provider.restore"
                      id={row.id}
                      fields={[{ name: 'text', label: '恢复理由' }]}
                      submitLabel="恢复"
                    />
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
