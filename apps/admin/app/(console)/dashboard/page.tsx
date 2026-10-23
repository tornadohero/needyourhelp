import { AdminApiError } from '../../../src/lib/http';
import { clientForSession } from '../../../src/lib/server';
import { dashboardCards } from '../../../src/lib/views';

/**
 * Dashboard (T033) — FE-11.
 *
 * Every card is a field the API returned. There is deliberately no trend chart:
 * the platform has no time series endpoint (G6/G13), and a chart drawn from
 * invented numbers would be worse than no chart.
 */
export default async function DashboardPage() {
  const client = await clientForSession();
  if (client === null) {
    return null;
  }

  let cards: ReturnType<typeof dashboardCards> = [];
  let error = '';
  try {
    cards = dashboardCards(await client.dashboard());
  } catch (caught) {
    error = caught instanceof AdminApiError ? caught.message : '无法读取概览数据。';
  }

  return (
    <section>
      <h1>概览</h1>
      {error.length > 0 ? (
        <p className="state">{error}</p>
      ) : (
        <div className="cards">
          {cards.map((card) => (
            <div className="card" key={card.label}>
              <div className="label">{card.label}</div>
              <div className="value">{card.value}</div>
              <div className="hint">{card.hint}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
