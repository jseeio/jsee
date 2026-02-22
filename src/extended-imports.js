// Extended bundle imports — only loaded when EXTENDED flag is true
// These libraries are heavy and not included in the core bundle.
// Users on the core bundle can load them manually via schema `imports`
// and they'll be detected via window globals.

window.Plot = require('@observablehq/plot')
window.THREE = require('three')
window.L = require('leaflet')
window.pdfjsLib = require('pdfjs-dist')

// Leaflet CSS
require('leaflet/dist/leaflet.css')
