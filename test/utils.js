var mocha = require('mocha'),
    must  = require('must'),
    utils = require('../lib/utils');

describe('utils.parseHostPort', function() {
    function test(str, expected) {
        if (typeof expected == 'object') {
            it('parses ' + str, function() {
                utils.parseHostPort(str).must.eql(expected);
            });
        } else {
            it('cannot parse ' + str, function() {
                (function() {
                    utils.parseHostPort(str);
                }).must.throw(expected);
            });
        }
    }

    test('abc:80', {
        host : 'abc',
        port : 80
    });

    test('80', {
        host : undefined,
        port : 80
    });

    test('with-dashes:9', {
        host : 'with-dashes',
        port : 9
    });

    test('1.2.3.4:5', {
        host : '1.2.3.4',
        port : 5
    });

    test(':99', 'Invalid [host:]port string: :99');

    test('localhost:', 'Invalid [host:]port string: localhost:');

    test('localhost:0', 'Port 0 is not valid.');
});

describe('utils.splitAtFirstSpace', function() {
    function test(str, isNumber, expected) {
        if (typeof expected == 'undefined') {
            expected = isNumber;
            isNumber = undefined;
        }
        it('splits "' + str + '"', function() {
            utils.splitAtFirstSpace(str, isNumber).must.eql(expected);
        });
    }

    test('abcd e f g', ['abcd', 'e f g']);

    test('1 then some other stuff', ['1', 'then some other stuff']);

    test('1 then more stuff', true, [1, 'then more stuff']);

    test('one-word', ['one-word', null]);

    test('444', true, [444, null]);
});
