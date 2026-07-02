import type { HTMLAttributes } from 'react'

type Tone = 'default' | 'cyan' | 'green' | 'amber' | 'rose' | 'slate' | 'violet'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone
}

const tones: Record<Tone, string> = {
  default: 'bg-stone-800 text-stone-300 border-stone-700',
  cyan: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30',
  green: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  amber: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  rose: 'bg-rose-500/10 text-rose-300 border-rose-500/30',
  slate: 'bg-stone-800 text-stone-400 border-stone-700',
  violet: 'bg-violet-500/10 text-violet-300 border-violet-500/30',
}

export function Badge({ tone = 'default', className = '', children, ...props }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${tones[tone]} ${className}`}
      {...props}
    >
      {children}
    </span>
  )
}

export default Badge
