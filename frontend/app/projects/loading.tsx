import { ProjectSkeletonCard } from "@/src/components/skeletons";

export default function ProjectsLoading() {
  return (
    <main className="min-h-screen bg-[#09090b] text-[#f4f4f5] p-4 md:p-8 xl:p-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex items-center justify-between gap-4 pb-6 border-b border-zinc-800/80">
          <div className="space-y-2">
            <div className="h-8 w-36 rounded-lg bg-zinc-800/80 skeleton-shimmer" />
            <div className="h-4 w-72 rounded bg-zinc-800/50 skeleton-shimmer" />
          </div>
          <div className="h-10 w-32 rounded-xl bg-zinc-800/70 skeleton-shimmer" />
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ProjectSkeletonCard />
          <ProjectSkeletonCard />
          <ProjectSkeletonCard />
          <ProjectSkeletonCard />
        </div>
      </div>
    </main>
  );
}
