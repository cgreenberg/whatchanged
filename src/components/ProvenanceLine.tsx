import type { Provenance } from '@/lib/provenance'
import { provenanceParts } from '@/lib/provenance'

/** `source · geography · window · as-of · adjustment`, source linked when a URL is known. */
export function ProvenanceLine({ provenance, className = '' }: { provenance: Provenance; className?: string }) {
  const [source, ...rest] = provenanceParts(provenance)
  return (
    <p className={`text-[11px] text-zinc-500 ${className}`} data-testid="provenance">
      {provenance.sourceUrl ? (
        <a href={provenance.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-zinc-300">
          {source}
        </a>
      ) : source}
      {rest.map((part, i) => <span key={i}> · {part}</span>)}
    </p>
  )
}
