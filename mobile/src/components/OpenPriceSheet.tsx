import { useEffect, useRef, useState } from 'react'
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Button } from '@/components/Button'
import { useKeyboard } from '@/lib/keyboard/useKeyboard'
import { pesosToCentavos } from '@shared/lib/currency'
import { colors, boardHead, radius } from '@/theme'

interface OpenPriceSheetProps {
  serviceName: string | null
  onCancel: () => void
  onConfirm: (centavos: number) => void
}

/**
 * Some board services carry no fixed price ("3500 AND UP", blank, "STARTING
 * 13K"), so the cashier types the agreed amount. We never invent a default.
 *
 * The field is focused on open, which means the keyboard is already up before
 * the card settles — so the card is centred in the space *above* the keyboard
 * rather than in the screen. `KeyboardAvoidingView` cannot do this job here:
 * inside a `statusBarTranslucent` modal Android never applies `adjustResize`
 * to the modal window, so the view has no size change to react to and the card
 * stays behind the keys.
 */
export function OpenPriceSheet({
  serviceName,
  onCancel,
  onConfirm,
}: OpenPriceSheetProps) {
  const [value, setValue] = useState('')
  const inputRef = useRef<TextInput>(null)
  const keyboard = useKeyboard()

  // Clear between services: reopening for another car must not inherit the
  // last car's amount.
  useEffect(() => {
    if (serviceName) {
      setValue('')
      const t = setTimeout(() => inputRef.current?.focus(), 120)
      return () => clearTimeout(t)
    }
  }, [serviceName])

  const pesos = Number.parseFloat(value)
  const valid = Number.isFinite(pesos) && pesos > 0

  function submit() {
    if (!valid) return
    onConfirm(pesosToCentavos(pesos))
  }

  return (
    <Modal
      visible={serviceName !== null}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <View style={styles.wrap}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />
        {/*
         * A scroller rather than a plain View: on a short phone in landscape
         * the card plus the keyboard can exceed the remaining height, and the
         * Add button must still be reachable instead of clipped.
         */}
        <ScrollView
          style={[styles.scroll, { marginBottom: keyboard.height }]}
          contentContainerStyle={styles.scrollBody}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.card}>
            <Text style={[boardHead, styles.title]}>{serviceName}</Text>
            <Text style={styles.hint}>
              No fixed price on the board — enter the agreed amount.
            </Text>

            <View style={styles.field}>
              <Text style={styles.peso}>₱</Text>
              <TextInput
                ref={inputRef}
                value={value}
                onChangeText={setValue}
                // decimal-pad, not numeric: the shop types 3500 or 3500.50 and
                // never needs the phone keypad's extra symbols.
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={colors.faint}
                style={styles.input}
                onSubmitEditing={submit}
                returnKeyType="done"
                // decimal-pad has no return key on Android, so the Add button
                // is the only way to commit there — it stays in view because
                // the card sits above the keyboard.
                submitBehavior="submit"
              />
            </View>

            <View style={styles.actions}>
              <Button label="Cancel" variant="ghost" onPress={onCancel} style={{ flex: 1 }} />
              <Button label="Add" onPress={submit} disabled={!valid} style={{ flex: 1 }} />
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  scroll: { flex: 1 },
  scrollBody: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    padding: 18,
  },
  title: { fontSize: 18 },
  hint: { color: colors.muted, fontSize: 12, marginTop: 4 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.ink,
    paddingHorizontal: 14,
  },
  peso: { color: colors.chalk, fontSize: 20, fontWeight: '800', marginRight: 8 },
  input: {
    flex: 1,
    color: colors.chalk,
    fontSize: 22,
    fontWeight: '700',
    paddingVertical: 14,
  },
  actions: { flexDirection: 'row', gap: 10, marginTop: 18 },
})
