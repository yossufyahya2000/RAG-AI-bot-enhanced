
var uploadedFiles = [];

function showUploadSection() {
    document.querySelector('.upload-section').style.display = 'block';
    document.getElementById('downloadSection').style.display = 'none';
    document.querySelector('.file-upload').style.display = 'block';
    document.getElementById('pdfInput').value = ''; // Clear file input
}

function showDownloadSection() {
    console.log('Showing download section');
    const downloadSection = document.getElementById('downloadSection');
    document.querySelector('.file-upload').style.display = 'none';
    downloadSection.style.display = 'block';
    document.getElementById('pdfInput').value = ''; // Clear file input
}

// Initialize based on whether we have files
if (uploadedFiles.length === 0) {
    showUploadSection();
} else {
    showDownloadSection();
}

function renderFileList() {
    const fileList = document.getElementById('fileList');
    fileList.innerHTML = uploadedFiles.map(file => `
        <div class="file-item">
            <span class="file-name">${file.name}</span>
            <span class="delete-icon" onclick="deleteFile('${file.name}')">🗑️</span>
        </div>
    `).join('');
    
    // Only show upload section if no files
    if (uploadedFiles.length === 0) {
        showUploadSection();
    } else {
        showDownloadSection();
    }
}

async function deleteFile(fileName) {
    try {
        const response = await fetch('/delete', {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ filename: fileName })
        });
        
        if (response.ok) {
            uploadedFiles = uploadedFiles.filter(file => file.name !== fileName);
            renderFileList();
            addMessage(`${fileName} deleted successfully`, 'bot')
        } else {
            const error = await response.json();
            throw new Error(error.error || 'Error deleting file');
        }
    } catch (error) {
        console.error('Error deleting file:', error);
        addMessage('Error deleting file: ' + error.message, 'bot');
    }
}

async function uploadPDF() {
    const loading = document.getElementById('uploadLoading');
    const fileInput = document.getElementById('pdfInput');
    const files = Array.from(fileInput.files);
    
    if (files.length === 0) {
        alert('Please select at least one PDF file');
        return;
    }
    
    loading.style.display = 'flex';
    
    try {
        const formData = new FormData();
        files.forEach(file => formData.append('pdf', file));

        const response = await fetch('/upload', {
            method: 'POST',
            body: formData,
            headers: sessionId ? {
                'X-Session-Id': sessionId
            } : {}
        });
        
        const result = await response.json();
        if (response.ok) {
            uploadedFiles = [...uploadedFiles, ...files];
            renderFileList();
            
            // Store session ID if it's the first upload
            if (result.sessionId) {
                sessionId = result.sessionId;
                localStorage.setItem('sessionId', sessionId);
            }

            // Add welcome message to chat if it's first upload
            if (result.isFirstUpload) {
                const chatContainer = document.getElementById('chatContainer');
                if (chatContainer) {
                    chatContainer.innerHTML = ''; // Clear any existing messages
                }
            }

            // The welcome message will be automatically added by the server
            // through the conversation system
        } else {
            throw new Error(result.error || 'Error uploading PDFs');
        }
    } catch (error) {
        console.error('Error:', error);
        addMessage('Error uploading PDFs: ' + error.message, 'bot');
    } finally {
        loading.style.display = 'none';
    }
}

function formatMessage(text) {
    // Process special formatting only if text contains markers
    if (!text.includes('```') && !text.includes('**') && !text.includes('* ')) {
        return text;
    }
    
    return marked.parse(text);
}

// Store session ID in localStorage
let sessionId = localStorage.getItem('sessionId');

// Function to make authenticated requests
async function makeRequest(url, options = {}) {
    if (sessionId) {
        options.headers = {
            ...options.headers,
            'X-Session-Id': sessionId
        };
    }
    return fetch(url, options);
}

// Initialize session on page load
window.addEventListener('load', async () => {
    const response = await makeRequest('/reset-session', { method: 'POST' });
    const data = await response.json();
    sessionId = data.sessionId;
    localStorage.setItem('sessionId', sessionId);
});

let isProcessing = false;

async function askQuestion() {
    if (isProcessing) return;
    
    const questionInput = document.getElementById('questionInput');
    const question = questionInput.value.trim();

    if (!question) return;
    
    try {
        isProcessing = true;

        // Add user message first
        addMessage(question, 'user');
        questionInput.value = '';

        if (uploadedFiles.length === 0) {
            addMessage('Please upload PDFs first', 'bot');
            return;
        }
        
        const chatContainer = document.getElementById('chatContainer');
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message bot-message';
        
        const loadingSpinner = document.createElement('div');
        loadingSpinner.className = 'text-loading-spinner';
        
        const messageContent = document.createElement('div');
        messageContent.className = 'message-content';
        messageContent.style.display = 'none';
        
        const timestamp = document.createElement('div');
        timestamp.className = 'message-timestamp';
        timestamp.textContent = new Date().toLocaleTimeString();
        
        messageDiv.appendChild(loadingSpinner);
        messageDiv.appendChild(messageContent);
        messageDiv.appendChild(timestamp);
        chatContainer.appendChild(messageDiv);

        let accumulatedText = '';

        const response = await fetch('/ask', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-Id': sessionId
            },
            body: JSON.stringify({ question })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Error processing question');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');

            for (const line of lines) {
                try {
                    const data = JSON.parse(line);
                    if (data.chunk) {
                        if (accumulatedText === '') {
                            messageDiv.querySelector('.text-loading-spinner').style.display = 'none';
                            messageContent.style.display = 'block';
                        }
                        accumulatedText += data.chunk;
                        messageContent.innerHTML = formatMessage(accumulatedText);
                        window.scrollTo({
                            top: document.body.scrollHeight,
                            behavior: 'smooth'
                        });
                    }
                } catch (error) {
                    console.error('Error parsing chunk:', error);
                }
            }
        }

    } catch (error) {
        console.error('Error processing question:', error);
        addMessage('Error processing question: ' + error.message, 'bot');
    } finally {
        isProcessing = false;
    }
}

function addMessage(text, sender) {
    const chatContainer = document.getElementById('chatContainer');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}-message`;
    
    const messageContent = document.createElement('div');
    messageContent.innerHTML = text.replace(/\n/g, '<br>');
    messageDiv.appendChild(messageContent);
    
    const timestamp = document.createElement('div');
    timestamp.className = 'message-timestamp';
    timestamp.textContent = new Date().toLocaleTimeString();
    messageDiv.appendChild(timestamp);
    
    chatContainer.appendChild(messageDiv);
    // Scroll the entire page to the bottom
    window.scrollTo({
        top: document.body.scrollHeight,
        behavior: 'smooth'
    });
}

// Handle file drag and drop
const fileUpload = document.querySelector('.file-upload');
fileUpload.addEventListener('dragover', (e) => {
    e.preventDefault();
    fileUpload.style.backgroundColor = 'rgba(37, 99, 235, 0.05)';
});

fileUpload.addEventListener('dragleave', () => {
    fileUpload.style.backgroundColor = 'transparent';
});

fileUpload.addEventListener('drop', (e) => {
    e.preventDefault();
    fileUpload.style.backgroundColor = 'transparent';
    const file = e.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') {
        document.getElementById('pdfInput').files = e.dataTransfer.files;
        uploadPDF();
    }
});

// Handle Enter key in question input
document.getElementById('questionInput').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        askQuestion();
    }
});

// Add event listeners
document.getElementById('questionInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        askQuestion();
    }
});
