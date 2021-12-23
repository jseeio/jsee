class Overlay {
  constructor (parent) {
    this.element = document.createElement('div')
    this.element.id = 'overlay'
    this.element.innerHTML = `...`
    parent.appendChild(this.element)
  }

  show () {
    this.element.style.display = 'flex'
  }

  hide () {
    this.element.style.display = 'none'
  }
}

module.exports = Overlay
