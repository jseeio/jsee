class Overlay {
  constructor (parent) {
    this.element = document.createElement('div')
    this.element.id = 'overlay'
    this.element.className = 'valign-wrapper'
    this.element.innerHTML = `
      <div class="center-align" style="width:100%">
        <div class="preloader-wrapper small active">
          <div class="spinner-layer spinner-green-only">
            <div class="circle-clipper left">
              <div class="circle"></div>
            </div><div class="gap-patch">
              <div class="circle"></div>
            </div><div class="circle-clipper right">
              <div class="circle"></div>
            </div>
          </div>
        </div>
      </div>
    `
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
