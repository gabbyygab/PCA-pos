import path from 'node:path'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Tauri ships the app as static files inside a native webview — there is no
  // Node server at runtime, so the whole app is prerendered to HTML/JS/CSS.
  output: 'export',
  // The optimizer is a server route; static export has nowhere to run it.
  images: { unoptimized: true },
  reactCompiler: true,
  turbopack: {
    // shared/ sits outside web/, so the bundler needs the alias spelled out —
    // tsconfig `paths` only satisfies the type checker.
    root: path.join(__dirname, '..'),
    resolveAlias: {
      '@shared': path.join(__dirname, '..', 'shared'),
    },
  },
}

export default nextConfig
