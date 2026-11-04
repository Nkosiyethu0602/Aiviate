import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  RefreshControl,
  Animated,
  Easing,
  Platform,
} from 'react-native';

const USE_NATIVE = Platform.OS !== 'web';
import { Ionicons } from '@expo/vector-icons';
import { getHistory } from '../services/api';
import ScreenHeader from '../components/ScreenHeader';
import { SkeletonCard, SkeletonRow } from '../components/Skeleton';
import { haptic } from '../utils/haptics';
import { COLORS } from '../theme';
import { formatDuration } from '../utils/format';

function FadeIn({ children, delay = 0 }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(8)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 360, delay, useNativeDriver: USE_NATIVE, easing: Easing.out(Easing.quad) }),
      Animated.timing(ty, { toValue: 0, duration: 360, delay, useNativeDriver: USE_NATIVE, easing: Easing.out(Easing.cubic) }),
    ]).start();
  }, [delay, opacity, ty]);
  return <Animated.View style={{ opacity, transform: [{ translateY: ty }] }}>{children}</Animated.View>;
}

// Group history items into iOS-style "Today / Yesterday / Earlier" sections,
// preserving original order within each section.
const groupHistory = (items) => {
  const out = { Today: [], Yesterday: [], Earlier: [] };
  for (const it of items) {
    if (it.date.startsWith('Today')) out.Today.push(it);
    else if (it.date.startsWith('Yesterday')) out.Yesterday.push(it);
    else out.Earlier.push(it);
  }
  return [
    { key: 'Today', items: out.Today },
    { key: 'Yesterday', items: out.Yesterday },
    { key: 'Earlier', items: out.Earlier },
  ].filter((s) => s.items.length);
};

// Strip the day token ("Today", "Yesterday", "N days ago") and the bullet
// separator when the section header already communicates the day, leaving
// just the time-of-day if present (or empty if not).
const stripDatePrefix = (date) => {
  const cleaned = date
    .replace(/^Today(\s·\s|\s*)/i, '')
    .replace(/^Yesterday(\s·\s|\s*)/i, '')
    .replace(/^\d+\s+days?\s+ago(\s·\s|\s*)/i, '')
    .trim();
  return cleaned;
};

// Determine route performance badge based on aggregate math (Distance, Duration, Stops)
const getRouteBadge = (distanceKm, durationMin, stops) => {
  const hours = durationMin / 60;
  const avgSpeed = hours > 0 ? distanceKm / hours : 0;
  const timePerStop = stops > 0 ? durationMin / stops : 0;

  if (stops >= 4 && timePerStop <= 12) {
    return { label: '🏆 Precision Parking', color: '#b45309', bg: '#fef3c7' };
  } else if (avgSpeed > 35 && durationMin < 45) {
    return { label: '⚡ Speedy Dispatch', color: '#0d9488', bg: '#ccfbf1' };
  } else {
    return { label: '🌿 EcoCruiser', color: '#16a34a', bg: '#dcfce7' };
  }
};

