import { ActionForm } from '../../../src/components/action-form';
import { runCommand } from '../../../src/lib/actions';
import { AdminApiError } from '../../../src/lib/http';
import { clientForSession } from '../../../src/lib/server';

/**
 * Feature flags (T033) — FE-20.
 *
 * A flag closes or opens a whole domain, so toggling is confirmed first and
 * audited: the career marketplace must never be switched by accident
 * (`specs/01-business-rules.md` §Career domain).
 */
export default async function FlagsPage() {
  const client = await clientForSession();
  if (client === null) {
    return null;
  }

  let items: { key: string; enabled: boolean; updatedAt: string }[] = [];
  let error = '';
  try {
    const list = await client.featureFlags();
    items = list.items.map((flag) => ({
      key: flag.key,
      enabled: flag.enabled,
      updatedAt: flag.updatedAt,
    }));
  } catch (caught) {
    error = caught instanceof AdminApiError ? caught.message : '无法读取特性开关。';
  }

  return (
    <section>
      <h1>特性开关</h1>
      {error.length > 0 ? (
        <p className="state">{error}</p>
      ) : items.length === 0 ? (
        <p className="state">暂无开关。</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>开关</th>
              <th>状态</th>
              <th>更新时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((flag) => (
              <tr key={flag.key}>
                <td>{flag.key}</td>
                <td>{flag.enabled ? '开启' : '关闭'}</td>
                <td>{flag.updatedAt ? new Date(flag.updatedAt).toLocaleString('zh-CN') : '—'}</td>
                <td>
                  <ActionForm
                    action={runCommand}
                    kind="flag.set"
                    id={flag.key}
                    fields={[
                      {
                        name: 'extra',
                        label: '目标状态',
                        options: [flag.enabled ? 'false' : 'true'],
                      },
                    ]}
                    submitLabel={flag.enabled ? '关闭' : '开启'}
                    confirm="切换开关会影响整个域的可用性，确定继续？"
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
