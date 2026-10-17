import { ClipSkeletonCard } from "@/src/components/skeletons";

export default function ClipsLoading() {
  return (
    <main className="min-h-screen bg-[#09090b] text-[#f4f4f5] px-6 lg:px-10 py-6 lg:py-8">
      <div className="mx-auto max-w-[1560px] space-y-6">
        {/* Header Skeleton */}
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-5">
          <div className="flex items-center gap-3">
            <div className="h-8 w-44 rounded-lg bg-zinc-800/80 skeleton-shimmer" />
            <div className="h-6 w-20 rounded-full bg-zinc-800/50 skeleton-shimmer" />
          </div>
          <div className="h-8 w-48 rounded-xl bg-zinc-800/60 skeleton-shimmer" />
        </header>

        {/* Toolbar Skeleton */}
        <div className="h-16 rounded-2xl border border-zinc-800 bg-[#121215] p-3.5 skeleton-shimmer" />

        {/* Studio Grid Skeletons */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <ClipSkeletonCard key={`skel-route-${i}`} index={i + 1} total={6} />
          ))}
        </div>
      </div>
    </main>
  );
}

