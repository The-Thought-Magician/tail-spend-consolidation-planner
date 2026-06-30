// ---------------------------------------------------------------------------
// cron.ts — THE ENGINE
//
// Pure, deterministic, self-contained scheduling helpers used by routes.
// No DB access, no external services. Every export is a pure function of its
// arguments. Three schedule "kinds" are supported:
//   - 'cron'   : a standard 5/6-field cron expression (parsed by cron-parser).
//   - 'rate'   : a human "every N minutes|hours|days" rate, computed
//                arithmetically (no cron engine involved).
//   - 'oneoff' : a single ISO timestamp; fires once if it is in the future.
//
// All emitted instants are ISO-8601 UTC strings (…Z). Timezone handling for
// cron expressions is delegated to cron-parser via the { tz } option; rate and
// one-off kinds are timezone-agnostic (pure arithmetic on absolute instants).
// ---------------------------------------------------------------------------

import { CronExpressionParser } from 'cron-parser'

export type ScheduleKind = 'cron' | 'rate' | 'oneoff'

export interface ValidationResult {
  valid: boolean
  error?: string
}

export interface Job {
  id: string
  kind: ScheduleKind
  expr: string
  timezone?: string
  resourceId?: string
}

export interface Collision {
  windowStart: string
  windowEnd: string
  jobIds: string[]
  severity: 'low' | 'medium' | 'high'
  resourceId?: string
}

export interface HeatmapBucket {
  bucket: string
  count: number
}

export type DstTrapType = 'double_fire' | 'skip' | 'ambiguous'

export interface DstTrap {
  type: DstTrapType
  atLocal: string
  atUtc: string
}

export interface CoverageWindow {
  start: string
  end: string
  resourceId?: string
}

export interface CoverageGap {
  gapStart: string
  gapEnd: string
  durationMinutes: number
  resourceId?: string
}

