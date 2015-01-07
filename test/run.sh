#!/bin/bash

n="$1"
[ -z "$n" ] && n=1000
shift

cd "$(dirname "$0")"
cd ..
rm -rf test/out/
mkdir -p test/out/
echo

failures=0

for i in `seq 1 $n`; do
    # http://ascii-table.com/ansi-escape-sequences.php
    echo -e "\033[1Arun $i/$n"
    if node_modules/.bin/mocha "$@" > test/out/curr.txt 2>&1; then
        rm test/out/curr.txt
    else
        mv test/out/curr.txt test/out/fail-$i.txt
        echo -e "\033[1Arun $i failed"
        echo
        failures=$(($failures + 1))
    fi
done

echo "failures: $failures/$n"
