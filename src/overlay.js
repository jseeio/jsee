class Overlay {
  constructor (parent, id='overlay') {
    this.element = document.createElement('div')
    this.element.id = id
    this.element.className = 'jsee-overlay'
    // This DOM is created outside Vue, so scoped component selectors cannot own its geometry.
    this.element.style.cssText = 'display:none; position:absolute; inset:0; pointer-events:none; background:var(--jsee-bg-secondary, #f5f5f5); opacity:.6; z-index:1; align-items:center; justify-content:center;'
    this.parent = parent
    this.previousPosition = parent.style.position
    this.ownsPosition = getComputedStyle(parent).position === 'static'
    if (this.ownsPosition) parent.style.position = 'relative'
    parent.appendChild(this.element)

    this.progressBar = document.createElement('div')
    this.progressBar.style.cssText = 'display:none; width:200px; height:6px; background:#e0e0e0; border-radius:3px; overflow:hidden;'
    this.progressFill = document.createElement('div')
    this.progressFill.style.cssText = 'width:0%; height:100%; background:#00d1b2; border-radius:3px; transition:width 0.2s;'
    this.progressBar.appendChild(this.progressFill)
    this.element.appendChild(this.progressBar)
  }

  show () {
    this.element.style.display = 'flex'
  }

  hide () {
    this.element.style.display = 'none'
    this.setProgress(null)
  }

  destroy () {
    this.hide()
    if (this.ownsPosition && this.parent.style.position === 'relative') this.parent.style.position = this.previousPosition
    if (this.element.parentNode) {
      this.element.parentNode.removeChild(this.element)
    }
  }

  setProgress (state) {
    if (!state) {
      this.progressBar.style.display = 'none'
      this.progressFill.style.width = '0%'
      this.progressFill.style.animation = 'none'
      return
    }
    this.progressBar.style.display = 'block'
    if (state.mode === 'indeterminate') {
      this.progressFill.style.width = '30%'
      this.progressFill.style.animation = 'jsee-progress-indeterminate 1.2s ease-in-out infinite'
    } else {
      this.progressFill.style.animation = 'none'
      this.progressFill.style.width = state.value + '%'
    }
  }
}

module.exports = Overlay