export default function HistoryScreen() {
  const [data, setData] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const res = await getHistory();
    setData(res.data);
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    haptic.light();
    await load();
    setRefreshing(false);
  };

  const sections = useMemo(() => (data ? groupHistory(data.history) : []), [data]);

  if (!data) {
    return (
      <SafeAreaView style={styles.container}>
        <ScreenHeader title="History" subtitle="Loading…" />
        <View style={styles.scroll}>
          <SkeletonCard />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </View>
      </SafeAreaView>
    );
  }

  // Headline metric: today's km, clean and large like Apple Fitness.
  const headlineNumber = data.todayKm.toFixed(1);

  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader title="History" subtitle={`${data.todayRoutes} ${data.todayRoutes === 1 ? 'route' : 'routes'} today`} />

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.teal}
            colors={[COLORS.teal]}
          />
        }
      >
        {/* Hero — single dominant metric, secondary metrics below a hairline */}
        <FadeIn>
          <View style={styles.hero}>
            <Text style={styles.heroEyebrow}>Today</Text>
            <View style={styles.heroValueRow}>
              <Text style={styles.heroValue}>{headlineNumber}</Text>
              <Text style={styles.heroUnit}>km</Text>
            </View>
            <Text style={styles.heroCaption}>on the road</Text>

            <View style={styles.heroDivider} />

            <View style={styles.heroSecondary}>
              <HeroStat icon="cube-outline" value={String(data.todayStops)} label="Stops" />
              <View style={styles.vDivider} />
              <HeroStat icon="time-outline" value={formatDuration(data.todayMin)} label="On road" />
              <View style={styles.vDivider} />
              <HeroStat icon="flag-outline" value={String(data.todayRoutes)} label="Routes" />
            </View>
          </View>
        </FadeIn>

        {/* This week — secondary card with mini-bars (Apple Activity vibe) */}
        <FadeIn delay={70}>
          <Text style={styles.sectionTitle}>This week</Text>
          <View style={styles.weekCard}>
            <WeekRow
              label="Distance"
              value={`${data.weekKm.toFixed(1)} km`}
              fraction={data.todayKm / Math.max(data.weekKm, 1)}
            />
            <View style={styles.rowDivider} />
            <WeekRow
              label="Stops"
              value={String(data.weekStops)}
              fraction={data.todayStops / Math.max(data.weekStops, 1)}
            />
            <View style={styles.rowDivider} />
            <WeekRow
              label="Routes"
              value={String(data.weekRoutes)}
              fraction={data.todayRoutes / Math.max(data.weekRoutes, 1)}
            />
          </View>
        </FadeIn>

        {/* Recent routes — a SINGLE grouped card containing all sections,
            with inline day sub-headers and hairline-separated rows. */}
        <FadeIn delay={140}>
          <Text style={styles.sectionTitle}>Recent routes</Text>
          <View style={styles.groupCard}>
            {sections.map((section, sIdx) => (
              <React.Fragment key={section.key}>
                {sIdx > 0 && <View style={styles.rowDivider} />}
                <Text style={styles.subSectionLabel}>{section.key}</Text>
                {section.items.map((item, i) => (
                  <React.Fragment key={item.id}>
                    <HistoryRow item={item} hideDay={section.key !== 'Earlier'} />
                    {i < section.items.length - 1 && <View style={styles.rowDividerInset} />}
                  </React.Fragment>
                ))}
              </React.Fragment>
            ))}
          </View>
        </FadeIn>

        <Text style={styles.footnote}>Showing the last {data.weekRoutes} completed routes.</Text>
        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function HeroStat({ icon, value, label }) {
  return (
    <View style={styles.heroStat}>
      <Ionicons name={icon} size={14} color={COLORS.textDim} />
      <Text style={styles.heroStatValue}>{value}</Text>
      <Text style={styles.heroStatLabel}>{label}</Text>
    </View>
  );
}

function WeekRow({ label, value, fraction = 0 }) {
  const f = Math.max(0, Math.min(1, fraction || 0));
  // Strict proportionality: 0 stays 0. Only nudge to a visible minimum when
  // there IS some progress, so a tiny sliver doesn't disappear.
  const widthPct = f === 0 ? 0 : Math.max(f * 100, 4);
  return (
    <View style={styles.weekRow}>
      <Text style={styles.weekLabel}>{label}</Text>
      <View style={styles.weekBarWrap}>
        <View style={[styles.weekBarFill, { width: `${widthPct}%` }]} />
      </View>
      <Text style={styles.weekValue}>{value}</Text>
    </View>
  );
}

