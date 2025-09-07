const express = require('express');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const axios = require('axios');
const { body, validationResult } = require('express-validator');
const Submission = require('../models/Submission');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const cloudinary = require('cloudinary').v2;

const router = express.Router();

// all submissions
router.get('/submissions', authenticateToken, authorizeRoles('admin'), async (req, res) => {
    try {
        const submissions = await Submission.find()
            .populate('patient', 'name email patientId')
            .sort({ createdAt: -1 });
        res.json(submissions);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Get submission by ID
router.get('/submissions/:id', authenticateToken, authorizeRoles('admin'), async (req, res) => {
    try {
        const submission = await Submission.findById(req.params.id)
            .populate('patient', 'name email patientId');
        if (!submission) {
            return res.status(404).json({ message: 'Submission not found' });
        }
        res.json(submission);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

router.post('/submissions/:id/annotate', authenticateToken, authorizeRoles('admin'), [
    body('annotationJson').notEmpty().withMessage('Annotation JSON is required'),
    body('annotatedImage').notEmpty().withMessage('Annotated image is required')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { annotationJson, annotatedImage } = req.body;

        const submission = await Submission.findById(req.params.id);
        if (!submission) {
            return res.status(404).json({ message: 'Submission not found' });
        }

        const cloudinaryResult = await cloudinary.uploader.upload(annotatedImage, {
            folder: 'oralvis/annotated',
            public_id: `${Date.now()}_annotated`,
            resource_type: 'image'
        });

        submission.annotationJson = annotationJson;
        submission.annotatedImageUrl = cloudinaryResult.secure_url;
        submission.status = 'annotated';

        await submission.save();

        res.json({ message: 'Annotation saved successfully', submission });
    } catch (error) {
        console.error('Annotation save error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Generate PDF report
router.post(
    '/submissions/:id/generate-pdf',
    authenticateToken,
    authorizeRoles('admin'),
    async (req, res) => {
        try {
            const submission = await Submission.findById(req.params.id);
            if (!submission) {
                return res.status(404).json({ message: 'Submission not found' });
            }

            if (!submission.annotatedImageUrl) {
                return res
                    .status(400)
                    .json({ message: 'Annotated image is required to generate PDF' });
            }

            // Create PDF document
            const doc = new PDFDocument();
            const chunks = [];

            doc.on('data', chunk => chunks.push(chunk));
            doc.on('end', async () => {
                const pdfBuffer = Buffer.concat(chunks);

                try {
                    // Upload PDF to Cloudinary
                    const uploadStream = cloudinary.uploader.upload_stream(
                        {
                            folder: 'oralvis/reports',
                            public_id: `report-${submission._id}`,
                            resource_type: 'raw'
                        },
                        async (error, result) => {
                            if (error) {
                                console.error('Cloudinary PDF upload error:', error);
                                return res
                                    .status(500)
                                    .json({ message: 'Failed to upload PDF' });
                            }

                            submission.reportUrl = result.secure_url;
                            submission.status = 'reported';
                            await submission.save();

                            res.json({
                                message: 'PDF generated successfully',
                                reportUrl: result.secure_url
                            });
                        }
                    );

                    uploadStream.end(pdfBuffer);
                } catch (err) {
                    console.error('PDF upload error:', err);
                    res.status(500).json({ message: 'Server error' });
                }
            });

            // Add patient details
            doc.fontSize(20).text('OralVis Healthcare Report', { align: 'center' });
            doc.moveDown();
            doc.fontSize(14).text(`Name: ${submission.name}`);
            doc.text(`Patient ID: ${submission.patientId}`);
            doc.text(`Email: ${submission.email}`);
            doc.text(`Note: ${submission.note || 'N/A'}`);
            doc.text(`Upload Date: ${submission.createdAt.toLocaleString()}`);
            doc.moveDown();

            const response = await axios.get(submission.annotatedImageUrl, {
                responseType: 'arraybuffer'
            });
            const imageBuffer = Buffer.from(response.data, 'binary');

            doc.image(imageBuffer, {
                fit: [500, 400],
                align: 'center',
                valign: 'center'
            });

            doc.end();
        } catch (error) {
            console.error('PDF generation error:', error);
            res.status(500).json({ message: 'Server error' });
        }
    }
);

module.exports = router;
