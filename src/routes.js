import express from 'express';
import { app } from './config.js';
import { upload } from './uploadConfig.js';
import { model, embeddings } from './gemini.js';
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import fs from 'fs';
import { join } from 'path';
import { sessionConfig } from './sessionConfig.js';

app.use(express.json());
app.use(express.static('public'));
app.use(sessionConfig);

// Serve the HTML interface
app.get('/', (res) => {
    res.sendFile(join(__dirname, '../public/index.html'));
});

// Handle PDF upload
app.post('/upload', upload.array('pdf'), async (req, res) => {
    try {
        if (!req.session.fileDataMap) {
            req.session.fileDataMap = {};
        }
        if (!req.session.vectorStore) {
            req.session.vectorStore = null;
        }

        const files = req.files;
        if (!files || files.length === 0) {
            return res.status(400).json({ error: 'No PDF files uploaded' });
        }

        let totalPages = 0;
        let allDocs = [];

        for (const file of files) {
            try {
                console.log('Processing PDF:', file.path);
                const loader = new PDFLoader(file.path);
                const docs = await loader.load();
                
                if (docs.length === 0) {
                    throw new Error(`No content extracted from PDF: ${file.originalname}`);
                }

                req.session.fileDataMap[file.originalname] = docs;
                allDocs = [...allDocs, ...docs];
                totalPages += docs.length;
            } finally {
                // Ensure file cleanup happens whether processing succeeds or fails
                if (fs.existsSync(file.path)) {
                    fs.unlinkSync(file.path);
                    console.log(`Deleted file: ${file.path}`);
                }
            }
        }

        req.session.documents = allDocs;
        res.json({ message: 'PDFs processed successfully', pages: totalPages });
    } catch (error) {
        console.error('Error processing PDF:', error);
        res.status(500).json({ error: error.message || 'Error processing PDF' });
    }
});
// Handle PDF deletion
app.delete('/delete', async (req, res) => {
    try {
        const { filename } = req.body;
        
        if (!filename || !req.session.fileDataMap[filename]) {
            return res.status(404).json({ error: 'File not found' });
        }
        
        // Remove from file data map
        delete req.session.fileDataMap[filename];
        
        // Get all remaining documents
        const remainingDocs = Object.values(req.session.fileDataMap).flat();
        req.session.documents = remainingDocs;

        res.json({ message: `${filename} deleted successfully` });
    } catch (error) {
        console.error('Error deleting file:', error);
        res.status(500).json({ error: 'Error deleting file' });
    }
});

app.post('/ask', async (req, res) => {
  try {
    const { question } = req.body;
    
    // Get all documents from all PDFs in fileDataMap
    const allDocuments = Object.values(req.session.fileDataMap).flat();
    
    if (!allDocuments || allDocuments.length === 0) {
      return res.status(400).json({ error: 'Please upload a PDF first' });
    }
    
    // Create vector store with all documents
    const vectorStore = await MemoryVectorStore.fromDocuments(allDocuments, embeddings);
    
    // Search for relevant documents across all files
    const relevantDocs = await vectorStore.similaritySearch(question, 2);
    
    // Create context from relevant documents
    const context = relevantDocs.map(doc => doc.pageContent).join('\n');
    
    // Generate streaming response using Gemini
    const prompt = `Context: ${context}\n\nQuestion: ${question}\n\nAnswer:`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    const result = await model.generateContentStream(prompt);
    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      res.write(JSON.stringify({ chunk: chunkText }) + '\n');
    }
    res.end();
  } catch (error) {
    console.error('Error processing question:', error);
    res.status(500).json({ error: 'Error processing question' });
  }
});


// Reset session documents on page refresh
app.get('/reset-session', (req, res) => {
    req.session.documents = null;
    req.session.fileDataMap = {};
    req.session.vectorStore = null;
    res.json({ message: 'Session reset successfully' });});

export default app;


