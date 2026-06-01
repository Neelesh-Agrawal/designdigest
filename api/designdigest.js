export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const feeds = [
    { url: 'https://www.smashingmagazine.com/feed/', source: 'Smashing Magazine', hint: 'articles' },
    { url: 'https://css-tricks.com/feed/', source: 'CSS-Tricks', hint: 'articles' },
    { url: 'https://uxdesign.cc/feed', source: 'UX Collective', hint: 'articles' },
    { url: 'https://alistapart.com/main/feed/', source: 'A List Apart', hint: 'articles' },
    { url: 'https://tympanus.net/codrops/feed/', source: 'Codrops', hint: 'inspiration' },
    { url: 'https://www.designmilk.com/feed/', source: 'Design Milk', hint: 'inspiration' },
    { url: 'https://www.creativebloq.com/feed', source: 'Creative Bloq', hint: 'inspiration' },
    { url: 'https://sidebar.io/feed.xml', source: 'Sidebar.io', hint: 'tools' },
    { url: 'https://www.nngroup.com/feed/rss/', source: 'Nielsen Norman', hint: 'articles' },
    { url: 'https://dribbble.com/jobs.rss', source: 'Dribbble Jobs', hint: 'jobs' },
    { url: 'https://feeds.feedburner.com/abduzeedo', source: 'Abduzeedo', hint: 'inspiration' },
    { url: 'https://www.awwwards.com/blog/feed/', source: 'Awwwards', hint: 'inspiration' },
  ];

  // Parse XML manually — extract items from RSS/Atom feeds
  function parseXML(xml, source, hint) {
    const items = [];
    try {
      // Support both RSS <item> and Atom <entry>
      const itemRegex = /<(?:item|entry)[\s>]([\s\S]*?)<\/(?:item|entry)>/gi;
      let match;
      while ((match = itemRegex.exec(xml)) !== null && items.length < 6) {
        const block = match[1];

        const getTag = (tag) => {
          const m = block.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i'));
          return m ? m[1].replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').trim() : '';
        };

        const getLinkAtom = () => {
          const m = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*\/?>/i);
          return m ? m[1] : '';
        };

        const getLinkRSS = () => {
          const m = block.match(/<link>([^<]+)<\/link>/i);
          return m ? m[1].trim() : '';
        };

        const title = getTag('title').slice(0, 120);
        const desc = (getTag('description') || getTag('summary') || getTag('content')).slice(0, 400);
        const url = getLinkRSS() || getLinkAtom() || getTag('id');

        if (title && url && url.startsWith('http')) {
          items.push({ title, description: desc, url, source, hint });
        }
      }
    } catch (e) {
      // silent fail per feed
    }
    return items;
  }

  async function fetchFeed(feed) {
    try {
      const r = await fetch(feed.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Designdigest/1.0)',
          'Accept': 'application/rss+xml, application/xml, text/xml, */*'
        },
        signal: AbortSignal.timeout(7000)
      });
      if (!r.ok) return [];
      const xml = await r.text();
      return parseXML(xml, feed.source, feed.hint);
    } catch {
      return [];
    }
  }

  // Fetch all feeds in parallel
  const results = await Promise.allSettled(feeds.map(fetchFeed));
  const rawItems = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value)
    .filter(i => i.title && i.url);

  if (rawItems.length === 0) {
    return res.status(200).json({ items: [], error: 'All feeds failed' });
  }

  // Send to Groq to clean and categorise
  const system = `You are a design content curator. Process these RSS items and return clean, structured JSON.

Output ONLY a valid JSON object, no markdown fences, no explanation:
{
  "items": [
    {
      "category": "articles",
      "title": "Clean readable title, no HTML",
      "description": "Two sentences. What is this and why should a designer care. Plain text only.",
      "source": "Source name",
      "url": "https://url",
      "tags": ["tag1", "tag2"]
    }
  ]
}

Category must be exactly one of: inspiration, tools, articles, jobs
- inspiration: visual work, UI showcases, brand, motion, typography, web design
- tools: design tools, Figma plugins, AI tools, dev tools for designers
- articles: UX research, design thinking, career, tutorials, case studies
- jobs: job listings, hiring, career opportunities

Use the hint field as a starting point but use judgment.
Clean all HTML tags and entities from titles and descriptions.
Skip items with empty or broken titles.
Tags: 2 specific relevant keywords only.`;

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 8000,
        temperature: 0.2,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `Process these ${rawItems.length} items:\n${JSON.stringify(rawItems)}` }
        ]
      })
    });

    if (!groqRes.ok) throw new Error(`Groq ${groqRes.status}`);

    const groqData = await groqRes.json();
    const raw = groqData.choices?.[0]?.message?.content || '';

    // Robustly extract JSON
    const jsonMatch = raw.match(/\{[\s\S]*"items"[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in Groq response');

    const parsed = JSON.parse(jsonMatch[0]);
    const items = (parsed.items || [])
      .filter(i => i.title && i.url && ['inspiration','tools','articles','jobs'].includes(i.category))
      .sort(() => Math.random() - 0.48);

    return res.status(200).json({ items });

  } catch (groqErr) {
    console.error('Groq error, using fallback:', groqErr.message);

    // Fallback: return raw items without AI processing
    const fallback = rawItems.map(item => ({
      category: item.hint,
      title: item.title,
      description: item.description.slice(0, 220),
      source: item.source,
      url: item.url,
      tags: [item.hint]
    }));

    return res.status(200).json({ items: fallback, fallback: true });
  }
}
