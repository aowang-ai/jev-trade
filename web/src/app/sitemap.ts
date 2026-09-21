import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://www.jev-trade.com/",
      lastModified: new Date(),
    },
  ];
}
