var mongoose = require('mongoose');
var Schema = mongoose.Schema,
    ObjectId = Schema.ObjectId;

var EmailSchema = new mongoose.Schema({
    added: Date,

    remoteAddress: String,
    mailFrom: String,
    recipients: [String],

    error: String,

    session: Object,
    response: Object
});

EmailSchema.pre('save', function(next) {
    var self = this;

    if (self.added === undefined) {
        self.added = new Date();
    }

    next();
});

module.exports = mongoose.model('Email', EmailSchema);
