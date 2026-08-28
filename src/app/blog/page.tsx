import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Layers3, SearchCheck, FileText } from 'lucide-react';
import { blogPosts, formatBlogDate } from '@/lib/blog';
import { productBrand } from '@/lib/brand';
import styles from './blog.module.css';

const title = `Blog | ${productBrand.name}`;
const description =
  'Explore alternatives to Similarweb, Semrush, Ahrefs, and Appark. One Minaco subscription, multiple data sources, and AI analysis with sources included.';

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/blog' },
  openGraph: {
    type: 'website',
    title,
    description,
    url: '/blog',
    siteName: productBrand.name,
    images: [{ url: '/blog/opengraph-image', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
    images: ['/blog/opengraph-image'],
  },
};

export default function BlogIndexPage() {
  return (
    <>
      <section className={styles.indexHero}>
        <p className={styles.eyebrow}>The Minaco blog</p>
        <h1>More insight.<br /><span>One subscription.</span></h1>
        <p className={styles.indexDescription}>
          Explore a simpler way to research your competitors. Multiple data sources,
          compared by an agent, with sources included.
        </p>
        <div className={styles.benefits}>
          <span><Layers3 size={17} aria-hidden="true" /> Multiple data sources</span>
          <span><SearchCheck size={17} aria-hidden="true" /> Agent analysis</span>
          <span><FileText size={17} aria-hidden="true" /> Sources included</span>
        </div>
      </section>

      <section className={styles.articles} aria-labelledby="articles-heading">
        <div className={styles.sectionHeading}>
          <h2 id="articles-heading">Explore the alternatives</h2>
          <span>{blogPosts.length} guides</span>
        </div>
        <div className={styles.cardGrid}>
          {blogPosts.map((post) => (
            <article key={post.slug} className={styles.card}>
              <Link
                href={`/blog/${post.slug}`}
                className={styles.cardLink}
                data-analytics-cta={`blog_read_${post.slug}`}
                data-analytics-location="blog_index"
              >
                <div className={styles.cardTop}>
                  <span className={styles.category}>{post.category}</span>
                  <ArrowRight size={20} aria-hidden="true" />
                </div>
                <h3>{post.title}</h3>
                <p>{post.intro}</p>
                <div className={styles.cardBottom}>
                  <time dateTime={post.publishedAt}>{formatBlogDate(post.publishedAt)}</time>
                  <span>Read article</span>
                </div>
              </Link>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
