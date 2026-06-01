export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // RSS feeds from top design sources
  const feeds = [
    // Inspiration
    { url: 'https://www.awwwards.com/blog/feed/', source: 'Awwwards', hint: 'inspiration' },
    { url: 'https://www.designmilk.com/feed/', source: 'Design Milk', hint: 'inspiration' },
    { url: 'https://www.creativebloq.com/feed', source: 'Creative Bloq', hint: 'inspiration' },
    { url: 'https://feeds.feedburner.com/abduzeedo', source: 'Abduzeedo', hint: 'inspiration' },
    { url: 'https://tympanus.net/codrops/feed/', source: 'Codrops', hint: 'inspiration' },
    // Articles
    { url: 'https://uxdesign.cc/feed', source: 'UX Collective', hint: 'articles' },
    { url: 'https://www.smashingmagazine.com/feed/', source: 'Smashing Magazine', hint: 'articles' },
    { url: 'https://css-tricks.com/feed/', source: 'CSS-Tricks', hint: 'articles' },
    { url: 'https://alistapart.com/main/feed/', source: 'A List Apart', hint: 'articles' },
    { url: 'https://www.nngroup.com/feed/rss/', source: 'Nielsen Norman', hint: 'articles' },
    // Tools
    { url: 'https://www.producthunt.com/feed?category=design-tools', source: 'Product Hunt', hint: 'tools' },
    { url: 'https://sidebar.io/feed.xml', source: 'Sidebar.io', hint: 'tools' },
    // Jobs
    { url: 'https://www.designweekjobs.com/jobs/feed/', source: 'Design Week Jobs', hint: 'jobs' },
    { url: 'https://dribbble.com/jobs.rss', source: 'Dribbble Jobs', hint: 'jobs' },
  ];

  // Fetch all RSS feeds in parallel using rss2json
  const RSS2JSON = 'https://api.rss2json.com/v1/api.json?rss_url=';

  async function fetchFeed(feed) {
    try {
      const r = await fetch(`${RSS2JSON}${encodeURIComponent(feed.url)}&count=6`, {
        signal: AbortSignal.timeout(8000)
      });
      const d = await r.json();
      if (d.status !== 'ok' || !d.items) return [];
      return d.items.map(item => ({
        title: item.title || '',
        description: item.description?.replace(/<[^>]*>/g, '').slice(0, 300) || '',
        url: item.link || '',
        source: feed.source,
        hint: feed.hint,
        pubDate: item.pubDate || ''
      }));
    } catch {
      return [];
    }
  }

  // Fetch all feeds in parallel
  const results = await Promise.allSettled(feeds.map(fetchFeed));
  const rawItems = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value)
    .filter(item => item.title && item.url)
    .slice(0, 60); // cap at 60 items for Groq

  if (rawItems.length === 0) {
    return res.status(200).json({ items: [] });
  }

  // Send to Groq to clean, categorise, summarise
  const system = `You are a design content curator. You receive raw RSS feed items and clean them up into a structured feed for designers.

Output ONLY a JSON object, no markdown, no preamble:
{
  "items": [
    {
      "category": "inspiration",
      "title": "Clean, readable title",
      "description": "Two clear sentences explaining what this is and why a designer should care. No HTML tags.",
      "source": "Source name",
      "url": "https://url",
      "tags": ["tag1", "tag2"]
    }
  ]
}

Rules:
- category must be exactly one of: inspiration, tools, articles, jobs
- Use the hint field to guide categorisation but use your judgment
- Clean up HTML entities and tags from titles and descriptions
- Make descriptions informative and designer-focused
- Tags should be 2-3 specific relevant keywords
- Skip items with no real content or broken titles
- Keep all items that have valid content`;

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 6000,
        temperature: 0.3,
        messages: [
          { role: 'system', content: system },
          {
            role: 'user',
            content: `Here are ${rawItems.length} RSS items to process:\n\n${JSON.stringify(rawItems, null, 2)}`
          }
        ]
      })
    });

    const groqData = await groqRes.json();
    const raw = groqData.choices?.[0]?.message?.content || '';
    const clean = raw.replace(/```json|```/g, '').trim();

    const jsonMatch = clean.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in Groq response');

    const parsed = JSON.parse(jsonMatch[0]);

    // Shuffle slightly so it feels fresh each time
    const shuffled = (parsed.items || []).sort(() => Math.random() - 0.48);

    res.status(200).json({ items: shuffled });

  } catch (error) {
    console.error('Groq processing error:', error);
    // Fallback: return raw items without AI processing
    const fallback = rawItems.map(item => ({
      category: item.hint,
      title: item.title,
      description: item.description.slice(0, 200),
      source: item.source,
      url: item.url,
      tags: [item.hint, item.source.toLowerCase().replace(' ', '-')]
    }));
    res.status(200).json({ items: fallback });
  }
}
