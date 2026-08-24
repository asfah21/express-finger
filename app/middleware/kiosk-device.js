import { config } from '../config/index.js'
import { requireAuth } from './auth.js'
import { getKioskDevice } from '../utils/kiosk-device.js'

/**
 * Gate for kiosk attendance endpoints (role 'public').
 *
 * - Requires a valid JWT session (public or superadmin account).
 * - For role 'public': the request MUST carry an approved kiosk device id that
 *   is bound to that account. pending / revoked / unregistered / bound-elsewhere
 *   devices are rejected with a machine-readable `code` so the kiosk can branch.
 * - For role 'superadmin': allowed through (for testing / troubleshooting)
 *   even without a device, per the approved design.
 */
export const requireKioskDevice = async (req, res, next) => {
  await requireAuth(req, res, async () => {
    const role = req.user?.role

    // Superadmin bypasses the device gate (approved design).
    if (role === 'superadmin') return next()

    if (role !== 'public') {
      return res.status(403).json({
        status: 'error',
        code: 'FORBIDDEN_ROLE',
        message: 'Live attendance is available only to public and superadmin accounts',
      })
    }

    const deviceId = (req.headers?.[config.KIOSK_DEVICE_HEADER] || '').toString().trim()
    if (!deviceId) {
      return res.status(400).json({ status: 'error', code: 'DEVICE_REQUIRED', message: 'Kiosk device is not identified' })
    }

    const device = await getKioskDevice(deviceId)
    if (!device) {
      return res.status(403).json({ status: 'error', code: 'DEVICE_UNREGISTERED', message: 'Kiosk device is not registered' })
    }
    if (device.status === 'pending') {
      return res.status(403).json({ status: 'error', code: 'DEVICE_PENDING', message: 'Kiosk device is pending approval by an administrator' })
    }
    if (device.status === 'revoked') {
      return res.status(403).json({ status: 'error', code: 'DEVICE_REVOKED', message: 'Kiosk device access has been revoked' })
    }
    if (device.user_id !== req.user.id) {
      return res.status(403).json({ status: 'error', code: 'DEVICE_BOUND_OTHER', message: 'This kiosk device is bound to another account' })
    }

    // Attach the resolved device so handlers / logging can use it.
    req.kioskDevice = device
    next()
  })
}
