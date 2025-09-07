const mongoose = require('mongoose');

const submissionSchema = new mongoose.Schema({
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true },
    patientId: { type: String, required: true },
    email: { type: String, required: true },
    note: { type: String },
    imageUrl: { type: String, required: true },
    annotationJson: { type: Object },
    annotatedImageUrl: { type: String },
    reportUrl: { type: String },
    status: { type: String, enum: ['uploaded', 'annotated', 'reported'], default: 'uploaded' },
}, { timestamps: true });

module.exports = mongoose.model('Submission', submissionSchema);
