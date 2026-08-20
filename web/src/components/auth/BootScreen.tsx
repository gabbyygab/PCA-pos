'use client'

import Image from 'next/image'
import { SlashRule } from '@/components/ui/Panel'

/**
 * What fills the Tauri window between the webview painting and the session
 * resolving.
 *
 * This is not a slow step — local storage is synchronous — but it is the first
 * thing the owner sees each morning, and a bare "Loading…" on a black field
 * looks like the app failed to start. The mark and the board's slash rule make
 * the same beat read as PCA coming up.
 *
 * The bar is a CSS keyframe rather than a spinner: the webview composites a
 * transform without touching layout, so it stays smooth while the session and
 * the first queries are being hydrated on the main thread.
 */
export function BootScreen({ label = 'Starting up' }: { label?: string }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className="flex h-full flex-col items-center justify-center gap-5"
    >
      <div className="flex size-16 items-center justify-center overflow-hidden rounded-xl bg-white">
        <Image
          src="/logo.png.png"
          alt=""
          width={64}
          height={64}
          priority
          className="size-full object-contain"
        />
      </div>

      <SlashRule />

      <p className="board-label text-[11px] text-faint">{label}</p>

      <div className="h-[3px] w-36 overflow-hidden rounded-full bg-surface-2">
        <div className="boot-bar h-full w-1/3 rounded-full bg-red" />
      </div>
    </div>
  )
}
