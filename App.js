import { CameraView, useCameraPermissions } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import { useEffect, useRef, useState } from 'react';
import {
  Image,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { detectStripColors, detectVideoFrame, liveBoxStyle, liveFrameDelay } from './stripDetector';
import { estimateFerrousPpm, rgbToLab as calibrationRgbToLab } from './ferrousCalibration';

const theme = {
  bg: '#F7FAFC',
  card: '#FFFFFF',
  ink: '#102A43',
  muted: '#627D98',
  brand: '#0E7490',
  line: '#D9E2EC',
};

const UPLOAD_URL_API =
  'https://nngfk9vqni.execute-api.us-east-1.amazonaws.com/upload-url';

const clamp = (value, min, max) =>
  Math.min(max, Math.max(min, value));

function rgbToLab({ r, g, b }) {
  const [l, a, labB] = calibrationRgbToLab([r, g, b]);
  return { l, a, b: labB };
}

// Use one unambiguous gray reference from the same photo. With missing or
// multiple references, report an explicitly uncorrected chart match.
function addFerrousCalibration(result) {
  const validColor = d => !d.color?.error && d.color?.rgb &&
    ['r', 'g', 'b'].every(k => Number.isFinite(d.color.rgb[k]) &&
      d.color.rgb[k] >= 0 && d.color.rgb[k] <= 255);
  const grays = result.detections.filter(d => d.classId === 1 && validColor(d));
  const gray = grays.length === 1 ? grays[0].color.rgb : null;
  const calibrationNote = gray
    ? 'Gray correction applied using the digital reference #9A9A9A.'
    : grays.length === 0
      ? 'No usable gray reference: matches use uncorrected colors.'
      : 'Multiple gray references: matches use uncorrected colors. Use one reference card per photo.';
  return {
    ...result,
    calibrationNote,
    detections: result.detections.map(d => ({
      ...d,
      calibration: d.classId === 0 && validColor(d)
        ? estimateFerrousPpm([d.color.rgb.r, d.color.rgb.g, d.color.rgb.b], {
            grayRgb: gray ? [gray.r, gray.g, gray.b] : null,
          })
        : null,
    })),
  };
}

function rgbToHex({ r, g, b }) {
  return `#${[r, g, b]
    .map((value) =>
      Math.round(value)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`.toUpperCase();
}

function getPhotoTransform(previewSize, photoSize) {
  const scale = Math.min(
    previewSize.width / photoSize.width,
    previewSize.height / photoSize.height
  );

  return {
    scale,
    offsetX:
      (previewSize.width - photoSize.width * scale) / 2,
    offsetY:
      (previewSize.height - photoSize.height * scale) / 2,
  };
}

async function measurePointColor(
  photoUri,
  previewSize,
  point,
  previewRadius = 5
) {
  if (Platform.OS !== 'web') {
    throw new Error(
      'Point color measurement currently works on web only.'
    );
  }

  if (!previewSize.width || !previewSize.height) {
    throw new Error('Camera preview size is unavailable.');
  }

  if (typeof createImageBitmap !== 'function') {
    throw new Error(
      'This browser cannot decode the captured image.'
    );
  }

  const response = await fetch(photoUri);

  if (!response.ok) {
    throw new Error('Could not read the captured photo.');
  }

  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);

  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;

  const context = canvas.getContext('2d', {
    willReadFrequently: true,
  });

  if (!context) {
    bitmap.close?.();
    throw new Error('Canvas analysis is unavailable.');
  }

  context.drawImage(bitmap, 0, 0);

  try {
    const photoSize = {
      width: bitmap.width,
      height: bitmap.height,
    };

    const { scale, offsetX, offsetY } =
      getPhotoTransform(previewSize, photoSize);

    const rawX = (point.x - offsetX) / scale;
    const rawY = (point.y - offsetY) / scale;
    if (rawX < 0 || rawY < 0 || rawX >= photoSize.width || rawY >= photoSize.height) {
      throw new Error('Tap inside the photo, away from the empty margins.');
    }
    const centerX = clamp(
      (point.x - offsetX) / scale,
      0,
      photoSize.width - 1
    );

    const centerY = clamp(
      (point.y - offsetY) / scale,
      0,
      photoSize.height - 1
    );

    // Five displayed pixels in each direction.
    const photoRadius = Math.max(
      1,
      Math.ceil(previewRadius / scale)
    );

    const left = clamp(
      Math.floor(centerX - photoRadius),
      0,
      photoSize.width - 1
    );

    const top = clamp(
      Math.floor(centerY - photoRadius),
      0,
      photoSize.height - 1
    );

    const right = clamp(
      Math.ceil(centerX + photoRadius) + 1,
      1,
      photoSize.width
    );

    const bottom = clamp(
      Math.ceil(centerY + photoRadius) + 1,
      1,
      photoSize.height
    );

    const imageData = context.getImageData(
      left,
      top,
      Math.max(1, right - left),
      Math.max(1, bottom - top)
    );

    let red = 0;
    let green = 0;
    let blue = 0;
    let pixelCount = 0;

    for (
      let index = 0;
      index < imageData.data.length;
      index += 4
    ) {
      const alpha = imageData.data[index + 3];

      if (alpha < 200) continue;

      red += imageData.data[index];
      green += imageData.data[index + 1];
      blue += imageData.data[index + 2];
      pixelCount += 1;
    }

    if (!pixelCount) {
      throw new Error(
        'No visible pixels were found near this point.'
      );
    }

    const rgb = {
      r: red / pixelCount,
      g: green / pixelCount,
      b: blue / pixelCount,
    };

    return {
      rgb,
      hex: rgbToHex(rgb),
      lab: rgbToLab(rgb),
      point,
      photoPoint: {
        x: Math.round(centerX),
        y: Math.round(centerY),
      },
    };
  } finally {
    bitmap.close?.();
    canvas.width = 1;
    canvas.height = 1;
  }
}

