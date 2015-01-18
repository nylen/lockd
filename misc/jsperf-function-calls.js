// http://jsperf.com/compare-function-calls

function TestThing(val) {
    this.something = val;
}

// FUNCTION CALLS TO BE TESTED

TestThing.prototype.commands = {
    setSomething : function(newValue) {
        this.something = newValue;
    }
};

TestThing.prototype.command_setSomething = function(newValue) {
    this.something = newValue;
};

// TESTS WITH ERROR HANDLING

TestThing.prototype.doStuff_commands = function(what, newValue) {
    var method = this.commands[what];
    if (method) {
        method.call(this, newValue);
    }
    if (this.something != newValue) {
        throw new Error('it broke');
    }
};

TestThing.prototype.doStuff_dynamicMethod = function(what, newValue) {
    var method = this['command_' + what];
    if (method) {
        method.call(this, newValue);
    }
    if (this.something != newValue) {
        throw new Error('it broke');
    }
};

TestThing.prototype.doStuff_direct = function(what, newValue) {
    var method;
    switch (what) {
        case 'setSomething':
            this.command_setSomething(newValue);
            break;
    }
    if (this.something != newValue) {
        throw new Error('it broke');
    }
};

// TESTS WITHOUT ERROR HANDLING

TestThing.prototype.doStuff_commands_noError = function(what, newValue) {
    var method = this.commands[what];
    if (method) {
        method.call(this, newValue);
    }
};

TestThing.prototype.doStuff_dynamicMethod_noError = function(what, newValue) {
    var method = this['command_' + what];
    if (method) {
        method.call(this, newValue);
    }
};

TestThing.prototype.doStuff_direct_noError = function(what, newValue) {
    var method;
    switch (what) {
        case 'setSomething':
            this.command_setSomething(newValue);
            break;
    }
};

var thing = new TestThing('asdf');

var newValue = 0;
