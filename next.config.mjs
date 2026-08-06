/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    outputFileTracingExcludes: {
      '*': ['public/media/**/*'],
    },
  },
};

export default nextConfig;
