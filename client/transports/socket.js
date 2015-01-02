var async  = require('async'),
    events = require('events'),
    net    = require('net'),
    split  = require('split'),
    util   = require('util');

function SocketTransport(options) {
    if (!(this instanceof SocketTransport)) {
        return new SocketTransport(options);
    }

    var self = this;

    self.tasks = async.queue(function(task, done) {
        task(done);
    }, 1);
    self.tasks.pause();

    self.reader = null;

    self.socket = net.connect(options, function() {
        self.tasks.resume();
    });

    // Listen for lines arriving from the server and process them in order
    self.socket.pipe(split(function(line) {
        var reader = self.reader;
        if (!reader) {
            self.emit('error', new Error(
                'Unexpected data received from lockd server: ' + line));
            return;
        }
        if (reader.linesWanted) {
            if (reader.linesWanted == 1) {
                self.reader = null;
            } else {
                reader.linesWanted--;
            }
        }
        reader.processLine(line);
    }));

    ['connect', 'error', 'close'].forEach(function(e) {
        self.socket.on(e, function() {
            if (e == 'close' && self.disconnecting) {
                return;
            }
            self.emit.apply(self, [e].concat(arguments));
        });
    });

    self.readTimeout = options.readTimeout || 100;
}

util.inherits(SocketTransport, events.EventEmitter);

SocketTransport.prototype.request = function(msg, linesWanted, cb) {
    var self = this;

    if (typeof cb == 'undefined') {
        cb = linesWanted;
        linesWanted = null;
    }

    self.tasks.push(function(done) {
        self.socket.write(msg);
        self.read(linesWanted, function(err, lines) {
            done();
            // TODO without process.nextTick here, if the callback throws an
            // error, no further lines are read from the socket.  Not sure why.
            // This is part of the fix, and the other part is to always call
            // the read callback after making any needed state changes.
            process.nextTick(function() {
                cb(err, lines);
            });
        });
    });
};

SocketTransport.prototype.read = function(linesWanted, cb) {
    var self = this;

    var linesReceived = [];

    if (linesWanted === 0) {
        // Nothing to do, call the callback immediately.  No need to use
        // process.nextTick() because async.queue never calls synchronously.
        // http://blog.izs.me/post/59142742143/designing-apis-for-asynchrony
        cb(null, linesReceived);

    } else if (linesWanted > 0) {
        // Wait for the requested number of lines.  If not received in a
        // reasonable timeframe, return an error.
        var linesNotReceived = setTimeout(function() {
            self.reader = null;
            cb(new Error(util.format(
                'Expected %d line%s but got %d',
                linesWanted, (linesWanted == 1 ? '' : 's'),
                linesReceived.length)));
        }, self.readTimeout);

        self.reader = {
            linesWanted : linesWanted,
            processLine : function(line) {
                linesReceived.push(line);
                if (linesReceived.length == linesWanted) {
                    clearTimeout(linesNotReceived);
                    cb(null, linesReceived);
                }
            }
        };

    } else {
        // Wait for a reasonable timeframe, then return all lines received during that time.
        setTimeout(function() {
            self.reader = null;
            cb(null, linesReceived);
        }, self.readTimeout);

        self.reader = {
            processLine : function(line) {
                linesReceived.push(line);
            }
        };

    }
};

SocketTransport.prototype.disconnect = function(cb) {
    var self = this;

    self.disconnecting = true;
    self.socket.end();
    self.socket.destroy();
    self.socket.once('close', function() {
        self.disconnecting = false;
        cb(null);
    });
};

module.exports = SocketTransport;
