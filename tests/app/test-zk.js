import ZKLib from 'zklib'
import { promisify } from 'util'

async function test() {
    console.log('Testing ZKLib UDP...')
    const zk = new ZKLib({
        ip: '10.242.15.136',
        port: 4370,
        timeout: 5000,
        inport: 5200 + Math.floor(Math.random() * 1000),
        connectionType: 'udp'
    });

    const connect = promisify(zk.connect).bind(zk)
    try {
        await connect();
        console.log('Connected via UDP!')
        const getSerialNumber = promisify(zk.serialNumber).bind(zk)
        const sn = await getSerialNumber();
        console.log('SN:', sn);
        const disconnect = promisify(zk.disconnect).bind(zk)
        await disconnect();
    } catch (e) {
        console.error('Error:', e)
        try { zk.closeSocket(); } catch (err) { }
    }
}
test()
