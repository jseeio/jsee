class Overlay {
  constructor (parent) {
    this.element = document.createElement('div')
    this.element.id = 'overlay'
    this.element.innerHTML = ''
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
