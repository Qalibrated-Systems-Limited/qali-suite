/** @type {import('next').NextConfig} */
const nextConfig = {
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
