/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                'bg-app': 'var(--bg-app)',
                'bg-sidebar': 'var(--bg-sidebar)',
                'bg-panel': 'var(--bg-panel)',
                'bg-card': 'var(--bg-card)',
                'bg-element': 'var(--bg-element)',
                'bg-element-hover': 'var(--bg-element-hover)',
                'border-subtle': 'var(--border-subtle)',
                'border-strong': 'var(--border-strong)',
                'text-primary': 'var(--text-primary)',
                'text-secondary': 'var(--text-secondary)',
                'text-muted': 'var(--text-muted)',
                'text-on-dark': 'var(--text-on-dark)',
                'text-inverse': 'var(--text-inverse)',
                'accent-primary': 'var(--accent-primary)',
                'accent-hover': 'var(--accent-hover)',
                'accent-subtle': 'var(--accent-subtle)',
                'status-success': 'var(--status-success)',
                'status-error': 'var(--status-error)',
                'status-warning': 'var(--status-warning)',
                'status-info': 'var(--status-info)',
            },
            fontFamily: {
                sans: ['var(--font-body)', 'sans-serif'],
                heading: ['var(--font-heading)', 'serif'],
                mono: ['var(--font-code)', 'monospace'],
            },
            boxShadow: {
                'sm': 'var(--shadow-sm)',
                'md': 'var(--shadow-md)',
                'lg': 'var(--shadow-lg)',
                'glow': 'var(--shadow-glow)',
            },
            borderRadius: {
                'sm': 'var(--radius-sm)',
                'md': 'var(--radius-md)',
                'lg': 'var(--radius-lg)',
                'full': 'var(--radius-full)',
            }
        },
    },
    plugins: [],
}
