import * as net from 'node:net';

const SOCKET_READ_TIMEOUT_MS = 15_000;
const HTTP_HEADER_MAX_BYTES = 64 * 1024;
const CONNECT_RESPONSE = 'HTTP/1.1 200 Connection Established\r\nProxy-Agent: coworkany-socks-bridge\r\n\r\n';
const BAD_GATEWAY_RESPONSE = 'HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n';

type EnvRecord = Record<string, string | undefined>;

type ActiveSocksBridge = {
    sourceProxyUrl: string;
    bridgeProxyUrl: string;
    server: net.Server;
};

const INTERNAL_CONFIGURED_PROXY_ENV_KEY = 'COWORKANY_INTERNAL_UPSTREAM_URL';

const runtimeState: {
    activeBridge: ActiveSocksBridge | null;
    inFlightBridgeStart: Promise<ActiveSocksBridge> | null;
    configuredProxyUrl: string | null;
    transportProxyUrl: string | null;
} = {
    activeBridge: null,
    inFlightBridgeStart: null,
    configuredProxyUrl: null,
    transportProxyUrl: null,
};

const TRANSPORT_PROXY_ENV_KEYS = [
    'HTTPS_PROXY',
    'https_proxy',
    'HTTP_PROXY',
    'http_proxy',
    'ALL_PROXY',
    'all_proxy',
    'GLOBAL_AGENT_HTTPS_PROXY',
    'GLOBAL_AGENT_HTTP_PROXY',
    'npm_config_proxy',
    'npm_config_http_proxy',
    'npm_config_https_proxy',
    'NPM_CONFIG_PROXY',
    'NPM_CONFIG_HTTP_PROXY',
    'NPM_CONFIG_HTTPS_PROXY',
] as const;

const DEBUG_PROXY_ENV_KEYS = [
    INTERNAL_CONFIGURED_PROXY_ENV_KEY,
    'COWORKANY_PROXY_CONFIGURED_URL',
    'COWORKANY_PROXY_TRANSPORT_URL',
    'COWORKANY_PROXY_URL',
    'HTTPS_PROXY',
    'https_proxy',
    'HTTP_PROXY',
    'http_proxy',
    'ALL_PROXY',
    'all_proxy',
    'GLOBAL_AGENT_HTTPS_PROXY',
    'GLOBAL_AGENT_HTTP_PROXY',
    'npm_config_proxy',
    'npm_config_http_proxy',
    'npm_config_https_proxy',
    'NPM_CONFIG_PROXY',
    'NPM_CONFIG_HTTP_PROXY',
    'NPM_CONFIG_HTTPS_PROXY',
] as const;

function isSocksProxyUrl(value: string): boolean {
    const lowered = value.trim().toLowerCase();
    return lowered.startsWith('socks://')
        || lowered.startsWith('socks4://')
        || lowered.startsWith('socks4a://')
        || lowered.startsWith('socks5://')
        || lowered.startsWith('socks5h://');
}

function toNonEmpty(value: string | undefined | null): string | null {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function normalizeProxyUrl(proxyUrl: string): string {
    const trimmed = proxyUrl.trim();
    if (!trimmed.includes('://')) {
        return `http://${trimmed}`;
    }
    return trimmed;
}

function toSocksVersion(proxy: URL): 4 | 5 {
    const protocol = proxy.protocol.replace(/:$/u, '').toLowerCase();
    if (protocol === 'socks4' || protocol === 'socks4a') {
        return 4;
    }
    return 5;
}

function parseSocksProxyUrl(proxyUrl: string): URL {
    const parsed = new URL(normalizeProxyUrl(proxyUrl));
    const protocol = parsed.protocol.replace(/:$/u, '').toLowerCase();
    if (!['socks', 'socks4', 'socks4a', 'socks5', 'socks5h'].includes(protocol)) {
        throw new Error(`Unsupported SOCKS protocol: ${parsed.protocol}`);
    }
    return parsed;
}

function parsePort(raw: string | null, fallback: number): number {
    if (!raw || raw.trim().length === 0) {
        return fallback;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
        throw new Error(`Invalid port: ${raw}`);
    }
    return parsed;
}

function decodeUrlCredential(value: string): string {
    if (!value) {
        return '';
    }
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function onceSocketChunk(socket: net.Socket, timeoutMs: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error('Socket read timed out'));
        }, timeoutMs);

        const cleanup = (): void => {
            clearTimeout(timer);
            socket.off('data', onData);
            socket.off('error', onError);
            socket.off('end', onEnd);
            socket.off('close', onClose);
        };

        const onData = (chunk: Buffer): void => {
            cleanup();
            resolve(chunk);
        };

        const onError = (error: Error): void => {
            cleanup();
            reject(error);
        };

        const onEnd = (): void => {
            cleanup();
            reject(new Error('Socket ended before expected bytes were received'));
        };

        const onClose = (): void => {
            cleanup();
            reject(new Error('Socket closed before expected bytes were received'));
        };

        socket.once('data', onData);
        socket.once('error', onError);
        socket.once('end', onEnd);
        socket.once('close', onClose);
    });
}

