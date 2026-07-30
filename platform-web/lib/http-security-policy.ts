export interface HttpHeader {
  key: string;
  value: string;
}

export interface HttpHeaderRule {
  source: string;
  headers: HttpHeader[];
}

const COMMON_SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'"
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin"
  },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), geolocation=(), microphone=(), payment=(), usb=()"
  }
] as const satisfies readonly HttpHeader[];

const HSTS_HEADER = {
  key: "Strict-Transport-Security",
  value: "max-age=31536000; includeSubDomains"
} as const satisfies HttpHeader;

export function createWebHttpHeaderRules(
  nodeEnvironment: string | undefined
): HttpHeaderRule[] {
  return [
    {
      source: "/:path*",
      headers: [
        ...COMMON_SECURITY_HEADERS,
        ...(nodeEnvironment === "production" ? [HSTS_HEADER] : [])
      ]
    },
    {
      source: "/push-service-worker.js",
      headers: [
        {
          key: "Cache-Control",
          value: "no-cache"
        },
        {
          key: "Service-Worker-Allowed",
          value: "/app/"
        }
      ]
    },
    {
      source: "/app/:path*",
      headers: [
        {
          key: "X-Robots-Tag",
          value: "noindex, nofollow, noarchive"
        },
        {
          key: "Cache-Control",
          value: "private, no-store"
        }
      ]
    }
  ];
}
