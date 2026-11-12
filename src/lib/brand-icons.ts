/** One browser/search icon declaration for Next metadata and raw HTML pages. */
export const websiteIcons = {
  icon: [{ url: '/brand/minaco/png/minaco-favicon-96.png', sizes: '96x96', type: 'image/png' }],
  apple: [{ url: '/brand/minaco/png/minaco-apple-touch-icon-180.png', sizes: '180x180', type: 'image/png' }],
};

export const websiteIconLinks = [
  ...websiteIcons.icon.map(icon => `<link rel="icon" href="${icon.url}" sizes="${icon.sizes}" type="${icon.type}">`),
  ...websiteIcons.apple.map(icon => `<link rel="apple-touch-icon" href="${icon.url}" sizes="${icon.sizes}" type="${icon.type}">`),
].join('');
