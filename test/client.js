var async  = require('async'),
    domain = require('domain'),
    lockd  = require('../index'),
    mocha  = require('mocha'),
    must   = require('must'),
    net    = require('net'),
    split  = require('split');

describe('LockdClient', function() {
    if (!process.env.LOCKD_SERVER) {
        throw new Error('Run the tests with environment variable:  LOCKD_SERVER=host:port');
    }

    var dumpDisabled     = !!process.env.LOCKD_DUMP_DISABLED,
        registryDisabled = !!process.env.LOCKD_REGISTRY_DISABLED;

    function newClient() {
        return lockd.connect({
            tcp : process.env.LOCKD_SERVER
        });
    }

    var client1,
        client2,
        client3;

    beforeEach(function(done) {
        function setClients() {
            client1 = newClient();
            client2 = newClient();
            client3 = newClient();
            // TODO add a timeout here?  I got this failure once:
            //   LockdClient allows a client to get a lock it already holds:
            //     + expected - actual
            //      [
            //       "element 0"
            //     +  null
            //     +  1
            //     +  "Lock Get Success: asdf"
            //     -  "Lock Get Failure: asdf"
            //      ]
            // Probably because the server hadn't registered the client
            // disconnection yet.  Another alternative would be to add a
            // graceful disconnect feature to the protocol.
            done();
        }

        if (client1) {
            async.each([
                client1,
                client2,
                client3
            ], function(client, next) {
                client.disconnect(next);
            }, setClients);
        } else {
            setClients();
        }
    });

    function address(client) {
        var addr = client.transport.socket.address();
        return addr.address + ':' + addr.port;
    }

    function waitForConnections(cb) {
        var calls = 0;
        function check() {
            if (++calls == 3) {
                cb();
            }
        }

        client1.on('connect', check);
        client2.on('connect', check);
        client3.on('connect', check);
    }

    function testSequence() {
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
    }

    it('queues requests and gets exclusive locks', function(done) {
        var client    = newClient(),
            connected = false;

        client.get('asdf', function(err, ok, msg) {
            must(err).not.exist();
            connected.must.equal(true);
            ok.must.equal(1);
            msg.must.equal('Lock Get Success: asdf');
            client.disconnect(function() {
                done();
            });
        });

        client.on('connect', function() {
            connected = true;
        });
    });

    it('does not break if callbacks throw errors', function(done) {
        var d = domain.create();
        d.on('error', function(err) {
            err.message.must.equal('test');
            d.exit();
            done();
        });
        d.enter();
        client1.get('error', function(err, ok, msg) {
            throw new Error('test');
        });
    });

    it('allows other clients to acquire orphaned locks', function(done) {
        testSequence(
            [client1, 'get', 'asdf', null, 1, 'Lock Get Success: asdf'],
            done);
    });

    it('allows a client to get multiple locks', function(done) {
        testSequence(
            [client1, 'get', 'asdf' , null, 1, 'Lock Get Success: asdf'],
            [client1, 'get', 'asdf2', null, 1, 'Lock Get Success: asdf2'],
            done);
    });

    it('allows a client to get a lock it already holds', function(done) {
        testSequence(
            [client1, 'get', 'asdf', null, 1, 'Lock Get Success: asdf'],
            [client1, 'get', 'asdf', null, 1, 'Lock Get Success: asdf'],
            done);
    });

    it('forbids a client to get a lock another client already holds', function(done) {
        testSequence(
            [client1, 'get', 'asdf', null, 1, 'Lock Get Success: asdf'],
            [client2, 'get', 'asdf', 'Lock Get Failure: asdf'],
            done);
    });

    it('serializes concurrent requests from a single client', function(done) {
        testSequence(
            [client1, 'inspect', 'asdf1', null, 0, 'Lock Not Locked: asdf1'],
            [client1, 'inspect', 'asdf2', null, 0, 'Lock Not Locked: asdf2'],
            [client1, 'inspect', 'asdf3', null, 0, 'Lock Not Locked: asdf3'],
            [client1, 'get'    , 'asdf1', null, 1, 'Lock Get Success: asdf1'],
            [client1, 'inspect', 'asdf1', null, 1, 'Lock Is Locked: asdf1'],
            [client1, 'inspect', 'asdf2', null, 0, 'Lock Not Locked: asdf2'],
            [client1, 'inspect', 'asdf3', null, 0, 'Lock Not Locked: asdf3'],
            [client1, 'get'    , 'asdf2', null, 1, 'Lock Get Success: asdf2'],
            [client1, 'inspect', 'asdf1', null, 1, 'Lock Is Locked: asdf1'],
            [client1, 'inspect', 'asdf2', null, 1, 'Lock Is Locked: asdf2'],
            [client1, 'inspect', 'asdf3', null, 0, 'Lock Not Locked: asdf3'],
            [client1, 'release', 'asdf2', null, 1, 'Lock Release Success: asdf2'],
            [client1, 'get'    , 'asdf3', null, 1, 'Lock Get Success: asdf3'],
            [client1, 'inspect', 'asdf1', null, 1, 'Lock Is Locked: asdf1'],
            [client1, 'inspect', 'asdf2', null, 0, 'Lock Not Locked: asdf2'],
            [client1, 'inspect', 'asdf3', null, 1, 'Lock Is Locked: asdf3'],
            [client1, 'release', 'asdf1', null, 1, 'Lock Release Success: asdf1'],
            [client1, 'release', 'asdf2', 'Lock Release Failure: asdf2'],
            [client1, 'release', 'asdf3', null, 1, 'Lock Release Success: asdf3'],
            [client1, 'inspect', 'asdf1', null, 0, 'Lock Not Locked: asdf1'],
            [client1, 'inspect', 'asdf2', null, 0, 'Lock Not Locked: asdf2'],
            [client1, 'inspect', 'asdf3', null, 0, 'Lock Not Locked: asdf3'],
            done);
    });

    it('allows inspecting and releasing locks with multiple clients', function(done) {
        testSequence(
            [client1, 'get'    , 'asdf', null, 1, 'Lock Get Success: asdf'],
            [client1, 'inspect', 'asdf', null, 1, 'Lock Is Locked: asdf'],
            [client2, 'inspect', 'asdf', null, 1, 'Lock Is Locked: asdf'],
            [client2, 'release', 'asdf', 'Lock Release Failure: asdf'],
            [client1, 'release', 'asdf', null, 1, 'Lock Release Success: asdf'],
            [client1, 'inspect', 'asdf', null, 0, 'Lock Not Locked: asdf'],
            [client2, 'inspect', 'asdf', null, 0, 'Lock Not Locked: asdf'],
            done);
    });

    it('allows getting, inspecting, and releasing the empty lock', function(done) {
        testSequence(
            [client1, 'get'    , '', null, 1, 'Lock Get Success: '],
            [client1, 'inspect', '', null, 1, 'Lock Is Locked: '],
            [client2, 'inspect', '', null, 1, 'Lock Is Locked: '],
            [client2, 'release', '', 'Lock Release Failure: '],
            [client1, 'release', '', null, 1, 'Lock Release Success: '],
            [client1, 'inspect', '', null, 0, 'Lock Not Locked: '],
            [client2, 'inspect', '', null, 0, 'Lock Not Locked: '],
            done);
    });

    it('allows inspecting, getting, and releasing shared locks', function(done) {
        testSequence(
            [client1, 'inspectShared', 'asdf', null, 0, 'Shared Lock Not Locked: asdf'],
            [client1, 'getShared'    , 'asdf', null, 1, 'Shared Lock Get Success: asdf'],
            [client1, 'getShared'    , 'asdf', null, 1, 'Shared Lock Get Success: asdf'],
            [client2, 'getShared'    , 'asdf', null, 2, 'Shared Lock Get Success: asdf'],
            [client1, 'getShared'    , 'asdf', null, 2, 'Shared Lock Get Success: asdf'],
            [client3, 'getShared'    , 'asdf', null, 3, 'Shared Lock Get Success: asdf'],
            [client3, 'inspectShared', 'asdf', null, 3, 'Shared Lock Is Locked: asdf'],
            [client2, 'releaseShared', 'asdf', null, 1, 'Shared Lock Release Success: asdf'],
            [client2, 'releaseShared', 'asdf', 'Shared Lock Release Failure: asdf'],
            [client1, 'releaseShared', 'asdf', null, 1, 'Shared Lock Release Success: asdf'],
            [client3, 'inspectShared', 'asdf', null, 1, 'Shared Lock Is Locked: asdf'],
            [client3, 'releaseShared', 'asdf', null, 1, 'Shared Lock Release Success: asdf'],
            [client3, 'inspectShared', 'asdf', null, 0, 'Shared Lock Not Locked: asdf'],
            done);
    });

    it('allows inspecting, getting, and setting the empty shared lock', function(done) {
        testSequence(
            [client1, 'inspectShared', '', null, 0, 'Shared Lock Not Locked: '],
            [client1, 'getShared'    , '', null, 1, 'Shared Lock Get Success: '],
            [client1, 'getShared'    , '', null, 1, 'Shared Lock Get Success: '],
            [client2, 'getShared'    , '', null, 2, 'Shared Lock Get Success: '],
            [client1, 'getShared'    , '', null, 2, 'Shared Lock Get Success: '],
            [client3, 'getShared'    , '', null, 3, 'Shared Lock Get Success: '],
            [client3, 'inspectShared', '', null, 3, 'Shared Lock Is Locked: '],
            [client2, 'releaseShared', '', null, 1, 'Shared Lock Release Success: '],
            [client2, 'releaseShared', '', 'Shared Lock Release Failure: '],
            [client1, 'releaseShared', '', null, 1, 'Shared Lock Release Success: '],
            [client3, 'inspectShared', '', null, 1, 'Shared Lock Is Locked: '],
            [client3, 'releaseShared', '', null, 1, 'Shared Lock Release Success: '],
            [client3, 'inspectShared', '', null, 0, 'Shared Lock Not Locked: '],
            done);
    });

    if (dumpDisabled) {
        it('forbids dumping exclusive locks', function(done) {
            var start = +new Date;
            testSequence(
                [client1, 'get' , 'asdf1', null, 1, 'Lock Get Success: asdf1'],
                [client1, 'dump', null   , 'The dump feature of the lockd server is disabled.'],
                [client2, 'dump', 'asdf1', 'The dump feature of the lockd server is disabled.'],
                function() {
                    // Test the client library functionality to return before
                    // the read timeout if a special terminator line is
                    // received.  The default read timeout is 100ms.
                    var end = +new Date;
                    (end - start).must.be.below(100);
                    done();
                });
        });

        it('forbids dumping shared locks', function(done) {
            var start = +new Date;
            testSequence(
                [client1, 'getShared' , 'asdf1', null, 1, 'Shared Lock Get Success: asdf1'],
                [client1, 'dumpShared', null   , 'The dump feature of the lockd server is disabled.'],
                [client2, 'dumpShared', 'asdf1', 'The dump feature of the lockd server is disabled.'],
                function() {
                    var end = +new Date;
                    (end - start).must.be.below(100);
                    done();
                });
        });
    }

    if (!dumpDisabled) {
        it('allows dumping exclusive locks', function(done) {
            // Need to wait for clients to connect so that we can get their socket
            // addresses.
            waitForConnections(function() {
                testSequence(
                    [client1, 'get' , 'asdf1', null, 1, 'Lock Get Success: asdf1'],
                    [client2, 'get' , 'asdf2', null, 1, 'Lock Get Success: asdf2'],
                    [client1, 'dump', null   , null, { 'asdf1' : address(client1), 'asdf2' : address(client2) }],
                    [client2, 'dump', null   , null, { 'asdf1' : address(client1), 'asdf2' : address(client2) }],
                    // TODO it's currently not possible to dump only the empty lock
                    [client2, 'dump', ''     , null, { 'asdf1' : address(client1), 'asdf2' : address(client2) }],
                    [client2, 'get' , ''     , null, 1, 'Lock Get Success: '],
                    [client2, 'dump', ''     , null, { 'asdf1' : address(client1), 'asdf2' : address(client2), '' : address(client2) }],
                    [client1, 'dump', 'asdf2', null, address(client2)],
                    [client1, 'dump', 'asdf3', null, null],
                    done);
            });
        });

        it('returns null when dumping an exclusive lock nobody is holding', function(done) {
            testSequence(
                [client1, 'dump', 'empty', null, null],
                done);
        });

        it('allows dumping shared locks', function(done) {
            waitForConnections(function() {
                testSequence(
                    [client1, 'getShared' , 'asdf1', null, 1, 'Shared Lock Get Success: asdf1'],
                    [client1, 'getShared' , 'asdf2', null, 1, 'Shared Lock Get Success: asdf2'],
                    [client2, 'getShared' , 'asdf2', null, 2, 'Shared Lock Get Success: asdf2'],
                    [client1, 'dumpShared', null   , null, { 'asdf1' : [address(client1)], 'asdf2' : [address(client1), address(client2)] }],
                    [client2, 'dumpShared', null   , null, { 'asdf1' : [address(client1)], 'asdf2' : [address(client1), address(client2)] }],
                    // TODO it's currently not possible to dump only the empty lock
                    [client2, 'dumpShared', ''     , null, { 'asdf1' : [address(client1)], 'asdf2' : [address(client1), address(client2)] }],
                    [client2, 'getShared' , ''     , null, 1, 'Shared Lock Get Success: '],
                    [client2, 'dumpShared', ''     , null, { 'asdf1' : [address(client1)], 'asdf2' : [address(client1), address(client2)], '' : [address(client2)] }],
                    [client1, 'dumpShared', 'asdf2', null, [address(client1), address(client2)]],
                    [client1, 'dumpShared', 'asdf3', null, []],
                    done);
            });
        });

        it('returns [] when dumping a shared lock nobody is holding', function(done) {
            testSequence(
                [client1, 'dumpShared', 'empty', null, []],
                done);
        });
    }

    if (registryDisabled) {
        it('allows getting but not setting connection names', function(done) {
            waitForConnections(function() {
                testSequence(
                    // According to the docs, I think this is what the
                    // responses should be, but glockd doesn't respond to
                    // registry commands at all if the registry feature is
                    // disabled (see main.go:98)
                    // [client1, 'getName', null, null, address(client1), address(client1)],
                    // [client1, 'setName', 'c1', 'The registry feature of the lockd server is disabled.'],
                    // [client1, 'getName', null, null, address(client1), address(client1)],
                    [client1, 'getName', null, 'Expected 1 line but got 0'],
                    [client1, 'setName', 'c1', 'Expected 1 line but got 0'],
                    [client1, 'getName', null, 'Expected 1 line but got 0'],
                    done);
            });
        });
    }

    if (!registryDisabled) {
        it('allows getting and setting connection names', function(done) {
            waitForConnections(function() {
                testSequence(
                    [client1, 'getName', null, null, address(client1), address(client1)],
                    [client1, 'setName', 'c1', null, 1, 'ok'],
                    [client1, 'getName', null, null, address(client1), 'c1'],
                    [client2, 'getName', null, null, address(client2), address(client2)],
                    done);
            });
        });

        it('allows resetting the connection name to the default', function(done) {
            waitForConnections(function() {
                testSequence(
                    [client1, 'getName', null, null, address(client1), address(client1)],
                    [client1, 'setName', 'c1', null, 1, 'ok'],
                    [client1, 'getName', null, null, address(client1), 'c1'],
                    [client1, 'setName', ''  , null, 1, 'ok'],
                    [client1, 'getName', null, null, address(client1), address(client1)],
                    [client2, 'getName', null, null, address(client2), address(client2)],
                    done);
            });
        });

        // TODO don't allow this
        it('allows multiple clients to have the same name', function(done) {
            waitForConnections(function() {
                testSequence(
                    [client1, 'getName', null, null, address(client1), address(client1)],
                    [client1, 'setName', 'c1', null, 1, 'ok'],
                    [client1, 'getName', null, null, address(client1), 'c1'],
                    [client2, 'getName', null, null, address(client2), address(client2)],
                    [client2, 'setName', 'c1', null, 1, 'ok'],
                    [client1, 'getName', null, null, address(client1), 'c1'],
                    [client2, 'getName', null, null, address(client2), 'c1'],
                    done);
            });
        });
    }

    if (!registryDisabled && dumpDisabled) {
        it('forbids viewing the names of other clients', function(done) {
            waitForConnections(function() {
                testSequence(
                    [client1, 'getName', null, null, address(client1), address(client1)],
                    [client1, 'setName', 'c1', null, 1, 'ok'],
                    [client1, 'getName', null, null, address(client1), 'c1'],
                    [client2, 'getName', null, null, address(client2), address(client2)],
                    [client1, 'get' , 'asdf1', null, 1, 'Lock Get Success: asdf1'],
                    [client1, 'dump', null   , 'The dump feature of the lockd server is disabled.'],
                    done);
            });
        });
    }

    if (!registryDisabled && !dumpDisabled) {
        it('uses client names in dump output', function(done) {
            waitForConnections(function() {
                testSequence(
                    [client1, 'getName', null, null, address(client1), address(client1)],
                    [client1, 'setName', 'c1', null, 1, 'ok'],
                    [client1, 'getName', null, null, address(client1), 'c1'],
                    [client2, 'getName', null, null, address(client2), address(client2)],
                    [client1, 'get' , 'asdf1', null, 1, 'Lock Get Success: asdf1'],
                    [client1, 'dump', null   , null, { 'asdf1' : 'c1' }],
                    [client2, 'dump', null   , null, { 'asdf1' : 'c1' }],
                    done);
            });
        });

        it('uses client names in dumpShared output', function(done) {
            waitForConnections(function() {
                testSequence(
                    [client1, 'getName', null, null, address(client1), address(client1)],
                    [client1, 'setName', 'c1', null, 1, 'ok'],
                    [client1, 'getName', null, null, address(client1), 'c1'],
                    [client2, 'getName', null, null, address(client2), address(client2)],
                    [client1, 'getShared' , 'asdf1', null, 1, 'Shared Lock Get Success: asdf1'],
                    [client1, 'dumpShared', null   , null, { 'asdf1' : ['c1'] }],
                    [client2, 'dumpShared', null   , null, { 'asdf1' : ['c1'] }],
                    done);
            });
        });

        it('allows listing client names', function(done) {
            waitForConnections(function() {
                testSequence(
                    [client1, 'setName', 'c1', null, 1, 'ok'],
                    [client2, 'setName', 'c2', null, 1, 'ok'],
                    [client2, 'listClients', 'c1', null, address(client1)],
                    [client3, 'listClients', null, null, { 'c1' : address(client1), 'c2' : address(client2) }],
                    done);
            });
        });

        // TODO don't allow this
        it('allows multiple clients to have the same name', function(done) {
            waitForConnections(function() {
                testSequence(
                    [client1, 'getName', null, null, address(client1), address(client1)],
                    [client1, 'setName', 'c1', null, 1, 'ok'],
                    [client1, 'getName', null, null, address(client1), 'c1'],
                    [client2, 'getName', null, null, address(client2), address(client2)],
                    [client2, 'setName', 'c1', null, 1, 'ok'],
                    [client1, 'getName', null, null, address(client1), 'c1'],
                    [client2, 'getName', null, null, address(client2), 'c1'],
                    // It looks like the last client to request a name will
                    // have it, as far as 'who\n' / listClients() is concerned.
                    [client2, 'listClients', 'c1', null, address(client2)],
                    [client3, 'listClients', null, null, { 'c1' : address(client2) }],
                    done);
            });
        });
    }

    if (registryDisabled || dumpDisabled) {
        it('forbids listing client names', function(done) {
            testSequence(
                [client1, 'listClients', null, 'The dump and/or registry features of the lockd server are disabled.'],
                [client1, 'listClients', 'c1', 'The dump and/or registry features of the lockd server are disabled.'],
                done);
        });
    }

    it('allows getting connection stats', function(done) {
        // TODO this test also covers a few other miscellaneous things that
        // should probably be broken out separately: 'dump\n', 'dump shared\n',
        // and sending invalid commands.
        var statsChangesExpected = {
                command_d        : 2,
                command_dump     : 2,
                command_g        : 4,
                command_i        : 3,
                command_iam      : (registryDisabled ? 0 : 1),
                command_me       : (registryDisabled ? 1 : 1),
                command_q        : 1,
                command_r        : 1,
                command_sd       : 1,
                command_sg       : 4,
                command_si       : 1,
                command_sr       : 1,
                command_who      : (registryDisabled ? 0 : 1),
                connections      : 2,
                invalid_commands : 1,
                locks            : 2,
                orphans          : 1,
                shared_locks     : 2,
                shared_orphans   : 1,
            },
            statsKeys = Object.keys(statsChangesExpected),
            stats1,
            stats2,
            statsChangesActual = {};

        async.series([
            waitForConnections,

            function(next) {
                client1.getStats(function(err, stats) {
                    must(err).not.exist();
                    Object.keys(stats).must.eql(Object.keys(stats).sort());
                    stats.command_iam = stats.command_iam || 0;
                    stats.command_me  = stats.command_me  || 0;
                    stats.command_who = stats.command_who || 0;
                    stats1 = stats;
                    Object.keys(stats).must.be.a.permutationOf(statsKeys);
                    statsKeys.forEach(function(k) {
                        stats[k].must.be.a.number();
                    });
                    // Bug in glockd: if launched with -registry=false, then
                    // after command_me has been run on the server,
                    // stats.connections appears to be equal to the value of
                    // stats.command_me + stats.connections ???
                    if (!registryDisabled) {
                        stats.connections.must.equal(3);
                    }
                    stats.locks.must.equal(0);
                    stats.shared_locks.must.equal(0);
                    setTimeout(next, 10);
                });
            },

            function(next) {
                testSequence(
                    [client1, 'inspect', 'asdf1', null, 0, 'Lock Not Locked: asdf1'],
                    [client1, 'inspect', 'asdf2', null, 0, 'Lock Not Locked: asdf2'],
                    [client1, 'inspect', 'asdf3', null, 0, 'Lock Not Locked: asdf3'],
                    [client1, 'get'    , 'asdf1', null, 1, 'Lock Get Success: asdf1'],
                    [client1, 'get'    , 'asdf2', null, 1, 'Lock Get Success: asdf2'],
                    [client1, 'release', 'asdf2', null, 1, 'Lock Release Success: asdf2'],
                    [client2, 'get'    , 'asdf2', null, 1, 'Lock Get Success: asdf2'],
                    [client3, 'get'    , 'asdf3', null, 1, 'Lock Get Success: asdf3'],

                    (dumpDisabled
                        ? [client2, 'dump', null   , 'The dump feature of the lockd server is disabled.']
                        : [client2, 'dump', null   , null, { 'asdf1' : address(client1), 'asdf2' : address(client2), 'asdf3' : address(client3) }]),
                    (dumpDisabled
                        ? [client1, 'dump', 'asdf2', 'The dump feature of the lockd server is disabled.']
                        : [client1, 'dump', 'asdf2', null, address(client2)]),

                    [client1, 'inspectShared', 'asdf', null, 0, 'Shared Lock Not Locked: asdf'],
                    [client1, 'getShared'    , 'asdf', null, 1, 'Shared Lock Get Success: asdf'],
                    [client2, 'getShared'    , 'asdf', null, 2, 'Shared Lock Get Success: asdf'],
                    [client3, 'getShared'    , 'asdf', null, 3, 'Shared Lock Get Success: asdf'],
                    [client2, 'releaseShared', 'asdf', null, 1, 'Shared Lock Release Success: asdf'],
                    [client2, 'getShared'    , 'asdg', null, 1, 'Shared Lock Get Success: asdg'],

                    (dumpDisabled
                        ? [client1, 'dumpShared', 'asdf', 'The dump feature of the lockd server is disabled.']
                        : [client1, 'dumpShared', 'asdf', null, [address(client1), address(client3)]]),

                    next);
            },

            function(next) {
                client1.disconnect(function() {
                    client1 = newClient();
                    client2 = newClient();
                    client3 = newClient();
                    waitForConnections(next);
                });
            },

            // note: remove this to better diagnose race conditions (it has a 100ms timeout)
            function(next) {
                client1.transport.request('xx\n', function(err, lines) {
                    must(err).not.exist();
                    lines.must.eql([]);
                    next();
                });
            },

            function(next) {
                client1.transport.request('dump\n', 1, function(err, lines) {
                    must(err).not.exist();
                    if (dumpDisabled) {
                        lines.must.eql(['0 disabled']);
                    } else {
                        lines.must.have.length(1);
                        lines[0].must.match(/^(map\[|{)/);
                    }
                    next();
                });
            },

            function(next) {
                client1.transport.request('dump shared\n', 1, function(err, lines) {
                    must(err).not.exist();
                    if (dumpDisabled) {
                        lines.must.eql(['0 disabled']);
                    } else {
                        lines.must.have.length(1);
                        lines[0].must.match(/^(map\[|{)/);
                    }
                    next();
                });
            },

            function(next) {
                if (registryDisabled) {
                    testSequence(
                        [client1, 'getName'    , null, 'Expected 1 line but got 0'],
                        [client1, 'setName'    , 'c1', 'Expected 1 line but got 0'],
                        // TODO should be:
                        // [client1, 'listClients', null, 'The dump and/or registry features of the lockd server are disabled.'],
                        [client1, 'listClients', null, null, {}],
                        next);
                } else {
                    testSequence(
                        [client1, 'getName'    , null, null, address(client1), address(client1)],
                        [client1, 'setName'    , 'c1', null, 1, 'ok'],

                        (dumpDisabled
                            ? [client1, 'listClients', null, 'The dump and/or registry features of the lockd server are disabled.']
                            : [client1, 'listClients', null, null, { 'c1' : address(client1) }]),

                        next);
                }
            },

            function(next) {
                client2.getStats(function(err, stats) {
                    must(err).not.exist();
                    Object.keys(stats).must.eql(Object.keys(stats).sort());
                    // Bug in glockd: if launched with -registry=false then
                    // command_iam will never be set
                    stats.command_iam = stats.command_iam || 0;
                    stats2 = stats;
                    Object.keys(stats).must.be.a.permutationOf(statsKeys);
                    statsKeys.forEach(function(k) {
                        statsChangesActual[k] = stats2[k] - stats1[k];
                    });
                    statsChangesActual.must.eql(statsChangesExpected);
                    next();
                });
            }

        ], function(err) {
            must(err).not.exist();
            done();
        });
    });

    it('passes arguments to the connect event correctly', function(done) {
        client1.on('connect', function() {
            // This was broken at one point since passing arguments through
            // multiple layers of events is a little tricky
            [].slice.call(arguments).must.eql([]);
            done();
        });
    });

    it('deals with misbehaving servers that never send responses', function(done) {
        server = net.createServer(function(c) {
            c.pipe(split()).on('data', function(line) {
                // console.log('bad server is discarding request: "%s"', line);
            });
        }).listen(6767, function() {
            var client = lockd.connect({ tcp : 'localhost:6767' });
            testSequence(
                [client, 'get'          , 'asdf', 'Expected 1 line but got 0'],
                [client, 'inspect'      , 'asdf', 'Expected 1 line but got 0'],
                [client, 'release'      , 'asdf', 'Expected 1 line but got 0'],
                [client, 'dump'         , 'asdf', null, null],
                [client, 'dump'         , null  , null, {}],
                [client, 'getShared'    , 'asdf', 'Expected 1 line but got 0'],
                [client, 'inspectShared', 'asdf', 'Expected 1 line but got 0'],
                [client, 'releaseShared', 'asdf', 'Expected 1 line but got 0'],
                [client, 'dumpShared'   , 'asdf', null, []],
                [client, 'dumpShared'   , null  , null, {}],
                [client, 'getName'      , null  , 'Expected 1 line but got 0'],
                [client, 'setName'      , 'c1'  , 'Expected 1 line but got 0'],
                [client, 'listClients'  , 'c1'  , null, null],
                [client, 'listClients'  , null  , null, {}],
                [client, 'getStats'     , null  , null, {}],
                function() {
                    client.disconnect(function() {
                        server.close(function() {
                            done();
                        });
                    });
                });
        });
    });

    it('deals with misbehaving servers that send back extra blank lines', function(done) {
        server = net.createServer(function(c) {
            var addr = c.remoteAddress + ':' + c.remotePort;
            c.pipe(split()).on('data', function(line) {
                switch (line) {
                    case 'g asdf':
                        c.write('1 Lock Get Success: asdf\n\n');
                        break;
                    case 'i asdf':
                        c.write('1 Lock Is Locked: asdf\n\n');
                        break;
                    case 'd asdf':
                        c.write('asdf: ' + addr + '\n\n');
                        break;
                    case 'd':
                        c.write('asdf: ' + addr + '\n\n');
                        break;
                    case 'r asdf':
                        c.write('1 Lock Release Success: asdf\n\n');
                        break;
                    case 'sg asdf':
                        c.write('1 Shared Lock Get Success: asdf\n\n');
                        break;
                    case 'si asdf':
                        c.write('1 Shared Lock Is Locked: asdf\n\n');
                        break;
                    case 'sd asdf':
                        c.write('asdf: ' + addr + '\n\n');
                        break;
                    case 'sd':
                        c.write('asdf: ' + addr + '\n\n');
                        break;
                    case 'sr asdf':
                        c.write('1 Shared Lock Release Success: asdf\n\n');
                        break;
                    case 'me':
                        c.write('1 ' + addr + ' ' + addr + '\n\n');
                        break;
                    case 'iam c1':
                        c.write('1 ok\n\n');
                        break;
                    case 'who c1':
                        c.write(addr + ': c1\n\n');
                        break;
                    case 'who':
                        c.write(addr + ': c1\n\n');
                        break;
                    case 'q':
                        c.write('command_d: 348\n');
                        // stats truncated
                        c.write('shared_orphans: 273\n\n');
                        break;
                }
            });
        }).listen(6767, function() {
            var client = lockd.connect({ tcp : 'localhost:6767' });
            client.on('connect', function() {
                testSequence(
                    [client, 'get'          , 'asdf', null, 1, 'Lock Get Success: asdf'],
                    [client, 'inspect'      , 'asdf', null, 1, 'Lock Is Locked: asdf'],
                    [client, 'release'      , 'asdf', null, 1, 'Lock Release Success: asdf'],
                    [client, 'dump'         , 'asdf', null, address(client)],
                    [client, 'dump'         , null  , null, { 'asdf' : address(client) }],
                    [client, 'getShared'    , 'asdf', null, 1, 'Shared Lock Get Success: asdf'],
                    [client, 'inspectShared', 'asdf', null, 1, 'Shared Lock Is Locked: asdf'],
                    [client, 'releaseShared', 'asdf', null, 1, 'Shared Lock Release Success: asdf'],
                    [client, 'dumpShared'   , 'asdf', null, [address(client)]],
                    [client, 'dumpShared'   , null  , null, { 'asdf' : [address(client)] }],
                    [client, 'getName'      , null  , null, address(client), address(client)],
                    [client, 'setName'      , 'c1'  , null, 1, 'ok'],
                    [client, 'listClients'  , 'c1'  , null, address(client)],
                    [client, 'listClients'  , null  , null, { 'c1' : address(client) }],
                    [client, 'getStats'     , null  , null, { command_d : 348, shared_orphans : 273 }],
                    function() {
                        client.disconnect(function() {
                            server.close(function() {
                                done();
                            });
                        });
                    });
            });
            client.on('error', function(err) {
                console.log(err.message);
            });
        });
    });
});
