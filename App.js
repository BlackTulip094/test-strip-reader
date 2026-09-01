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
  const [permission, requestPermission] = useCameraPermissions();
  const [photoUri, setPhotoUri] = useState(null);
  const [isTakingPhoto, setIsTakingPhoto] = useState(false);
  const [marker, setMarker] = useState(null);

  const [selectedTest, setSelectedTest] = useState('ferrous');
  const currentUI = TEST_UIS[selectedTest];

  const [isUploading, setIsUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState('');

  async function takePhoto() {
    if (!cameraRef.current || isTakingPhoto) return;

    try {
      setIsTakingPhoto(true);

      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.9,
      });

      setPhotoUri(photo.uri);
      setUploadMessage('');
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

  function saveToTemporaryAlbum() {
    if (!photoUri) return;

    addToAlbum(photoUri);
    alert('Photo added to temporary album.');
  }

  function handleCameraPress(event) {
    const { locationX, locationY } = event.nativeEvent;
    setMarker({ x: Math.round(locationX), y: Math.round(locationY) });
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

          <TouchableOpacity onPress={() => setMarker(null)}>
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

        <TouchableOpacity activeOpacity={1} style={styles.cameraBox} onPress={handleCameraPress}>
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={styles.cameraPreview} />
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

        <Text style={styles.cameraHint}>Tap the image to mark the reading/sample location.</Text>

        <View style={styles.cameraActions}>
          {photoUri ? (
            <>
              <TouchableOpacity
                style={[
                  styles.secondaryButton,
                  isUploading && styles.buttonDisabled,
                ]}
                onPress={() => {
                  setPhotoUri(null);
                  setUploadMessage('');
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