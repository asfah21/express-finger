import { describe, expect, it } from 'vitest'
import { deleteTemplate } from '../../app/utils/zklib-templates.js'

describe('template sync safety policy', () => {
    it('rejects delete unless explicitly enabled', async () => {
        await expect(deleteTemplate({}, { uid: 1, templateIndex: 0, templateType: 'fingerprint' })).rejects.toMatchObject({ code: 'DELETE_NOT_ALLOWED' })
    })
})
