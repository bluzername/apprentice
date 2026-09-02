import { registrableDomain } from "../redaction/url.js";

/** Entertainment, news, social, video, and shopping-browsing domains (registrable domain match). */
export const CONSUMPTION_DOMAINS: readonly string[] = [
  "youtube.com", "youtu.be", "netflix.com", "twitter.com", "x.com", "reddit.com", "instagram.com",
  "tiktok.com", "facebook.com", "news.google.com", "cnn.com", "bbc.com", "bbc.co.uk", "nytimes.com",
  "espn.com", "twitch.tv", "hulu.com", "disneyplus.com", "primevideo.com", "spotify.com", "pinterest.com",
  "tumblr.com", "9gag.com", "imgur.com", "buzzfeed.com", "theguardian.com", "washingtonpost.com",
  "foxnews.com", "news.ycombinator.com", "amazon.com", "ebay.com", "etsy.com", "aliexpress.com",
  "snapchat.com", "threads.net", "bluesky.app", "bsky.app", "mastodon.social", "dailymail.co.uk",
  "vimeo.com", "dailymotion.com", "steampowered.com", "ign.com", "kotaku.com", "polygon.com"
];

const CONSUMPTION_SET: ReadonlySet<string> = new Set(CONSUMPTION_DOMAINS);
const CONSUMPTION_KEYWORDS: readonly string[] = ["news", "sports", "video", "stream", "shop", "deals"];

export function isConsumptionDomain(domain: string): boolean {
  const lowered = domain.toLowerCase();
  if (CONSUMPTION_SET.has(lowered)) return true;
  const registrable = registrableDomain(lowered);
  if (CONSUMPTION_SET.has(registrable)) return true;
  const firstLabel = registrable.split(".")[0] ?? "";
  return CONSUMPTION_KEYWORDS.some((keyword) => firstLabel === keyword || firstLabel.startsWith(`${keyword}.`));
}

/** Fraction of events on consumption domains. Events without a domain count as work. */
export function consumptionScore(domains: ReadonlyArray<string | undefined>): number {
  if (domains.length === 0) return 0;
  const hits = domains.filter((domain) => domain !== undefined && isConsumptionDomain(domain)).length;
  return Math.round((hits / domains.length) * 1000) / 1000;
}
