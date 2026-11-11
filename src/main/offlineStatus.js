import { cacheStats, getRosterWarmup } from './offlineCache'
import { photoCacheStats } from './offlineMedia'

// What this computer is holding in case the server goes away, in one object for
// the details panel: the record cache, the photographs, and the last roster
// warm-up. Each part already carries the moment its copy was taken, so the
// panel can say how old it is.
export function getOfflineSummary() {
  return {
    records: cacheStats(),
    photos: photoCacheStats(),
    rosters: getRosterWarmup(),
    checkedAt: Date.now()
  }
}
