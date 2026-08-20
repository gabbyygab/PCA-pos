import { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  expenseErrorMessage,
  useAddExpense,
  useExpenseNameSuggestions,
  useTodayExpenses,
  type ExpenseRow,
} from '@/lib/queries/expenses'
import { boardHead, boardLabel, colors, radius, space, TAP } from '@/theme'
import { formatPeso, pesosToCentavos } from '@shared/lib/currency'

/**
 * The day's operating costs, recorded where the money is actually spent.
 *
 * The cashier is the one at the counter when the soap is bought and the water
 * delivery is paid, so they are who can record it while the receipt is still in
 * hand. What they get back is today only — RLS gives them the Manila day in
 * progress and nothing behind it, so this screen is a working sheet rather than
 * a ledger, and it exists mostly so soap does not get entered twice.
 *
 * There is no edit and no delete. A cashier who mistypes tells the owner, who
 * fixes it on the dashboard; that leaves the correction visible instead of
 * letting the device that typed a row quietly rewrite it.
 */
export function ExpensesScreen() {
  const insets = useSafeAreaInsets()
  const { data, isLoading, isRefetching, refetch, error } = useTodayExpenses()
  const [adding, setAdding] = useState(false)

  const rows = data ?? []
  const total = useMemo(
    () => rows.reduce((sum, row) => sum + row.amount_centavos, 0),
    [rows]
  )

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + space(2) }]}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Expenses</Text>
          <View style={styles.totalBox}>
            <Text style={styles.totalLabel}>Today</Text>
            <Text style={styles.totalValue}>{formatPeso(total)}</Text>
          </View>
        </View>
        <Text style={styles.subtitle}>
          {rows.length === 0
            ? 'Nothing recorded yet today'
            : `${rows.length} ${rows.length === 1 ? 'entry' : 'entries'} today`}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={colors.red}
            colors={[colors.red]}
          />
        }
      >
        {isLoading ? (
          <ActivityIndicator color={colors.red} style={{ marginTop: space(8) }} />
        ) : error ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>{expenseErrorMessage(error)}</Text>
            <Pressable onPress={() => refetch()} style={styles.retry}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : rows.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              Costs recorded today show here. Yesterday and earlier are the owner&apos;s to
              see.
            </Text>
          </View>
        ) : (
          rows.map((row) => <ExpenseCard key={row.id} row={row} />)
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, space(2)) }]}>
        <Pressable
          onPress={() => setAdding(true)}
          style={({ pressed }) => [styles.addButton, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.addButtonText}>Add expense</Text>
        </Pressable>
      </View>

      <AddExpenseSheet visible={adding} onClose={() => setAdding(false)} />
    </View>
  )
}

function ExpenseCard({ row }: { row: ExpenseRow }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardMain}>
        <Text style={styles.cardName} numberOfLines={1}>
          {row.name}
        </Text>
        {row.description ? (
          <Text style={styles.cardDesc} numberOfLines={2}>
            {row.description}
          </Text>
        ) : null}
      </View>
      <Text style={styles.cardAmount}>{formatPeso(row.amount_centavos)}</Text>
    </View>
  )
}

/**
 * The add sheet.
 *
 * A bottom sheet rather than a dialog, for the same reason the cart is one: a
 * phone has no room for a centred modal that also leaves the keyboard usable,
 * and a thumb reaches the bottom of the screen.
 */
function AddExpenseSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets()
  const add = useAddExpense()
  const suggestions = useExpenseNameSuggestions()

  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [failure, setFailure] = useState<string | null>(null)

  // Parsed once and reused, so the button's enabled state and what is submitted
  // can never disagree about what the typed text means.
  const centavos = useMemo(() => {
    const parsed = Number.parseFloat(amount.replace(/[^0-9.]/g, ''))
    if (!Number.isFinite(parsed) || parsed <= 0) return 0
    return pesosToCentavos(parsed)
  }, [amount])

  const ready = name.trim().length > 0 && centavos > 0 && !add.isPending

  function reset() {
    setName('')
    setAmount('')
    setDescription('')
    setFailure(null)
  }

  function close() {
    reset()
    onClose()
  }

  async function submit() {
    if (!ready) return
    setFailure(null)
    try {
      await add.mutateAsync({
        name,
        description: description || null,
        amountCentavos: centavos,
      })
      close()
    } catch (err) {
      setFailure(expenseErrorMessage(err))
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <View style={styles.sheetBackdrop}>
        <Pressable style={styles.backdropFill} onPress={close} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.sheetWrap}
        >
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, space(3)) }]}>
            <View style={styles.grabber} />
            <Text style={styles.sheetTitle}>Add expense</Text>

            <Text style={styles.fieldLabel}>Name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Soap, water, electricity…"
              placeholderTextColor={colors.faint}
              style={styles.input}
              autoCapitalize="sentences"
            />

            {suggestions.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipRow}
                keyboardShouldPersistTaps="handled"
              >
                {suggestions.map((s) => (
                  <Pressable
                    key={s}
                    onPress={() => setName(s)}
                    style={({ pressed }) => [styles.chip, pressed && { opacity: 0.7 }]}
                  >
                    <Text style={styles.chipText}>{s}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}

            <Text style={styles.fieldLabel}>Amount</Text>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              placeholder="0.00"
              placeholderTextColor={colors.faint}
              // decimal-pad, not numeric: the shop types 12.50 and numeric puts
              // a comma on some Android keyboards, which parseFloat drops.
              keyboardType="decimal-pad"
              style={[styles.input, styles.amountInput]}
            />

            <Text style={styles.fieldLabel}>Description (optional)</Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="Which supplier, which repair…"
              placeholderTextColor={colors.faint}
              style={styles.input}
              autoCapitalize="sentences"
            />

            {failure ? <Text style={styles.error}>{failure}</Text> : null}

            <View style={styles.sheetActions}>
              <Pressable
                onPress={close}
                style={({ pressed }) => [styles.cancel, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={submit}
                disabled={!ready}
                style={({ pressed }) => [
                  styles.save,
                  !ready && styles.saveOff,
                  pressed && ready && { opacity: 0.85 },
                ]}
              >
                {add.isPending ? (
                  <ActivityIndicator color={colors.chalk} />
                ) : (
                  <Text style={styles.saveText}>Save</Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ink },

  header: {
    paddingHorizontal: space(4),
    paddingBottom: space(3),
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    backgroundColor: colors.surface,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...boardHead, fontSize: 24 },
  subtitle: { color: colors.muted, fontSize: 13, marginTop: space(1) },
  totalBox: { alignItems: 'flex-end' },
  totalLabel: { ...boardLabel, color: colors.muted, fontSize: 10 },
  totalValue: { color: colors.red, fontSize: 20, fontWeight: '800' },

  list: { padding: space(3), paddingBottom: space(6), gap: space(2) },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: space(3),
  },
  cardMain: { flex: 1, gap: 2 },
  cardName: { color: colors.chalk, fontSize: 16, fontWeight: '600' },
  cardDesc: { color: colors.muted, fontSize: 13 },
  cardAmount: { color: colors.chalk, fontSize: 17, fontWeight: '800' },

  empty: { padding: space(6), alignItems: 'center', gap: space(3) },
  emptyText: { color: colors.muted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  retry: {
    minHeight: TAP,
    paddingHorizontal: space(5),
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.lineStrong,
  },
  retryText: { ...boardLabel, color: colors.chalk, fontSize: 12 },

  footer: {
    paddingHorizontal: space(3),
    paddingTop: space(2),
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.surface,
  },
  addButton: {
    minHeight: TAP,
    borderRadius: radius.lg,
    backgroundColor: colors.red,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonText: { ...boardLabel, color: colors.chalk, fontSize: 14 },

  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  backdropFill: { ...StyleSheet.absoluteFillObject },
  sheetWrap: { width: '100%' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: 1,
    borderColor: colors.lineStrong,
    paddingHorizontal: space(4),
    paddingTop: space(2),
    gap: space(2),
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.lineStrong,
    marginBottom: space(2),
  },
  sheetTitle: { ...boardHead, fontSize: 20, marginBottom: space(1) },

  fieldLabel: { ...boardLabel, color: colors.muted, fontSize: 10, marginTop: space(1) },
  input: {
    minHeight: TAP,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: space(3),
    color: colors.chalk,
    fontSize: 16,
  },
  amountInput: { fontSize: 20, fontWeight: '700' },

  chipRow: { gap: space(2), paddingVertical: space(1) },
  chip: {
    paddingHorizontal: space(3),
    paddingVertical: space(2),
    borderRadius: radius.sm,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.lineStrong,
  },
  chipText: { color: colors.chalk, fontSize: 13 },

  error: { color: colors.redHot, fontSize: 13, marginTop: space(1) },

  sheetActions: { flexDirection: 'row', gap: space(2), marginTop: space(3) },
  cancel: {
    flex: 1,
    minHeight: TAP,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.lineStrong,
  },
  cancelText: { ...boardLabel, color: colors.muted, fontSize: 13 },
  save: {
    flex: 2,
    minHeight: TAP,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    backgroundColor: colors.red,
  },
  saveOff: { backgroundColor: colors.surface2 },
  saveText: { ...boardLabel, color: colors.chalk, fontSize: 14 },
})
