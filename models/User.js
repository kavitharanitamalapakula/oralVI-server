const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    patientId: { type: String, required: function () { return this.role === 'patient'; } },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['patient', 'admin'], required: true },
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
