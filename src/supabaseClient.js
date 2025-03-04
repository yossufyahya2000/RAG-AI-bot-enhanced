import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey);

export async function initSession() {
    const { data, error } = await supabase
        .from('sessions')
        .insert({})
        .select()
        .single();
    
    if (error) throw error;
    return data.id;
}

export async function storeDocumentChunks(sessionId, filename, chunks, pageCount = null) {
    try {
        // First, insert the document and get its ID
        const { data: doc, error: docError } = await supabase
            .from('documents')
            .insert({
                session_id: sessionId,
                filename: filename,
                page_count: pageCount || chunks.length
            })
            .select()
            .single();
        
        if (docError) {
            console.error('Error storing document:', docError);
            throw docError;
        }

        // Then, insert all chunks with the document_id reference
        const chunksToInsert = chunks.map((chunk, index) => ({
            document_id: doc.id,
            content: chunk.pageContent,
            embedding: chunk.embedding,
            metadata: chunk.metadata,
            chunk_index: index
        }));

        const { error: chunksError } = await supabase
            .from('document_chunks')
            .insert(chunksToInsert);

        if (chunksError) {
            console.error('Error storing chunks:', chunksError);
            throw chunksError;
        }

        return doc.id;
    } catch (error) {
        console.error('Error in storeDocumentChunks:', error);
        throw error;
    }
}


export async function getSessionDocuments(sessionId) {
    const { data, error } = await supabase
        .from('documents')
        .select('filename, page_count')
        .eq('session_id', sessionId);
    
    if (error) throw error;
    return data;
}

export async function createConversation(sessionId) {
    const { data, error } = await supabase
        .from('conversations')
        .insert({ session_id: sessionId })
        .select()
        .single();
    
    if (error) throw error;
    return data;
}

export async function storeMessage(conversationId, role, content) {
    const { data, error } = await supabase
        .from('messages')
        .insert({
            conversation_id: conversationId,
            role,
            content
        })
        .select()
        .single();
    
    if (error) throw error;
    return data;
}

export async function getConversationHistory(sessionId) {
    const { data: conversation, error: convError } = await supabase
        .from('conversations')
        .select('id')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    if (convError) {
        // If no conversation exists, create one
        const newConversation = await createConversation(sessionId);
        return { conversationId: newConversation.id, messages: [] };
    }

    const { data: messages, error: msgError } = await supabase
        .from('messages')
        .select('role, content')
        .eq('conversation_id', conversation.id)
        .order('created_at', { ascending: false })
        .limit(10);

    if (msgError) throw msgError;
    return { conversationId: conversation.id, messages: messages.reverse() };
}
