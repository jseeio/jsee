const path = require('path')
const { VueLoaderPlugin } = require('vue-loader') // Support Vue's SFCs
const TerserPlugin = require('terser-webpack-plugin') // Minimize code
const webpack = require('webpack')
const package = require('./package.json')

module.exports = (env) => {
  const config = {
    entry: './main.js',
    output: {
      filename: env.RUNTIME ? 'jsee.runtime.js' : 'jsee.js',
      path: path.resolve(__dirname, 'dist'),
      library: {
        type: 'umd',
        name: 'JSEE',
        export: 'default',
      },
    },
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
        'RUNTIME': JSON.stringify(env.RUNTIME),
      })
    ],
    // Load different versions of vue based on RUNTIME value
    resolve: {
      alias: {
        vue$: env.RUNTIME
          ? 'vue/dist/vue.runtime.esm-bundler.js'
          : 'vue/dist/vue.esm-bundler'
      },
    },
    // Update recommended size limit
    performance: {
      hints: false,
      maxEntrypointSize: 512000,
      maxAssetSize: 512000
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
    }
  }

  return config
}
