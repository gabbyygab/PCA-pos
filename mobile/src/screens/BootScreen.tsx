import { useEffect, useRef, useState } from 'react'
import { Animated, Easing, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { isConfigured } from '@/lib/supabase/client'
import { colors, boardHead, boardLabel, radius } from '@/theme'

/**
 * What the cashier sees between the native splash and the first real screen.
 *
 * Reading the stored session back out of AsyncStorage takes a beat, and on a
 * cold morning start that beat lands right after the OS splash. A bare spinner
 * there reads as a stall; the mark plus a moving bar reads as the app coming
 * up, and it carries the same black-and-red board identity as the splash it
 * replaces, so the handoff looks like one continuous boot rather than two
 * different screens.
 *
 * Boot is normally a blink, so the screen says nothing beyond the mark. If it
 * is still up after a few seconds something is wrong — a dead network on a shop
 * with one router, usually — and a stalled progress bar with no words is the
 * worst thing to hand a cashier with a queue. So a line of explanation fades in
 * rather than leaving them guessing whether the app is broken.
 */
export function BootScreen({ label = 'Starting up' }: { label?: string }) {
  const sweep = useRef(new Animated.Value(0)).current
  const insets = useSafeAreaInsets()
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 5000)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: 1100,
        easing: Easing.inOut(Easing.cubic),
        // Transform only, so the whole thing runs off the JS thread — which is
        // the thread currently busy reading storage and hydrating the session.
        useNativeDriver: true,
      })
    )
    loop.start()
    return () => loop.stop()
  }, [sweep])

  return (
    <View
      style={[
        styles.wrap,
        // The splash it hands off from is drawn edge to edge, but the notch
        // still must not clip the message on a long boot.
        { paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
    >
      <View style={styles.logo}>
        <Text style={[boardHead, styles.logoText]}>PCA</Text>
      </View>

      <Text style={[boardLabel, styles.kicker]}>{label}</Text>

      <View style={styles.track}>
        <Animated.View
          style={[
            styles.bar,
            {
              transform: [
                {
                  // The bar is a third of the track, so it travels from fully
                  // off the left edge to fully off the right.
                  translateX: sweep.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-TRACK / 3, TRACK],
                  }),
                },
              ],
            },
          ]}
        />
      </View>

      {slow ? (
        <Text style={styles.slow}>
          {isConfigured
            ? 'Taking longer than usual. Check the internet connection.'
            : 'This build has no Supabase URL or key configured.'}
        </Text>
      ) : null}
    </View>
  )
}

const TRACK = 132

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ink,
  },
  logo: {
    width: 84,
    height: 84,
    borderRadius: radius.lg,
    backgroundColor: colors.red,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: { fontSize: 30, color: '#fff' },
  kicker: { color: colors.faint, fontSize: 11, marginTop: 16, marginBottom: 18 },
  track: {
    width: TRACK,
    height: 3,
    borderRadius: 999,
    backgroundColor: colors.surface2,
    overflow: 'hidden',
  },
  slow: {
    color: colors.faint,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    marginTop: 22,
    paddingHorizontal: 40,
  },
  bar: {
    width: TRACK / 3,
    height: 3,
    borderRadius: 999,
    backgroundColor: colors.red,
  },
})
