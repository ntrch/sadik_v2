const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = (env, argv) => {
  const isDev = argv.mode === 'development';
  return {
    entry: './src/index.tsx',
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: 'bundle.js',
      publicPath: '/',
    },
    resolve: {
      extensions: ['.tsx', '.ts', '.js', '.jsx'],
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: 'ts-loader',
          exclude: /node_modules/,
        },
        {
          test: /\.css$/,
          use: [
            isDev ? 'style-loader' : MiniCssExtractPlugin.loader,
            'css-loader',
            'postcss-loader',
          ],
        },
        {
          // SVG files — emitted as static assets, import returns a URL string.
          test: /\.svg$/i,
          type: 'asset/resource',
          generator: {
            filename: 'assets/[name].[hash:8][ext]',
          },
        },
      ],
    },
    plugins: [
      new HtmlWebpackPlugin({
        template: './src/index.html',
      }),
      ...(isDev ? [] : [new MiniCssExtractPlugin({ filename: 'styles.css' })]),
      new CopyPlugin({
        patterns: [
          { from: 'node_modules/@ricky0123/vad-web/dist', to: 'vad', noErrorOnMissing: true },
          { from: 'node_modules/onnxruntime-web/dist/*.wasm', to: 'vad/[name][ext]', noErrorOnMissing: true },
          { from: 'node_modules/onnxruntime-web/dist/*.mjs', to: 'vad/[name][ext]', noErrorOnMissing: true },
          { from: 'public/wake-models', to: 'wake-models', noErrorOnMissing: true },
          { from: 'public/animations', to: 'animations', noErrorOnMissing: true },
        ],
      }),
    ],
    ignoreWarnings: [
      // onnxruntime-web uses dynamic require() internally — harmless, assets
      // are copied via CopyPlugin.  Suppress so the overlay stays clean.
      { module: /onnxruntime-web/ },
    ],
    devServer: {
      historyApiFallback: true,
      port: 3000,
      hot: true,
      client: {
        overlay: { errors: true, warnings: false },
      },
    },
    devtool: isDev ? 'source-map' : false,
  };
};
