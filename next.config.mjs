/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: process.env.APERTURE_BASE_PATH ?? "/aperture",
};

export default nextConfig;
