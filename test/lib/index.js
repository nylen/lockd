var async = require('async');

exports.address = function(client) {
    var addr = client.transport.socket.address();
    return addr.address + ':' + addr.port;
};

exports.testSequence = function() {
    var steps   = [].slice.call(arguments, 0, -1),
        done    = arguments[arguments.length - 1],
        asyncFn = async.each;

    // If all steps in this sequence involve the same client, then we can
    // launch them all in parallel as a test of the client library's
    // queuing/serialization functionality.
    for (var i = 0; i < steps.length - 1; i++) {
        if (steps[i][0] !== steps[i + 1][0]) {
            asyncFn = async.eachSeries;
            break;
        }
    }

    // To make it easier to see which step in a sequence is failing, store
    // the index of each step.
    for (var i = 0; i < steps.length; i++) {
        steps[i].push(i);
    }

    asyncFn(steps, function(step, nextStep) {
        var obj      = step[0],
            fn       = step[1],
            args     = (step[2] === null ? [] : [step[2]]),
            expected = step.slice(3, -1),
            index    = 'element ' + step[step.length - 1];
        obj[fn].apply(obj, args.concat(function() {
            var results = [].slice.call(arguments);
            for (var i = 0; i < results.length; i++) {
                if (results[i] instanceof Error) {
                    results[i] = results[i].message;
                }
            }
            [index].concat(results).must.eql([index].concat(expected));
            nextStep();
        }));
    }, function() {
        done();
    });
};
