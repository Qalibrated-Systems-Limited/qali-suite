/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "youtube.com",
        port: "",
      },
    ],
  },
};

module.exports = nextConfig;
