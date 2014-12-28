// Parse a string in the format 'host:port' or just 'port'.
exports.parseHostPort = function(str) {
    var match = str.match(/^(([\w-.]+):)?(\d+)$/);
    if (match) {
        // 0 : whole string
        // 1 : host: (may be undefined)
        // 2 : host  (may be undefined)
        // 3 : port
        match = {
            host : match[2],
            port : +match[3]
        };
        if (!match.port) {
            throw new Error('Port 0 is not valid.');
        }
        return match;
    } else {
        throw new Error('Invalid [host:]port string: ' + str);
    }
};

// Split a string into two pieces at the first space, optionally parsing the
// first piece as a number.
exports.splitAtFirstSpace = function(msg, firstPartIsNumber) {
    var i = msg.indexOf(' '),
        val;

    if (i >= 0) {
        val = msg.substring(0, i);
        msg = msg.substring(i + 1);
    } else {
        val = msg;
        msg = null;
    }
    if (firstPartIsNumber) {
        val = +val;
    }

    return [val, msg];
};
