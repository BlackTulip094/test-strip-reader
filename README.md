# Test Strip Reader — photo detection update

This package updates your existing Expo/React project. It is not a complete replacement project.

## Install in VS Code

1. Keep a backup or commit of your current project.
2. Extract this ZIP, then copy its files into your existing project folder (the folder containing `package.json`). Replace `App.js` and `package.json`; merge the `scripts` and `public` folders with the existing folders.
3. Open VS Code's terminal in that project folder and run:

```bash
npm install
npm run web
```

`npm install` updates your existing package-lock.json. The new `preweb` script copies the matching ONNX Runtime files into `public/onnx` automatically. This update pins `onnxruntime-web` to 1.22.0 so its JavaScript and WebAssembly files stay matched.

## Files and destinations

| File | Destination in your project |
|---|---|
| App.js | App.js (replace the existing file) |
| package.json | package.json (replace the supplied version) |
| stripDetector.js | stripDetector.js, beside App.js |
| scripts/prepare-onnx.cjs | scripts/prepare-onnx.cjs |
| public/models/best.onnx | public/models/best.onnx |

The model is included in the ZIP. The generated `public/onnx` runtime files are created by the setup script, so they are not included.

If you launch Expo with a command other than `npm run web` or `npm start`, run `npm run setup:onnx` first.

## Try it

1. Open Camera from the home page.
2. Leave Ferrous selected.
3. Use Choose Photo to select a JPEG, PNG, or WebP lab image. Camera permission is not needed for this option. Or enable the camera and take a photo.
4. Click Detect & Measure Colors. The first run loads the model and can take longer.
5. Check the solid detected outlines and dashed sampling regions. Each result card corresponds to its numbered outline.
6. Compare the color cards with manual tap measurements. Tap the visible photo, not the empty margins.

Solid blue outlines are ferrous strips; cyan outlines are gray references. All detections above 50% confidence are displayed. Missing objects produce a message; detected objects can still be inspected when the other class is missing.

The whole captured/selected photo now fits inside the preview. Live camera alignment guides remain available before capture. Existing upload, lab concentration, temporary album, and point-color features remain in place.

## What the measurements mean

- Inference uses RGB pixels normalized to 0–1, resized proportionally with gray padding to 1024 × 1024.
- Detections are mapped back to the decoded original photo. Color is sampled from that original image, not the resized model input.
- The central 60% of each strip's width and height is sampled. The central 70% of each gray box's width and height is sampled to avoid its black outline. Inspect these regions on rotated or irregular strips: a rectangular detector does not segment the exact strip outline.
- Displayed color is the per-channel median RGB, its HEX value, and CIELAB converted from that representative sRGB color using D65. This is not a median over individually converted Lab pixels.
- The sampler excludes transparent pixels but does not discard pixels merely because they are light or dark. A near-clipping message prompts inspection of exposure and glare.
- Manual point sampling uses a mean over a screen-radius-based neighborhood, so it need not exactly match the median of a larger detected region.
- No gray-reference correction or concentration prediction is applied. The Lab standard and concentration calibration still need to be established.
- AI detection currently supports Ferrous in the web app, including mobile browsers. This is still-photo detection. Native Expo iOS/Android AI inference and live video detection are not included.

The model input is `images`, float32 `[1,3,1024,1024]`. Its end-to-end output is `output0`, float32 `[1,300,6]`, with rows `[x1,y1,x2,y2,confidence,classId]`. Classes are `0: sample_ferrous` and `1: gray_color_box`. The exported end-to-end head does not require an additional NMS pass.

## Vercel

Keep your existing project configuration. Use `npm run build:web` as the build command and `dist` as the output folder if those are already your Expo deployment settings. The `prebuild:web` hook prepares the runtime assets, and Expo copies `public` into the export.

Include `scripts/prepare-onnx.cjs`, `stripDetector.js`, `public/models/best.onnx`, the updated App.js/package.json, and the regenerated package-lock.json in your next commit. This package has not been deployed to your existing website.

The browser loads the model and runtime from your own site; analysis does not upload the photo. The existing Upload button still uploads to your configured S3 service when clicked.

## Troubleshooting

- Detection runtime error: run `npm run setup:onnx`, restart Expo, and refresh the browser.
- Model load error: check that `public/models/best.onnx` exists. On the deployed site, `/models/best.onnx` should return a model file, not an HTML fallback.
- Runtime files missing after deployment: verify the build command is `npm run build:web` and `/onnx/ort.wasm.min.js` is served.
- A restrictive Content Security Policy may block the runtime's worker; inspect the browser console if your deployment has custom security headers.
- No detection: use a clear, closer Ferrous photo containing the full gray reference. Do not interpret absence as a concentration result.
- The earlier validation results cover only two original scenes. Independent, unedited lab photos are still needed to evaluate generalization and color accuracy.

Runtime configuration follows the ONNX Runtime documentation:
https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html

## Checks completed for this package

- Expo SDK 54 web export passed with the supplied dependency list and updated files. The output includes the model and runtime assets.
- The actual ONNX model executed with ONNX Runtime Web's WebAssembly backend in Node. A white image produced no detections above the app threshold.
- Landscape and portrait inverse coordinate mapping, confidence filtering, inset bounds, and known-color median sampling passed focused checks.
- An annotated tile from the training backup was used only for a model execution smoke check. Its strip was not detected at the app threshold; annotation text and reduced resolution make it unsuitable for accuracy evaluation. A clean full-resolution photo is needed for the first app test.
- The test browser could not launch in this workspace. Browser UI interactions, camera capture, existing S3 upload, mobile performance, and the live Vercel deployment still need testing in your environment.
