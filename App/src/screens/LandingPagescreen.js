import React, { useState, useRef } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  SafeAreaView, 
  StatusBar, 
  ScrollView, 
  Dimensions, 
  Image 
} from 'react-native';

const { width } = Dimensions.get('window');

export default function OnboardingScreen({ navigation }) {
  const [currentPage, setCurrentPage] = useState(0);
  const scrollViewRef = useRef(null);

  // 👇 CHANGE THIS: Use require() pointing to your local assets folder
  const images = [
    require('../../assets/images/LandinPic1.png'),   // Adjust path based on where this file is located
    require('../../assets/images/LandinPic2.png'),
    require('../../assets/images/LandinPic3.png')
  ];

  const slides = [
    {
      title: 'Real-Time Tracking',
      description: 'Monitor your entire fleet with pinpoint GPS accuracy and share live ETAs with customers instantly.',
    },
    {
      title: 'Smart Route Optimization',
      description: 'AI-powered routing saves up to 20% on fuel. Accounts for traffic, weather, and delivery windows.',
    },
    {
      title: 'Instant Proof of Delivery',
      description: 'Confirm drop-offs instantly, capture e-signatures or notes on the spot, and keep your records completely up to date..',
    },
  ];

  const handleScroll = (event) => {
    const page = Math.round(event.nativeEvent.contentOffset.x / width);
    setCurrentPage(page);
  };

  const handleNext = () => {
    if (currentPage < slides.length - 1) {
      scrollViewRef.current?.scrollTo({
        x: width * (currentPage + 1),
        animated: true,
      });
    } else {
      navigation.navigate('Login'); 
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      
      {currentPage < slides.length - 1 && (
        <TouchableOpacity 
          style={styles.skipButton}
          onPress={() => navigation.navigate('Login')}
        >
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
      )}

      <ScrollView
        ref={scrollViewRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScroll}
        style={styles.scrollView}
      >
        {slides.map((slide, index) => (
          <View key={index} style={styles.slide}>
            <View style={styles.imageContainer}>
              <Image 
                // 👇 CHANGE THIS: Remove { uri: ... } and just pass the require directly
                source={images[index]} 
                style={styles.image}
                resizeMode="contain"
              />
            </View>

            <View style={styles.textContainer}>
              <Text style={styles.title}>{slide.title}</Text>
              <Text style={styles.description}>{slide.description}</Text>
            </View>
          </View>
        ))}
      </ScrollView>

      <View style={styles.bottomControls}>
        <View style={styles.pagination}>
          {slides.map((_, index) => (
            <View
              key={index}
              style={[
                styles.dot,
                currentPage === index && styles.activeDot,
              ]}
            />
          ))}
        </View>

        <TouchableOpacity 
          style={styles.nextButton}
          onPress={handleNext}
          activeOpacity={0.8}
        >
          <Text style={styles.nextButtonText}>
            {currentPage === slides.length - 1 ? 'Get Started' : 'Next'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ... (Keep the exact same StyleSheet from the previous code) ...
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  skipButton: { position: 'absolute', top: 20, right: 20, zIndex: 10, padding: 10 },
  skipText: { color: '#64748b', fontSize: 16, fontWeight: '600' },
  scrollView: { flex: 1 },
  slide: { width: width, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  imageContainer: { width: '100%', height: 350, justifyContent: 'center', alignItems: 'center', marginBottom: 40 },
  image: { width: '100%', height: '100%' },
  textContainer: { alignItems: 'center', maxWidth: 320 },
  title: { fontSize: 28, fontWeight: '800', color: '#0f172a', textAlign: 'center', marginBottom: 16, lineHeight: 36 },
  description: { fontSize: 16, color: '#475569', textAlign: 'center', lineHeight: 24 },
  bottomControls: { paddingHorizontal: 24, paddingBottom: 40, paddingTop: 20 },
  pagination: { flexDirection: 'row', justifyContent: 'center', marginBottom: 24 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#cbd5e1', marginHorizontal: 4 },
  activeDot: { backgroundColor: '#0d9488', width: 24 },
  nextButton: {
    backgroundColor: '#0d9488',
    paddingVertical: 16,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#0d9488',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 5,
  },
  nextButtonText: { color: '#ffffff', fontSize: 18, fontWeight: '700' },
});