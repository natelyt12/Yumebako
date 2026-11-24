/**
 * Built-in general search engines selectable as the default New Tab provider.
 * @type {Array<{ id: string, label: string, icon: string, url: string }>}
 */
export const SEARCH_ENGINES = [
  {
    id: "google",
    label: "Google",
    icon: "providerGoogle",
    url: "https://www.google.com/search?q=",
  },
  {
    id: "duckduckgo",
    label: "DuckDuckGo",
    icon: "providerDuckDuckGo",
    url: "https://duckduckgo.com/?q=",
  },
  {
    id: "bing",
    label: "Bing",
    icon: "providerBing",
    url: "https://www.bing.com/search?q=",
  },
  {
    id: "brave",
    label: "Brave",
    icon: "providerBrave",
    url: "https://search.brave.com/search?q=",
  },
];

/**
 * Additional AI and platform providers exposed only via the search bar reel.
 * @type {Array<{ id: string, label: string, icon: string, url: string }>}
 */
export const EXTRA_PROVIDERS = [
  {
    id: "google_ai",
    label: "Google AI",
    icon: "providerGoogleAI",
    url: "https://www.google.com/search?udm=50&q=",
  },
  {
    id: "youtube",
    label: "YouTube",
    icon: "providerYouTube",
    url: "https://www.youtube.com/results?search_query=",
  },
  {
    id: "github",
    label: "GitHub",
    icon: "providerGitHub",
    url: "https://github.com/search?q=",
  },
  {
    id: "reddit",
    label: "Reddit",
    icon: "providerReddit",
    url: "https://www.reddit.com/search/?q=",
  },
  {
    id: "pinterest",
    label: "Pinterest",
    icon: "providerPinterest",
    url: "https://www.pinterest.com/search/pins/?q=",
  },
  {
    id: "spotify",
    label: "Spotify",
    icon: "providerSpotify",
    url: "https://open.spotify.com/search/",
  },
];

/**
 * Order providers for the reel: search engines at the top with the active
 * default engine pinned at the bottom of that group, followed by Google AI
 * and social/media platforms below the divider.
 * @param {string} defaultId
 * @returns {{ providers: Array<{ id: string, label: string, icon: string, url: string, isDefaultSlot?: boolean }>, defaultIndex: number }}
 */
export function buildOrderedProviders(defaultId) {
  const defaultEngine =
    SEARCH_ENGINES.find((p) => p.id === defaultId) || SEARCH_ENGINES[0];
  const otherEngines = SEARCH_ENGINES.filter((p) => p.id !== defaultEngine.id);
  const upper = [...otherEngines, { ...defaultEngine, isDefaultSlot: true }];
  return {
    providers: [...upper, ...EXTRA_PROVIDERS],
    defaultIndex: upper.length - 1,
  };
}

function getProviderPrefix(provider) {
  return `/${provider.id.replace(/_/g, "-")}`;
}

/**
 * Return matching `/prefix` command items for EXTRA_PROVIDERS when input starts with `/`.
 * @param {string} query
 * @returns {Array<{ type: "prefix", id: string, providerId: string, prefix: string, title: string, displayUrl: string, icon: string }>}
 */
export function getPrefixSuggestions(query) {
  if (typeof query !== "string" || !query.startsWith("/") || /\s/.test(query)) {
    return [];
  }
  const lower = query.toLowerCase();
  const term = lower.slice(1);
  return EXTRA_PROVIDERS.filter((provider) => {
    const prefix = getProviderPrefix(provider);
    if (!term) return true;
    return (
      prefix.startsWith(lower) ||
      provider.label.toLowerCase().includes(term)
    );
  }).map((provider) => {
    const prefix = getProviderPrefix(provider);
    return {
      type: "prefix",
      id: `prefix:${provider.id}`,
      providerId: provider.id,
      prefix,
      title: provider.label,
      displayUrl: prefix,
      icon: provider.icon,
    };
  });
}

