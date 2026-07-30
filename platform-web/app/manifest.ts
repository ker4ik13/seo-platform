import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SEOньорита / SEOnorita",
    short_name: "SEOньорита",
    description:
      "Единая платформа для системного SEO: семантика, позиции, SERP, контент и командная работа.",
    start_url: "/ru",
    display: "standalone",
    background_color: "#f5f1e8",
    theme_color: "#f0523d",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml"
      }
    ]
  };
}
