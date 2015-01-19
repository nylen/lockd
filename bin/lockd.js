#!/usr/bin/env node

var fs    = require('fs'),
    lockd = require('../index'),
    util  = require('util');

var program = require('yargs')
    .usage('Usage: $0 options')
    .wrap(80)
    .option('t', {
        alias    : 'tcp',
        describe : 'TCP [interface:]port to listen on.  Default 9999 if no other methods given.',
        type     : 'string'
    })
    .option('disable-dump', {
        describe : 'Forbid clients from dumping holders of shared and exclusive locks.',
        type     : 'boolean'
    })
    .option('disable-registry', {
        describe : 'Forbid clients from assigning themselves friendly names.',
        type     : 'boolean'
    })
    .option('p', {
        alias    : 'pid-file',
        describe : 'PID file (will contain two lines: PID and server port.',
        type     : 'string'
    })
    .addHelpOpt('h').alias('h', 'help');

function usage() {
    console.error.apply(null, arguments);
    console.error();
    program.showHelp();
    process.exit(1);
}

var argv = program.argv;

var serverOpts = {};

if (argv.tcp) {
    serverOpts.tcp = argv.tcp;
}

// TODO other connection methods here

if (!Object.keys(serverOpts).length) {
    // No listening options specified, use tcp 9999
    serverOpts.tcp = '9999';
}

if (argv.pidFile) {
    try {
        fs.writeFileSync(argv.pidFile, process.pid);
    } catch (err) {
        usage('Error writing to PID file: ' + err.message);
    }
}

var server = lockd.listen(util._extend({
    features : {
        dump     : !argv.disableDump,
        registry : !argv.disableRegistry
    }
}, serverOpts));

server.on('ready', function() {
    console.log('Listening on ' + JSON.stringify(serverOpts));
});

server.on('error', function(err) {
    usage(
        'Error starting lockd server on %s: %s',
        JSON.stringify(serverOpts),
        err.message);
});
