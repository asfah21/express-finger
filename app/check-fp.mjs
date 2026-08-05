import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ZKLib from 'node-zklib';

const DEFAULT_PORT = 4370;
const DEFAULT_TIMEOUT = 15000;
const DEFAULT_MAX_USERS = 50;
const DEFAULT_FP_INDEXES = 10;
const DEFAULT_OUTPUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'probe-results');

const COMMANDS = {
    CMD_USERTEMP_RRQ: 9,
    CMD_USER_WRQ: 8,
    CMD_REFRESHDATA: 1013,
    CMD_REFRESHOPTION: 1014
};

const args = parseArgs(process.argv.slice(2));
const config = {
    ip: args.ip || process.env.ZK_PROBE_IP || process.env.ZK_IP,
    port: toPositiveInt(args.port || process.env.ZK_PROBE_PORT || process.env.ZK_PORT, DEFAULT_PORT),
    timeout: toPositiveInt(args.timeout || process.env.ZK_PROBE_TIMEOUT, DEFAULT_TIMEOUT),
    maxUsers: toPositiveInt(args.maxUsers || process.env.ZK_PROBE_MAX_USERS, DEFAULT_MAX_USERS),
    fpIndexes: toPositiveInt(args.fpIndexes || process.env.ZK_PROBE_FP_INDEXES, DEFAULT_FP_INDEXES),
    outputDir: path.resolve(args.outputDir || process.env.ZK_PROBE_OUTPUT_DIR || DEFAULT_OUTPUT_DIR),
    writeFixture: args.writeFixture === true || process.env.ZK_PROBE_WRITE_FIXTURE === 'true',
    face: args.face === true || process.env.ZK_PROBE_FACE === 'true'
};

if (!config.ip) {
    console.error('Missing device IP. Set ZK_PROBE_IP or pass --ip <address>.');
    process.exitCode = 2;
} else {
    main().catch(error => {
        console.error(`Probe failed: ${error.message}`);
        process.exitCode = 1;
    });
}

async function main() {
    const startedAt = new Date();
    const probe = createProbeDocument(startedAt, config);
    const zk = new ZKLib(config.ip, config.port, config.timeout, 5200 + Math.floor(Math.random() * 1000));
    const lifecycle = probe.operations.lifecycle;
    let connected = false;

    try {
        await runStep(probe, 'connect', async () => {
            await zk.createSocket();
            connected = true;
        });

        await runStep(probe, 'deviceInfo', async () => {
            const info = await zk.getInfo();
            probe.device = normalizeDeviceInfo(info);
        });

        let users = [];
        await runStep(probe, 'users', async () => {
            const result = await zk.getUsers();
            users = (result?.data || []).slice(0, config.maxUsers);
            probe.observations.users = { total: result?.data?.length || 0, sampled: users.length };
        });

        const tcp = zk.zklibTcp;
        await probeFingerprintRead(probe, zk, tcp, users);
        await probeFingerprintWrite(probe, zk, tcp);
        await probeFaceCandidates(probe, zk, tcp);

        await runStep(probe, 'refresh', async () => {
            await executeAndRecord(probe, 'refreshData', () => zk.executeCmd(COMMANDS.CMD_REFRESHDATA, Buffer.alloc(0)));
            await executeAndRecord(probe, 'refreshOption', () => zk.executeCmd(COMMANDS.CMD_REFRESHOPTION, Buffer.alloc(0)));
        });
    } finally {
        if (connected) {
            await runStep(probe, 'disconnect', async () => zk.disconnect());
        }
        probe.finishedAt = new Date().toISOString();
        probe.durationMs = new Date(probe.finishedAt).getTime() - startedAt.getTime();
        await writeArtifacts(probe, config.outputDir);
    }
}

async function probeFingerprintRead(probe, zk, tcp, users) {
    const operation = createOperation('fingerprintRead', {
        command: 'readWithBuffer',
        table: 2,
        payloadFormat: '01 07 00 02 00 00 00 00 00 00 00'
    });
    probe.operations.fingerprintRead = operation;
    try {
        await safeFreeData(probe, zk, 'beforeFingerprintRead');
        const result = await tcp.readWithBuffer(Buffer.from([0x01, 0x07, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]));
        const data = result?.data || result;
        operation.status = 'SUPPORTED';
        operation.evidence = {
            payloadBytes: data?.length || 0,
            sha256: checksum(data),
            records: parseFingerprintRecords(data, users)
        };
    } catch (error) {
        recordError(operation, error);
    } finally {
        await safeFreeData(probe, zk, 'afterFingerprintRead');
    }
}

