import express from 'express';
import { app } from './config.js';
import { upload } from './uploadConfig.js';
import { model, embeddings } from './gemini.js';
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { splitDocuments } from './textSplitter.js';
import { join } from 'path';
import { 
    initSession, 
    storeDocumentChunks,
    getSessionDocuments,
    createConversation,
    storeMessage,
    getConversationHistory,
    supabase
} from './supabaseClient.js';

app.use(express.json());
app.use(express.static('public'));

// Middleware to get or create session
const getSession = async (req, res, next) => {
    const sessionId = req.headers['x-session-id'];
    
    if (sessionId) {
        // Verify session exists and update last_active
        const { data, error } = await supabase
            .from('sessions')
            .select('id')
            .eq('id', sessionId)
            .single();

        if (data) {
            // Update last_active
            await supabase
                .from('sessions')
                .update({ last_active: new Date().toISOString() })
                .eq('id', sessionId);
                
            req.sessionId = sessionId;
            return next();
        }
    }

    try {
        const newSessionId = await initSession();
        req.sessionId = newSessionId;
        res.setHeader('X-Session-Id', newSessionId);
        next();
    } catch (error) {
        res.status(500).json({ error: 'Failed to create session' });
    }
};

// Apply session middleware to all routes
app.use(getSession);

// Serve the HTML interface
app.get('/', (req, res) => {
    res.sendFile(join(__dirname, '../public/index.html'));
});

// Function to check if it's the first file upload
async function isFirstFileUpload(sessionId) {
    const { data, error } = await supabase
        .from('documents')
        .select('id')
        .eq('session_id', sessionId)
        .limit(1);
    
    if (error) {
        console.error('Error checking first upload:', error);
        return false;
    }
    
    return !data || data.length === 0;
}

// Handle PDF upload
app.post('/upload', upload.array('pdf', 10), async (req, res) => {
    const files = req.files;
    let totalPages = 0;
    
    try {
        const { conversationId } = await getConversationHistory(req.sessionId);
        const isFirst = await isFirstFileUpload(req.sessionId);

        if (isFirst) {
            await storeMessage(
                conversationId,
                'assistant',
                `Welcome! I've received your first PDF${files.length > 1 ? 's' : ''}. You can now ask questions about the document${files.length > 1 ? 's' : ''}.`
            );
        }

        for (const file of files) {
            try {
                console.log('Processing PDF:', file.originalname);
                
                // Convert Buffer to Blob
                const blob = new Blob([file.buffer], { type: 'application/pdf' });
                
                // Load PDF from Blob
                const loader = new PDFLoader(blob);
                const docs = await loader.load();
                
                if (docs.length === 0) {
                    throw new Error(`No content extracted from PDF: ${file.originalname}`);
                }

                // Split documents into chunks
                const chunkedDocs = await splitDocuments(docs);
                
                // Generate embeddings and prepare chunks for storage
                const chunksWithEmbeddings = await Promise.all(
                    chunkedDocs.map(async (doc) => ({
                        pageContent: doc.pageContent,
                        embedding: await embeddings.embedQuery(doc.pageContent),
                        metadata: doc.metadata
                    }))
                );

                // Store chunks directly in Supabase
                await storeDocumentChunks(
                    req.sessionId,
                    file.originalname,
                    chunksWithEmbeddings,
                    docs.length
                );

                totalPages += docs.length;

                await storeMessage(
                    conversationId,
                    'assistant',
                    `Processed "${file.originalname}" with ${docs.length} pages.`
                );
            } catch (error) {
                console.error(`Error processing ${file.originalname}:`, error);
                throw error;
            }
        }

        // Get updated list of files for the session
        const sessionFiles = await getSessionDocuments(req.sessionId);

        res.json({ 
            message: 'PDFs processed successfully', 
            pages: totalPages,
            sessionId: req.sessionId,
            isFirstUpload: isFirst,
            files: sessionFiles
        });
    } catch (error) {
        console.error('Error processing PDF:', error);
        res.status(500).json({ error: error.message || 'Error processing PDF' });
    }
});

// Handle PDF deletion
app.delete('/delete', async (req, res) => {
    try {
        const { filename } = req.body;
        
        if (!filename) {
            return res.status(400).json({ error: 'Filename is required' });
        }

        const { error } = await supabase
            .from('documents')
            .delete()
            .match({ 
                session_id: req.sessionId,
                filename: filename 
            });

        if (error) throw error;
        res.json({ message: `${filename} deleted successfully` });
    } catch (error) {
        console.error('Error deleting file:', error);
        res.status(500).json({ error: 'Error deleting file' });
    }
});

app.post('/ask', async (req, res) => {
    try {
        const { question } = req.body;
        
        if (!question) {
            return res.status(400).json({ error: 'Question is required' });
        }

        // Get conversation history
        const { conversationId, messages } = await getConversationHistory(req.sessionId);

        // Store user's question
        await storeMessage(conversationId, 'user', question);

        // Set up streaming response
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        // Get recent messages for context (last 5 messages)
        const recentMessages = messages.slice(-5);

        // Generate streaming response using Supabase for similarity search
        const result = await embeddings.generateStreamingResponse(
            question, 
            recentMessages,
            5, // k value
            req.sessionId
        );

        let responseText = '';
        for await (const chunk of result.stream) {
            const chunkText = chunk.text();
            responseText += chunkText;
            res.write(JSON.stringify({ chunk: chunkText }) + '\n');
        }

        // Store assistant's response
        await storeMessage(conversationId, 'assistant', responseText);
        
        res.end();
    } catch (error) {
        console.error('Error in /ask endpoint:', error);
        res.status(500).json({ error: error.message || 'Error processing question' });
    }
});

// Reset session
app.post('/reset-session', async (req, res) => {
    try {
        // Delete session and all related data will be cascaded
        const { error } = await supabase
            .from('sessions')
            .delete()
            .eq('id', req.sessionId);

        if (error) throw error;

        // Create new session
        const newSessionId = await initSession();
        
        res.json({ 
            message: 'Session reset successfully',
            sessionId: newSessionId
        });
    } catch (error) {
        console.error('Error resetting session:', error);
        res.status(500).json({ error: 'Error resetting session' });
    }
});

export default app;
