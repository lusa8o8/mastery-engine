export const ERROR_TYPES = {
  conceptual_gap: 'Conceptual Gap',
  trap_failure:   'Trap Failure',
  careless:       'Careless Error',
  time_pressure:  'Time Pressure',
  recall_failure: 'Recall Failure'
}

export const LAYERS = [
  { id: 'foundation', label: 'Foundation', order: 1 },
  { id: 'drills',     label: 'Drills',     order: 2 },
  { id: 'patterns',   label: 'Patterns',   order: 3 },
  { id: 'traps',      label: 'Traps',      order: 4 },
  { id: 'pressure',   label: 'Pressure',   order: 5 },
  { id: 'recall',     label: 'Recall',     order: 6 }
]

export const LAYER_IDS = LAYERS.map(l => l.id)

export function getNextLayer(currentId) {
  const current = LAYERS.find(l => l.id === currentId)
  if (!current) return null
  return LAYERS.find(l => l.order === current.order + 1) || null
}
