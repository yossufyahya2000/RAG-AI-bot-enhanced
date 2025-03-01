import express from 'express';
import { app } from './config.js';
import { upload } from './uploadConfig.js';
import { model, embeddings } from './gemini.js';
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { splitDocuments } from './textSplitter.js';
import fs from 'fs';
import { join } from 'path';
import { 
    initSession, 
    storeDocumentChunks, 
    searchSimilarChunks, 
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

    // Create new session if none exists
    const { data, error } = await supabase
        .from('sessions')
        .insert({})
        .select()
        .single();

    if (error) {
        return res.status(500).json({ error: 'Failed to create session' });
    }

    req.sessionId = data.id;
    res.setHeader('X-Session-Id', data.id);
    next();
};

// Apply session middleware to all routes
app.use(getSession);

// Serve the HTML interface
app.get('/', (req, res) => {
    res.sendFile(join(__dirname, '../public/index.html'));
});

// Function to get or create a conversation for a session
async function getConversationHistory(sessionId) {
    // Check for existing conversation
    let { data: existing } = await supabase
        .from('conversations')
        .select('id')
        .eq('session_id', sessionId)
        .single();

    let conversationId;
    if (existing) {
        conversationId = existing.id;
    } else {
        // Create new conversation if none exists
        const { data, error } = await supabase
            .from('conversations')
            .insert({ session_id: sessionId })
            .select()
            .single();

        if (error) throw error;
        conversationId = data.id;
    }

    // Fetch messages for the conversation
    const { data: messages, error: messagesError } = await supabase
        .from('messages')
        .select('role, content')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

    if (messagesError) throw messagesError;

    return { 
        conversationId, 
        messages: messages || [] 
    };
}

// Function to store a message in the conversation
async function storeMessage(conversationId, role, content) {
    const { error } = await supabase
        .from('messages')
        .insert({
            conversation_id: conversationId,
            role: role,
            content: content
        });

    if (error) throw error;
}

// Function to get documents for a session
async function getSessionDocuments(sessionId) {
    const { data, error } = await supabase
        .from('documents')
        .select('filename, page_count')
        .eq('session_id', sessionId);
    
    if (error) throw error;
    return data;
}

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

// Function to store document info
async function storeDocumentInfo(sessionId, filename, pageCount) {
    const { error } = await supabase
        .from('documents')
        .insert({
            session_id: sessionId,
            filename: filename,
            page_count: pageCount
        });

    if (error) {
        throw new Error(`Failed to store document info: ${error.message}`);
    }
}

// Handle PDF upload
app.post('/upload', upload.array('pdf', 10), async (req, res) => {
    const files = req.files;
    let totalPages = 0;
    
    try {
        // Get conversation for system message
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
                console.log('Processing PDF:', file.path);
                const loader = new PDFLoader(file.path);
                const docs = await loader.load();
                
                if (docs.length === 0) {
                    throw new Error(`No content extracted from PDF: ${file.originalname}`);
                }

                // Split documents into chunks
                const chunkedDocs = await splitDocuments(docs);
                
                // Add documents to local vector store
                await embeddings.addDocuments(chunkedDocs);

                // Store document info in Supabase
                await storeDocumentInfo(
                    req.sessionId,
                    file.originalname,
                    chunkedDocs.length
                );

                totalPages += chunkedDocs.length;

                await storeMessage(
                    conversationId,
                    'assistant',
                    `Processed "${file.originalname}" with ${chunkedDocs.length} pages.`
                );
            } finally {
                // Cleanup temporary file
                if (fs.existsSync(file.path)) {
                    fs.unlinkSync(file.path);
                }
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
            return res.status(400).json({ error: 'File upload is required' });
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

        // Generate streaming response using local RAG
        const result = await embeddings.generateStreamingResponse(question, recentMessages);

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
        if (req.sessionId) {
            // Clear the vector store
            await embeddings.clearVectorStore();
            
            // Delete old session from Supabase
            await supabase
                .from('sessions')
                .delete()
                .eq('id', req.sessionId);
        }

        // Create new session
        const { data, error } = await supabase
            .from('sessions')
            .insert({})
            .select()
            .single();

        if (error) throw error;

        res.setHeader('X-Session-Id', data.id);
        res.json({ 
            message: 'Session reset successfully',
            sessionId: data.id 
        });
    } catch (error) {
        console.error('Error resetting session:', error);
        res.status(500).json({ error: 'Error resetting session' });
    }
});

export default app;
