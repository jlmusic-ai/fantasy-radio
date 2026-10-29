import { XMLParser, XMLValidator } from "fast-xml-parser";

export const PODCAST_FEED_URL = "https://www.omnycontent.com/d/playlist/98a2599f-cd9b-4f2a-9be4-b22c00e585f2/20440a85-86d0-458b-b795-b22f01246162/b676c68a-4800-4f49-a68f-b22f01246193/podcast.rss";
const MAX_FEED_BYTES = 12 * 1024 * 1024;
const easternDate = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
});

export function isShowDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// Match publication day in Pittsburgh, including DST and UTC-midnight boundaries.
// Never substitute a nearby episode when this day's feed entry is missing.
export function episodeTitleForDate(xml: string, showDate: string): string | null {
  if (!isShowDate(showDate)) throw new Error("Invalid show date");
  if (Buffer.byteLength(xml, "utf8") > MAX_FEED_BYTES || /<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new Error("Unsupported podcast feed");
  }
  if (XMLValidator.validate(xml) !== true) throw new Error("Invalid podcast feed XML");
  const parsed = new XMLParser({
    ignoreAttributes: true, parseTagValue: false, trimValues: true, htmlEntities: true,
    isArray: (name) => name === "item",
  }).parse(xml);
  const channel = parsed?.rss?.channel;
  if (!channel || !Array.isArray(channel.item)) throw new Error("Podcast feed has no episodes");
  const titles = new Set<string>();
  for (const item of channel.item) {
    if (item["itunes:episodeType"] && item["itunes:episodeType"] !== "full") continue;
    if (typeof item.pubDate !== "string" || typeof item.title !== "string") continue;
    const published = new Date(item.pubDate);
    if (Number.isNaN(published.getTime()) || easternDate.format(published) !== showDate) continue;
    const title = item.title.trim();
    if (title && title.length <= 500) titles.add(title);
  }
  // Duplicate feed entries with the same title are safe; different full episodes
  // on one date are ambiguous and should not be guessed.
  return titles.size === 1 ? [...titles][0] : null;
}

export async function fetchEpisodeTitle(showDate: string): Promise<string | null> {
  const response = await fetch(PODCAST_FEED_URL, {
    cache: "no-store", signal: AbortSignal.timeout(12_000),
    headers: { Accept: "application/rss+xml, application/xml, text/xml" },
  });
  if (!response.ok || !response.body) throw new Error("Podcast feed is unavailable");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let xml = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_FEED_BYTES) throw new Error("Podcast feed is too large");
      xml += decoder.decode(value, { stream: true });
    }
    xml += decoder.decode();
  } finally {
    await reader.cancel();
  }
  return episodeTitleForDate(xml, showDate);
}
