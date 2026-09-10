// Web-only runtime is loaded on demand, so native Expo can still open the app.
// Contract verified from best.onnx: float32 RGB [1,3,1024,1024],
// end-to-end output [1,300,6]: x1,y1,x2,y2,confidence,classId.
const SIZE = 1024;
const MIN_CONFIDENCE = 0.5;
const CLASSES = ['sample_ferrous', 'gray_color_box'];
let runtimePromise;
let sessionPromise;
let busy = false;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function loadRuntime() {
  if (!runtimePromise) {
    runtimePromise = new Promise((resolve, reject) => {
      if (window.ort) { resolve(window.ort); return; }
      const script = document.createElement('script');
      script.src = '/onnx/ort.wasm.min.js';
      script.onload = () => {
        if (window.ort) resolve(window.ort);
        else { script.remove(); reject(new Error('The detection runtime did not initialize.')); }
      };
      script.onerror = () => {
        script.remove();
        reject(new Error('Could not load detection. Run npm run setup:onnx, then restart the app.'));
      };
      document.head.appendChild(script);
    }).catch(error => { runtimePromise = null; throw error; });
  }
  return runtimePromise;
}

async function getSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const ort = await loadRuntime();
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.wasmPaths = new URL('/onnx/', window.location.href).href;
      // Works without COOP/COEP headers on the existing Vercel deployment.
      ort.env.wasm.proxy = true;
      const response = await fetch('/models/best.onnx');
      if (!response.ok) throw new Error('Could not load public/models/best.onnx. Check that the model was copied.');
      const bytes = await response.arrayBuffer();
      try {
        const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
        return { ort, session };
      } catch (error) {
        throw new Error(`Could not initialize the model. Check the model and runtime files. ${error.message || error}`);
      }
    })().catch(error => { sessionPromise = null; throw error; });
  }
  return sessionPromise;
}

export function letterboxGeometry(width, height) {
  const scale = Math.min(SIZE / width, SIZE / height);
  const resizedWidth = Math.round(width * scale);
  const resizedHeight = Math.round(height * scale);
  return { scale, resizedWidth, resizedHeight,
    left: Math.round((SIZE - resizedWidth) / 2 - 0.1),
    top: Math.round((SIZE - resizedHeight) / 2 - 0.1) };
}

export function decodeDetections(output, width, height, geometry) {
  if (output.dims.length !== 3 || output.dims[0] !== 1 || output.dims[2] !== 6) {
    throw new Error(`Unexpected model output: ${output.dims.join(' × ')}. Expected 1 × 300 × 6.`);
  }
  const detections = [];
  for (let i = 0; i < output.data.length; i += 6) {
    const [x1, y1, x2, y2, score, classId] = Array.from(output.data.slice(i, i + 6));
    if (![x1,y1,x2,y2,score,classId].every(Number.isFinite) || score < MIN_CONFIDENCE || !Number.isInteger(classId) || !CLASSES[classId]) continue;
    const x = clamp((x1 - geometry.left) / geometry.scale, 0, width);
    const y = clamp((y1 - geometry.top) / geometry.scale, 0, height);
    const right = clamp((x2 - geometry.left) / geometry.scale, 0, width);
    const bottom = clamp((y2 - geometry.top) / geometry.scale, 0, height);
    if (right - x < 2 || bottom - y < 2) continue;
    detections.push({ classId, className: CLASSES[classId], score, box: { x, y, width: right - x, height: bottom - y } });
  }
  return detections.sort((a, b) => b.score - a.score);
}

