import { useMemo, useState } from 'react'
import {
  FlatList,
  Keyboard,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CartSheet } from '@/components/CartSheet'
import { ConfirmModal } from '@/components/ConfirmModal'
import { useKeyboard } from '@/lib/keyboard/useKeyboard'
import { CrewSheet } from '@/components/CrewSheet'
import { OpenPriceSheet } from '@/components/OpenPriceSheet'
import {
  CustomServiceSheet,
  type CustomServiceDraft,
} from '@/components/CustomServiceSheet'
import { ServiceCard } from '@/components/ServiceCard'
import { ServiceGridSkeleton } from '@/components/Skeleton'
import { useCatalog, useVehicleSizes, type CatalogService } from '@/lib/queries/catalog'
import { useEmployees } from '@/lib/queries/employees'
import { useCreateSale } from '@/lib/queries/sales'
import { useSession } from '@/lib/auth/session'
import { formatPeso } from '@shared/lib/currency'
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  DEFAULT_COMMISSION_BP,
  sizesForClass,
  VEHICLE_CLASS_LABELS,
  VEHICLE_CLASSES,
  type PaymentMethod,
  type ServiceCategory,
  type VehicleClass,
  type VehicleSizeRow,
} from '@shared/lib/domain'
import {
  cartTotal,
  isAvailableAtSize,
  isCustomLine,
  newCustomLineId,
  resolvePrice,
  type CartLine,
} from '@shared/lib/pricing'
import { colors, boardHead, boardLabel, radius, TAP } from '@/theme'

/**
 * Ring up a sale. The same flow as the dashboard's PosTab — class, size,
 * services, crew, confirm — but stacked for one thumb instead of laid out in
 * two panes: the grid owns the screen and the cart is a sheet over it, because
 * a phone has no room for a permanent sidebar.
 *
 * All pricing and commission math comes from shared/, so the totals here are
 * the same numbers the dashboard and `create_sale` produce.
 */
