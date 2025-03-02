import { GoogleGenerativeAI } from '@google/generative-ai';
import { Embeddings } from "@langchain/core/embeddings";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { Document } from "@langchain/core/documents";

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

class GeminiEmbeddings extends Embeddings {
  constructor(genAI) {
    super();
    this.genAI = genAI;
    this.embeddingModel = this.genAI.getGenerativeModel({ model: "models/text-embedding-004" });
    this.vectorStore = new MemoryVectorStore(this);
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

  async addDocuments(documents) {
    const docs = documents.map(doc => {
      return new Document({
        pageContent: doc.pageContent,
        metadata: {
          source: doc.metadata?.source || '',
          page: doc.metadata?.page || 0
        }
      });
    });

    await this.vectorStore.addDocuments(docs);
    return docs.length;
  }

  async similaritySearch(query, k = 5) {
    try {
      const results = await this.vectorStore.similaritySearch(query, k);
      return results;
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

  async generateStreamingResponse(query, conversationHistory = [], k = 5) {
    try {
      // Search for relevant documents
      const relevantDocs = await this.similaritySearch(query, k);
      
      let finalPrompt;
      if (relevantDocs.length === 0) {
        finalPrompt = `You are a helpful AI assistant. Please answer the following question to the best of your ability:

Question: ${query}

Please provide a general response based on your knowledge.
give your responces a good Text formatting `;
      } else {
        const context = relevantDocs
          .map(doc => doc.pageContent)
          .join('\n\n');

        const conversationContext = conversationHistory
          .map(msg => `${msg.role}: ${msg.content}`)
          .join('\n');

        finalPrompt = `You are a helpful AI assistant. Use the following context and conversation history to answer the user's question.
Be concise and specific in your response.

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

  async clearVectorStore() {
    this.vectorStore = new MemoryVectorStore(this);
  }
}

// Initialize embeddings
const embeddings = new GeminiEmbeddings(genAI);

export { model, embeddings };