export function sampleRegion(context, box, classId) {
  // Central 60% of the strip and 70% of the gray reference, on each axis.
  const inset = classId === 0 ? 0.2 : 0.15;
  const x = Math.ceil(box.x + box.width * inset);
  const y = Math.ceil(box.y + box.height * inset);
  const width = Math.floor(box.x + box.width * (1 - inset)) - x;
  const height = Math.floor(box.y + box.height * (1 - inset)) - y;
  if (width < 1 || height < 1) return { error: 'Region too small to measure.' };
  const { data } = context.getImageData(x, y, width, height);
  const channels = [[], [], []];
  let clipped = 0;
  const stride = Math.max(1, Math.ceil(Math.sqrt(width * height / 50000)));
  for (let row = 0; row < height; row += stride) {
    for (let col = 0; col < width; col += stride) {
      const i = (row * width + col) * 4;
      if (data[i + 3] < 200) continue;
      for (let c = 0; c < 3; c++) channels[c].push(data[i + c]);
      if (Math.min(data[i], data[i+1], data[i+2]) <= 2 || Math.max(data[i], data[i+1], data[i+2]) >= 253) clipped++;
    }
  }
  const count = channels[0].length;
  if (count < 20) return { error: 'Too few pixels. Take a closer photo.' };
  // Keep bright/dark pixels; intensity filtering can bias light or dark samples.
  const medians = channels.map(values => {
    values.sort((a,b) => a-b);
    const mid = Math.floor(values.length / 2);
    return values.length % 2 ? values[mid] : (values[mid-1] + values[mid]) / 2;
  });
  return { rgb: { r: medians[0], g: medians[1], b: medians[2] },
    sampleBox: { x, y, width, height }, pixelCount: count, clippedRatio: clipped / count };
}

export async function detectStripColors(photoUri) {
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') {
    throw new Error('AI photo analysis requires a browser with image decoding support.');
  }
  if (busy) throw new Error('Another photo is still being analyzed. Please try again shortly.');
  busy = true;
  let bitmap, original, resized, input, outputs;
  try {
    const { ort, session } = await getSession();
    const response = await fetch(photoUri);
    if (!response.ok) throw new Error('Could not read the photo.');
    bitmap = await createImageBitmap(await response.blob(), { imageOrientation: 'from-image' });
    const width = bitmap.width, height = bitmap.height;
    const geometry = letterboxGeometry(width, height);
    original = document.createElement('canvas'); original.width = width; original.height = height;
    const context = original.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Color sampling is unavailable in this browser.');
    context.drawImage(bitmap, 0, 0);
    resized = document.createElement('canvas'); resized.width = SIZE; resized.height = SIZE;
    const ctx = resized.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Image preprocessing is unavailable in this browser.');
    ctx.fillStyle = 'rgb(114,114,114)'; ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.drawImage(bitmap, geometry.left, geometry.top, geometry.resizedWidth, geometry.resizedHeight);
    const rgba = ctx.getImageData(0, 0, SIZE, SIZE).data;
    const plane = SIZE * SIZE, tensorData = new Float32Array(3 * plane);
    for (let i = 0; i < plane; i++) {
      tensorData[i] = rgba[i*4] / 255;
      tensorData[plane+i] = rgba[i*4+1] / 255;
      tensorData[2*plane+i] = rgba[i*4+2] / 255;
    }
    input = new ort.Tensor('float32', tensorData, [1,3,SIZE,SIZE]);
    outputs = await session.run({ [session.inputNames[0]]: input });
    const detections = decodeDetections(outputs[session.outputNames[0]], width, height, geometry)
      .map(d => ({ ...d, color: sampleRegion(context, d.box, d.classId) }));
    const warnings = [];
    if (!detections.some(d => d.classId === 0)) warnings.push('No ferrous strip detected at 50% confidence. Try a closer, clearer photo.');
    const grayCount = detections.filter(d => d.classId === 1).length;
    if (!grayCount) warnings.push('No gray reference detected. Include the full gray box in the photo.');
    if (grayCount > 1) warnings.push('Multiple gray references detected. Check the outlines before using these readings.');
    return { photoSize: { width, height }, detections, warnings };
  } finally {
    input?.dispose();
    if (outputs) Object.values(outputs).forEach(t => t.dispose());
    bitmap?.close();
    if (original) { original.width = 1; original.height = 1; }
    if (resized) { resized.width = 1; resized.height = 1; }
    busy = false;
  }
}
