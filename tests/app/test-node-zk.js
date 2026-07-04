import ZKLib from 'node-zklib'

async function test() {
    const zkInstance = new ZKLib('10.242.15.136', 4370, 10000, 4000);
    try {
        await zkInstance.createSocket()
        console.log('Connected');
        const sn = await zkInstance.getSerialNumber()
        console.log('Got SN:', sn)
        const attendances = await zkInstance.getAttendances()
        console.log('Attendances sample:', JSON.stringify(attendances.data[0]));
        await zkInstance.disconnect()
    } catch (e) {
        console.error('Error:', e)
    }
}
test()
