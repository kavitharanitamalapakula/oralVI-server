const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const { body, validationResult } = require('express-validator');
const Submission = require('../models/Submission');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const cloudinary = require('cloudinary').v2;

const router = express.Router();

// Configure multer for file uploads
const storage = multer.memoryStorage();

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed!'), false);
        }
    }
});

// Upload submission with S3 storage
router.post('/upload', [
    authenticateToken,
    authorizeRoles('patient'),
    upload.single('image')
], [
    body('name').notEmpty().withMessage('Name is required'),
    body('patientId').notEmpty().withMessage('Patient ID is required'),
    body('email').isEmail().withMessage('Valid email is required'),
    body('note').optional()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        if (!req.file) {
            return res.status(400).json({ message: 'Image file is required' });
        }

        const { name, patientId, email, note } = req.body;

        // Upload image to Cloudinary
        const cloudinaryResult = await cloudinary.uploader.upload(`data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`, {
            folder: 'oralvis/submissions',
            public_id: `${Date.now()}_${req.file.originalname.split('.')[0]}`,
            resource_type: 'image'
        });

        const submission = new Submission({
            patient: req.user._id,
            name,
            patientId,
            email,
            note,
            imageUrl: cloudinaryResult.secure_url
        });

        await submission.save();

        res.status(201).json({
            message: 'Submission uploaded successfully',
            submission: {
                id: submission._id,
                name: submission.name,
                patientId: submission.patientId,
                email: submission.email,
                note: submission.note,
                imageUrl: submission.imageUrl,
                status: submission.status,
                createdAt: submission.createdAt
            }
        });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.get('/submissions', authenticateToken, authorizeRoles('patient'), async (req, res) => {
    try {
        const submissions = await Submission.find({ patient: req.user._id })
            .sort({ createdAt: -1 });

        res.json(submissions);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

router.get('/submissions/:id', authenticateToken, authorizeRoles('patient'), async (req, res) => {
    try {
        const submission = await Submission.findOne({
            _id: req.params.id,
            patient: req.user._id
        });

        if (!submission) {
            return res.status(404).json({ message: 'Submission not found' });
        }

        res.json(submission);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

router.post('/save-annotated/:id', [
    authenticateToken,
    authorizeRoles('patient')
], async (req, res) => {
    try {
        const { annotatedImageData } = req.body;

        if (!annotatedImageData) {
            return res.status(400).json({ message: 'Annotated image data is required' });
        }

        const submission = await Submission.findOne({
            _id: req.params.id,
            patient: req.user._id
        });

        if (!submission) {
            return res.status(404).json({ message: 'Submission not found' });
        }

        const cloudinaryResult = await cloudinary.uploader.upload(annotatedImageData, {
            folder: 'oralvis/annotated',
            public_id: `${Date.now()}_annotated_${req.params.id}`,
            resource_type: 'image'
        });

        submission.annotatedImageUrl = cloudinaryResult.secure_url;
        submission.status = 'annotated';
        await submission.save();

        res.json({
            message: 'Annotated image saved successfully',
            annotatedImageUrl: submission.annotatedImageUrl
        });
    } catch (error) {
        console.error('Save annotated error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Generate PDF report
router.post('/generate-report/:id', [
    authenticateToken,
    authorizeRoles('patient')
], async (req, res) => {
    try {
        const submission = await Submission.findOne({
            _id: req.params.id,
            patient: req.user._id
        });

        if (!submission) {
            return res.status(404).json({ message: 'Submission not found' });
        }

        // Generate PDF
        const doc = new PDFDocument();
        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', async () => {
            const pdfBuffer = Buffer.concat(chunks);

            // Upload PDF to Cloudinary
            const cloudinaryResult = await cloudinary.uploader.upload(`data:application/pdf;base64,${pdfBuffer.toString('base64')}`, {
                folder: 'oralvis/reports',
                public_id: `${Date.now()}_report_${req.params.id}`,
                resource_type: 'raw'
            });

            // Update submission
            submission.reportUrl = cloudinaryResult.secure_url;
            submission.status = 'reported';
            await submission.save();

            res.json({
                message: 'Report generated successfully',
                reportUrl: submission.reportUrl
            });
        });

        doc.fontSize(20).text('OralVis Report', { align: 'center' });
        doc.moveDown();
        doc.fontSize(14).text(`Patient Name: ${submission.name}`);
        doc.text(`Patient ID: ${submission.patientId}`);
        doc.text(`Email: ${submission.email}`);
        doc.text(`Note: ${submission.note || 'N/A'}`);
        doc.moveDown();
        doc.text('Links:');
        doc.text(`Original Image: ${submission.imageUrl}`);
        if (submission.annotatedImageUrl) {
            doc.text(`Annotated Image: ${submission.annotatedImageUrl}`);
        }
        doc.end();
    } catch (error) {
        console.error('Generate report error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
