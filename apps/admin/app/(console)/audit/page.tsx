import { AdminApiError } from '../../../src/lib/http';
import { clientForSession } from '../../../src/lib/server';
import { auditRow } from '../../../src/lib/views';

/**
 * Audit log (T033) — FE-22.
 *
 * The log is read-only by design: there is no edit and no delete endpoint, and
 * the console offers none. Filters are the ones the API documents — action and
 * resource — and an empty result says so instead of looking broken.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams?: Promise<{ action?: string; resourceType?: string }>;
}) {
  const client = await clientForSession();
  if (client === null) {
    return null;
  }

  const params = (await searchParams) ?? {};
  let rows: ReturnType<typeof auditRow>[] = [];
  let error = '';
  try {
    const list = await client.auditLogs({
      action: params.action,
      resourceType: params.resourceType,
      page: 1,
      pageSize: 50,
    });
    rows = list.items.map(auditRow);
  } catch (caught) {
    error = caught instanceof AdminApiError ? caught.message : '无法读取审计日志。';
  }

  return (
    <section>
      <h1>审计日志</h1>

      <form className="inline" method="get">
        <input
          name="action"
          placeholder="动作（如 PROVIDER_APPROVED）"
          defaultValue={params.action ?? ''}
        />
        <input
          name="resourceType"
          placeholder="资源类型"
          defaultValue={params.resourceType ?? ''}
        />
        <button type="submit">筛选</button>
      </form>

      {error.length > 0 ? (
        <p className="state">{error}</p>
      ) : rows.length === 0 ? (
        <p className="state">没有符合条件的日志。</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>动作</th>
              <th>操作者</th>
              <th>资源</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.createdText}</td>
                <td>{row.actionText}</td>
                <td>{row.actorText}</td>
                <td>{row.resourceText}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
