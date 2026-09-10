const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'node_modules', 'onnxruntime-web', 'dist');
const destination = path.join(root, 'public', 'onnx');
fs.mkdirSync(destination, { recursive: true });
for (const file of ['ort.wasm.min.js', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
  fs.copyFileSync(path.join(source, file), path.join(destination, file));
}
if (!fs.existsSync(path.join(root, 'public', 'models', 'best.onnx'))) {
  throw new Error('Copy best.onnx into public/models/best.onnx before running the app.');
}
console.log('ONNX Runtime web assets are ready.');
