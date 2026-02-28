import ZKLib from 'node-zklib'
import { writeFile } from 'fs/promises'

const ip = '10.242.15.136'
const port = 4370

const zk = new ZKLib(ip, port, 10000, 5200)

try {
    await zk.createSocket()
    const logs = await zk.getAttendances()
    const data = logs?.data || []

    // Simpan hasil ke file agar bisa dibaca lengkap
    const sample = data.slice(0, 10)
    const fields = data.length > 0 ? Object.keys(data[0]) : []

    // Hitung distribusi per field (cari yang kira-kira status)
    const result = {
        totalLogs: data.length,
        availableFields: fields,
        sample10: sample,
        // Hitung nilai unik untuk tiap field
        distributions: {}
    }

    for (const field of fields) {
        const counts = {}
        data.forEach(log => {
            const val = String(log[field] ?? 'null')
            counts[val] = (counts[val] || 0) + 1
        })
        // Hanya tampilkan field dengan <= 20 nilai unik (kandidat tipe/status)  
        if (Object.keys(counts).length <= 20) {
            result.distributions[field] = counts
        }
    }

    await writeFile('./zklib-debug-output.json', JSON.stringify(result, null, 2))
    console.log(`✅ Done! Total: ${data.length} logs. Output saved to zklib-debug-output.json`)

    await zk.disconnect()
} catch (err) {
    console.error('Error:', err.message || JSON.stringify(err))
}
process.exit()
