import { CameraView, useCameraPermissions } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import { useRef, useState } from 'react';
import {
  Image,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

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

// This matches the current right-hand sample overlay box.
// YOLO will eventually replace these fixed coordinates.
const DEMO_SAMPLE_REGION = {
  x: 0.525,
  y: 0.5,
  width: 0.38,
  height: 0.18,
};

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function rgbToLab({ r, g, b }) {
  function linearize(value) {
    const channel = value / 255;

    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  }

  const red = linearize(r);
  const green = linearize(g);
  const blue = linearize(b);

  const x =
    (red * 0.4124564 +
      green * 0.3575761 +
      blue * 0.1804375) /
    0.95047;

  const y =
    red * 0.2126729 +
    green * 0.7151522 +
    blue * 0.072175;

  const z =
    (red * 0.0193339 +
      green * 0.119192 +
      blue * 0.9503041) /
    1.08883;

  function pivot(value) {
    return value > 0.008856
      ? Math.cbrt(value)
      : 7.787 * value + 16 / 116;
  }

  const fx = pivot(x);
  const fy = pivot(y);
  const fz = pivot(z);

  return {
    l: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
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

function getCoverTransform(previewSize, photoSize) {
  const scale = Math.max(
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
      getCoverTransform(previewSize, photoSize);

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

function mapSampleBoxToPhoto(previewSize, photoSize) {
  // The photo is displayed with resizeMode="cover".
  const scale = Math.max(
    previewSize.width / photoSize.width,
    previewSize.height / photoSize.height
  );

  const displayedWidth = photoSize.width * scale;
  const displayedHeight = photoSize.height * scale;

  const offsetX =
    (previewSize.width - displayedWidth) / 2;

  const offsetY =
    (previewSize.height - displayedHeight) / 2;

  // Remove the outer 18% to avoid the sample border.
  const inset = 0.18;

  const region = {
    x:
      DEMO_SAMPLE_REGION.x +
      DEMO_SAMPLE_REGION.width * inset,

    y:
      DEMO_SAMPLE_REGION.y +
      DEMO_SAMPLE_REGION.height * inset,

    width:
      DEMO_SAMPLE_REGION.width * (1 - inset * 2),

    height:
      DEMO_SAMPLE_REGION.height * (1 - inset * 2),
  };

  const left =
    (region.x * previewSize.width - offsetX) / scale;

  const top =
    (region.y * previewSize.height - offsetY) / scale;

  const right =
    ((region.x + region.width) * previewSize.width -
      offsetX) /
    scale;

  const bottom =
    ((region.y + region.height) * previewSize.height -
      offsetY) /
    scale;

  const x = clamp(
    Math.floor(left),
    0,
    photoSize.width - 1
  );

  const y = clamp(
    Math.floor(top),
    0,
    photoSize.height - 1
  );

  return {
    x,
    y,

    width: Math.max(
      1,
      clamp(
        Math.ceil(right),
        1,
        photoSize.width
      ) - x
    ),

    height: Math.max(
      1,
      clamp(
        Math.ceil(bottom),
        1,
        photoSize.height
      ) - y
    ),
  };
}

async function measureSampleColor(photoUri, previewSize) {
  if (Platform.OS !== 'web') {
    throw new Error(
      'Demo color analysis currently works on web only.'
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
    const crop = mapSampleBoxToPhoto(
      previewSize,
      {
        width: bitmap.width,
        height: bitmap.height,
      }
    );

    const imageData = context.getImageData(
      crop.x,
      crop.y,
      crop.width,
      crop.height
    );

    const red = [];
    const green = [];
    const blue = [];

    const pixelCount =
      imageData.width * imageData.height;

    const stride = Math.max(
      1,
      Math.floor(Math.sqrt(pixelCount / 50000))
    );

    let totalSampled = 0;

    for (let y = 0; y < imageData.height; y += stride) {
      for (let x = 0; x < imageData.width; x += stride) {
        totalSampled += 1;

        const index =
          (y * imageData.width + x) * 4;

        const r = imageData.data[index];
        const g = imageData.data[index + 1];
        const b = imageData.data[index + 2];
        const alpha = imageData.data[index + 3];

        const luminance =
          0.2126 * r +
          0.7152 * g +
          0.0722 * b;

        // Remove transparent, very dark, and glare pixels.
        if (
          alpha >= 200 &&
          luminance > 12 &&
          luminance < 245
        ) {
          red.push(r);
          green.push(g);
          blue.push(b);
        }
      }
    }

    if (red.length < 20) {
      throw new Error(
        'Not enough usable pixels. Check alignment and lighting.'
      );
    }

    const rgb = {
      r: median(red),
      g: median(green),
      b: median(blue),
    };

    return {
      rgb,
      lab: rgbToLab(rgb),
      usablePixelRatio:
        red.length / Math.max(totalSampled, 1),
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
  const pointMeasurementIdRef = useRef(0);
  const [permission, requestPermission] = useCameraPermissions();
  const [photoUri, setPhotoUri] = useState(null);
  const [isTakingPhoto, setIsTakingPhoto] = useState(false);
  const [marker, setMarker] = useState(null);

  const [previewSize, setPreviewSize] = useState({
    width: 0,
    height: 0,
  });

  const [selectedTest, setSelectedTest] = useState('ferrous');
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

  async function takePhoto() {
    if (!cameraRef.current || isTakingPhoto) return;

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
        link.download = `test-strip-photo-${Date.now()}.jpg`;
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

  async function analyzeSample() {
    if (!photoUri || isAnalyzing) return;

    try {
      setIsAnalyzing(true);
      setAnalysisError('');
      setAnalysisResult(null);

      const result = await measureSampleColor(
        photoUri,
        previewSize
      );

      setAnalysisResult(result);
    } catch (error) {
      console.error(error);

      setAnalysisError(
        error.message || 'Sample analysis failed.'
      );
    } finally {
      setIsAnalyzing(false);
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

  if (!permission) {
    return (
      <SafeAreaView style={styles.screenCentered}>
        <Text style={styles.subtitle}>Checking camera permission...</Text>
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
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
              onPress={() => setSelectedTest(key)}
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

        <TouchableOpacity
          activeOpacity={1}
          style={styles.cameraBox}
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
              resizeMode="cover"
            />
          ) : (
            <CameraView ref={cameraRef} style={styles.cameraPreview} facing="back" />
          )}

          <View pointerEvents="none" style={styles.alignmentOverlay}>
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

        <Text style={styles.cameraHint}>
          {photoUri
            ? 'Tap the captured photo to measure an 11 × 11 color area.'
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
                  setPhotoUri(null);
                  setUploadMessage('');
                  setMarker(null);
                  setPointColor(null);
                  setPointColorError('');
                  setIsMeasuringPoint(false);
                  setAnalysisResult(null);
                  setAnalysisError('');
                }}
                disabled={isUploading}
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
                disabled={isAnalyzing}
              >
                <Text style={styles.primaryButtonText}>
                  {isAnalyzing
                    ? 'Analyzing...'
                    : 'Measure Sample Color'}
                </Text>
              </TouchableOpacity>

              {analysisError ? (
                <Text style={styles.uploadError}>
                  Analysis failed: {analysisError}
                </Text>
              ) : null}

              {analysisResult ? (
                <View
                  style={{
                    width: '100%',
                    maxWidth: 620,
                    padding: 16,
                    borderRadius: 18,
                    borderWidth: 1,
                    borderColor: theme.line,
                    backgroundColor: theme.card,
                    gap: 10,
                  }}
                >
                  <Text
                    style={{
                      color: theme.ink,
                      fontSize: 18,
                      fontWeight: '900',
                    }}
                  >
                    Demo Sample Measurement
                  </Text>

                  <Text
                    style={{
                      color: '#7C3AED',
                      fontWeight: '800',
                    }}
                  >
                    Fixed sample box · No gray-reference correction
                  </Text>

                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <Text style={{ color: theme.muted }}>
                      Median RGB
                    </Text>

                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 8,
                      }}
                    >
                      <View
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 6,
                          borderWidth: 1,
                          borderColor: theme.line,
                          backgroundColor: `rgb(
              ${Math.round(analysisResult.rgb.r)},
              ${Math.round(analysisResult.rgb.g)},
              ${Math.round(analysisResult.rgb.b)}
            )`,
                        }}
                      />

                      <Text
                        style={{
                          color: theme.ink,
                          fontWeight: '900',
                        }}
                      >
                        {Math.round(analysisResult.rgb.r)},{' '}
                        {Math.round(analysisResult.rgb.g)},{' '}
                        {Math.round(analysisResult.rgb.b)}
                      </Text>
                    </View>
                  </View>

                  <View
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                    }}
                  >
                    <Text style={{ color: theme.muted }}>
                      CIELAB
                    </Text>

                    <Text
                      style={{
                        color: theme.ink,
                        fontWeight: '900',
                      }}
                    >
                      {analysisResult.lab.l.toFixed(1)},{' '}
                      {analysisResult.lab.a.toFixed(1)},{' '}
                      {analysisResult.lab.b.toFixed(1)}
                    </Text>
                  </View>

                  <View
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                    }}
                  >
                    <Text style={{ color: theme.muted }}>
                      Usable pixels
                    </Text>

                    <Text
                      style={{
                        color: theme.ink,
                        fontWeight: '900',
                      }}
                    >
                      {(analysisResult.usablePixelRatio * 100).toFixed(0)}%
                    </Text>
                  </View>

                  <Text
                    style={{
                      color: theme.muted,
                      fontSize: 12,
                      lineHeight: 18,
                    }}
                  >
                    Prototype measurement only. Concentration
                    prediction has not been calibrated.
                  </Text>
                </View>
              ) : null}

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
  }
});