import { saveAs } from 'file-saver'
import domtoimage from 'dom-to-image'
import showdown from 'showdown'

const { sanitizeName, columnsToRows } = require('../src/utils.js')

const mdConverter = new showdown.Converter({ tables: true })

const Blob = window['Blob']

function stringify (v) {
  return typeof v === 'string'
    ? v
    : JSON.stringify(v)
}

const component = {
  props: ['output'],
  emits: ['notification'],
  data () {
    return {
      outputName: 'output',
      isFullScreen: false,
      activeOutputTab: 0,
      lightboxSrc: null,
      _threeScene: null,
      _threeRenderer: null,
      _threeAnimId: null,
      _leafletMap: null,
      _pdfCurrentPage: 1,
      _pdfDoc: null,
    }
  },
  mounted() {
    this.outputName = this.output.alias
      ? this.output.alias
      : this.output.name
        ? sanitizeName(this.output.name)
        : 'output_' + Math.floor(Math.random() * 1000000)
    this.executeRenderFunction()
    document.addEventListener('fullscreenchange', this.onFullScreenChange)
  },
  beforeUnmount() {
    document.removeEventListener('fullscreenchange', this.onFullScreenChange)
    if (this._threeAnimId) cancelAnimationFrame(this._threeAnimId)
    if (this._threeRenderer) this._threeRenderer.dispose()
    if (this._leafletMap) this._leafletMap.remove()
  },
  // updated() {
  //   this.executeRenderFunction()
  // },
  watch: {
    'output.value': function (newValue, oldValue) {
      if (newValue !== oldValue) {
        this.$nextTick(() => {
          this.executeRenderFunction()
          if (this.output.type === 'chart') this.renderChart()
          if (this.output.type === '3d') this.render3D()
          if (this.output.type === 'map') this.renderMap()
          if (this.output.type === 'pdf') this.renderPDF()
        })
      }
    },
    'output._messages': {
      deep: true,
      handler () {
        this.$nextTick(() => {
          if (this.$refs.chatMessages) {
            this.$refs.chatMessages.scrollTop = this.$refs.chatMessages.scrollHeight
          }
        })
      }
    }
  },
  computed: {
    isRenderFunction() {
      return typeof this.output.value === 'function'
    },
    hasPlot() {
      return typeof window !== 'undefined' && !!window.Plot
    },
    hasThree() {
      return typeof window !== 'undefined' && !!window.THREE
    },
    hasLeaflet() {
      return typeof window !== 'undefined' && !!window.L
    },
    hasPdfjs() {
      return typeof window !== 'undefined' && !!window.pdfjsLib
    }
  },
  methods: {
    toggleFullScreen() {
      const el = this.$refs.cardRoot || this.$el
      if (!this.isFullScreen) {
        if (el.requestFullscreen) {
          el.requestFullscreen()
        } else if (el.webkitRequestFullscreen) {
          el.webkitRequestFullscreen()
        } else if (el.mozRequestFullScreen) {
          el.mozRequestFullScreen()
        } else if (el.msRequestFullscreen) {
          el.msRequestFullscreen()
        }
        // state will flip in onFullScreenChange
      } else {
        if (document.exitFullscreen) {
          document.exitFullscreen()
        } else if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen()
        } else if (document.mozCancelFullScreen) {
          document.mozCancelFullScreen()
        } else if (document.msExitFullscreen) {
          document.msExitFullscreen()
        }
        // state will flip in onFullScreenChange
      }
    },
    onFullScreenChange() {
      this.isFullScreen = !!document.fullscreenElement
    },
    tableToDelimited (delim) {
      const d = this.output.value
      if (!d || !d.columns) return ''
      const esc = (v) => {
        const s = String(v == null ? '' : v)
        return s.indexOf(delim) >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0
          ? '"' + s.replace(/"/g, '""') + '"'
          : s
      }
      const lines = [d.columns.map(esc).join(delim)]
      for (const row of d.rows) {
        lines.push(row.map(esc).join(delim))
      }
      return lines.join('\n')
    },
    save () {
      // Prepare filename
      let filename
      let extension
      if (this.output.filename) {
        filename = this.output.filename
      } else {
        let name = this.output.name ? this.output.name : 'output'
        switch (this.output.type) {
          case 'function':
            extension = 'png'
            break
          case 'svg':
            extension = 'svg'
            break
          case 'table':
            extension = 'csv'
            break
          case 'markdown':
            extension = 'md'
            break
          case 'image':
            extension = 'png'
            break
          case 'chart':
            extension = 'svg'
            break
          default:
            extension = 'txt'
        }
        filename = name + '.' + extension
      }

      // Prepare blob
      if (this.output.type === 'chart' && this.$refs.chartContainer) {
        const svg = this.$refs.chartContainer.querySelector('svg')
        if (svg) {
          let blob = new Blob([svg.outerHTML], { type: 'image/svg+xml;charset=utf-8' })
          saveAs(blob, filename)
        }
        return
      }
      if (this.output.type === 'image') {
        fetch(this.output.value)
          .then(r => r.blob())
          .then(blob => saveAs(blob, filename))
          .catch(() => {
            let blob = new Blob([this.output.value], {type: 'text/plain;charset=utf-8'})
            saveAs(blob, filename)
          })
        return
      }
      if (this.output.type === 'function') {
        domtoimage.toBlob(this.$refs.customContainer)
          .then(blob => {
            saveAs(blob, filename)
          })
        return
      }
      let value = this.output.type === 'table'
        ? this.tableToDelimited(',')
        : stringify(this.output.value)
      let blob = new Blob([value], {type: 'text/plain;charset=utf-8'})
      saveAs(blob, filename)
    },
    copy () {
      if (this.output.type === 'function') {
        // Copy the image to the clipboard
        domtoimage.toBlob(this.$refs.customContainer)
          .then(blob => {
            const item = new ClipboardItem({ [blob.type]: blob });
            navigator.clipboard.write([item])
              .then(() => {
                this.$emit('notification', 'Image copied to clipboard');
              })
              .catch(err => {
                console.error('Failed to copy image: ', err);
                this.$emit('notification', 'Failed to copy image');
              });
          })
          .catch(err => {
            console.error('Failed to generate image blob: ', err);
            this.$emit('notification', 'Failed to generate image');
          });
      } else if (this.output.type === 'image') {
        fetch(this.output.value)
          .then(r => r.blob())
          .then(blob => {
            const item = new ClipboardItem({ [blob.type]: blob })
            navigator.clipboard.write([item])
              .then(() => this.$emit('notification', 'Image copied to clipboard'))
              .catch(() => this.$emit('notification', 'Failed to copy image'))
          })
          .catch(() => {
            navigator.clipboard.writeText(this.output.value)
            this.$emit('notification', 'Copied image URL')
          })
      } else if (this.output.type === 'table') {
        let value = this.tableToDelimited('\t')
        navigator.clipboard.writeText(value)
        this.$emit('notification', 'Copied as TSV')
      } else {
        let value = stringify(this.output.value)
        navigator.clipboard.writeText(value)
        this.$emit('notification', 'Copied')
      }
    },
    downloadFile () {
      let filename = this.output.filename || this.output.name || 'output'
      let value = this.output.value
      if (typeof value === 'string' && value.startsWith('data:')) {
        fetch(value)
          .then(r => r.blob())
          .then(blob => saveAs(blob, filename))
          .catch(() => {
            let blob = new Blob([value], { type: 'application/octet-stream' })
            saveAs(blob, filename)
          })
      } else {
        let content = typeof value === 'string' ? value : JSON.stringify(value)
        let blob = new Blob([content], { type: 'application/octet-stream' })
        saveAs(blob, filename)
      }
    },
    renderMarkdown (text) {
      if (typeof text !== 'string') return ''
      return mdConverter.makeHtml(text)
    },
    renderChart() {
      if (!this.hasPlot || !this.$refs.chartContainer) return
      const container = this.$refs.chartContainer
      const data = this.output.value
      if (!data) return
      container.innerHTML = ''
      try {
        let plotConfig
        if (data && data.marks) {
          // Full Plot config passed directly
          plotConfig = data
        } else {
          // Build config from schema props + data
          let rows = Array.isArray(data) ? data : columnsToRows(data)
          if (!Array.isArray(rows)) return
          const mark = this.output.mark || 'dot'
          const x = this.output.x || (rows[0] && Object.keys(rows[0])[0])
          const y = this.output.y || (rows[0] && Object.keys(rows[0])[1])
          const color = this.output.color
          const markOpts = { x, y }
          if (color) markOpts.fill = color
          const Plot = window.Plot
          const markFn = Plot[mark] || Plot.dot
          plotConfig = {
            marks: [markFn(rows, markOpts)],
            width: this.output.width || 640,
            height: this.output.height || 400
          }
        }
        const svg = window.Plot.plot(plotConfig)
        container.appendChild(svg)
      } catch (e) {
        container.textContent = 'Chart error: ' + e.message
      }
    },
    render3D() {
      if (!this.hasThree || !this.$refs.threeDContainer) return
      const container = this.$refs.threeDContainer
      const data = this.output.value
      if (!data) return
      // Dispose previous scene
      if (this._threeAnimId) cancelAnimationFrame(this._threeAnimId)
      if (this._threeRenderer) {
        this._threeRenderer.dispose()
        if (this._threeRenderer.domElement && this._threeRenderer.domElement.parentNode) {
          this._threeRenderer.domElement.parentNode.removeChild(this._threeRenderer.domElement)
        }
      }
      const THREE = window.THREE
      const width = container.clientWidth || 640
      const height = this.output.height || 400
      const scene = new THREE.Scene()
      scene.background = new THREE.Color(0xf0f0f0)
      const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000)
      camera.position.set(0, 1, 3)
      const renderer = new THREE.WebGLRenderer({ antialias: true })
      renderer.setSize(width, height)
      // Remove only previous canvas, keep missing-message divs
      const oldCanvas = container.querySelector('canvas')
      if (oldCanvas) oldCanvas.remove()
      container.appendChild(renderer.domElement)
      scene.add(new THREE.AmbientLight(0xcccccc, 0.6))
      const dirLight = new THREE.DirectionalLight(0xffffff, 0.8)
      dirLight.position.set(1, 2, 3)
      scene.add(dirLight)
      this._threeScene = scene
      this._threeRenderer = renderer
      const animate = () => {
        this._threeAnimId = requestAnimationFrame(animate)
        renderer.render(scene, camera)
      }
      if (typeof data === 'object' && data.vertices) {
        // Programmatic geometry
        const geom = new THREE.BufferGeometry()
        geom.setAttribute('position', new THREE.Float32BufferAttribute(data.vertices, 3))
        if (data.faces) geom.setIndex(data.faces)
        geom.computeVertexNormals()
        const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color: 0x00d1b2 }))
        scene.add(mesh)
        animate()
      } else if (typeof data === 'string') {
        // URL to GLTF/GLB — needs GLTFLoader loaded via imports
        if (THREE.GLTFLoader) {
          const loader = new THREE.GLTFLoader()
          loader.load(data, (gltf) => {
            scene.add(gltf.scene)
            // Auto-fit camera
            const box = new THREE.Box3().setFromObject(gltf.scene)
            const center = box.getCenter(new THREE.Vector3())
            const size = box.getSize(new THREE.Vector3()).length()
            camera.position.copy(center).add(new THREE.Vector3(0, size * 0.5, size))
            camera.lookAt(center)
            animate()
          })
        } else {
          container.textContent = '3D URL loading requires GLTFLoader in imports'
        }
      }
    },
    renderMap() {
      if (!this.hasLeaflet || !this.$refs.mapContainer) return
      const container = this.$refs.mapContainer
      const data = this.output.value
      if (!data) return
      const L = window.L
      // Destroy previous map
      if (this._leafletMap) {
        this._leafletMap.remove()
        this._leafletMap = null
      }
      // Remove any existing map container content except missing message
      const existingMap = container.querySelector('.leaflet-container')
      if (existingMap) existingMap.remove()
      const mapDiv = document.createElement('div')
      mapDiv.style.width = '100%'
      mapDiv.style.height = '100%'
      container.appendChild(mapDiv)
      const zoom = this.output.zoom || data.zoom || 13
      const tiles = this.output.tiles || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
      const map = L.map(mapDiv)
      L.tileLayer(tiles, { attribution: '&copy; OpenStreetMap' }).addTo(map)
      this._leafletMap = map
      // GeoJSON
      if (data.type === 'FeatureCollection' || data.type === 'Feature') {
        const layer = L.geoJSON(data).addTo(map)
        map.fitBounds(layer.getBounds())
        return
      }
      // Markers from array or object
      const markers = Array.isArray(data) ? data : (data.markers || [])
      const center = this.output.center || data.center
      const bounds = []
      markers.forEach(m => {
        const latlng = [m.lat, m.lng]
        const marker = L.marker(latlng).addTo(map)
        if (m.popup) marker.bindPopup(m.popup)
        bounds.push(latlng)
      })
      if (center) {
        map.setView(center, zoom)
      } else if (bounds.length) {
        map.fitBounds(bounds)
      } else {
        map.setView([0, 0], 2)
      }
    },
    renderPDF() {
      if (!this.hasPdfjs || !this.$refs.pdfContainer) return
      const container = this.$refs.pdfContainer
      const data = this.output.value
      if (!data) return
      container.innerHTML = ''
      const pdfjsLib = window.pdfjsLib
      const self = this
      let loadingTask
      if (typeof data === 'string') {
        loadingTask = pdfjsLib.getDocument(data)
      } else if (data instanceof Uint8Array || data instanceof ArrayBuffer) {
        loadingTask = pdfjsLib.getDocument({ data })
      } else {
        container.textContent = 'Unsupported PDF data format'
        return
      }
      loadingTask.promise.then(pdf => {
        self._pdfDoc = pdf
        self._pdfCurrentPage = self.output.page || 1
        const renderPage = (pageNum) => {
          // Keep controls, clear canvases
          const canvases = container.querySelectorAll('canvas')
          canvases.forEach(c => c.remove())
          pdf.getPage(pageNum).then(page => {
            const containerWidth = container.clientWidth || 600
            const unscaledViewport = page.getViewport({ scale: 1 })
            const scale = containerWidth / unscaledViewport.width
            const viewport = page.getViewport({ scale })
            const canvas = document.createElement('canvas')
            canvas.width = viewport.width
            canvas.height = viewport.height
            canvas.style.display = 'block'
            canvas.style.maxWidth = '100%'
            container.appendChild(canvas)
            page.render({ canvasContext: canvas.getContext('2d'), viewport })
          })
        }
        // Controls
        const controls = document.createElement('div')
        controls.className = 'jsee-pdf-controls'
        const prevBtn = document.createElement('button')
        prevBtn.textContent = 'Prev'
        const nextBtn = document.createElement('button')
        nextBtn.textContent = 'Next'
        const pageInfo = document.createElement('span')
        const updateInfo = () => {
          pageInfo.textContent = 'Page ' + self._pdfCurrentPage + ' / ' + pdf.numPages
        }
        prevBtn.addEventListener('click', () => {
          if (self._pdfCurrentPage > 1) {
            self._pdfCurrentPage--
            updateInfo()
            renderPage(self._pdfCurrentPage)
          }
        })
        nextBtn.addEventListener('click', () => {
          if (self._pdfCurrentPage < pdf.numPages) {
            self._pdfCurrentPage++
            updateInfo()
            renderPage(self._pdfCurrentPage)
          }
        })
        controls.appendChild(prevBtn)
        controls.appendChild(pageInfo)
        controls.appendChild(nextBtn)
        container.appendChild(controls)
        updateInfo()
        renderPage(self._pdfCurrentPage)
      }).catch(err => {
        container.textContent = 'PDF error: ' + err.message
      })
    },
    executeRenderFunction() {
      if (this.isRenderFunction && this.$refs.customContainer) {
        // Clear previous content
        this.$refs.customContainer.innerHTML = ''
        // Execute the render function with the container
        this.output.value(this.$refs.customContainer)
      }
    }
  },
}

export { component }
