/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ['cloudinary'],
    outputFileTracingExcludes: {
      '*': ['public/media/**/*'],
    },
  },
};

export default nextConfig;
