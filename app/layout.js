export const metadata = {
  title: 'MCP Pennylane Owl',
  description: 'Serveur MCP Pennylane',
}

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  )
}