class BufferedSocketReader {
    private buffer = Buffer.alloc(0);

    constructor(private readonly socket: net.Socket) {}

    async readExact(length: number, timeoutMs = SOCKET_READ_TIMEOUT_MS): Promise<Buffer> {
        while (this.buffer.length < length) {
            const chunk = await onceSocketChunk(this.socket, timeoutMs);
            this.buffer = Buffer.concat([this.buffer, chunk]);
        }

        const value = this.buffer.subarray(0, length);
        this.buffer = this.buffer.subarray(length);
        return value;
    }

    async readUntil(sequence: Buffer, maxBytes: number, timeoutMs = SOCKET_READ_TIMEOUT_MS): Promise<Buffer> {
        while (true) {
            if (this.buffer.length > maxBytes) {
                throw new Error(`HTTP proxy request header exceeds ${maxBytes} bytes`);
            }
            const index = this.buffer.indexOf(sequence);
            if (index >= 0) {
                return this.buffer;
            }
            const chunk = await onceSocketChunk(this.socket, timeoutMs);
            this.buffer = Buffer.concat([this.buffer, chunk]);
        }
    }

    drainRemainder(): Buffer {
        const remainder = this.buffer;
        this.buffer = Buffer.alloc(0);
        return remainder;
    }
}

async function connectTcp(host: string, port: number): Promise<net.Socket> {
    return await new Promise((resolve, reject) => {
        const socket = net.createConnection({ host, port });

        const cleanup = (): void => {
            socket.off('connect', onConnect);
            socket.off('error', onError);
        };

        const onConnect = (): void => {
            cleanup();
            resolve(socket);
        };

        const onError = (error: Error): void => {
            cleanup();
            reject(error);
        };

        socket.once('connect', onConnect);
        socket.once('error', onError);
    });
}

async function connectViaSocks4(proxy: URL, targetHost: string, targetPort: number): Promise<net.Socket> {
    const proxyHost = proxy.hostname;
    const proxyPort = parsePort(proxy.port || null, 1080);
    const userId = decodeUrlCredential(proxy.username || '');
    const socket = await connectTcp(proxyHost, proxyPort);
    const reader = new BufferedSocketReader(socket);

    const userBytes = Buffer.from(userId, 'utf8');
    if (userBytes.length > 255) {
        throw new Error('SOCKS4 username is too long');
    }

    const isIpv4Target = net.isIP(targetHost) === 4;
    const hostBytes = isIpv4Target
        ? Buffer.from(targetHost.split('.').map((part) => Number.parseInt(part, 10)))
        : Buffer.from(targetHost, 'utf8');
    const requiresSocks4a = !isIpv4Target;
    if (requiresSocks4a && hostBytes.length > 255) {
        throw new Error('SOCKS4a host is too long');
    }

    const requestParts: Buffer[] = [
        Buffer.from([
            0x04,
            0x01,
            (targetPort >> 8) & 0xff,
            targetPort & 0xff,
            ...(requiresSocks4a ? [0x00, 0x00, 0x00, 0x01] : Array.from(hostBytes)),
        ]),
        userBytes,
        Buffer.from([0x00]),
    ];
    if (requiresSocks4a) {
        requestParts.push(hostBytes, Buffer.from([0x00]));
    }

    socket.write(Buffer.concat(requestParts));
    const reply = await reader.readExact(8);
    if (reply[1] !== 0x5a) {
        socket.destroy();
        throw new Error(`SOCKS4 connect rejected (code=${reply[1]})`);
    }

    const remainder = reader.drainRemainder();
    if (remainder.length > 0) {
        socket.unshift(remainder);
    }
    return socket;
}

