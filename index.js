'use strict';

var SMTPServer = require('smtp-server').SMTPServer;
var SMTPConnection = require('smtp-connection');
var mongoose = require('mongoose');
var winston = require('winston');
var fs = require('fs');
var PassThrough = require('stream').PassThrough;
var util = require('util');

var config = require('./config');
var Email = require('./models/Email');

// set-up logging
winston.level = config.logging_level;
winston.remove(winston.transports.Console);
winston.add(winston.transports.Console, {'timestamp':true});

// print config for debugging purposes
winston.info(config);

// set-up mongoose and handle errors
mongoose.connection.on('error', function (err) {
    winston.error('-> mongoose error: ' + err);
    mongoose.disconnect();
});
mongoose.connection.on('disconnected', function () {
    winston.info('-> mongoose disconnected');

    // try to reconnect to mongoose after 10 seconds
    setTimeout(function() {
        mongoose.connect(config.mongodb_connection_string, {server: {auto_reconnect: true}});
    }, 10000);
});

// use native promises
mongoose.Promise = global.Promise;

// connect to mongodb
mongoose.connect(config.mongodb_connection_string, {server: {auto_reconnect: true}});

var server = new SMTPServer({
    logger: false,
    banner: config.smtp_banner,
    size: 50 * 1024 * 1024, // accept messages up to 50 MB
    disabledCommands: ['STARTTLS'],
    authMethods: ['PLAIN'],
    authOptional: true,
    allowInsecureAuth: true,
    onConnect: function (session, callback) {
        return callback(); // accept the connection
    },
    onData: function (stream, session, callback) {
        winston.debug(session);

        var email = new Email();
        email.error = null;
        email.remoteAddress = session.remoteAddress;
        email.mailFrom = session.envelope.mailFrom.address;
        email.recipients = [];

        function saveEmail(callback) {
            callback();

            winston.info('-> email with id ' + session.id + ' from ' + email.clientHostname + ' (' + email.remoteAddress + ') sent by ' + email.mailFrom + ' to ' + email.recipients + ' (err: ' + email.error +')');

            email.save(function (err) {
                if (err) {
                    winston.error('-> error while saving email: ' + err);
                }

                winston.debug('-> email saved');
            });
        }

        for (var i = 0; i < session.envelope.rcptTo.length; i++) {
            var r = session.envelope.rcptTo[i];
            email.recipients.push(r.address);
        }

        email.session = session;

        // return error if message is too big
        var err;
        if (stream.sizeExceeded) {
            email.error = 'Error: message exceeds fixed maximum message size 50 MB';
            saveEmail(function () {
                err = new Error('Error: message exceeds fixed maximum message size 50 MB');
                err.responseCode = 552;
                return callback(err);
            });
        }

        // relay to real mail server
        var connection = new SMTPConnection({
            port: config.mail_server_port,
            host: config.mail_server_host,
            ignoreTLS: config.mail_server_ignore_tls,
        });

        var bufferStream = new PassThrough();

        bufferStream.write(new Buffer(util.format(
            'Received: from %s ([%s])\r\n\tby %s (%s) with ESMTP id %s;\r\n\t%s',
            session.clientHostname,
            session.remoteAddress,
            'localhost',
            config.smtp_banner,
            session.id,
            new Date().toUTCString()
        )));

        stream.on('data', function(chunk) {
            bufferStream.write(chunk);
        });

        connection.connect(function () {
            winston.debug('-> connected to upstream');

            connection.send({
                from: session.envelope.mailFrom,
                to: session.envelope.rcptTo,
            }, bufferStream, function (err, info) {
                connection.quit();

                if (err) {
                    winston.debug("-> error occured when forwarding the message to upstream: " + err);

                    email.error = 'Error: error occured while relaying the message';
                    saveEmail(function () {
                        callback(new Error('Error: error occured while relaying the message'));
                    });
                } else {
                    email.response = info;

                    saveEmail(function () {
                        winston.debug(info);
                        callback(null, 'Message relayed to upstream');
                    });
                }
            })
        });

        connection.on('error', function (err) {
            winston.error("-> error occured with upstream: " + err);

            // pipe stream to /dev/null if we couldn't connect to upstream
            var devNull = fs.createWriteStream('/dev/null');
            stream.pipe(devNull);

            email.error = 'Error: message couldn\'t be delivered';
            saveEmail(function () {
                callback(new Error('Error: message couldn\'t be delivered'));
            });
        });

        stream.on('end', function () {
            winston.debug('-> stream ended');
            bufferStream.end();
        });
    }
});

// print server errors to stdout
server.on('error', function (err) {
    winston.error('-> error: %s', err.message);
});

server.listen(config.listen_port, config.listen_host);
