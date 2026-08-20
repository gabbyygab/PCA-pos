import { useMemo, useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { Button } from '@/components/Button'
import { Sheet } from '@/components/Sheet'
import { colors, boardHead, radius, TAP } from '@/theme'
import type { Employee } from '@/lib/queries/employees'

interface CrewSheetProps {
  visible: boolean
  employees: Employee[]
  selected: string[]
  onChange: (ids: string[]) => void
  onClose: () => void
}

/**
 * Who washed this car — the mobile counterpart of the dashboard's CrewPicker.
 *
 * The dashboard rule is that any list the owner adds to gets a searchable
 * multi-select rather than a fixed dropdown; on a phone that becomes a bottom
 * sheet with a filter box. Rows are full-width and tall because they are
 * tapped with a thumb, wet, beside a running bay.
 *
 * Inactive employees are filtered out rather than shown disabled: someone who
 * no longer works here is noise, not a choice needing explanation.
 *
 * With the filter box focused the sheet rides on top of the keyboard. `Sheet`
 * caps itself against the space the keyboard leaves, so the Done button stays
 * on screen without a second hand-picked percentage here fighting that.
 */
export function CrewSheet({
  visible,
  employees,
  selected,
  onChange,
  onClose,
}: CrewSheetProps) {
  const [query, setQuery] = useState('')

  const active = useMemo(() => employees.filter((e) => e.is_active), [employees])

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return active
    // Matches anywhere in the name, not just the start — the dashboard's
    // Combobox behaves the same way.
    return active.filter((e) => e.name.toLowerCase().includes(needle))
  }, [active, query])

  function toggle(id: string) {
    onChange(
      selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]
    )
  }

  return (
    <Sheet visible={visible} onClose={onClose} maxHeight="82%">
      <Text style={[boardHead, styles.title]}>Crew</Text>
      <Text style={styles.hint}>Commission splits evenly among everyone picked.</Text>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search employees…"
        placeholderTextColor={colors.faint}
        style={styles.search}
        autoCorrect={false}
        autoCapitalize="words"
        returnKeyType="search"
        clearButtonMode="while-editing"
      />

      <FlatList
        data={shown}
        keyExtractor={(item) => item.id}
        // Picking a name while the filter is focused must select on the first
        // tap, not spend it closing the keyboard.
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        style={styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {active.length === 0
              ? 'No active employees. Add them on the dashboard.'
              : 'No employee by that name.'}
          </Text>
        }
        renderItem={({ item }) => {
          const on = selected.includes(item.id)
          return (
            <Pressable
              onPress={() => toggle(item.id)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              style={({ pressed }) => [
                styles.row,
                on && styles.rowOn,
                pressed && styles.rowPressed,
              ]}
            >
              <View style={[styles.check, on && styles.checkOn]}>
                {on ? <Text style={styles.checkMark}>✓</Text> : null}
              </View>
              <Text style={[styles.name, on && styles.nameOn]}>{item.name}</Text>
            </Pressable>
          )
        }}
      />

      <Button
        label={selected.length ? `Done · ${selected.length} picked` : 'Done'}
        onPress={onClose}
      />
    </Sheet>
  )
}

const styles = StyleSheet.create({
  title: { fontSize: 20 },
  hint: { color: colors.muted, fontSize: 12, marginTop: 2, marginBottom: 12 },
  search: {
    // The list shrinks; the field must not. Without an explicit basis Yoga is
    // free to squeeze the field the cashier is typing into once the sheet is
    // capped, which is the one thing that has to stay put and legible.
    flexShrink: 0,
    minHeight: TAP,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.ink,
    color: colors.chalk,
    paddingHorizontal: 14,
    fontSize: 15,
  },
  // `minHeight: 0` is what actually lets this shrink. A scroll container's
  // flex basis is its content, and Yoga will not take a flex item below that
  // basis without it — so `flexShrink` alone left the list at full height and
  // pushed Done off the bottom of the squeezed sheet.
  list: { flexShrink: 1, minHeight: 0, marginTop: 10, marginBottom: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: TAP + 4,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.ink,
    marginBottom: 8,
  },
  rowOn: { borderColor: colors.red, backgroundColor: 'rgba(225,20,20,0.12)' },
  rowPressed: { backgroundColor: colors.surface2 },
  check: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  checkOn: { backgroundColor: colors.red, borderColor: colors.red },
  checkMark: { color: '#fff', fontSize: 13, fontWeight: '800' },
  name: { color: colors.muted, fontSize: 15, fontWeight: '600', flex: 1 },
  nameOn: { color: colors.chalk },
  empty: { color: colors.faint, fontSize: 13, textAlign: 'center', paddingVertical: 24 },
})
