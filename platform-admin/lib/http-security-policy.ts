export interface HttpHeader {
  key: string;
  value: string;
}

export interface HttpHeaderRule {
  source: string;
  headers: HttpHeader[];
}

export function createAdminHttpHeaderRules(
  nodeEnvironment: string | undefined
): HttpHeaderRule[] {
  return [
    {
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        {
          key: "Content-Security-Policy",
          value: "frame-ancestors 'none'"
        },
        { key: "Referrer-Policy", value: "no-referrer" },
        {
          key: "Permissions-Policy",
          value:
            "camera=(), geolocation=(), microphone=(), payment=(), usb=()"
        },
        {
          key: "X-Robots-Tag",
          value: "noindex, nofollow, noarchive"
        },
        { key: "Cache-Control", value: "private, no-store" },
        ...(nodeEnvironment === "production"
          ? [
              {
                key: "Strict-Transport-Security",
                value: "max-age=31536000; includeSubDomains"
              }
            ]
          : [])
      ]
    }
  ];
}
