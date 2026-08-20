import { AuthGate } from '@/components/auth/AuthGate'
import { Shell } from '@/components/Shell'

export default function Home() {
  return (
    <AuthGate>
      <Shell />
    </AuthGate>
  )
}
