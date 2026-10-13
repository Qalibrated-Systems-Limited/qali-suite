/** @type {import('next').NextConfig} */
const nextConfig = {
  // pdfjs-dist is used server-side to parse uploaded BOQ PDFs. It must not be
  // bundled (it reaches for an optional native `canvas`); load it at runtime.
  serverExternalPackages: ["pdfjs-dist"],
  experimental: {
    serverActions: {
      // BOQ PDFs run large — a priced bill with drawings can top 10MB.
      bodySizeLimit: "20mb",
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "youtube.com",
        port: "",
      },
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
      },
    ],
  },
};

module.exports = nextConfig;
