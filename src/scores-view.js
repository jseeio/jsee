const { scoresOutputJsonSchema, getScoresOptions, jsonShapeErrors } = require('./schema')

// A built-in controller uses the same mount/update/dispose ownership as host views.
function scoresView (container, initial, output) {
  const root = document.createElement('div')
  root.className = 'jsee-scores'
  container.append(root)
  let rows = new Map()
  function update (value) {
    const errors = jsonShapeErrors(value, scoresOutputJsonSchema(), output.name || 'scores')
    if (errors.length) throw new Error(errors.join('; '))
    const { min, max, precision, format, prefix, suffix } = getScoresOptions(output)
    const formatter = new Intl.NumberFormat(undefined, {
      style: format === 'percent' ? 'percent' : 'decimal', maximumFractionDigits: precision, useGrouping: false
    })
    const counts = new Map(), next = new Map()
    // Sort a copy; HTTP/CLI results and the model's row order remain untouched.
    const ranked = value.slice().sort((a, b) => b.score - a.score)
    for (const item of ranked) {
      const occurrence = counts.get(item.label) || 0
      counts.set(item.label, occurrence + 1)
      const key = JSON.stringify([item.label, occurrence])
      let row = rows.get(key)
      if (!row) {
        row = document.createElement('div')
        row.className = 'jsee-score-row'
        for (const name of ['label', 'track', 'value']) {
          const child = document.createElement('span')
          child.className = 'jsee-score-' + name
          row.append(child)
        }
        row.children[1].append(document.createElement('span'))
      }
      const [label, track, number] = row.children
      const text = prefix + formatter.format(item.score) + suffix
      label.textContent = item.label
      number.textContent = text
      track.setAttribute('role', 'meter')
      track.setAttribute('aria-label', item.label)
      track.setAttribute('aria-valuemin', min)
      track.setAttribute('aria-valuemax', max)
      // Only the visual meter is clipped. Text and transport retain the supplied score.
      track.setAttribute('aria-valuenow', Math.max(min, Math.min(max, item.score)))
      track.setAttribute('aria-valuetext', text + (item.score < min || item.score > max ? ' (outside display range)' : ''))
      track.firstChild.style.width = `${Math.max(0, Math.min(1, (item.score - min) / (max - min))) * 100}%`
      row.classList.toggle('is-leading', item.score === ranked[0].score)
      next.set(key, row)
    }
    if (!next.size) root.textContent = 'No scores'
    else {
      if (!rows.size) root.replaceChildren()
      for (const row of next.values()) root.append(row)
      for (const [key, row] of rows) if (!next.has(key)) row.remove()
    }
    rows = next
  }
  try { update(initial) } catch (error) { root.remove(); throw error }
  return { update, dispose () { rows.clear(); root.remove() } }
}

module.exports = { scoresView }
