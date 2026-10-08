import React, { useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Dimensions,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  Image,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { useVideoPlayer, VideoView } from 'expo-video';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const TUTORIAL_VIDEO_URL =
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';

const SLIDES = [
  {
    id: '1',
    message: '⚡ REAL-TIME AI FATIGUE MONITORING',
    title: 'Stay Focused on the Road',
    subtitle: 'Instant alerts trigger the second drowsiness or eye closure is detected by your camera.',
    type: 'image',
    source: {
      uri: 'https://images.pexels.com/photos/378570/pexels-photo-378570.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=2',
    },
  },
  {
    id: '2',
    message: '📍 AUTOMATIC ROUTE ASSISTANT',
    title: 'Smart Stop Navigation',
    subtitle: 'Automatically redirects you to the nearest open petrol station or rest stop when fatigue hits.',
    type: 'image',
    source: {
      uri: 'https://images.pexels.com/photos/1252500/pexels-photo-1252500.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=2',
    },
  },
  {
    id: '3',
    message: '🎬 QUICK SETUP GUIDE',
    title: 'How It Works',
    subtitle: 'Watch this short tutorial to pair your ESP32 camera and configure app alerts in seconds.',
    type: 'video',
    source: { uri: TUTORIAL_VIDEO_URL },
  },
];

const VideoSlideItem = ({ item }) => {
  const player = useVideoPlayer(item.source.uri, (player) => {
    player.loop = true;
    player.play();
  });

  return (
    <VideoView
      style={styles.fullMedia}
      player={player}
      contentFit="cover"
      nativeControls={false}
    />
  );
};

export default function LandingScreen({ onFinish }) {
  const scrollRef = useRef(null);
  const scrollX = useSharedValue(0);
  const [currentIndex, setCurrentIndex] = useState(0);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollX.value = event.contentOffset.x;
    },
  });

  const handleNext = () => {
    if (currentIndex < SLIDES.length - 1) {
      scrollRef.current?.scrollTo({
        x: (currentIndex + 1) * SCREEN_WIDTH,
        animated: true,
      });
      setCurrentIndex(currentIndex + 1);
    } else {
      if (onFinish) onFinish();
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {/* Main Horizontal ScrollView */}
      <Animated.ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        onMomentumScrollEnd={(e) => {
          const index = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
          setCurrentIndex(index);
        }}
      >
        {SLIDES.map((slide) => (
          <View style={styles.slide} key={slide.id}>
            {/* Background Layer */}
            {slide.type === 'image' ? (
              <Image
                source={slide.source}
                style={styles.fullMedia}
                resizeMode="cover"
              />
            ) : (
              <VideoSlideItem item={slide} />
            )}

            {/* Dark Overlay Layer */}
            <View style={styles.overlay} pointerEvents="none" />

            {/* Foreground Content */}
            <SafeAreaView style={styles.contentContainer}>
              <View style={styles.topSection}>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{slide.message}</Text>
                </View>
              </View>

              <View style={styles.textContainer}>
                <Text style={styles.title}>{slide.title}</Text>
                <Text style={styles.subtitle}>{slide.subtitle}</Text>
              </View>
            </SafeAreaView>
          </View>
        ))}
      </Animated.ScrollView>

      {/* Footer Controls */}
      <SafeAreaView style={styles.footerSafeArea} pointerEvents="box-none">
        <View style={styles.footer}>
          <View style={styles.paginationContainer}>
            {SLIDES.map((_, index) => {
              const animatedDotStyle = useAnimatedStyle(() => {
                const inputRange = [
                  (index - 1) * SCREEN_WIDTH,
                  index * SCREEN_WIDTH,
                  (index + 1) * SCREEN_WIDTH,
                ];

                const dotWidth = interpolate(
                  scrollX.value,
                  inputRange,
                  [8, 24, 8],
                  Extrapolation.CLAMP
                );

                const opacity = interpolate(
                  scrollX.value,
                  inputRange,
                  [0.4, 1, 0.4],
                  Extrapolation.CLAMP
                );

                return {
                  width: dotWidth,
                  opacity,
                };
              });

              return <Animated.View key={index} style={[styles.dot, animatedDotStyle]} />;
            })}
          </View>

          <TouchableOpacity style={styles.button} onPress={handleNext} activeOpacity={0.8}>
            <Text style={styles.buttonText}>
              {currentIndex === SLIDES.length - 1 ? 'Get Started' : 'Next'}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  slide: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    position: 'relative',
  },
  fullMedia: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    backgroundColor: 'rgba(15, 23, 42, 0.65)', // Darker overlay for guaranteed text contrast
  },
  contentContainer: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 40,
    paddingBottom: 150,
  },
  topSection: {
    alignItems: 'center',
    marginTop: 20,
  },
  badge: {
    backgroundColor: 'rgba(56, 189, 248, 0.25)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.5)',
  },
  badgeText: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  textContainer: {
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 15,
    color: '#E2E8F0',
    textAlign: 'center',
    lineHeight: 22,
  },
  footerSafeArea: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 20,
    gap: 20,
  },
  paginationContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    height: 16,
  },
  dot: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#38BDF8',
    marginHorizontal: 4,
  },
  button: {
    backgroundColor: '#0284C7',
    height: 56,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
  },
});
