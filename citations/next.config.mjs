/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: "/api/badge/:sourceId.svg",
        destination: "/api/badge/:sourceId",
      },
    ];
  },
};

export default nextConfig;
