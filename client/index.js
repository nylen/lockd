var events = require('events'),
    fs     = require('fs'),
    net    = require('net'),
    path   = require('path'),
    util   = require('util'),
    utils  = require('../lib/utils');

var transports = {};

fs.readdirSync(path.join(__dirname, 'transports')).forEach(function(fn) {
    var name = fn.replace(/\.js$/, '');
    if (fn != name) {
        transports[name] = require('./transports/' + name);
    }
});

function LockdClient(options) {
    if (!(this instanceof LockdClient)) {
        return new LockdClient(options);
    }

    var self = this;

    if (options._isLockdServer === true) {
        // This is an instance of LockdServer running in the same process.
        self.transport = new transports.memory(options);

    } else if (options.tcp) {
        // Connect to a lockd server listening on the TCP socket [host:]port
        // specified by options.socket
        var connectTo = utils.parseHostPort(options.tcp);
        if (options.timeout) {
            connectTo.timeout = options.timeout;
        }
        if (options.readTimeout) {
            connectTo.readTimeout = options.readTimeout;
        }
        self.transport = new transports.socket(connectTo);

    } else if (options.unix) {
        // Connect to a lockd server listening on the Unix socket filename
        // specified by options.unix
        var connectTo = { path : options.unix };
        if (options.timeout) {
            connectTo.timeout = options.timeout;
        }
        if (options.readTimeout) {
            connectTo.readTimeout = options.readTimeout;
        }
        self.transport = new transports.socket(connectTo);

    } else if (options.websocket) {
        // Connect to a lockd server listening on the websocket
        // ws://host[:port][/path] specified by options.websocket
        self.transport = new transports.websocket(options);

    } else {
        throw new Error('No valid lockd connection method given.');

    }

    // Handle events from the transport
    // TODO what happens if e.g. a socket connection is lost?
    ['connect', 'error', 'close'].forEach(function(e) {
        self.transport.on(e, function() {
            self.emit.apply(self, [e].concat([].slice.call(arguments)));
        });
    });
}

util.inherits(LockdClient, events.EventEmitter);

// Add a simple method to the client prototype which sends a message to the
// lockd server and expects a single line back in response.
function addSimpleMethod(name, msg, failureIsError) {
    LockdClient.prototype[name] = function(lockName, cb) {
        var self = this;

        self.transport.request(util.format(msg, lockName), 1, function(err, lines) {
            self._processResponseLine(cb, err, lines && lines[0], failureIsError);
        });
    };
}

// Get an exclusive lock.
addSimpleMethod('get', 'g %s\n');

// Release an exclusive lock.
addSimpleMethod('release', 'r %s\n');

// Inspect an exclusive lock.
addSimpleMethod('inspect', 'i %s\n', false);

// Dump exclusive locks (or a single exclusive lock).
LockdClient.prototype.dump = function(lockName, cb) {
    this._dump(lockName, cb, false);
};

// Get a shared lock.
addSimpleMethod('getShared', 'sg %s\n');

// Release a shared lock.
addSimpleMethod('releaseShared', 'sr %s\n');

// Inspect a shared lock.
addSimpleMethod('inspectShared', 'si %s\n', false);

// Dump shared locks (or a single shared lock).
LockdClient.prototype.dumpShared = function(lockName, cb) {
    this._dump(lockName, cb, true);
};

// Get stats information
LockdClient.prototype.getStats = function(cb) {
    var self = this;

    self.transport.request('q\n', 16, function(err, lines) {
        if (err) {
            return cb(err);
        }

        var stats = {};

        lines.forEach(function(line) {
            var pos = line.indexOf(': '),
                key = line.substring(0, pos),
                val = line.substring(pos + 2);
            stats[key] = +val;
        });

        cb(null, stats);
    });
};

// Disconnect from the server.
LockdClient.prototype.disconnect = function(cb) {
    var self = this;

    self.transport.disconnect(function(err) {
        cb(err);
    });
};

// Handle a simple response from the transport:  either an error or a single
// line.
LockdClient.prototype._processResponseLine = function(cb, err, line, failureIsError) {
    if (err) {
        return cb(err);
    }

    var arr = utils.splitAtFirstSpace(line, true);
    if (arr[0] || (typeof failureIsError != 'undefined' && !failureIsError)) {
        cb(null, arr[0], arr[1]);
    } else {
        cb(new Error(arr[1]));
    }
};

// Ask the server to dump exclusive or shared locks.
LockdClient.prototype._dump = function(lockName, cb, isShared) {
    var self = this;

    if (typeof lockName == 'function') {
        cb = lockName;
        lockName = null;
    }

    var msg = (isShared ? 'sd' : 'd')
            + (lockName ? ' ' + lockName : '')
            + '\n';

    self.transport.request(msg, '0 disabled', function(err, lines) {
        if (err) {
            return cb(err);
        }

        if (lines.length == 1 && lines[0] == '0 disabled') {
            return cb(new Error(
                'The dump feature of the lockd server is disabled.'));
        }

        var locks = {};

        lines.forEach(function(line) {
            var pos    = line.indexOf(': '),
                name   = line.substring(0, pos),
                holder = line.substring(pos + 2);

            if (isShared) {
                (locks[name] = locks[name] || []).push(holder);
            } else {
                locks[name] = holder;
            }
        });

        if (lockName) {
            cb(null, locks[lockName] || (isShared ? [] : null));
        } else {
            cb(null, locks);
        }
    });
};

module.exports = LockdClient;