/**
 * Match an exact `/prefix` or `/prefix <query>` command for EXTRA_PROVIDERS.
 * @param {string} rawInput
 * @returns {{ provider: { id: string, label: string, icon: string, url: string }, prefix: string, prefixLength: number, hasSpace: boolean, restQuery: string }|null}
 */
export function resolvePrefixCommand(rawInput) {
  if (typeof rawInput !== "string") return null;
  const match = rawInput.match(/^\/([a-z0-9-]+)(?:(\s+)(.*))?$/i);
  if (!match) return null;
  const prefix = `/${match[1].toLowerCase()}`;
  const provider = EXTRA_PROVIDERS.find(
    (p) => getProviderPrefix(p) === prefix,
  );
  if (!provider) return null;
  return {
    provider,
    prefix,
    prefixLength: prefix.length,
    hasSpace: Boolean(match[2]),
    restQuery: match[3] || "",
  };
}

const COMMON_FILE_EXTENSIONS = new Set([
  "js",
  "ts",
  "jsx",
  "tsx",
  "mjs",
  "cjs",
  "css",
  "scss",
  "less",
  "html",
  "htm",
  "json",
  "xml",
  "yaml",
  "yml",
  "toml",
  "md",
  "txt",
  "log",
  "csv",
  "sql",
  "env",
  "lock",
  "py",
  "java",
  "cpp",
  "c",
  "h",
  "hpp",
  "rs",
  "go",
  "rb",
  "php",
  "sh",
  "bat",
  "ps1",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
  "ico",
  "bmp",
  "mp3",
  "mp4",
  "wav",
  "ogg",
  "webm",
  "mov",
  "avi",
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "zip",
  "rar",
  "7z",
  "tar",
  "gz",
  "exe",
  "dll",
]);

function isValidIpv4(hostname) {
  const parts = hostname.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const num = Number(part);
    return num >= 0 && num <= 255;
  });
}

/**
 * Parse a search bar input as a direct http(s) URL when it looks like a link
 * or host address rather than a search query.
 * @param {string} raw
 * @returns {string|null} Normalized URL or null when input should be treated as a query.
 */
export function parseDirectUrl(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;

  const hasProtocol = /^https?:\/\//i.test(trimmed);
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !hasProtocol) {
    // Allow host:port (e.g. localhost:3000) while rejecting non-http schemes
    const colonIdx = trimmed.indexOf(":");
    const afterColon = trimmed.slice(colonIdx + 1);
    if (!/^\d{1,5}([/?#]|$)/.test(afterColon)) return null;
  }

  if (!hasProtocol) {
    const authority = trimmed.split(/[/?#]/)[0];
    if (authority.includes("@")) return null;
  }

  let candidate = trimmed;
  if (!hasProtocol) {
    const hostPart = trimmed.split(/[/:?#]/)[0].toLowerCase();
    const scheme =
      hostPart === "localhost" || isValidIpv4(hostPart) ? "http://" : "https://";
    candidate = scheme + trimmed;
  }

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const host = parsed.hostname.toLowerCase();
  if (!host) return null;

  if (hasProtocol) return parsed.href;
  if (host === "localhost" || isValidIpv4(host)) return parsed.href;

  if (
    !host.includes(".") ||
    host.startsWith(".") ||
    host.endsWith(".") ||
    host.includes("..")
  ) {
    return null;
  }

  const labels = host.split(".");
  if (labels.some((label) => !label || !/^[a-z0-9-]+$/i.test(label))) {
    return null;
  }

  const tld = labels[labels.length - 1];
  if (!/^([a-z]{2,24}|xn--[a-z0-9-]+)$/i.test(tld)) return null;

  // Keep bare filenames like "search.js" as queries unless a path/port/query is present
  const hasPathOrPort = /[/:?#]/.test(trimmed);
  if (!hasPathOrPort && COMMON_FILE_EXTENSIONS.has(tld)) {
    return null;
  }

  return parsed.href;
}
