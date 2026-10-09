/** @type {import('next').NextConfig} */
const nextConfig = {
  // Type errors fail the build (TD-8). Keep `pnpm typecheck` clean.
  images: {
    unoptimized: true,
  },
}

export default nextConfig
