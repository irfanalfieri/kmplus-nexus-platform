/** @type {import('next').NextConfig} */
const nextConfig = {
  // Type errors fail the build (TD-8). Keep `pnpm typecheck` clean.
  images: {
    unoptimized: true,
  },
  experimental: {
    // File uploads (DS-9) send parsed rows in parts of up to ~2 MB.
    serverActions: { bodySizeLimit: '3mb' },
  },
}

export default nextConfig
