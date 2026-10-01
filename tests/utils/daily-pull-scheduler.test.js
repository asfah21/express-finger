import { dailyPullState, getTodayWITA } from '../../app/utils/scheduler.js'

describe('daily pull scheduler (hardcoded)', () => {
    it('formats today in WITA timezone as YYYY-MM-DD', () => {
        const todayStr = getTodayWITA()
        expect(todayStr).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    it('tracks pending devices in dailyPullState set', () => {
        dailyPullState.pendingDevices.clear()
        dailyPullState.pendingDevices.add(101)
        dailyPullState.pendingDevices.add(102)

        expect(dailyPullState.pendingDevices.has(101)).toBe(true)
        expect(dailyPullState.pendingDevices.size).toBe(2)

        dailyPullState.pendingDevices.delete(101)
        expect(dailyPullState.pendingDevices.has(101)).toBe(false)
        expect(dailyPullState.pendingDevices.size).toBe(1)
        dailyPullState.pendingDevices.clear()
    })
})

