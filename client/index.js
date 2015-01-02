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
        self.server = new transports.memory(options);

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
        self.server = new transports.socket(connectTo);

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
        self.server = new transports.socket(connectTo);

    } else if (options.websocket) {
        // Connect to a lockd server listening on the websocket
        // ws://host[:port][/path] specified by options.websocket
        self.server = new transports.websocket(options);

    } else {
        throw new Error('No valid lockd connection method given.');

    }

    ['connect', 'error', 'close'].forEach(function(e) {
        self.server.on(e, function() {
            self.emit.apply(self, [e].concat(arguments));
        });
    });
}

util.inherits(LockdClient, events.EventEmitter);

// Add a simple method to the client prototype which sends a message to the
// lockd server and expects a single line back in response.
function addSimpleMethod(name, msg, failureIsError) {
    LockdClient.prototype[name] = function(lockName, cb) {
        var self = this;

        self.server.request(util.format(msg, lockName), 1, function(err, lines) {
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
LockdClient.prototype.dump = function(lockName) {
    throw new Error('not implemented');
};

// Get a shared lock.
addSimpleMethod('getShared', 'sg %s\n');

// Release a shared lock.
addSimpleMethod('releaseShared', 'sr %s\n');

// Inspect a shared lock.
addSimpleMethod('inspectShared', 'si %s\n', false);

// Dump shared locks (or a single shared lock).
LockdClient.prototype.dumpShared = function(lockName) {
    throw new Error('not implemented');
};

LockdClient.prototype.disconnect = function(cb) {
    var self = this;

    self.server.disconnect(function(err) {
        cb(err);
    });
};

// Handle a simple response from the transport:  either an error or a single
// line.
LockdClient.prototype._processResponseLine = function(cb, err, line, failureIsError) {
    if (err) {
        cb(err);
        return;
    }

    var arr = utils.splitAtFirstSpace(line, true);
    if (arr[0] || (typeof failureIsError != 'undefined' && !failureIsError)) {
        cb(null, arr[0], arr[1]);
    } else {
        cb(new Error(arr[1]));
    }
};

module.exports = LockdClient;
