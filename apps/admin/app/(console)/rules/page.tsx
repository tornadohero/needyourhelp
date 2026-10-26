import { ActionForm } from '../../../src/components/action-form';
import { runCommand } from '../../../src/lib/actions';
import { AdminApiError } from '../../../src/lib/http';
import { clientForSession } from '../../../src/lib/server';
import { ruleRow } from '../../../src/lib/views';

/**
 * Platform rules (T033) — FE-19.
 *
 * A rule is what the platform charges and what it promises when an order is
 * cancelled, so publishing one is a separate, confirmed command: drafts are
 * edited freely, and only an explicit publish changes live behaviour
 * (`specs/08-payment-and-settlement.md`).
 */
export default async function RulesPage() {
  const client = await clientForSession();
  if (client === null) {
    return null;
  }

  let rows: ReturnType<typeof ruleRow>[] = [];
  let error = '';
  try {
    const list = await client.platformRules();
    rows = list.items.map(ruleRow);
  } catch (caught) {
    error = caught instanceof AdminApiError ? caught.message : '无法读取平台规则。';
  }

  return (
    <section>
      <h1>平台规则</h1>
      <p className="muted">费率与取消政策以草稿撰写，发布后才生效；发布动作会二次确认。</p>

      {error.length > 0 ? (
        <p className="state">{error}</p>
      ) : rows.length === 0 ? (
        <p className="state">暂无规则。</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>类型</th>
              <th>状态</th>
              <th>版本</th>
              <th>创建</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.typeText}</td>
                <td>{row.statusText}</td>
                <td>{row.versionText}</td>
                <td>{row.createdText}</td>
                <td>
                  {row.publishable ? (
                    <ActionForm
                      action={runCommand}
                      kind="rule.publish"
                      id={row.id}
                      submitLabel="发布"
                      confirm="发布后该规则立即生效，确定继续？"
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
