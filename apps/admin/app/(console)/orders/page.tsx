import { ActionForm } from '../../../src/components/action-form';
import { runCommand } from '../../../src/lib/actions';
import { AdminApiError } from '../../../src/lib/http';
import { clientForSession } from '../../../src/lib/server';
import { orderRow } from '../../../src/lib/views';

/**
 * Orders and refunds (T033) — FE-15.
 *
 * A refund carries an `Idempotency-Key`, so pressing it twice refunds once. The
 * amount is left empty unless an operator means a partial refund, and even then
 * the server decides what is refundable (`specs/08-payment-and-settlement.md`
 * §Refund).
 */
export default async function OrdersPage() {
  const client = await clientForSession();
  if (client === null) {
    return null;
  }

  let rows: ReturnType<typeof orderRow>[] = [];
  let error = '';
  try {
    const list = await client.orders({ page: 1, pageSize: 50 });
    rows = list.items.map(orderRow);
  } catch (caught) {
    error = caught instanceof AdminApiError ? caught.message : '无法读取订单。';
  }

  return (
    <section>
      <h1>订单</h1>
      {error.length > 0 ? (
        <p className="state">{error}</p>
      ) : rows.length === 0 ? (
        <p className="state">暂无订单。</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>订单号</th>
              <th>状态</th>
              <th>金额</th>
              <th>创建</th>
              <th>退款</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.orderNo}</td>
                <td>{row.statusText}</td>
                <td>{row.amountText}</td>
                <td>{row.createdText}</td>
                <td>
                  {row.payable ? (
                    <ActionForm
                      action={runCommand}
                      kind="order.refund"
                      id={row.id}
                      fields={[
                        { name: 'text', label: '退款原因' },
                        { name: 'extra', label: '金额（元，留空为全额）', type: 'number' },
                      ]}
                      submitLabel="退款"
                      confirm="退款将真实退回客户款项，确定继续？"
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
