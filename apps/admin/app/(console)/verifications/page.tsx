import { ActionForm } from '../../../src/components/action-form';
import { runCommand } from '../../../src/lib/actions';
import { AdminApiError } from '../../../src/lib/http';
import { clientForSession } from '../../../src/lib/server';
import { verificationRow } from '../../../src/lib/views';

/**
 * Verification queue (T033) — FE-13.
 *
 * Documents are private: the console asks the server for a short-lived URL per
 * document and shows it as a link. Nothing is cached — the URL expires in
 * minutes and every access is logged (`specs/12`, `specs/10`).
 */
export default async function VerificationsPage() {
  const client = await clientForSession();
  if (client === null) {
    return null;
  }

  let rows: ReturnType<typeof verificationRow>[] = [];
  let error = '';
  try {
    const queue = await client.verifications({ page: 1, pageSize: 50 });
    rows = queue.items.map(verificationRow);
  } catch (caught) {
    error = caught instanceof AdminApiError ? caught.message : '无法读取验证队列。';
  }

  return (
    <section>
      <h1>验证队列</h1>
      {error.length > 0 ? (
        <p className="state">{error}</p>
      ) : rows.length === 0 ? (
        <p className="state">暂无待审核的验证。</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>商家</th>
              <th>类型</th>
              <th>状态</th>
              <th>提交</th>
              <th>材料</th>
              <th>处置</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.providerName}</td>
                <td>{row.typeText}</td>
                <td>{row.statusText}</td>
                <td>{row.submittedText}</td>
                <td>{row.documentText}</td>
                <td>
                  {row.decidable ? (
                    <>
                      <ActionForm
                        action={runCommand}
                        kind="verification.approve"
                        id={row.id}
                        fields={[{ name: 'text', label: '原因代码' }]}
                        submitLabel="通过"
                      />
                      <ActionForm
                        action={runCommand}
                        kind="verification.reject"
                        id={row.id}
                        fields={[{ name: 'text', label: '原因代码' }]}
                        submitLabel="驳回"
                      />
                    </>
                  ) : null}
                  <ActionForm
                    action={runCommand}
                    kind="verification.document"
                    id={row.id}
                    fields={[{ name: 'text', label: '材料编号' }]}
                    submitLabel="查看证件"
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