async function connectViaSocks5(proxy: URL, targetHost: string, targetPort: number): Promise<net.Socket> {
    const proxyHost = proxy.hostname;
    const proxyPort = parsePort(proxy.port || null, 1080);
    const username = decodeUrlCredential(proxy.username || '');
    const password = decodeUrlCredential(proxy.password || '');
    const socket = await connectTcp(proxyHost, proxyPort);
    const reader = new BufferedSocketReader(socket);

    const methods: number[] = [0x00];
    if (username.length > 0 || password.length > 0) {
        methods.unshift(0x02);
    }
    socket.write(Buffer.from([0x05, methods.length, ...methods]));
    const methodSelection = await reader.readExact(2);
    if (methodSelection[0] !== 0x05) {
        socket.destroy();
        throw new Error(`Invalid SOCKS5 version in handshake response: ${methodSelection[0]}`);
    }
    if (methodSelection[1] === 0xff) {
        socket.destroy();
        throw new Error('SOCKS5 server rejected all authentication methods');
    }
    if (methodSelection[1] === 0x02) {
        const userBytes = Buffer.from(username, 'utf8');
        const passBytes = Buffer.from(password, 'utf8');
        if (userBytes.length > 255 || passBytes.length > 255) {
            socket.destroy();
            throw new Error('SOCKS5 username/password is too long');
        }
        socket.write(Buffer.concat([
            Buffer.from([0x01, userBytes.length]),
            userBytes,
            Buffer.from([passBytes.length]),
            passBytes,
        ]));
        const authReply = await reader.readExact(2);
        if (authReply[1] !== 0x00) {
            socket.destroy();
            throw new Error(`SOCKS5 authentication failed (code=${authReply[1]})`);
        }
    } else if (methodSelection[1] !== 0x00) {
        socket.destroy();
        throw new Error(`Unsupported SOCKS5 auth method: ${methodSelection[1]}`);
    }

    const hostBytes = Buffer.from(targetHost, 'utf8');
    if (hostBytes.length > 255) {
        socket.destroy();
        throw new Error('SOCKS5 target host is too long');
    }
    const connectRequest = Buffer.concat([
        Buffer.from([0x05, 0x01, 0x00, 0x03, hostBytes.length]),
        hostBytes,
        Buffer.from([(targetPort >> 8) & 0xff, targetPort & 0xff]),
    ]);
    socket.write(connectRequest);
    const connectReplyHeader = await reader.readExact(4);
    if (connectReplyHeader[0] !== 0x05) {
        socket.destroy();
        throw new Error(`Invalid SOCKS5 version in connect response: ${connectReplyHeader[0]}`);
    }
    if (connectReplyHeader[1] !== 0x00) {
        socket.destroy();
        throw new Error(`SOCKS5 connect rejected (code=${connectReplyHeader[1]})`);
    }
    const addressType = connectReplyHeader[3];
    if (addressType === 0x01) {
        await reader.readExact(4 + 2);
    } else if (addressType === 0x04) {
        await reader.readExact(16 + 2);
    } else if (addressType === 0x03) {
        const domainLength = (await reader.readExact(1))[0];
        await reader.readExact(domainLength + 2);
    } else {
        socket.destroy();
        throw new Error(`Unsupported SOCKS5 address type: ${addressType}`);
    }

    const remainder = reader.drainRemainder();
    if (remainder.length > 0) {
        socket.unshift(remainder);
    }
    return socket;
}

async function connectViaSocksProxy(
    proxy: URL,
    targetHost: string,
    targetPort: number,
): Promise<net.Socket> {
    const version = toSocksVersion(proxy);
    if (version === 4) {
        return await connectViaSocks4(proxy, targetHost, targetPort);
    }
    return await connectViaSocks5(proxy, targetHost, targetPort);
}

function parseConnectTarget(target: string): { host: string; port: number } | null {
    const trimmed = target.trim();
    if (trimmed.length === 0) {
        return null;
    }
    if (trimmed.startsWith('[')) {
        const closing = trimmed.indexOf(']');
        if (closing <= 0) {
            return null;
        }
        const host = trimmed.slice(1, closing);
        const portRaw = trimmed.slice(closing + 1);
        if (!portRaw.startsWith(':')) {
            return null;
        }
        const port = parsePort(portRaw.slice(1), 0);
        return { host, port };
    }
    const delimiter = trimmed.lastIndexOf(':');
    if (delimiter <= 0 || delimiter >= trimmed.length - 1) {
        return null;
    }
    const host = trimmed.slice(0, delimiter);
    const port = parsePort(trimmed.slice(delimiter + 1), 0);
    return { host, port };
}

