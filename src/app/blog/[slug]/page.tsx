import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, ChevronRight, Check } from 'lucide-react';
import {
  blogCtaHref,
  blogFaqs,
  blogPosts,
  blogTagline,
  formatBlogDate,
  getBlogPost,
} from '@/lib/blog';
import { productBrand } from '@/lib/brand';
import styles from '../blog.module.css';

type Props = { params: Promise<{ slug: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return blogPosts.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) notFound();

  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      type: 'article',
      title: post.title,
      description: post.description,
      url: `/blog/${post.slug}`,
      siteName: productBrand.name,
      publishedTime: post.publishedAt,
      authors: [productBrand.name],
      images: [{ url: '/blog/opengraph-image', width: 1200, height: 630, alt: blogTagline }],
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description: post.description,
      images: ['/blog/opengraph-image'],
    },
  };
}

export default async function BlogArticlePage({ params }: Props) {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) notFound();

  const url = `${productBrand.canonicalUrl}/blog/${post.slug}`;
  const structuredData = [
    {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: post.title,
      description: post.description,
      datePublished: post.publishedAt,
      inLanguage: 'en-US',
      mainEntityOfPage: { '@type': 'WebPage', '@id': url },
      url,
      image: `${productBrand.canonicalUrl}/blog/opengraph-image`,
      author: { '@type': 'Organization', name: productBrand.name, url: productBrand.canonicalUrl },
      publisher: {
        '@type': 'Organization',
        name: productBrand.name,
        url: productBrand.canonicalUrl,
        logo: {
          '@type': 'ImageObject',
          url: `${productBrand.canonicalUrl}/brand/minaco/png/minaco-app-icon-512.png`,
        },
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: productBrand.name, item: productBrand.canonicalUrl },
        { '@type': 'ListItem', position: 2, name: 'Blog', item: `${productBrand.canonicalUrl}/blog` },
        { '@type': 'ListItem', position: 3, name: post.title, item: url },
      ],
    },
  ];

  const contents = [
    ['one-subscription', 'One subscription'],
    ['data-coverage', 'The data you can explore'],
    ['agent-analysis', 'Agent analysis'],
    ['sources', 'Sources included'],
    ['get-started', 'How it works'],
    ['faq', 'Frequently asked questions'],
  ];

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }}
      />
      <nav className={styles.breadcrumbs} aria-label="Breadcrumb">
        <Link href="/">{productBrand.name}</Link>
        <ChevronRight size={13} aria-hidden="true" />
        <Link href="/blog">Blog</Link>
        <ChevronRight size={13} aria-hidden="true" />
        <span aria-current="page">{post.keyword}</span>
      </nav>

      <article>
        <header className={styles.articleHeader}>
          <p className={styles.eyebrow}>{post.category}</p>
          <h1>{post.title}</h1>
          <p className={styles.articleTagline}>{blogTagline}</p>
          <div className={styles.byline}>
            <span>By <Link href="/">{productBrand.name}</Link></span>
            <span aria-hidden="true">·</span>
            <time dateTime={post.publishedAt}>{formatBlogDate(post.publishedAt)}</time>
          </div>
        </header>

        <div className={styles.articleLayout}>
          <aside className={styles.sidebar} aria-label="Article navigation">
            <p className={styles.sidebarLabel}>On this page</p>
            <nav aria-label="Table of contents">
              {contents.map(([id, label]) => <a href={`#${id}`} key={id}>{label}</a>)}
            </nav>
            <div className={styles.sidebarCta}>
              <span>One subscription.<br />More insight.</span>
              <Link
                href={blogCtaHref}
                data-analytics-cta={`blog_${post.slug}_sidebar`}
                data-analytics-location="blog_sidebar"
              >
                Try Minaco <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </div>
          </aside>

          <div className={styles.prose}>
            <p className={styles.lead}>{post.intro}</p>
            <p>
              Minaco gives you access to multiple data capabilities through one subscription.
              Its agent gathers relevant information, cross-checks sources, and turns the results
              into a more complete analysis.
            </p>

            <section id="one-subscription">
              <h2>One subscription for multiple data capabilities</h2>
              <p>Research across several tools can mean separate subscriptions, separate tabs, and plenty of manual work.</p>
              <p>
                Minaco brings traffic, search, backlink, app, and other market intelligence
                capabilities into one place. Use the data capabilities included in your plan
                without subscribing separately to each tool. The agent selects relevant sources
                for your question and brings the results together.
              </p>
              <p>You spend less time switching between tools and more time understanding the results.</p>
              <Link href="/pricing" className={styles.textLink}>View plans and included credits <ArrowRight size={14} aria-hidden="true" /></Link>
            </section>

            <section id="data-coverage">
              <h2>{post.dataTitle}</h2>
              <p>{post.dataIntro}</p>
              <p>Depending on the target and available data, your analysis can include:</p>
              <ul className={styles.dataPoints}>
                {post.dataPoints.map((point) => <li key={point}><Check size={17} aria-hidden="true" /><span>{point}</span></li>)}
              </ul>
            </section>

            <section id="agent-analysis">
              <h2>Let an agent connect the data</h2>
              <p>Individual metrics tell part of the story. Minaco compares relevant signals across sources and explains how they fit together.</p>
              <p>
                The agent highlights patterns, puts differences in context, and brings scattered
                findings into one analysis. You get a clearer understanding of what the data
                suggests, with gaps and uncertainty identified where they matter.
              </p>
            </section>

            <section id="sources">
              <h2>See where the insights come from</h2>
              <p>Your analysis includes sources for key findings, so you can see where the information comes from.</p>
              <p>
                Metrics and interpretation sit together. You can read the summary, review the
                evidence, and understand the basis for the conclusions without reconstructing
                the research yourself.
              </p>
            </section>

            <section id="get-started">
              <h2>Get your analysis in three steps</h2>
              <ol className={styles.steps}>
                <li><strong>Enter a website or app.</strong> Tell Minaco what you want to understand.</li>
                <li><strong>Let the agent gather and compare.</strong> Minaco uses relevant data capabilities and brings the findings together.</li>
                <li><strong>Read the analysis.</strong> Get key metrics, explanations, and source references in one place.</li>
              </ol>
              <p>Try a request like:</p>
              <blockquote>{post.example}</blockquote>
              <p>{post.result}</p>
            </section>

            <section id="faq">
              <h2>Frequently asked questions</h2>
              <div className={styles.faqs}>
                {blogFaqs.map((faq) => (
                  <div key={faq.question}>
                    <h3>{faq.question}</h3>
                    <p>{faq.answer}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className={styles.articleCta} aria-labelledby="article-cta-heading">
              <h2 id="article-cta-heading">More insight from one subscription</h2>
              <p>
                Bring your research together with Minaco: multiple data capabilities, an agent
                to compare the evidence, and a more complete analysis with sources.
              </p>
              <Link
                href={blogCtaHref}
                className={styles.button}
                data-analytics-cta={`blog_${post.slug}_get_started`}
                data-analytics-location="blog_article_end"
              >
                {post.cta} <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </section>
            <p className={styles.disclaimer}>Data coverage and usage limits depend on the source and your plan.</p>
          </div>
        </div>
      </article>

      <section className={styles.related} aria-labelledby="related-heading">
        <div className={styles.sectionHeading}>
          <h2 id="related-heading">More from the blog</h2>
          <Link href="/blog">All articles <ArrowRight size={14} aria-hidden="true" /></Link>
        </div>
        <div className={styles.relatedGrid}>
          {blogPosts.filter((item) => item.slug !== post.slug).map((item) => (
            <Link href={`/blog/${item.slug}`} key={item.slug} className={styles.relatedCard}>
              <span className={styles.category}>{item.category}</span>
              <h3>{item.title}</h3>
              <span className={styles.readMore}>Read article <ArrowRight size={14} aria-hidden="true" /></span>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
