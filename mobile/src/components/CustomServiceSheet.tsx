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
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  DEFAULT_COMMISSION_BP,
  type ServiceCategory,
} from '@shared/lib/domain'
import { colors, boardHead, boardLabel, radius, TAP } from '@/theme'

export interface CustomServiceDraft {
  name: string
  description: string
  centavos: number
  category: ServiceCategory
}

interface CustomServiceSheetProps {
  visible: boolean
  onCancel: () => void
  onConfirm: (draft: CustomServiceDraft) => void
}

/**
 * A one-off service typed at the counter — the cashier-app twin of the
 * dashboard's CustomServiceDialog.
 *
 * The shop occasionally does work that is not on the board and is not worth
 * adding to it. This rings that up without touching the catalogue: the line
 * carries its own name, note, and price and posts a null `service_id`, so the
 * price board stays the record of what the shop actually offers.
 *
 * Commission still applies at the chosen category's rate — the crew worked the
 * car either way — but the rate itself is not editable here. A cashier setting
 * their own cut is the owner's decision, and it lives in Settings.
 *
 * Keyboard handling follows OpenPriceSheet: `KeyboardAvoidingView` cannot do
 * this job, because inside a `statusBarTranslucent` modal Android never applies
 * `adjustResize` to the modal window, so the view has no size change to react
 * to and the card stays behind the keys. The card is centred in the space
 * above the measured keyboard instead.
 */
export function CustomServiceSheet({
  visible,
  onCancel,
  onConfirm,
}: CustomServiceSheetProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [category, setCategory] = useState<ServiceCategory>('addon')

  const nameRef = useRef<TextInput>(null)
  const descRef = useRef<TextInput>(null)
  const priceRef = useRef<TextInput>(null)
  const keyboard = useKeyboard()

  // Clear between cars: reopening must not inherit the last job's text.
  useEffect(() => {
    if (visible) {
      setName('')
      setDescription('')
      setPrice('')
      setCategory('addon')
      const t = setTimeout(() => nameRef.current?.focus(), 120)
      return () => clearTimeout(t)
    }
  }, [visible])

  const pesos = Number.parseFloat(price)
  const valid = name.trim().length > 0 && Number.isFinite(pesos) && pesos > 0

  function submit() {
    if (!valid) return
    onConfirm({
      name: name.trim(),
      description: description.trim(),
      centavos: pesosToCentavos(pesos),
      category,
    })
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <View style={styles.wrap}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />
        {/*
          A scroller rather than a plain View: three fields plus the keyboard
          exceed the remaining height on a short phone, and the Add button must
          stay reachable instead of being clipped.
        */}
        <ScrollView
          style={[styles.scroll, { marginBottom: keyboard.height }]}
          contentContainerStyle={styles.scrollBody}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.card}>
            <Text style={[boardHead, styles.title]}>Custom Service</Text>
            <Text style={styles.hint}>
              One-off work that is not on the board. This sale only — nothing is
              added to the price board.
            </Text>

            <Text style={[boardLabel, styles.label]}>Service *</Text>
            <TextInput
              ref={nameRef}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Undercarriage wash"
              placeholderTextColor={colors.faint}
              style={styles.input}
              maxLength={80}
              returnKeyType="next"
              onSubmitEditing={() => descRef.current?.focus()}
              submitBehavior="submit"
            />

            <Text style={[boardLabel, styles.label]}>Description</Text>
            <TextInput
              ref={descRef}
              value={description}
              onChangeText={setDescription}
              placeholder="What was done (optional)"
              placeholderTextColor={colors.faint}
              style={styles.input}
              maxLength={120}
              returnKeyType="next"
              onSubmitEditing={() => priceRef.current?.focus()}
              submitBehavior="submit"
            />

            <Text style={[boardLabel, styles.label]}>Price *</Text>
            <View style={styles.priceField}>
              <Text style={styles.peso}>₱</Text>
              <TextInput
                ref={priceRef}
                value={price}
                onChangeText={setPrice}
                // decimal-pad, not numeric: the shop types 500 or 500.50 and
                // never needs the keypad's extra symbols.
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={colors.faint}
                style={styles.priceInput}
                onSubmitEditing={submit}
                returnKeyType="done"
                // decimal-pad has no return key on Android, so Add is the only
                // way to commit there — it stays in view above the keyboard.
                submitBehavior="submit"
              />
            </View>

            <Text style={[boardLabel, styles.label]}>Rate</Text>
            <View style={styles.chips}>
              {CATEGORY_ORDER.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => setCategory(c)}
                  style={[styles.chip, category === c && styles.chipOn]}
                >
                  <Text style={[styles.chipText, category === c && styles.chipTextOn]}>
                    {CATEGORY_LABELS[c]}
                  </Text>
                  <Text style={styles.chipRate}>{DEFAULT_COMMISSION_BP[c] / 100}%</Text>
                </Pressable>
              ))}
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
  wrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)' },
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
  label: { color: colors.faint, fontSize: 10, marginTop: 14, marginBottom: 6 },
  input: {
    minHeight: TAP,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.ink,
    color: colors.chalk,
    paddingHorizontal: 14,
    fontSize: 15,
  },
  priceField: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.ink,
    paddingHorizontal: 14,
  },
  peso: { color: colors.chalk, fontSize: 20, fontWeight: '800', marginRight: 8 },
  priceInput: {
    flex: 1,
    color: colors.chalk,
    fontSize: 22,
    fontWeight: '700',
    paddingVertical: 12,
  },
  chips: { flexDirection: 'row', gap: 8 },
  chip: {
    flex: 1,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
    paddingHorizontal: 8,
  },
  chipOn: { borderColor: colors.red, backgroundColor: 'rgba(225,20,20,0.12)' },
  chipText: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  chipTextOn: { color: colors.chalk },
  chipRate: { color: colors.faint, fontSize: 10, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 18 },
})
