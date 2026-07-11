/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: "/api/badge/:sourceId.svg",
        destination: "/api/badge/:sourceId",
      },
      {
        source: "/api/judge-proof.json",
        destination: "/api/judge-proof",
      },
    ];
  },
};

export default nextConfig;
