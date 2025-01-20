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
  env: {
    JWT_KEY: "geoffrey_ajenda_788$$%%hhhhdhjj",
    AUTH_SECRET: "cU4MLQChH0IoakjEcH9FBHtQUr8Mnkn2elIZdlgmnwg=",

    DB_LOCAL_URI:
      "mongodb+srv://geoffrey:geoffrey@kilos.6ilx3u2.mongodb.net/stockvault?retryWrites=true&w=majority",
  },
};

module.exports = nextConfig;
