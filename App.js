import React, { useRef, useState } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Image,
  Platform,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

const theme = {
  bg: '#F7FAFC',
  card: '#FFFFFF',
  ink: '#102A43',
  muted: '#627D98',
  brand: '#0E7490',
  line: '#D9E2EC',
};

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

function HomePage({ goToCamera }) {
  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar barStyle="dark-content" />

      <View style={styles.header}>
        <Text style={styles.title}>Test Strip App</Text>
        <Text style={styles.subtitle}>Choose a feature</Text>
      </View>

      <View style={styles.grid}>
        <Card title="Camera" onPress={goToCamera} active />
        <Card title="Album" />
        <Card title="History" />
        <Card title="Report" />
      </View>
    </SafeAreaView>
  );
}

function OverlayBox({ label, style }) {
  return (
    <View style={[styles.overlayBox, style]}>
      <Text style={styles.overlayLabel}>{label}</Text>
    </View>
  );
}

function CameraPage({ goHome }) {
  const cameraRef = useRef(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [photoUri, setPhotoUri] = useState(null);
  const [isTakingPhoto, setIsTakingPhoto] = useState(false);
  const [marker, setMarker] = useState(null);

  async function takePhoto() {
    if (!cameraRef.current || isTakingPhoto) return;

    try {
      setIsTakingPhoto(true);
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.9 });
      setPhotoUri(photo.uri);
    } catch (error) {
      console.log(error);
    } finally {
      setIsTakingPhoto(false);
    }
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
      <View style={styles.cameraHeader}>
        <TouchableOpacity onPress={goHome}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.cameraTitle}>Camera</Text>
        <TouchableOpacity onPress={() => setMarker(null)}>
          <Text style={styles.clearText}>Clear</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        activeOpacity={1}
        style={styles.cameraBox}
        onPress={handleCameraPress}
      >
        {photoUri ? (
          <Image source={{ uri: photoUri }} style={styles.cameraPreview} />
        ) : (
          <CameraView ref={cameraRef} style={styles.cameraPreview} facing="back" />
        )}

        <View pointerEvents="none" style={styles.alignmentOverlay}>
          <OverlayBox label="Ferrous Iron Scale" style={styles.ironScaleBox} />
          <OverlayBox label="Grey Reference" style={styles.greyReferenceBox} />
          <OverlayBox label="Sample Film" style={styles.sampleFilmBox} />

          {marker && (
            <View style={[styles.markerWrap, { left: marker.x - 18, top: marker.y - 18 }]}>
              <View style={styles.markerCircle} />
              <View style={styles.markerHorizontal} />
              <View style={styles.markerVertical} />
              <Text style={styles.markerText}>({marker.x}, {marker.y})</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>

      <Text style={styles.cameraHint}>
        Tap the image to mark the reading/sample location.
      </Text>

      <View style={styles.cameraActions}>
        {photoUri ? (
          <>
            <TouchableOpacity style={styles.secondaryButton} onPress={() => setPhotoUri(null)}>
              <Text style={styles.secondaryButtonText}>Retake</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryButton} onPress={goHome}>
              <Text style={styles.primaryButtonText}>Use Photo</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity style={styles.captureButton} onPress={takePhoto} disabled={isTakingPhoto}>
            <View style={styles.captureButtonInner} />
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  const [page, setPage] = useState('home');

  if (page === 'camera') {
    return <CameraPage goHome={() => setPage('home')} />;
  }

  return <HomePage goToCamera={() => setPage('camera')} />;
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
    height: 460,
  },
  cameraPreview: {
    flex: 1,
    width: '100%',
  },
  cameraOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
  alignmentOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  ironScaleBox: {
    left: '10%',
    top: '8%',
    width: '80%',
    height: '28%',
  },
  greyReferenceBox: {
    left: '8%',
    top: '52%',
    width: '30%',
    height: '24%',
  },
  sampleFilmBox: {
    left: '52%',
    top: '52%',
    width: '40%',
    height: '24%',
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
  clearText: {
    color: theme.brand,
    fontSize: 16,
    fontWeight: '800',
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
});
