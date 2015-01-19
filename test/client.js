var domain      = require('domain'),
    lockd       = require('../index'),
    lib         = require('./lib'),
    mocha       = require('mocha'),
    must        = require('must'),
    net         = require('net'),
    destroyable = require('server-destroy'),
    split       = require('split');

describe('LockdClient', function() {
    var client,
        server,
        responses;

    beforeEach(function(done) {
        responses = {};
        server = net.createServer(function(c) {
            c.pipe(split()).on('data', function(line) {
                if (typeof responses[line] == 'string') {
                    c.write(responses[line]);
                }
            });
        });
        server.listen(6767, function() {
            done();
        });
        destroyable(server);
        client = lockd.connect({ tcp : 'localhost:6767' });
    });

    afterEach(function(done) {
        server.destroy(done);
    });

    it('queues requests until connected to the server', function(done) {
        responses['g asdf'] = '1 Lock Get Success: asdf\n';

        var client    = lockd.connect({ tcp : 'localhost:6767' }),
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
        responses['g error'] = '1 Lock Get Success: error\n';

        var d = domain.create();
        d.on('error', function(err) {
            err.message.must.equal('test');
            d.exit();
            done();
        });
        d.enter();
        client.get('error', function(err, ok, msg) {
            throw new Error('test');
        });
    });

    it('passes arguments to the connect event correctly', function(done) {
        var client = lockd.connect({ tcp : 'localhost:6767' });
        client.on('connect', function() {
            // This was broken at one point since passing arguments through
            // multiple layers of events is a little tricky
            [].slice.call(arguments).must.eql([]);
            done();
        });
    });

    it('deals with misbehaving servers that never send responses', function(done) {
        lib.testSequence(
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
            done);
    });

    it('deals with misbehaving servers that send back extra blank lines', function(done) {
        var addr = '127.0.0.1:56789';

        responses['g asdf']  = '1 Lock Get Success: asdf\n\n';
        responses['i asdf']  = '1 Lock Is Locked: asdf\n\n';
        responses['d asdf']  = 'asdf: ' + addr + '\n\n';
        responses['d']       = 'asdf: ' + addr + '\n\n';
        responses['r asdf']  = '1 Lock Release Success: asdf\n\n';
        responses['sg asdf'] = '1 Shared Lock Get Success: asdf\n\n';
        responses['si asdf'] = '1 Shared Lock Is Locked: asdf\n\n';
        responses['sd asdf'] = 'asdf: ' + addr + '\n\n';
        responses['sd']      = 'asdf: ' + addr + '\n\n';
        responses['sr asdf'] = '1 Shared Lock Release Success: asdf\n\n';
        responses['me']      = '1 ' + addr + ' ' + addr + '\n\n';
        responses['iam c1']  = '1 ok\n\n';
        responses['who c1']  = addr + ': c1\n\n';
        responses['who']     = addr + ': c1\n\n';
        responses['q']       = 'command_d: 348\nshared_orphans: 273\n\n';

        client.on('error', function(err) {
            throw err;
        });

        lib.testSequence(
            [client, 'get'          , 'asdf', null, 1, 'Lock Get Success: asdf'],
            [client, 'inspect'      , 'asdf', null, 1, 'Lock Is Locked: asdf'],
            [client, 'release'      , 'asdf', null, 1, 'Lock Release Success: asdf'],
            [client, 'dump'         , 'asdf', null, addr],
            [client, 'dump'         , null  , null, { 'asdf' : addr }],
            [client, 'getShared'    , 'asdf', null, 1, 'Shared Lock Get Success: asdf'],
            [client, 'inspectShared', 'asdf', null, 1, 'Shared Lock Is Locked: asdf'],
            [client, 'releaseShared', 'asdf', null, 1, 'Shared Lock Release Success: asdf'],
            [client, 'dumpShared'   , 'asdf', null, [addr]],
            [client, 'dumpShared'   , null  , null, { 'asdf' : [addr] }],
            [client, 'getName'      , null  , null, addr, addr],
            [client, 'setName'      , 'c1'  , null, 1, 'ok'],
            [client, 'listClients'  , 'c1'  , null, addr],
            [client, 'listClients'  , null  , null, { 'c1' : addr }],
            [client, 'getStats'     , null  , null, { command_d : 348, shared_orphans : 273 }],
            done);
    });
});
