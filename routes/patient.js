const express = require('express');
const multer = require('multer');
const PDFDocument = require('pdfkit');
const { body, validationResult } = require('express-validator');
const Submission = require('../models/Submission');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const cloudinary = require('cloudinary').v2;

const router = express.Router();

// Multer (memory storage)
const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Only image files are allowed!'), false);
    }
});

// Upload submission
router.post('/upload', authenticateToken, authorizeRoles('patient'), upload.single('image'), async (req, res) => {
    try {
        // Validate form fields
        const { name, patientId, email, note } = req.body;
        if (!name || !patientId || !email) return res.status(400).json({ message: 'Missing required fields' });
        if (!req.file) return res.status(400).json({ message: 'Image file is required' });

        // Upload to Cloudinary using buffer with improved error handling
        const cloudinaryResult = await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
                { folder: 'oralvis/submissions', public_id: `${Date.now()}_${req.file.originalname.split('.')[0]}` },
                (error, result) => {
                    if (error) {
                        console.error('Cloudinary upload error:', error);
                        reject(error);
                    } else {
                        resolve(result);
                    }
                }
            );
            stream.on('error', (err) => {
                console.error('Stream error:', err);
                reject(err);
            });
            stream.end(req.file.buffer);
        });

        // Save to DB
        const submission = new Submission({
            patient: req.user._id,
            name,
            patientId,
            email,
            note,
            imageUrl: cloudinaryResult.secure_url
        }); ns

        await submission.save();

        res.status(201).json({
            message: 'Submission uploaded successfully',
            submission
        });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ message: error.message || 'Server error' });
    }
});

// Patient submissions
router.get('/submissions', authenticateToken, authorizeRoles('patient'), async (req, res) => {
    try {
        const submissions = await Submission.find({ patient: req.user._id }).sort({ createdAt: -1 });
        res.json(submissions);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Single submission
router.get('/submissions/:id', authenticateToken, authorizeRoles('patient'), async (req, res) => {
    try {
        const submission = await Submission.findOne({ _id: req.params.id, patient: req.user._id });
        if (!submission) return res.status(404).json({ message: 'Submission not found' });
        res.json(submission);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Generate PDF report (upload_stream)
router.post('/generate-report/:id', authenticateToken, authorizeRoles('patient'), async (req, res) => {
    try {
        const submission = await Submission.findOne({ _id: req.params.id, patient: req.user._id });
        if (!submission) return res.status(404).json({ message: 'Submission not found' });

        const doc = new PDFDocument();
        const cloudinaryUpload = cloudinary.uploader.upload_stream(
            { folder: 'oralvis/reports', public_id: `${Date.now()}_report_${req.params.id}`, resource_type: 'raw' },
            async (err, result) => {
                if (err) {
                    console.error('Cloudinary PDF upload error:', err);
                    return res.status(500).json({ message: 'Failed to upload PDF' });
                }

                submission.reportUrl = result.secure_url;
                submission.status = 'reported';
                await submission.save();

                res.json({ message: 'Report generated successfully', reportUrl: submission.reportUrl });
            }
        );

        // Write PDF
        doc.fontSize(20).text('OralVis Report', { align: 'center' });
        doc.moveDown();
        doc.fontSize(14).text(`Patient Name: ${submission.name}`);
        doc.text(`Patient ID: ${submission.patientId}`);
        doc.text(`Email: ${submission.email}`);
        doc.text(`Note: ${submission.note || 'N/A'}`);
        doc.text(`Original Image: ${submission.imageUrl}`);
        if (submission.annotatedImageUrl) doc.text(`Annotated Image: ${submission.annotatedImageUrl}`);
        doc.end();

        doc.pipe(cloudinaryUpload);
    } catch (error) {
        console.error('Generate report error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
