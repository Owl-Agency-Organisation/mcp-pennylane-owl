export const metadata = {
  title: 'Serveur MCP Pennylane',
  description:
    'Serveur MCP open source exposant la comptabilité Pennylane à un assistant IA. Un projet Owl Agency.',
}

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  )
}
