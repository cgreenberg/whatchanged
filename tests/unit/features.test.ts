import { SHOW_LOCAL_PULSE } from '@/lib/features'

test('Local Pulse is tabled behind the flag (LocalPulse is still unit-tested by direct render)', () => {
  expect(SHOW_LOCAL_PULSE).toBe(false)
})
