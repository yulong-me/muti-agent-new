import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'AI 智囊团',
  description: 'Multi-Agent Collaboration Platform',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh">
      <body>{children}</body>
    </html>
  )
}
