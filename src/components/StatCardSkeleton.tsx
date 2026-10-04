export function StatCardSkeleton() {
  return (
    <div className="bg-surface border border-line rounded-md p-4 flex flex-col gap-3 animate-pulse min-h-36">
      <div className="h-2.5 w-20 bg-line rounded-sm" />
      <div className="h-9 w-24 bg-line rounded-sm" />
      <div className="h-3 w-32 bg-line/70 rounded-sm" />
      <div className="h-2.5 w-full bg-line/50 rounded-sm mt-auto" />
    </div>
  )
}
