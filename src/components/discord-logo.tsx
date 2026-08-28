import Image from 'next/image';

// Official, unmodified white symbol from https://discord.com/branding.
export function DiscordLogo() {
  return (
    <Image
      src="/brand/discord-symbol-white.svg"
      alt=""
      aria-hidden="true"
      width={24}
      height={18}
      className="h-[18px] w-6 shrink-0"
      unoptimized
    />
  );
}
