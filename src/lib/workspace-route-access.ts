export const PUBLIC_BUSINESS_DATABASE_PATH = '/app/product-intelligence';

export function isPublicWorkspacePathname(pathname: string) {
  return pathname === '/'
    || pathname === '/app'
    || pathname === '/app/'
    || pathname === PUBLIC_BUSINESS_DATABASE_PATH
    || pathname.startsWith(`${PUBLIC_BUSINESS_DATABASE_PATH}/`);
}
