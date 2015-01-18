var events = require('events'),
    net    = require('net'),
    split  = require('split'),
    util   = require('util'),
    utils  = require('../lib/utils');

function LockdServer(options) {
    if (!(this instanceof LockdServer)) {
        return new LockdServer(options);
    }

    var self = this;

    self.transports = [];

    if (options.tcp) {
        var listenOn = utils.parseHostPort(options.tcp),
            server   = net.createServer();
        server.on('connection', function(c) {
            self.stats.connections++;
            var client = c.remoteAddress + ':' + c.remotePort;
            c.pipe(split())
                .on('data', function(line) {
                    self.receive(client, line, function(response) {
                        c.write(response);
                    });
                })
                .on('end', function() {
                    self.disconnect(client);
                });
        });
        server.listen(listenOn.port, listenOn.host);
        server.on('error', function() {
            self.emit.apply(self, ['error'].concat([].slice.call(arguments)));
        });
        self.transports.push(server);
    }

    self.features = {
        registry : true,
        dump     : true
    };
    for (var f in self.features) {
        if (options.features && typeof options.features[f] != 'undefined') {
            self.features[f] = options.features[f];
        }
    }

    self.exclusiveLocks = {};
    self.sharedLocks    = {};
    self.registry       = {};

    self.stats = {
        command_d        : 0,
        command_sd       : 0,
        command_i        : 0,
        command_si       : 0,
        command_g        : 0,
        command_sg       : 0,
        command_r        : 0,
        command_sr       : 0,
        command_q        : 0,
        command_dump     : 0,
        connections      : 0,
        locks            : 0,
        shared_locks     : 0,
        orphans          : 0,
        shared_orphans   : 0,
        invalid_commands : 0
    };
};

util.inherits(LockdServer, events.EventEmitter);

LockdServer.prototype._isLockdServer = true;

LockdServer.prototype.receive = function(client, line, reply) {
    var self = this;

    var arr = utils.splitAtFirstSpace(line),
        cmd = arr[0],
        arg = arr[1] || '',
        isValid = true,
        response;

    switch (cmd) {
        case 'g':
            response = self.command_g(client, arg);
            break;
        case 'r':
            response = self.command_r(client, arg);
            break;
        case 'i':
            response = self.command_i(client, arg);
            break;
        case 'd':
            response = self.command_d(client, arg);
            break;
        case 'sg':
            response = self.command_sg(client, arg);
            break;
        case 'sr':
            response = self.command_sr(client, arg);
            break;
        case 'si':
            response = self.command_si(client, arg);
            break;
        case 'sd':
            response = self.command_sd(client, arg);
            break;
        case 'dump':
            response = self.command_dump(client, arg);
            break;
        case 'me':
            response = self.command_me(client, arg);
            break;
        case 'iam':
            response = self.command_iam(client, arg);
            break;
        case 'who':
            response = self.command_who(client, arg);
            break;
        case 'q':
            response = self.command_q(client, arg);
            break;
        default:
            isValid = false;
            break;
    }

    if (isValid) {
        self.bumpStat('command_' + cmd);
    } else {
        self.stats.invalid_commands++;
        return;
    }

    if (response === null) {
        // no reply
        return;
    }
    if (util.isArray(response)) {
        if (!response.length) {
            // no reply
            return;
        }
        response = response.join('\n');
    }
    reply(response + '\n');
};

// Get exclusive lock
LockdServer.prototype.command_g = function(client, lock) {
    var self = this;

    if (self.exclusiveLocks[lock] && self.exclusiveLocks[lock] !== client) {
        return '0 Lock Get Failure: ' + lock;
    } else {
        self.exclusiveLocks[lock] = client;
        return '1 Lock Get Success: ' + lock;
    }
};

// Release exclusive lock
LockdServer.prototype.command_r = function(client, lock) {
    var self = this;

    if (self.exclusiveLocks[lock] === client) {
        delete self.exclusiveLocks[lock];
        return '1 Lock Release Success: ' + lock;
    } else {
        return '0 Lock Release Failure: ' + lock;
    }
};

// Inspect exclusive lock
LockdServer.prototype.command_i = function(client, lock) {
    var self = this;

    if (self.exclusiveLocks[lock]) {
        return '1 Lock Is Locked: ' + lock;
    } else {
        return '0 Lock Not Locked: ' + lock;
    }
};

// Dump exclusive lock(s)
LockdServer.prototype.command_d = function(client, lock) {
    var self = this;

    if (!self.features.dump) {
        return '0 disabled';
    }
    if (lock) {
        if (self.exclusiveLocks[lock]) {
            return lock + ': ' + self.clientName(self.exclusiveLocks[lock]);
        } else {
            // TODO ??
            return null;
        }
    } else {
        return Object.keys(self.exclusiveLocks).map(function(lock) {
            return lock + ': ' + self.clientName(self.exclusiveLocks[lock]);
        });
    }
};

