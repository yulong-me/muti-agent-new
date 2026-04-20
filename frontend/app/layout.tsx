import type { Metadata } from 'next'
import { ThemeProvider } from '@/components/ThemeProvider'
import 'react-diff-view/style/index.css'
import './globals.css'

export const metadata: Metadata = {
  title: 'OpenCouncil',
  description: 'Multi-agent deliberation workspace',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
