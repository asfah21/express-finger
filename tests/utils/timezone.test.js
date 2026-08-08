import { describe, expect, test } from 'vitest'
import { getBusinessDateBounds, getBusinessDateString, formatBusinessTimestamp } from '../../app/utils/timezone.js'

describe('business timezone', () => {
    test('keeps a machine-local attendance time at the same WITA clock time', () => {
        expect(formatBusinessTimestamp('2026-08-08T07:56:20+08:00')).toMatch(/07.*56.*20/)
    })

    test('creates WITA day bounds with an explicit offset', () => {
        const { from, to } = getBusinessDateBounds('2026-08-08')
        expect(from.toISOString()).toBe('2026-08-07T16:00:00.000Z')
        expect(to.toISOString()).toBe('2026-08-08T15:59:59.999Z')
    })

    test('derives the business date independently from the host timezone', () => {
        expect(getBusinessDateString(new Date('2026-08-07T16:00:00.000Z'))).toBe('2026-08-08')
    })
})
