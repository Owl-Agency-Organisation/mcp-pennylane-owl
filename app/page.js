export default function Home() {
  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui', maxWidth: '42rem', lineHeight: 1.6 }}>
      <h1>📦 Serveur MCP Pennylane</h1>
      <p>
        Expose la comptabilité Pennylane à un assistant IA via le protocole MCP.
        21 tools en lecture seule.
      </p>

      <p>
        ✅ <strong>Statut :</strong> en service
        <br />
        🔗 <strong>Endpoint MCP :</strong> <code>/api/mcp</code>
        <br />
        🔒 <strong>Authentification :</strong> requise (<code>Authorization: Bearer …</code>)
      </p>

      <p>
        Cette page est publique et ne révèle rien de la comptabilité connectée. La liste des
        tools, le mode d&apos;emploi et le code source sont sur{' '}
        <a href="https://github.com/Owl-Agency-Organisation/mcp-pennylane-owl">GitHub</a>.
      </p>

      <hr style={{ margin: '2rem 0', border: 0, borderTop: '1px solid #ddd' }} />

      <p style={{ fontSize: '0.9rem', color: '#666' }}>
        Un projet <a href="https://owl-agency.io">Owl Agency</a> — sous licence MIT.
      </p>
    </main>
  )
}
