exports.address = function(client) {
    var addr = client.transport.socket.address();
    return addr.address + ':' + addr.port;
};