function parseRequestTarget(
    method: string,
    target: string,
    headerLines: string[],
): { host: string; port: number; outboundPath: string; outboundHeaderLines: string[] } | null {
    if (method.toUpperCase() === 'CONNECT') {
        const connectTarget = parseConnectTarget(target);
        if (!connectTarget) {
            return null;
        }
        return {
            ...connectTarget,
            outboundPath: '',
            outboundHeaderLines: headerLines,
        };
    }

    const hostHeader = headerLines.find((line) => /^host:/iu.test(line));
    let targetUrl: URL | null = null;
    if (/^https?:\/\//iu.test(target)) {
        try {
            targetUrl = new URL(target);
        } catch {
            targetUrl = null;
        }
    } else if (hostHeader) {
        const headerValue = hostHeader.split(':').slice(1).join(':').trim();
        if (headerValue.length > 0) {
            try {
                targetUrl = new URL(`http://${headerValue}${target.startsWith('/') ? target : `/${target}`}`);
            } catch {
                targetUrl = null;
            }
        }
    }

    if (!targetUrl) {
        return null;
    }
    const host = targetUrl.hostname;
    const port = parsePort(targetUrl.port || null, targetUrl.protocol === 'https:' ? 443 : 80);
    const outboundPath = `${targetUrl.pathname || '/'}${targetUrl.search || ''}`;
    const outboundHeaderLines = headerLines.filter((line) => !/^proxy-connection:/iu.test(line));

    return {
        host,
        port,
        outboundPath,
        outboundHeaderLines,
    };
}

function attachBidirectionalPipe(source: net.Socket, target: net.Socket): void {
    const shutdown = (): void => {
        source.destroy();
        target.destroy();
    };

    source.on('error', shutdown);
    target.on('error', shutdown);
    source.on('close', () => target.destroy());
    target.on('close', () => source.destroy());

    source.pipe(target);
    target.pipe(source);
}

async function handleBridgeClient(socket: net.Socket, proxyUrl: URL): Promise<void> {
    const reader = new BufferedSocketReader(socket);
    try {
        const headerBytes = await reader.readUntil(Buffer.from('\r\n\r\n'), HTTP_HEADER_MAX_BYTES);
        const delimiter = headerBytes.indexOf(Buffer.from('\r\n\r\n'));
        if (delimiter < 0) {
            throw new Error('Malformed HTTP proxy request header');
        }
        const headerPart = headerBytes.subarray(0, delimiter).toString('utf8');
        const bufferedRemainder = headerBytes.subarray(delimiter + 4);
        const socketRemainder = reader.drainRemainder();
        const initialPayload = socketRemainder.length > 0
            ? Buffer.concat([bufferedRemainder, socketRemainder])
            : bufferedRemainder;

        const lines = headerPart.split('\r\n').filter((line) => line.length > 0);
        if (lines.length === 0) {
            throw new Error('Missing request line');
        }
        const [method = '', target = '', httpVersion = 'HTTP/1.1'] = lines[0].split(' ');
        const headerLines = lines.slice(1);
        if (process.env.COWORKANY_PROXY_DEBUG === '1') {
            console.info('[coworkany-proxy-bridge-request]', {
                method,
                target,
                httpVersion,
            });
        }
        const parsedTarget = parseRequestTarget(method, target, headerLines);
        if (!parsedTarget) {
            throw new Error(`Failed to parse proxy request target: ${target}`);
        }

        const upstream = await connectViaSocksProxy(proxyUrl, parsedTarget.host, parsedTarget.port);
        if (method.toUpperCase() === 'CONNECT') {
            socket.write(CONNECT_RESPONSE);
            if (initialPayload.length > 0) {
                upstream.write(initialPayload);
            }
            attachBidirectionalPipe(socket, upstream);
            return;
        }

        const rewrittenHeader = `${method} ${parsedTarget.outboundPath} ${httpVersion}\r\n${parsedTarget.outboundHeaderLines.join('\r\n')}\r\n\r\n`;
        upstream.write(rewrittenHeader);
        if (initialPayload.length > 0) {
            upstream.write(initialPayload);
        }
        attachBidirectionalPipe(socket, upstream);
    } catch (error) {
        try {
            socket.write(BAD_GATEWAY_RESPONSE);
        } catch {
            // ignore response write failures during teardown
        }
        socket.destroy(error instanceof Error ? error : undefined);
    }
}

