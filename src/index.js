import express from 'express';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { Embeddings } from "@langchain/core/embeddings";
import fs from 'fs';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

// Configure multer to store files in uploads directory
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    if (!fs.existsSync('uploads')) {
      fs.mkdirSync('uploads');
    }
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname);
  }
});
//

const upload = multer({ storage: storage });

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });

// Custom embeddings class using Gemini
class GeminiEmbeddings extends Embeddings {
  constructor(genAI) {
    super();
    this.genAI = genAI;
    this.embeddingModel = this.genAI.getGenerativeModel({ model: "models/text-embedding-004" });
  }

  async embedDocuments(texts) {
    return Promise.all(texts.map(text => this.embedQuery(text)));
  }

  async embedQuery(text) {
    const embeddingResult = await this.embeddingModel.embedContent(text);
    return embeddingResult.embedding.values;
  }
}

// Initialize embeddings
const embeddings = new GeminiEmbeddings(genAI);

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
            fs.unlinkSync(file.path);
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});