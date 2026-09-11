import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@whiskeysockets/baileys",
    "pino",
    "qrcode",
    "jimp",
    "@hapi/boom",
  ],
};

export default nextConfig;
