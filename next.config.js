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
      "mongodb+srv://werner:werner@cluster0.cbuo3.mongodb.net/StockVault?retryWrites=true&w=majority&appName=Cluster0",
  },
};

module.exports = nextConfig;
