type MinacoCreditsIconProps = {
  className?: string;
  title?: string;
};

const starPath = "M0 -58C6 -25 18 -9 50 0C18 9 6 25 0 58C-6 25 -18 9 -50 0C-18 -9 -6 -25 0 -58Z";

export function MinacoCreditsIcon({ className, title }: MinacoCreditsIconProps) {
  return (
    <svg
      aria-hidden={title ? undefined : "true"}
      aria-label={title}
      className={className}
      fill="none"
      focusable="false"
      role={title ? "img" : undefined}
      shapeRendering="geometricPrecision"
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
    >
      {title ? <title>{title}</title> : null}
      <path d={starPath} fill="#F2B447" opacity="0.2" transform="translate(27.5 34.5) scale(0.38)" />
      <path d={starPath} fill="#E86F61" opacity="0.18" transform="translate(45 24.5) scale(0.19)" />
      <path d={starPath} fill="#FFF7EA" opacity="0.34" transform="translate(24.2 30.2) scale(0.09)" />
      <path d={starPath} fill="#FFD778" transform="translate(27.5 34.5) scale(0.31)" />
      <path d={starPath} fill="#E86F61" transform="translate(45 24.5) scale(0.16)" />
      <path d={starPath} fill="#FFF0D7" opacity="0.42" transform="translate(43.3 22.6) scale(0.04)" />
    </svg>
  );
}
