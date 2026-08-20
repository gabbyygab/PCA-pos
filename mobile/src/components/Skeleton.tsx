import { useEffect, useRef } from 'react'
import { Animated, Easing, StyleSheet, View, type ViewStyle } from 'react-native'
import { colors, radius } from '@/theme'

interface SkeletonProps {
  width?: ViewStyle['width']
  height?: number
  radius?: number
  style?: ViewStyle
}

/**
 * A placeholder block that breathes.
 *
 * The POS runs on cheap Android hardware next to a wash bay, so this is an
 * opacity loop on the native driver — no gradient sweep, no layout work per
 * frame. Opacity is the one property the UI thread can animate on its own,
 * which keeps the pulse smooth even while the catalog query is parsing.
 */
export function Skeleton({ width = '100%', height = 14, radius: r = radius.sm, style }: SkeletonProps) {
  const pulse = useRef(new Animated.Value(0)).current

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 720,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 720,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [pulse])

  return (
    <Animated.View
      // Not a "loading" label per block: a screenful of these would read out
      // one by one. The screen that owns them announces the load instead.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.block,
        { width, height, borderRadius: r },
        // 0.45 → 1 rather than 0 → 1: a block that vanishes entirely reads as
        // a flicker, not as something arriving.
        { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }) },
        style,
      ]}
    />
  )
}

/**
 * The board mid-load: two columns of tiles at the real card height, so the
 * grid does not jump when the services land.
 */
export function ServiceGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <View
      accessible
      accessibilityLabel="Loading the price board"
      accessibilityRole="progressbar"
      style={styles.grid}
    >
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={styles.tile}>
          <Skeleton width="80%" height={13} />
          <Skeleton width="55%" height={9} style={{ marginTop: 6 }} />
          <Skeleton width="42%" height={16} style={{ marginTop: 'auto' }} />
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  block: { backgroundColor: colors.surface2 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    padding: 16,
  },
  tile: {
    // Two per row, matching the live grid's numColumns={2} and its gap.
    width: '48%',
    flexGrow: 1,
    minHeight: 104,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    padding: 12,
  },
})