export interface SpreadSuggestion {
  jobId: string
  suggestedExpr: string
  reason: string
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const RATE_RE = /^every\s+(\d+)\s+(minute|minutes|hour|hours|day|days)$/i

interface ParsedRate {
  count: number
  unitMs: number
  unit: 'minute' | 'hour' | 'day'
}

function parseRate(expr: string): ParsedRate | null {
  const m = RATE_RE.exec(expr.trim())
  if (!m) return null
  const count = parseInt(m[1], 10)
  if (!Number.isFinite(count) || count <= 0) return null
  const raw = m[2].toLowerCase()
  if (raw.startsWith('minute')) return { count, unit: 'minute', unitMs: 60_000 }
  if (raw.startsWith('hour')) return { count, unit: 'hour', unitMs: 3_600_000 }
  return { count, unit: 'day', unitMs: 86_400_000 }
}

function isValidTimezone(tz?: string): boolean {
  if (!tz) return true
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** Offset (minutes east of UTC) of a given instant in a given IANA timezone. */
function tzOffsetMinutes(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = dtf.formatToParts(date)
  const map: Record<string, number> = {}
  for (const p of parts) if (p.type !== 'literal') map[p.type] = parseInt(p.value, 10)
  // Build the "wall clock" reading as if it were UTC, then diff against the
  // real instant to recover the offset.
  const asUtc = Date.UTC(map.year, map.month - 1, map.day, map.hour, map.minute, map.second)
  return Math.round((asUtc - date.getTime()) / 60_000)
}

/** Format an instant as the local wall-clock time in a timezone (ISO-like). */
function formatLocal(date: Date, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = dtf.formatToParts(date)
  const map: Record<string, string> = {}
  for (const p of parts) if (p.type !== 'literal') map[p.type] = p.value
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}`
}

function floorToMinuteIso(iso: string): string {
  return new Date(iso).toISOString().slice(0, 16) + ':00.000Z'
}

// ---------------------------------------------------------------------------
// validateExpression
// ---------------------------------------------------------------------------

export function validateExpression(kind: ScheduleKind, expr: string): ValidationResult {
  if (kind === 'cron') {
    try {
      CronExpressionParser.parse(expr)
      return { valid: true }
    } catch (e) {
      return { valid: false, error: e instanceof Error ? e.message : 'Invalid cron expression' }
    }
  }
  if (kind === 'rate') {
    const r = parseRate(expr)
    if (!r) return { valid: false, error: 'Rate must be "every N minutes|hours|days"' }
    return { valid: true }
  }
  if (kind === 'oneoff') {
    const t = Date.parse(expr)
    if (Number.isNaN(t)) return { valid: false, error: 'One-off must be a valid ISO timestamp' }
    return { valid: true }
  }
  return { valid: false, error: `Unknown kind: ${kind}` }
}

// ---------------------------------------------------------------------------
// describeExpression
// ---------------------------------------------------------------------------

export function describeExpression(kind: ScheduleKind, expr: string, timezone = 'UTC'): string {
  const tzNote = timezone && timezone !== 'UTC' ? ` (${timezone})` : ''
  if (kind === 'rate') {
    const r = parseRate(expr)
    if (!r) return 'Invalid rate expression'
    const plural = r.count === 1 ? r.unit : `${r.unit}s`
    return r.count === 1 ? `Every ${r.unit}` : `Every ${r.count} ${plural}`
  }
  if (kind === 'oneoff') {
    const t = Date.parse(expr)
    if (Number.isNaN(t)) return 'Invalid one-off timestamp'
    return `Once at ${new Date(t).toISOString()}`
  }
  // cron
  const fields = expr.trim().split(/\s+/)
  if (fields.length < 5) return 'Invalid cron expression'
  const [min, hour, dom, month, dow] = fields
  const parts: string[] = []
  if (min === '*' && hour === '*') parts.push('every minute')
  else if (min === '0' && hour === '*') parts.push('every hour on the hour')
  else if (hour !== '*' && min !== '*') parts.push(`at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`)
  else if (min.startsWith('*/')) parts.push(`every ${min.slice(2)} minutes`)
  else parts.push(`at minute ${min}, hour ${hour}`)
  if (dom !== '*') parts.push(`on day-of-month ${dom}`)
  if (month !== '*') parts.push(`in month ${month}`)
  if (dow !== '*') parts.push(`on weekday ${dow}`)
  return parts.join(', ') + tzNote
}

// ---------------------------------------------------------------------------
// nextFirings
// ---------------------------------------------------------------------------

export function nextFirings(
  kind: ScheduleKind,
  expr: string,
  timezone = 'UTC',
  fromISO: string = new Date().toISOString(),
  count = 10,
): string[] {
  const from = new Date(fromISO)
  if (Number.isNaN(from.getTime()) || count <= 0) return []
  const tz = isValidTimezone(timezone) ? (timezone || 'UTC') : 'UTC'

  if (kind === 'cron') {
    try {
      const it = CronExpressionParser.parse(expr, { tz, currentDate: from })
      const out: string[] = []
      for (let i = 0; i < count; i++) {
        const next = it.next()
        out.push(new Date(next.getTime()).toISOString())
      }
      return out
    } catch {
      return []
    }
  }

  if (kind === 'rate') {
    const r = parseRate(expr)
    if (!r) return []
    const step = r.count * r.unitMs
    const out: string[] = []
    let t = from.getTime() + step
    for (let i = 0; i < count; i++) {
      out.push(new Date(t).toISOString())
      t += step
    }
    return out
  }

  if (kind === 'oneoff') {
    const t = Date.parse(expr)
    if (Number.isNaN(t)) return []
    return t > from.getTime() ? [new Date(t).toISOString()] : []
  }

  return []
}

// ---------------------------------------------------------------------------
// computeCollisions
// ---------------------------------------------------------------------------

export function computeCollisions(
  jobs: Job[],
  opts: { horizonDays: number; threshold: number },
): Collision[] {
  const horizonDays = Math.max(1, opts.horizonDays ?? 7)
  const threshold = Math.max(2, opts.threshold ?? 2)
  const fromISO = new Date().toISOString()
  const horizonMs = horizonDays * 86_400_000
  const cutoff = Date.now() + horizonMs
  // Generous per-job firing count so we cover the whole horizon.
  const perJob = Math.min(2000, horizonDays * 24 * 60)

  // minute bucket -> { jobIds:Set, resources: Map<resourceId, Set<jobId>> }
  const buckets = new Map<string, { jobIds: Set<string>; resources: Map<string, Set<string>> }>()

  for (const job of jobs) {
    const firings = nextFirings(job.kind, job.expr, job.timezone ?? 'UTC', fromISO, perJob)
    for (const f of firings) {
      const t = Date.parse(f)
      if (t > cutoff) break
      const minute = floorToMinuteIso(f)
      let b = buckets.get(minute)
      if (!b) {
        b = { jobIds: new Set(), resources: new Map() }
        buckets.set(minute, b)
      }
      b.jobIds.add(job.id)
      if (job.resourceId) {
        let rs = b.resources.get(job.resourceId)
        if (!rs) {
          rs = new Set()
          b.resources.set(job.resourceId, rs)
        }
        rs.add(job.id)
      }
    }
  }

  const collisions: Collision[] = []
  for (const [minute, b] of buckets) {
    const concurrency = b.jobIds.size
    // Resource contention: same resource hit by >= 2 distinct jobs in the minute.
    let contendedResource: string | undefined
    for (const [resId, jobSet] of b.resources) {
      if (jobSet.size >= 2) {
        contendedResource = resId
        break
      }
    }
    const overThreshold = concurrency >= threshold
    if (!overThreshold && !contendedResource) continue

    const windowEnd = new Date(Date.parse(minute) + 60_000).toISOString()
    let severity: Collision['severity'] = 'low'
    if (concurrency >= threshold * 2 || contendedResource) severity = 'high'
    else if (concurrency >= threshold) severity = 'medium'

    collisions.push({
      windowStart: minute,
      windowEnd,
      jobIds: [...b.jobIds].sort(),
      severity,
      resourceId: contendedResource,
    })
  }

  collisions.sort((a, b) => a.windowStart.localeCompare(b.windowStart))
  return collisions
}

// ---------------------------------------------------------------------------
// loadHeatmap
// ---------------------------------------------------------------------------

export function loadHeatmap(jobs: Job[], opts: { horizonDays: number }): HeatmapBucket[] {
  const horizonDays = Math.max(1, opts.horizonDays ?? 7)
  const fromISO = new Date().toISOString()
  const cutoff = Date.now() + horizonDays * 86_400_000
  const perJob = Math.min(2000, horizonDays * 24 * 60)

  // Bucket by hour (YYYY-MM-DDTHH:00).
  const counts = new Map<string, number>()
  for (const job of jobs) {
    const firings = nextFirings(job.kind, job.expr, job.timezone ?? 'UTC', fromISO, perJob)
    for (const f of firings) {
      const t = Date.parse(f)
      if (t > cutoff) break
      const hour = new Date(t).toISOString().slice(0, 13) + ':00:00.000Z'
      counts.set(hour, (counts.get(hour) ?? 0) + 1)
    }
  }

  return [...counts.entries()]
    .map(([bucket, count]) => ({ bucket, count }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket))
}

// ---------------------------------------------------------------------------
// dstTraps
// ---------------------------------------------------------------------------

export function dstTraps(
  kind: ScheduleKind,
  expr: string,
  timezone: string,
  fromISO: string = new Date().toISOString(),
  days = 365,
): DstTrap[] {
  if (!isValidTimezone(timezone) || timezone === 'UTC') return []
  const from = new Date(fromISO)
  if (Number.isNaN(from.getTime())) return []

  // Step day-by-day, detect offset transitions, then probe firings around the
  // transition instant.
  const traps: DstTrap[] = []
  const seen = new Set<string>()
  const dayMs = 86_400_000

  // Locate all offset-change boundaries in the window (resolution: 1 hour scan
  // near a detected day-level change).
  let prevOffset = tzOffsetMinutes(from, timezone)
  for (let d = 1; d <= days; d++) {
    const dayStart = new Date(from.getTime() + d * dayMs)
    const dayOffset = tzOffsetMinutes(dayStart, timezone)
    if (dayOffset === prevOffset) {
      prevOffset = dayOffset
      continue
    }
    // Offset changed somewhere in the previous 24h — scan hour-by-hour.
    for (let h = 0; h <= 24; h++) {
      const probe = new Date(dayStart.getTime() - dayMs + h * 3_600_000)
      const before = tzOffsetMinutes(new Date(probe.getTime() - 3_600_000), timezone)
      const after = tzOffsetMinutes(probe, timezone)
      if (before === after) continue
      const delta = after - before
      const atUtc = probe.toISOString()
      const atLocal = formatLocal(probe, timezone)
      if (seen.has(atUtc)) continue
      seen.add(atUtc)
      if (delta > 0) {
        // Spring-forward: a wall-clock interval is skipped.
        traps.push({ type: 'skip', atLocal, atUtc })
      } else {
        // Fall-back: a wall-clock interval repeats (ambiguous / double-fire).
        const firings = nextFirings(kind, expr, timezone, new Date(probe.getTime() - 3_600_000).toISOString(), 4)
        const inWindow = firings.filter((f) => {
          const t = Date.parse(f)
          return t >= probe.getTime() - 3_600_000 && t <= probe.getTime() + 3_600_000
        })
        traps.push({ type: inWindow.length >= 2 ? 'double_fire' : 'ambiguous', atLocal, atUtc })
      }
    }
    prevOffset = dayOffset
  }

  return traps
}

// ---------------------------------------------------------------------------
// coverageGaps
// ---------------------------------------------------------------------------

export function coverageGaps(
  windows: CoverageWindow[],
  jobs: Job[],
  opts: { horizonDays: number },
): CoverageGap[] {
  const horizonDays = Math.max(1, opts.horizonDays ?? 7)
  const now = Date.now()
  const cutoff = now + horizonDays * 86_400_000
  const fromISO = new Date(now).toISOString()
  const perJob = Math.min(2000, horizonDays * 24 * 60)

  // Required windows define the coverage demand; for each window we check that
  // at least one job fires inside it. A "gap" is a required window with no
  // firing (optionally constrained to a matching resourceId).
  const gaps: CoverageGap[] = []

  // Precompute firing instants per resource (and global).
  const firingsByResource = new Map<string, number[]>()
  const allFirings: number[] = []
  for (const job of jobs) {
    const fs = nextFirings(job.kind, job.expr, job.timezone ?? 'UTC', fromISO, perJob)
    for (const f of fs) {
      const t = Date.parse(f)
      if (t > cutoff) break
      allFirings.push(t)
      const key = job.resourceId ?? '*'
      const arr = firingsByResource.get(key) ?? []
      arr.push(t)
      firingsByResource.set(key, arr)
    }
  }
  allFirings.sort((a, b) => a - b)

  for (const w of windows) {
    const ws = Date.parse(w.start)
    const we = Date.parse(w.end)
    if (Number.isNaN(ws) || Number.isNaN(we) || we <= ws) continue
    const candidates = w.resourceId
      ? firingsByResource.get(w.resourceId) ?? []
      : allFirings
    const covered = candidates.some((t) => t >= ws && t <= we)
    if (!covered) {
      gaps.push({
        gapStart: new Date(ws).toISOString(),
        gapEnd: new Date(we).toISOString(),
        durationMinutes: Math.round((we - ws) / 60_000),
        resourceId: w.resourceId,
      })
    }
  }

  gaps.sort((a, b) => a.gapStart.localeCompare(b.gapStart))
  return gaps
}

// ---------------------------------------------------------------------------
// autoSpread
// ---------------------------------------------------------------------------

export function autoSpread(jobs: Job[], opts: { threshold: number }): SpreadSuggestion[] {
  const threshold = Math.max(2, opts.threshold ?? 2)
  const collisions = computeCollisions(jobs, { horizonDays: 7, threshold })
  if (collisions.length === 0) return []

  // Tally how many collisions each job participates in.
  const participation = new Map<string, number>()
  for (const col of collisions) {
    for (const id of col.jobIds) {
      participation.set(id, (participation.get(id) ?? 0) + 1)
    }
  }

  const byId = new Map(jobs.map((j) => [j.id, j]))
  const suggestions: SpreadSuggestion[] = []
  // Offset offending jobs by a deterministic minute spread to de-conflict.
  const ranked = [...participation.entries()].sort((a, b) => b[1] - a[1])

  let spreadMinute = 1
  for (const [jobId, hits] of ranked) {
    const job = byId.get(jobId)
    if (!job) continue
    let suggestedExpr = job.expr
    let reason = `Participates in ${hits} collision window(s)`

    if (job.kind === 'cron') {
      const fields = job.expr.trim().split(/\s+/)
      if (fields.length >= 5) {
        const offset = spreadMinute % 60
        fields[0] = String(offset)
        suggestedExpr = fields.join(' ')
        reason = `Shift to minute ${offset} to avoid ${hits} collision window(s)`
        spreadMinute += 7
      }
    } else if (job.kind === 'rate') {
      const r = parseRate(job.expr)
      if (r) {
        suggestedExpr = `every ${r.count} ${r.unit === 'minute' ? 'minutes' : r.unit + 's'}`
        reason = `Stagger start to avoid ${hits} collision window(s)`
      }
    }

    suggestions.push({ jobId, suggestedExpr, reason })
  }

  return suggestions
}