function Card({ title, onPress, active = false }) {
  return (
    <TouchableOpacity
      style={[styles.card, active && styles.cardActive]}
      activeOpacity={0.8}
      onPress={onPress}
    >
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardSubtitle}>{active ? 'Tap to open' : 'Coming soon'}</Text>
    </TouchableOpacity>
  );
}

function HomePage({ goToCamera, goToAlbum }) {
  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar barStyle="dark-content" />

      <View style={styles.header}>
        <Text style={styles.title}>Test Strip App</Text>
        <Text style={styles.subtitle}>Choose a feature</Text>
      </View>

      <View style={styles.grid}>
        <Card title="Camera" onPress={goToCamera} active />
        <Card title="Album" onPress={goToAlbum} active />
        <Card title="History" />
        <Card title="Report" />
      </View>
    </SafeAreaView>
  );
}

function OverlayBox({ label, style, color, labelStyle }) {
  return (
    <View style={[styles.overlayBox, { borderColor: color }, style]}>
      <Text style={[styles.overlayLabel, { color }, labelStyle]}>
        {label}
      </Text>
    </View>
  );
}

const TEST_UIS = {
  amine: {
    label: 'Amine',
    color: '#F97316',
    boxes: {
      top: 'Amine Scale',
      left: 'Grey Reference',
      right: 'Amine Sample',
    },
  },
  ferrous: {
    label: 'Ferrous',
    color: 'lime',
    boxes: {
      top: 'Ferrous Iron Scale',
      left: 'Grey Reference',
      right: 'Sample Film',
    },
  },
  ph: {
    label: 'pH',
    color: '#A855F7',
    boxes: {
      top: 'pH Color Scale',
      left: 'Grey Reference',
      right: 'pH Strip',
    },
  },
};

