# lockd Protocol Documentation

`lockd` uses a simple line-based protocol over TCP.

## Connection Methods

When running the server from the command line, it will listen on TCP/IP port
9999 by default unless another port is specified.

### TCP/IP

If TCP/IP is enabled then you may simply telnet to the port number that `lockd`
is listening on (9999 by default.)  You can open a TCPIP socket in any
programming language this way (`fsockopen` in PHP for example.)  There is no
handshake, banner, or negotiation that takes place.  Clients can issue commands
immediately upon connecting.

Client Implementations:

- PHP: http://code.svn.wordpress.org/lockd/lockd-client.php

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

Only available if the `dump` feature of the `lockd` server is enabled.

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

Only available if the `dump` feature of the `lockd` server is enabled.

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
> client1> sg foo
< client1< 1 Shared Lock Get Success: foo
> client2> sg foo
< client2< 2 Shared Lock Get Success: foo
> client2> sg bar
< client2< 1 Shared Lock Get Success: bar
```

### Release a shared lock: `sr LOCKNAME\n`

```diff
> client1> sg foo
< client1< 1 Shared Lock Get Success: foo
> client2> sg foo
< client2< 2 Shared Lock Get Success: foo
> client3> si foo
< client3< 2 Shared Lock Is Locked: foo
> client1> sr foo
< client1< 1 Shared Lock Release Success: foo
> client3> si foo
< client3< 1 Shared Lock Is Locked: foo
> client2> sr foo
< client2< 1 Shared Lock Release Success: foo
> client3> si foo
< client3< 0 Shared Lock Not Locked: foo
```

### Inspect a shared lock: `si LOCKNAME\n`

```diff
> client1> si foo
< client1< 0 Shared Lock Not Locked: foo
> client1> sg foo
< client1< 1 Shared Lock Get Success: foo
> client2> si foo
< client2< 1 Shared Lock Is Locked: foo
> client2> sg foo
< client2< 2 Shared Lock Get Success: foo
> client1> si foo
< client1< 2 Shared Lock Get Success: foo
```

### Dump locks and their holders: `sd\n` or `sd LOCKNAME\n`

Only available if the `dump` feature of the `lockd` server is enabled.

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

Only available if the `dump` feature of the `lockd` server is enabled.

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
   `sd` commands and defaults to the first parameter if the `iam` command was
   not used to register a name for the current session)

```diff
> me
< 1 127.0.0.1:57871 127.0.0.1:57871
> iam foo
< 1 ok
> me
< 1 127.0.0.1:57871 foo
```

### Set connection name: `iam NAME\n`

Only available if the `registry` feature of the `lockd` server is enabled.

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

Only available if both the `dump` and `registry` features of the `lockd` server
are enabled.

```diff
> client1> who
< client1< 
> client1> iam me
< client1< 1 ok
> client2> iam someone_else
< client2< 1 ok
> client1> who
< client1< 127.0.0.1:60882: me
< client1< 127.0.0.1:60918: someone_else
> client1> who someone_else
< client1< 127.0.0.1:60918: someone_else
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
