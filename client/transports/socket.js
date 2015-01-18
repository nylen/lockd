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
    self.socket.pipe(split())
        .on('data', function(line) {
            if (line === '') {
                // We've discussed a future server/protocol enhancement to use
                // blank lines to terminate responses.  This would be really
                // useful for responses that return variable numbers of lines:
                // it would allow us to return before the read timeout elapses.
                // For forward compatibility with future server versions, then,
                // ignore all blank lines coming from the server.
                return;
            }
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
        });

    ['connect', 'error', 'close'].forEach(function(e) {
        self.socket.on(e, function() {
            if (e == 'close' && self.disconnecting) {
                return;
            }
            self.emit.apply(self, [e].concat([].slice.call(arguments)));
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

    var linesReceived = [],
        terminator    = null;

    if (typeof linesWanted == 'string') {
        // The string passed in here represents a terminator line.  Wait for
        // lines for a reasonable timeframe, and return immediately if the
        // terminator line is received because we know we will not receive any
        // more data from the server.  Receipt of this special line is not
        // required.
        terminator  = linesWanted;
        linesWanted = null;
    }

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
        // Wait for a reasonable timeframe, then return all lines received
        // during that time.  Return early if the caller specified a terminator
        // line and that line is received.

        function send() {
            clearTimeout(sendTimeout);
            self.reader = null;
            cb(null, linesReceived);
        }

        var sendTimeout = setTimeout(send, self.readTimeout);

        self.reader = {
            processLine : function(line) {
                linesReceived.push(line);
                if (line === terminator) {
                    send();
                }
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
