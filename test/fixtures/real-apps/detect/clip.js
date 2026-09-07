// const MODEL_URL = 'http://localhost:8080/tmp/clip.h5'
const MODEL_URL = 'https://huggingface.co/openai/clip-vit-base-patch32/resolve/main/tf_model.h5'
const VOCAB_URL = 'https://cdn.jsdelivr.net/npm/modelzoo@latest/bpe_simple_vocab_16e6.txt'

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

class CLIP {
    constructor() {
        this.tokenizer = null
        this.model = null
    }

    async load(params, app) {
        const h5 = await h5wasm.ready
        const { FS } = await h5.ready
        const log = app.log

        log('Building tokenizer from:', VOCAB_URL)
        let r1 = await fetch(VOCAB_URL)
        let vocab = await r1.text()
        this.tokenizer = new modelzoo.tokenizers.SimpleTokenizer(vocab);

        // Try loading from IndexedDB
        try {
            log('Loading model from IndexedDB')
            const modelVisual = await tf.loadLayersModel('indexeddb://clip-vit-base-patch32-visual')
            const modelText = await tf.loadLayersModel('indexeddb://clip-vit-base-patch32-text')
            const modelSimilarity = await tf.loadLayersModel('indexeddb://clip-vit-base-patch32-similarity')
            const config = {
              "patchSize": 32,
              "inputResolution": 224,
              "gridSize": 7,
              "visionWidth": 768,
              "visionLayers": 12,
              "blockSize": 77,
              "nEmbd": 512,
              "nHead": 8,
              "vocabSize": 49408,
              "nLayer": 12,
              "debug": false,
              "joint": false
            }
            this.model = new modelzoo.models.CLIP(config, modelVisual, modelText, modelSimilarity)
            log('Loaded model from IndexedDB')
        } catch (e) {
            // Try loading from URL
            log('Failed to load model from IndexedDB')
            log('Loading from:', MODEL_URL)
            log('This may take a couple of minutes...')
            let r2 = await fetch(MODEL_URL)
            let ab = await r2.arrayBuffer()
            FS.writeFile("clip.h5", new Uint8Array(ab))
            let f = new h5wasm.File("clip.h5", "r")
            this.model = await modelzoo.models.CLIP.buildModel(f, 'clip-vit-base-h5', async (stats) => {
                await app.progress(Math.round((stats["i"] / stats["total"]) * 100))
                await delay(1)
                log(`[${stats["i"]}/${stats["total"]}] Setting ${stats["name"]} with shape: [${stats["shape"]}]`)
            });

            try {
                log('Storing model in IndexedDB')
                log('Stored visual model in IndexedDB')
                await this.model.visual.save('indexeddb://clip-vit-base-patch32-visual')
                log('Stored text model in IndexedDB')
                await this.model.text.save('indexeddb://clip-vit-base-patch32-text')
                log('Stored similarity model in IndexedDB')
                await this.model.similarity.save('indexeddb://clip-vit-base-patch32-similarity')
            } catch (e) {
                log('Failed to store model in IndexedDB:', e)
            }
        }
        await app.progress(0)
    }

    async predict(data, app) {
        const imgTensor = tf.browser.fromPixels(data.img, 3);
        const embVis = this.model.encodeImage(imgTensor);

        const classes = data.classes.split(',').map(x => x.trim())
        const tokens = tf.tensor(this.tokenizer.tokenize(classes))
        const embText = this.model.encodeText(tokens);

        const [logitsPerImage, logitsPerText] = this.model.similarity.apply([embVis, embText]);
        const logitsVis = await tf.squeeze(logitsPerImage).array()

        return {
            logits: logitsVis
        }
    }

    async run(data, app) {
        app.log('Data:', data)
        switch (data.caller) {
            case 'load':
                await this.load(data, app)
                break
            case 'run':
                if (!this.model) {
                    await this.load(data, app)
                }
                app.log('Running model...')
                const pred = await this.predict(data, app)
                return pred
            default:
                throw new Error('Unknown caller')
        }

    }
}

