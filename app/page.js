export default function Home() {
  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      <h1>📦 MCP Server Pennylane</h1>
      <p>Serveur MCP pour Owl Agency</p>
      <p>✅ <strong>Status:</strong> Running</p>
      <p>🔗 <strong>Endpoint MCP:</strong> <code>/api/mcp</code></p>
      <h2>Tools disponibles</h2>
      <ul>
        <li><code>pennylane_health_check</code> - Statut comptabilité</li>
      </ul>
    </main>
  )
}
