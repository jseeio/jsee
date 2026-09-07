class Cam {
  constructor () {
    const outputs = document.getElementById('outputs')
    const pre = document.createElement('pre')
    pre.setAttribute('id', 'log')
    pre.setAttribute('style', 'overflow: scroll; height: 100px; font-size: 9px;')
    outputs.appendChild(pre)

    const videoElement = document.createElement('video')
    videoElement.setAttribute('width', '320')
    videoElement.setAttribute('height', '240')
    videoElement.setAttribute('autoplay', '')
    // videoElement.setAttribute('style', 'display: none;')
    // Make video with 100% width
    videoElement.setAttribute('style', 'width: 100%;')

    videoElement.setAttribute('id', 'video')
    outputs.appendChild(videoElement)
    this.video = videoElement

    const canvasElement = document.createElement('canvas')
    canvasElement.setAttribute('width', '320')
    canvasElement.setAttribute('height', '240')
    canvasElement.setAttribute('style', 'border:1px solid #FF0000; display: none;')
    canvasElement.setAttribute('id', 'canvas')
    outputs.appendChild(canvasElement)
    this.canvas = canvasElement

    const outputElement = document.createElement('div')
    outputElement.setAttribute('id', 'output')
    outputs.appendChild(outputElement)
  }

  async run (data, app) {
    const ctx = this.canvas.getContext('2d')
    switch (data.caller) {
      case 'load':
        if (navigator.mediaDevices.getUserMedia) {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true })
            this.video.srcObject = stream
        }
      case 'run':
        ctx.drawImage(this.video, 0, 0, 320, 240)
        await new Promise(resolve => setTimeout(resolve, 1000))
        const img = ctx.getImageData(0, 0, 320, 240)
        return { img }
    }
  }
}