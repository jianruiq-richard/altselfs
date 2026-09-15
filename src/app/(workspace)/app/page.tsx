import { HomepageWorkspace } from '@/components/homepage-workspace';
import { connection } from 'next/server';

export default async function AppPage() {
  await connection();
  return <HomepageWorkspace />;
}
