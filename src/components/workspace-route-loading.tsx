export function WorkspaceRouteLoading({
  label = 'Loading workspace',
}: {
  label?: string;
}) {
  return (
    <div className="grid h-full min-h-0 grid-rows-[64px_minmax(0,1fr)] bg-[#090a0a] text-zinc-100">
      <div className="hidden items-center border-b border-white/[0.09] px-6 md:flex">
        <span className="h-3 w-24 animate-pulse rounded bg-white/[0.08]" />
      </div>
      <div className="astromar-scrollbar min-h-0 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-[980px]">
          <div className="mb-7 h-8 w-56 animate-pulse rounded-md bg-white/[0.07]" />
          <div className="mb-6 grid gap-3 md:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="h-24 animate-pulse rounded-[8px] border border-white/[0.08] bg-white/[0.025]" />
            ))}
          </div>
          <div className="grid gap-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-16 animate-pulse rounded-[8px] border border-white/[0.08] bg-white/[0.02]" />
            ))}
          </div>
          <p className="mt-6 text-center text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-700">{label}</p>
        </div>
      </div>
    </div>
  );
}
