# Live detection update

Replace App.js and stripDetector.js in your existing project with the two files in this ZIP. Keep your existing best.onnx, package.json, runtime files and Vercel setup. No npm install or model export is needed. Commit/push both changed files and redeploy as usual.

## Use

Open Camera, select Ferrous, enable the camera, then tap Start Live Detection. It starts OFF each time you enter the Camera screen. The camera preview shows strip and gray-reference boxes with confidence scores. Tap Stop Live Detection any time.

Take a photo to stop live detection. Use Detect & Measure Colors for the full photo measurements. Retake returns to a camera with live detection OFF; turn it on again when needed. Selecting another test type or choosing a saved photo also switches it off. Leaving the camera cancels the loop; hiding the browser tab pauses it and returning resumes it if still enabled.

## Performance

The existing 1024 × 1024 model is reused, with your 25% confidence threshold. Live inference samples the video directly, without encoding a JPEG or measuring colors. The inference canvas and model session are reused. The existing ONNX Runtime proxy worker runs inference; frame preprocessing still takes some main-thread work.

There is one model run at a time. No video frames queue up. The next frame starts after the previous one finishes plus a delay of max(500 ms, 1000 ms minus frame processing time, half the frame processing time). This targets at most one check per second and provides more idle time on slow devices.

The screen displays processing time (preprocessing + inference + decoding, excluding initial model loading) and an estimated check rate. It is not the camera's video frame rate. For example, a measured 200 ms frame would have about 800 ms idle time; a measured 2000 ms frame would have about 1000 ms idle time. These are scheduling examples, not benchmarks of your phone.

Hold the camera steady because boxes describe the most recently processed frame. Old outlines expire after two seconds without a new result. The full camera frame is analyzed; objects outside the cropped visible preview do not receive a visible outline. Fixed placement guides remain commented out.

Turning live detection off prevents further frames and discards any pending result. An already running worker inference is allowed to finish. A captured-photo analysis waits for that inference if necessary, so the two never overlap. If live detection reports an error, it switches off; its error remains visible so you can report it or retry.

## Validation and limits

- Expo SDK 54 web production export passed using the existing dependencies.
- Focused tests with a controlled runtime passed: scheduling delay, cover/crop/mirror coordinate mapping, single-run exclusivity, skipping busy live frames, waiting for a captured photo, discarding cancelled results, no live color sampling, and retained captured-photo color sampling.
- Browser camera interaction and real-phone performance have not been verified in this workspace. Test on your device and report the displayed processing time, update rate, and any visible lag.
- This is browser camera detection, including mobile web on Vercel. Native Expo live detection is not implemented.

Runtime worker behavior: https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html#envwasmproxy
