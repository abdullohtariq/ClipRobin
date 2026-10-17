import { ProjectSkeletonCard } from "@/src/components/skeletons";

export default function ProjectsLoading() {
  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white p-6 lg:p-10">
      <div className="mx-auto max-w-4xl">
        <header className="mb-8 space-y-2">
          <div className="h-8 w-36 rounded-lg bg-zinc-800/80 skeleton-shimmer" />
          <div className="h-4 w-72 rounded bg-zinc-800/50 skeleton-shimmer" />
        </header>

        <div className="grid gap-6">
          <ProjectSkeletonCard />
          <ProjectSkeletonCard />
          <ProjectSkeletonCard />
        </div>
      </div>
    </main>
  );
}

