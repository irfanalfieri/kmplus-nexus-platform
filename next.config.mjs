/** @type {import('next').NextConfig} */
const nextConfig = {
  // Type errors fail the build (TD-8). Keep `pnpm typecheck` clean.
  images: {
    unoptimized: true,
  },
  // SFTP (DS-9): ssh2 probes optional native add-ons at run time; load it from node_modules, not the bundle.
  serverExternalPackages: ['ssh2'],
  experimental: {
    // File uploads (DS-9) send parsed rows in parts of up to ~2 MB.
    serverActions: { bodySizeLimit: '3mb' },
  },
}

export default nextConfig
