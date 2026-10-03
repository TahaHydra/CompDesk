/* eslint-disable @typescript-eslint/no-require-imports -- Node --require preloads must use CommonJS. */
// Prefer usable IPv4 on IPv4-only deployments while preserving IPv6 fallback.
// Apply before setup, Auth.js, Graph, and diagnostics create network clients.
const dns = require('node:dns');
const net = require('node:net');
dns.setDefaultResultOrder('ipv4first');
net.setDefaultAutoSelectFamily(true);

// Some container getaddrinfo implementations return only AAAA records for
// family=0 although an explicit family=4 query succeeds. Recover those A
// records rather than retrying an HTTP request (which could duplicate writes).
function ipv4FallbackLookup(originalLookup) {
    return function lookup(hostname, options, callback) {
        if (typeof options === 'function') { callback = options; options = {}; }
        if (typeof options === 'number') options = { family: options };
        options ||= {};
        if (options.family && options.family !== 0) return originalLookup(hostname, options, callback);
        return originalLookup(hostname, { ...options, all: true }, (error, addresses) => {
            if (error) return callback(error);
            const finish = rows => options.all ? callback(null, rows) : callback(null, rows[0].address, rows[0].family);
            if (!addresses.length || addresses.some(address => address.family === 4)) {
                if (!addresses.length) return callback(Object.assign(new Error('DNS returned no addresses'), { code: 'ENOTFOUND' }));
                return finish([...addresses].sort((a, b) => a.family - b.family));
            }
            return originalLookup(hostname, { ...options, family: 4, all: true }, (ipv4Error, ipv4) => {
                finish(ipv4Error ? addresses : [...ipv4, ...addresses]);
            });
        });
    };
}
exports.ipv4FallbackLookup = ipv4FallbackLookup;
dns.lookup = ipv4FallbackLookup(dns.lookup.bind(dns));
