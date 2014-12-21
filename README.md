# lockd [![Build status](https://img.shields.io/travis/nylen/lockd.svg?style=flat)](https://travis-ci.org/nylen/lockd) [![npm package](http://img.shields.io/npm/v/lockd.svg?style=flat)](https://www.npmjs.org/package/lockd)

A network lock service and client library.  Port of
[apokalyptik/glockd](https://github.com/apokalyptik/glockd) to Node.js.

**WORK IN PROGRESS** - not ready for use yet.

## Installation

```
sudo npm install -g lockd
lockd --help
```

## Other Client Implementations

- PHP: http://code.svn.wordpress.org/lockd/lockd-client.php
- Python: https://gist.github.com/mdawaffe/e53c86e5163b48d5fe3a
- Go: https://github.com/apokalyptik/glockc

## Connection Methods

When running the server from the command line, it will listen on TCP/IP port
9999 by default.  If any other connection methods are specified then this
default will not be used.

### TCP/IP

If TCP/IP is enabled then you may simply telnet to the port number that `lockd`
is listening on (9999 by default.)  You can open a TCPIP socket in any
programming language this way (`fsockopen` in PHP for example.)  There is no
handshake, banner, or negotiation that takes place.  Clients can issue commands
immediately upon connecting.

Client Implementations:

- PHP: http://code.svn.wordpress.org/lockd/lockd-client.php

### Websockets

If websockets are enabled then you may simply connect to the server as you
normally would on `ws://host:port/`.  The API works the same way for websockets
as for TCP/IP sockets.

### Unix Sockets

If a path to a local unix socket has been specified (via the `--unix`
parameter) then you may connect to it as you would any `AF_UNIX` socket in
your programming language (example below.)  You may then read/write commands as
you would a TCP/IP socket connection.  This obviously only works when
connecting to `lockd` from the same machine since a shared filesystem which
supports unix sockets is required.

Example connecting to `lockd` via a unix socket in Python:

```python
import socket
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.connect("/var/run/lockd/socket")
s.sendall("g foo\n")
print s.recv(4096)
```

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

## Exclusive Locks API

Generally speaking most commands for exclusive locks return a response in the
format `%d %s`.  The integer portion of the response is meant for programmatic
interpretation, where `1` represents success or acquisition of the lock, and
`0` represents failure or non-acquisition of the lock.

### Get a lock: `g LOCKNAME\n`

In the following example `foo` is available, but `bar` is already locked by
another client.

```diff
> g foo
< 1 Lock Get Success: foo
> g bar
< 0 Lock Get Failure: bar
```

### Release a lock: `r LOCKNAME\n`

```diff
> g foo
< 1 Lock Get Success: foo
> r foo
< 1 Lock Release Success: foo
> r bar
< 0 Lock Release Failure: bar
```

### Inspect a lock: `i LOCKNAME\n`

```diff
> i foo
< 1 Lock Is Locked: foo
> i bar
< 0 Lock Not Locked: bar
```

### Dump locks and their holders: `d\n` or `d LOCKNAME\n`

Only available if `lockd` was started with the `--allow-dump` option.

This command is mainly useful for debugging.

```diff
> d
< baz: 174.62.83.171:59060
< foo: 174.62.83.171:59056
< bar: 174.62.83.171:59060
< boo: 174.62.83.171:59060
> d foo
< foo: 174.62.83.171:59056
```

### Dump the lock data structure: `dump\n`

Only available if `lockd` was started with the `--allow-dump` option.

This command is mainly useful for debugging.

```diff
> dump
< map[boo:174.62.83.171:59060 baz:174.62.83.171:59060 foo:174.62.83.171:59056 bar:174.62.83.171:59060]
```

## Shared Locks API

Generally speaking most commands for shared locks return a response in the
format `%d %s`.  The integer portion of the response is meant for programmatic
interpretation, where `%d >= 1` represents success or acquisition of the lock,
and `0` represents failure or non-acquisition of the lock.

### Get a shared lock: `sg LOCKNAME\n`

```diff
client1> sg foo
client1< 1 Shared Lock Get Success: foo
client2> sg foo
client2< 2 Shared Lock Get Success: foo
client2> sg bar
client2< 1 Shared Lock Get Success: bar
```

### Release a shared lock: `sr LOCKNAME\n`

```diff
client1> sg foo
client1< 1 Shared Lock Get Success: foo
client2> sg foo
client2< 2 Shared Lock Get Success: foo
client3> si foo
client3< 2 Shared Lock Is Locked: foo
client1> sr foo
client1< 1 Shared Lock Release Success: foo
client3> si foo
client3< 1 Shared Lock Is Locked: foo
client2> sr foo
client2< 1 Shared Lock Release Success: foo
client3> si foo
client3< 0 Shared Lock Not Locked: foo
```

### Inspect a shared lock: `si LOCKNAME\n`

```diff
client1> si foo
client1< 0 Shared Lock Not Locked: foo
client1> sg foo
client1< 1 Shared Lock Get Success: foo
client2> si foo
client2< 1 Shared Lock Is Locked: foo
client2> sg foo
client2< 2 Shared Lock Get Success: foo
client1> si foo
client1< 2 Shared Lock Get Success: foo
```

### Dump locks and their holders: `sd\n` or `sd LOCKNAME\n`

Only available if `lockd` was started with the `--allow-dump` option.

```diff
> sd
< blah: 174.62.83.171:59615
< bar: 174.62.83.171:59615
< foo: 174.62.83.171:59615
< foo: 174.62.83.171:59614
< baz: 174.62.83.171:59615
> sd foo
< foo: 174.62.83.171:59615
< foo: 174.62.83.171:59614
```

### Dump the lock data structure: `dump shared\n`

Only available if `lockd` was started with the `--allow-dump` option.

```diff
> dump shared
< map[blah:[174.62.83.171:59615] bar:[174.62.83.171:59615] foo:[174.62.83.171:59615 174.62.83.171:59614] baz:[174.62.83.171:59615]]
```

## Registry API

### Get connection name: `me\n`

This command always returns two values:

1. The default connection name (used in the output of the `dump` and
   `dump shared` commands)
2. The registered name of the connection (used in the output of the `d` and
   `sd` commands commands and defaults to the first parameter if the `iam`
   command was not used to register a name for the current session)

```diff
> me
< 1 127.0.0.1:57871 127.0.0.1:57871
> iam foo
< 1 ok
> me
< 1 127.0.0.1:57871 foo
```

### Set connection name: `iam NAME\n`

Only available if `lockd` was started with the `--enable-registry` option.

```diff
> g lock1
< 1 Got Lock
> d lock1
< lock1: 127.0.0.1:60882
> iam foo
< 1 ok
> d lock1
< lock1: foo
> iam
< 1 ok
> d lock1
< lock1: 127.0.0.1:60882
```

### List client names: `who\n` or `who NAME\n`

Only available if `lockd` was started with both the `--allow-dump` and
`--enable-registry` options.

```diff
client1> who
client1< 
client1> iam me
client1< 1 ok
client2> iam someone_else
client2< 1 ok
client1> who
client1< 127.0.0.1:60882: me
client1< 127.0.0.1:60918: someone_else
client1> who someone_else
client1< 127.0.0.1:60918: someone_else
```

## Stats API

### Get stats information: `q\n`

```diff
> q
< command_d: 4
< command_dump: 1
< command_g: 9
< command_i: 7
< command_q: 1
< command_r: 3
< command_sd: 1
< command_sg: 1
< command_si: 2
< command_sr: 1
< connections: 2
< invalid_commands: 23
< locks: 4
< orphans: 2
< shared_locks: 1
< shared_orphans: 1
```

### Stats response: `command_NAME`

The number of times the particular command `NAME` has been issued since `lockd`
has been running.  Zeroed on server startup.

### Stats response: `locks`, `shared_locks`

The current number of locked strings.  For shared locks this is the number of
locked strings and NOT the number of clients with active locks.

### Stats response: `orphans`, `shared_orphans`

Incremented by one every time a lock is orphaned.  If a client disconnects with
3 shared and 1 exclusive locks then the numbers are incremented by 3 and 1
respecively.  Zeroed on startup.

### Stats response: `connections`

The number of live connections to `lockd`.  This number should always be at
least 1 since you cannot get these stats except by connecting.

### Stats response: `invalid_commands`

The number of times unrecognized commands have been sent to `lockd`.  Example:
sending `stats\n` would increment this counter by one since `stats` is not a
valid command.  Zeroed on startup.
