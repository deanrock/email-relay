# Email relay


### Example config.js

    exports.smtp_banner = 'Email Relay (Test)';
    exports.listen_port = 25;
    exports.listen_host = '127.0.0.1';
    exports.mail_server_host = '192.168.1.1';
    exports.mail_server_port = 25;
    exports.logging_level = 'debug';
    exports.mongodb_connection_string = 'mongodb://localhost/email-relay-test';