async function probeFingerprintWrite(probe, zk, tcp) {
    const operation = createOperation('fingerprintWrite', {
        command: 'CMD_USERTEMP_WRQ',
        enabled: config.writeFixture,
        safety: 'disabled-by-default; requires --write-fixture and explicit non-production fixture'
    });
    probe.operations.fingerprintWrite = operation;
    if (!config.writeFixture) {
        operation.status = 'PROBE_REQUIRED';
        operation.reason = 'Skipped by default; no production biometric write is attempted.';
        return;
    }
    operation.status = 'PROBE_REQUIRED';
    operation.reason = 'Fixture write is intentionally not implemented until the command and payload format are proven.';
    operation.evidence = { socketAvailable: Boolean(tcp?.socket), command: COMMANDS.CMD_USER_WRQ };
}

async function probeFaceCandidates(probe, zk, tcp) {
    const candidates = [
        { name: 'CMD_USERTEMP_RRQ', command: COMMANDS.CMD_USERTEMP_RRQ, payload: Buffer.from([0x01, 0x09, 0x00, 0x05, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]) },
        { name: 'CMD_FACE_RRQ', command: faceCommand('CMD_FACE_RRQ'), payload: Buffer.alloc(0) }
    ];
    probe.operations.faceRead = createOperation('faceRead', { candidates: candidates.map(({ name, command }) => ({ name, command })) });
    probe.operations.faceWrite = createOperation('faceWrite', {
        candidates: ['CMD_FACE_WRQ', 'CMD_USERTEMP_WRQ'],
        status: 'PROBE_REQUIRED',
        reason: 'No face write is attempted without a validated non-production fixture.'
    });
    if (!config.face) {
        probe.operations.faceRead.status = 'PROBE_REQUIRED';
        probe.operations.faceRead.reason = 'Skipped by default; pass --face to execute candidate reads.';
        return;
    }
    for (const candidate of candidates) {
        const result = createOperation(candidate.name, { command: candidate.command });
        try {
            const reply = await zk.executeCmd(candidate.command, candidate.payload);
            result.status = 'SUPPORTED';
            result.evidence = { replyBytes: reply?.length || 0, sha256: checksum(reply) };
        } catch (error) {
            recordError(result, error);
        }
        probe.operations.faceRead.results ||= [];
        probe.operations.faceRead.results.push(result);
    }
}

function parseFingerprintRecords(data, users) {
    if (!Buffer.isBuffer(data)) return { count: 0, users: [] };
    const userIds = new Map(users.map(user => [user.uid, String(user.userId || '').trim()]));
    const counts = new Map();
    let offset = 4;
    while (offset + 6 <= data.length) {
        const size = data.readUInt16LE(offset);
        if (size < 6 || size > 2000) { offset += 1; continue; }
        const uid = data.readUInt16LE(offset + 2);
        const fpIndex = data.readUInt8(offset + 4);
        if (uid > 0 && uid <= 2000 && fpIndex <= 10) {
            const key = `${uid}:${fpIndex}`;
            counts.set(key, { uid, userId: userIds.get(uid) || null, fpIndex });
        }
        offset += size;
    }
    return { count: counts.size, users: [...counts.values()] };
}

async function executeAndRecord(probe, name, action) {
    const operation = createOperation(name);
    probe.operations[name] = operation;
    try {
        const reply = await action();
        operation.status = 'SUPPORTED';
        operation.evidence = { replyBytes: reply?.length || 0, sha256: checksum(reply) };
    } catch (error) {
        recordError(operation, error);
    }
}

async function safeFreeData(probe, zk, name) {
    await executeAndRecord(probe, name, () => zk.freeData());
}

async function runStep(probe, name, action) {
    const operation = createOperation(name);
    probe.operations[name] = operation;
    try { await action(); operation.status = 'SUPPORTED'; }
    catch (error) { recordError(operation, error); throw error; }
}