async function closeBridge(bridge: ActiveSocksBridge): Promise<void> {
    await new Promise<void>((resolve) => {
        bridge.server.close(() => resolve());
    });
}

async function createBridge(proxyUrl: string): Promise<ActiveSocksBridge> {
    const parsedProxy = parseSocksProxyUrl(proxyUrl);
    const server = net.createServer((socket) => {
        void handleBridgeClient(socket, parsedProxy);
    });
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve());
    });
    server.unref();
    const address = server.address();
    if (!address || typeof address === 'string') {
        server.close();
        throw new Error('Failed to resolve SOCKS bridge bind address');
    }
    const bridge = {
        sourceProxyUrl: proxyUrl,
        bridgeProxyUrl: `http://127.0.0.1:${address.port}`,
        server,
    };
    console.info('[coworkany-proxy-bridge] started', {
        source: bridge.sourceProxyUrl,
        bridge: bridge.bridgeProxyUrl,
    });
    return bridge;
}

async function ensureSocksBridge(proxyUrl: string): Promise<ActiveSocksBridge> {
    if (runtimeState.activeBridge && runtimeState.activeBridge.sourceProxyUrl === proxyUrl) {
        return runtimeState.activeBridge;
    }
    if (runtimeState.inFlightBridgeStart) {
        const existing = await runtimeState.inFlightBridgeStart;
        if (existing.sourceProxyUrl === proxyUrl) {
            return existing;
        }
    }

    runtimeState.inFlightBridgeStart = (async () => {
        if (runtimeState.activeBridge && runtimeState.activeBridge.sourceProxyUrl !== proxyUrl) {
            await closeBridge(runtimeState.activeBridge);
            runtimeState.activeBridge = null;
        }
        const created = await createBridge(proxyUrl);
        runtimeState.activeBridge = created;
        return created;
    })();

    try {
        return await runtimeState.inFlightBridgeStart;
    } finally {
        runtimeState.inFlightBridgeStart = null;
    }
}

async function resolveTransportProxyUrl(proxyUrl: string): Promise<string> {
    if (!isSocksProxyUrl(proxyUrl)) {
        if (runtimeState.activeBridge) {
            await closeBridge(runtimeState.activeBridge);
            runtimeState.activeBridge = null;
        }
        return proxyUrl;
    }

    const bridge = await ensureSocksBridge(proxyUrl);
    return bridge.bridgeProxyUrl;
}

export function resolveConfiguredProxyUrl(env: EnvRecord = process.env): string | null {
    const transportProxyUrl = toNonEmpty(env.COWORKANY_PROXY_TRANSPORT_URL);
    const directProxyUrl = toNonEmpty(env.COWORKANY_PROXY_URL);
    const explicitOverride = toNonEmpty(env.COWORKANY_PROXY_CONFIGURED_URL)
        ?? (
            directProxyUrl
            && (
                !transportProxyUrl
                || directProxyUrl !== transportProxyUrl
            )
            ? directProxyUrl
            : null
        );
    if (explicitOverride) {
        return explicitOverride;
    }

    const externalConfigured = toNonEmpty(env[INTERNAL_CONFIGURED_PROXY_ENV_KEY]);
    const hasProxySignals = Boolean(
        transportProxyUrl
        || directProxyUrl
        || toNonEmpty(env.HTTPS_PROXY)
        || toNonEmpty(env.https_proxy)
        || toNonEmpty(env.HTTP_PROXY)
        || toNonEmpty(env.http_proxy)
        || toNonEmpty(env.ALL_PROXY)
        || toNonEmpty(env.all_proxy)
        || toNonEmpty(env.GLOBAL_AGENT_HTTPS_PROXY)
        || toNonEmpty(env.GLOBAL_AGENT_HTTP_PROXY),
    );
    if (externalConfigured && hasProxySignals) {
        return externalConfigured;
    }
    if (!hasProxySignals) {
        return null;
    }
    return transportProxyUrl
        || directProxyUrl
        || toNonEmpty(env.HTTPS_PROXY)
        || toNonEmpty(env.https_proxy)
        || toNonEmpty(env.HTTP_PROXY)
        || toNonEmpty(env.http_proxy)
        || toNonEmpty(env.ALL_PROXY)
        || toNonEmpty(env.all_proxy)
        || toNonEmpty(env.GLOBAL_AGENT_HTTPS_PROXY)
        || toNonEmpty(env.GLOBAL_AGENT_HTTP_PROXY);
}

