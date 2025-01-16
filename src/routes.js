import express from 'express';
import { app } from './config.js';
import { upload } from './uploadConfig.js';
import { model, embeddings } from './gemini.js';
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import fs from 'fs';
import { join } from 'path';

// Initialize Vector Store and file data mapping
let vectorStore;
const fileDataMap = new Map();

app.use(express.json());
app.use(express.static('public'));

// Serve the HTML interface
app.get('/', (req, res) => {
  res.sendFile(join(__dirname, '../public/index.html'));
});

// Handle PDF upload
app.post('/upload', upload.array('pdf'), async (req, res) => {
    try {
        const files = req.files;
        if (!files || files.length === 0) {
            return res.status(400).json({ error: 'No PDF files uploaded' });
        }

        let totalPages = 0;
        let allDocs = [];

        for (const file of files) {
            console.log('Processing PDF:', file.path);

            // Load and process the PDF
            const loader = new PDFLoader(file.path);
            console.log('Loading PDF contents...');
            const docs = await loader.load();
            console.log(`Loaded ${docs.length} pages from PDF`);

            if (docs.length === 0) {
                throw new Error(`No content extracted from PDF: ${file.originalname}`);
            }

            // Store the document data with the filename as key
            fileDataMap.set(file.originalname, docs);
            allDocs = [...allDocs, ...docs];
            totalPages += docs.length;

            // Clean up uploaded file after processing
            fs.unlinkSync(join('/tmp/uploads', file.originalname));
          }

        console.log('Updating vector store...');
        // Create or update vector store with all documents
        if (vectorStore) {
            await vectorStore.addDocuments(allDocs);
        } else {
            vectorStore = await MemoryVectorStore.fromDocuments(allDocs, embeddings);
        }
        console.log('Vector store updated successfully');

        res.json({ message: 'PDFs processed successfully', pages: totalPages });
    } catch (error) {
        console.error('Error processing PDF:', error);
        // Clean up files if there was an error
        if (req.files) {
            req.files.forEach(file => {
                if (fs.existsSync(file.path)) {
                    fs.unlinkSync(file.path);
                }
            });
        }
        res.status(500).json({ error: error.message || 'Error processing PDF' });
    }
});

// Handle PDF deletion
app.delete('/delete', async (req, res) => {
    try {
        const { filename } = req.body;
        
        if (!filename || !fileDataMap.has(filename)) {
            return res.status(404).json({ error: 'File not found' });
        }

        // Remove from file data map
        fileDataMap.delete(filename);

        // Get all remaining documents from the map
        const remainingDocs = Array.from(fileDataMap.values()).flat();

        // Recreate vector store with remaining documents
        vectorStore = await MemoryVectorStore.fromDocuments(remainingDocs, embeddings);

        res.json({ message: `${filename} deleted successfully` });
    } catch (error) {
        console.error('Error deleting file:', error);
        res.status(500).json({ error: 'Error deleting file' });
    }
});

// Handle questions
app.post('/ask', async (req, res) => {
  try {
    const { question } = req.body;
    
    if (!vectorStore) {
      return res.status(400).json({ error: 'Please upload a PDF first' });
    }
    
    // Search for relevant documents across all files
    const relevantDocs = await vectorStore.similaritySearch(question, 3);
    
    // Create context from relevant documents
    const context = relevantDocs.map(doc => doc.pageContent).join('\n');
    
    // Generate response using Gemini
    const prompt = `Context: ${context}\n\nQuestion: ${question}\n\nAnswer:`;
    const result = await model.generateContent(prompt);
    const response = result.response.text();
    
    res.json({ answer: response });
  } catch (error) {
    console.error('Error processing question:', error);
    res.status(500).json({ error: 'Error processing question' });
  }
});

export default app;
