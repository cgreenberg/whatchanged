import type { Provenance } from '@/lib/provenance'
import { provenanceParts } from '@/lib/provenance'

/** `source · geography · window · as-of · adjustment`, source linked when a URL is known. */
export function ProvenanceLine({ provenance, className = '' }: { provenance: Provenance; className?: string }) {
  const [source, ...rest] = provenanceParts(provenance)
  return (
    <p className={`tnum font-mono text-[10.5px] leading-relaxed text-ink-3 ${className}`} data-testid="provenance">
      {provenance.sourceUrl ? (
        <a href={provenance.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline decoration-ink-3/50 underline-offset-2 hover:text-ink-2 hover:decoration-ink-2">
          {source}
        </a>
      ) : source}
      {rest.map((part, i) => <span key={i}> · {part}</span>)}
    </p>
  )
}
