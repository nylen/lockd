#!/usr/bin/env node

var lockd = require('../index');

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

serverOpts.features = {
    dump     : !argv.disableDump,
    registry : !argv.disableRegistry
};

var server = lockd.listen(serverOpts);

server.on('error', function(err) {
    delete serverOpts.features;
    usage(
        'Error starting lockd server on %s: %s',
        JSON.stringify(serverOpts),
        err.message);
});
