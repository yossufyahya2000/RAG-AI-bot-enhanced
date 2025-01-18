# RAG AI Bot Enhanced

A Retrieval-Augmented Generation (RAG) AI bot that uses vector similarity search to provide contextually relevant responses.

## Test it from this link
https://3ynyeac3jv.us-east-1.awsapprunner.com/

## Features
- **Intelligent Question Answering**: Leverages vector similarity search to provide accurate, context-aware responses
- **Dynamic Context Retrieval**: Retrieves and utilizes the most relevant documents for each query (configurable count)
- **Web Interface**: User-friendly interface for interacting with the AI bot
- **Document Processing**: Advanced text splitting and processing capabilities for optimal information retrieval
- **Session Management**: Built-in session handling for continuous conversations
- **Scalable Architecture**: Designed for easy deployment and scaling

## Tech Stack
- **Backend**: Node.js, Express.js
- **AI/ML**: LangChain, Gemini SDK
- **Frontend**: HTML, CSS, JavaScript

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yossufyahya2000/RAG-AI-bot-enhanced.git
cd rag-ai-bot-enhanced
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file with your configuration:
```bash
cp .env.example .env
```

## Configuration

Edit the `.env` file with your specific settings:

```
API_KEY=your_api_key_here
EMBEDDINGS_MODEL=your_embeddings_model
MAX_SIMILAR_DOCS=3
```

## Usage

Start the development server:
```bash
npm start
```

Access the web interface at `http://localhost:3000`

## API Endpoints

### POST /ask
Ask a question and get a contextually relevant response.

**Request Body:**
```json
{
  "question": "Your question here"
}
```

**Response:**
```json
{
  "answer": "The generated response",
  "context": [
    "Relevant document 1",
    "Relevant document 2",
    "Relevant document 3"
  ]
}
```

## License

MIT License

Copyright (c) 2025 Yossuf Yahia

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.