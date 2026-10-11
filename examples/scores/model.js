function compare (data) {
  return { scores: [{ label: 'Alpha', score: data.alpha }, { label: 'Beta', score: data.beta }] }
}
if (typeof module !== 'undefined') module.exports = compare
