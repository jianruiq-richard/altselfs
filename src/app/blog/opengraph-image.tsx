import { ImageResponse } from 'next/og';
import { productBrand } from '@/lib/brand';

export const alt = 'Minaco — one subscription, multiple data sources, more complete insights.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function BlogOpenGraphImage() {
  return new ImageResponse(
    (
      <div style={{
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        width: '100%', height: '100%', padding: '62px 72px', background: '#090909',
        color: '#fffaf0', fontFamily: 'sans-serif',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 34, fontWeight: 700 }}>{productBrand.name}</span>
          <span style={{ color: '#f2c36b', fontSize: 22 }}>THE MINACO BLOG</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 74, fontWeight: 700, letterSpacing: -3 }}>
          <span>One subscription.</span>
          <span style={{ color: '#f2c36b' }}>More complete insights.</span>
        </div>
        <div style={{ display: 'flex', borderTop: '1px solid #353027', paddingTop: 28, fontSize: 26, color: '#c6bfb3' }}>
          Multiple data sources. Agent analysis. Sources included.
        </div>
      </div>
    ),
    size,
  );
}
