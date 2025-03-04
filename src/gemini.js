import { GoogleGenerativeAI } from '@google/generative-ai';
import { Embeddings } from "@langchain/core/embeddings";
import { Document } from "@langchain/core/documents";
import { supabase } from './supabaseClient.js';

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

class GeminiEmbeddings extends Embeddings {
  constructor(genAI) {
    super();
    this.genAI = genAI;
    this.embeddingModel = this.genAI.getGenerativeModel({ model: "models/text-embedding-004" });
  }

  async embedDocuments(texts) {
    const batchSize = 5;
    const batches = [];
    
    for (let i = 0; i < texts.length; i += batchSize) {
      batches.push(texts.slice(i, i + batchSize));
    }

    const results = [];
    for (const batch of batches) {
      try {
        const embeddings = await Promise.all(
          batch.map(text => this.embedQuery(text))
        );
        results.push(...embeddings);
      } catch (error) {
        console.error('Error embedding batch:', error);
        throw error;
      }
    }
    return results;
  }

  async embedQuery(text, retries = 3) {
    try {
      const cleanedText = text.replace(/\n/g, ' ').trim();
      const truncatedText = cleanedText.slice(0, 2048);

      const result = await this.embeddingModel.embedContent(truncatedText);
      if (!result || !result.embedding || !result.embedding.values) {
        throw new Error('Invalid embedding response');
      }
      return result.embedding.values;
    } catch (error) {
      if (retries > 0) {
        console.log(`Retrying embedding (${retries} attempts remaining)...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        return this.embedQuery(text, retries - 1);
      }
      console.error('Embedding error:', error);
      throw new Error(`Failed to generate embedding: ${error.message}`);
    }
  }

  async similaritySearch(query, k = 5, sessionId) {
    try {
      if (!sessionId) {
        throw new Error('Session ID is required for similarity search');
      }

      const queryEmbedding = await this.embedQuery(query);
      
      // Get document IDs for the current session
      const { data: sessionDocs, error: sessionError } = await supabase
        .from('documents')
        .select('id')
        .eq('session_id', sessionId);

      if (sessionError) throw sessionError;
      
      if (!sessionDocs || sessionDocs.length === 0) {
        return [];
      }

      const documentIds = sessionDocs.map(doc => doc.id);

      // Use enhanced search_document_chunks function
      const { data: results, error } = await supabase.rpc(
        'search_document_chunks',
        {
          query_embedding: queryEmbedding,
          similarity_threshold: 0.3, // Slightly lower threshold to catch more context
          max_results: k + 2, // Get extra results for context
          session_document_ids: documentIds
        }
      );

      if (error) throw error;

      // Group results by document and sort by chunk_index
      const groupedResults = results.reduce((acc, result) => {
        if (!acc[result.document_id]) {
          acc[result.document_id] = [];
        }
        acc[result.document_id].push(result);
        return acc;
      }, {});

      // Process each document's chunks to include context
      const processedResults = Object.values(groupedResults)
        .flatMap(chunks => {
          chunks.sort((a, b) => a.chunk_index - b.chunk_index);
          return chunks;
        })
        .slice(0, k) // Limit to original k after processing
        .map(result => new Document({
          pageContent: result.content,
          metadata: {
            ...result.metadata,
            similarity: result.similarity,
            chunk_index: result.chunk_index,
            document_id: result.document_id
          }
        }));
      console.log('Processed results:', processedResults);
      return processedResults;
    } catch (error) {
      console.error('Error in similarity search:', error);
      return [];
    }
  }

  async generateResponse(prompt, retries = 2) {
    try {
      const result = await model.generateContent(prompt);
      const response = await result.response;
      return response.text();
    } catch (error) {
      if (retries > 0) {
        console.log(`Retrying response generation (${retries} attempts remaining)...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        return this.generateResponse(prompt, retries - 1);
      }
      console.error('Response generation error:', error);
      throw new Error(`Failed to generate response: ${error.message}`);
    }
  }

  async generateStreamingResponse(query, conversationHistory = [], k = 9, sessionId) {
    try {
      // Search for relevant documents using similarity search
      const relevantDocs = await this.similaritySearch(query, k, sessionId);
      const conversationContext = conversationHistory
          .map(msg => `${msg.role}: ${msg.content}`)
          .join('\n');
      
      let finalPrompt;
      if (relevantDocs.length === 0) {
        finalPrompt = `You are a helpful AI assistant. Please answer the following question to the best of your ability:
        
        ${conversationContext ? `Previous conversation:\n${conversationContext}\n` : ''}

        Question: ${query}

        Please provide a general response based on your knowledge and tell the user that there is no context available for this question.
        Give a good text formatting to your response`;
      } else {
        const context = relevantDocs
          .map(doc => doc.pageContent)
          .join('\n\n');

        finalPrompt = `You are a helpful AI assistant. Use the following context and conversation history to answer the user's question.
        Give a good text formatting to your response.

        Context from documents:
        ${context}

        ${conversationContext ? `Previous conversation:\n${conversationContext}\n` : ''}

        Current question: ${query}

        Answer:`;
      }

      const result = await model.generateContentStream(finalPrompt);
      return result;
    } catch (error) {
      console.error('Streaming response generation error:', error);
      throw new Error(`Failed to generate streaming response: ${error.message}`);
    }
  }
}

// Initialize embeddings
const embeddings = new GeminiEmbeddings(genAI);

export { model, embeddings };
