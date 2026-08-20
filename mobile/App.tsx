import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useKeyboard } from '@/lib/keyboard/useKeyboard'
import { SessionProvider, useSession } from '@/lib/auth/session'
import { BootScreen } from '@/screens/BootScreen'
import { LoginScreen } from '@/screens/LoginScreen'
import { ExpensesScreen } from '@/screens/ExpensesScreen'
import { PosScreen } from '@/screens/PosScreen'
import { ServicesScreen } from '@/screens/ServicesScreen'
import { boardLabel, colors, space, TAP } from '@/theme'

/**
 * The cashier app is ringing up sales and recording the work — nothing else.
 *
 * There is still no payroll or reports screen to guard, because none is built
 * here; the restriction is structural rather than a UI check. RLS is the real
 * boundary underneath: the same anon key ships on every device, so a cashier's
 * JWT is what stops payroll being read, not this bundle's lack of a screen.
 *
 * Expenses is here because the cashier is who is standing at the counter when
 * the soap is bought — an expense only the owner can record is one that gets
 * typed in late or not at all, and a missing cost is what makes net sales
 * wrong. RLS gives them insert plus the Manila day in progress, so the screen
 * is a working sheet, not the ledger: no history, no edit, no delete.
 *
 * Three screens now, so there is a switch between them. It is still a plain row
 * of buttons rather than a navigation library: with a handful of destinations
 * and no deep linking or history to model, a navigator would be a dependency
 * and a bundle cost for an enum.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A dropped connection stops the POS either way, so failing fast and
      // showing Retry beats a long silent hang beside a running wash bay.
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

type Tab = 'pos' | 'services' | 'expenses'

function Root() {
  const { session, loading } = useSession()
  const [tab, setTab] = useState<Tab>('pos')
  const keyboard = useKeyboard()

  // The screens are inset from the bottom to clear the tab bar. With the
  // keyboard up the bar is gone, so that reserved strip becomes a dead band
  // between the content and the keys unless it is handed back.
  const bottomGap = { bottom: keyboard.visible ? 0 : TAP + space(4) }

  if (loading) return <BootScreen />

  // Mounting the POS without a session would fire every catalog query as
  // `anon`, which RLS answers with empty rows — the screen would read as "no
  // services" instead of "not signed in".
  if (!session) return <LoginScreen />

  return (
    <View style={{ flex: 1, backgroundColor: colors.ink }}>
      {/* Both screens stay mounted: the POS holds an in-progress cart, and
          unmounting it to glance at the service record would throw the sale
          away mid-ring-up. */}
      <View
        style={[styles.screen, bottomGap, tab !== 'pos' && styles.hidden]}
        pointerEvents={tab === 'pos' ? 'auto' : 'none'}
      >
        <PosScreen />
      </View>
      <View
        style={[styles.screen, bottomGap, tab !== 'services' && styles.hidden]}
        pointerEvents={tab === 'services' ? 'auto' : 'none'}
      >
        <ServicesScreen />
      </View>
      <View
        style={[styles.screen, bottomGap, tab !== 'expenses' && styles.hidden]}
        pointerEvents={tab === 'expenses' ? 'auto' : 'none'}
      >
        <ExpensesScreen />
      </View>
      <TabBar tab={tab} onChange={setTab} />
    </View>
  )
}

/**
 * The switch hides itself while the keyboard is up.
 *
 * It is pinned to the bottom of the window and an Android activity under
 * edge-to-edge is not resized by the keyboard, so it would otherwise sit over
 * the keys — a strip of dead buttons on top of the keyboard's top row, stealing
 * taps meant for letters. Nobody changes tab mid-word, so it steps out rather
 * than being lifted, which also gives the field the full remaining height.
 */
function TabBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const insets = useSafeAreaInsets()
  const keyboard = useKeyboard()

  if (keyboard.visible) return null

  return (
    <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, space(2)) }]}>
      <TabButton label="POS" active={tab === 'pos'} onPress={() => onChange('pos')} />
      <TabButton
        label="Services"
        active={tab === 'services'}
        onPress={() => onChange('services')}
      />
      <TabButton
        label="Expenses"
        active={tab === 'expenses'}
        onPress={() => onChange('expenses')}
      />
    </View>
  )
}

function TabButton({
  label,
  active,
  onPress,
}: {
  label: string
  active: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.tab, pressed && { opacity: 0.7 }]}
    >
      <View style={[styles.tabMark, active && { backgroundColor: colors.red }]} />
      <Text style={[styles.tabText, active && { color: colors.chalk }]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  // `bottom` is set per render — see `bottomGap` in Root.
  screen: { ...StyleSheet.absoluteFillObject },
  // `display: none` rather than unmounting, so the hidden screen keeps its
  // state and its scroll position.
  hidden: { display: 'none' },
  tabBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.surface,
    paddingTop: space(1),
  },
  tab: { flex: 1, minHeight: TAP, alignItems: 'center', justifyContent: 'center', gap: 4 },
  tabMark: { height: 3, width: 22, borderRadius: 2, backgroundColor: 'transparent' },
  tabText: { ...boardLabel, color: colors.muted, fontSize: 11 },
})

export default function App() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <StatusBar style="light" />
          <Root />
        </SessionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  )
}
