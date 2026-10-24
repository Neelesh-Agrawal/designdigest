// Pulls the latest posts from design RSS/Atom feeds and returns clean, dated, categorised items.
// No AI step: categories come from the feed, so the response is fast and never truncated by a token limit.
const FEEDS = [
  { url: 'https://www.smashingmagazine.com/feed/', source: 'Smashing Magazine', cat: 'articles' },
  { url: 'https://css-tricks.com/feed/', source: 'CSS-Tricks', cat: 'articles' },
  { url: 'https://uxdesign.cc/feed', source: 'UX Collective', cat: 'articles' },
  { url: 'https://alistapart.com/main/feed/', source: 'A List Apart', cat: 'articles' },
  { url: 'https://www.nngroup.com/feed/rss/', source: 'Nielsen Norman', cat: 'articles' },
  { url: 'https://tympanus.net/codrops/feed/', source: 'Codrops', cat: 'inspiration' },
  { url: 'https://www.designmilk.com/feed/', source: 'Design Milk', cat: 'inspiration' },
  { url: 'https://www.creativebloq.com/feed', source: 'Creative Bloq', cat: 'inspiration' },
  { url: 'https://feeds.feedburner.com/abduzeedo', source: 'Abduzeedo', cat: 'inspiration' },
  { url: 'https://www.awwwards.com/blog/feed/', source: 'Awwwards', cat: 'inspiration' },
  { url: 'https://sidebar.io/feed.xml', source: 'Sidebar', cat: 'tools' },
  { url: 'https://dribbble.com/jobs.rss', source: 'Dribbble Jobs', cat: 'jobs' },
];
const PER_FEED = 8;

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
const decode = s => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
const strip = s => decode(decode(s).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

// cut at a sentence or word boundary, never mid-word
function summary(text, max = 200) {
  const t = text.replace(/\s*(The post .* appeared first on .*|Continue reading.*|Read more.*)$/i, '').replace(/\s*\[[^\]]*\]?\s*$/, '').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
  return stop > max * 0.5 ? cut.slice(0, stop + 1) : cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:\s]+$/, '') + '…';
}

function parse(xml, feed) {
  const items = [];
  const re = /<(item|entry)[\s>]([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(xml)) && items.length < PER_FEED) {
    const b = m[2];
    const tag = t => { const x = b.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)<\\/${t}>`, 'i')); return x ? x[1] : ''; };
    const title = strip(tag('title')).slice(0, 160);
    const url = (b.match(/<link>([^<]+)<\/link>/i)?.[1] || b.match(/<link[^>]+rel=["']alternate["'][^>]*href=["']([^"']+)/i)?.[1] || b.match(/<link[^>]+href=["']([^"']+)/i)?.[1] || '').trim();
    if (!title || !/^https?:/.test(url)) continue;
    const rawBody = tag('content:encoded') || tag('description') || tag('summary') || tag('content');
    const body = decode(rawBody);
    const image = (b.match(/<media:content[^>]+url=["']([^"']+\.(?:jpe?g|png|webp|gif)[^"']*)/i)?.[1]
      || b.match(/<media:thumbnail[^>]+url=["']([^"']+)/i)?.[1]
      || b.match(/<enclosure[^>]+url=["']([^"']+)["'][^>]*type=["']image/i)?.[1]
      || b.match(/<enclosure[^>]+type=["']image[^>]+url=["']([^"']+)/i)?.[1]
      || body.match(/<img[^>]+src=["']([^"']+)/i)?.[1] || '').replace(/&amp;/g, '&');
    const date = new Date(strip(tag('pubDate') || tag('published') || tag('updated') || tag('dc:date')));
    items.push({
      category: feed.cat,
      title,
      description: summary(strip(rawBody)),
      source: feed.source,
      url,
      image: /^https:\/\//.test(image) ? image : '',
      date: isNaN(date) ? null : date.toISOString(),
    });
  }
  return items;
}

async function load(feed) {
  try {
    const r = await fetch(feed.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Designdigest/2.0)', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
      signal: AbortSignal.timeout(6000),
    });
    return r.ok ? parse(await r.text(), feed) : [];
  } catch {
    return [];
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const results = await Promise.all(FEEDS.map(load));
  const seen = new Set();
  const items = results.flat()
    .filter(i => !seen.has(i.url) && seen.add(i.url))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const sources = FEEDS.map((f, i) => ({ source: f.source, ok: results[i].length > 0 }));

  // cache at the edge for 15 minutes, serve stale while refreshing
  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
  return res.status(200).json({ items, sources, fetchedAt: new Date().toISOString() });
}
