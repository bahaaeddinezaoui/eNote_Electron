// What to tell the teacher after the queue drains.
//
// A silent success leaves them unsure whether the register they recorded during
// the outage reached the server; a conflict that is only visible by noticing a
// small chip is a conflict nobody reads. The decision about which of those to
// say is kept here, apart from the wording, so it can be tested on its own.
export function describeFlushRun(run) {
  const sent = Number(run?.sent) || 0
  const conflicts = Number(run?.conflicts) || 0
  const failed = Number(run?.failed) || 0

  if (sent === 0 && conflicts === 0 && failed === 0) return null

  // Conflicts come first: even when everything else was sent, somebody has to
  // choose between two versions of the same record.
  if (conflicts > 0) {
    return { kind: sent > 0 ? 'partial' : 'review', sent, conflicts, failed }
  }
  if (failed > 0) return { kind: 'failed', sent, conflicts, failed }
  return { kind: 'sent', sent, conflicts, failed }
}
