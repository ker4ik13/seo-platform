const OPAQUE_TOKEN_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{32,128}$/iu;

export interface OneTimeTokenFragmentRead {
  readonly shouldScrub: boolean;
  readonly token?: string;
}

/**
 * Captures only an exact token and independently tells the caller to remove
 * every non-empty fragment, including malformed or ambiguous input.
 */
export function readOneTimeTokenFragment(
  fragment: string,
  maximumLength = 4_096
): OneTimeTokenFragmentRead {
  const token = oneTimeTokenFromFragment(fragment, maximumLength);
  return {
    shouldScrub: fragment.length > 0,
    ...(token ? { token } : {})
  };
}

export function oneTimeTokenFromFragment(
  fragment: string,
  maximumLength = 4_096
): string | undefined {
  if (
    !fragment.startsWith("#") ||
    maximumLength < 80 ||
    maximumLength > 4_096
  ) {
    return undefined;
  }
  const parameters = new URLSearchParams(fragment.slice(1));
  const tokens = parameters.getAll("token");
  if (
    tokens.length !== 1 ||
    [...parameters.keys()].some((key) => key !== "token")
  ) {
    return undefined;
  }
  const token = tokens[0];
  if (
    !token ||
    token.length > maximumLength ||
    token !== token.trim() ||
    !OPAQUE_TOKEN_PATTERN.test(token)
  ) {
    return undefined;
  }
  return token;
}

export function fragmentFreeBrowserPath(location: Location): string {
  return `${location.pathname}${location.search}`;
}
