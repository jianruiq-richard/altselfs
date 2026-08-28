export type BlogPost = {
  slug: string;
  tool: string;
  keyword: string;
  category: string;
  title: string;
  description: string;
  intro: string;
  dataTitle: string;
  dataIntro: string;
  dataPoints: readonly string[];
  example: string;
  result: string;
  cta: string;
  publishedAt: string;
};

// The approved copy lives here so the index, article pages, and sitemap stay in sync.
export const blogPosts: readonly BlogPost[] = [
  {
    "slug": "similarweb-alternatives",
    "tool": "Similarweb",
    "keyword": "Similarweb alternative",
    "category": "Website intelligence",
    "title": "Similarweb Alternative: One Subscription, More Insights",
    "description": "Looking for a Similarweb alternative? Minaco combines multiple data sources in one subscription, with AI analysis and sources for key findings.",
    "intro": "Looking for a Similarweb alternative? Get website traffic insights, search data, and a clearer view of your competitors—without paying for several separate research tools.",
    "dataTitle": "A fuller picture of website performance",
    "dataIntro": "Start with a website and go beyond a single traffic number. Minaco can bring together relevant data to help you understand its reach, audience, and acquisition channels.",
    "dataPoints": [
      "Website traffic estimates and growth trends.",
      "Traffic channels, referrals, and audience geography.",
      "Search visibility and keyword signals.",
      "Related competitors and relevant public activity."
    ],
    "example": "Analyze this website’s traffic, search visibility, and main acquisition channels. Compare the available sources and give me a summary with references.",
    "result": "You get an overview of the website’s performance, the patterns worth noticing, and the sources behind the findings.",
    "cta": "Analyze a website with Minaco",
    "publishedAt": "2026-08-28"
  },
  {
    "slug": "semrush-alternatives",
    "tool": "Semrush",
    "keyword": "Semrush alternative",
    "category": "Search intelligence",
    "title": "Semrush Alternative: One Subscription, More Insights",
    "description": "Looking for a Semrush alternative? Combine search, traffic, and competitor data in one Minaco subscription, with AI analysis and sources included.",
    "intro": "Looking for a Semrush alternative? Bring search, traffic, and competitor data together without paying for several separate tool subscriptions.",
    "dataTitle": "A fuller picture of competitor visibility",
    "dataIntro": "Search performance is one part of understanding a competitor. Minaco can combine it with traffic, audience, and other channel signals to give you more context.",
    "dataPoints": [
      "Search traffic estimates and keyword signals.",
      "Website traffic, growth trends, and audience geography.",
      "Backlink summaries and referring-domain metrics.",
      "Competitor discovery and relevant channel activity."
    ],
    "example": "Analyze this competitor’s search visibility, website traffic, and acquisition channels. Compare the available sources and explain the main findings with references.",
    "result": "You get a connected view of the competitor’s online presence, with key metrics, explanations, and sources in one analysis.",
    "cta": "Analyze a competitor with Minaco",
    "publishedAt": "2026-08-28"
  },
  {
    "slug": "ahrefs-alternatives",
    "tool": "Ahrefs",
    "keyword": "Ahrefs alternative",
    "category": "SEO intelligence",
    "title": "Ahrefs Alternative: One Subscription, More Insights",
    "description": "Looking for an Ahrefs alternative? Minaco brings search, backlink, and traffic insights together, with one subscription and AI analysis with sources.",
    "intro": "Looking for an Ahrefs alternative? Get search and backlink insights alongside other competitor data, with one subscription and an agent that handles the analysis.",
    "dataTitle": "A fuller picture of search and backlink signals",
    "dataIntro": "Keywords and backlinks help describe a website’s online presence. Minaco can connect those signals with traffic and other relevant data so you can see more of the picture.",
    "dataPoints": [
      "Organic keyword and search traffic estimates.",
      "Backlink counts and referring-domain metrics.",
      "URL and domain authority signals.",
      "Website traffic and relevant competitor activity."
    ],
    "example": "Analyze this website’s search visibility, backlink metrics, and traffic signals. Bring the available data together and summarize the findings with sources.",
    "result": "You get an overview of the website’s search and link presence, explained alongside other available signals and supported by source references.",
    "cta": "Analyze a website with Minaco",
    "publishedAt": "2026-08-28"
  },
  {
    "slug": "appark-alternatives",
    "tool": "Appark",
    "keyword": "Appark alternatives",
    "category": "App intelligence",
    "title": "Appark Alternatives: One Subscription, More Insights",
    "description": "Exploring Appark alternatives? Minaco combines app estimates and wider market signals in one subscription, with AI analysis and sources included.",
    "intro": "Exploring Appark alternatives? Bring app downloads, revenue estimates, and wider market signals together in one place—with an agent to make sense of them.",
    "dataTitle": "A fuller picture of app performance",
    "dataIntro": "An app’s story extends beyond its store listing. Minaco can combine app intelligence with related website, search, and social signals to give you a broader view of its market presence.",
    "dataPoints": [
      "App Store and Google Play app information.",
      "Download and revenue estimates, with country breakdowns where available.",
      "Ratings, pricing, and competitor app discovery.",
      "Related website, search, and social activity."
    ],
    "example": "Analyze this app’s downloads, revenue estimates, competitors, and wider market presence. Compare the available sources and give me a clear summary with references.",
    "result": "You get a broader app analysis that connects store performance with other market signals, with sources alongside the key findings.",
    "cta": "Analyze an app with Minaco",
    "publishedAt": "2026-08-28"
  }
];

export function getBlogPost(slug: string): BlogPost | undefined {
  return blogPosts.find((post) => post.slug === slug);
}

export const blogCtaHref =
  '/sign-in?method=email&redirect_url=%2Finvestor%2Fchat%2F100';

export const blogTagline =
  'One subscription. Multiple data sources. More complete insights.';

export const blogFaqs = [
  {
    question: 'Do I need separate subscriptions to the data tools?',
    answer: 'No. The data capabilities included in your Minaco plan can be used through Minaco without separate subscriptions to those tools.',
  },
  {
    question: 'Do I need to collect and compare the data myself?',
    answer: 'No. Describe what you want to research, and Minaco handles the data gathering and analysis using available sources.',
  },
  {
    question: 'Can I see where the information comes from?',
    answer: 'Yes. Minaco includes source references alongside key findings so you can review the basis for the analysis.',
  },
] as const;

export function formatBlogDate(date: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(date));
}