function HistoryRow({ item, hideDay }) {
  const stripped = hideDay ? stripDatePrefix(item.date) : item.date;
  const meta = stripped ? `${stripped} · ${item.stops} stops` : `${item.stops} stops`;
  const badge = getRouteBadge(item.distance_km, item.duration_min, item.stops);

  return (
    <View
      accessible
      accessibilityRole="summary"
      accessibilityLabel={`${item.id}, ${meta}, ${item.distance_km} kilometres, ${formatDuration(item.duration_min)}, Achievement: ${badge.label}`}
      style={styles.row}
    >
      <View style={styles.rowIcon}>
        <Ionicons name="checkmark" size={15} color={COLORS.textDim} />
      </View>
      <View style={styles.rowMain}>
        <View style={styles.rowTitleRow}>
          <Text style={styles.rowTitle}>{item.id}</Text>
          <View style={[styles.badgeContainer, { backgroundColor: badge.bg }]}>
            <Text style={[styles.badgeText, { color: badge.color }]}>{badge.label}</Text>
          </View>
        </View>
        <Text style={styles.rowMeta}>{meta}</Text>
      </View>
      <View style={styles.rowRight}>
        <Text style={styles.rowValue}>{item.distance_km} km</Text>
        <Text style={styles.rowSub}>{formatDuration(item.duration_min)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { padding: 16, paddingTop: 12 },

  /* Hero (Today) */
  hero: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 22,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 20,
  },
  heroEyebrow: {
    color: COLORS.textDim,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  heroValueRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 6 },
  heroValue: {
    fontSize: 48,
    lineHeight: 52,
    fontWeight: '800',
    color: COLORS.text,
    letterSpacing: -1.2,
  },
  heroUnit: { fontSize: 18, fontWeight: '700', color: COLORS.textDim, marginLeft: 6 },
  heroCaption: { color: COLORS.textDim, fontSize: 13, marginTop: 2 },
  heroDivider: { height: 1, backgroundColor: COLORS.border, marginTop: 18, marginBottom: 14 },
  heroSecondary: { flexDirection: 'row', alignItems: 'center' },
  heroStat: { flex: 1, alignItems: 'center', gap: 2 },
  heroStatValue: { fontSize: 16, fontWeight: '700', color: COLORS.text, marginTop: 2 },
  heroStatLabel: { fontSize: 10, color: COLORS.textDim, textTransform: 'uppercase', letterSpacing: 0.6 },
  vDivider: { width: 1, alignSelf: 'stretch', backgroundColor: COLORS.border, marginVertical: 4 },

  /* Section header (iOS grouped-list eyebrow) */
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textDim,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
    marginTop: 6,
    marginLeft: 16,
  },

  /* This-week card with progress bars */
  weekCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 4,
    marginBottom: 22,
  },
  weekRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 14 },
  weekLabel: { width: 70, fontSize: 13, color: COLORS.text, fontWeight: '600' },
  weekBarWrap: { flex: 1, height: 6, borderRadius: 3, backgroundColor: 'rgba(15,42,61,0.06)', overflow: 'hidden' },
  weekBarFill: { height: '100%', backgroundColor: COLORS.teal, borderRadius: 3 },
  weekValue: { fontSize: 13, color: COLORS.text, fontWeight: '700', minWidth: 64, textAlign: 'right' },

  /* Grouped routes card with hairline-separated rows */
  groupCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
    marginBottom: 22,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
    backgroundColor: COLORS.surface,
  },
  rowIcon: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: COLORS.fill,
    alignItems: 'center', justifyContent: 'center',
  },
  rowMain: { flex: 1 },
  rowTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  rowTitle: { fontSize: 15, fontWeight: '600', color: COLORS.text, letterSpacing: -0.1 },
  badgeContainer: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  rowMeta: { fontSize: 12, color: COLORS.textDim, marginTop: 2 },
  rowRight: { alignItems: 'flex-end' },
  rowValue: { fontSize: 14, fontWeight: '700', color: COLORS.text },
  rowSub: { fontSize: 11, color: COLORS.textDim, marginTop: 2 },
  rowDivider: { height: 1, backgroundColor: COLORS.border },
  rowDividerInset: { height: 1, backgroundColor: COLORS.border, marginLeft: 54 },
  subSectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textDim,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 6,
    backgroundColor: 'rgba(15,42,61,0.025)',
  },

  footnote: { fontSize: 11, color: COLORS.textDim, textAlign: 'center', marginTop: 4 },
});