function createProbeDocument(startedAt, options) {
    return {
        schemaVersion: 1,
        probeType: 'zk-template-protocol',
        startedAt: startedAt.toISOString(),
        finishedAt: null,
        durationMs: null,
        target: { host: redactHost(options.ip), port: options.port },
        device: { model: null, firmware: null, serialNumber: null, rawKeys: [] },
        configuration: { maxUsers: options.maxUsers, fpIndexes: options.fpIndexes, faceEnabled: options.face, writeFixtureEnabled: options.writeFixture },
        operations: {},
        observations: {},
        capabilityMatrix: [],
        compatibilityMatrix: [],
        safety: { rawBiometricLogged: false, writesAttempted: false, defaultWritePolicy: 'deny' },
        errors: []
    };
}

function createOperation(name, details = {}) { return { name, status: 'PROBE_REQUIRED', startedAt: new Date().toISOString(), ...details }; }
function recordError(operation, error) { operation.status = classifyError(error); operation.error = { type: error?.code || error?.name || 'Error', message: error?.message || String(error) }; }
function classifyError(error) { return /timeout/i.test(error?.message || '') ? 'ERROR_TIMEOUT' : 'ERROR'; }
function normalizeDeviceInfo(info = {}) {
    const model = info.model || info.deviceName || info.device || null;
    const firmware = info.firmware || info.fwVersion || info.fw || null;
    const serialNumber = info.serialNumber || info.serial || info.sn || null;
    return { model, firmware, serialNumber, rawKeys: Object.keys(info).sort() };
}
function redactHost(host) { return String(host).replace(/^(\d+\.\d+\.)\d+\.\d+$/, '$1x.x').replace(/^[^:]+@/, 'redacted@'); }
function checksum(value) { return Buffer.isBuffer(value) ? crypto.createHash('sha256').update(value).digest('hex') : null; }
function toPositiveInt(value, fallback) { const number = Number.parseInt(value, 10); return Number.isInteger(number) && number > 0 ? number : fallback; }
function parseArgs(argv) {
    const parsed = {};
    for (let i = 0; i < argv.length; i += 1) {
        const item = argv[i];
        if (!item.startsWith('--')) continue;
        const [key, inlineValue] = item.slice(2).split('=', 2);
        if (inlineValue !== undefined) parsed[key] = inlineValue;
        else if (argv[i + 1] && !argv[i + 1].startsWith('--')) parsed[key] = argv[++i];
        else parsed[key] = true;
    }
    return parsed;
}
function faceCommand(name) { return Number(process.env[`ZK_${name}`] || 0); }

async function writeArtifacts(probe, outputDir) {
    const model = sanitizeName(probe.device.model || 'unknown-model');
    const firmware = sanitizeName(probe.device.firmware || 'unknown-firmware');
    const timestamp = probe.startedAt.replace(/[:.]/g, '-');
    await fs.mkdir(outputDir, { recursive: true });
    const jsonPath = path.join(outputDir, `${model}-${firmware}-${timestamp}.json`);
    const mdPath = path.join(outputDir, `${model}-${firmware}-${timestamp}.md`);
    await fs.writeFile(jsonPath, `${JSON.stringify(probe, null, 2)}\n`, 'utf8');
    await fs.writeFile(mdPath, renderMarkdown(probe), 'utf8');
    console.log(`Probe artifacts written: ${jsonPath} and ${mdPath}`);
}
function renderMarkdown(probe) {
    const entries = Object.entries(probe.operations).map(([name, operation]) => `| ${name} | ${operation.status} | ${operation.error?.message || operation.reason || ''} |`).join('\n');
    return `# ZK Template Protocol Probe\n\n- Started: ${probe.startedAt}\n- Finished: ${probe.finishedAt}\n- Host: ${probe.target.host}:${probe.target.port}\n- Model: ${probe.device.model || 'UNKNOWN'}\n- Firmware: ${probe.device.firmware || 'UNKNOWN'}\n- Serial: ${probe.device.serialNumber || 'UNKNOWN'}\n\n## Operations\n\n| Operation | Status | Notes |\n|---|---|---|\n${entries}\n\n## Safety\n\n- Raw biometric logged: **${probe.safety.rawBiometricLogged ? 'yes' : 'no'}**\n- Write policy: **${probe.safety.defaultWritePolicy}**\n\n## Capability Matrix\n\nNo capability is marked supported unless the probe received a valid response.\n`;
}
function sanitizeName(value) { return String(value).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80); }

