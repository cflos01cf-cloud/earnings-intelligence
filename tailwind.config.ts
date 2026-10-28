import type { Config } from 'tailwindcss';
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: 'var(--ink)', panel: 'var(--panel)', line: 'var(--line)', fg: 'var(--fg)', muted: 'var(--muted)',
        brass: 'var(--brass)', up: 'var(--up)', warn: 'var(--warn)', down: 'var(--down)', info: 'var(--info)',
      },
      fontFamily: { sans: ['Archivo', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'sans-serif'] },
    },
  },
  plugins: [],
} satisfies Config;
