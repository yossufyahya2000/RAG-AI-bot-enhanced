import { GoogleGenerativeAI } from '@google/generative-ai';
import { Embeddings } from "@langchain/core/embeddings";

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
    const batchSize = 10; // Process 10 chunks at a time
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
      const embeddingResult = await this.embeddingModel.embedContent(text);
      return embeddingResult.embedding.values;
    } catch (error) {
      if (retries > 0) {
        console.log(`Retrying embedding (${retries} attempts remaining)...`);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
        return this.embedQuery(text, retries - 1);
      }
      throw error;
    }
  }
}

// Initialize embeddings
const embeddings = new GeminiEmbeddings(genAI);

export { model, embeddings };