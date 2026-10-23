import { ActionForm } from '../../../src/components/action-form';
import { runCommand } from '../../../src/lib/actions';
import { AdminApiError } from '../../../src/lib/http';
import { clientForSession } from '../../../src/lib/server';
import { taxonomyRow } from '../../../src/lib/views';

/**
 * Taxonomy (T033) — FE-18.
 *
 * Terms are archived, never deleted: an order or a compliance scope may still
 * point at an old term, so the console can only withdraw it from new use
 * (`specs/01-business-rules.md` §Catalog).
 */
export default async function TaxonomyPage() {
  const client = await clientForSession();
  if (client === null) {
    return null;
  }

  let rows: ReturnType<typeof taxonomyRow>[] = [];
  let error = '';
  try {
    const list = await client.taxonomy();
    rows = list.items.map(taxonomyRow);
  } catch (caught) {
    error = caught instanceof AdminApiError ? caught.message : '无法读取类目。';
  }

  return (
    <section>
      <h1>类目</h1>

      <ActionForm
        action={runCommand}
        kind="term.create"
        fields={[
          { name: 'extra', label: '类型', options: ['SUBJECT', 'GRADE', 'SKILL', 'CITY'] },
          { name: 'text', label: '代码（如 MATH）' },
          { name: 'name', label: '名称（如 数学）' },
        ]}
        submitLabel="新增"
      />

      {error.length > 0 ? (
        <p className="state">{error}</p>
      ) : rows.length === 0 ? (
        <p className="state">暂无类目。</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>类型</th>
              <th>代码</th>
              <th>名称</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.typeText}</td>
                <td>{row.code}</td>
                <td>{row.name}</td>
                <td>{row.activeText}</td>
                <td>
                  {row.active ? (
                    <ActionForm
                      action={runCommand}
                      kind="term.archive"
                      id={row.id}
                      submitLabel="归档"
                      confirm="归档后该类目不可再用于新服务，确定继续？"
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