function CameraPage({ goHome, addToAlbum }) {
  const cameraRef = useRef(null);
  const previewRef = useRef(null);
  const liveGenerationRef = useRef(0);
  const [liveEnabled, setLiveEnabled] = useState(false);
  const [liveResult, setLiveResult] = useState(null);
  const [liveMessage, setLiveMessage] = useState('');
  const [pageVisible, setPageVisible] = useState(true);
  const pointMeasurementIdRef = useRef(0);
  const analysisIdRef = useRef(0);
  const photoLoadIdRef = useRef(0);
  useEffect(() => () => {
    analysisIdRef.current += 1;
    pointMeasurementIdRef.current += 1;
    photoLoadIdRef.current += 1;
  }, []);
  const [permission, requestPermission] = useCameraPermissions();
  const [photoUri, setPhotoUri] = useState(null);
  const [isTakingPhoto, setIsTakingPhoto] = useState(false);
  const [marker, setMarker] = useState(null);

  const [previewSize, setPreviewSize] = useState({
    width: 0,
    height: 0,
  });

  const [selectedTest, setSelectedTest] = useState('ferrous');
  const [concentration, setConcentration] = useState('');
  const currentUI = TEST_UIS[selectedTest];

  const [isUploading, setIsUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState('');

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [analysisError, setAnalysisError] = useState('');

  const [isMeasuringPoint, setIsMeasuringPoint] =
    useState(false);

  const [pointColor, setPointColor] = useState(null);

  const [pointColorError, setPointColorError] =
    useState('');

  // Live inference never queues camera frames. Cleanup invalidates any result
  // still in flight; a worker run itself is allowed to finish safely.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const update = () => setPageVisible(!document.hidden);
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  function stopLiveDetection() {
    liveGenerationRef.current += 1;
    setLiveEnabled(false);
    setLiveResult(null);
    setLiveMessage('');
  }

  useEffect(() => {
    const generation = ++liveGenerationRef.current;
    let cancelled = false, timer, expiry;
    const current = () => !cancelled && generation === liveGenerationRef.current && !document.hidden;
    setLiveResult(null);
    const active = Platform.OS === 'web' && liveEnabled && permission?.granted &&
      !photoUri && !isTakingPhoto && !isAnalyzing && selectedTest === 'ferrous' && pageVisible;
    if (!active) return;
    setLiveMessage('Starting live detection… First use loads the model.');
    async function tick() {
      if (!current()) return;
      try {
        const video = previewRef.current?.querySelector?.('video');
        const result = await detectVideoFrame(video, current);
        if (!current()) return;
        if (!result) {
          setLiveResult(null);
          setLiveMessage('Waiting for camera or detector…');
          timer = setTimeout(tick, 500);
          return;
        }
        const delay = liveFrameDelay(result.elapsedMs);
        setLiveResult(result);
        setLiveMessage(`Frame processing: ${Math.round(result.elapsedMs)} ms · about ${(1000 / (result.elapsedMs + delay)).toFixed(1)} checks/sec`);
        clearTimeout(expiry);
        // Never leave an old box indefinitely when camera frames stop arriving.
        expiry = setTimeout(() => { if (current()) setLiveResult(null); }, 2000);
        timer = setTimeout(tick, delay);
      } catch (error) {
        if (!current()) return;
        setLiveResult(null);
        setLiveMessage(`Live detection stopped: ${error.message || 'Unknown error'}`);
        setLiveEnabled(false);
      }
    }
    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(expiry);
    };
  }, [liveEnabled, permission?.granted, photoUri, isTakingPhoto, isAnalyzing, selectedTest, pageVisible]);

  async function takePhoto() {
    if (!cameraRef.current || isTakingPhoto) return;
    stopLiveDetection();

    try {
      setIsTakingPhoto(true);

      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.9,
      });

      setPhotoUri(photo.uri);
      setUploadMessage('');
      pointMeasurementIdRef.current += 1;
      setMarker(null);
      setPointColor(null);
      setPointColorError('');
      setIsMeasuringPoint(false);
      setAnalysisResult(null);
      setAnalysisError('');
    } catch (error) {
      console.error(error);
      alert('Failed to take photo.');
    } finally {
      setIsTakingPhoto(false);
    }
  }

  async function downloadPhoto() {
    try {
      if (!photoUri) return;

      if (Platform.OS === 'web') {
        const link = document.createElement('a');
        link.href = photoUri;
        const extension = photoUri.startsWith('data:image/png') ? 'png' : photoUri.startsWith('data:image/webp') ? 'webp' : 'jpg';
        link.download = `test-strip-photo-${Date.now()}.${extension}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        return;
      }

      const { granted } = await MediaLibrary.requestPermissionsAsync();

      if (!granted) {
        alert('Album permission is needed to save the photo.');
        return;
      }

      await MediaLibrary.saveToLibraryAsync(photoUri);
      alert('Photo saved to your album!');
    } catch (error) {
      console.error(error);
      alert('Failed to save photo.');
    }
  }

  async function uploadPhoto() {
    if (!photoUri || isUploading) return;

    if (!concentration.trim()) {
      setUploadMessage(
        'Upload failed: Enter the lab concentration first.'
      );
      return;
    }

    try {
      setIsUploading(true);
      setUploadMessage('Preparing upload...');

      // Convert the captured image URI into image data.
      const photoResponse = await fetch(photoUri);

      if (!photoResponse.ok) {
        throw new Error('Could not read the captured photo.');
      }

      const photoBlob = await photoResponse.blob();
      const contentType = photoBlob.type || 'image/jpeg';

      // Request a temporary upload URL from API Gateway.
      const urlResponse = await fetch(UPLOAD_URL_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contentType,
          testType: selectedTest,
          concentration: concentration.trim(),
        }),
      });

      const responseText = await urlResponse.text();
      let uploadData;

      try {
        uploadData = JSON.parse(responseText);
      } catch {
        throw new Error('The upload service returned an invalid response.');
      }

      if (!urlResponse.ok || !uploadData.uploadUrl) {
        throw new Error(
          uploadData.error || 'Could not create an upload URL.'
        );
      }

      setUploadMessage('Uploading photo...');

      // Upload the image directly to S3.
      const s3Response = await fetch(uploadData.uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': contentType,
        },
        body: photoBlob,
      });

      if (!s3Response.ok) {
        throw new Error(`S3 upload failed (${s3Response.status}).`);
      }

      setUploadMessage('Photo uploaded successfully!');
    } catch (error) {
      console.error(error);

      setUploadMessage(
        `Upload failed: ${error.message || 'Unknown error'}`
      );
    } finally {
      setIsUploading(false);
    }
  }

  function clearAnalysis() {
    analysisIdRef.current += 1;
    setIsAnalyzing(false);
    setAnalysisResult(null);
    setAnalysisError('');
  }

  function choosePhoto() {
    if (Platform.OS !== 'web' || isAnalyzing || isUploading || isTakingPhoto) return;
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'image/jpeg,image/png,image/webp';
    picker.onchange = () => {
      const file = picker.files?.[0];
      if (!file) return;
      const id = ++photoLoadIdRef.current;
      const reader = new FileReader();
      reader.onerror = () => { if (id === photoLoadIdRef.current) setAnalysisError('Could not open the selected photo.'); };
      reader.onload = () => {
        if (id !== photoLoadIdRef.current) return;
        stopLiveDetection();
        clearAnalysis();
        pointMeasurementIdRef.current += 1;
        setPhotoUri(String(reader.result));
        setMarker(null);
        setPointColor(null);
        setPointColorError('');
        setIsMeasuringPoint(false);
        setUploadMessage('');
      };
      reader.readAsDataURL(file);
    };
    picker.click();
  }

  async function analyzeSample() {
    if (!photoUri || isAnalyzing) return;
    if (Platform.OS !== 'web' || selectedTest !== 'ferrous') {
      setAnalysisError('AI detection is currently available for Ferrous photos in the web app.');
      return;
    }
    const id = ++analysisIdRef.current;
    try {
      setIsAnalyzing(true);
      setAnalysisError('');
      setAnalysisResult(null);
      const result = await detectStripColors(photoUri);
      if (id === analysisIdRef.current) setAnalysisResult(addFerrousCalibration(result));
    } catch (error) {
      if (id === analysisIdRef.current) setAnalysisError(error.message || 'Photo analysis failed.');
    } finally {
      if (id === analysisIdRef.current) setIsAnalyzing(false);
    }
  }

  function saveToTemporaryAlbum() {
    if (!photoUri) return;

    addToAlbum(photoUri);
    alert('Photo added to temporary album.');
  }

  async function handleCameraPress(event) {
    const nativeEvent = event.nativeEvent || {};

    let x = nativeEvent.locationX;
    let y = nativeEvent.locationY;

    if (
      (!Number.isFinite(x) || !Number.isFinite(y)) &&
      Platform.OS === 'web'
    ) {
      const rect =
        event.currentTarget?.getBoundingClientRect?.();

      const clientX =
        nativeEvent.clientX ??
        event.clientX ??
        (Number.isFinite(nativeEvent.pageX)
          ? nativeEvent.pageX - window.scrollX
          : undefined);

      const clientY =
        nativeEvent.clientY ??
        event.clientY ??
        (Number.isFinite(nativeEvent.pageY)
          ? nativeEvent.pageY - window.scrollY
          : undefined);

      if (
        rect &&
        Number.isFinite(clientX) &&
        Number.isFinite(clientY)
      ) {
        x = clientX - rect.left;
        y = clientY - rect.top;
      } else {
        x = nativeEvent.offsetX;
        y = nativeEvent.offsetY;
      }
    }

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return;
    }

    const point = {
      x: Math.round(
        clamp(
          x,
          0,
          previewSize.width > 0
            ? previewSize.width
            : Number.MAX_SAFE_INTEGER
        )
      ),

      y: Math.round(
        clamp(
          y,
          0,
          previewSize.height > 0
            ? previewSize.height
            : Number.MAX_SAFE_INTEGER
        )
      ),
    };

    setMarker(point);

    // Only measure color after a photo has been captured.
    if (!photoUri) return;

    const measurementId =
      pointMeasurementIdRef.current + 1;

    pointMeasurementIdRef.current = measurementId;

    try {
      setIsMeasuringPoint(true);
      setPointColorError('');

      const result = await measurePointColor(
        photoUri,
        previewSize,
        point
      );

      if (
        pointMeasurementIdRef.current === measurementId
      ) {
        setPointColor(result);
      }
    } catch (error) {
      console.error(error);

      if (
        pointMeasurementIdRef.current === measurementId
      ) {
        setPointColor(null);
        setPointColorError(
          error.message ||
          'Point color measurement failed.'
        );
      }
    } finally {
      if (
        pointMeasurementIdRef.current === measurementId
      ) {
        setIsMeasuringPoint(false);
      }
    }
  }

  if (!permission && Platform.OS !== 'web') {
    return (
      <SafeAreaView style={styles.screenCentered}>
        <Text style={styles.subtitle}>Checking camera permission...</Text>
      </SafeAreaView>
    );
  }

  if (!permission?.granted && Platform.OS !== 'web') {
    return (
      <SafeAreaView style={styles.screenCentered}>
        <Text style={styles.titleSmall}>Camera permission needed</Text>
        <Text style={styles.subtitleCenter}>
          {Platform.OS === 'web'
            ? 'Your browser will ask to use your webcam.'
            : 'Your phone will ask to use the camera.'}
        </Text>

        <TouchableOpacity style={styles.primaryButton} onPress={requestPermission}>
          <Text style={styles.primaryButtonText}>Allow Camera</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.secondaryButton} onPress={goHome}>
          <Text style={styles.secondaryButtonText}>Back Home</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.cameraScreen}>
      <ScrollView contentContainerStyle={styles.cameraScrollContent}>
        <View style={styles.cameraHeader}>
          <TouchableOpacity onPress={goHome}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>

          <Text style={styles.cameraTitle}>Camera</Text>

          <TouchableOpacity
            onPress={() => {
              pointMeasurementIdRef.current += 1;
              setMarker(null);
              setPointColor(null);
              setPointColorError('');
              setIsMeasuringPoint(false);
            }}
          >
            <Text style={styles.clearText}>Clear</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.testSelector}>
          {Object.entries(TEST_UIS).map(([key, item]) => (
            <TouchableOpacity
              key={key}
              style={[
                styles.testOption,
                selectedTest === key && {
                  borderColor: item.color,
                  backgroundColor: '#FFFFFF',
                },
              ]}
              disabled={isAnalyzing || isUploading}
              onPress={() => { stopLiveDetection(); setSelectedTest(key); clearAnalysis(); }}
            >
              <Text
                style={[
                  styles.testOptionText,
                  selectedTest === key && { color: item.color },
                ]}
              >
                {item.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.concentrationSection}>
          <Text style={styles.concentrationLabel}>
            Lab concentration
          </Text>

          <View style={styles.concentrationInputRow}>
            <TextInput
              style={styles.concentrationInput}
              value={concentration}
              onChangeText={setConcentration}
              placeholder="e.g. 600"
              placeholderTextColor={theme.muted}
              keyboardType="decimal-pad"
            />

            <Text style={styles.concentrationUnit}>ppm</Text>
          </View>
        </View>

        <TouchableOpacity
          activeOpacity={1}
          style={styles.cameraBox}
          ref={previewRef}
          onPress={handleCameraPress}
          onLayout={(event) => {
            const { width, height } = event.nativeEvent.layout;
            setPreviewSize({ width, height });
          }}
        >
          {photoUri ? (
            <Image
              source={{ uri: photoUri }}
              style={styles.cameraPreview}
              resizeMode="contain"
            />
          ) : (
            permission?.granted ? (
              <CameraView ref={cameraRef} style={styles.cameraPreview} facing="back" />
            ) : (
              <View style={[styles.cameraPreview, { alignItems: 'center', justifyContent: 'center' }]}>
                <TouchableOpacity style={styles.primaryButton} onPress={requestPermission}>
                  <Text style={styles.primaryButtonText}>Enable Camera</Text>
                </TouchableOpacity>
                <Text style={styles.cameraHint}>Or choose a saved photo below.</Text>
              </View>
            )
          )}

          <View pointerEvents="none" style={styles.alignmentOverlay}>
            {/* Fixed camera guides — uncomment to restore.
              {!photoUri && permission?.granted && <>
                <OverlayBox
                  label={currentUI.boxes.top}
                  color={currentUI.color}
                  style={styles.ironScaleBox}
                />
                <OverlayBox
                  label={currentUI.boxes.left}
                  color={currentUI.color}
                  style={styles.greyReferenceBox}
                  labelStyle={styles.labelBelow}
                />
                <OverlayBox
                  label={currentUI.boxes.right}
                  color={currentUI.color}
                  style={styles.sampleFilmBox}
                  labelStyle={styles.labelBelow}
                />
              </>}
              */}
            {!photoUri && liveEnabled && pageVisible && liveResult && liveResult.detections.map((d, index) => {
              const boxStyle = liveBoxStyle(d.box, liveResult.photoSize, previewSize, liveResult.mirrored);
              if (!boxStyle) return null;
              const color = d.classId === 0 ? '#2563EB' : '#0891B2';
              return <OverlayBox key={`live-${index}`}
                label={`${d.classId === 0 ? 'Strip' : 'Gray'} · ${Math.round(d.score * 100)}%`}
                color={color} style={[boxStyle, { backgroundColor: 'transparent' }]}
                labelStyle={{ width: 130, right: undefined, textAlign: 'left', top: 0, fontSize: 11, backgroundColor: '#FFFFFFDD' }} />;
            })}
            {photoUri && analysisResult && analysisResult.detections.map((d, index) => {
              const t = getPhotoTransform(previewSize, analysisResult.photoSize);
              const toStyle = box => ({
                left: box.x * t.scale + t.offsetX, top: box.y * t.scale + t.offsetY,
                width: box.width * t.scale, height: box.height * t.scale
              });
              const color = d.classId === 0 ? '#2563EB' : '#0891B2';
              return <View key={index} style={StyleSheet.absoluteFill}>
                <OverlayBox label={`${d.classId === 0 ? 'Strip' : 'Gray'} ${index + 1} · ${Math.round(d.score * 100)}%`}
                  color={color} style={[toStyle(d.box), { backgroundColor: 'transparent' }]}
                  labelStyle={{ width: 150, right: undefined, textAlign: 'left', top: -18, fontSize: 11, backgroundColor: '#FFFFFFDD' }} />
                {d.color.sampleBox && <View style={[styles.overlayBox, toStyle(d.color.sampleBox), { borderColor: color, borderWidth: 1, borderStyle: 'dashed', backgroundColor: 'transparent' }]} />}
              </View>;
            })}

            {marker && (
              <View style={[styles.markerWrap, { left: marker.x - 18, top: marker.y - 18 }]}>
                <View style={styles.markerCircle} />
                <View style={styles.markerHorizontal} />
                <View style={styles.markerVertical} />
                <Text style={styles.markerText}>
                  ({marker.x}, {marker.y})
                </Text>
              </View>
            )}
          </View>
        </TouchableOpacity>

        {Platform.OS === 'web' && !photoUri && selectedTest === 'ferrous' && <View style={{ marginHorizontal: 18, gap: 8 }}>
          <TouchableOpacity
            style={[styles.secondaryButton, (!permission?.granted || isTakingPhoto) && styles.buttonDisabled]}
            disabled={!permission?.granted || isTakingPhoto}
            onPress={() => {
              if (liveEnabled) stopLiveDetection();
              else { setLiveResult(null); setLiveMessage('Starting live detection…'); setLiveEnabled(true); }
            }}>
            <Text style={styles.secondaryButtonText}>{liveEnabled ? 'Stop Live Detection' : 'Start Live Detection'}</Text>
          </TouchableOpacity>
          <Text style={styles.pointColorSecondary}>{!permission?.granted ? 'Enable the camera to use live detection.' : liveMessage || 'Optional live outlines. Color is measured after capture.'}</Text>
          {liveEnabled && <Text style={styles.pointColorSecondary}>Latest sampled frame; hold the camera steady. Updates may be slower on phones.</Text>}
          {liveEnabled && liveResult && <Text style={styles.pointColorSecondary}>
            {liveResult.detections.filter(d => d.classId === 0).length} strip(s) · {liveResult.detections.filter(d => d.classId === 1).length} gray reference(s)
          </Text>}
        </View>}

        <Text style={styles.cameraHint}>
          {photoUri
            ? 'Tap the photo to inspect color. Solid outlines show detections; dashed outlines show sampled regions.'
            : 'Tap the image to mark the reading/sample location.'}
        </Text>

        {photoUri ? (
          <View style={styles.pointColorCard}>
            <View style={styles.pointColorHeader}>
              <Text style={styles.pointColorTitle}>
                Point Color
              </Text>

              <Text style={styles.pointColorMeta}>
                5 px screen radius
              </Text>
            </View>

            {isMeasuringPoint ? (
              <Text style={styles.pointColorPrompt}>
                Measuring color…
              </Text>
            ) : pointColorError ? (
              <Text style={styles.uploadError}>
                Measurement failed: {pointColorError}
              </Text>
            ) : pointColor ? (
              <View style={styles.pointColorContent}>
                <View
                  style={[
                    styles.pointColorSwatch,
                    {
                      backgroundColor: pointColor.hex,
                    },
                  ]}
                />

                <View style={styles.pointColorValues}>
                  <Text style={styles.pointColorValue}>
                    RGB {Math.round(pointColor.rgb.r)},{' '}
                    {Math.round(pointColor.rgb.g)},{' '}
                    {Math.round(pointColor.rgb.b)}
                  </Text>

                  <Text style={styles.pointColorValue}>
                    HEX {pointColor.hex}
                  </Text>

                  <Text style={styles.pointColorSecondary}>
                    Lab {pointColor.lab.l.toFixed(1)},{' '}
                    {pointColor.lab.a.toFixed(1)},{' '}
                    {pointColor.lab.b.toFixed(1)}
                  </Text>

                  <Text style={styles.pointColorSecondary}>
                    Tap ({pointColor.point.x},{' '}
                    {pointColor.point.y}) · Photo pixel (
                    {pointColor.photoPoint.x},{' '}
                    {pointColor.photoPoint.y})
                  </Text>
                </View>
              </View>
            ) : (
              <Text style={styles.pointColorPrompt}>
                Tap anywhere on the captured photo to inspect
                its color.
              </Text>
            )}
          </View>
        ) : null}

        {Platform.OS === 'web' && <TouchableOpacity
          style={[styles.secondaryButton, (isAnalyzing || isUploading || isTakingPhoto) && styles.buttonDisabled]}
          onPress={choosePhoto} disabled={isAnalyzing || isUploading || isTakingPhoto}>
          <Text style={styles.secondaryButtonText}>Choose Photo</Text>
        </TouchableOpacity>}
        {selectedTest !== 'ferrous' && <Text style={styles.cameraHint}>AI detection is trained for Ferrous only. Manual point sampling is still available.</Text>}
        <View style={styles.cameraActions}>
          {photoUri ? (
            <>
              <TouchableOpacity
                style={[
                  styles.secondaryButton,
                  isUploading && styles.buttonDisabled,
                ]}
                onPress={() => {
                  pointMeasurementIdRef.current += 1;
                  photoLoadIdRef.current += 1;
                  clearAnalysis();
                  setPhotoUri(null);
                  setUploadMessage('');
                  setMarker(null);
                  setPointColor(null);
                  setPointColorError('');
                  setIsMeasuringPoint(false);
                  setAnalysisResult(null);
                  setAnalysisError('');
                }}
                disabled={isUploading || isAnalyzing}
              >
                <Text style={styles.secondaryButtonText}>Retake</Text>
              </TouchableOpacity>

              <View style={styles.photoButtonRow}>
                <TouchableOpacity style={styles.primaryButton} onPress={downloadPhoto}>
                  <Text style={styles.primaryButtonText}>Download</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.primaryButton,
                    isUploading && styles.buttonDisabled,
                  ]}
                  onPress={uploadPhoto}
                  disabled={isUploading}
                >
                  <Text style={styles.primaryButtonText}>
                    {isUploading ? 'Uploading...' : 'Upload'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.primaryButton} onPress={saveToTemporaryAlbum}>
                  <Text style={styles.primaryButtonText}>Add to Album</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={[
                  styles.primaryButton,
                  { backgroundColor: '#7C3AED' },
                  isAnalyzing && styles.buttonDisabled,
                ]}
                onPress={analyzeSample}
                disabled={isAnalyzing || selectedTest !== 'ferrous' || Platform.OS !== 'web'}
              >
                <Text style={styles.primaryButtonText}>
                  {isAnalyzing
                    ? 'Analyzing...'
                    : 'Detect & Measure Colors'}
                </Text>
              </TouchableOpacity>

              {analysisError ? (
                <Text style={styles.uploadError}>
                  Analysis failed: {analysisError}
                </Text>
              ) : null}

              {analysisResult && <View style={{ width: '100%', maxWidth: 620, gap: 12 }}>
                <Text style={styles.pointColorTitle}>Detected Colors</Text>
                <Text style={styles.pointColorSecondary}>Chart matching prototype. Concentration accuracy has not yet been validated with real samples.</Text>
                <Text style={styles.pointColorSecondary}>{analysisResult.calibrationNote}</Text>
                {analysisResult.warnings.map(message => <Text key={message} style={styles.uploadError}>{message}</Text>)}
                {analysisResult.detections.map((d, index) => {
                  const lab = d.color.rgb ? rgbToLab(d.color.rgb) : null;
                  const estimate = d.calibration;
                  return <View key={index} style={[styles.pointColorCard, { width: '100%' }]}>
                    <Text style={styles.pointColorTitle}>{d.classId === 0 ? 'Strip' : 'Gray Reference'} {index + 1}</Text>
                    <Text style={styles.pointColorSecondary}>Detection confidence: {(d.score * 100).toFixed(1)}%</Text>
                    {d.color.error ? <Text style={styles.uploadError}>{d.color.error}</Text> : <>
                      <View style={styles.pointColorContent}>
                        <View style={[styles.pointColorSwatch, { backgroundColor: rgbToHex(d.color.rgb) }]} />
                        <View style={styles.pointColorValues}>
                          <Text style={styles.pointColorValue}>RGB {Math.round(d.color.rgb.r)}, {Math.round(d.color.rgb.g)}, {Math.round(d.color.rgb.b)}</Text>
                          <Text style={styles.pointColorValue}>HEX {rgbToHex(d.color.rgb)}</Text>
                          <Text style={styles.pointColorSecondary}>Lab {lab.l.toFixed(1)}, {lab.a.toFixed(1)}, {lab.b.toFixed(1)}</Text>
                        </View>
                      </View>
                      <Text style={styles.pointColorSecondary}>{d.color.pixelCount.toLocaleString()} sampled pixels · center {d.classId === 0 ? '60%' : '70%'} of width and height</Text>
                      {d.color.clippedRatio > 0.1 && <Text style={styles.uploadError}>Some pixels have near-clipped channels. Check exposure and glare.</Text>}
                      {estimate && <View style={{ gap: 5, marginTop: 8 }}>
                        <Text style={styles.pointColorTitle}>Closest chart match: {estimate.ppm} ppm</Text>
                        <Text style={styles.pointColorSecondary}>
                          {estimate.grayCorrectionApplied ? 'Gray-corrected' : 'Uncorrected'} Lab: {estimate.lab.map(v => v.toFixed(1)).join(', ')}
                        </Text>
                        <Text style={styles.pointColorSecondary}>Color difference (ΔE00): {estimate.deltaE.toFixed(2)} · smaller means closer to the chart</Text>
                        <Text style={styles.pointColorSecondary}>Other close matches: {estimate.candidates.slice(1).map(c => `${c.ppm} ppm (ΔE ${c.deltaE.toFixed(2)})`).join(' · ')}</Text>
                        <Text style={styles.pointColorSecondary}>Approximate chart comparison; this is not the lab concentration. Unrelated colors can still receive a nearest match.</Text>
                        {estimate.atChartEndpoint && <Text style={styles.uploadError}>Match is at the end of the chart. The true concentration may be outside its range.</Text>}
                      </View>}
                    </>}
                  </View>;
                })}
              </View>}

              {uploadMessage ? (
                <Text
                  style={[
                    styles.uploadMessage,
                    uploadMessage.startsWith('Upload failed') &&
                    styles.uploadError,
                  ]}
                >
                  {uploadMessage}
                </Text>
              ) : null}
            </>
          ) : (
            <TouchableOpacity
              style={styles.captureButton}
              onPress={takePhoto}
              disabled={isTakingPhoto}
            >
              <View style={styles.captureButtonInner} />
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function AlbumPage({ goHome, album }) {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.cameraHeader}>
        <TouchableOpacity onPress={goHome}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.cameraTitle}>Album</Text>

        <View style={{ width: 52 }} />
      </View>

      {album.length === 0 ? (
        <View style={styles.albumEmpty}>
          <Text style={styles.titleSmall}>No photos yet</Text>
          <Text style={styles.subtitleCenter}>Take a photo and add it to the album.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.albumGrid}>
          {album.map((uri, index) => (
            <Image key={`${uri}-${index}`} source={{ uri }} style={styles.albumImage} />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

export default function App() {
  const [page, setPage] = useState('home');
  const [album, setAlbum] = useState([]);

  if (page === 'camera') {
    return (
      <CameraPage
        goHome={() => setPage('home')}
        addToAlbum={(photoUri) => setAlbum((prev) => [photoUri, ...prev])}
      />
    );
  }

  if (page === 'album') {
    return <AlbumPage goHome={() => setPage('home')} album={album} />;
  }

  return (
    <HomePage
      goToCamera={() => setPage('camera')}
      goToAlbum={() => setPage('album')}
    />
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.bg,
    padding: 20,
  },
  screenCentered: {
    flex: 1,
    backgroundColor: theme.bg,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    color: theme.ink,
  },
  titleSmall: {
    fontSize: 24,
    fontWeight: '900',
    color: theme.ink,
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 16,
    color: theme.muted,
    marginTop: 4,
  },
  subtitleCenter: {
    fontSize: 16,
    color: theme.muted,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 23,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 16,
  },
  card: {
    width: '47%',
    backgroundColor: theme.card,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: theme.line,
    height: 120,
    justifyContent: 'space-between',
  },
  cardActive: {
    borderColor: theme.brand,
    borderWidth: 2,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: theme.ink,
  },
  cardSubtitle: {
    fontSize: 13,
    color: theme.muted,
  },
  cameraScreen: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  cameraScrollContent: {
    paddingBottom: 40,
  },
  cameraHeader: {
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backText: {
    color: theme.brand,
    fontSize: 16,
    fontWeight: '800',
  },
  clearText: {
    color: theme.brand,
    fontSize: 16,
    fontWeight: '800',
  },
  cameraTitle: {
    color: theme.ink,
    fontSize: 20,
    fontWeight: '900',
  },
  cameraBox: {
    margin: 18,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#000000',
    height: 360,
  },
  cameraPreview: {
    flex: 1,
    width: '100%',
  },
  alignmentOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  overlayBox: {
    position: 'absolute',
    borderWidth: 3,
    borderColor: 'lime',
    backgroundColor: 'rgba(0, 255, 0, 0.04)',
  },
  overlayLabel: {
    position: 'absolute',
    top: -24,
    left: 0,
    right: 0,
    textAlign: 'center',
    color: 'lime',
    fontSize: 12,
    fontWeight: '900',
  },
  labelBelow: {
    top: '100%',
    marginTop: 5,
  },
  ironScaleBox: {
    left: '15%',
    top: '25%',
    width: '70%',
    height: '21%',
  },
  greyReferenceBox: {
    left: '9.5%',
    top: '50%',
    width: '28%',
    height: '18%',
  },
  sampleFilmBox: {
    left: '52.5%',
    top: '50%',
    width: '38%',
    height: '18%',
  },
  markerWrap: {
    position: 'absolute',
    width: 120,
    height: 60,
  },
  markerCircle: {
    position: 'absolute',
    left: 8,
    top: 8,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 3,
    borderColor: 'red',
  },
  markerHorizontal: {
    position: 'absolute',
    left: 0,
    top: 17,
    width: 36,
    height: 2,
    backgroundColor: 'red',
  },
  markerVertical: {
    position: 'absolute',
    left: 17,
    top: 0,
    width: 2,
    height: 36,
    backgroundColor: 'red',
  },
  markerText: {
    position: 'absolute',
    left: 40,
    top: 2,
    color: 'red',
    fontSize: 12,
    fontWeight: '900',
  },
  cameraHint: {
    color: theme.muted,
    textAlign: 'center',
    marginHorizontal: 18,
    marginTop: 2,
  },
  pointColorCard: {
    marginHorizontal: 18,
    marginTop: 12,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.line,
    backgroundColor: theme.card,
    gap: 10,
  },

  pointColorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },

  pointColorTitle: {
    color: theme.ink,
    fontSize: 17,
    fontWeight: '900',
  },

  pointColorMeta: {
    color: theme.muted,
    fontSize: 12,
    fontWeight: '700',
  },

  pointColorContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },

  pointColorSwatch: {
    width: 54,
    height: 54,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.line,
  },

  pointColorValues: {
    flex: 1,
    gap: 3,
  },

  pointColorValue: {
    color: theme.ink,
    fontSize: 14,
    fontWeight: '900',
  },

  pointColorSecondary: {
    color: theme.muted,
    fontSize: 12,
  },

  pointColorPrompt: {
    color: theme.muted,
    fontSize: 14,
  },
  cameraActions: {
    padding: 18,
    alignItems: 'center',
    gap: 12,
  },
  primaryButton: {
    backgroundColor: theme.brand,
    paddingHorizontal: 22,
    paddingVertical: 14,
    borderRadius: 16,
    minWidth: 160,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 16,
  },
  secondaryButton: {
    backgroundColor: '#E0F2FE',
    paddingHorizontal: 22,
    paddingVertical: 14,
    borderRadius: 16,
    minWidth: 160,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: theme.brand,
    fontWeight: '900',
    fontSize: 16,
  },
  captureButton: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 5,
    borderColor: theme.brand,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  captureButtonInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: theme.brand,
  },
  photoButtonRow: {
    flexDirection: 'row',
    gap: 12,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  albumEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  albumGrid: {
    padding: 18,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  albumImage: {
    width: '47%',
    height: 180,
    borderRadius: 16,
    backgroundColor: '#000000',
  },
  testSelector: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
    paddingHorizontal: 18,
    marginBottom: 4,
  },
  testOption: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: theme.line,
    backgroundColor: '#EEF2F6',
  },
  testOptionText: {
    color: theme.muted,
    fontWeight: '900',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  uploadMessage: {
    color: theme.brand,
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
  },
  uploadError: {
    color: '#B91C1C',
  },
  concentrationSection: {
    marginHorizontal: 18,
    marginTop: 12,
  },

  concentrationLabel: {
    color: theme.ink,
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 6,
  },

  concentrationInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 14,
    paddingHorizontal: 14,
  },

  concentrationInput: {
    flex: 1,
    paddingVertical: 12,
    color: theme.ink,
    fontSize: 16,
  },

  concentrationUnit: {
    color: theme.muted,
    fontSize: 15,
    fontWeight: '800',
  },
});