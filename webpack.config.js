const path = require('path')
const { VueLoaderPlugin } = require('vue-loader') // Support Vue's SFCs
const TerserPlugin = require('terser-webpack-plugin') // Minimize code
const webpack = require('webpack')
const package = require('./package.json')

module.exports = (env) => {
  const config = {
    entry: './src/main.js',
    output: {
      filename: env.FULL ? 'jsee.full.js' : 'jsee.core.js',
      path: path.resolve(__dirname, 'dist'),
      publicPath: '/dist/', // Should fix Uncaught Error when downloaded: Automatic publicPath is not supported in this browser
      library: {
        type: 'umd',
        name: 'JSEE',
        export: 'default',
      },
    },
    // Define loaders
    module: {
      rules: [
        {
          test: /\.vue$/,
          loader: 'vue-loader'
        },
        {
          test: /\.js$/,
          loader: 'babel-loader'
        },
        {
          test: /\.html/,
          type: 'asset/source'
        },
        {
          test: /\.css$/,
          use: [
            'vue-style-loader',
            'css-loader',
          ]
        },
        {
          test: /worker\.js$/,
          loader: "worker-loader",
          options: {
            inline: 'no-fallback'
          },
        },
        {
          test: /\.scss$/,
          use: [
            'vue-style-loader',
            'css-loader',
            'sass-loader'
          ]
        }
      ]
    },
    plugins: [
      new VueLoaderPlugin(),
      // Replace those values in the code
      new webpack.DefinePlugin({
        'VERSION': JSON.stringify(package.version),
        'EXTENDED': JSON.stringify(!!env.FULL),
      })
    ],
    resolve: {
      alias: {
        vue$: 'vue/dist/vue.runtime.esm-bundler.js'
      },
      fallback: {}
    },
    // Update recommended size limit
    performance: {
      hints: false,
      maxEntrypointSize: env.FULL ? 2048000 : 512000,
      maxAssetSize: env.FULL ? 2048000 : 512000
    },
    // Remove comments
    optimization: {
      minimize: true,
      minimizer: [new TerserPlugin({
        extractComments: false,
        terserOptions: {
          format: {
            comments: false,
          },
        }
      })],
    },
    // Source map
    devtool: env.DEVELOPMENT
      ? 'eval-source-map'
      : false
  }

  return config
}