export function PosScreen() {
  const [vehicleClass, setVehicleClass] = useState<VehicleClass>('car')
  const [sizeId, setSizeId] = useState<string | null>(null)
  const [lines, setLines] = useState<CartLine[]>([])
  const [employeeIds, setEmployeeIds] = useState<string[]>([])
  const [payment, setPayment] = useState<PaymentMethod>('cash')
  const [plate, setPlate] = useState('')
  const [openPriceFor, setOpenPriceFor] = useState<CatalogService | null>(null)
  const [customOpen, setCustomOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<ServiceCategory | 'all'>('all')
  const [cartOpen, setCartOpen] = useState(false)
  const [crewOpen, setCrewOpen] = useState(false)
  const [flash, setFlash] = useState<{ text: string; bad?: boolean } | null>(null)
  const [confirmingSignOut, setConfirmingSignOut] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  const insets = useSafeAreaInsets()
  const keyboard = useKeyboard()
  const { email, signOut } = useSession()

  const { data: catalog, isLoading, isError, refetch, isRefetching } = useCatalog()
  const sizesQuery = useVehicleSizes()
  const employeesQuery = useEmployees()
  const { data: allSizes } = sizesQuery
  const { data: employees } = employeesQuery
  const createSale = useCreateSale()

  /**
   * A pull refreshes everything this screen is built from, not just the
   * catalog. Sizes and the roster are separately cached — the roster for five
   * minutes — so a cashier pulling down right after the owner adds an employee
   * or a size on the dashboard would otherwise watch the spinner run and see
   * nothing change. Fetching a new hire is the most likely reason to pull here
   * at all.
   */
  const refreshing = isRefetching || sizesQuery.isRefetching || employeesQuery.isRefetching

  async function refreshAll() {
    await Promise.all([refetch(), sizesQuery.refetch(), employeesQuery.refetch()])
  }

  // Hidden sizes are off the POS entirely; Settings is where they come back.
  const sizes = useMemo(
    () => sizesForClass(allSizes ?? [], vehicleClass).filter((s) => s.is_active),
    [allSizes, vehicleClass]
  )

  const size = useMemo(
    () => sizes.find((s) => s.id === sizeId) ?? sizes[0] ?? null,
    [sizes, sizeId]
  )

  const services = useMemo(
    () => (catalog ?? []).filter((s) => s.is_active && s.vehicle_class === vehicleClass),
    [catalog, vehicleClass]
  )

  /**
   * What the grid shows. Kept separate from `services` because the cart
   * re-prices against the full catalog — a line must not be dropped just
   * because the cashier typed a filter that hides its tile.
   */
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return services.filter((service) => {
      if (category !== 'all' && service.category !== category) return false
      if (!needle) return true
      // Inclusions are searchable too: "engine wash" surfaces the packages
      // that bundle it, not just a service literally named that.
      return (
        service.name.toLowerCase().includes(needle) ||
        service.inclusions.some((inc) => inc.toLowerCase().includes(needle))
      )
    })
  }, [services, query, category])

  const crewNames = useMemo(
    () =>
      employeeIds
        .map((id) => employees?.find((e) => e.id === id)?.name)
        .filter((n): n is string => Boolean(n)),
    [employeeIds, employees]
  )

  const total = cartTotal(lines)
  const count = lines.reduce((n, l) => n + l.quantity, 0)

  function note(text: string, bad = false) {
    setFlash({ text, bad })
    setTimeout(() => setFlash(null), 2600)
  }

  function switchClass(next: VehicleClass) {
    if (next === vehicleClass) return
    setVehicleClass(next)
    // The two classes have different size scales, so the cart cannot carry
    // over; the new class falls back to the first size on its own scale.
    setSizeId(null)
    setLines([])
  }

  function switchSize(next: VehicleSizeRow) {
    if (next.id === size?.id) return
    setSizeId(next.id)
    // Prices are per size; re-price what is still offered and drop the rest.
    setLines((prev) =>
      prev.flatMap((line) => {
        // A custom line has no catalogue price to re-resolve; it keeps the
        // amount the cashier agreed regardless of the size selected.
        if (isCustomLine(line)) return [line]
        const service = services.find((s) => s.id === line.serviceId)
        if (!service) return []
        if (service.is_open_price) return [line]
        const price = resolvePrice(service, next.id)
        if (price === null) return []
        return [{ ...line, unitPriceCentavos: price }]
      })
    )
  }

  function addService(service: CatalogService) {
    if (service.is_open_price) {
      setOpenPriceFor(service)
      return
    }
    if (!size) return
    const price = resolvePrice(service, size.id)
    if (price === null) return

    setLines((prev) => {
      const existing = prev.find((l) => l.serviceId === service.id)
      if (existing) {
        return prev.map((l) =>
          l.serviceId === service.id ? { ...l, quantity: l.quantity + 1 } : l
        )
      }
      return [
        ...prev,
        {
          serviceId: service.id,
          serviceName: service.name,
          category: service.category,
          quantity: 1,
          unitPriceCentavos: price,
          commissionRateBp: service.commission_rate_bp,
        },
      ]
    })
  }

  function confirmOpenPrice(centavos: number) {
    const service = openPriceFor
    if (!service) return
    setLines((prev) => [
      ...prev,
      {
        serviceId: service.id,
        serviceName: service.name,
        category: service.category,
        quantity: 1,
        unitPriceCentavos: centavos,
        commissionRateBp: service.commission_rate_bp,
      },
    ])
    setOpenPriceFor(null)
  }

  function confirmCustom(draft: CustomServiceDraft) {
    setLines((prev) => [
      ...prev,
      {
        // A fresh key every time: two custom lines on one ticket are two
        // different jobs and must not merge the way a repeated tile does.
        serviceId: newCustomLineId(),
        serviceName: draft.name,
        description: draft.description || undefined,
        category: draft.category,
        quantity: 1,
        unitPriceCentavos: draft.centavos,
        commissionRateBp: DEFAULT_COMMISSION_BP[draft.category],
      },
    ])
    setCustomOpen(false)
    setCartOpen(true)
    note(`Added ${draft.name}`)
  }

  function reset() {
    setLines([])
    setPlate('')
    setPayment('cash')
    // The crew is deliberately kept: the same two or three people work several
    // cars in a row, so re-picking them after every sale would be busywork.
  }

  async function submit() {
    if (employeeIds.length === 0 || lines.length === 0 || !size) return
    try {
      await createSale.mutateAsync({
        employeeIds,
        vehicleClass,
        // The label, not the id: a sale snapshots what it printed.
        size: size.label,
        lines,
        paymentMethod: payment,
        plateNumber: plate,
      })
      setCartOpen(false)
      reset()
      note(crewNames.length ? `Sale saved · ${crewNames.join(', ')}` : 'Sale saved')
    } catch (error) {
      note(error instanceof Error ? error.message : 'Could not save the sale', true)
    }
  }

  async function confirmSignOut() {
    setSigningOut(true)
    try {
      await signOut()
    } catch (error) {
      note(error instanceof Error ? error.message : 'Could not sign out', true)
    } finally {
      // On success the session listener swaps this screen out, so this only
      // matters when sign-out failed and the modal is still standing.
      setSigningOut(false)
      setConfirmingSignOut(false)
    }
  }

  return (
    <View style={[styles.flex, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.headRow}>
          <View>
            <Text style={[boardHead, styles.title]}>Ring Up</Text>
            <Text style={styles.who} numberOfLines={1}>
              {email ?? ''}
            </Text>
          </View>
          <Pressable
            onPress={() => setConfirmingSignOut(true)}
            hitSlop={10}
            style={styles.signOut}
            accessibilityRole="button"
          >
            <Text style={styles.signOutText}>Sign out</Text>
          </Pressable>
        </View>

        <View style={styles.classRow}>
          {VEHICLE_CLASSES.map((id) => (
            <Pressable
              key={id}
              onPress={() => switchClass(id)}
              style={[styles.classBtn, vehicleClass === id && styles.classBtnOn]}
            >
              <Text
                style={[styles.classText, vehicleClass === id && styles.classTextOn]}
              >
                {VEHICLE_CLASS_LABELS[id]}
              </Text>
            </Pressable>
          ))}
        </View>

        {sizes.length === 0 ? (
          <Text style={styles.notice}>
            No {VEHICLE_CLASS_LABELS[vehicleClass].toLowerCase()} sizes yet — add them
            on the dashboard under Settings › Sizes.
          </Text>
        ) : (
          <FlatList
            horizontal
            data={sizes}
            keyExtractor={(s) => s.id}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.sizeRow}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => switchSize(item)}
                style={[styles.sizeBtn, size?.id === item.id && styles.sizeBtnOn]}
              >
                <Text
                  style={[boardLabel, styles.sizeText, size?.id === item.id && styles.sizeTextOn]}
                >
                  {item.label}
                </Text>
                {item.description ? (
                  <Text style={styles.sizeDesc} numberOfLines={1}>
                    {item.description}
                  </Text>
                ) : null}
              </Pressable>
            )}
          />
        )}

        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search services…"
          placeholderTextColor={colors.faint}
          style={styles.search}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          clearButtonMode="while-editing"
          // The grid below is the result; closing the keyboard on submit hands
          // the whole screen back for tapping tiles.
          onSubmitEditing={Keyboard.dismiss}
        />

        <FlatList
          horizontal
          data={['all', ...CATEGORY_ORDER] as const}
          keyExtractor={(c) => c}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.catRow}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => setCategory(item)}
              style={[styles.cat, category === item && styles.catOn]}
            >
              <Text style={[styles.catText, category === item && styles.catTextOn]}>
                {item === 'all' ? 'All' : CATEGORY_LABELS[item]}
              </Text>
            </Pressable>
          )}
          /*
            Work that is not on the board and is not worth adding to it. It
            rides the filter row rather than the grid because it is not a
            service the shop offers — it is an escape hatch, and a tile among
            the real ones would be mistaken for one.
          */
          ListFooterComponent={
            <Pressable
              onPress={() => setCustomOpen(true)}
              style={styles.customCat}
              accessibilityRole="button"
              accessibilityLabel="Add a custom service"
            >
              <Text style={styles.customCatText}>+ Custom</Text>
            </Pressable>
          }
        />
      </View>

      {isLoading ? (
        // A skeleton of the real grid rather than a spinner: the tiles land in
        // the same places they are already drawn, so the board does not jump
        // and the cashier's thumb is already over the right half of the screen.
        <ServiceGridSkeleton />
      ) : isError ? (
        // A scroller, not a bare View: the error state is exactly where a
        // cashier's instinct is to pull down, and a plain View has nothing to
        // drag. Try again stays for the tap-minded, but the gesture now works
        // here too.
        <ScrollView
          contentContainerStyle={styles.center}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refreshAll}
              tintColor={colors.red}
              colors={[colors.red]}
              progressBackgroundColor={colors.surface}
            />
          }
        >
          <Text style={styles.dim}>Could not reach the shop database.</Text>
          <Text style={styles.dimSmall}>Pull down to retry.</Text>
          <Pressable onPress={() => refetch()} style={styles.retry}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </ScrollView>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(s) => s.id}
          numColumns={2}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={[
            styles.grid,
            visible.length === 0 && styles.gridEmpty,
            // Clears the sticky cart bar so the last row is never trapped
            // under it — and the keyboard too, since the bar rides above it
            // while the service search is focused.
            { paddingBottom: insets.bottom + keyboard.height + 108 },
          ]}
          // A themed control rather than the bare `onRefresh`/`refreshing`
          // props: those draw the platform default spinner, which lands as a
          // grey-on-black smudge against the board palette.
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refreshAll}
              tintColor={colors.red}
              colors={[colors.red]}
              progressBackgroundColor={colors.surface}
            />
          }
          // Reaching for a tile with the search keyboard up should put it away
          // rather than needing a separate tap outside the field first.
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          // An empty grid still bounces on iOS, so the gesture exists before
          // there is anything to scroll.
          alwaysBounceVertical
          // `flexGrow` so the empty state fills the screen — a content view
          // shorter than its scroller has no room to be dragged, which is
          // exactly when the catalog is empty and a pull is most wanted.
          ListEmptyComponent={<Text style={[styles.dim, styles.emptyPull]}>Nothing matches that.</Text>}
          renderItem={({ item }) => (
            <ServiceCard
              service={item}
              sizeId={size?.id ?? null}
              available={size ? isAvailableAtSize(item, size.id) : false}
              inCart={lines.some((l) => l.serviceId === item.id)}
              onPress={() => addService(item)}
            />
          )}
        />
      )}

      {flash ? (
        <View
          style={[
            styles.flash,
            { bottom: insets.bottom + keyboard.height + 96 },
            flash.bad && styles.flashBad,
          ]}
        >
          <Text style={styles.flashText}>{flash.text}</Text>
        </View>
      ) : null}

      {/*
        The bar is pinned to the bottom of the window, and an Android activity
        under edge-to-edge is not resized by the keyboard — so without lifting
        it by hand the running total and Review sit behind the keys the moment
        the cashier searches for a service. The safe-area padding goes with it:
        once lifted, the bar is no longer over the gesture bar.
      */}
      <View
        style={[
          styles.bar,
          {
            bottom: keyboard.height,
            paddingBottom: keyboard.visible ? 10 : insets.bottom + 10,
          },
        ]}
      >
        <View style={styles.barInfo}>
          <Text style={styles.barCount}>
            {count} item{count === 1 ? '' : 's'}
          </Text>
          <Text style={styles.barTotal}>{formatPeso(total)}</Text>
        </View>
        <Pressable
          onPress={() => setCartOpen(true)}
          disabled={lines.length === 0}
          style={[styles.barBtn, lines.length === 0 && styles.barBtnOff]}
        >
          <Text style={styles.barBtnText}>Review</Text>
        </Pressable>
      </View>

      <CartSheet
        visible={cartOpen}
        lines={lines}
        sizeLabel={size?.label ?? null}
        crewNames={crewNames}
        crewSize={employeeIds.length}
        payment={payment}
        plate={plate}
        saving={createSale.isPending}
        onClose={() => setCartOpen(false)}
        onPaymentChange={setPayment}
        onPlateChange={setPlate}
        onQuantityChange={(serviceId, quantity) =>
          setLines((prev) =>
            quantity <= 0
              ? prev.filter((l) => l.serviceId !== serviceId)
              : prev.map((l) => (l.serviceId === serviceId ? { ...l, quantity } : l))
          )
        }
        onRemove={(serviceId) =>
          setLines((prev) => prev.filter((l) => l.serviceId !== serviceId))
        }
        onPickCrew={() => setCrewOpen(true)}
        onSubmit={submit}
      />

      <CrewSheet
        visible={crewOpen}
        employees={employees ?? []}
        selected={employeeIds}
        onChange={setEmployeeIds}
        onClose={() => setCrewOpen(false)}
      />

      <CustomServiceSheet
        visible={customOpen}
        onCancel={() => setCustomOpen(false)}
        onConfirm={confirmCustom}
      />

      <OpenPriceSheet
        serviceName={openPriceFor?.name ?? null}
        onCancel={() => setOpenPriceFor(null)}
        onConfirm={confirmOpenPrice}
      />

      <ConfirmModal
        visible={confirmingSignOut}
        title="Sign out?"
        message={
          lines.length > 0
            ? 'This car has items in the cart that have not been saved. Signing out clears them.'
            : 'You will need the shop email and password to sign back in.'
        }
        confirmLabel="Sign out"
        cancelLabel="Stay signed in"
        busy={signingOut}
        onConfirm={confirmSignOut}
        onCancel={() => setConfirmingSignOut(false)}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.ink },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 6,
  },
  title: { fontSize: 22 },
  who: { color: colors.faint, fontSize: 11, marginTop: 2 },
  signOut: { paddingVertical: 8, paddingHorizontal: 4 },
  signOutText: { color: colors.faint, fontSize: 13, fontWeight: '600' },
  classRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  classBtn: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  classBtnOn: { backgroundColor: colors.red, borderColor: colors.red },
  classText: { color: colors.muted, fontSize: 14, fontWeight: '700' },
  classTextOn: { color: '#fff' },
  sizeRow: { gap: 8, paddingVertical: 10 },
  sizeBtn: {
    minWidth: 68,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  sizeBtnOn: { borderColor: colors.red, backgroundColor: 'rgba(225,20,20,0.12)' },
  sizeText: { color: colors.muted, fontSize: 12 },
  sizeTextOn: { color: colors.chalk },
  sizeDesc: { color: colors.faint, fontSize: 9, marginTop: 2 },
  notice: { color: colors.faint, fontSize: 12, paddingVertical: 12 },
  search: {
    minHeight: TAP,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    color: colors.chalk,
    paddingHorizontal: 14,
    fontSize: 15,
  },
  catRow: { gap: 8, paddingTop: 10 },
  cat: {
    minHeight: 38,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  catOn: { borderColor: colors.red, backgroundColor: 'rgba(225,20,20,0.12)' },
  customCat: {
    minHeight: 38,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
  },
  customCatText: { color: colors.chalk, fontSize: 12, fontWeight: '700' },
  catText: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  catTextOn: { color: colors.chalk },
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  dimSmall: { color: colors.faint, fontSize: 12, textAlign: 'center' },
  gridEmpty: { flexGrow: 1 },
  emptyPull: { paddingTop: 40 },
  dim: { color: colors.faint, fontSize: 13, textAlign: 'center', padding: 20 },
  retry: {
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radius.md,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  retryText: { color: colors.chalk, fontSize: 14, fontWeight: '700' },
  grid: { padding: 16 },
  gridRow: { gap: 10, marginBottom: 10 },
  flash: {
    position: 'absolute',
    left: 16,
    right: 16,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.good,
    borderRadius: radius.md,
    padding: 12,
  },
  flashBad: { borderColor: colors.red },
  flashText: { color: colors.chalk, fontSize: 13, fontWeight: '600' },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderColor: colors.lineStrong,
  },
  barInfo: { flex: 1 },
  barCount: { color: colors.faint, fontSize: 11, fontWeight: '600' },
  barTotal: { color: colors.chalk, fontSize: 22, fontWeight: '800' },
  barBtn: {
    minHeight: TAP,
    minWidth: 130,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.red,
    paddingHorizontal: 20,
  },
  barBtnOff: { opacity: 0.4 },
  barBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
})
