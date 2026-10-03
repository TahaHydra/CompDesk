import assert from 'node:assert/strict';
import dns from 'node:dns';
import net from 'node:net';
import { test } from 'node:test';
import { ipv4FallbackLookup } from './runtime-network.cjs';

test('recovers A records when the container resolver only returns AAAA for an unspecified family', async () => {
    const lookup = ipv4FallbackLookup((_host, options, callback) => {
        callback(null, options.family === 4 ? [{ address: '127.0.0.1', family: 4 }] : [{ address: '::1', family: 6 }]);
    });
    const addresses = await new Promise((resolve, reject) => lookup('test.invalid', { all: true }, (error, rows) => error ? reject(error) : resolve(rows)));
    assert.deepEqual(addresses, [{ address: '127.0.0.1', family: 4 }, { address: '::1', family: 6 }]);
});
test('keeps IPv6-only hosts usable when A lookup fails', async () => {
    const lookup = ipv4FallbackLookup((_host, options, callback) => {
        if (options.family === 4) callback(Object.assign(new Error('no A record'), { code: 'ENOTFOUND' }));
        else callback(null, [{ address: '::1', family: 6 }]);
    });
    const addresses = await new Promise((resolve, reject) => lookup('test.invalid', { all: true }, (error, rows) => error ? reject(error) : resolve(rows)));
    assert.deepEqual(addresses, [{ address: '::1', family: 6 }]);
});

test('prefers IPv4 while retaining address-family fallback', () => {
    assert.equal(dns.getDefaultResultOrder(), 'ipv4first');
    assert.equal(net.getDefaultAutoSelectFamily(), true);
});
test('connects to IPv4 when the first IPv6 address cannot connect', async () => {
    const server = net.createServer(socket => socket.end());
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        await new Promise((resolve, reject) => {
            const socket = net.connect({ host: 'test.invalid', port: server.address().port,
                lookup: (_host, options, callback) => callback(null, options.all ? [{ address: '::1', family: 6 }, { address: '127.0.0.1', family: 4 }] : '::1', 6),
            });
            socket.once('connect', () => { socket.destroy(); resolve(); });
            socket.once('error', reject);
        });
    } finally { await new Promise(resolve => server.close(resolve)); }
});
