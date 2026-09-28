import { healthEndpointUrl } from '../src/lib/api';

export default function HomePage() {
  return (
    <main style={{ padding: 32 }}>
      <h1>Mentor Platform Admin</h1>
      <p>Repository bootstrap (T001). No business modules are implemented yet.</p>
      <ul>
        <li>
          API health endpoint: <code>{healthEndpointUrl()}</code>
        </li>
        <li>API base path: /api/v1</li>
      </ul>
    </main>
  );
}
