import { useRef, useState } from 'react'
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Button } from '@/components/Button'
import { useKeyboard } from '@/lib/keyboard/useKeyboard'
import { createClient, isConfigured } from '@/lib/supabase/client'
import { colors, boardHead, boardLabel, radius, TAP } from '@/theme'

export function LoginScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const passwordRef = useRef<TextInput>(null)
  const insets = useSafeAreaInsets()
  const keyboard = useKeyboard()

  async function signIn() {
    if (!email.trim() || !password) return
    setBusy(true)
    setError(null)
    const { error } = await createClient().auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    if (error) {
      setError(error.message)
      setBusy(false)
      return
    }
    // On success the session listener swaps this screen out; leaving `busy`
    // set avoids a flash of the enabled button during that swap.
  }

  return (
    <View style={styles.flex}>
      {/*
        `KeyboardAvoidingView` used to do this job, on the assumption that a
        non-modal Android window really is shrunk by `adjustResize`. Under
        `edgeToEdgeEnabled` it is not — the window keeps its full height and the
        keyboard arrives as an inset — so `behavior="height"` had nothing to
        react to and the password field stayed behind the keys. Padding the
        scroller by the measured height is the same fix the sheets use, and it
        behaves identically on both platforms.

        The content is centred via `flexGrow` + `justifyContent`, so the padding
        re-centres the form in the space above the keyboard rather than merely
        making room to scroll to it.
      */}
      <ScrollView
        contentContainerStyle={[
          styles.wrap,
          { paddingTop: insets.top + 24, paddingBottom: keyboard.height + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        {/* The logo slot: the owner is supplying the real mark later. */}
        <View style={styles.logo}>
          <Text style={[boardHead, styles.logoText]}>PCA</Text>
        </View>
        <Text style={[boardLabel, styles.kicker]}>Cashier</Text>

        {!isConfigured ? (
          <Text style={styles.warn}>
            Supabase keys are missing from app.json — see mobile/README.md.
          </Text>
        ) : null}

        <View style={styles.form}>
          <Text style={[boardLabel, styles.label]}>Email</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="username"
            autoComplete="email"
            placeholder="cashier@pca.com"
            placeholderTextColor={colors.faint}
            style={styles.input}
            // Next, not Go: the keyboard stays up and focus moves down, so
            // signing in is two taps instead of four.
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => passwordRef.current?.focus()}
          />

          <Text style={[boardLabel, styles.label, { marginTop: 14 }]}>Password</Text>
          <TextInput
            ref={passwordRef}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="password"
            autoComplete="password"
            placeholder="••••••••"
            placeholderTextColor={colors.faint}
            style={styles.input}
            onSubmitEditing={signIn}
            returnKeyType="go"
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Button
            label="Sign in"
            onPress={signIn}
            loading={busy}
            disabled={!email.trim() || !password}
            style={{ marginTop: 18 }}
          />
        </View>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.ink },
  // Vertical padding is applied per render — see the ScrollView.
  wrap: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24 },
  logo: {
    alignSelf: 'center',
    width: 84,
    height: 84,
    borderRadius: radius.lg,
    backgroundColor: colors.red,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: { fontSize: 30, color: '#fff' },
  kicker: {
    alignSelf: 'center',
    color: colors.muted,
    fontSize: 12,
    marginTop: 10,
    marginBottom: 26,
  },
  form: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 18,
  },
  label: { color: colors.faint, fontSize: 10, marginBottom: 6 },
  input: {
    minHeight: TAP,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.ink,
    color: colors.chalk,
    paddingHorizontal: 14,
    fontSize: 15,
  },
  error: { color: colors.redHot, fontSize: 13, marginTop: 14 },
  warn: { color: colors.warn, fontSize: 12, textAlign: 'center', marginBottom: 16 },
})