export function getProxyRuntimeStateSnapshot(
    env: EnvRecord = process.env,
): {
    configuredProxyUrl: string | null;
    transportProxyUrl: string | null;
} {
    const configuredProxyUrl = toNonEmpty(runtimeState.configuredProxyUrl)
        ?? toNonEmpty(env[INTERNAL_CONFIGURED_PROXY_ENV_KEY])
        ?? toNonEmpty(env.COWORKANY_PROXY_CONFIGURED_URL)
        ?? toNonEmpty(env.COWORKANY_PROXY_URL)
        ?? toNonEmpty(env.HTTPS_PROXY)
        ?? toNonEmpty(env.https_proxy)
        ?? toNonEmpty(env.HTTP_PROXY)
        ?? toNonEmpty(env.http_proxy)
        ?? toNonEmpty(env.ALL_PROXY)
        ?? toNonEmpty(env.all_proxy)
        ?? toNonEmpty(env.GLOBAL_AGENT_HTTPS_PROXY)
        ?? toNonEmpty(env.GLOBAL_AGENT_HTTP_PROXY);
    const transportProxyUrl = toNonEmpty(runtimeState.transportProxyUrl)
        ?? toNonEmpty(env.COWORKANY_PROXY_TRANSPORT_URL)
        ?? toNonEmpty(env.COWORKANY_PROXY_URL)
        ?? toNonEmpty(env.HTTPS_PROXY)
        ?? toNonEmpty(env.https_proxy)
        ?? toNonEmpty(env.HTTP_PROXY)
        ?? toNonEmpty(env.http_proxy)
        ?? toNonEmpty(env.ALL_PROXY)
        ?? toNonEmpty(env.all_proxy)
        ?? toNonEmpty(env.GLOBAL_AGENT_HTTPS_PROXY)
        ?? toNonEmpty(env.GLOBAL_AGENT_HTTP_PROXY);
    return {
        configuredProxyUrl,
        transportProxyUrl,
    };
}

export async function ensureProxyEnvForLlmPath(env: EnvRecord = process.env): Promise<void> {
    const configuredProxyUrl = resolveConfiguredProxyUrl(env);
    if (!configuredProxyUrl) {
        if (runtimeState.activeBridge) {
            await closeBridge(runtimeState.activeBridge);
            runtimeState.activeBridge = null;
        }
        runtimeState.configuredProxyUrl = null;
        runtimeState.transportProxyUrl = null;
        delete env[INTERNAL_CONFIGURED_PROXY_ENV_KEY];
        delete env.COWORKANY_PROXY_CONFIGURED_URL;
        delete env.COWORKANY_PROXY_TRANSPORT_URL;
        return;
    }

    const transportProxyUrl = await resolveTransportProxyUrl(configuredProxyUrl);
    runtimeState.configuredProxyUrl = configuredProxyUrl;
    runtimeState.transportProxyUrl = transportProxyUrl;
    env[INTERNAL_CONFIGURED_PROXY_ENV_KEY] = configuredProxyUrl;
    delete env.COWORKANY_PROXY_CONFIGURED_URL;
    env.COWORKANY_PROXY_TRANSPORT_URL = transportProxyUrl;
    env.COWORKANY_PROXY_URL = transportProxyUrl;
    for (const key of TRANSPORT_PROXY_ENV_KEYS) {
        env[key] = transportProxyUrl;
    }
    env.NODE_USE_ENV_PROXY = '1';
    if (configuredProxyUrl !== transportProxyUrl) {
        console.info('[coworkany-proxy-bridge] activated', {
            source: configuredProxyUrl,
            transport: transportProxyUrl,
        });
    }
    if (env.COWORKANY_PROXY_DEBUG === '1') {
        const snapshot = Object.fromEntries(
            DEBUG_PROXY_ENV_KEYS.map((key) => [key, env[key] ?? null]),
        );
        const allProxyEntries = Object.fromEntries(
            Object.entries(env)
                .filter(([key]) => /proxy/i.test(key))
                .sort(([left], [right]) => left.localeCompare(right)),
        );
        console.info('[coworkany-proxy-env-debug]', snapshot);
        console.info('[coworkany-proxy-env-debug:all-proxy-keys]', allProxyEntries);
    }
}
