import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/embed/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "frame-ancestors https://www.notion.so https://notion.so https://www.notion.site https://notion.site;",
          },
        ],
      },
    ];
  },
};

export default nextConfig;