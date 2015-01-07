# lockd [![Build status](https://img.shields.io/travis/nylen/lockd.svg?style=flat)](https://travis-ci.org/nylen/lockd) [![npm package](http://img.shields.io/npm/v/lockd.svg?style=flat)](https://www.npmjs.org/package/lockd)

A network lock service and client library.  Port of
[apokalyptik/glockd](https://github.com/apokalyptik/glockd) to Node.js.

**WORK IN PROGRESS** - not ready for use yet.

## Lock Types

### Exclusive Locks

Exclusive locks are... exclusive. They can only be held by one connection at a
time.

Upon disconnection of a client all of that client's exclusive locks are
considered to be "orphaned" and are automatically released.  The intended
purpose of this functionality is to help avoid the complicated gymnastics
generally used in distributed locking (timeouts, heartbeating, etc).  This way,
a single process can maintain a lock simply by its continued presence, and can
release its lock by its absence. A side effect of this methodology is that
stale locks simply cannot exist in this environment.  If the connection goes
away then its locks are released. Any lock still extant, therefore, is still
validly held by a process that is still literally running somewhere.

### Shared Locks

Shared locks are... not exclusive.  They can be obtained by any number of
clients at the same time.

One interesting feature of shared locks is that they are counted. That is if 4
clients have a lock, and another goes to lock the same thing then when it does
it will be told that it is the 5th client to obtain that lock.  This makes
shared locks good for things like rate limiting, throttling, etc.: the client
can have logic built in so that after 5 active locks are obtained it waits,
defers, or otherwise avoids doing the work for which the shared lock was
requested.

Upon disconnection of a client all of that client's shared locks are considered
to be "orphaned" and are automatically released.  This behavior works just like
the exclusive lock orphaning feature.  Counts on shared locks are appropriately
updated when locks are orphaned.

## Installation

### Client Installation

To connect to a running `lockd` server:

```
npm install lockd
```

```js
var lockd = require('lockd');

var client = lockd.connect({
    // Choose one of the following connection methods:
    tcp       : 'host:port',
    unix      : '/path/to/unix.socket',
    websocket : 'ws://host:port',
    // Extra options, if needed:
    timeout     : /* connection timeout in ms */
    readTimeout : /* socket read timeout in ms */
});
```

**TODO**: document that you can pass a `LockdServer` instance instead

### Server Installation

To run a `lockd` server from the command line:

```
sudo npm install -g lockd
lockd --help
```

When running the server from the command line, it will listen on TCP/IP port
9999 by default.  If any other connection methods are specified then this
default will not be used.


To start a `lockd` server as part of a Node.js program:

```
npm install lockd
```

```js
var lockd = require('lockd');

var server = lockd.listen({
    // Choose one or more of the following connection methods:
    tcp       : 'host:port',
    unix      : '/path/to/unix.socket',
    websocket : 'ws://host:port'
});
```

**TODO**: support listening on a websocket path given an existing server
instance, see
https://github.com/einaros/ws/blob/v0.4.30/test/WebSocketServer.test.js#L121

## Client Documentation

The following methods are available on `lockd` client objects created with
`lockd.connect` as described above.

All client operations are serialized:  a client will perform requests to the
server in series so that at most one operation is in progress at once.  Clients
will also queue operations until connected to the server, so requests can be
made immediately upon creating a client.

Many server responses contain a leading number that is `0` on failure or `>= 1`
on success, and then a text description (see the
[protocol documentation](docs/protocol.md) for more information).  When a
method has a callback with parameters `count`/`ok` and `msg`, they will contain
the number and the message from the server response (unless the server response
indicates an error condition like failure to acquire an exclusive lock).

### Events

Clients will emit the following events:
- `connect` - when connected to the server, if applicable.  You shouldn't have
  to worry about this event since client operations are serialized.
- `close` - when disconnected from the server, if applicable.  You shouldn't
  have to worry about this event - use the [`disconnect`](#disconnectcb) method
  instead.
- `error` - on failure to connect to the server.

### get(lockName, cb)

Attempts to acquire the exclusive lock `lockName`.  The callback `cb` is called
with parameters (`err`, `count`, `msg`).

If the lock is acquired, `err` will be `null` and `count` will be `1`.  If the
lock is not acquired (because it is held by another client), `err` will be an
`Error` object and the other arguments will be missing.

### release(lockName, cb)

Attempts to release the exclusive lock `lockName`.  The callback `cb` is called
with parameters (`err`, `ok`, `msg`).

If the lock is released, `err` will be `null` and `ok` will be `1`.  If the
lock is not released (because it is not held by this client), `err` will be an
`Error` object and the other arguments will be missing.

### inspect(lockName, cb)

Returns whether the exclusive lock `lockName` is currently held by a client.
The callback `cb` is called with parameters (`err`, `count`, `msg`).

`count` will be `1` if the lock is held by a client and `0` if it is free.

### dump([lockName], cb)

Returns information about the exclusive lock `lockName` (or all exclusive
locks).  The callback `cb` is called with parameters (`err`, `lockInfo`), where
`lockInfo` is defined as follows:

- If `lockName` is given, then `lockInfo` is the address of the client holding
  the exclusive lock `lockName`, or `null` if it is not held.
- If `lockName` is not given, then `lockInfo` is a hash representing all
  exclusive locks currently held, where keys are lock names and values are
  client addresses.

If the dump feature is disabled on the `lockd` server, then `err` will be set
accordingly.

### getShared(lockName, cb)

Acquires the shared lock `lockName`.  The callback `cb` is called with
parameters (`err`, `count`, `msg`).

The lock will be acquired and `count` will be the number of clients that are
holding the requested lock, including the current client.

### releaseShared(lockName, cb)

Attempts to release the shared lock `lockName`.  The callback `cb` is called
with parameters (`err`, `ok`, `msg`).

If the lock is released, `err` will be `null` and `ok` will be `1`.  If the
lock is not released (because it is not held by this client), `err` will be an
`Error` object and the other arguments will be missing.

### inspectShared(lockName, cb)

Returns the number of clients currently holding the shared lock `lockName`.
The callback `cb` is called with parameters (`err`, `count`, `msg`).

`count` will be `>= 1` if the lock is held by one or more clients and `0` if it
is free.

### dumpShared([lockName], cb)

Returns information about the shared lock `lockName` (or all shared
locks).  The callback `cb` is called with parameters (`err`, `lockInfo`), where
`lockInfo` is defined as follows:

- If `lockName` is given, then `lockInfo` is an array of the addresses of the
  clients holding the shared lock `lockName`, or `[]` if it is not held.
- If `lockName` is not given, then `lockInfo` is a hash representing all
  shared locks currently held, where keys are lock names and values are arrays
  of client addresses.

If the dump feature is disabled on the `lockd` server, then `err` will be set
accordingly.

### disconnect(cb)

Closes the connection to the `lockd` server (if any).  This will also cause any
locks held by the client to be released.

## Other Client Implementations

- PHP: http://code.svn.wordpress.org/lockd/lockd-client.php
- Python: https://gist.github.com/mdawaffe/e53c86e5163b48d5fe3a
- Go: https://github.com/apokalyptik/glockc

## Protocol Documentation

`lockd` uses a simple line-based protocol available over several different
transports.  See [docs/protocol.md](docs/protocol.md) for more information.
