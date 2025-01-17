
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
            body: formData
        });
        
        const result = await response.json();
        if (response.ok) {
            uploadedFiles = [...uploadedFiles, ...files];
            renderFileList();
            try {
                addMessage('PDFs uploaded and processed successfully', 'bot');
            } catch (error) {
                console.error('Error:', error);
                addMessage('Error showing uploaded files', 'bot');
            }
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

function askQuestion() {
    const questionInput = document.getElementById('questionInput');
    const question = questionInput.value.trim();
    
    if (!question) return;

    addMessage(question, 'user');
    questionInput.value = '';

    const chatContainer = document.getElementById('chatContainer');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message bot-message';
    const messageContent = document.createElement('div');
    messageContent.className = 'message-content';
    messageDiv.appendChild(messageContent);
    const timestamp = document.createElement('div');
    timestamp.className = 'message-timestamp';
    timestamp.textContent = new Date().toLocaleTimeString();
    messageDiv.appendChild(timestamp);
    chatContainer.appendChild(messageDiv);

    let accumulatedText = '';

    fetch('/ask', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ question })
    })
    .then(response => {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        
        function readStream() {
            reader.read().then(({ done, value }) => {
                if (done) return;
                
                const chunk = decoder.decode(value);
                try {
                    const data = JSON.parse(chunk);
                    if (data.chunk) {
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
                
                readStream();
            });
        }
        
        readStream();
    })
    .catch(error => {
        console.error('Error:', error);
        messageContent.textContent = 'Error processing question';
    });
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

window.addEventListener('load', () => {
    fetch('/reset-session')
        .then(response => response.json())
        .then(data => console.log('Session reset:', data));
});