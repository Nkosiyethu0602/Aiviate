import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import ModalHeader from '../components/ModalHeader';
import Avatar from '../components/Avatar';
import { useAuth } from '../contexts/AuthContext';
import { useDriver } from '../contexts/DriverContext';
import { COLORS } from '../theme';

// Hard-coded profile stats. Change these numbers to whatever you like.
const STATS = {
  rating: 4.8,
  routes: 7,
  stops: 37,
  km: 140.4,
};

const Row = ({ icon, label, value }) => (
  <View style={styles.row}>
    <View style={styles.rowIcon}>
      <Ionicons name={icon} size={18} color={COLORS.textDim} />
    </View>
    <View style={{ flex: 1 }}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  </View>
);

export default function ProfileScreen({ navigation }) {
  const { driver } = useDriver();
  const { signOut } = useAuth();

  if (!driver) {
    return <SafeAreaView style={styles.container} />;
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ModalHeader
        title="Profile"
        onBack={() => navigation.goBack()}
        rightLabel="Edit"
        onRightPress={() => navigation.navigate('EditProfile')}
      />

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.heroCard}>
          <Avatar
            uri={driver.avatar_url}
            initials={driver.initials}
            size={88}
            fontSize={30}
            style={styles.avatar}
          />
          <Text style={styles.name}>{driver.name}</Text>
          <Text style={styles.empId}>{driver.employee_id}</Text>
          <View style={styles.ratingRow}>
            <Ionicons name="star" size={14} color="#FFB300" />
            <Text style={styles.rating}>{STATS.rating.toFixed(1)}</Text>
            <Text style={styles.ratingDim}>· driver rating</Text>
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{STATS.routes.toLocaleString()}</Text>
            <Text style={styles.statLabel}>Routes</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{STATS.stops.toLocaleString()}</Text>
            <Text style={styles.statLabel}>Stops</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{STATS.km.toLocaleString()}</Text>
            <Text style={styles.statLabel}>km</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Contact</Text>
        <View style={styles.card}>
          <Row icon="call-outline" label="Phone" value={driver.phone} />
          <View style={styles.divider} />
          <Row icon="mail-outline" label="Email" value={driver.email} />
        </View>

        <Text style={styles.sectionTitle}>Vehicle</Text>
        <View style={styles.card}>
          <Row icon="car-outline" label="Model" value={driver.vehicle} />
          <View style={styles.divider} />
          <Row icon="pricetag-outline" label="Plate" value={driver.vehicle_plate} />
        </View>

        <Text style={styles.sectionTitle}>Account</Text>
        <View style={styles.card}>
          <Row icon="calendar-outline" label="Joined" value={driver.joined} />
        </View>

        <TouchableOpacity
          style={styles.signOut}
          activeOpacity={0.85}
          onPress={() => {
            Alert.alert?.('Sign out', 'Sign out of the driver app?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Sign out', style: 'destructive', onPress: signOut },
            ]);
          }}
        >
          <Ionicons name="log-out-outline" size={18} color={COLORS.danger} />
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>

        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    backgroundColor: COLORS.navy,
    paddingHorizontal: 16, paddingTop: 18, paddingBottom: 16,
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center', justifyContent: 'center',
  },
  title: { color: '#fff', fontSize: 20, fontWeight: '700', flex: 1, textAlign: 'center' },
  scroll: { padding: 16 },

  heroCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 18,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1, borderColor: COLORS.border,
    marginBottom: 12,
  },
  avatar: {
    marginBottom: 12,
    borderWidth: 3,
    borderColor: COLORS.surface,
  },
  name: { fontSize: 20, fontWeight: '700', color: COLORS.text },
  empId: { fontSize: 12, color: COLORS.textDim, marginTop: 2 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 10 },
  rating: { fontSize: 14, fontWeight: '700', color: COLORS.text },
  ratingDim: { fontSize: 12, color: COLORS.textDim, marginLeft: 2 },

  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 22 },
  statCard: {
    flex: 1, backgroundColor: COLORS.surface,
    padding: 14, borderRadius: 14, alignItems: 'center',
    borderWidth: 1, borderColor: COLORS.border,
  },
  statValue: { fontSize: 22, fontWeight: '800', color: COLORS.text, letterSpacing: -0.4 },
  statLabel: { fontSize: 11, color: COLORS.textDim, marginTop: 4 },

  sectionTitle: {
    fontSize: 13, fontWeight: '600', color: COLORS.textDim,
    textTransform: 'uppercase', letterSpacing: 0.6,
    marginBottom: 10, marginLeft: 4, marginTop: 6,
  },
  card: {
    backgroundColor: COLORS.surface, borderRadius: 14,
    padding: 14, borderWidth: 1, borderColor: COLORS.border,
    marginBottom: 16,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowIcon: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: COLORS.fill,
    alignItems: 'center', justifyContent: 'center',
  },
  rowLabel: { fontSize: 11, color: COLORS.textDim, textTransform: 'uppercase', letterSpacing: 0.5 },
  rowValue: { fontSize: 14, color: COLORS.text, fontWeight: '600', marginTop: 2 },
  divider: { height: 1, backgroundColor: COLORS.border, marginVertical: 10 },

  signOut: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, padding: 14, borderRadius: 14,
    backgroundColor: COLORS.surface,
    borderWidth: 1, borderColor: COLORS.border,
  },
  signOutText: { color: COLORS.danger, fontWeight: '600', fontSize: 14 },
});