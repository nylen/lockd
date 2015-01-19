var lib   = require('./lib'),
    mocha = require('mocha'),
    must  = require('must');

var env = process.env;

if (env.LOCKD_SERVER) {

    describe('lockd server at ' + env.LOCKD_SERVER, function() {
        lib.runTestBatch(
            require('./batch/protocol').queueTests,
            {
                tcp      : env.LOCKD_SERVER,
                features : {
                    dump     : !env.LOCKD_DUMP_DISABLED,
                    registry : !env.LOCKD_REGISTRY_DISABLED
                }
            },
            false);
    });

} else {

    describe('LockdServer with all features enabled', function() {
        lib.runTestBatch(
            require('./batch/protocol').queueTests,
            {
                tcp      : 'localhost:6767',
                features : {
                    dump     : true,
                    registry : true
                }
            });
    });

    describe('LockdServer with dump disabled', function() {
        lib.runTestBatch(
            require('./batch/protocol').queueTests,
            {
                tcp      : 'localhost:6767',
                features : {
                    dump     : false,
                    registry : true
                }
            });
    });

    describe('LockdServer with registry disabled', function() {
        lib.runTestBatch(
            require('./batch/protocol').queueTests,
            {
                tcp      : 'localhost:6767',
                features : {
                    dump     : true,
                    registry : false
                }
            });
    });

    describe('LockdServer with dump and registry disabled', function() {
        lib.runTestBatch(
            require('./batch/protocol').queueTests,
            {
                tcp      : 'localhost:6767',
                features : {
                    dump     : false,
                    registry : false
                }
            });
    });
}
