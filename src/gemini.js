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
    return Promise.all(texts.map(text => this.embedQuery(text)));
  }

  async embedQuery(text) {
    const embeddingResult = await this.embeddingModel.embedContent(text);
    return embeddingResult.embedding.values;
  }
}

// Initialize embeddings
const embeddings = new GeminiEmbeddings(genAI);

export { model, embeddings };