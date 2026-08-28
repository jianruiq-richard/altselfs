import { DiscordLogo } from '@/components/discord-logo';
import { productBrand } from '@/lib/brand';

export function WorkspaceDiscordLink() {
  return (
    <a
      href={productBrand.discordUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Join our Discord (opens in a new tab)"
      data-analytics-cta="workspace_join_discord"
      data-analytics-location="workspace_header"
      className="inline-flex h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[7px] border border-white/10 bg-[#5865f2] px-2.5 text-xs font-semibold text-white transition-colors hover:bg-[#4752c4] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f2c36b] sm:px-3 sm:text-[13px]"
    >
      <DiscordLogo />
      <span>Join our Discord</span>
    </a>
  );
}
