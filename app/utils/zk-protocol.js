import ZKLib from 'node-zklib'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { COMMANDS, MAX_CHUNK } = require('node-zklib/constants.js')

export const ZK_COMMANDS = Object.freeze({
    ...COMMANDS,
    CMD_FACE_TMP_WRQ: 85,
    CMD_FACE_TMP_RRQ: 86,
    CMD_FACE_TMP_RRQ_ALL: 88,
    CMD_FACE_TMP_WRQ_ALL: 89
})

export const DEFAULT_PORT = 4370
export const DEFAULT_TIMEOUT = 15000

export function createZKClient(ip, port = DEFAULT_PORT, timeout = DEFAULT_TIMEOUT) {
    return new ZKLib(ip, Number(port), timeout, 5200 + Math.floor(Math.random() * 1000))
}

export function getTcp(zk) {
    const tcp = zk?.zklibTcp
    if (!tcp?.socket) throw new Error('TCP socket not available')
    return tcp
}

export async function freeData(zk) {
    try { await zk.freeData() } catch { /* buffers are best-effort cleanup */ }
}

export async function readBuffered(zk, request, options = {}) {
    const tcp = getTcp(zk)
    await freeData(zk)
    const result = await tcp.readWithBuffer(Buffer.from(request), options.onProgress)
    await freeData(zk)
    if (!result?.data) throw new Error('ZK buffered read returned no data')
    return {
        data: Buffer.from(result.data),
        error: result.err || null,
        evidence: {
            mode: result.mode || null,
            size: result.data.length,
            chunking: result.data.length > MAX_CHUNK ? 'required' : 'none'
        }
    }
}

export async function execute(zk, command, payload = Buffer.alloc(0), options = {}) {
    const tcp = getTcp(zk)
    tcp.replyId++
    const { createTCPHeader, removeTcpHeader, decodeTCPHeader } = require('node-zklib/utils.js')
    const packet = createTCPHeader(command, tcp.sessionId, tcp.replyId, Buffer.from(payload))
    const reply = await new Promise((resolve, reject) => {
        let timer
        const onData = data => {
            clearTimeout(timer)
            resolve(data)
        }
        tcp.socket.once('data', onData)
        tcp.socket.write(packet, err => {
            if (err) {
                tcp.socket.removeListener('data', onData)
                clearTimeout(timer)
                reject(err)
                return
            }
            timer = setTimeout(() => {
                tcp.socket.removeListener('data', onData)
                reject(Object.assign(new Error(`TIMEOUT waiting for command ${command}`), { code: 'ZK_TIMEOUT' }))
            }, options.timeout || 5000)
        })
    })
    const body = removeTcpHeader(reply)
    const header = decodeTCPHeader(reply.subarray(0, 16))
    const ack = header.commandId
    const accepted = ack === ZK_COMMANDS.CMD_ACK_OK || ack === ZK_COMMANDS.CMD_ACK_DATA
    if (options.requireAck && !accepted) {
        throw Object.assign(new Error(`ZK command ${command} rejected with reply ${ack}`), { code: 'ZK_NAK', replyId: ack })
    }
    return { body, ack, accepted, evidence: { command, ack, replyId: tcp.replyId, responseSize: body.length } }
}

export async function disableRefreshEnable(zk, operation) {
    let disabled = false
    try {
        try { await zk.disableDevice(); disabled = true } catch (error) {
            if (!operation.allowDisableFailure) throw error
        }
        return await operation.run()
    } finally {
        try { await zk.executeCmd(ZK_COMMANDS.CMD_REFRESHDATA, Buffer.alloc(0)) } catch { /* best effort */ }
        try { await zk.executeCmd(ZK_COMMANDS.CMD_REFRESHOPTION, Buffer.alloc(0)) } catch { /* best effort */ }
        if (disabled) {
            try { await zk.enableDevice() } catch { /* preserve the original operation error */ }
        }
    }
}

