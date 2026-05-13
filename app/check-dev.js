import ZKLib from 'node-zklib';

async function checkDevice() {
  const ip = '10.242.15.136';
  const port = 4370;

  console.log(`Connecting to ${ip}:${port}...`);
  // node-zklib: ip, port, timeout, inport
  const zk = new ZKLib(ip, port, 20000, 5200);

  try {
    await zk.createSocket();
    
    const info = await zk.getInfo();
    console.log('Device Info:', info);

    const time = await zk.getTime();
    console.log('Device Time:', time);

    const logs = await zk.getAttendances();
    console.log(`Total pulled logs: ${logs.data.length}`);
    if (logs.data.length > 0) {
      console.log('First log:', logs.data[0]);
      console.log('Last log:', logs.data[logs.data.length - 1]);
    }

    await zk.disconnect();
  } catch (err) {
    console.error('Error:', err);
    try { await zk.disconnect(); } catch (e) {}
  }
  
  process.exit(0);
}

checkDevice();
