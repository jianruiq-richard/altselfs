export default function DashboardLoading() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#090a0a] text-white">
      <div className="flex items-center gap-3 text-sm font-medium text-zinc-400">
        <span
          className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-100"
          aria-hidden="true"
        />
        Preparing your workspace
      </div>
    </main>
  );
}
