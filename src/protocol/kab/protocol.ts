/**
 * KABNetManager command flow: send a command on port 9090 and receive the
 * response, retrying on timeout.
 *
 * The app's KabNetManager uses three threads on its 9090 socket:
 *   a$f = send thread
 *   a$e = receive thread
 *   a$c = response demultiplexer
 *
 * We model this with a simple send-and-wait using a per-command timeout.
 */

import * as dgram from 'dgram';
import {
    buildPowerCommand,
    buildStatusQueryCommand,
    buildDimCommand,
    parseKabResponse,
    type KabResponse,
} from './packets.js';
import type { DeviceInfo } from '../types.js';

export const KAB_COMMAND_TIMEOUT_MS = 2000;
export const KAB_COMMAND_RETRIES    = 3;

export interface KabCommandResult {
    ok: boolean;
    response?: KabResponse;
    error?: Error;
}

/**
 * Internal: send `buf` to `host:port` and wait up to `timeoutMs` for a
 * 152-byte response.  Uses a dedicated short-lived socket per call to
 * simplify correlation.
 *
 * @param log  Optional logger — when supplied, debug lines are emitted.
 */
function sendAndReceive(
    buf: Buffer,
    host: string,
    port: number,
    timeoutMs: number,
    log?: (msg: string) => void,
): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const sock = dgram.createSocket('udp4');
        let settled = false;

        const finish = (err?: Error, data?: Buffer) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            sock.close(() => {
                if (err)  reject(err);
                else      resolve(data!);
            });
        };

        const timer = setTimeout(
            () => finish(new Error(`KAB command timeout after ${timeoutMs}ms`)),
            timeoutMs,
        );

        sock.on('error', (e) => finish(e));
        sock.on('message', (msg: Buffer, rinfo) => {
            log?.(`KAB rx ${msg.length}B from ${rinfo.address}:${rinfo.port}: ${msg.toString('hex')}`);
            finish(undefined, msg);
        });

        sock.bind(0, () => {
            const addr = sock.address();
            log?.(`KAB tx ${buf.length}B to ${host}:${port} (from port ${addr.port}): ${buf.toString('hex')}`);
            sock.send(buf, 0, buf.length, port, host, (err) => {
                if (err) finish(err);
            });
        });
    });
}

/**
 * Send a pre-built command buffer, retrying up to `retries` times.
 */
async function sendWithRetry(
    buf: Buffer,
    device: DeviceInfo,
    retries = KAB_COMMAND_RETRIES,
    log?: (msg: string) => void,
): Promise<KabCommandResult> {
    const host = device.host;
    const port = device.kabCommandPort ?? device.port;
    let lastError: Error | undefined;

    log?.(`KAB sendWithRetry → ${device.id} @ ${host}:${port}  idInt=0x${(device.kabDeviceIdInt ?? 0).toString(16)}  key="${device.kabKey ?? ''}"  retries=${retries}`);

    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            const raw = await sendAndReceive(buf, host, port, KAB_COMMAND_TIMEOUT_MS, log);
            const parsed = parseKabResponse(raw);
            if (parsed) {
                log?.(`KAB response ok: cmdCode=${parsed.cmdCode} subtype=${parsed.subtype} powerState=${parsed.powerState}`);
                return { ok: true, response: parsed };
            }
            log?.(`KAB response unparseable (${raw.length}B)`);
            lastError = new Error(`Unparseable KAB response (${raw.length}B)`);
        } catch (e) {
            lastError = e instanceof Error ? e : new Error(String(e));
            log?.(`KAB attempt ${attempt + 1}/${retries} failed: ${lastError.message}`);
        }
    }
    return { ok: false, error: lastError };
}

/**
 * Send a power on/off command to a KAB device.
 */
export async function kabSetPower(
    device: DeviceInfo,
    on: boolean,
    log?: (msg: string) => void,
): Promise<KabCommandResult> {
    const idInt = device.kabDeviceIdInt ?? 0;
    const key   = device.kabKey  ?? '';
    const pass  = device.kabPass ?? '111111';

    if (!key) {
        return {
            ok: false,
            error: new Error(
                `KAB kabKey is empty for device ${device.id} — add kabKey (e.g. "keenfeng") to the devices[] config entry`,
            ),
        };
    }

    const buf = buildPowerCommand(idInt, key, pass, on);
    return sendWithRetry(buf, device, KAB_COMMAND_RETRIES, log);
}

/**
 * Send a status query to a KAB device.
 */
export async function kabGetStatus(
    device: DeviceInfo,
    log?: (msg: string) => void,
): Promise<KabCommandResult> {
    const idInt = device.kabDeviceIdInt ?? 0;
    const key   = device.kabKey  ?? '';
    const pass  = device.kabPass ?? '111111';

    if (!key) {
        return {
            ok: false,
            error: new Error(
                `KAB kabKey is empty for device ${device.id} — add kabKey (e.g. "keenfeng") to the devices[] config entry`,
            ),
        };
    }

    const buf = buildStatusQueryCommand(idInt, key, pass);
    return sendWithRetry(buf, device, KAB_COMMAND_RETRIES, log);
}

/**
 * Send a dim level command to a KAB device.
 */
export async function kabSetDim(
    device: DeviceInfo,
    level: number,
    log?: (msg: string) => void,
): Promise<KabCommandResult> {
    const idInt = device.kabDeviceIdInt ?? 0;
    const key   = device.kabKey  ?? '';
    const pass  = device.kabPass ?? '111111';

    if (!key) {
        return {
            ok: false,
            error: new Error(
                `KAB kabKey is empty for device ${device.id} — add kabKey (e.g. "keenfeng") to the devices[] config entry`,
            ),
        };
    }

    const buf = buildDimCommand(idInt, key, pass, level);
    return sendWithRetry(buf, device, KAB_COMMAND_RETRIES, log);
}
