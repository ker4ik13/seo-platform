import type {
  WebPushBrowser,
  WebPushPlatform
} from "@seo-platform/contracts";

export interface WebPushUserAgentMetadata {
  readonly browser: WebPushBrowser;
  readonly platform: WebPushPlatform;
}

export function webPushUserAgentMetadata(
  userAgent: string | undefined
): WebPushUserAgentMetadata {
  const value = (userAgent ?? "").slice(0, 2_000);
  return {
    browser: browserValue(value),
    platform: platformValue(value)
  };
}

function browserValue(value: string): WebPushBrowser {
  if (/\b(?:Edg|EdgA|EdgiOS)\//u.test(value)) return "EDGE";
  if (/\b(?:OPR|Opera)\//u.test(value)) return "OPERA";
  if (/\b(?:Firefox|FxiOS)\//u.test(value)) return "FIREFOX";
  if (/\b(?:Chrome|CriOS|Chromium)\//u.test(value)) return "CHROME";
  if (/\bSafari\//u.test(value)) return "SAFARI";
  return "OTHER";
}

function platformValue(value: string): WebPushPlatform {
  if (/\bAndroid\b/iu.test(value)) return "ANDROID";
  if (/\bCrOS\b/u.test(value)) return "CHROMEOS";
  if (
    /\b(?:iPhone|iPad|iPod)\b/iu.test(value) ||
    (/\bMacintosh\b/u.test(value) && /\bMobile\//u.test(value))
  ) {
    return "IOS";
  }
  if (/\bWindows\b/iu.test(value)) return "WINDOWS";
  if (/\b(?:Macintosh|Mac OS X)\b/u.test(value)) return "MACOS";
  if (/\bLinux\b/iu.test(value)) return "LINUX";
  return "OTHER";
}
