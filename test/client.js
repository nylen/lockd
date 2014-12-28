var async  = require('async'),
    domain = require('domain'),
    lockd  = require('../index'),
    mocha  = require('mocha'),
    must   = require('must');

describe('LockdClient', function() {
    if (!process.env.LOCKD_SERVER) {
        throw new Error('Run the tests with environment variable:  LOCKD_SERVER=host:port');
    }

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
                args     = [].concat(step[2]),
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

    it('serializes operations on a single client', function(done) {
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
});