// Get shared lock
LockdServer.prototype.command_sg = function(client, lock) {
    var self = this;

    if (!self.sharedLocks[lock]) {
        self.sharedLocks[lock] = [];
    }
    if (self.sharedLocks[lock].indexOf(client) == -1) {
        self.sharedLocks[lock].push(client);
    }
    return util.format(
        '%d Shared Lock Get Success: %s',
        self.sharedLocks[lock].length, lock);
};

// Release shared lock
LockdServer.prototype.command_sr = function(client, lock) {
    var self = this;

    var beforeRelease = (self.sharedLocks[lock] || []),
        afterRelease  = beforeRelease.filter(function(holder) {
            return (holder !== client);
        });
    if (beforeRelease.length == afterRelease.length) {
        return '0 Shared Lock Release Failure: ' + lock;
    }
    if (afterRelease.length) {
        self.sharedLocks[lock] = afterRelease;
    } else {
        delete self.sharedLocks[lock];
    }
    return '1 Shared Lock Release Success: ' + lock;
};

// Inspect shared lock
LockdServer.prototype.command_si = function(client, lock) {
    var self = this;

    if (!self.sharedLocks[lock] || self.sharedLocks[lock].indexOf(client) == -1) {
        return '0 Shared Lock Not Locked: ' + lock;
    }
    return util.format(
        '%d Shared Lock Is Locked: %s',
        self.sharedLocks[lock].length, lock);
};

// Dump shared lock(s)
LockdServer.prototype.command_sd = function(client, lock) {
    var self = this;

    if (!self.features.dump) {
        return '0 disabled';
    }
    if (lock) {
        if (self.sharedLocks[lock]) {
            return self.sharedLocks[lock].map(function(holder) {
                return lock + ': ' + self.clientName(holder);
            });
        } else {
            // TODO ??
            return null;
        }
    } else {
        var lines = [];
        for (var lock in self.sharedLocks) {
            self.sharedLocks[lock].forEach(function(holder) {
                lines.push(lock + ': ' + self.clientName(holder));
            });
        }
        return lines;
    }
};

// Dump the exclusive or shared locks data structure
LockdServer.prototype.command_dump = function(client, arg) {
    var self = this;

    if (!self.features.dump) {
        return '0 disabled';
    } else if (arg == 'shared') {
        return JSON.stringify(self.sharedLocks);
    } else {
        return JSON.stringify(self.exclusiveLocks);
    }
};

// Get connection name
LockdServer.prototype.command_me = function(client, arg) {
    var self = this;

    return '1 ' + client + ' ' + self.clientName(client);
};

// Set connection name
LockdServer.prototype.command_iam = function(client, newName) {
    var self = this;

    if (!self.features.registry) {
        return '0 disabled';
    } else {
        self.registry[client] = newName;
        return '1 ok';
    }
};

// List client names
LockdServer.prototype.command_who = function(client, name) {
    var self = this;

    if (!self.features.dump || !self.features.registry) {
        return '0 disabled';
    } else if (name) {
        var owner = null;
        for (var client in self.registry) {
            if (self.registry[client] == name) {
                owner = client;
            }
        }
        if (owner) {
            return owner + ': ' + self.registry[owner];
        } else {
            // no reply
            return null;
        }
    } else {
        return Object.keys(self.registry).map(function(client) {
            return client + ': ' + self.registry[client];
        });
    }
};

// Get stats information
LockdServer.prototype.command_q = function(client, arg) {
    var self = this;

    self.stats.locks        = Object.keys(self.exclusiveLocks).length;
    self.stats.shared_locks = Object.keys(self.sharedLocks).length;

    return Object.keys(self.stats).sort().map(function(stat) {
        return stat + ': ' + self.stats[stat];
    });
};

LockdServer.prototype.disconnect = function(client) {
    var self = this;

    // Release any exclusive locks held by this client
    for (var lock in self.exclusiveLocks) {
        if (self.exclusiveLocks[lock] === client) {
            delete self.exclusiveLocks[lock];
            self.stats.orphans++;
        }
    }

    // Release any shared locks held by this client
    for (var lock in self.sharedLocks) {
        var beforeRelease = (this.sharedLocks[lock] || []),
            afterRelease  = beforeRelease.filter(function(holder) {
                return (holder !== client);
            });
        if (beforeRelease.length != afterRelease.length) {
            if (afterRelease.length) {
                this.sharedLocks[lock] = afterRelease;
            } else {
                delete this.sharedLocks[lock];
            }
            self.stats.shared_orphans++;
        }
    }

    delete self.registry[client];
    self.stats.connections--;
};

LockdServer.prototype.clientName = function(client) {
    return this.registry[client] || client;
};

LockdServer.prototype.bumpStat = function(name) {
    // Stats for registry commands don't exist on server startup.
    this.stats[name] = (this.stats[name] || 0) + 1;
};

module.exports = LockdServer;
