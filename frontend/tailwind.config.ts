import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        ink: 'var(--ink)',
        'ink-soft': 'var(--ink-soft)',
        'ink-faint': 'var(--ink-faint)',
        surface: 'var(--surface)',
        'surface-muted': 'var(--surface-muted)',
        bg: 'var(--bg)',
        'nav-bg': 'var(--nav-bg)',
        line: 'var(--line)',
        accent: 'var(--accent)',
        'accent-deep': 'var(--accent-deep)',
        focus: 'var(--focus)',
        'focus-deep': 'var(--focus-deep)',
        
        // legacy apple colors for backward compatibility during transition
        apple: {
          bg: 'var(--bg)',
          primary: 'var(--accent)',
          text: 'var(--ink)',
          secondary: 'var(--ink-soft)',
          card: 'var(--surface)',
          border: 'var(--line)',
          green: '#34C759',
          orange: '#FF9500',
        },
      },
      fontFamily: {
        sans: ['Inter', '"Noto Sans SC"', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        display: ['Inter', '"Noto Sans SC"', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        display: ['22px', { lineHeight: '1.2', letterSpacing: '-0.02em', fontWeight: '700' }],
        title: ['15px', { lineHeight: '1.4', letterSpacing: '-0.005em', fontWeight: '600' }],
        body: ['14px', { lineHeight: '1.6', fontWeight: '400' }],
        secondary: ['13px', { lineHeight: '1.55', fontWeight: '400' }],
        caption: ['12px', { lineHeight: '1.5', fontWeight: '500' }],
        label: ['11px', { lineHeight: '1.4', letterSpacing: '0.08em', fontWeight: '600' }],
      },
      borderRadius: {
        'pill': 'var(--radius-pill)',
        'lg': 'var(--radius-lg)',
        'md': 'var(--radius-md)',
        'sm': 'var(--radius-sm)',
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}
export default config
