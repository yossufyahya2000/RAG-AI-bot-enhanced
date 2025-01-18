import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";

// Configure text splitter with optimal chunk size and overlap
const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000, // Optimal chunk size for embeddings
    chunkOverlap: 200, // Maintain context between chunks
    separators: ["\n\n", "\n", " ", ""] // Split on paragraphs, lines, and words
});

/**
 * Splits document content into manageable chunks
 * @param {Document[]} documents - Array of LangChain documents
 * @returns {Promise<Document[]>} - Array of chunked documents
 */
export async function splitDocuments(documents) {
    try {
        // Split each document's content into chunks
        const splitDocs = await textSplitter.splitDocuments(documents);
        
        // Add metadata to track original document
        return splitDocs.map((doc, index) => ({
            ...doc,
            metadata: {
                ...doc.metadata,
                chunkIndex: index,
                totalChunks: splitDocs.length
            }
        }));
    } catch (error) {
        console.error('Error splitting documents:', error);
        throw error;
    }
}