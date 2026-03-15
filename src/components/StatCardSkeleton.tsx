export function StatCardSkeleton() {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 flex flex-col gap-3 animate-pulse">
      <div className="h-3 w-20 bg-zinc-700 rounded" />
      <div className="h-10 w-24 bg-zinc-700 rounded" />
      <div className="h-4 w-32 bg-zinc-700 rounded" />
      <div className="h-3 w-full bg-zinc-800 rounded mt-auto" />
    </div>
  )
}
